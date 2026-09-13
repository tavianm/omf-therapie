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
import { isCalendarMockEnabled } from './mock-mode.server.js';

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
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CalendarAuthError';
  }
}

export class CalendarPermissionError extends GoogleCalendarError {
  readonly type = 'CalendarPermissionError' as const;
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CalendarPermissionError';
  }
}

export class CalendarQuotaError extends GoogleCalendarError {
  readonly type = 'CalendarQuotaError' as const;
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CalendarQuotaError';
  }
}

export class CalendarNetworkError extends GoogleCalendarError {
  readonly type = 'CalendarNetworkError' as const;
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CalendarNetworkError';
  }
}

/**
 * Shared-stage failure (issue #153 / SC5): one of the two I/O stages of the
 * shared availability snapshot — the `manual_time_slots` read or the Google
 * Freebusy query — failed (transport error, or a response-level calendar
 * error on an HTTP 200). The snapshot is unusable, so EVERY caller (keepwarm
 * cron, patient path) must treat the whole batch as failed: ZERO cache
 * writes, existing entries preserved. Messages and causes are sanitized —
 * raw GaxiosError / PostgREST payloads are never attached (they may embed
 * client_secret / refresh_token).
 */
export class CalendarSharedStageError extends GoogleCalendarError {
  readonly type = 'CalendarSharedStageError' as const;
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CalendarSharedStageError';
  }
}

// ---------------------------------------------------------------------------
// Error parser + retry helper
// ---------------------------------------------------------------------------

function parseGoogleError(err: unknown): GoogleCalendarError {
  const asRecord =
    typeof err === 'object' && err !== null
      ? (err as Record<string, unknown>)
      : null;
  const responseStatus =
    asRecord?.['response'] != null
      ? (asRecord['response'] as Record<string, unknown>)['status']
      : undefined;
  const status = responseStatus ?? asRecord?.['code'];
  if (status === 401)
    return new CalendarAuthError('Authentication failed', err);
  if (status === 403)
    return new CalendarPermissionError('Calendar access denied', err);
  if (status === 429)
    return new CalendarQuotaError('Google API quota exceeded', err);
  return new CalendarNetworkError('Calendar API error', err);
}

export async function withCalendarRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: GoogleCalendarError = new CalendarNetworkError(
    'Unknown error',
  );
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const parsed = parseGoogleError(err);
      lastError = parsed;
      // No retry for auth/permission errors
      if (
        parsed instanceof CalendarAuthError ||
        parsed instanceof CalendarPermissionError
      ) {
        throw parsed;
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve =>
          setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)),
        );
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

/**
 * Outcome of the keepwarm cron's token step (issue #153 / SC2) — the session
 * the whole warm-up run is built on:
 *
 *   - `ok`: Google auth is usable RIGHT NOW. `oauth2Client` is the
 *     authenticated client (valid, freshly refreshed, or fall-through on the
 *     persisted credentials admitted by the 6-min margin gate) — every
 *     Freebusy/cache call of the run is served from this ONE client.
 *   - `transient`: the token row could not be read (network/5xx), the
 *     refresh failed without enough persisted margin (> 6 min required), the
 *     persisted token is expired / has no `expiry_date` / has an EMPTY
 *     `access_token` (a client seeded with '' would refresh hiddenly on its
 *     first signed call — revue #154), or the refresh response itself came
 *     back without an access token. The warm-up is skipped this run; no
 *     alert is emitted (the next run retries).
 *   - `auth-broken`: definitively unusable — no token row, null
 *     refresh_token, or a real invalid_grant. Warm-up skipped; the existing
 *     #132 alerting (24 h email cooldown) applies.
 */
export type KeepwarmSession =
  | { status: 'ok'; oauth2Client: Auth.OAuth2Client }
  | { status: 'transient'; reason: string }
  | { status: 'auth-broken' };

// ---------------------------------------------------------------------------
// Env access — lazy & runtime-agnostic (issue #126 / T12)
// ---------------------------------------------------------------------------

/**
 * Reads an env var at FIRST USE (never at module load) with an Astro → Node
 * fallback. Netlify scheduled functions (pure Node runtime) have no Vite env
 * object — a module-scope read would crash at import time, so every
 * env access in this file must go through this helper (or an explicit DI value).
 */
