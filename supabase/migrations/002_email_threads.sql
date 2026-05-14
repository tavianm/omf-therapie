-- =============================================================================
-- Migration 002 — Threading emails patient (RFC 2822)
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_threads (
  thread_key      TEXT PRIMARY KEY,
  thread_subject  TEXT NOT NULL,
  root_message_id TEXT NOT NULL,
  last_message_id TEXT NOT NULL,
  "references"    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER email_threads_updated_at
  BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin only" ON email_threads
  FOR ALL USING (auth.role() = 'service_role');
