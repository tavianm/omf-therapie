/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Supabase
  readonly SUPABASE_DATABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;

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
  // the canary degrades to "deploy: unknown" when absent.
  /** Git SHA of the deployed commit — auto-set by Netlify at build time. */
  readonly COMMIT_REF?: string;
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
