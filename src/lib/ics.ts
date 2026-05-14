/**
 * Génération de fichiers ICS (iCalendar — RFC 5545) sans dépendance externe.
 *
 * Références :
 *   - RFC 5545 : https://datatracker.ietf.org/doc/html/rfc5545
 *   - RFC 6868 : paramètres encodés
 */

/** Adresse du cabinet OMF Thérapie */
export const CABINET_ADDRESS = '1086 Av. Albert Einstein, 34000 Montpellier';

/** PRODID conforme RFC 5545 */
const PRODID = '-//OMF Thérapie//Rendez-vous//FR';

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface ICSEvent {
  /** Identifiant unique (ex : UUID du rendez-vous) */
  uid: string;
  /** Titre de l'événement */
  summary: string;
  /** Description optionnelle */
  description?: string;
  /** Lieu — pour présentiel : adresse du cabinet */
  location?: string;
  /** URL — pour visio : lien Google Meet ou autre */
  url?: string;
  /** Date/heure de début */
  start: Date;
  /** Date/heure de fin */
  end: Date;
  /** Nom de l'organisateur */
  organizerName?: string;
  /** Email de l'organisateur */
  organizerEmail?: string;
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/**
 * Formate une date JS en timestamp UTC iCalendar : YYYYMMDDTHHMMSSZ
 */
function toICSDate(date: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

  return (
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Retourne un timestamp de création (DTSTAMP) pour l'instant présent.
 */
function nowICSDate(): string {
  return toICSDate(new Date());
}

/**
 * Échappe les caractères spéciaux dans les valeurs de texte ICS (RFC 5545 §3.3.11).
 *
 * Règles :
 *   \n (saut de ligne) → \\n
 *   ,  (virgule)       → \\,
 *   ;  (point-virgule) → \\;
 *   \  (backslash)     → \\\\
 */
function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Applique le folding RFC 5545 §3.1 :
 * chaque ligne ne doit pas dépasser 75 octets ; si elle dépasse,
 * on insère CRLF + SPACE (continuation line).
 *
 * On travaille sur des caractères (pas des octets) pour simplifier ;
 * c'est acceptable pour le contenu ASCII/latin courant.
 */
function foldLine(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line;

  let folded = '';
  let remaining = line;

  // Première tranche : 75 caractères
  folded += remaining.slice(0, MAX);
  remaining = remaining.slice(MAX);

  // Tranches suivantes : 74 caractères (1 pris par l'espace de continuation)
  while (remaining.length > 0) {
    folded += '\r\n ' + remaining.slice(0, MAX - 1);
    remaining = remaining.slice(MAX - 1);
  }

  return folded;
}

/**
 * Construit une propriété ICS avec folding automatique.
 * Retourne la ligne terminée par CRLF.
 */
function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`) + '\r\n';
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Génère une chaîne ICS valide (RFC 5545) pour un événement.
 */
export function generateICS(event: ICSEvent): string {
  const lines: string[] = [];

  const push = (line: string) => lines.push(line);

  // En-tête VCALENDAR
  push(prop('BEGIN', 'VCALENDAR'));
  push(prop('VERSION', '2.0'));
  push(prop('PRODID', PRODID));
  push(prop('CALSCALE', 'GREGORIAN'));
  push(prop('METHOD', 'REQUEST'));

  // Événement VEVENT
  push(prop('BEGIN', 'VEVENT'));
  push(prop('UID', event.uid));
  push(prop('DTSTAMP', nowICSDate()));
  push(prop('DTSTART', toICSDate(event.start)));
  push(prop('DTEND', toICSDate(event.end)));
  push(prop('SUMMARY', escapeICSText(event.summary)));

  if (event.description) {
    push(prop('DESCRIPTION', escapeICSText(event.description)));
  }

  if (event.location) {
    push(prop('LOCATION', escapeICSText(event.location)));
  }

  if (event.url) {
    push(prop('URL', event.url));
  }

  if (event.organizerName && event.organizerEmail) {
    // Syntaxe : ORGANIZER;CN="Nom":mailto:email
    push(
      foldLine(
        `ORGANIZER;CN="${escapeICSText(event.organizerName)}":mailto:${event.organizerEmail}`,
      ) + '\r\n',
    );
  } else if (event.organizerEmail) {
    push(prop('ORGANIZER', `mailto:${event.organizerEmail}`));
  }

  push(prop('END', 'VEVENT'));
  push(prop('END', 'VCALENDAR'));

  return lines.join('');
}

/**
 * Génère un lien `data:` URI encodé en base64 pour téléchargement inline
 * (utilisable comme `href` dans un `<a download="rdv.ics">` ou dans un email HTML).
 */
export function generateICSDataUri(event: ICSEvent): string {
  const icsContent = generateICS(event);

  // btoa fonctionne en navigateur et dans les runtimes modernes (Node 16+, Deno, Bun).
  // Pour le contenu UTF-8, on encode d'abord en percent-encoding puis en base64.
  const base64 = btoa(
    encodeURIComponent(icsContent).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    ),
  );

  return `data:text/calendar;charset=utf-8;base64,${base64}`;
}

/**
 * Génère un lien Google Calendar permettant d'ajouter l'événement en un clic.
 *
 * Format : https://calendar.google.com/calendar/render?action=TEMPLATE&...
 */
export function generateGoogleCalendarLink(event: ICSEvent): string {
  const base = 'https://calendar.google.com/calendar/render';

  /** Google attend le format : YYYYMMDDTHHmmssZ (sans séparateurs) */
  const gcalDate = (d: Date) => toICSDate(d); // même format UTC

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.summary,
    dates: `${gcalDate(event.start)}/${gcalDate(event.end)}`,
    ...(event.description ? { details: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.url ? { sprop: `website:${event.url}` } : {}),
  });

  return `${base}?${params.toString()}`;
}

/**
 * Génère un lien Outlook Web "native compose" pour créer l'événement.
 */
export function generateOutlookCalendarLink(event: ICSEvent): string {
  const base = 'https://outlook.live.com/calendar/0/deeplink/compose';
  const params = new URLSearchParams({
    subject: event.summary,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    ...(event.description ? { body: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
  });
  return `${base}?${params.toString()}`;
}

/**
 * Génère un lien HTTP vers l'invitation ICS hébergée côté serveur.
 * Compatible Apple Calendar (iOS/macOS) et clients desktop.
 */
export function generateAppleCalendarInviteLink(baseUrl: string, appointmentId: string, token?: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  const url = new URL(`${root}/api/calendar/invite/${appointmentId}/`);
  if (token) {
    url.searchParams.set('token', token);
  }
  // URL.protocol won't keep unknown schemes like "webcal", so convert as string.
  return url.toString().replace(/^https?:\/\//i, 'webcal://');
}
