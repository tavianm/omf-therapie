export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../lib/auth';
import { isAdminSession } from '../../../lib/authz';
import { getCreditBalance } from '../../../lib/credits';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/admin/credits?email=...
 *
 * Retourne le solde d'avoir (centimes) et l'historique des avoirs d'un patient
 * (identifié par son email, normalisé en lowercase). Admin-only.
 *
 * Sert :
 *   - à la case « Utiliser l'avoir » du formulaire de création manuelle
 *     (AdminCreateButton) pour afficher le montant disponible ;
 *   - (future) au badge d'avoir sur la page Patients.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return errorResponse(401, 'Non authentifié');
  if (!isAdminSession(session)) return errorResponse(403, 'Accès refusé');

  const emailParam = url.searchParams.get('email');
  if (!emailParam || !EMAIL_RE.test(emailParam)) {
    return errorResponse(400, 'Email invalide');
  }

  const { balance, history } = await getCreditBalance(emailParam.toLowerCase());

  return new Response(
    JSON.stringify({ balance, history }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
