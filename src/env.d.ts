/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Supabase
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;

  // BetterAuth
  /** Clé secrète aléatoire pour BetterAuth (min 32 caractères). */
  readonly BETTER_AUTH_SECRET: string;
  /** URL de base du site — ex: https://omf-therapie.fr (sans slash final). */
  readonly BETTER_AUTH_URL: string;
  /** E-mail du compte admin unique (utilisé par le script seed-admin). */
  readonly ADMIN_EMAIL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
