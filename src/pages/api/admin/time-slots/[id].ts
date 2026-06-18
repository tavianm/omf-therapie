export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';
import { updateManualSlot, deleteManualSlot, invalidateSlotCache } from '../../../../lib/manual-slots';
import type { UpdateManualSlotData } from '@/types/manual-slots';

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const PATCH: APIRoute = async ({ params, request }) => {
  // Authentication and authorization
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse(401, 'Non authentifié');
  }
  if (!isAdminSession(session)) {
    return errorResponse(403, 'Accès refusé');
  }

  const { id } = params;
  if (!id) {
    return errorResponse(400, 'Identifiant de créneau manquant');
  }

  try {
    const data = await request.json();

    // Validate period if provided
    if (data.period !== undefined) {
      const validPeriods = ['morning', 'afternoon', 'all_day'];
      if (!validPeriods.includes(data.period)) {
        return errorResponse(400, 'Period invalide (valeurs acceptées: morning, afternoon, all_day)');
      }
    }

    // Build update data object
    const updateData: UpdateManualSlotData = {};

    if (data.period !== undefined) {
      updateData.period = data.period;
    }

    if (data.deleted_at !== undefined) {
      updateData.deleted_at = data.deleted_at;
    }

    // Update the manual slot
    const slot = await updateManualSlot(id, updateData);

    // Invalidate cache
    await invalidateSlotCache();

    return new Response(JSON.stringify(slot), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[admin/time-slots/[id]] Erreur lors de la mise à jour du créneau:', error);

    // Check if it's a "not found" error from the database
    if (error instanceof Error && error.message.includes('Failed to update manual slot')) {
      return errorResponse(404, 'Créneau introuvable');
    }

    return errorResponse(500, 'Erreur lors de la mise à jour du créneau horaire');
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  // Authentication and authorization
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse(401, 'Non authentifié');
  }
  if (!isAdminSession(session)) {
    return errorResponse(403, 'Accès refusé');
  }

  const { id } = params;
  if (!id) {
    return errorResponse(400, 'Identifiant de créneau manquant');
  }

  try {
    // Delete the manual slot (soft delete)
    await deleteManualSlot(id);

    // Invalidate cache
    await invalidateSlotCache();

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[admin/time-slots/[id]] Erreur lors de la suppression du créneau:', error);

    // Check if it's a "not found" error from the database
    if (error instanceof Error && error.message.includes('Failed to delete manual slot')) {
      return errorResponse(404, 'Créneau introuvable');
    }

    return errorResponse(500, 'Erreur lors de la suppression du créneau horaire');
  }
};
