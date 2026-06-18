-- =============================================================================
-- Migration 008 — Cache Keys Table
-- =============================================================================
-- Table pour stocker les clés de cache avec TTL pour invalider
-- dynamiquement les calculs coûteux (ex: disponibilités RDV).
-- =============================================================================

CREATE TABLE IF NOT EXISTS cache_keys (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEX : cache_keys
-- ---------------------------------------------------------------------------

CREATE INDEX idx_cache_keys_expires_at ON cache_keys(expires_at);

-- ---------------------------------------------------------------------------
-- POLICY : public access (lecture seule) et service_role (full)
-- ---------------------------------------------------------------------------

ALTER TABLE cache_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read only" ON cache_keys
  FOR SELECT USING (true);

CREATE POLICY "service_role full access" ON cache_keys
  FOR ALL USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- GRANT : service_role access
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cache_keys TO service_role;
