import type { Appointment } from '../../types/appointment';
import { ACTIONABLE_STATUSES, BLOCKING_STATUSES } from '../../utils/domain';
import { toParisDateString } from '../../utils/date';

export type AdminWorkspaceDestination =
  'overview' | 'appointments' | 'patients' | 'availability';

export const WORKSPACE_PAGE_SIZE = 25;

export interface WorkspaceSummary {
  actionable: Appointment[];
  today: Appointment[];
  next: Appointment | null;
  overdue: Appointment[];
  total: number;
}

export function isUpcomingAppointment(
  appointment: Appointment,
  now = new Date(),
): boolean {
  return new Date(appointment.scheduled_at).getTime() >= now.getTime();
}

// Overdue rule: a request whose decision window has elapsed stays visible as
// "En retard" instead of silently dropping out of the synthesis. Three cases:
//  - `pending` — the elapsed slot can no longer be confirmed as booked;
//  - `payment_pending` — the payment link was sent but never paid;
//  - `rescheduled` — the proposed slot (`rescheduled_to`) elapsed without the
//    patient accepting it.
export function isOverduePendingRequest(
  appointment: Appointment,
  now = new Date(),
): boolean {
  if (isUpcomingAppointment(appointment, now)) return false;
  if (
    appointment.status === 'pending' ||
    appointment.status === 'payment_pending'
  ) {
    return true;
  }
  return (
    appointment.status === 'rescheduled' &&
    appointment.rescheduled_to !== null &&
    new Date(appointment.rescheduled_to).getTime() < now.getTime()
  );
}

export function getWorkspaceSummary(
  appointments: Appointment[],
  now = new Date(),
): WorkspaceSummary {
  const byScheduledAt = (left: Appointment, right: Appointment) =>
    left.scheduled_at.localeCompare(right.scheduled_at);
  // Only live appointments count as upcoming: a cancelled or declined slot
  // must never surface as "Prochain rendez-vous". BLOCKING_STATUSES is exactly
  // the set of live statuses (every status except declined/cancelled).
  const future = appointments
    .filter(
      appointment =>
        isUpcomingAppointment(appointment, now) &&
        BLOCKING_STATUSES.includes(appointment.status),
    )
    .sort(byScheduledAt);
  // Whole Paris day (past AND future): the therapist must still see this
  // morning's appointments when opening the workspace in the afternoon.
  const todayKey = toParisDateString(now);
  const overdue = appointments
    .filter(appointment => isOverduePendingRequest(appointment, now))
    .sort(byScheduledAt);

  return {
    actionable: [
      ...overdue,
      ...future.filter(appointment =>
        ACTIONABLE_STATUSES.includes(appointment.status),
      ),
    ],
    today: appointments
      .filter(
        appointment =>
          toParisDateString(new Date(appointment.scheduled_at)) === todayKey,
      )
      .sort(byScheduledAt),
    next: future[0] ?? null,
    overdue,
    total: appointments.length,
  };
}

export function upsertWorkspaceAppointment(
  appointments: Appointment[],
  appointment: Appointment,
): Appointment[] {
  const existingIndex = appointments.findIndex(
    item => item.id === appointment.id,
  );
  if (existingIndex === -1) return [appointment, ...appointments];
  return appointments.map(item =>
    item.id === appointment.id ? appointment : item,
  );
}

export function paginateAppointments<T>(
  items: T[],
  page: number,
  pageSize = WORKSPACE_PAGE_SIZE,
): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  return {
    items: items.slice(safePage * pageSize, (safePage + 1) * pageSize),
    page: safePage,
    pageCount,
  };
}
