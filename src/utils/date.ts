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
