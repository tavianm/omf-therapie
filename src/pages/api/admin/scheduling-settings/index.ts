export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';
import {
  getSchedulingSettings,
  isSchedulingConflictError,
  updateSchedulingBuffer,
} from '../../../../lib/scheduling-settings';
import { isSchedulingBufferMinutes } from '../../../../types/scheduling-settings';
import { invalidateAvailabilityCache } from '../../../../lib/calendar-cache.js';

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requireAdmin(request: Request): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return errorResponse(401, 'Non authentifié');
  if (!isAdminSession(session)) return errorResponse(403, 'Accès refusé');
  return null;
}

export const GET: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    return new Response(
      JSON.stringify({ settings: await getSchedulingSettings() }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    console.error('[admin/scheduling-settings] lecture impossible:', error);
    return errorResponse(
      500,
      'Impossible de charger la marge entre les séances.',
    );
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: { bufferMinutes?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Corps de requête JSON invalide');
  }

  if (!isSchedulingBufferMinutes(body.bufferMinutes)) {
    return errorResponse(400, 'La marge doit être de 0, 15 ou 20 minutes.');
  }

  try {
    const settings = await updateSchedulingBuffer(body.bufferMinutes);
    await invalidateAvailabilityCache().catch(error =>
      console.error(
        '[admin/scheduling-settings] invalidation cache impossible:',
        error,
      ),
    );
    return new Response(JSON.stringify({ settings }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (isSchedulingConflictError(error)) {
      return errorResponse(
        409,
        'Cette marge chevauche des rendez-vous déjà planifiés. La valeur précédente est conservée.',
      );
    }
    console.error('[admin/scheduling-settings] mise à jour impossible:', error);
    return errorResponse(
      500,
      'Impossible d’enregistrer la marge entre les séances.',
    );
  }
};
