-- ===========================================================================
-- Migration 011 — Durable "confirmation delivered" flag (L2 idempotency)
-- Issue #68 (T2): prevent duplicate confirmation side-effects across retries.
--
-- Layering recap:
--   L1 = stripe_payment_intent_id uniqueness (migration 010) — prevents
--        duplicate payment *rows*.
--   L2 = confirmation_sent_at (this migration) — prevents duplicate
--        confirmation side-effects (emails) across sweep + webhook retries,
--        even when L1 alone is insufficient (e.g. transient failure between
--        payment commit and confirmation send).
--
-- Semantics:
--   NULL     = not yet delivered; sweep/webhook will retry.
--   non-NULL = delivered; stop retrying.
--   Set ONLY after full side-effect success. NEVER reset to NULL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, backfill guarded by IS NULL,
-- index uses IF NOT EXISTS.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- COLUMN : confirmation_sent_at — L2 idempotency flag.
-- Mirrors the reminder_sent_at idiom from 001_init.sql: nullable TIMESTAMPTZ,
-- NULL until the side-effect succeeds.
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- BACKFILL : mark existing payment_received rows as already delivered so the
-- upcoming sweep (T8) doesn't re-spam historical customers. Uses updated_at
-- as a best-effort proxy for when confirmation was sent (these rows predate
-- the flag; no better signal available).
-- ---------------------------------------------------------------------------
UPDATE appointments
SET confirmation_sent_at = updated_at
WHERE status = 'payment_received'
  AND confirmation_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- INDEX : fast sweep scans. The sweep (T8) queries rows that are
-- payment_received AND not yet confirmed; this index covers that predicate
-- ordered by scheduled_at. Deliberately separate from the unique index in 010
-- (different predicate, different purpose).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appointments_confirmation_pending
  ON appointments (scheduled_at)
  WHERE status = 'payment_received' AND confirmation_sent_at IS NULL;
