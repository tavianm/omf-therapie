-- #36 Google Calendar production-ready integration
-- Creates token storage table and adds google_calendar_event_id to appointments

-- Token storage for OAuth rotation (singleton row: id = 'therapist')
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id TEXT PRIMARY KEY DEFAULT 'therapist',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: only service role can access (no public access needed)
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Link calendar events to appointments for lifecycle management
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
