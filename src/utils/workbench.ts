/**
 * Workbench derived state — pure helpers for the proposal-B dashboard
 * (`/poste-travail/`, issue #148).
 *
 * Everything here is derived from the already-fetched appointment list:
 * no I/O, no server-only import, safe for React islands. All time-dependent
 * functions take `nowMs` explicitly so views and tests stay deterministic.
 *
 * Triage rule ("À traiter"): an appointment requires action while its status
 * is `pending` (to confirm), `payment_pending` (to collect) or `rescheduled`
 * (to re-plan). A triage item whose start time has passed carries the derived
 * "EN RETARD" flag. Terminal statuses (`cancelled`, `declined`) and settled
 * ones (`confirmed`, `payment_received`) are never triaged.
 */

import type { Appointment, AppointmentStatus } from '../types/appointment';
import {
  formatTimeParis,
  getRelativeDayLabel,
  isSameParisDay,
  isUpcoming,
  toParisDateString,
} from './date';

/** Statuses that still require a decision from the practitioner. */
const TRIAGE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'pending',
  'payment_pending',
  'rescheduled',
]);

/** Statuses for sessions that will (or did) actually take place. */
const ACTIVE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'pending',
  'confirmed',
  'rescheduled',
  'payment_pending',
  'payment_received',
]);

/** A session that will (or did) take place — excludes declined/cancelled. */
export function isActiveAppointment(appointment: Appointment): boolean {
  return ACTIVE_STATUSES.has(appointment.status);
}

/** Why an appointment sits in the "À traiter" queue (flags may combine). */
export interface TriageReasons {
  /** Start time already passed. */
  late: boolean;
  /** Payment link sent but not paid. */
  payment: boolean;
  /** Rescheduled — needs a new slot. */
  reschedule: boolean;
}

export interface TriageItem {
  appointment: Appointment;
  reasons: TriageReasons;
}

/**
 * Triage reasons for one appointment, or `null` when it needs no action.
 */
export function getTriageReasons(
  appointment: Appointment,
  nowMs: number = Date.now(),
): TriageReasons | null {
  if (!TRIAGE_STATUSES.has(appointment.status)) return null;
  return {
    late: !isUpcoming(appointment.scheduled_at, nowMs),
    payment: appointment.status === 'payment_pending',
    reschedule: appointment.status === 'rescheduled',
  };
}

/**
 * "À traiter" queue, soonest first (late items bubble to the top naturally).
 */
export function getTriageItems(
  appointments: Appointment[],
  nowMs: number = Date.now(),
): TriageItem[] {
  return appointments
    .map((appointment) => ({ appointment, reasons: getTriageReasons(appointment, nowMs) }))
    .filter((item): item is TriageItem => item.reasons !== null)
    .sort((a, b) => a.appointment.scheduled_at.localeCompare(b.appointment.scheduled_at));
}

/** Per-flag counts for the KPI card subtitle (« X retards · Y paiements · … »). */
export function getTriageBreakdown(items: TriageItem[]): {
  late: number;
  payment: number;
  reschedule: number;
} {
  const breakdown = { late: 0, payment: 0, reschedule: 0 };
  for (const item of items) {
    if (item.reasons.late) breakdown.late += 1;
    if (item.reasons.payment) breakdown.payment += 1;
    if (item.reasons.reschedule) breakdown.reschedule += 1;
  }
  return breakdown;
}

/** Today's active sessions (Paris day), chronological. */
export function getTodaySessions(
  appointments: Appointment[],
  nowMs: number = Date.now(),
): Appointment[] {
  const nowIso = new Date(nowMs).toISOString();
  return appointments
    .filter((a) => isActiveAppointment(a) && isSameParisDay(a.scheduled_at, nowIso))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

/** Next active sessions from `nowMs` onwards, chronological, capped at `limit`. */
export function getNextSessions(
  appointments: Appointment[],
  nowMs: number = Date.now(),
  limit: number = 3,
): Appointment[] {
  return appointments
    .filter((a) => isActiveAppointment(a) && isUpcoming(a.scheduled_at, nowMs))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, limit);
}

