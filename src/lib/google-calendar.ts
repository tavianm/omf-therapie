/**
 * Google Calendar API wrapper (service account authentication)
 *
 * Gère la génération des créneaux candidats et la vérification
 * de disponibilité via l'API Freebusy de Google Calendar.
 */

import { google, type Auth } from 'googleapis';

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

/** Plages horaires de travail (heure locale Paris) */
const WORK_PERIODS: Array<{ startHour: number; endHour: number }> = [
  { startHour: 8, endHour: 12 },
  { startHour: 14, endHour: 19 },
];

/** Délai minimum avant un créneau proposable (24h en ms) */
const MIN_NOTICE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Authentification Google
// ---------------------------------------------------------------------------

/**
 * Construit un client JWT authentifié avec le service account.
 * Lance une erreur claire si les variables d'environnement manquent.
 */
function buildAuthClient(): Auth.JWT {
  const email = import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = import.meta.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      'Configuration manquante : GOOGLE_SERVICE_ACCOUNT_EMAIL et/ou GOOGLE_PRIVATE_KEY non définis.',
    );
  }

  // Les clés privées sont souvent stockées avec des "\n" littéraux
  const privateKey = rawKey.replace(/\\n/g, '\n');

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  });
}

// ---------------------------------------------------------------------------
// Helpers de manipulation de dates (sans dépendance lourde)
// ---------------------------------------------------------------------------

/**
 * Retourne l'heure locale Paris pour une Date UTC en tant qu'objet
 * { year, month (1-12), day (1-31), hour, minute, weekday (0=dim, 1=lun…) }
 */
function toParisLocalParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );

  return {
    year: parseInt(parts['year']!, 10),
    month: parseInt(parts['month']!, 10),
    day: parseInt(parts['day']!, 10),
    hour: parseInt(parts['hour']!, 10),
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
  // On récupère le jour de semaine en locale Paris
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
  });
  const wd = formatter.format(date);
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

// ---------------------------------------------------------------------------
// Génération des créneaux candidats
// ---------------------------------------------------------------------------

/**
 * Génère tous les créneaux candidats entre `startDate` et `endDate` en
 * respectant les horaires de travail, le filtre mercredi pour le présentiel
 * et le délai minimum de 24h.
 */
