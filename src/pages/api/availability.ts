/**
 * GET /api/availability
 *
 * Retourne les créneaux disponibles pour la prise de rendez-vous sur
 * les N prochaines semaines en interrogeant Google Calendar Freebusy.
 *
 * Query params :
 *   - mode      : "in-person" | "video"  (obligatoire)
 *   - duration  : "60" | "90"            (obligatoire, en minutes)
 *   - weeks     : "1"–"8"               (optionnel, défaut 4)
 */

import type { APIRoute } from 'astro';
import {
  getAvailableSlots,
  GoogleCalendarError,
  type AppointmentDuration,
  type AppointmentMode,
  type TimeSlot,
} from '@/lib/google-calendar';
import { supabaseAdmin } from '@/lib/supabase';

// Désactiver le pré-rendu : cette route est toujours dynamique (SSR)
export const prerender = false;

// ---------------------------------------------------------------------------
// Constantes de validation
// ---------------------------------------------------------------------------

const VALID_MODES: ReadonlySet<string> = new Set<AppointmentMode>([
  'in-person',
  'video',
]);

const VALID_DURATIONS: ReadonlySet<number> = new Set<AppointmentDuration>([
  60,
  90,
]);

const BLOCKING_STATUSES = [
  'pending',
  'confirmed',
  'payment_pending',
  'payment_received',
  'rescheduled',
] as const;

const MIN_WEEKS = 1;
const MAX_WEEKS = 8;
const DEFAULT_WEEKS = 4;

// ---------------------------------------------------------------------------
// DB busy periods
// ---------------------------------------------------------------------------

async function fetchDbBusyPeriods(
  from: Date,
  to: Date,
): Promise<Array<{ start: string; end: string }>> {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('scheduled_at, scheduled_end')
    .in('status', BLOCKING_STATUSES)
    .is('deleted_at', null)
    .gte('scheduled_at', from.toISOString())
    .lte('scheduled_at', to.toISOString());

  if (error) {
    console.error('[api/availability] Erreur DB busy periods :', error.message);
    return []; // dégradation gracieuse — pas pire qu'avant ce fix (AC-5)
  }

  return (data ?? [])
    .filter(
      (row): row is { scheduled_at: string; scheduled_end: string } =>
        typeof row.scheduled_at === 'string' &&
        typeof row.scheduled_end === 'string',
    )
    .map((row) => ({ start: row.scheduled_at, end: row.scheduled_end }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonSuccess(slots: TimeSlot[]): Response {
  return new Response(JSON.stringify({ slots }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Pas de cache : les disponibilités changent en temps réel
      'Cache-Control': 'no-store',
    },
  });
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  // --- Validation du paramètre `mode` ---
  const rawMode = params.get('mode');
  if (!rawMode) {
    return jsonError(
      'Paramètre manquant : "mode" est obligatoire ("in-person" ou "video").',
      400,
    );
  }
  if (!VALID_MODES.has(rawMode)) {
    return jsonError(
      `Valeur invalide pour "mode" : "${rawMode}". Valeurs acceptées : "in-person", "video".`,
      400,
    );
  }
  const mode = rawMode as AppointmentMode;

  // --- Validation du paramètre `duration` ---
  const rawDuration = params.get('duration');
  if (!rawDuration) {
    return jsonError(
      'Paramètre manquant : "duration" est obligatoire (60 ou 90).',
      400,
    );
  }
  const parsedDuration = parseInt(rawDuration, 10);
  if (isNaN(parsedDuration) || !VALID_DURATIONS.has(parsedDuration)) {
    return jsonError(
      `Valeur invalide pour "duration" : "${rawDuration}". Valeurs acceptées : 60, 90.`,
      400,
    );
  }
  const duration = parsedDuration as AppointmentDuration;

  // --- Validation du paramètre `weeks` (optionnel) ---
  const rawWeeks = params.get('weeks');
  let weeks = DEFAULT_WEEKS;
  if (rawWeeks !== null) {
    const parsedWeeks = parseInt(rawWeeks, 10);
    if (
      isNaN(parsedWeeks) ||
      parsedWeeks < MIN_WEEKS ||
      parsedWeeks > MAX_WEEKS
    ) {
      return jsonError(
        `Valeur invalide pour "weeks" : "${rawWeeks}". Valeur attendue entre ${MIN_WEEKS} et ${MAX_WEEKS}.`,
        400,
      );
    }
    weeks = parsedWeeks;
  }

  // --- Calcul de la plage de dates ---
  const now = new Date();
  const endDate = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  // --- Appel Google Calendar (+ DB busy periods en parallèle) ---
  try {
    const dbBusyPromise = fetchDbBusyPeriods(now, endDate);
    const dbBusy = await dbBusyPromise;
    const slots = await getAvailableSlots(now, endDate, duration, mode, dbBusy);
    return jsonSuccess(slots);
  } catch (err: unknown) {
    if (err instanceof GoogleCalendarError) {
      // Erreur métier Google Calendar (quota, config, permissions)
      console.error('[api/availability] GoogleCalendarError :', err.message, err.cause);
      return jsonError('Le service de disponibilités est temporairement indisponible.', 503);
    }

    // Erreur inattendue
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/availability] Erreur inattendue :', message);
    return jsonError(
      'Une erreur interne est survenue. Veuillez réessayer ultérieurement.',
      500,
    );
  }
};
