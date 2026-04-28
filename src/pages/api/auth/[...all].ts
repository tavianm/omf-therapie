/**
 * Route API catch-all pour BetterAuth v1.6.9
 *
 * Gère toutes les routes d'authentification sous /api/auth/* :
 *   POST /api/auth/sign-in/email     — connexion email + password
 *   POST /api/auth/sign-out          — déconnexion
 *   GET  /api/auth/session           — session courante
 *   POST /api/auth/sign-up/email     — inscription (bloquée via hook)
 *   ...et toutes les autres routes internes BetterAuth
 *
 * Le handler BetterAuth reçoit directement la Request Web standard et
 * retourne une Response Web standard — compatible Astro SSR / Netlify.
 */

export const prerender = false;

import { auth } from '../../../lib/auth';
import type { APIRoute } from 'astro';

export const ALL: APIRoute = async ({ request }) => {
  return auth.handler(request);
};
