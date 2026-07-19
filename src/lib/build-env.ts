/**
 * Single source of truth for build-time-inlined Netlify env vars.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Netlify pre-defines `CONTEXT` and `COMMIT_REF` at BUILD time only — they
 * are NOT in `process.env` at function runtime (see Netlify docs: "Build
 * environment variables" vs "Functions environment variables"). Without
 * inlining, every server-side / cron event was tagged `environment:
 * 'staging'` in production and every server deploy canary read `deploy:
 * unknown` (production bugs observed 2026-07-19).
 *
 * HOW VALUES GET HERE
 * ───────────────────
 * netlify.toml build command:
 *   `node scripts/generate-build-env.mjs && PUBLIC_CONTEXT=$CONTEXT
 *    PUBLIC_COMMIT_REF=$COMMIT_REF npm run build`
 *
 * - `PUBLIC_*` prefix lets Astro/Vite inline them into server AND client
 *   bundles (only PUBLIC_-prefixed vars reach import.meta.env).
 * - scripts/generate-build-env.mjs writes a separate file for the cron
 *   runtime (esbuild-bundled, no Vite, no import.meta.env).
 *
 * The two paths agree: both read the same build-time $CONTEXT and
 * $COMMIT_REF, just via different bundlers.
 *
 * LOCAL DEV FALLBACK
 * ──────────────────
 * `npm run dev` runs outside Netlify → both vars absent → CONTEXT='dev'.
 * Sentry env then resolves to 'staging' (matches the prior behavior: local
 * events never tag as 'production').
 */

/**
 * Netlify deploy context — 'production' | 'deploy-preview' | 'branch-deploy'
 * in real builds, 'dev' in local dev. Source of truth for the Sentry
 * `environment` tag on server-side events.
 */
export const BUILD_CONTEXT: string =
  import.meta.env.PUBLIC_CONTEXT ?? 'dev';

/**
 * Git SHA of the deployed commit. Empty string in local dev. Used by the
 * server-side deploy canary (`deploy: <sha>` Sentry message) to confirm
 * post-deploy ingestion works.
 */
export const BUILD_COMMIT_REF: string =
  import.meta.env.PUBLIC_COMMIT_REF ?? '';

/**
 * Sentry environment tag derived from the build context. Only the real
 * production deploy tags events as 'production'; everything else (preview,
 * branch, local dev) tags as 'staging' so prod alerts stay quiet on
 * non-prod deploys.
 */
export function sentryEnvironment(): 'production' | 'staging' {
  return BUILD_CONTEXT === 'production' ? 'production' : 'staging';
}
