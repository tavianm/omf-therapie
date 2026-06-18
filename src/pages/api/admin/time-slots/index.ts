export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';
import { fetchManualSlots, createManualSlot, invalidateSlotCache } from '../../../../lib/manual-slots';
import type { CreateManualSlotData } from '@/types/manual-slots';

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  // Authentication and authorization
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse(401, 'Non authentifié');
  }
  if (!isAdminSession(session)) {
    return errorResponse(403, 'Accès refusé');
  }

  // Parse query parameters
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  // Validate required parameters
  if (!fromParam || !toParam) {
    return errorResponse(400, 'Les paramètres from et to sont requis');
  }

  // Parse dates
  const from = new Date(fromParam);
  const to = new Date(toParam);

  // Validate dates
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return errorResponse(400, 'Format de date invalide');
  }

  if (from > to) {
    return errorResponse(400, 'La date from doit être antérieure à la date to');
  }

  try {
    const slots = await fetchManualSlots(from, to);

    return new Response(JSON.stringify({ slots }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[admin/time-slots] Erreur lors de la récupération des créneaux:', error);
    return errorResponse(500, 'Erreur lors de la récupération des créneaux horaires');
  }
};

export const POST: APIRoute = async ({ request }) => {
  // Authentication and authorization
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse(401, 'Non authentifié');
  }
  if (!isAdminSession(session)) {
    return errorResponse(403, 'Accès refusé');
  }

  try {
    const data = await request.json();

    // Validate required fields
    if (!data.slot_date || !data.period) {
      return errorResponse(400, 'Les champs slot_date et period sont requis');
    }

    // Validate slot_date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.slot_date)) {
      return errorResponse(400, 'Format de date invalide (attendu: YYYY-MM-DD)');
    }

    // Validate period value
    const validPeriods = ['morning', 'afternoon', 'all_day'];
    if (!validPeriods.includes(data.period)) {
      return errorResponse(400, 'Period invalide (valeurs acceptées: morning, afternoon, all_day)');
    }

    // Create slot data object
    const slotData: CreateManualSlotData = {
      slot_date: data.slot_date,
      period: data.period,
    };

    // Create the manual slot
    const slot = await createManualSlot(slotData);

    // Invalidate cache
    await invalidateSlotCache();

    return new Response(JSON.stringify(slot), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[admin/time-slots] Erreur lors de la création du créneau:', error);
    return errorResponse(500, 'Erreur lors de la création du créneau horaire');
  }
};
