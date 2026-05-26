-- Migration 005: Flexible appointment duration
-- Replaces the fixed CHECK (duration IN (60, 90)) constraint with a range check
-- to support custom durations introduced in feat #38.

ALTER TABLE appointments
  DROP CONSTRAINT appointments_duration_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_duration_check
    CHECK (duration >= 15 AND duration <= 240);
