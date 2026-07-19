/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Supabase
  readonly SUPABASE_DATABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;

  // PostgreSQL (raw connection for BetterAuth — distinct from SUPABASE_* REST)
  /** Connection string Supabase PostgreSQL (pooler :6543 recommandé en serverless). */
  readonly DATABASE_URL: string;
  /** Certificat racine Supabase (PEM multiline) pour vérification TLS. Optionnel en local. */
  readonly SUPABASE_CA_CERT?: string;

  // BetterAuth
  /** Clé secrète aléatoire pour BetterAuth (min 32 caractères). */
  readonly BETTER_AUTH_SECRET: string;
  /** URL de base du site — ex: https://omf-therapie.fr (sans slash final). */
  readonly BETTER_AUTH_URL: string;
  /** E-mail du compte admin unique (utilisé par le script seed-admin). */
  readonly ADMIN_EMAIL: string;

  // Google Calendar
  readonly GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  readonly GOOGLE_PRIVATE_KEY?: string;
  readonly GOOGLE_CALENDAR_ID?: string;

  // Google OAuth (3-legged) for Meet link generation
  readonly GOOGLE_OAUTH_CLIENT_ID?: string;
  readonly GOOGLE_OAUTH_CLIENT_SECRET?: string;
  readonly GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  readonly GOOGLE_OAUTH_REDIRECT_URI?: string;

  // Sentry (observability — error tracking + structured logging).
  // PUBLIC_ prefix so @sentry/browser can read it client-side, mirroring
  // PUBLIC_GA4_ID. Optional: when unset the SDK stays inert (local dev and
  // environments without monitoring degrade to console.* only).
  readonly PUBLIC_SENTRY_DSN?: string;

  // Netlify-injected (NOT operator-configured). Undefined in local dev;
  // the server-side canary degrades to "deploy: unknown" when absent.
  /** Git SHA of the deployed commit — auto-set by Netlify at build time. */
  readonly COMMIT_REF?: string;

  // PUBLIC_COMMIT_REF is the client-exposed mirror of COMMIT_REF. The build
  // command in netlify.toml prefixes it: `PUBLIC_COMMIT_REF=$COMMIT_REF npm
  // run build`. Without the PUBLIC_ prefix Astro strips COMMIT_REF from the
  // client bundle → the browser canary would always emit "deploy: unknown".
  /** Client-visible git SHA (same value as COMMIT_REF). Set by the Netlify build command. */
  readonly PUBLIC_COMMIT_REF?: string;

  // PUBLIC_CONTEXT exposes Netlify's build-only CONTEXT var to the server
  // and client bundle. Netlify does NOT inject CONTEXT at function runtime,
  // so without this inlining every server event tags as 'staging' even on
  // the production deploy (production bug observed 2026-07-19). Same inlining
  // trick as PUBLIC_COMMIT_REF — see scripts/generate-build-env.mjs.
  /** Netlify deploy context ('production' | 'deploy-preview' | 'branch-deploy'). Set by the build command. */
  readonly PUBLIC_CONTEXT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Per-request locals populated by src/middleware.ts. Declared here (not in
// .astro/types.d.ts) so middleware and API routes share a typed contract.
declare namespace App {
  interface Locals {
    /** UUID v4 set by middleware — threads through to Sentry scope + logs. */
    requestId?: string;
    /** Route pathname (context.url.pathname) set by middleware. */
    route?: string;
  }
}
