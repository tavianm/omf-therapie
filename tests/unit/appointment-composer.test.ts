import { describe, expect, it } from 'vitest';
import { formForPatient } from '@/components/admin/AppointmentComposer';
import {
  isCustomDurationValid,
  requiresManualPrice,
} from '@/components/admin/admin-composer-utils';
import type { Patient } from '@/types/patient';

const patient = {
  name: 'Camille Martin',
  email: 'camille@example.test',
  phone: '0612345678',
  lastAppointmentType: 'couple',
  lastAppointmentMode: 'video',
} as Patient;

describe('appointment composer state', () => {
  it('prefills a known patient and keeps the session preferences editable', () => {
    expect(formForPatient(patient)).toMatchObject({
      patient_name: 'Camille Martin',
      patient_email: 'camille@example.test',
      patient_phone: '0612345678',
      appointment_type: 'couple',
      appointment_mode: 'video',
    });
  });

  it('returns a clean identity and session for the next individual appointment', () => {
    expect(formForPatient()).toMatchObject({
      patient_name: '',
      patient_email: '',
      patient_phone: '',
      appointment_type: 'individual',
      appointment_mode: 'in-person',
      scheduled_at: '',
    });
  });
});

describe('appointment composer duration contract', () => {
  it('accepts custom durations only between 15 and 240 whole minutes', () => {
    expect(isCustomDurationValid(15)).toBe(true);
    expect(isCustomDurationValid(240)).toBe(true);
    expect(isCustomDurationValid(14)).toBe(false);
    expect(isCustomDurationValid(241)).toBe(false);
    expect(isCustomDurationValid(45.5)).toBe(false);
  });

  it('requires a manual price for every non-standard duration', () => {
    expect(requiresManualPrice(60)).toBe(false);
    expect(requiresManualPrice(90)).toBe(false);
    expect(requiresManualPrice(45)).toBe(true);
    expect(requiresManualPrice(120)).toBe(true);
    expect(requiresManualPrice(75)).toBe(true);
  });
});