function readEnv(key: string): string | undefined {
  const fromMeta = (import.meta as { env?: Record<string, string | undefined> })
    .env?.[key];
  if (fromMeta !== undefined) return fromMeta;
  return process.env[key];
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DI seam (issue #126 / T12)
// ---------------------------------------------------------------------------

/**
 * Dependency-injection seam for the future `reconcile-invitations` cron
 * (Netlify scheduled function, pure Node runtime). The cron builds its own
 * calendar client from `process.env` and passes it here; all existing callers
 * keep the previous behavior (client built from env on first use).
 */
export interface CalendarClientOptions {
  /** Explicit googleapis calendar client — defaults to building one from env. */
  calendar?: calendar_v3.Calendar;
  /** Explicit calendar id — defaults to GOOGLE_CALENDAR_ID from env. */
  calendarId?: string;
}

async function resolveCalendarId(explicit?: string): Promise<string> {
  const calendarId = explicit ?? readEnv('GOOGLE_CALENDAR_ID');
  if (!calendarId) {
    throw new GoogleCalendarError(
      'Configuration manquante : GOOGLE_CALENDAR_ID non défini.',
    );
  }
  return calendarId;
}

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
 *
 * Token-row READ classification (issue #153 / SC1):
 *   - select failure (network / 5xx / timeout, i.e. any error ≠ PGRST116)
 *     → throws `CalendarNetworkError` (sanitized — the raw error is never
 *     attached) and performs ZERO writes;
 *   - no row (PGRST116) → returns null with NO write of any kind. The env
 *     bootstrap (GOOGLE_OAUTH_REFRESH_TOKEN) is REMOVED from runtime: the
 *     OAuth callback (/api/admin/google-oauth) is the single authoritative
 *     source of the token row — no table write may originate from a read
 *     path.
 *
 * Exported for the token-read contracts (unit tests, issue #153 SC1/SC8).
 */
export async function getPersistedOAuthClient(): Promise<Auth.OAuth2Client | null> {
  const clientId = readEnv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = readEnv('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  const redirectUri =
    readEnv('GOOGLE_OAUTH_REDIRECT_URI') ??
    'https://developers.google.com/oauthplayground';
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );

  // 1. Load persisted tokens from DB. The select error is CLASSIFIED, never
  //    ignored: a transient fetch failure must not be mistaken for "no row" —
  //    that used to fall into the env bootstrap, which upserted a stale
  //    GOOGLE_OAUTH_REFRESH_TOKEN over the fresh row before refreshing
  //    (production incident 2026-09-13, issue #153).
  const { data: tokens, error } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('*')
    .eq('id', 'therapist')
    .single();

  if (error && error.code !== 'PGRST116') {
    // Transient infra failure (network, 5xx, timeout) → typed throw. The raw
    // error is deliberately NOT attached: its payloads may embed credentials
    // (client_secret / refresh_token).
    throw new CalendarNetworkError(
      'Lecture de la ligne token impossible (panne transitoire de google_oauth_tokens).',
    );
  }

  if (!tokens) {
    // 2. No row (PGRST116) → not configured: return null with NO write of any
    //    kind. Deprecation notice if the legacy env bootstrap token still
    //    exists — reconnection via the OAuth callback is now the only path.
    if (readEnv('GOOGLE_OAUTH_REFRESH_TOKEN')) {
      console.warn(
        '[google-calendar] GOOGLE_OAUTH_REFRESH_TOKEN ignoré — bootstrap env supprimé, reconnecter via /api/admin/google-oauth.',
      );
    }
    return null;
  }

  // 3. Proactive refresh: refresh if token expires within 5 minutes
  if (!tokens.expiry_date || tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const updated = {
        access_token: credentials.access_token ?? '',
        // google-auth-library's refreshAccessToken() never surfaces a
        // server-rotated refresh token: it echoes back the credential it was
        // given, so this persists the same refresh_token we loaded. Google
        // does not currently rotate refresh tokens out-of-band; if it ever
        // does, this path will keep persisting the ORIGINAL token and needs
        // revisiting.
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date: credentials.expiry_date ?? Date.now() + 3600 * 1000,
        updated_at: new Date().toISOString(),
      };
      // Persist with CAS (issue #153 / SC8): the UPDATE may only overwrite
      // the row AS READ — `.eq('updated_at', <value read at select time>)` —
      // so a newer write (reconnexion callback, cron refresh) always
      // survives. The .select('id').single() confirm surfaces a zero-row
      // conditional update as PGRST116.
      const { data: persisted, error: updateError } = await supabaseAdmin
        .from('google_oauth_tokens')
        .update(updated)
        .eq('id', 'therapist')
        .eq('updated_at', tokens.updated_at)
        .select('id')
        .single();

      if (updateError && updateError.code !== 'PGRST116') {
        // Infra error on the conditional UPDATE (5xx / timeout / network) —
        // a TRANSIENT error, NEVER a collision: reconcile with a re-read,
        // then continue on the in-memory credentials (the refresh itself
        // succeeded). Sanitized: no raw error object is logged.
        const reread = await supabaseAdmin
          .from('google_oauth_tokens')
          .select('updated_at')
          .eq('id', 'therapist')
          .single()
          .then(
            result => result,
            () => null,
          );
        console.warn(
          '[google-calendar] Persist du token non confirmé (erreur infra transitoire) — relecture de réconciliation.',
          {
            persistErrorCode: updateError.code ?? 'unknown',
            currentUpdatedAt: reread?.data?.updated_at ?? 'unavailable',
          },
        );
      } else if (!persisted) {
        // CAS MISS: zero rows matched — a NEWER version of the row exists
        // (reconnexion callback or the keepwarm cron). Benign by design:
        // reconcile (re-read for the log), preserve the recent row, and
        // continue on the in-memory credentials. Never fatal.
        const reread = await supabaseAdmin
          .from('google_oauth_tokens')
          .select('updated_at')
          .eq('id', 'therapist')
          .single()
          .then(
            result => result,
            () => null,
          );
        console.warn(
          '[google-calendar] CAS miss — ligne récente préservée',
          reread?.data?.updated_at
            ? { currentUpdatedAt: reread.data.updated_at }
            : undefined,
        );
      }
      oauth2Client.setCredentials(credentials);
      return oauth2Client;
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { error?: string } } })
        ?.response?.data;
      if (errData?.error === 'invalid_grant') {
        // AC-3: alert admin — fire and forget (don't block the throw)
        const adminEmail = readEnv('ADMIN_EMAIL');
        const siteUrl = readEnv('SITE_URL') ?? 'https://omf-therapie.fr';
        if (adminEmail) {
          const { createElement } = await import('react');
          const { default: CalendarAuthAlert } =
            await import('../emails/CalendarAuthAlert');
          sendEmail({
            to: adminEmail,
            subject: '⚠️ Google Calendar — re-autorisation requise',
            react: createElement(CalendarAuthAlert, {
              reauthorizeUrl: `${siteUrl}/api/admin/google-oauth/`,
            }),
          }).catch(() => console.error('[calendar] Alert email failed.'));
        }
        // Store only the safe error code — do NOT pass raw err (GaxiosError may
        // carry client_secret / refresh_token in response.config.data)
        throw new CalendarAuthError(
          'OAuth consent revoked — re-authorize via Google Cloud Console',
          { googleErrorCode: errData.error },
        );
      }
      throw new CalendarNetworkError('Token refresh failed', {
        status: (err as { response?: { status?: number } })?.response?.status,
      });
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
    'Configuration Google Calendar manquante : reconnectez-vous via /api/admin/google-oauth/.',
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
    PARIS_PARTS_FORMATTER.formatToParts(date).map(p => [p.type, p.value]),
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
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));

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
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
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
 * async (`loadAvailabilitySnapshot`) se contente d'hydrater `manualSlots`
 * depuis Supabase puis de déléguer ici.
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

        slots.push(
          ...generatePeriodSlots(
            year,
            month,
            day,
            half,
            input.duration,
            minStart,
          ),
        );
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
 * Indexe les lignes de slots manuels par date Paris (YYYY-MM-DD) → périodes
 * couvertes — la forme consommée par la fonction pure `generateSlotsForRange`.
 */
function indexManualSlots(
  records: Array<{ slot_date: string; period: Period }>,
): Map<string, Set<Period>> {
  const manualSlots = new Map<string, Set<Period>>();
  for (const record of records) {
    let periods = manualSlots.get(record.slot_date);
    if (!periods) {
      periods = new Set();
      manualSlots.set(record.slot_date, periods);
    }
    periods.add(record.period);
  }
  return manualSlots;
}

// ---------------------------------------------------------------------------
// Snapshot de disponibilité partagé (issue #153 — batch mono-snapshot)
// ---------------------------------------------------------------------------

/**
 * Tout ce dont la dérivation pure a besoin : les périodes de présence manuel
 * indexées par date Paris, et les périodes occupées Freebusy de la fenêtre.
 * Produit par `loadAvailabilitySnapshot` — mock mode → snapshot vide, zéro
 * I/O.
 */
export interface AvailabilitySnapshot {
  /** Slots manuels indexés par date (YYYY-MM-DD) → périodes couvertes. */
  manualSlots: Map<string, Set<Period>>;
  /** Périodes occupées Freebusy (ISO 8601) sur la fenêtre demandée. */
  busyPeriods: Array<{ start: string; end: string }>;
}

/**
 * Optional bounds for the shared snapshot's upstream I/O (revue #154): a
 * stalled manual-slots read or Freebusy query must abort into the typed
 * shared-stage failure instead of hanging until the platform timeout.
 */
export interface SnapshotOptions {
  /**
   * Per-request timeout (ms) applied to the Freebusy query via gaxios
   * (`timeout` on the calendar client — gaxios turns it into a real
   * AbortSignal). Undefined → no timeout (patient-path default, unchanged).
   */
  timeoutMs?: number;
  /** Abort signal threaded into the manual-slots Supabase read. */
  signal?: AbortSignal;
}

/**
 * Charge le snapshot de disponibilité partagé pour une fenêtre : UNE lecture
 * `manual_time_slots` et UNE requête Freebusy (issue #153 / SC3), servies par
 * le client OAuth authentifié injecté. Mock mode → snapshot vide, ZÉRO I/O.
 *
 * Tout échec de stage (lecture manuel slots, Freebusy transport ou erreur
 * response-level) lève une erreur typée de stage partagé (SC5) : l'appelant
 * — cron comme chemin patient — ne doit alors écrire AUCUNE entrée cache.
 */
export async function loadAvailabilitySnapshot(
  oauth2Client: Auth.OAuth2Client,
  startDate: Date,
  endDate: Date,
  options: SnapshotOptions = {},
): Promise<AvailabilitySnapshot> {
  if (isCalendarMockEnabled()) {
    return { manualSlots: new Map(), busyPeriods: [] };
  }

  if (!oauth2Client) {
    throw new GoogleCalendarError(
      'Client OAuth absent : impossible de charger le snapshot de disponibilités.',
    );
  }

  const calendarId = await resolveCalendarId();
  // The deadline timeout rides on the calendar client itself: googleapis
  // merges per-API options into every request's gaxios config, and gaxios
  // converts `timeout` into a real AbortSignal for the underlying fetch.
  const calendar = google.calendar({
    version: 'v3',
    auth: oauth2Client,
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
  });
  return loadSnapshotWithCalendar(
    calendar,
    calendarId,
    startDate,
    endDate,
    options.signal,
  );
}

/**
 * Stage 1 du snapshot — la lecture unique `manual_time_slots`. Toute erreur
 * est classée échec de stage partagé (issue #153 / SC5). Message sanitisé :
 * le détail PostgREST n'est loggué que côté serveur, jamais transporté dans
 * l'erreur typée. `signal` (optionnel, revue #154) borne la lecture côté
 * Supabase — un abort y est classé échec de stage comme toute erreur.
 */
async function fetchManualSlotsStage(
  startDate: Date,
  endDate: Date,
  signal?: AbortSignal,
): Promise<Array<{ slot_date: string; period: Period }>> {
  // No signal → EXACT pre-#154 call shape (start, end): the patient path's
  // call contract is observable (SC7) and must not drift for a cron-only
  // concern.
  const read = signal
    ? fetchManualSlots(startDate, endDate, { signal })
    : fetchManualSlots(startDate, endDate);
  return read.catch(() => {
    console.error(
      '[google-calendar] Échec de la lecture manual_time_slots (stage partagé) :',
      { stage: 'manual-time-slots' },
    );
    throw new CalendarSharedStageError(
      'Échec du stage partagé availability-snapshot : lecture manual_time_slots impossible.',
    );
  });
}

/**
 * Stage 2 du snapshot — la requête Freebusy unique pour toute la plage.
 *
 * Contrat strict (issue #153 / SC5) : la réponse est VALIDE seulement si
 * l'agenda demandé est présent dans `calendars` ET que `busy` est un tableau
 * d'intervalles structurellement corrects. Une entrée absente, un `busy`
 * manquant ou un intervalle malformé ne sont PAS « agenda vide » : traiter
 * ces réponses comme fail-open empoisonnerait les caches avec des
 * disponibilités fantômes → erreur typée de stage partagé. Une erreur
 * response-level (`calendars[id].errors` non vide sur HTTP 200) lève
 * également. Messages et causes sanitisés : les payloads bruts
 * Google/PostgREST ne circulent jamais (risque d'y trouver client_secret /
 * refresh_token).
 */
async function fetchBusyPeriodsStage(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  startDate: Date,
  endDate: Date,
): Promise<Array<{ start: string; end: string }>> {
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
    if (!calendarData) {
      // HTTP 200 mais l'agenda demandé n'est pas dans la réponse — impossible
      // de distinguer « vide » d'une réponse tronquée : fail-closed.
      throw new CalendarSharedStageError(
        'Échec du stage partagé availability-snapshot : agenda demandé absent de la réponse Freebusy.',
      );
    }

    if (calendarData.errors && calendarData.errors.length > 0) {
      // HTTP 200 mais Google signale une erreur sur cet agenda (permissions,
      // introuvable…). Seuls les codes `reason` circulent — jamais les
      // payloads bruts.
      const reasons = calendarData.errors
        .map(e => (typeof e?.reason === 'string' ? e.reason : 'unknown'))
        .join(',');
      console.error(
        '[google-calendar] Erreur freebusy response-level pour le calendrier (stage partagé) :',
        reasons,
      );
      throw new CalendarSharedStageError(
        "Échec du stage partagé availability-snapshot : erreur response-level Freebusy sur l'agenda.",
        { googleErrorCode: reasons },
      );
    }

    const busy: unknown = calendarData.busy;
    if (!Array.isArray(busy)) {
      throw new CalendarSharedStageError(
        'Échec du stage partagé availability-snapshot : réponse Freebusy malformée (busy absent ou non tableau).',
      );
    }
    if (
      !busy.every((b): b is { start: string; end: string } => {
        const start = (b as { start?: unknown } | null)?.start;
        const end = (b as { end?: unknown } | null)?.end;
        if (typeof start !== 'string' || typeof end !== 'string') {
          return false;
        }
        const startTime = Date.parse(start);
        const endTime = Date.parse(end);
        return Number.isFinite(startTime) && startTime < endTime;
      })
    ) {
      throw new CalendarSharedStageError(
        'Échec du stage partagé availability-snapshot : réponse Freebusy malformée (intervalle busy invalide).',
      );
    }
    return busy;
  } catch (err: unknown) {
    if (err instanceof CalendarSharedStageError) throw err; // déjà classée
    // Gestion gracieuse : timeout, quota dépassé, réseau… — même classement
    // échec de stage partagé. Cause sanitisée au seul champ sûr (status).
    console.error(
      "[google-calendar] Impossible d'interroger Freebusy (stage partagé) :",
      {
        status: (err as { response?: { status?: unknown } })?.response?.status,
      },
    );
    throw new CalendarSharedStageError(
      'Échec du stage partagé availability-snapshot : requête Freebusy impossible.',
      { status: (err as { response?: { status?: number } })?.response?.status },
    );
  }
}

