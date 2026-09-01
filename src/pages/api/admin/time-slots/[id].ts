export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';
import {
  updateManualSlot,
  deleteManualSlot,
  invalidateSlotCache,
  ManualSlotDuplicateError,
  ManualSlotNotFoundError,
} from '../../../../lib/manual-slots';
import type { UpdateManualSlotData } from '@/types/manual-slots';
import { VALID_PERIODS } from '@/utils/domain';

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
      if (!VALID_PERIODS.includes(data.period)) {
        return errorResponse(
          400,
          'Period invalide (valeurs acceptées: morning, afternoon, all_day)',
        );
      }
    }

    // Build update data object
    const updateData: UpdateManualSlotData = {};

    if (data.period !== undefined) {
      updateData.period = data.period;
    }

    if (data.deleted_at !== undefined) {
      // Only null (restoration) or an ISO 8601 date string may reach the DB.
      if (
        data.deleted_at !== null &&
        (typeof data.deleted_at !== 'string' ||
          Number.isNaN(Date.parse(data.deleted_at)))
      ) {
        return errorResponse(
          400,
          'Valeur invalide pour deleted_at (null ou date ISO attendue)',
        );
      }
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
    console.error(
      '[admin/time-slots/[id]] Erreur lors de la mise à jour du créneau:',
      error,
    );

    if (error instanceof ManualSlotDuplicateError) {
      return errorResponse(409, error.message);
    }
    if (error instanceof ManualSlotNotFoundError) {
      return errorResponse(404, 'Créneau introuvable');
    }

    return errorResponse(
      500,
      'Erreur lors de la mise à jour du créneau horaire',
    );
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

    return new Response(JSON.stringify({ deleted: true, id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(
      '[admin/time-slots/[id]] Erreur lors de la suppression du créneau:',
      error,
    );

    if (error instanceof ManualSlotNotFoundError) {
      return errorResponse(404, 'Créneau introuvable');
    }

    return errorResponse(
      500,
      'Erreur lors de la suppression du créneau horaire',
    );
  }
};
