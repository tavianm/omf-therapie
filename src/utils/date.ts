import type { AppointmentStatus } from '../types/appointment';

/**
 * Statuts à partir desquels un RDV ne peut plus être annulé ni reporté
 * (déjà refusé, déjà annulé).
 */
const TERMINAL_STATUSES: ReadonlySet<AppointmentStatus> = new Set(['declined', 'cancelled']);

/**
 * Un rendez-vous peut-il être annulé ou reporté par la thérapeute ?
 *
 * Règle : le RDV doit être dans un statut non-terminal (≠ declined/cancelled)
 * ET sa date prévue doit être >= début de la veille (Europe/Paris). Cette fenêtre
 * inclut volontairement la veille : la thérapeute doit pouvoir annuler un RDV
 * de dernière minute qu'elle n'a pas eu le temps de traiter le jour même.
 *
 * Prédicat pur, partagé client/serveur. Vit ici (et non dans
 * `appointment-eligibility.ts`) pour éviter de tirer la chaîne d'imports
 * `manual-slots.ts` → `supabaseAdmin` dans le bundle client des islands React
 * (`AppointmentCard`). Ce module (`utils/date.ts`) n'a aucune dépendance I/O.
 */
export function isCancellableByTherapist(appt: {
  scheduled_at: string;
  status: AppointmentStatus;
}): boolean {
  if (TERMINAL_STATUSES.has(appt.status)) return false;
  return new Date(appt.scheduled_at).getTime() >= startOfYesterdayParis().getTime();
}

/** ISO weekday in Paris time (1 = lundi, …, 7 = dimanche). */
export function getParisISOWeekday(date: Date): number {
  // en-US short abbreviations are stable across runtimes, unlike fr-FR ones.
  const abbr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
  }).format(date);
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[abbr] ?? 7;
}

/** Date au format YYYY-MM-DD en heure locale Paris. */
export function toParisDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Minuit (00:00) du jour précédent, en heure de Paris (Europe/Paris).
 *
 * Sert de borne inférieure à la fenêtre d'éligibilité d'annulation/report :
 * un RDV est annulable par la thérapeute si `scheduled_at >= startOfYesterdayParis()`.
 * Inclure la veille permet l'annulation de dernière minute quand la thérapeute
 * n'a pas eu le temps de l'annuler le jour même.
 *
 * Insensible à la TZ du runtime et au DST : on obtient la date Paris de la veille
 * (YYYY-MM-DD), puis on sonde l'instant UTC exact où l'heure de Paris vaut 00:00
 * ce jour-là. Comme Paris est en UTC+1/+2, « minuit Paris du jour D » tombe entre
 * 22:00 et 23:00 UTC la veille (jour D-1 en UTC) — on sonde donc une fenêtre
 * autour de `D 00:00 UTC` par pas fins et on retient le premier candidat dont
 * le formatage Paris vaut 00:00 sur la bonne date.
 */
export function startOfYesterdayParis(now: Date = new Date()): Date {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ymd = toParisDateString(yesterday); // YYYY-MM-DD Paris (jour D)

  const parisMidnightOnYmd = (utcMs: number): boolean => {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    // On veut exactement 00:00 sur la date ymd (évite de capter le minuit du jour suivant).
    return `${get('year')}-${get('month')}-${get('day')}` === ymd && `${get('hour')}:${get('minute')}` === '00:00';
  };

  // Minuit Paris du jour D est dans [D-1 22:00 UTC, D 00:00 UTC].
  // On sonde depuis D 00:00 UTC en reculant par pas de 5 min sur 3 h.
  const baseUtc = Date.parse(`${ymd}T00:00:00Z`);
  for (let delta = 0; delta <= 3 * 60 * 60 * 1000; delta += 5 * 60 * 1000) {
    const candidate = baseUtc - delta;
    if (parisMidnightOnYmd(candidate)) return new Date(candidate);
  }
  // Repli (ne devrait jamais se produire) : la veille à 22:00 UTC.
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - 2 * 60 * 60 * 1000);
}

/**
 * Vérifie qu'une séance tient dans les plages horaires d'ouverture (heure Paris).
 * Matin  : 8h00–12h00  (480–720 min)
 * Après-midi : 14h00–19h00 (840–1140 min)
 */
export function isWithinBusinessHours(isoDate: string, durationMin: number): boolean {
  const start = new Date(isoDate);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  const toParisMinutes = (d: Date): number => {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(d);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    return h * 60 + m;
  };

  const startMin = toParisMinutes(start);
  const endMin = toParisMinutes(end);

  const inMorning = startMin >= 480 && endMin <= 720;
  const inAfternoon = startMin >= 840 && endMin <= 1140;

  return inMorning || inAfternoon;
}

/**
 * Un rendez-vous est « à venir » tant que son heure de début n'est pas passée.
 * On se base sur l'heure de début (et non de fin) — suffisant pour un tri d'agenda.
 */
export function isUpcoming(iso: string, nowMs: number = Date.now()): boolean {
  return new Date(iso).getTime() >= nowMs;
}

/** Compare deux instants au jour calendaire près (fuseau Paris). */
export function isSameParisDay(isoA: string, isoB: string): boolean {
  return toParisDateString(new Date(isoA)) === toParisDateString(new Date(isoB));
}

/**
 * Décalage arithmétique d'un jour calendaire `YYYY-MM-DD`.
 * L'arithmétique se fait sur la date UTC (zéro heure) pour rester insensible
 * aux transitions DST : on manipule une date « pure », pas une heure.
 */
function shiftParisDay(dayKey: string, deltaDays: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86_400_000);
  const sy = shifted.getUTCFullYear();
  const sm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const sd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${sy}-${sm}-${sd}`;
}

/**
 * Libellé relatif au jour courant (fuseau Paris).
 * Renvoie "Aujourd'hui" / "Demain" / "Hier", ou `null` si le jour est plus éloigné.
 */
export function getRelativeDayLabel(
  iso: string,
  nowMs: number = Date.now(),
): string | null {
  const todayKey = toParisDateString(new Date(nowMs));
  const targetKey = toParisDateString(new Date(iso));
  if (targetKey === todayKey) return "Aujourd'hui";
  if (targetKey === shiftParisDay(todayKey, 1)) return 'Demain';
  if (targetKey === shiftParisDay(todayKey, -1)) return 'Hier';
  return null;
}

/** Format court pour en-tête de groupe : ex. « ven. 3 juillet 2026 ». */
export function formatDayHeader(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

/** Heure courte HH:mm en fuseau Paris. */
export function formatTimeParis(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}