/**
 * Exécute les DEUX stages I/O du snapshot — exactement UNE lecture
 * `manual_time_slots` et UNE requête Freebusy — et classe toute erreur comme
 * échec de stage partagé (issue #153 / SC5). Le `signal` optionnel borne la
 * lecture manual slots ; la requête Freebusy est bornée par le timeout du
 * client calendar (SnapshotOptions.timeoutMs).
 */
async function loadSnapshotWithCalendar(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  startDate: Date,
  endDate: Date,
  signal?: AbortSignal,
): Promise<AvailabilitySnapshot> {
  const manualRecords = await fetchManualSlotsStage(
    startDate,
    endDate,
    signal,
  );
  const busyPeriods = await fetchBusyPeriodsStage(
    calendar,
    calendarId,
    startDate,
    endDate,
  );
  return { manualSlots: indexManualSlots(manualRecords), busyPeriods };
}

/**
 * Filtre pur de chevauchement — exclut tout créneau recouvrant une période
 * occupée. Partagé par le chemin patient (`/api/availability`), la dérivation
 * du cron keepwarm et la branche mock ; déduplique les 3 copies historiques
 * (issue #153). Les extrémités qui se touchent (slot.end === busy.start) ne
 * chevauchent PAS.
 */
export function filterSlotsByBusy(
  slots: TimeSlot[],
  busyPeriods: Array<{ start: string; end: string }>,
): TimeSlot[] {
  if (busyPeriods.length === 0) return slots;
  return slots.filter(slot => {
    const slotStart = new Date(slot.start).getTime();
    const slotEnd = new Date(slot.end).getTime();
    return !busyPeriods.some(busy => {
      const busyStart = new Date(busy.start).getTime();
      const busyEnd = new Date(busy.end).getTime();
      return slotStart < busyEnd && slotEnd > busyStart;
    });
  });
}

