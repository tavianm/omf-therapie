-- ===========================================================================
-- Migration 013 — Durable "invitation sent" flag (L2 idempotency)
-- Issue #126 (T1): automatic invitation catch-up via reconcile-invitations.
--
-- Semantics (mirrors confirmation_sent_at from 011):
--   NULL     = invitation email not yet sent; the reconcile-invitations
--              sweep will retry.
--   non-NULL = invitation sent; stop retrying.
--   Set ONLY after full side-effect success. NEVER reset to NULL.
--
-- The reconcile-invitations sweep scans appointments that are
--   status IN ('confirmed', 'payment_pending', 'payment_received')
--          -- approved deviation from spec §5: avoir-paid rows are inserted
--          -- directly as payment_received and their invitation email can
--          -- fail just like any other (required by SC3).
--   AND invitation_sent_at IS NULL
--   AND created_at > now() - 48h         -- reconciliation window
--   AND scheduled_at > now()              -- still upcoming
--
-- Canonical predicate: netlify/functions/reconcile-invitations.ts.
--
-- Backfill: ALL existing rows are set to invitation_sent_at = now() with NO
-- filter — deliberately. Historical appointments must NEVER be swept by
-- reconcile-invitations (they predate the flag; re-sending invitations to
-- past customers would be a side-effect regression).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, backfill guarded by IS NULL,
-- index uses IF NOT EXISTS.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- COLUMN : invitation_sent_at — L2 idempotency flag.
-- Mirrors the reminder_sent_at idiom from 001_init.sql: nullable TIMESTAMPTZ,
-- NULL until the side-effect succeeds.
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- BACKFILL : unfiltered — every existing row is marked as invited. See header:
-- historical appointments must never be swept by reconcile-invitations.
-- ---------------------------------------------------------------------------
UPDATE appointments
SET invitation_sent_at = now()
WHERE invitation_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- INDEX : fast sweep scans. reconcile-invitations sorts candidates by
-- created_at (oldest first), so the partial index covers the "not yet invited
-- and not soft-deleted" predicate ordered by created_at.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appointments_invitation_pending
  ON appointments (created_at)
  WHERE invitation_sent_at IS NULL AND deleted_at IS NULL;
