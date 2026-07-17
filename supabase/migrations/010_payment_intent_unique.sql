-- ===========================================================================
-- Migration 010 — Uniqueness on appointments.stripe_payment_intent_id
-- Issue #68 (T1): prevent duplicate payment rows on dual-event delivery.
--
-- Numérotation : numérotée 010 (pas 009) car main a fusionné 008_credits après
-- le point de branche ; 009 est intentionnellement réservé/sauté — voir le
-- commit de plan 79efca1. Supabase suit les migrations par nom de fichier,
-- donc le saut est inoffensif à l'application.
--
-- Stripe can deliver payment_intent.succeeded and checkout.session.completed
-- for the same intent in quick succession. Without a uniqueness constraint,
-- dual-event delivery can create duplicate payment rows.
--
-- Steps:
--   1. Snapshot duplicates into an audit table (reversibility).
--   2. Null the duplicates, keeping the latest by
--      (updated_at DESC, id DESC) per stripe_payment_intent_id.
--   3. Create a partial unique index so only one non-NULL
--      stripe_payment_intent_id may exist at a time.
--
-- Idempotent: safe to re-run (IF NOT EXISTS, UPDATE is a no-op once clean).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- AUDIT TABLE : capture rows nulled by the dedupe pass (reversibility).
-- Created via CTAS so it inherits no constraints and is cheap to drop.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _audit_010_dedup AS
  SELECT id, stripe_payment_intent_id, created_at, updated_at
  FROM appointments
  WHERE stripe_payment_intent_id IS NOT NULL
    AND id NOT IN (
      SELECT DISTINCT ON (stripe_payment_intent_id) id
      FROM appointments
      WHERE stripe_payment_intent_id IS NOT NULL
      ORDER BY stripe_payment_intent_id, updated_at DESC, id DESC
    );

-- ---------------------------------------------------------------------------
-- DEDUPE : null the duplicates (keep latest by updated_at DESC, id DESC).
-- The subquery selects exactly one survivor per payment_intent_id.
-- ---------------------------------------------------------------------------
UPDATE appointments
SET stripe_payment_intent_id = NULL
WHERE stripe_payment_intent_id IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (stripe_payment_intent_id) id
    FROM appointments
    WHERE stripe_payment_intent_id IS NOT NULL
    ORDER BY stripe_payment_intent_id, updated_at DESC, id DESC
  );

-- ---------------------------------------------------------------------------
-- INDEX : partial unique — only one non-NULL payment_intent at a time.
-- Partial (WHERE ... IS NOT NULL) so legacy rows without a payment_intent are
-- unconstrained and multiple NULLs remain legal (SQL-standard null semantics),
-- mirroring the stripe_event_id UNIQUE idiom from 001_init.sql.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_stripe_payment_intent_id_unique
  ON appointments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
