/**
 * Google Calendar API wrapper (OAuth utilisateur)
 *
 * Gère la génération des créneaux candidats et la vérification
 * de disponibilité via l'API Freebusy de Google Calendar.
 */

import { google, type Auth, type calendar_v3 } from 'googleapis';
import { supabaseAdmin } from './supabase.js';
import { sendEmail } from './resend.js';
import { fetchManualSlots } from './manual-slots.js';
import type { Period } from '@/types/manual-slots';
import {
  DAY_HALF_PERIODS,
  DAY_HALVES,
  cabinetEligibility,
  type DayHalf,
} from './appointment-eligibility.js';

// ---------------------------------------------------------------------------
// Erreur typée
// ---------------------------------------------------------------------------

export class GoogleCalendarError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GoogleCalendarError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Typed subclasses
// ---------------------------------------------------------------------------

export class CalendarAuthError extends GoogleCalendarError {
  readonly type = 'CalendarAuthError' as const;
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarAuthError'; }
}

export class CalendarPermissionError extends GoogleCalendarError {
  readonly type = 'CalendarPermissionError' as const;
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarPermissionError'; }
}

export class CalendarQuotaError extends GoogleCalendarError {
  readonly type = 'CalendarQuotaError' as const;
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarQuotaError'; }
}

export class CalendarNetworkError extends GoogleCalendarError {
  readonly type = 'CalendarNetworkError' as const;
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarNetworkError'; }
}

// ---------------------------------------------------------------------------
// Error parser + retry helper
// ---------------------------------------------------------------------------

function parseGoogleError(err: unknown): GoogleCalendarError {
  const asRecord = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
  const responseStatus = asRecord?.['response'] != null
    ? (asRecord['response'] as Record<string, unknown>)['status']
    : undefined;
  const status = responseStatus ?? asRecord?.['code'];
  if (status === 401) return new CalendarAuthError('Authentication failed', err);
  if (status === 403) return new CalendarPermissionError('Calendar access denied', err);
  if (status === 429) return new CalendarQuotaError('Google API quota exceeded', err);
  return new CalendarNetworkError('Calendar API error', err);
}

export async function withCalendarRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: GoogleCalendarError = new CalendarNetworkError('Unknown error');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const parsed = parseGoogleError(err);
      lastError = parsed;
      // No retry for auth/permission errors
      if (parsed instanceof CalendarAuthError || parsed instanceof CalendarPermissionError) {
        throw parsed;
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface TimeSlot {
  /** ISO 8601 – heure de début */
  start: string;
  /** ISO 8601 – heure de fin */
  end: string;
  /** true si le créneau n'est pas bloqué dans Google Calendar */
  available: boolean;
}

export type AppointmentMode = 'in-person' | 'video';
export type AppointmentDuration = 60 | 90;

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

const MOCK_MODE = import.meta.env.GOOGLE_CALENDAR_MOCK === 'true';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TIMEZONE = 'Europe/Paris';

/** Délai minimum avant un créneau proposable (24h en ms) */
const MIN_NOTICE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Authentification Google
// ---------------------------------------------------------------------------


/**
 * Returns a configured OAuth2Client with a valid access token, persisting
 * token rotation in the `google_oauth_tokens` Supabase table.
 * Falls back to bootstrapping from env vars on first run.
 */
async function getPersistedOAuthClient(): Promise<Auth.OAuth2Client | null> {
  const clientId = import.meta.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = import.meta.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const redirectUri = import.meta.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'https://developers.google.com/oauthplayground';
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // 1. Load persisted tokens from DB
  let { data: tokens } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('*')
    .eq('id', 'therapist')
    .single();

  if (!tokens) {
    // 2. Bootstrap from env vars on first run
    const refreshToken = import.meta.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    if (!refreshToken) return null;

    tokens = {
      id: 'therapist',
      access_token: '',
      refresh_token: refreshToken,
      expiry_date: 0, // Forces immediate refresh below
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await supabaseAdmin.from('google_oauth_tokens').upsert(tokens);
  }

  // 3. Proactive refresh: refresh if token expires within 5 minutes
  if (!tokens.expiry_date || tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const updated = {
        access_token: credentials.access_token ?? '',
        // Persist rotated refresh_token if Google returns one (token rotation policy)
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date: credentials.expiry_date ?? (Date.now() + 3600 * 1000),
        updated_at: new Date().toISOString(),
      };
      await supabaseAdmin
        .from('google_oauth_tokens')
        .update(updated)
        .eq('id', 'therapist');
      oauth2Client.setCredentials(credentials);
      return oauth2Client;
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { error?: string } } })?.response?.data;
      if (errData?.error === 'invalid_grant') {
        // AC-3: alert admin — fire and forget (don't block the throw)
        const adminEmail = import.meta.env.ADMIN_EMAIL as string | undefined;
        const siteUrl = import.meta.env.SITE_URL ?? 'https://omf-therapie.fr';
        if (adminEmail) {
          const { createElement } = await import('react');
          const { default: CalendarAuthAlert } = await import('../emails/CalendarAuthAlert');
          sendEmail({
            to: adminEmail,
            subject: '⚠️ Google Calendar — re-autorisation requise',
            react: createElement(CalendarAuthAlert, { reauthorizeUrl: `${siteUrl}/api/admin/google-oauth` }),
          }).catch((e: unknown) => console.error('[calendar] Alert email failed:', e instanceof Error ? e.message : e));
        }
        // Store only the safe error code — do NOT pass raw err (GaxiosError may
        // carry client_secret / refresh_token in response.config.data)
        throw new CalendarAuthError(
          'OAuth consent revoked — re-authorize via Google Cloud Console',
          { googleErrorCode: errData.error },
        );
      }
      throw new CalendarNetworkError(
        'Token refresh failed',
        { status: (err as { response?: { status?: number } })?.response?.status },
      );
    }
  }

  // 4. Token is still valid — use as-is
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });
  return oauth2Client;
}

