/**
 * Configuration BetterAuth v1.6.9 pour OMF Thérapie
 *
 * Dépendance à installer :
 *   pnpm add better-auth@1.6.9
 *
 * Variables d'env requises :
 *   BETTER_AUTH_SECRET  — chaîne secrète aléatoire (min 32 chars)
 *   BETTER_AUTH_URL     — URL de base du site (ex: https://omf-therapie.fr)
 *   ADMIN_EMAIL         — email de l'admin unique (utilisé par le script CLI de seed)
 *
 * Architecture : un seul compte admin (la thérapeute).
 * L'inscription publique est bloquée via un hook `before` sur /sign-up/email.
 * La création du compte admin se fait via le script `scripts/seed-admin.ts`.
 */

// NOTE: `better-auth` n'est pas encore installé. Ajouter via :
//   pnpm add better-auth@1.6.9

import { betterAuth } from 'better-auth';
import { supabaseAdapter } from 'better-auth/adapters/supabase';
import { createAuthClient } from 'better-auth/client';

import { supabaseAdmin } from './supabase';

// ---------------------------------------------------------------------------
// Instance BetterAuth — configuration serveur
// ---------------------------------------------------------------------------

export const auth = betterAuth({
  // ── Adapteur de base de données ──────────────────────────────────────────
  // BetterAuth v1.x avec Supabase : l'adapter lit/écrit directement dans les
  // tables gérées par BetterAuth (user, session, account, verification).
  // Ces tables sont créées via `npx better-auth migrate` ou le schéma SQL
  // fourni dans la doc BetterAuth.
  database: supabaseAdapter(supabaseAdmin, {
    // BetterAuth génère ses propres UUIDs — désactiver si Supabase génère les IDs
    generateId: false,
  }),

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
        async handler(_context) {
          // Vérifier si un utilisateur existe déjà dans la table `user`
          // gérée par BetterAuth (table distincte des tables Supabase auth.*).
          const { data, error } = await supabaseAdmin
            .from('user') // Table BetterAuth — pas auth.users de Supabase
            .select('id')
            .limit(1)
            .maybeSingle();

          if (error) {
            // En cas d'erreur DB, on refuse par sécurité
            console.error('[auth] Erreur lors de la vérification admin :', error);
            return new Response(
              JSON.stringify({ error: 'Erreur interne — inscription impossible.' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            );
          }

          if (data) {
            // Un utilisateur existe déjà → inscription bloquée
            return new Response(
              JSON.stringify({
                error: 'Inscription désactivée. Ce site n\'accepte pas de nouveaux comptes.',
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } },
            );
          }

          // Aucun utilisateur → première création autorisée (script de seed)
          // On laisse BetterAuth continuer normalement
        },
      },
    ],
  },
});

// ---------------------------------------------------------------------------
// Client BetterAuth — usage côté browser (islands React / scripts client)
// ---------------------------------------------------------------------------

/**
 * authClient : instance côté client BetterAuth.
 * À utiliser dans les composants React (islands) ou les scripts <script> Astro.
 *
 * Exemple :
 *   import { authClient } from '../../lib/auth';
 *   const { data: session } = await authClient.getSession();
 */
export const authClient = createAuthClient({
  // En browser, utiliser l'origine courante ; sinon fallback sur l'env var
  baseURL:
    typeof window !== 'undefined'
      ? window.location.origin
      : (import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr'),
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
