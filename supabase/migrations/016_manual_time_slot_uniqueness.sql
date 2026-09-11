-- =============================================================================
-- Migration 016 — Unicité des présences manuelles actives
-- =============================================================================
-- Une présence supprimée logiquement peut être recréée, mais une même période
-- active ne peut exister qu'une fois pour une date donnée.
-- =============================================================================

-- Les versions antérieures protégeaient les doublons par un SELECT applicatif.
-- Si deux requêtes ont tout de même créé la même présence, conserver la plus
-- ancienne et archiver les suivantes avant de poser l'index. L'archivage reste
-- réversible et évite qu'un déploiement échoue sur des données existantes.
WITH ranked_active_slots AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY slot_date, period
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM public.manual_time_slots
  WHERE deleted_at IS NULL
)
UPDATE public.manual_time_slots AS slot
SET deleted_at = now()
FROM ranked_active_slots AS ranked
WHERE slot.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS manual_time_slots_active_date_period_unique
  ON public.manual_time_slots (slot_date, period)
  WHERE deleted_at IS NULL;
