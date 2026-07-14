/**
 * Configuration BetterAuth v1.6.9 pour OMF Thérapie — module SERVEUR uniquement
 *
 * Ce fichier ne doit jamais être importé dans des composants React (islands).
 * Pour le client browser, utiliser auth.client.ts.
 */

import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Pool PostgreSQL partagé (BetterAuth + hook anti-inscription)
// ---------------------------------------------------------------------------

const databaseUrl = import.meta.env.DATABASE_URL;
const isLocal = databaseUrl?.includes('localhost') || databaseUrl?.includes('127.0.0.1');

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isLocal
    ? false
    : (() => {
        const ca = import.meta.env.SUPABASE_CA_CERT;
        if (!ca) {
          // AC7 fail-closed: refuse to start the pool rather than silently downgrading
          // to the default Mozilla CA bundle. Node treats `ca: undefined` as "omitted"
          // (falls back to public roots), so returning it would NOT fail the handshake —
          // throwing at module load makes a misconfigured deploy 5xx immediately and
          // diagnosably. Required on this patient-data (RGPD) path.
          const message =
            'SUPABASE_CA_CERT is not set — cannot enable TLS verification on the DB pool. ' +
            'Set the Supabase root CA in the Netlify dashboard (per-env: production + deploy-preview).';
          console.error(message);
          throw new Error(message);
        }
        return { ca, rejectUnauthorized: true };
      })(),
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

// ---------------------------------------------------------------------------
// Instance BetterAuth — configuration serveur
// ---------------------------------------------------------------------------

export const auth = betterAuth({
  // ── Connexion PostgreSQL (Supabase) ──────────────────────────────────────
  // BetterAuth v1.x détecte automatiquement un pg.Pool (via "connect" in db)
  // et l'encapsule dans un PostgresDialect Kysely.
  // DATABASE_URL = connection string Supabase PostgreSQL (pooler ou direct)
  database: pool,

  // ── Authentification par email + mot de passe ────────────────────────────
  emailAndPassword: {
    enabled: true,
    // Pas d'envoi d'email de vérification : l'admin est créé manuellement
    requireEmailVerification: false,
  },

  // ── Sécurité ─────────────────────────────────────────────────────────────
  secret: import.meta.env.BETTER_AUTH_SECRET,
  baseURL: import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr',

  trustedOrigins: [
    import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr',
    'http://localhost:4321',
    'http://127.0.0.1:4321',
  ],

  // ── Session ──────────────────────────────────────────────────────────────
  session: {
    // Durée de vie de la session : 7 jours (en secondes)
    expiresIn: 60 * 60 * 24 * 7,
    // Renouvellement automatique si la session a plus d'1 jour
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7,
    },
  },

  // ── Options avancées (cookies + résolution IP) ─────────────────────────────
  advanced: {
    // Cookies Secure uniquement en production (HTTPS obligatoire)
    useSecureCookies: import.meta.env.PROD ?? false,
    // Cookie HttpOnly géré automatiquement par BetterAuth
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
    },
    // Résolution de l'IP client pour le rate-limiting BetterAuth.
    // Par défaut BetterAuth ne lit que 'x-forwarded-for', souvent absent ou
    // peu fiable derrière Netlify Functions → getIp() renvoie null → fallback
    // sur un bucket partagé unique (WARN de prod + risque de DoS accidentel :
    // 5 tentatives par n'importe qui bloquent tous les autres utilisateurs).
    // 'x-nf-client-connection-ip' est défini exclusivement par l'infra Netlify
    // (non falsifiable par le client) — même header utilisé dans contact.ts et
    // appointments/index.ts. La liste est parcourue dans l'ordre.
    ipAddress: {
      ipAddressHeaders: ['x-nf-client-connection-ip', 'x-forwarded-for'],
    },
  },

  // ── Rate limiting (protection brute force sur /sign-in/email) ────────────
  // 5 tentatives par fenêtre de 10 minutes — renvoie 429 au-delà.
  rateLimit: {
    enabled: true,
    window: 10 * 60, // 10 minutes (secondes)
    max: 5,          // tentatives maximum par fenêtre
  },

  // ── Hook : bloquer toute inscription supplémentaire ───────────────────────
  // Un seul compte admin est autorisé. Tout appel à /sign-up/email est rejeté
  // si un utilisateur existe déjà en base. L'admin est créé via script CLI.
  //
  // BetterAuth v1.6.11 : hooks.before = single function (not array of {matcher,handler}).
  hooks: {
    before: async (context) => {
      // better-auth v1.6.23 (declared ^1.6.11): MiddlewareInputContext does not
      // expose `.path` or `.context.adapter` on its public type, but the runtime
      // fields are present (see better-auth hooks/middleware docs). Narrow-cast
      // to access them safely; if a future bump exposes these on the public type,
      // drop the cast.
      const ctx = context as unknown as {
        path: string;
        context: {
          adapter: {
            findMany: (opts: { model: string; limit: number }) => Promise<unknown[]>;
          };
        };
      };
      // Only intercept the sign-up route
      if (ctx.path !== '/sign-up/email') return;

      // Use BetterAuth's internal adapter (same DB connection as all other operations).
      // Avoids a separate pg.Pool connection that may fail in serverless environments
      // when DATABASE_URL uses a direct Supabase host instead of the pooler.
      try {
        const users = await ctx.context.adapter.findMany({
          model: 'user',
          limit: 1,
        });
        if (users.length > 0) {
          return new Response(
            JSON.stringify({
              error: 'Inscription désactivée. Ce site n\'accepte pas de nouveaux comptes.',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          );
        }
      } catch (error) {
        console.error('[auth] Erreur lors de la vérification admin :', error);
        // Fail open: if we cannot query the DB, let BetterAuth proceed —
        // it will fail on its own DB operations if the database is truly unreachable.
        return;
      }
      // Aucun utilisateur → première création autorisée (script de seed)
    },
  },
});

// ---------------------------------------------------------------------------
// Types exportés pour usage dans les composants Astro / API routes
// ---------------------------------------------------------------------------

/**
 * Type de session BetterAuth inféré depuis la configuration.
 * Usage : `const session: Session = await auth.api.getSession(...)`
 */
export type Session = typeof auth.$Infer.Session;

/**
 * Type utilisateur BetterAuth inféré depuis la session.
 * Usage : `const user: User = session.user`
 */
export type User = typeof auth.$Infer.Session.user;