async function resolveCalendarAuth(): Promise<Auth.OAuth2Client> {
  const oauth = await getPersistedOAuthClient();
  if (oauth) return oauth;

  throw new GoogleCalendarError(
    'Configuration Google Calendar manquante : configurez OAuth (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN).',
  );
}

// ---------------------------------------------------------------------------
// Helpers de manipulation de dates (sans dépendance lourde)
// ---------------------------------------------------------------------------

/**
 * Hoisted Intl formatters — allocated once, reused across every slot.
 *
 * Performance: Intl.DateTimeFormat construction is the dominant cost in the
 * slot-generation loop (previously ~1 allocation per candidate slot). Module
 * singletons make formatting ~constant-time and keep a 4-week generation
 * under a few milliseconds.
 */
const PARIS_PARTS_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const PARIS_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  weekday: 'short',
});

/**
 * Retourne l'heure locale Paris pour une Date UTC en tant qu'objet
 * { year, month (1-12), day (1-31), hour, minute }
 */
function toParisLocalParts(date: Date) {
  const parts = Object.fromEntries(
    PARIS_PARTS_FORMATTER.formatToParts(date).map((p) => [p.type, p.value]),
  );

  // fr-FR with hour12:false can emit "24" at midnight — normalise to 0.
  const rawHour = parseInt(parts['hour']!, 10);
  const hour = rawHour === 24 ? 0 : rawHour;

  return {
    year: parseInt(parts['year']!, 10),
    month: parseInt(parts['month']!, 10),
    day: parseInt(parts['day']!, 10),
    hour,
    minute: parseInt(parts['minute']!, 10),
  };
}

/**
 * Construit un objet Date UTC correspondant à une heure locale Paris donnée.
 * Utilise l'API Intl pour gérer automatiquement heure d'été / heure d'hiver.
 */
function parisLocalToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // On construit une date ISO sans timezone et on la parse via un trick Intl
  // La méthode la plus fiable est d'utiliser toLocaleString avec un test
  // d'aller-retour pour déterminer l'offset Paris à cette date précise.
  const candidate = new Date(
    Date.UTC(year, month - 1, day, hour, minute),
  );

  // Récupère l'heure locale Paris de ce candidat UTC
  const local = toParisLocalParts(candidate);
  const diffHours = hour - local.hour;
  const diffMinutes = minute - local.minute;

  return new Date(
    Date.UTC(year, month - 1, day, hour + diffHours, minute + diffMinutes),
  );
}

