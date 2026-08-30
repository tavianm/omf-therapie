import type { Appointment } from '../../types/appointment';

export const APPOINTMENT_CREATED_EVENT = 'admin:appointment-created';

interface AppointmentCreatedDetail {
  appointment: Appointment;
}

function isAppointment(value: unknown): value is Appointment {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

/** Adds a newly-created appointment once, keeping an existing item current. */
export function upsertAppointment(
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

/** Broadcasts a successful creation to the independently hydrated dashboard islands. */
export function dispatchAppointmentCreated(appointment: Appointment): void {
  window.dispatchEvent(
    new CustomEvent<AppointmentCreatedDetail>(APPOINTMENT_CREATED_EVENT, {
      detail: { appointment },
    }),
  );
}

/** Reads only well-formed appointment-created events before an island updates. */
export function getCreatedAppointment(event: Event): Appointment | null {
  if (
    event.type !== APPOINTMENT_CREATED_EVENT ||
    !(event instanceof CustomEvent)
  )
    return null;

  const detail = event.detail as Partial<AppointmentCreatedDetail> | null;
  return isAppointment(detail?.appointment) ? detail.appointment : null;
}
