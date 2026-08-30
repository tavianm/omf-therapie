-- ===========================================================================
-- Migration 015 — Uniqueness of active manual time slots
-- Issue #60: prevent duplicate (slot_date, period) rows while allowing a slot
-- to be recreated after its predecessor has been soft-deleted.
--
-- Steps:
--   1. Snapshot pre-existing active duplicates into an audit table.
--   2. Soft-delete extras, keeping the latest by (created_at DESC, id DESC).
--   3. Add a partial unique index for active rows.
--
-- Idempotent: safe to re-run (IF NOT EXISTS, dedupe becomes a no-op).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS _audit_015_manual_slots_dedup AS
  SELECT id, slot_date, period, created_at, updated_at
  FROM manual_time_slots
  WHERE deleted_at IS NULL
    AND id NOT IN (
      SELECT DISTINCT ON (slot_date, period) id
      FROM manual_time_slots
      WHERE deleted_at IS NULL
      ORDER BY slot_date, period, created_at DESC, id DESC
    );

ALTER TABLE _audit_015_manual_slots_dedup ENABLE ROW LEVEL SECURITY;

UPDATE manual_time_slots
SET
  deleted_at = now(),
  updated_at = now()
WHERE deleted_at IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (slot_date, period) id
    FROM manual_time_slots
    WHERE deleted_at IS NULL
    ORDER BY slot_date, period, created_at DESC, id DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_slots_slot_date_period_active_unique
  ON manual_time_slots (slot_date, period)
  WHERE deleted_at IS NULL;
