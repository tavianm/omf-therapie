/**
 * Client BetterAuth — usage côté browser (islands React / scripts client)
 *
 * Ce fichier ne contient aucun code Node.js (pg.Pool, betterAuth serveur).
 * À utiliser dans les composants React (islands) ou les scripts <script> Astro.
 *
 * Exemple :
 *   import { authClient } from '../../lib/auth.client';
 *   const { data: session } = await authClient.getSession();
 */

import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  // En browser, utiliser l'origine courante ; sinon fallback sur l'env var
  baseURL:
    typeof window !== 'undefined'
      ? window.location.origin
      : (import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr'),
});
