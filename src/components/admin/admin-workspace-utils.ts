import type { Appointment, AppointmentStatus } from '../../types/appointment';

export type AdminWorkspaceDestination =
  'overview' | 'appointments' | 'patients' | 'availability';

export const WORKSPACE_PAGE_SIZE = 25;

const ACTIONABLE_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'rescheduled',
  'payment_pending',
];

export interface WorkspaceSummary {
  actionable: Appointment[];
  today: Appointment[];
  next: Appointment | null;
  total: number;
}

function parisDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function isUpcomingAppointment(
  appointment: Appointment,
  now = new Date(),
): boolean {
  return new Date(appointment.scheduled_at).getTime() >= now.getTime();
}

export function getWorkspaceSummary(
  appointments: Appointment[],
  now = new Date(),
): WorkspaceSummary {
  const future = appointments
    .filter(appointment => isUpcomingAppointment(appointment, now))
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at));
  const todayKey = parisDate(now.toISOString());

  return {
    actionable: future.filter(appointment =>
      ACTIONABLE_STATUSES.includes(appointment.status),
    ),
    today: future.filter(
      appointment => parisDate(appointment.scheduled_at) === todayKey,
    ),
    next: future[0] ?? null,
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
