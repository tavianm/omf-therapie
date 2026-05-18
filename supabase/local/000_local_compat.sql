-- =============================================================================
-- Compatibilité locale uniquement — NE PAS appliquer sur Supabase
-- Crée les stubs des fonctions Supabase absentes de PostgreSQL vanilla
-- =============================================================================

-- Supabase expose un schéma "auth" avec des fonctions utilitaires.
-- En local, on crée un stub minimal pour que les politiques RLS compilent.
CREATE SCHEMA IF NOT EXISTS auth;

-- auth.role() retourne toujours 'service_role' en local :
-- toutes les requêtes passent via supabaseAdmin (service_role), donc RLS est bypassé.
CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT AS $$
BEGIN
  RETURN 'service_role';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Rôles PostgreSQL compatibles PostgREST (simulation des rôles Supabase)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

-- Accès complet pour PostgREST (schéma public)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
