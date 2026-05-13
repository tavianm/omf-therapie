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

export const pool = new Pool({
  connectionString: import.meta.env.DATABASE_URL,
  ssl: true,
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

  // ── Options avancées (cookies) ────────────────────────────────────────────
  advanced: {
    // Cookies Secure uniquement en production (HTTPS obligatoire)
    useSecureCookies: import.meta.env.PROD ?? false,
    // Cookie HttpOnly géré automatiquement par BetterAuth
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
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
  hooks: {
    before: [
      {
        matcher(context) {
          // Intercepter uniquement la route d'inscription
          return context.path === '/sign-up/email';
        },
        async handler() {
          // Vérifier si un utilisateur existe déjà dans la table "user" BetterAuth
          try {
            const result = await pool.query<{ id: string }>(
              'SELECT id FROM "user" LIMIT 1',
            );
            if (result.rowCount && result.rowCount > 0) {
              return new Response(
                JSON.stringify({
                  error: 'Inscription désactivée. Ce site n\'accepte pas de nouveaux comptes.',
                }),
                { status: 403, headers: { 'Content-Type': 'application/json' } },
              );
            }
          } catch (error) {
            console.error('[auth] Erreur lors de la vérification admin :', error);
            return new Response(
              JSON.stringify({ error: 'Erreur interne — inscription impossible.' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            );
          }
          // Aucun utilisateur → première création autorisée (script de seed)
        },
      },
    ],
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
