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
 *
 * Issue #68 (post-rebase review) : lazy-init des clients. Les lectures
 * `import.meta.env.*` ne se font plus au module-load mais au 1er accès — permet
 * au sweep Netlify (runtime Node) d'importer `notifications.ts` → `resend.ts`
 * → `supabase.ts` sans crash, car `import.meta.env` est undefined côté cron.
 * Le sweep instancie ses propres clients depuis `process.env` et n'utilise PAS
 * `supabaseAdmin` (il ne fait qu'importer le module pour les types). Le webhook
 * Astro utilise `supabaseAdmin` normalement (import.meta.env y est défini).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

const realtimeTransport = typeof globalThis.WebSocket === 'undefined' ? ws : undefined;

// ---------------------------------------------------------------------------
// Lazy-init — les variables d'env sont lues au 1er accès client, pas au module-load
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedSupabase: SupabaseClient<any> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedSupabaseAdmin: SupabaseClient<any> | undefined;

function readEnv(key: string): string | undefined {
  // Lit import.meta.env (runtime Astro/Vite) avec fallback process.env (cron Node).
  // Au module-load dans Astro, import.meta.env est défini ; dans le runtime cron,
  // il est undefined — d'où le fallback process.env.
  const fromMeta = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
  if (fromMeta !== undefined) return fromMeta;
  return process.env[key];
}

// ---------------------------------------------------------------------------
// Client public (anon) — soumis aux politiques RLS
// ---------------------------------------------------------------------------

/**
 * Client Supabase avec la clé `anon`.
 * À utiliser dans les routes publiques ou côté client.
 * Les accès sont contraints par les politiques Row Level Security.
 *
 * Lazy-init : la 1re lecture déclenche la lecture d'env + le `createClient`.
 */
// On utilise `any` pour la base de données tant que les types générés
// ne sont pas disponibles (voir supabase gen types typescript).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any> = new Proxy({} as SupabaseClient<any>, {
  get(_target, prop) {
    if (!cachedSupabase) {
      const url = readEnv('SUPABASE_DATABASE_URL');
      const anonKey = readEnv('SUPABASE_ANON_KEY');
      if (!url) {
        console.warn('[supabase] ⚠️  SUPABASE_DATABASE_URL est absent. Les appels Supabase échoueront.');
      }
      if (!anonKey) {
        console.warn('[supabase] ⚠️  SUPABASE_ANON_KEY est absent. Le client public ne fonctionnera pas.');
      }
      cachedSupabase = createClient(url ?? '', anonKey ?? '', {
        // Type skew: @types/ws `WebSocket` (address: string|URL) vs @supabase/realtime-js
        // `WebSocketLikeConstructor` (address: null). Runtime-compatible — bridge at boundary.
        ...(realtimeTransport ? { realtime: { transport: realtimeTransport as unknown as never } } : {}),
      });
    }
    return Reflect.get(cachedSupabase, prop);
  },
});

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
 *
 * Lazy-init : la 1re lecture déclenche la lecture d'env + le `createClient`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAdmin: SupabaseClient<any> = new Proxy({} as SupabaseClient<any>, {
  get(_target, prop) {
    if (!cachedSupabaseAdmin) {
      const url = readEnv('SUPABASE_DATABASE_URL');
      const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
      if (!url) {
        console.warn('[supabase] ⚠️  SUPABASE_DATABASE_URL est absent. Les appels Supabase échoueront.');
      }
      if (!serviceKey) {
        console.warn('[supabase] ⚠️  SUPABASE_SERVICE_ROLE_KEY est absent. Le client admin ne fonctionnera pas.');
      }
      cachedSupabaseAdmin = createClient(url ?? '', serviceKey ?? '', {
        auth: {
          // Désactive la persistance de session — inutile côté serveur
          persistSession: false,
          autoRefreshToken: false,
        },
        ...(realtimeTransport ? { realtime: { transport: realtimeTransport as unknown as never } } : {}),
      });
    }
    return Reflect.get(cachedSupabaseAdmin, prop);
  },
});
