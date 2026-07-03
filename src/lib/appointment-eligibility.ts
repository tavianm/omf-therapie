/**
 * Règle d'éligibilité cabinet — source unique de vérité partagée entre :
 *   - le moteur de génération des créneaux (`google-calendar.ts`),
 *   - les portes de validation de prise de rendez-vous (API create / admin / report).
 *
 * Centraliser la règle ici évite la dérive : la validation ne peut plus durcir
 * « mercredi uniquement » en ignorant les `manual_time_slots`.
 */
import type { Period } from '@/types/manual-slots';
import { fetchManualSlots } from './manual-slots.js';
import { getParisISOWeekday, toParisDateString, startOfYesterdayParis } from '../utils/date.js';
import type { AppointmentStatus } from '../types/appointment';

// ---------------------------------------------------------------------------
// Demi-journées ouvrées (heure locale Paris)
// ---------------------------------------------------------------------------

export type DayHalf = 'morning' | 'afternoon';

/**
 * Bornes horaires par demi-journée (heure Paris).
 * - morning   = 08:00–12:00
 * - afternoon = 14:00–19:00
 */
export const DAY_HALF_PERIODS: Record<DayHalf, { startHour: number; endHour: number }> = {
  morning: { startHour: 8, endHour: 12 },
  afternoon: { startHour: 14, endHour: 19 },
};

export const DAY_HALVES: readonly DayHalf[] = ['morning', 'afternoon'];

// ---------------------------------------------------------------------------
// Règle d'éligibilité (additive, manuel par-dessus mercredi)
// ---------------------------------------------------------------------------

/**
 * Éligibilité cabinet par demi-journée :
 *
 *   cabinet-eligible(period) = mercredi OU manual_slot couvre la période
 *
 * Le modèle est **additif** : un manual_slot ajoute des demi-journées cabinet
 * par-dessus le mercredi par défaut, sans jamais le retirer.
 *
 * @param isWednesday    true si le jour est mercredi (cabinet par défaut)
 * @param manualPeriods  périodes couvertes par au moins un manual_slot ce jour
 */
export function cabinetEligibility(
  isWednesday: boolean,
  manualPeriods: Set<Period>,
): Record<DayHalf, boolean> {
  const allDay = manualPeriods.has('all_day');
  return {
    morning: isWednesday || allDay || manualPeriods.has('morning'),
    afternoon: isWednesday || allDay || manualPeriods.has('afternoon'),
  };
}

// ---------------------------------------------------------------------------
// Helpers orientés « créneau unique » (validation à la prise de rendez-vous)
// ---------------------------------------------------------------------------

/**
 * Indique la demi-journée (morning/afternoon) d'un créneau d'après son heure
 * de début Paris. Fiable car `isWithinBusinessHours` rejette déjà les créneaux
 * à cheval sur la pause midi (12h–14h).
 */
export function dayHalfFor(isoDate: string): DayHalf {
  const hour = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(isoDate));
  return parseInt(hour, 10) < 12 ? 'morning' : 'afternoon';
}

/**
 * Périodes manuelles couvrant le jour Paris d'un créneau, sous forme de Set.
 * Récupère une fenêtre large puis filtre sur la date Paris exacte afin d'éviter
 * tout décalage UTC/Paris (le filtre `fetchManualSlots` s'appuie sur la date UTC).
 */
export async function fetchManualPeriodsForDate(isoDate: string): Promise<Set<Period>> {
  const slotDate = new Date(isoDate);
  const dateKey = toParisDateString(slotDate);
  // Fenêtre de 3 jours centrée pour rester robuste au décalage de filtre UTC.
  const dayMs = 24 * 60 * 60 * 1000;
  const records = await fetchManualSlots(
    new Date(slotDate.getTime() - dayMs),
    new Date(slotDate.getTime() + dayMs),
  );
  const periods = new Set<Period>();
  for (const record of records) {
    if (record.slot_date === dateKey) periods.add(record.period);
  }
  return periods;
}

/**
 * Un créneau présentiel est-il cabinet-éligible pour son jour ?
 *
 * Réutilise `cabinetEligibility` (moteur de génération) + consulte les plages
 * manuelles du jour : la validation ne peut ainsi jamais diverger de la liste
 * des créneaux proposés au patient.
 */
export async function isCabinetEligibleSlot(isoDate: string): Promise<boolean> {
  const isWednesday = getParisISOWeekday(new Date(isoDate)) === 3;
  const manualPeriods = await fetchManualPeriodsForDate(isoDate);
  return cabinetEligibility(isWednesday, manualPeriods)[dayHalfFor(isoDate)];
}

// ---------------------------------------------------------------------------
// Éligibilité à l'annulation / report par la thérapeute
// ---------------------------------------------------------------------------

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
 * Prédicat pur, partagé client/serveur (aucun effet de bord, aucun I/O).
 */
export function isCancellableByTherapist(appt: {
  scheduled_at: string;
  status: AppointmentStatus;
}): boolean {
  if (TERMINAL_STATUSES.has(appt.status)) return false;
  return new Date(appt.scheduled_at).getTime() >= startOfYesterdayParis().getTime();
}
