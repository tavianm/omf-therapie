import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Appointment } from '../../src/types/appointment';
import {
  APPOINTMENT_CREATED_EVENT,
  getCreatedAppointment,
  upsertAppointment,
} from '../../src/components/admin/admin-dashboard-ui';

const createdAppointment = { id: 'created-appointment' } as Appointment;

describe('admin dashboard appointment creation', () => {
  it('keeps the newly-created appointment in local state without duplicating it', () => {
    const initialAppointment = { id: 'existing-appointment' } as Appointment;

    expect(upsertAppointment([initialAppointment], createdAppointment)).toEqual(
      [createdAppointment, initialAppointment],
    );
    expect(upsertAppointment([createdAppointment], createdAppointment)).toEqual(
      [createdAppointment],
    );
  });

  it('accepts only a well-formed appointment-created event', () => {
    const event = new CustomEvent(APPOINTMENT_CREATED_EVENT, {
      detail: { appointment: createdAppointment },
    });

    expect(getCreatedAppointment(event)).toBe(createdAppointment);
    expect(
      getCreatedAppointment(new Event(APPOINTMENT_CREATED_EVENT)),
    ).toBeNull();
    expect(getCreatedAppointment(new Event('unrelated-event'))).toBeNull();
  });

  it('does not reintroduce a full page reload after a successful creation', () => {
    const source = readFileSync(
      new URL(
        '../../src/components/admin/AdminCreateButton.tsx',
        import.meta.url,
      ),
      'utf8',
    );

    expect(source).not.toContain('window.location.reload');
    expect(source).toContain('dispatchAppointmentCreated(result.appointment)');
  });
});
