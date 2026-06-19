-- =============================================================================
-- Migration 007 — Plages horaires manuelles pour rendez-vous au cabinet
-- =============================================================================
-- Permet à la thérapeute de définir manuellement ses disponibilités pour les
-- rendez-vous en présentiel (in-person), indépendamment de la synchronisation
-- Google Calendar qui ne gère que les téléconsultations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE : manual_time_slots
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS manual_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date DATE NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('morning', 'afternoon', 'all_day')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- INDEX : manual_time_slots
-- ---------------------------------------------------------------------------

CREATE INDEX idx_manual_slots_date ON manual_time_slots(slot_date) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- TRIGGER : mise à jour automatique de updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER manual_time_slots_updated_at
  BEFORE UPDATE ON manual_time_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY : manual_time_slots
-- ---------------------------------------------------------------------------

ALTER TABLE manual_time_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin only" ON manual_time_slots
  FOR ALL USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- GRANT : service_role access
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_time_slots TO service_role;
