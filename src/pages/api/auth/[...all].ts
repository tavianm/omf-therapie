/**
 * Route API catch-all pour BetterAuth v1.6.11
 *
 * Gère toutes les routes d'authentification sous /api/auth/* :
 *   POST /api/auth/sign-in/email  — connexion email + password
 *   POST /api/auth/sign-out       — déconnexion
 *   GET  /api/auth/get-session    — session courante
 *   POST /api/auth/sign-up/email  — inscription (bloquée via hook)
 *   ...et toutes les autres routes internes BetterAuth
 *
 * Astro trailingSlash: 'always' ajoute '/' — BetterAuth ne l'accepte pas.
 * On normalise l'URL en retirant le slash final avant de passer à BetterAuth.
 */

export const prerender = false;

import { auth } from '../../../lib/auth';
import type { APIRoute } from 'astro';

export const ALL: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  // Strip trailing slash so BetterAuth can match its own route definitions
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
    const normalized = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: 'half',
    } as RequestInit);
    return auth.handler(normalized);
  }
  return auth.handler(request);
};
