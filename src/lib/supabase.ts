/**
 * Clients Supabase pour OMF Thérapie
 *
 * Dépendance à installer :
 *   pnpm add @supabase/supabase-js
 *
 * Deux clients exportés :
 * - `supabase`      → client anon (routes publiques, limité par RLS)
 * - `supabaseAdmin` → client service_role (routes API server-side uniquement)
 *
 * ⚠️  Ne jamais exposer `supabaseAdmin` côté client/browser.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Lecture + validation des variables d'environnement
// ---------------------------------------------------------------------------

const supabaseUrl = import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.warn(
    '[supabase] ⚠️  SUPABASE_URL est absent. Les appels Supabase échoueront.',
  );
}

if (!supabaseAnonKey) {
  console.warn(
    '[supabase] ⚠️  SUPABASE_ANON_KEY est absent. Le client public ne fonctionnera pas.',
  );
}

if (!supabaseServiceRoleKey) {
  console.warn(
    '[supabase] ⚠️  SUPABASE_SERVICE_ROLE_KEY est absent. Le client admin ne fonctionnera pas.',
  );
}

// ---------------------------------------------------------------------------
// Client public (anon) — soumis aux politiques RLS
// ---------------------------------------------------------------------------

/**
 * Client Supabase avec la clé `anon`.
 * À utiliser dans les routes publiques ou côté client.
 * Les accès sont contraints par les politiques Row Level Security.
 */
// On utilise `any` pour la base de données tant que les types générés
// ne sont pas disponibles (voir supabase gen types typescript).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any> = createClient(
  supabaseUrl ?? '',
  supabaseAnonKey ?? '',
);

// ---------------------------------------------------------------------------
// Client admin (service_role) — contourne RLS
// ---------------------------------------------------------------------------

/**
 * Client Supabase avec la clé `service_role`.
 * Contourne intégralement les politiques RLS.
 *
 * ⚠️  À utiliser UNIQUEMENT dans les routes API server-side (Netlify Functions,
 *     Astro endpoints avec `export const prerender = false`).
 *     Ne jamais importer dans du code exécuté côté browser.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAdmin: SupabaseClient<any> = createClient(
  supabaseUrl ?? '',
  supabaseServiceRoleKey ?? '',
  {
    auth: {
      // Désactive la persistance de session — inutile côté serveur
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
