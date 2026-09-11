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
import { isSameParisDay, isUpcoming, toParisDateString } from './date';

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