/**
 * Retourne le numéro de jour ISO (1=lundi, …, 7=dimanche) en heure Paris.
 */
function getParisISOWeekday(date: Date): number {
  const wd = PARIS_WEEKDAY_FORMATTER.format(date);
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[wd] ?? 7;
}

/**
 * Retourne minuit UTC du jour Paris correspondant à `date`.
 */
function startOfParisDay(date: Date): Date {
  const { year, month, day } = toParisLocalParts(date);
  return parisLocalToUTC(year, month, day, 0, 0);
}

/**
 * Formate une date au format YYYY-MM-DD (heure locale Paris)
 */
function formatDate(date: Date): string {
  const { year, month, day } = toParisLocalParts(date);
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Génération des créneaux candidats
// ---------------------------------------------------------------------------

// La règle d'éligibilité cabinet (DayHalf, DAY_HALF_PERIODS, DAY_HALVES,
// cabinetEligibility) vit dans `appointment-eligibility.ts` et est réutilisée
// par les portes de validation de prise de rendez-vous.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GenerateSlotsInput {
  startDate: Date;
  endDate: Date;
  duration: AppointmentDuration;
  mode: AppointmentMode;
  /** Référence "maintenant" — injectée pour la testabilité (délai 24h). */
  now: Date;
  /** Slots manuels indexés par date (YYYY-MM-DD) → périodes couvertes. */
  manualSlots: Map<string, Set<Period>>;
}

/**
 * Génère les créneaux candidats sur une plage de dates.
 *
 * Fonction pure (sans I/O, sans Date.now()) — entièrement déterministe via
 * `now` et `manualSlots`. C'est le cœur testable de la génération : la couche
 * async `generateCandidateSlots` se contente d'hydrater `manualSlots` depuis
 * Supabase puis de déléguer ici.
 *
 * Règle d'éligibilité (additive, visio = inverse du cabinet) :
 *   in-person → périodes cabinet-eligibles
 *   video     → périodes cabinet-inéligibles (l'inverse)
 */
export function generateSlotsForRange(input: GenerateSlotsInput): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const minStart = new Date(input.now.getTime() + MIN_NOTICE_MS);

  let currentDay = startOfParisDay(input.startDate);

  while (currentDay < input.endDate) {
    const weekday = getParisISOWeekday(currentDay);

    // Jours ouvrés uniquement (lundi–vendredi)
    if (weekday >= 1 && weekday <= 5) {
      const isWednesday = weekday === 3;
      const dateKey = formatDate(currentDay);
      const manualPeriods = input.manualSlots.get(dateKey) ?? EMPTY_PERIOD_SET;
      const cabinet = cabinetEligibility(isWednesday, manualPeriods);

      const { year, month, day } = toParisLocalParts(currentDay);

      for (const half of DAY_HALVES) {
        const isCabinet = cabinet[half];
        // in-person = cabinet ; video = inverse du cabinet
        const eligible = input.mode === 'in-person' ? isCabinet : !isCabinet;
        if (!eligible) continue;

        slots.push(...generatePeriodSlots(year, month, day, half, input.duration, minStart));
      }
    }

    currentDay = new Date(currentDay.getTime() + DAY_MS);
  }

  return slots;
}

const EMPTY_PERIOD_SET: Set<Period> = new Set();
const EMPTY_PERIOD_MAP: Map<string, Set<Period>> = new Map();

/**
 * Génère les créneaux de 30 min d'une demi-journée, bornés à la plage et au
 * délai minimum de 24h.
 */