export interface MonthlyVolume {
  /** Active sessions in the current Paris month. */
  total: number;
  /** Cancelled or declined sessions in the current Paris month. */
  cancelled: number;
  /** Share of the month's sessions not cancelled/declined, in % (null when empty). */
  honoredSharePct: number | null;
}

/** Monthly volume KPI — denominator includes cancelled/declined sessions. */
export function getMonthlyVolume(
  appointments: Appointment[],
  nowMs: number = Date.now(),
): MonthlyVolume {
  const monthKey = toParisDateString(new Date(nowMs)).slice(0, 7); // YYYY-MM
  let total = 0;
  let active = 0;
  for (const appointment of appointments) {
    if (toParisDateString(new Date(appointment.scheduled_at)).slice(0, 7) !== monthKey) continue;
    total += 1;
    if (ACTIVE_STATUSES.has(appointment.status)) active += 1;
  }
  return {
    total: active,
    cancelled: total - active,
    honoredSharePct: total === 0 ? null : Math.round((active / total) * 100),
  };
}

/** Whole minutes until the session starts, or `null` once it has begun. */
export function getMinutesUntil(iso: string, nowMs: number = Date.now()): number | null {
  const deltaMs = new Date(iso).getTime() - nowMs;
  if (deltaMs <= 0) return null;
  return Math.round(deltaMs / 60_000);
}

// ---------------------------------------------------------------------------
// Patients directory (client-side mirror of GET /api/admin/patients/)
// ---------------------------------------------------------------------------

/**
 * Patient record derived from the appointment list, grouped by
 * `patient_email` — same rules as the server aggregation:
 * name/phone/city from the most recent appointment, `isActive` when the last
 * appointment is within 3 months, history ordered descending.
 */
export interface PatientAggregate {
  email: string;
  name: string;
  phone: string;
  city: string;
  postalCode: string;
  /** Total non-soft-deleted appointments (matches the server counter). */
  sessionCount: number;
  /** Active sessions already taken place (Paris day compare, status ≠ cancelled/declined). */
  completedCount: number;
  lastAppointmentAt: string;
  firstAppointmentAt: string;
  lastType: Appointment['appointment_type'];
  lastMode: Appointment['appointment_mode'];
  isActive: boolean;
  /** Next upcoming active appointment, if any. */
  nextAppointment: Appointment | null;
  /** Sum of `final_price` for settled sessions (payment_received), in centimes. */
  paidCents: number;
  /** Sum of `final_price` awaiting payment (payment_pending), in centimes. */
  pendingPaymentCents: number;
  /** Full history, most recent first. */
  history: Appointment[];
}

