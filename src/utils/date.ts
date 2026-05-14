/**
 * Vérifie qu'une date ISO tombe un mercredi en heure de Paris.
 * Utilisé pour valider les créneaux en présentiel (mercredi uniquement).
 */
export function isWednesdayParis(isoDate: string): boolean {
  const date = new Date(isoDate);
  const parisDay = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
  }).format(date);
  return parisDay === 'mercredi';
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
