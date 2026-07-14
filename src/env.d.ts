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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