export function aggregatePatients(
  appointments: Appointment[],
  nowMs: number = Date.now(),
): PatientAggregate[] {
  const activeCutoff = new Date(nowMs);
  // Même règle calendaire que GET /api/admin/patients/ : trois mois civils
  // (setMonth gère les débordements de fin de mois comme le serveur — une
  // approximation en 90 jours ferait disparaître des patients actifs).
  activeCutoff.setMonth(activeCutoff.getMonth() - 3);
  const activeCutoffMs = activeCutoff.getTime();
  const buckets = new Map<string, Appointment[]>();
  for (const appointment of appointments) {
    const bucket = buckets.get(appointment.patient_email);
    if (bucket) bucket.push(appointment);
    else buckets.set(appointment.patient_email, [appointment]);
  }

  const patients: PatientAggregate[] = [];
  for (const [email, rows] of buckets) {
    const history = [...rows].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
    const latest = history[0];
    if (!latest) continue;
    let paidCents = 0;
    let pendingPaymentCents = 0;
    let completedCount = 0;
    for (const appointment of rows) {
      if (appointment.status === 'payment_received') paidCents += appointment.final_price;
      if (appointment.status === 'payment_pending') {
        pendingPaymentCents += appointment.final_price;
      }
      // Séance « réalisée » : la consultation a bien eu lieu. Une demande
      // `pending` sans réponse ou un report `rescheduled` proposé ne prouvent
      // pas qu'une séance s'est tenue (revue #148).
      if (
        (appointment.status === 'confirmed' || appointment.status === 'payment_received') &&
        !isUpcoming(appointment.scheduled_at, nowMs)
      ) {
        completedCount += 1;
      }
    }
    const sortedAsc = [...rows].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    patients.push({
      email,
      name: latest.patient_name,
      phone: latest.patient_phone,
      city: latest.patient_city,
      postalCode: latest.patient_postal_code,
      sessionCount: rows.length,
      completedCount,
      lastAppointmentAt: latest.scheduled_at,
      firstAppointmentAt: sortedAsc[0]?.scheduled_at ?? latest.scheduled_at,
      lastType: latest.appointment_type,
      lastMode: latest.appointment_mode,
      isActive: new Date(latest.scheduled_at).getTime() >= activeCutoffMs,
      nextAppointment:
        sortedAsc.find(
          (a) => isActiveAppointment(a) && isUpcoming(a.scheduled_at, nowMs),
        ) ?? null,
      paidCents,
      pendingPaymentCents,
      history,
    });
  }
  return patients.sort((a, b) => b.lastAppointmentAt.localeCompare(a.lastAppointmentAt));
}

/** Initials for avatar chips: first letter of the two first words. */
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// Slot labels (drawer — slots come from the authoritative /api/availability/)
// ---------------------------------------------------------------------------

export interface DescribedSlot {
  startIso: string;
  endIso: string;
  /** « Aujourd’hui », « Demain » ou « JEU. 14 SEPT. » (Paris). */
  dayLabel: string;
  /** « 09:15 – 10:15 » (Paris). */
  timeLabel: string;
}

function formatSlotDayLabel(iso: string, nowMs: number): string {
  const relative = getRelativeDayLabel(iso, nowMs);
  if (relative) return relative;
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/Paris',
  })
    .format(new Date(iso))
    .replace(/\./g, '')
    .toUpperCase();
}

/**
 * Libellés d’un créneau renvoyé par /api/availability/ — pur et testable.
 * La sélection elle-même vient de l’endpoint autoritaire (Google Agenda,
 * plages cabinet, marge, reports réservés), jamais d’un recalcul local.
 */
export function describeSlot(
  startIso: string,
  endIso: string,
  nowMs: number = Date.now(),
): DescribedSlot {
  return {
    startIso,
    endIso,
    dayLabel: formatSlotDayLabel(startIso, nowMs),
    timeLabel: `${formatTimeParis(startIso)} – ${formatTimeParis(endIso)}`,
  };
}

// ---------------------------------------------------------------------------
// Reschedule eligibility (mirrors the PATCH `reschedule` action contract)
// ---------------------------------------------------------------------------

/** Statuses from which a reschedule proposal can be made (PATCH `reschedule`). */
const RESCHEDULABLE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'pending',
  'payment_pending',
  'payment_received',
  'confirmed',
  'rescheduled',
]);

/**
 * Un report peut être proposé depuis tout statut non terminal — y compris une
 * téléconsultation impayée, même en retard (port de 43fb1ac, #133) : l'API
 * `reschedule` expire le Payment Link d'origine et en régénère un à
 * l'acceptation, plutôt qu'un refus + re-création. La date d'origine ne
 * bloque pas ; seule la NOUVELLE date doit être future (contrôle côté API).
 */
export function isReschedulable(appointment: Pick<Appointment, 'status'>): boolean {
  return RESCHEDULABLE_STATUSES.has(appointment.status);
}
