-- =============================================================================
-- Migration 020 — Correction consume_credits : verrou par CTE matérialisée
-- =============================================================================
-- Remplace le corps de consume_credits (008) : le SELECT
-- SUM(remaining) ... FOR UPDATE d'origine est illégal — PostgreSQL interdit
-- FOR UPDATE sur un agrégat (erreur 0A000, incident du 18/09 : toute
-- création de RDV avec avoir échouait). Le verrou passe désormais par une
-- CTE matérialisée : les lignes sont verrouillées DANS la CTE, l'agrégat
-- lit ensuite la CTE verrouillée.
--
-- L'ordre de verrouillage (created_at ASC, id ASC) est identique à celui de
-- la boucle FIFO : deux consommations concurrentes prennent les verrous
-- dans le même ordre, pas de deadlock consume-consume. Le contrôle de
-- suffisance reste fail-closed (CREDIT_INSUFFICIENT si demande > disponible,
-- aucun usage écrit).
--
-- Append-only, comme 018/019 : la 008 n'est jamais réécrite ; ce fichier ne
-- fait que CREATE OR REPLACE la fonction, signature inchangée
-- (consume_credits(TEXT, INTEGER, UUID), SECURITY DEFINER).
-- =============================================================================

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

  -- Verrouiller puis sommer le disponible : la CTE matérialise les lignes
  -- verrouillées (FOR UPDATE), l'agrégat lit la CTE — un FOR UPDATE direct
  -- sur le SUM est illégal (0A000).
  WITH locked AS (
    SELECT remaining FROM credits
    WHERE patient_email = LOWER(p_email) AND remaining > 0
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  )
  SELECT COALESCE(SUM(remaining), 0) INTO v_total_available FROM locked;

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