// ---------------------------------------------------------------------------
// Freebusy query — chemin patient
// ---------------------------------------------------------------------------

/**
 * Retourne les créneaux disponibles en vérifiant Google Calendar Freebusy.
 * Les créneaux qui chevauchent un événement existant sont filtrés du résultat.
 *
 * Chemin patient (issue #153 / SC7) : les candidats sont dérivés depuis la
 * lecture unique `manual_time_slots` AVANT la requête Freebusy — une plage
 * sans créneau éligible retourne [] sans consommer d'appel Freebusy ni
 * risquer un 503 pendant une panne Google. Sinon, UNE requête Freebusy dont
 * tout échec est typé erreur de stage partagé (SC5) : en particulier, une
 * réponse tronquée/malformée ou une erreur response-level lève désormais
 * (→ 503 sur /api/availability) au lieu de retourner [] — un résultat vide
 * qui était autrefois persisté par les writers comme disponibilités fantômes.
 */
export async function getAvailableSlots(
  startDate: Date,
  endDate: Date,
  duration: AppointmentDuration,
  mode: AppointmentMode,
  dbBusyPeriods: Array<{ start: string; end: string }> = [],
  options: CalendarClientOptions = {},
): Promise<TimeSlot[]> {
  if (isCalendarMockEnabled()) {
    console.log(
      '[calendar-mock] getAvailableSlots called — generating slots via shared algorithm',
    );

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

    return filterSlotsByBusy(candidates, dbBusyPeriods);
  }

  const calendarId = await resolveCalendarId(options.calendarId);

  // Stage 1 — slots manuels, puis dérivation des candidats. L'early return
  // précède la requête Freebusy : zéro appel API quand la plage n'offre
  // aucun créneau éligible (comportement d'avant le batch mono-snapshot).
  const manualRecords = await fetchManualSlotsStage(startDate, endDate);
  const candidates = generateSlotsForRange({
    startDate,
    endDate,
    duration,
    mode,
    now: new Date(),
    manualSlots: indexManualSlots(manualRecords),
  });

  if (candidates.length === 0) {
    return [];
  }

  // Stage 2 — la résolution d'auth et la requête Freebusy ne tournent que
  // s'il y a des candidats à filtrer. Échecs classés erreur de stage partagé
  // (SC5), contrat fail-closed strict sur la réponse (voir
  // fetchBusyPeriodsStage).
  const calendar =
    options.calendar ??
    google.calendar({ version: 'v3', auth: await resolveCalendarAuth() });
  const busyPeriods = await fetchBusyPeriodsStage(
    calendar,
    calendarId,
    startDate,
    endDate,
  );

  // Filtre les créneaux occupés (Freebusy + RDV DB)
  return filterSlotsByBusy(candidates, [
    ...busyPeriods,
    ...dbBusyPeriods,
  ]);
}