function generatePeriodSlots(
  year: number,
  month: number,
  day: number,
  half: DayHalf,
  duration: AppointmentDuration,
  minStart: Date,
): TimeSlot[] {
  const { startHour, endHour } = DAY_HALF_PERIODS[half];
  const periodEndMinutes = endHour * 60;
  const out: TimeSlot[] = [];

  let slotHour = startHour;
  let slotMinute = 0;

  for (;;) {
    const slotStart = parisLocalToUTC(year, month, day, slotHour, slotMinute);
    const slotEndDate = new Date(slotStart.getTime() + duration * 60 * 1000);

    // La fin doit rester dans la même plage (pas de débordement sur la pause
    // midi ni après 19h) — les créneaux suivants déborderaient aussi.
    const endLocal = toParisLocalParts(slotEndDate);
    const slotEndMinutes = endLocal.hour * 60 + endLocal.minute;
    if (slotEndMinutes > periodEndMinutes) break;

    if (slotStart >= minStart) {
      out.push({
        start: slotStart.toISOString(),
        end: slotEndDate.toISOString(),
        available: true, // mis à jour par getAvailableSlots (freebusy)
      });
    }

    // Avance de 30 min
    slotMinute += 30;
    if (slotMinute >= 60) {
      slotMinute -= 60;
      slotHour += 1;
    }
    if (slotHour * 60 + slotMinute >= periodEndMinutes) break;
  }

  return out;
}

/**
 * Wrapper async : hydrate les slots manuels depuis Supabase puis délègue à la
 * fonction pure `generateSlotsForRange`.
 */
export async function generateCandidateSlots(
  startDate: Date,
  endDate: Date,
  duration: AppointmentDuration,
  mode: AppointmentMode,
): Promise<TimeSlot[]> {
  const manualRecords = await fetchManualSlots(startDate, endDate);

  const manualSlots = new Map<string, Set<Period>>();
  for (const record of manualRecords) {
    let periods = manualSlots.get(record.slot_date);
    if (!periods) {
      periods = new Set();
      manualSlots.set(record.slot_date, periods);
    }
    periods.add(record.period);
  }

  return generateSlotsForRange({
    startDate,
    endDate,
    duration,
    mode,
    now: new Date(),
    manualSlots,
  });
}

// ---------------------------------------------------------------------------
// Freebusy query
// ---------------------------------------------------------------------------

/**
 * Retourne les créneaux disponibles en vérifiant Google Calendar Freebusy.
 * Les créneaux qui chevauchent un événement existant sont marqués `available: false`
 * et filtrés du résultat final.
 */
export async function getAvailableSlots(
  startDate: Date,
  endDate: Date,
  duration: AppointmentDuration,
  mode: AppointmentMode,
  dbBusyPeriods: Array<{ start: string; end: string }> = [],
): Promise<TimeSlot[]> {
  if (MOCK_MODE) {
    console.log('[calendar-mock] getAvailableSlots called — generating slots via shared algorithm');

    // Mock = pas de Google Calendar : on réutilise le même moteur de génération
    // que la production (cabinet = mercredi, visio = inverse), sans slots manuels.
    // Avantage : le mock respecte la même règle métier que la prod, plus de
    // logique dupliquée ni de dérive entre les deux chemins.
    const candidates = generateSlotsForRange({
      startDate,
      endDate,
      duration,
      mode,
      now: new Date(),
      manualSlots: EMPTY_PERIOD_MAP,
    });

    if (dbBusyPeriods.length === 0) return candidates;

    return candidates.filter((slot) => {
      const slotStart = new Date(slot.start).getTime();
      const slotEnd = new Date(slot.end).getTime();
      return !dbBusyPeriods.some((busy) => {
        const busyStart = new Date(busy.start).getTime();
        const busyEnd = new Date(busy.end).getTime();
        return slotStart < busyEnd && slotEnd > busyStart;
      });
    });
  }

  const calendarId = import.meta.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    throw new Error('Configuration manquante : GOOGLE_CALENDAR_ID non défini.');
  }

  const candidates = await generateCandidateSlots(startDate, endDate, duration, mode);

  if (candidates.length === 0) {
    return [];
  }

  const auth = await resolveCalendarAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  // Une seule requête Freebusy pour toute la plage
  let busyPeriods: Array<{ start: string; end: string }> = [];

  try {
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone: TIMEZONE,
        items: [{ id: calendarId }],
      },
    });

    const calendarData = response.data.calendars?.[calendarId];
    if (calendarData?.errors && calendarData.errors.length > 0) {
      // L'agenda est inaccessible (ex: permissions) → on log et retourne vide
      console.error(
        '[google-calendar] Erreur freebusy pour le calendrier :',
        calendarData.errors,
      );
      return [];
    }

    busyPeriods = (calendarData?.busy ?? []).filter(
      (b): b is { start: string; end: string } =>
        typeof b.start === 'string' && typeof b.end === 'string',
    );
  } catch (err: unknown) {
    // Gestion gracieuse : timeout, quota dépassé, réseau…
    const message = err instanceof Error ? err.message : String(err);
    console.error('[google-calendar] Impossible d\'interroger Freebusy :', message);
    throw new GoogleCalendarError(
      'Impossible de vérifier les disponibilités. Veuillez réessayer.',
      err,
    );
  }

  // Marque les créneaux occupés et filtre
  const allBusy = [...busyPeriods, ...dbBusyPeriods];

  return candidates
    .map((slot) => {
      const slotStart = new Date(slot.start).getTime();
      const slotEnd = new Date(slot.end).getTime();

      const isBusy = allBusy.some((busy) => {
        const busyStart = new Date(busy.start).getTime();
        const busyEnd = new Date(busy.end).getTime();
        // Chevauchement : (slotStart < busyEnd) && (slotEnd > busyStart)
        return slotStart < busyEnd && slotEnd > busyStart;
      });

      return { ...slot, available: !isBusy };
    })
    .filter((slot) => slot.available);
}

