-- =============================================================================
-- Migration 019 — Atomic cancellation: CAS claim + credit restore + issuance
-- =============================================================================
-- Fixes the ledger gap flagged by the #149 review. Cancel previously performed
-- three separate writes: the CAS claim (API UPDATE), restore_credits (RPC, its
-- own transaction) and the cash-credit issuance (JS INSERT). If the issuance
-- failed after the restore had committed, the compensating rollback restored
-- the appointment status but left the restored avoir fully spendable: an
-- ACTIVE appointment whose credit was double-counted, with no ledger trace
-- tying the amount back to it (restore_credits deletes the credit_usages
-- rows). This RPC performs the claim and both ledger writes inside ONE
-- transaction — any failure rolls back everything, so the compensated state
-- no longer exists.
--
-- Reuses public.restore_credits (018) as-is: idempotent, serialized per
-- appointment by its own transaction-scoped advisory lock. This function
-- takes that SAME lock FIRST, so a concurrent cancel (or any credits
-- operation on the same appointment) serializes before the CAS claim; the
-- loser's UPDATE then matches 0 rows and the caller answers 409.
--
-- Append-only, like 018: staging already has 015–018 applied; this file only
-- CREATEs a new function and never edits an applied file.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_appointment_with_credits(
  p_appointment_id UUID,
  p_expected_status TEXT,
  p_therapist_notes TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_updated public.appointments%ROWTYPE;
  v_cash_amount INTEGER;
BEGIN
  -- Serialize with every other credits-ledger operation on this appointment
  -- (restore_credits uses the same key).
  PERFORM pg_advisory_xact_lock(hashtext('omf-therapie:credits:' || p_appointment_id::TEXT));

  -- 1. CAS claim: flips the row only while the status is still the one the
  --    caller read (same contract as the API-level claimAppointment). The
  --    015/018 BEFORE triggers fire inside this same transaction, identical
  --    to the previous API-level claim.
  UPDATE public.appointments
    SET status = 'cancelled',
        therapist_notes = COALESCE(p_therapist_notes, appointments.therapist_notes)
    WHERE id = p_appointment_id
      AND status = p_expected_status
    RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_status_conflict'
      USING ERRCODE = 'P0001',
        DETAIL = 'The appointment status changed concurrently or the id is unknown.';
  END IF;

  -- 2. Restore the consumed credit (no-op when credit_applied = 0).
  IF v_updated.credit_applied > 0 THEN
    PERFORM public.restore_credits(p_appointment_id);
  END IF;

  -- 3. Issue the cash credit for a paid appointment (final_price −
  --    credit_applied). Idempotent through the partial unique index
  --    credits_source_appointment_uniq (008): a re-run keeps the existing
  --    credit instead of double-issuing.
  v_cash_amount := v_updated.final_price - v_updated.credit_applied;
  IF p_expected_status = 'payment_received' AND v_cash_amount > 0 THEN
    INSERT INTO public.credits
        (patient_email, source_appointment_id, amount, remaining, reason)
      VALUES
        (LOWER(v_updated.patient_email), p_appointment_id, v_cash_amount,
         v_cash_amount, 'cancellation')
      ON CONFLICT (source_appointment_id) WHERE source_appointment_id IS NOT NULL
      DO NOTHING;
  END IF;

  -- The appointment row plus the flags the API layer needs for its response
  -- and the patient email, under `_`-prefixed keys that cannot collide with
  -- real columns.
  RETURN to_jsonb(v_updated)
    || jsonb_build_object(
      '_restored_amount',
        CASE WHEN v_updated.credit_applied > 0 THEN v_updated.credit_applied ELSE 0 END,
      '_issued_credit',
        (p_expected_status = 'payment_received' AND v_cash_amount > 0),
      '_credit_cash_amount',
        CASE
          WHEN (p_expected_status = 'payment_received' AND v_cash_amount > 0)
          THEN v_cash_amount
          ELSE 0
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_appointment_with_credits(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_with_credits(UUID, TEXT, TEXT) TO service_role;
