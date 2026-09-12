/**
 * Paris-timezone (Europe/Paris) display formatters — single source of truth.
 *
 * Client-safe: no server, environment, or database dependency. Every helper
 * takes an ISO string and renders it in Paris wall-clock time; do NOT
 * re-encode `Intl.DateTimeFormat(..., { timeZone: 'Europe/Paris' })` inline
 * at call sites. Machine-readable date keys (YYYY-MM-DD) stay in
 * `src/utils/date.ts` (`toParisDateString`).
 */

const PARIS_TIMEZONE = 'Europe/Paris';

/** Long date without weekday, e.g. « 14 juillet 2025 » — single source of truth. */
export function formatParisDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/** Long date without weekday + time, e.g. « 14 juillet 2025 à 10:00 » — single source of truth. */
export function formatParisDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/** Long date with weekday, no time, e.g. « lundi 14 juillet 2025 » — single source of truth. */
export function formatParisWeekdayDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/** Long date with weekday + time, e.g. « lundi 14 juillet 2025 à 10:00 » — single source of truth. */
export function formatParisWeekdayDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/** Time only (HH:mm), e.g. « 10:00 » — single source of truth. */
export function formatParisTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/** Compact date + time, e.g. « 14 juil. 10:00 » — single source of truth. */
export function formatParisShortDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/** Slot label with short weekday, e.g. « lun. 14 juil. 10:00 » — single source of truth. */
export function formatParisSlot(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/** Medium date without time, e.g. « 14 juil. 2025 » — single source of truth. */
export function formatParisMediumDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeZone: PARIS_TIMEZONE,
  }).format(new Date(iso));
}

/**
 * Value for a `<input type="datetime-local">` from a slot instant. These
 * inputs carry no timezone and the submit path re-parses them in the device
 * timezone (Paris for the practitioner), so the instant must be rendered in
 * Europe/Paris wall time — toISOString() would shift the appointment 1–2 h
 * early. Single source of truth.
 */
export function toParisDatetimeLocal(iso: string): string {
  // sv-SE formats as YYYY-MM-DD HH:mm — one replace away from the input format.
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: PARIS_TIMEZONE,
  })
    .format(new Date(iso))
    .replace(' ', 'T');
}
