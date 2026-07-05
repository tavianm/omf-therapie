-- ===========================================================================
-- Migration 008 — Système d'avoir interne (credits)
-- Issue #63 : annulation RDV payé → avoir réutilisable en création manuelle.
--
-- Aucun remboursement Stripe réel : l'avoir est un crédit interne, rattaché au
-- patient_email. La consommation est FIFO et atomique (RPC SECURITY DEFINER).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- TABLE : credits  (une ligne par avoir émis)
-- ---------------------------------------------------------------------------
CREATE TABLE credits (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_email         TEXT        NOT NULL,
  source_appointment_id UUID        REFERENCES appointments(id) ON DELETE SET NULL,
  amount                INTEGER     NOT NULL CHECK (amount > 0),       -- centimes, montant d'origine
  remaining             INTEGER     NOT NULL CHECK (remaining >= 0 AND remaining <= amount),
  reason                TEXT        NOT NULL DEFAULT 'cancellation',   -- extensible ('manual' future)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un seul avoir par RDV source (idempotence : re-clic sur Annuler ne crée pas de doublon).
-- Plusieurs NULL autorisés (avoirs sans RDV source, ex. création manuelle future).
CREATE UNIQUE INDEX credits_source_appointment_uniq
  ON credits(source_appointment_id)
  WHERE source_appointment_id IS NOT NULL;

-- Recherche rapide du solde disponible par patient (FIFO + lookup).
CREATE INDEX credits_patient_email_idx
  ON credits(patient_email, created_at)
  WHERE remaining > 0;

-- ---------------------------------------------------------------------------
-- TABLE : credit_usages  (lien RDV consommateur → avoir consommé, par tranche FIFO)
-- ---------------------------------------------------------------------------
CREATE TABLE credit_usages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id     UUID        NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  appointment_id UUID       NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  amount        INTEGER     NOT NULL CHECK (amount > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Empêche la double-consommation d'un même avoir pour un même RDV.
CREATE UNIQUE INDEX credit_usages_once_per_appt_credit
  ON credit_usages(credit_id, appointment_id);

-- Restitution : recherche par RDV consommateur.
CREATE INDEX credit_usages_appointment_idx
  ON credit_usages(appointment_id);

-- ---------------------------------------------------------------------------
-- COLONNE : appointments.credit_applied
-- Avoir consommé à la création. Montant Stripe = final_price - credit_applied.
-- ---------------------------------------------------------------------------
ALTER TABLE appointments ADD COLUMN credit_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD CONSTRAINT appointments_credit_applied_chk
  CHECK (credit_applied >= 0);

-- ---------------------------------------------------------------------------
-- TRIGGER : updated_at (réutilise update_updated_at() défini dans 001_init.sql)
-- ---------------------------------------------------------------------------
CREATE TRIGGER credits_updated_at
  BEFORE UPDATE ON credits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY — service_role only (comme appointments)
-- ---------------------------------------------------------------------------
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_usages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credits service_role full access" ON credits
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "credit_usages service_role full access" ON credit_usages
  FOR ALL
  USING (auth.role() = 'service_role');

-- ===========================================================================
-- RPC : consume_credits — consommation FIFO atomique
-- ===========================================================================
-- Verrouille les avoirs disponibles (FOR UPDATE), vérifie la couverture,
-- consomme en FIFO (plus ancien d'abord) et enregistre les tranches dans
-- credit_usages. SECURITY DEFINER : le propriétaire de la fonction (postgres)
-- exécute le corps en bypassant la RLS ; l'accès est limité à service_role.
--
-- Retourne les tranches consommées (credit_id, amount) pour audit.
-- Lève 'CREDIT_INSUFFICIENT' si la demande dépasse le disponible.
-- Lève 'CREDIT_NO_OP' si p_amount = 0 (aucune consommation, sortie propre).
-- ===========================================================================
CREATE OR REPLACE FUNCTION consume_credits(
  p_email          TEXT,
  p_amount         INTEGER,
  p_appointment_id UUID
) RETURNS TABLE(credit_id UUID, amount INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_available INTEGER;
  v_remaining_to_take INTEGER;
  v_credit_rec RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'CREDIT_NO_OP';
  END IF;

  -- Verrouiller et sommer le disponible pour ce patient.
  SELECT COALESCE(SUM(remaining), 0) INTO v_total_available
    FROM credits
    WHERE patient_email = LOWER(p_email) AND remaining > 0
    FOR UPDATE;

  IF v_total_available < p_amount THEN
    RAISE EXCEPTION 'CREDIT_INSUFFICIENT: disponible %, demandé %', v_total_available, p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  v_remaining_to_take := p_amount;

  -- FIFO : parcourir les avoirs les plus anciens et consommer jusqu'à couvrir p_amount.
  FOR v_credit_rec IN
    SELECT id, remaining
      FROM credits
      WHERE patient_email = LOWER(p_email) AND remaining > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_to_take <= 0;
    DECLARE
      v_take INTEGER;
    BEGIN
      v_take := LEAST(v_credit_rec.remaining, v_remaining_to_take);
      UPDATE credits SET remaining = remaining - v_take WHERE id = v_credit_rec.id;
      INSERT INTO credit_usages(credit_id, appointment_id, amount)
        VALUES (v_credit_rec.id, p_appointment_id, v_take);
      v_remaining_to_take := v_remaining_to_take - v_take;
      credit_id := v_credit_rec.id;
      amount := v_take;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION consume_credits(TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_credits(TEXT, INTEGER, UUID) TO service_role;

-- ===========================================================================
-- RPC : restore_credits — restitution d'un avoir consommé (annulation du RDV bénéficiaire)
-- ===========================================================================
-- Sélectionne les credit_usages d'un RDV, restaure les remaining des avoirs
-- sources, puis supprime les usages. Idempotent (si déjà restauré, no-op).
-- ===========================================================================
CREATE OR REPLACE FUNCTION restore_credits(p_appointment_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Restaurer le remaining de chaque avoir consommé par ce RDV.
  UPDATE credits c
    SET remaining = c.remaining + cu.consumed
    FROM (
      SELECT credit_id, SUM(amount) AS consumed
        FROM credit_usages
        WHERE appointment_id = p_appointment_id
        GROUP BY credit_id
    ) cu
    WHERE c.id = cu.credit_id;

  -- Supprimer les usages (idempotent : si déjà supprimés, no-op).
  DELETE FROM credit_usages WHERE appointment_id = p_appointment_id;
END;
$$;

REVOKE ALL ON FUNCTION restore_credits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restore_credits(UUID) TO service_role;