// ---------------------------------------------------------------------------
// Création d'événement
// ---------------------------------------------------------------------------

export interface CreateEventParams {
  title: string;
  start: string;  // ISO 8601
  end: string;    // ISO 8601
  description?: string;
  location?: string;
  attendeeEmail?: string;
  colorId?: string;
  /** Si true, crée automatiquement une conférence Google Meet */
  withMeet?: boolean;
  /** Identifiant du rendez-vous — utilisé comme requestId pour l'idempotence */
  appointmentId?: string;
}

export interface CreateEventResult {
  /** Identifiant de l'événement Google Calendar */
  eventId: string;
  /** URL Google Meet (présente uniquement si withMeet était true) */
  meetLink?: string;
}


// Accept the canonical googleapis Schema$Event shape (id, conferenceData,
// hangoutLink) rather than a hand-rolled partial — callers pass response.data
// directly. `Pick` narrows to the fields this function reads.
type EventResultInput = Pick<calendar_v3.Schema$Event, 'id' | 'conferenceData' | 'hangoutLink'>;

function extractEventResult(data: EventResultInput): CreateEventResult {
  const eventId = data.id;
  if (!eventId) {
    throw new GoogleCalendarError(
      'L\'événement a été créé mais aucun ID n\'a été retourné par l\'API.',
    );
  }

  const meetLink =
    data.conferenceData?.entryPoints?.find((entryPoint) => {
      if (!entryPoint) return false;
      return entryPoint.entryPointType === 'video' && typeof entryPoint.uri === 'string';
    })?.uri ??
    data.hangoutLink ??
    undefined;

  return { eventId, meetLink: meetLink ?? undefined };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollMeetLink(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
): Promise<string | undefined> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await wait(1500);
    const response = await calendar.events.get({
      calendarId,
      eventId,
      // conferenceDataVersion is only valid on insert/patch, not get
      // (not in Params$Resource$Events$Get) — see googleapis calendar_v3 types.
    });
    const result = extractEventResult(response.data);
    if (result.meetLink) return result.meetLink;
  }
  return undefined;
}

/**
 * Updates an existing Google Calendar event (e.g., on reschedule acceptance).
 * Only moves the event once the patient accepts — not on proposal.
 */
export async function updateCalendarEvent(
  eventId: string,
  patch: { start?: Date; end?: Date; summary?: string },
): Promise<void> {
  if (MOCK_MODE) {
    console.log(`[calendar-mock] Updating event ${eventId}:`, patch);
    return;
  }

  const calendarId = import.meta.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new GoogleCalendarError('GOOGLE_CALENDAR_ID non défini.');

  await withCalendarRetry(async () => {
    const auth = await resolveCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const body: calendar_v3.Schema$Event = {};
    if (patch.start) body.start = { dateTime: patch.start.toISOString(), timeZone: TIMEZONE };
    if (patch.end) body.end = { dateTime: patch.end.toISOString(), timeZone: TIMEZONE };
    if (patch.summary) body.summary = patch.summary;
    await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: body,
      sendUpdates: 'all',
    });
  });
}

