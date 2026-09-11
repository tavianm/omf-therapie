-- =============================================================================
-- Migration 018 — Fail-closed scheduling guard + serialized credit restore
-- =============================================================================
-- Migrations 015, 016 and 017 are already applied on staging and are
-- append-only: this migration re-declares functions with CREATE OR REPLACE
-- and never edits an applied file.
--
-- A. The 017:28 comment claimed that the NOT NULL constraint on
--    blocked_until neutralizes an inversion of the two BEFORE triggers.
--    That claim is false: NOT NULL is checked only AFTER the BEFORE-trigger
--    chain, so under inversion appointments_enforce_schedule_conflict would
--    run with NEW.blocked_until = NULL, the overlap comparisons would
--    evaluate to NULL, both EXISTS checks would silently no-op, and apply
--    would then fill the column and let the row commit unchecked. The
--    re-declared enforce function below makes the guard fail closed: it
--    raises scheduling_guard_violation when blocked_until is still NULL by
--    the time the guard runs. No trigger is created, altered or dropped —
--    the 015 triggers automatically pick up the replaced function.
--
-- B. restore_credits (008:156-174) is idempotent only sequentially: two
--    concurrent transactions can read the same credit_usages rows before
--    either DELETE commits, and both apply remaining += consumed (double
--    restore). Each RPC call is its own transaction, so a transaction-scoped
--    advisory lock inside the function serializes concurrent restores of the
--    same appointment; the loser re-reads after the winner commits and finds
--    zero usages (no-op).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A — appointments_enforce_schedule_conflict() : fail closed on a NULL bound
-- -----------------------------------------------------------------------------
-- Body re-declared from 015 with exactly two changes:
--   1. a fail-closed RAISE when NEW.blocked_until IS NULL, placed right after
--      the advisory lock and the blocking-status/deleted_at early return;
--   2. the pending-reschedule proposal EXISTS wraps the buffer call in
--      COALESCE(..., 0) so a NULL buffer cannot silently disable that check
--      (the other two buffer uses already go through
--      COALESCE(configured_buffer, 0) and are unchanged).
CREATE OR REPLACE FUNCTION public.appointments_enforce_schedule_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  blocking_statuses TEXT[] := ARRAY[
    'pending', 'confirmed', 'payment_pending', 'payment_received', 'rescheduled'
  ];
  configured_buffer INTEGER;
  proposal_blocked_until TIMESTAMPTZ;
BEGIN
  -- A single transaction-scoped lock makes the read/check/write sequence
  -- serial for every appointment mutation, including concurrent HTTP calls.
  PERFORM pg_advisory_xact_lock(hashtext('omf-therapie:appointment-schedule'));

  IF NOT (NEW.status = ANY (blocking_statuses)) OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.blocked_until IS NULL THEN
    RAISE EXCEPTION 'scheduling_guard_violation'
      USING ERRCODE = 'P0001',
        DETAIL = 'blocked_until is NULL when the conflict guard runs; appointments_apply_scheduling_policy must fire first (alphabetical trigger order).';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments existing
    WHERE existing.id <> NEW.id
      AND existing.deleted_at IS NULL
      AND existing.status = ANY (blocking_statuses)
      AND existing.scheduled_at < NEW.blocked_until
      AND existing.blocked_until > NEW.scheduled_at
  ) THEN
    RAISE EXCEPTION 'scheduling_conflict'
      USING ERRCODE = 'P0001',
        DETAIL = 'The requested clinical interval overlaps a blocked interval.';
  END IF;

  -- A pending reschedule reserves its proposed interval in addition to the
  -- current appointment. This mirrors the application-side fast check.
  IF EXISTS (
    SELECT 1
    FROM public.appointments proposal
    WHERE proposal.id <> NEW.id
      AND proposal.deleted_at IS NULL
      AND proposal.status = 'rescheduled'
      AND proposal.rescheduled_to IS NOT NULL
      AND proposal.rescheduled_to < NEW.blocked_until
      AND proposal.rescheduled_to
        + proposal.duration * interval '1 minute'
        + COALESCE(public.scheduling_buffer_minutes(), 0) * interval '1 minute'
        > NEW.scheduled_at
  ) THEN
    RAISE EXCEPTION 'scheduling_conflict'
      USING ERRCODE = 'P0001',
        DETAIL = 'The requested clinical interval overlaps a proposed reschedule.';
  END IF;

  IF NEW.status = 'rescheduled' AND NEW.rescheduled_to IS NOT NULL THEN
    SELECT buffer_minutes
      INTO configured_buffer
      FROM public.scheduling_settings
      WHERE singleton = true;
    proposal_blocked_until := NEW.rescheduled_to
      + NEW.duration * interval '1 minute'
      + COALESCE(configured_buffer, 0) * interval '1 minute';

    IF EXISTS (
      SELECT 1
      FROM public.appointments existing
      WHERE existing.id <> NEW.id
        AND existing.deleted_at IS NULL
        AND existing.status = ANY (blocking_statuses)
        AND existing.scheduled_at < proposal_blocked_until
        AND existing.blocked_until > NEW.rescheduled_to
    ) OR EXISTS (
      SELECT 1
      FROM public.appointments proposal
      WHERE proposal.id <> NEW.id
        AND proposal.deleted_at IS NULL
        AND proposal.status = 'rescheduled'
        AND proposal.rescheduled_to IS NOT NULL
        AND proposal.rescheduled_to < proposal_blocked_until
        AND proposal.rescheduled_to
          + proposal.duration * interval '1 minute'
          + COALESCE(configured_buffer, 0) * interval '1 minute'
          > NEW.rescheduled_to
    ) THEN
      RAISE EXCEPTION 'scheduling_conflict'
        USING ERRCODE = 'P0001',
          DETAIL = 'The proposed reschedule overlaps a blocked interval.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- B — restore_credits(UUID) : serialize concurrent restores per appointment
-- -----------------------------------------------------------------------------
-- Body identical to 008:161-172, preceded by the transaction-scoped advisory
-- lock. SECURITY DEFINER keeps executing as the owner (bypasses RLS); EXECUTE
-- stays restricted to service_role below.
CREATE OR REPLACE FUNCTION public.restore_credits(p_appointment_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Serializes concurrent restores for the same appointment; the loser
  -- re-reads after the winner commits and finds no usages (no-op).
  PERFORM pg_advisory_xact_lock(hashtext('omf-therapie:credits:' || p_appointment_id::TEXT));

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
