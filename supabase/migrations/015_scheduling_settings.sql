-- =============================================================================
-- Migration 015 — Politique globale de planification et garde de concurrence
-- =============================================================================
-- La durée clinique reste `scheduled_end`. `blocked_until` inclut la marge
-- globale qui protège le créneau suivant sans être exposée aux patients.

CREATE TABLE IF NOT EXISTS public.scheduling_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  buffer_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (buffer_minutes IN (0, 15, 20)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.scheduling_settings (singleton, buffer_minutes)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.scheduling_buffer_minutes()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT buffer_minutes FROM public.scheduling_settings WHERE singleton = true
$$;

CREATE OR REPLACE FUNCTION public.appointments_apply_scheduling_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  configured_buffer INTEGER;
BEGIN
  SELECT buffer_minutes
    INTO configured_buffer
    FROM public.scheduling_settings
    WHERE singleton = true;

  NEW.blocked_until := NEW.scheduled_at
    + NEW.duration * interval '1 minute'
    + COALESCE(configured_buffer, 0) * interval '1 minute';
  RETURN NEW;
END;
$$;

-- Fill existing rows before making the technical bound mandatory.
UPDATE public.appointments
SET blocked_until = scheduled_at
  + duration * interval '1 minute'
  + COALESCE(public.scheduling_buffer_minutes(), 0) * interval '1 minute'
WHERE blocked_until IS NULL;

ALTER TABLE public.appointments
  ALTER COLUMN blocked_until SET NOT NULL;

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
        + public.scheduling_buffer_minutes() * interval '1 minute'
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

DROP TRIGGER IF EXISTS appointments_apply_scheduling_policy ON public.appointments;
CREATE TRIGGER appointments_apply_scheduling_policy
  BEFORE INSERT OR UPDATE OF scheduled_at, duration ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_apply_scheduling_policy();

DROP TRIGGER IF EXISTS appointments_enforce_schedule_conflict ON public.appointments;
CREATE TRIGGER appointments_enforce_schedule_conflict
  BEFORE INSERT OR UPDATE OF scheduled_at, duration, status, rescheduled_to, deleted_at
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_enforce_schedule_conflict();

CREATE OR REPLACE FUNCTION public.set_scheduling_buffer(new_buffer_minutes INTEGER)
RETURNS TABLE (buffer_minutes INTEGER, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflict_found BOOLEAN;
BEGIN
  IF new_buffer_minutes IS NULL OR new_buffer_minutes NOT IN (0, 15, 20) THEN
    RAISE EXCEPTION 'invalid_scheduling_buffer'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('omf-therapie:appointment-schedule'));

  WITH blocks AS (
    SELECT id, scheduled_at AS starts_at,
      scheduled_at + duration * interval '1 minute'
        + new_buffer_minutes * interval '1 minute' AS ends_at
    FROM public.appointments
    WHERE deleted_at IS NULL
      AND status = ANY (ARRAY['pending', 'confirmed', 'payment_pending', 'payment_received', 'rescheduled'])
      AND scheduled_at + duration * interval '1 minute'
        + new_buffer_minutes * interval '1 minute' > now()
    UNION ALL
    SELECT id, rescheduled_to AS starts_at,
      rescheduled_to + duration * interval '1 minute'
        + new_buffer_minutes * interval '1 minute' AS ends_at
    FROM public.appointments
    WHERE deleted_at IS NULL
      AND status = 'rescheduled'
      AND rescheduled_to IS NOT NULL
      AND rescheduled_to + duration * interval '1 minute'
        + new_buffer_minutes * interval '1 minute' > now()
  )
  SELECT EXISTS (
    SELECT 1
    FROM blocks first_block
    JOIN blocks second_block ON first_block.id <> second_block.id
      AND first_block.starts_at < second_block.ends_at
      AND first_block.ends_at > second_block.starts_at
  ) INTO conflict_found;

  IF conflict_found THEN
    RAISE EXCEPTION 'scheduling_buffer_conflict'
      USING ERRCODE = 'P0001',
        DETAIL = 'Existing future appointments are too close for this buffer.';
  END IF;

  UPDATE public.scheduling_settings
  SET buffer_minutes = new_buffer_minutes, updated_at = now()
  WHERE singleton = true;

  -- Re-run the bound derivation after the new policy is committed in this
  -- transaction. The conflict trigger sees an already validated schedule.
  UPDATE public.appointments
  SET blocked_until = scheduled_at
    + duration * interval '1 minute'
    + new_buffer_minutes * interval '1 minute'
  WHERE scheduled_at + duration * interval '1 minute'
    + new_buffer_minutes * interval '1 minute' > now();

  RETURN QUERY
    SELECT settings.buffer_minutes, settings.updated_at
    FROM public.scheduling_settings settings
    WHERE settings.singleton = true;
END;
$$;

ALTER TABLE public.scheduling_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role scheduling settings" ON public.scheduling_settings;
CREATE POLICY "service role scheduling settings" ON public.scheduling_settings
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduling_settings TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_scheduling_buffer(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_scheduling_buffer(INTEGER) TO service_role;
