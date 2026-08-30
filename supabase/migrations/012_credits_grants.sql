-- ===========================================================================
-- Migration 012 — Missing service_role grants on credits / credit_usages
-- ===========================================================================
-- 008_credits.sql created the credits tables but omitted the explicit GRANT
-- required since 006_explicit_grants.sql revoked the implicit default
-- privileges ("les nouvelles tables devront inclure un GRANT explicite dans
-- leur migration"). As a result, every supabaseAdmin query on these tables
-- failed in production with:
--   42501 permission denied for table credits
--
-- Impact: getAvailableCredit / getCreditBalance silently returned 0, so the
-- admin appointment-creation flow and the credits page ignored existing
-- avoirs. The SECURITY DEFINER RPCs (consume_credits / restore_credits) were
-- unaffected — only direct table access was broken.
--
-- Idempotent: re-running a GRANT is a no-op.
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credits        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_usages  TO service_role;
