-- =============================================================================
-- Migration 016 — Unicité des présences manuelles actives
-- =============================================================================
-- Une présence supprimée logiquement peut être recréée, mais une même période
-- active ne peut exister qu'une fois pour une date donnée.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS manual_time_slots_active_date_period_unique
  ON public.manual_time_slots (slot_date, period)
  WHERE deleted_at IS NULL;