export function generateCandidateSlots(
  startDate: Date,
  endDate: Date,
  duration: AppointmentDuration,
  mode: AppointmentMode,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const nowMs = Date.now();
  const minStart = new Date(nowMs + MIN_NOTICE_MS);

  // Itère jour par jour depuis startDate jusqu'à endDate
  let currentDay = startOfParisDay(startDate);

  while (currentDay < endDate) {
    const weekday = getParisISOWeekday(currentDay);

    // Jours ouvrés uniquement (lundi-vendredi)
    if (weekday >= 1 && weekday <= 5) {
      // Présentiel : uniquement le mercredi (ISO 3)
      const isWednesday = weekday === 3;
      if (mode === 'in-person' && !isWednesday) {
        currentDay = new Date(currentDay.getTime() + 24 * 60 * 60 * 1000);
        continue;
      }

      const { year, month, day } = toParisLocalParts(currentDay);

      // Génère les créneaux par plage horaire
      for (const period of WORK_PERIODS) {
        let slotHour = period.startHour;
        let slotMinute = 0;

        // Tous les 30 min dans la plage
        while (true) {
          const slotStart = parisLocalToUTC(year, month, day, slotHour, slotMinute);
          const slotEndDate = new Date(slotStart.getTime() + duration * 60 * 1000);

          // Calcul de la fin en heure locale Paris pour vérifier les débordements
          const endLocal = toParisLocalParts(slotEndDate);
          const slotEndMinutes = endLocal.hour * 60 + endLocal.minute;

          // La fin doit se situer dans la même plage (pas de débordement sur la pause ou après 19h)
          const periodEndMinutes = period.endHour * 60;
          if (slotEndMinutes > periodEndMinutes) {
            break; // Ce créneau et les suivants débordent : on passe à la plage suivante
          }

          // Créneau dans le futur avec délai minimum
          if (slotStart >= minStart) {
            slots.push({
              start: slotStart.toISOString(),
              end: slotEndDate.toISOString(),
              available: true, // sera mis à jour par getAvailableSlots
            });
          }

          // Avance de 30 min
          slotMinute += 30;
          if (slotMinute >= 60) {
            slotMinute -= 60;
            slotHour += 1;
          }

          // Sortie de boucle si on dépasse la fin de plage
          const currentMinutes = slotHour * 60 + slotMinute;
          if (currentMinutes >= periodEndMinutes) {
            break;
          }
        }
      }
    }

    // Jour suivant
    currentDay = new Date(currentDay.getTime() + 24 * 60 * 60 * 1000);
  }

  return slots;
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
    console.log('[calendar-mock] getAvailableSlots called — returning mock Wednesday slots');

    /** Périodes mock : 09:00–12:00 et 14:00–18:00 (heure Paris) */
    const MOCK_PERIODS: Array<{ startHour: number; endHour: number }> = [
      { startHour: 9, endHour: 12 },
      { startHour: 14, endHour: 18 },
    ];

    const mockSlots: TimeSlot[] = [];
    const minStart = new Date(Date.now() + MIN_NOTICE_MS);

    // Itère jour par jour en ne retenant que les mercredis
    let currentDay = startOfParisDay(startDate);

    while (currentDay < endDate) {
      // Mercredi = ISO weekday 3
      if (getParisISOWeekday(currentDay) === 3) {
        const { year, month, day } = toParisLocalParts(currentDay);

        for (const period of MOCK_PERIODS) {
          // Créneaux horaires (pas de 1h) dans la plage
          for (let slotHour = period.startHour; slotHour < period.endHour; slotHour++) {
            const slotStart = parisLocalToUTC(year, month, day, slotHour, 0);
            const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

            // Respecte le délai minimum de 24h
            if (slotStart >= minStart) {
              mockSlots.push({
                start: slotStart.toISOString(),
                end: slotEnd.toISOString(),
                available: true,
              });
            }
          }
        }
      }

      currentDay = new Date(currentDay.getTime() + 24 * 60 * 60 * 1000);
    }

    if (dbBusyPeriods.length === 0) return mockSlots;

    return mockSlots.filter((slot) => {
      const slotStart = new Date(slot.start).getTime();
      const slotEnd   = new Date(slot.end).getTime();
      return !dbBusyPeriods.some((busy) => {
        const busyStart = new Date(busy.start).getTime();
        const busyEnd   = new Date(busy.end).getTime();
        return slotStart < busyEnd && slotEnd > busyStart;
      });
    });
  }

  const calendarId = import.meta.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    throw new Error('Configuration manquante : GOOGLE_CALENDAR_ID non défini.');
  }

  const candidates = generateCandidateSlots(startDate, endDate, duration, mode);

  if (candidates.length === 0) {
    return [];
  }

  const auth = buildAuthClient();
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
  attendeeEmail?: string;
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

  const auth = buildAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const attendees = params.attendeeEmail
    ? [{ email: params.attendeeEmail }]
    : undefined;

  const requestId = params.appointmentId ?? Date.now().toString(36);

  try {
    const response = await calendar.events.insert({
      calendarId,
      sendUpdates: params.attendeeEmail ? 'all' : 'none',
      ...(params.withMeet ? { conferenceDataVersion: 1 } : {}),
      requestBody: {
        summary: params.title,
        description: params.description,
        start: {
          dateTime: params.start,
          timeZone: TIMEZONE,
        },
        end: {
          dateTime: params.end,
          timeZone: TIMEZONE,
        },
        attendees,
        ...(params.withMeet
          ? { conferenceData: { createRequest: { requestId } } }
          : {}),
      },
    });

    const eventId = response.data.id;
    if (!eventId) {
      throw new GoogleCalendarError(
        'L\'événement a été créé mais aucun ID n\'a été retourné par l\'API.',
      );
    }

    const meetLink =
      response.data.conferenceData?.entryPoints?.[0]?.uri ??
      response.data.hangoutLink ??
      undefined;

    return { eventId, meetLink: meetLink ?? undefined };
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
