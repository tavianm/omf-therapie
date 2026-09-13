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
  CalendarAuthError,
  CalendarPermissionError,
  filterSlotsByBusy,
  getAvailableSlots,
  GoogleCalendarError,
  type AppointmentDuration,
  type AppointmentMode,
  type TimeSlot,
} from '@/lib/google-calendar';
import { supabaseAdmin } from '@/lib/supabase';
import { getSchedulingSettings } from '@/lib/scheduling-settings';
import type { SchedulingSettings } from '@/types/scheduling-settings';
import {
  BLOCKING_STATUSES,
  VALID_DURATIONS,
  VALID_MODES,
} from '@/utils/domain';
import {
  getCachedAvailability,
  setCachedAvailability,
  buildAvailabilityCacheKey,
} from '../../lib/calendar-cache.js';

// Désactiver le pré-rendu : cette route est toujours dynamique (SSR)
export const prerender = false;

// ---------------------------------------------------------------------------
// Constantes de validation
// ---------------------------------------------------------------------------

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
  const [appointmentsResult, schedulingSettings] = await Promise.all([
    supabaseAdmin
      .from('appointments')
      .select(
        'status, duration, scheduled_at, scheduled_end, blocked_until, rescheduled_to',
      )
      .in('status', BLOCKING_STATUSES)
      .is('deleted_at', null)
      .or(
        [
          `and(scheduled_at.gte.${from.toISOString()},scheduled_at.lte.${to.toISOString()})`,
          `and(rescheduled_to.gte.${from.toISOString()},rescheduled_to.lte.${to.toISOString()})`,
        ].join(','),
      ),
    // Même dégradation gracieuse que la branche appointments ci-dessous : un
    // échec settings (ex. migration 015 non appliquée) ne doit pas faire
    // tomber toute la liste de créneaux — repli sur marge nulle.
    getSchedulingSettings().catch(
      (error): SchedulingSettings => {
        console.error(
          '[api/availability] Erreur scheduling settings (repli marge 0) :',
          error instanceof Error ? error.message : error,
        );
        return { bufferMinutes: 0, updatedAt: new Date(0).toISOString() };
      },
    ),
  ]);

  const { data, error } = appointmentsResult;

  if (error) {
    console.error('[api/availability] Erreur DB busy periods :', error.message);
    return []; // dégradation gracieuse — pas pire qu'avant ce fix (AC-5)
  }

  return (data ?? []).flatMap(row => {
    if (typeof row.duration !== 'number') return [];

    // Pour un RDV reporté en attente, les DEUX fenêtres restent réservées :
    // le créneau d'origine (scheduled_at → blocked_until) tant que le patient
    // n'a pas accepté, et la proposition (rescheduled_to). Le trigger 015
    // refuse un chevauchement sur l'une ou l'autre — l'offre de créneaux doit
    // refléter les deux, sinon le patient choisit un créneau affiché libre
    // et reçoit un 409 au submit.
    if (
      row.status === 'rescheduled' &&
      typeof row.rescheduled_to === 'string'
    ) {
      const windows: Array<{ start: string; end: string }> = [];
      if (
        typeof row.scheduled_at === 'string' &&
        typeof row.blocked_until === 'string'
      ) {
        windows.push({ start: row.scheduled_at, end: row.blocked_until });
      }
      const start = new Date(row.rescheduled_to);
      const end = new Date(
        start.getTime() +
          (row.duration + schedulingSettings.bufferMinutes) * 60 * 1000,
      );
      windows.push({ start: start.toISOString(), end: end.toISOString() });
      return windows;
    }

    if (
      typeof row.scheduled_at !== 'string' ||
      typeof row.blocked_until !== 'string'
    ) {
      return [];
    }
    return [{ start: row.scheduled_at, end: row.blocked_until }];
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(message: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Même rationale que jsonSuccess : aucune réponse d'erreur ne doit
      // être mise en cache (CDN ni navigateur).
      'Cache-Control': 'no-store',
      ...headers,
    },
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

// filterSlotsByBusy vit dans src/lib/google-calendar.ts (export partagé,
// issue #153) et est réutilisée telle quelle ici — plus de copie locale.

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
    const cacheKey = buildAvailabilityCacheKey(mode, duration, weeks, now);
    const dbBusy = await fetchDbBusyPeriods(now, endDate);
    const cached = await getCachedAvailability(cacheKey);
    if (cached) {
      // Always re-apply live DB busy periods to avoid stale overlaps
      // if cache invalidation failed in a previous mutation.
      return jsonSuccess(filterSlotsByBusy(cached, dbBusy));
    }

    const slots = await getAvailableSlots(now, endDate, duration, mode, dbBusy);

    // Zéro écriture vide (issue #153 / SC5) : getAvailableSlots lève une
    // erreur typée de stage partagé sur tout échec amont, cette écriture ne
    // voit donc que des créneaux réellement calculés. Un échec d'écriture
    // reste NON fatal mais n'est plus silencieux (SC6) : log, réponse
    // inchangée.
    const writeResult = await setCachedAvailability(cacheKey, slots).catch(
      (err: unknown): 'failed' => {
        // Ce catch est défensif (setCachedAvailability résout sur tous ses
        // chemins aujourd'hui) : si un jour il tire, le rejet est signalé —
        // classification fixe uniquement, le message brut d'une erreur
        // pourrait embarquer du contenu sensible (même règle que
        // calendar-cache, revue #154).
        console.error(
          "[api/availability] Rejet inattendu de la promesse d'écriture cache (non fatale) :",
          err instanceof Error ? err.name : 'unknown',
        );
        return 'failed' as const;
      },
    );
    if (writeResult === 'failed') {
      console.error(
        "[api/availability] Échec de l'écriture du cache de disponibilités (non fatale) :",
        cacheKey,
      );
    }

    return jsonSuccess(slots);
  } catch (err: unknown) {
    if (err instanceof GoogleCalendarError) {
      // Cause sanitisée : seuls les champs de classification circulent dans
      // le log — le payload brut de err.cause peut embarquer des secrets
      // OAuth (GaxiosError.config porte l'en-tête Authorization).
      const cause = err.cause as Record<string, unknown> | undefined;
      console.error(
        '[api/availability] GoogleCalendarError :',
        err.message,
        typeof cause === 'object' && cause !== null
          ? { googleErrorCode: cause.googleErrorCode, status: cause.status }
          : undefined,
      );
      if (
        err instanceof CalendarAuthError ||
        err instanceof CalendarPermissionError
      ) {
        // Non transitoire : l'admin doit re-autoriser / corriger les
        // permissions — un 503 « réessayez » induirait le patient en erreur.
        // Message patient générique : aucun état OAuth ne fuite.
        return jsonError(
          'Une erreur interne est survenue. Veuillez réessayer ultérieurement.',
          500,
        );
      }
      // Transitoire (quota, réseau, échec de stage partagé) : 503 + Retry-After.
      return jsonError(
        'Le service de disponibilités est temporairement indisponible.',
        503,
        { 'Retry-After': '60' },
      );
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