// ---------------------------------------------------------------------------
// Création d'événement
// ---------------------------------------------------------------------------

export interface CreateEventParams {
  title: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
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
type EventResultInput = Pick<
  calendar_v3.Schema$Event,
  'id' | 'conferenceData' | 'hangoutLink'
>;

function extractEventResult(data: EventResultInput): CreateEventResult {
  const eventId = data.id;
  if (!eventId) {
    throw new GoogleCalendarError(
      "L'événement a été créé mais aucun ID n'a été retourné par l'API.",
    );
  }

  const meetLink =
    data.conferenceData?.entryPoints?.find(entryPoint => {
      if (!entryPoint) return false;
      return (
        entryPoint.entryPointType === 'video' &&
        typeof entryPoint.uri === 'string'
      );
    })?.uri ??
    data.hangoutLink ??
    undefined;

  return { eventId, meetLink: meetLink ?? undefined };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
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
  options: CalendarClientOptions = {},
): Promise<void> {
  if (isCalendarMockEnabled()) {
    console.log(`[calendar-mock] Updating event ${eventId}:`, patch);
    return;
  }

  const calendarId = await resolveCalendarId(options.calendarId);

  await withCalendarRetry(async () => {
    const calendar =
      options.calendar ??
      google.calendar({ version: 'v3', auth: await resolveCalendarAuth() });
    const body: calendar_v3.Schema$Event = {};
    if (patch.start)
      body.start = { dateTime: patch.start.toISOString(), timeZone: TIMEZONE };
    if (patch.end)
      body.end = { dateTime: patch.end.toISOString(), timeZone: TIMEZONE };
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
export async function deleteCalendarEvent(
  eventId: string,
  options: CalendarClientOptions = {},
): Promise<void> {
  if (isCalendarMockEnabled()) {
    console.log(`[calendar-mock] Deleting event ${eventId}`);
    return;
  }

  const calendarId = await resolveCalendarId(options.calendarId);

  await withCalendarRetry(async () => {
    const calendar =
      options.calendar ??
      google.calendar({ version: 'v3', auth: await resolveCalendarAuth() });
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
  options: CalendarClientOptions = {},
): Promise<CreateEventResult> {
  if (isCalendarMockEnabled()) {
    console.log(
      `[calendar-mock] Creating event: ${params.title} at ${params.start}`,
    );
    const { withMeet, appointmentId } = params;
    const eventId = `mock-event-${Date.now()}`;
    return {
      eventId,
      meetLink: withMeet
        ? `https://meet.google.com/mock-${(appointmentId ?? 'xxxxxxxx').slice(0, 8)}`
        : undefined,
    };
  }

  const calendarId = await resolveCalendarId(options.calendarId);

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

    const polledMeet = await pollMeetLink(
      calendar,
      calendarId,
      inserted.eventId,
    );
    return {
      ...inserted,
      meetLink: polledMeet,
    };
  };

  // Use OAuth for all event types (Meet and in-person).
  const oauthCalendar =
    options.calendar ??
    (await (async () => {
      const oauthAuth = await getPersistedOAuthClient();
      if (!oauthAuth) {
        throw new GoogleCalendarError(
          "OAuth non configuré : impossible de créer le rendez-vous dans l'agenda.",
        );
      }
      return google.calendar({ version: 'v3', auth: oauthAuth });
    })());
  try {
    return await upsertEvent(
      oauthCalendar,
      params.attendeeEmail ? 'all' : 'none',
      Boolean(params.withMeet),
      Boolean(params.attendeeEmail),
    );
  } catch (err: unknown) {
    if (err instanceof GoogleCalendarError) throw err;
    console.error("[google-calendar] Impossible de créer l'événement.");
    throw new GoogleCalendarError(
      "Impossible de créer le rendez-vous dans l'agenda.",
      err,
    );
  }
}
