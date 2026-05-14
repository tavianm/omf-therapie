-- =============================================================================
-- Migration 003 — Rename references column for PostgREST compatibility
-- =============================================================================

ALTER TABLE email_threads
  RENAME COLUMN "references" TO thread_references;
