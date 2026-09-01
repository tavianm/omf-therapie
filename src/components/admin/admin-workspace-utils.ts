import type { Appointment } from '../../types/appointment';
import { ACTIONABLE_STATUSES } from '../../utils/domain';
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

// Overdue rule (kept deliberately simple): a pending request whose slot has
// already elapsed can no longer be confirmed as booked — it needs a decision
// (decline or contact the patient), so it stays visible as "En retard"
// instead of silently dropping out of the synthesis once it becomes past.
export function isOverduePendingRequest(
  appointment: Appointment,
  now = new Date(),
): boolean {
  return (
    appointment.status === 'pending' && !isUpcomingAppointment(appointment, now)
  );
}

export function getWorkspaceSummary(
  appointments: Appointment[],
  now = new Date(),
): WorkspaceSummary {
  const byScheduledAt = (left: Appointment, right: Appointment) =>
    left.scheduled_at.localeCompare(right.scheduled_at);
  const future = appointments
    .filter(appointment => isUpcomingAppointment(appointment, now))
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
