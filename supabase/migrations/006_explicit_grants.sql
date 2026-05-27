-- =============================================================================
-- Migration 006 — Grants explicites service_role (Supabase Data API)
-- =============================================================================
-- Contexte : À partir du 30 octobre 2026, Supabase n'accordera plus
-- automatiquement les privilèges sur les nouvelles tables. Cette migration
-- rend les grants explicites sur toutes les tables existantes et désactive
-- les default privileges implicites pour les nouvelles tables futures.
--
-- Toutes les tables du projet sont accessibles uniquement via supabaseAdmin
-- (service_role) — les rôles anon et authenticated ne sont pas utilisés.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Grants explicites sur les tables existantes
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."user"             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_threads      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_oauth_tokens TO service_role;

-- ---------------------------------------------------------------------------
-- Désactivation des default privileges implicites pour les tables futures
-- Les nouvelles tables devront inclure un GRANT explicite dans leur migration.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM anon, authenticated, service_role;
