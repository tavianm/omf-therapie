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