/**
 * Deletes a Google Calendar event (e.g., on decline or cancellation).
 */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (MOCK_MODE) {
    console.log(`[calendar-mock] Deleting event ${eventId}`);
    return;
  }

  const calendarId = import.meta.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new GoogleCalendarError('GOOGLE_CALENDAR_ID non défini.');

  await withCalendarRetry(async () => {
    const auth = await resolveCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: 'all',
    });
  });
}

/**
 * Crée un événement dans Google Calendar après confirmation d'un rendez-vous.
 * Retourne { eventId, meetLink? }.
 */
export async function createCalendarEvent(
  params: CreateEventParams,
): Promise<CreateEventResult> {
  if (MOCK_MODE) {
    console.log(`[calendar-mock] Creating event: ${params.title} at ${params.start}`);
    const { withMeet, appointmentId } = params;
    const eventId = `mock-event-${Date.now()}`;
    return {
      eventId,
      meetLink: withMeet
        ? `https://meet.google.com/mock-${(appointmentId ?? 'xxxxxxxx').slice(0, 8)}`
        : undefined,
    };
  }

  const calendarId = import.meta.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    throw new Error('Configuration manquante : GOOGLE_CALENDAR_ID non défini.');
  }

  const attendees = params.attendeeEmail
    ? [{ email: params.attendeeEmail }]
    : undefined;

  const requestId = params.appointmentId ?? Date.now().toString(36);
  const buildRequestBody = (withConferenceSolutionKey: boolean) => ({
    summary: params.title,
    description: params.description,
    location: params.location,
    colorId: params.colorId,
    start: {
      dateTime: params.start,
      timeZone: TIMEZONE,
    },
    end: {
      dateTime: params.end,
      timeZone: TIMEZONE,
    },
    ...(params.withMeet
      ? {
          conferenceData: {
            createRequest: {
              requestId,
              ...(withConferenceSolutionKey
                ? { conferenceSolutionKey: { type: 'hangoutsMeet' as const } }
                : {}),
            },
          },
        }
      : {}),
  });

  const upsertEvent = async (
    calendar: calendar_v3.Calendar,
    sendUpdates: 'all' | 'none',
    withConferenceSolutionKey: boolean,
    includeAttendees: boolean,
  ): Promise<CreateEventResult> => {
    const response = await calendar.events.insert({
      calendarId,
      sendUpdates,
      ...(params.withMeet ? { conferenceDataVersion: 1 } : {}),
      requestBody: {
        ...buildRequestBody(withConferenceSolutionKey),
        ...(includeAttendees && attendees ? { attendees } : {}),
      },
    });

    const inserted = extractEventResult(response.data);
    if (!params.withMeet || inserted.meetLink) return inserted;

    const polledMeet = await pollMeetLink(calendar, calendarId, inserted.eventId);
    return {
      ...inserted,
      meetLink: polledMeet,
    };
  };

  // Use OAuth for all event types (Meet and in-person).
  const oauthAuth = await getPersistedOAuthClient();
  if (!oauthAuth) {
    throw new GoogleCalendarError(
      'OAuth non configuré : impossible de créer le rendez-vous dans l\'agenda.',
    );
  }

  const oauthCalendar = google.calendar({ version: 'v3', auth: oauthAuth });
  try {
    return await upsertEvent(
      oauthCalendar,
      params.attendeeEmail ? 'all' : 'none',
      Boolean(params.withMeet),
      Boolean(params.attendeeEmail),
    );
  } catch (err: unknown) {
    if (err instanceof GoogleCalendarError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[google-calendar] Impossible de créer l\'événement :', message);
    throw new GoogleCalendarError(
      'Impossible de créer le rendez-vous dans l\'agenda.',
      err,
    );
  }
}
