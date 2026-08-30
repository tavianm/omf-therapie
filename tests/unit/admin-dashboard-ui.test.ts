import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Appointment } from '../../src/types/appointment';
import type { Patient } from '../../src/types/patient';
import {
  APPOINTMENT_CREATED_EVENT,
  getCreatedAppointment,
  normalizePatientSearch,
  patientMatchesSearch,
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

describe('patient list search', () => {
  const patient = {
    name: 'Élodie Martin',
    email: 'elodie.martin@example.fr',
    phone: '06 12 34 56 78',
  } as Patient;

  it.each([
    ['name', 'elodie'],
    ['email', 'MARTIN@EXAMPLE.FR'],
    ['phone', '0612345678'],
  ])('matches a patient by %s', (_field, query) => {
    expect(patientMatchesSearch(patient, query)).toBe(true);
  });

  it('normalizes accents, case and surrounding whitespace', () => {
    expect(normalizePatientSearch('  ÉLODIE  ')).toBe('elodie');
    expect(patientMatchesSearch(patient, '  éLoDiE ')).toBe(true);
  });

  it('returns no match for an absent term while an empty search restores the list', () => {
    expect(patientMatchesSearch(patient, 'inconnu')).toBe(false);
    expect(patientMatchesSearch(patient, '   ')).toBe(true);
  });
});
