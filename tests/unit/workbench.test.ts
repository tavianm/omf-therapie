import { describe, expect, it } from 'vitest';
import type { Appointment } from '../../src/types/appointment';
import {
  getMinutesUntil,
  getMonthlyVolume,
  getNextSessions,
  getTriageBreakdown,
  getTriageItems,
  getTodaySessions,
  isActiveAppointment,
} from '../../src/utils/workbench';

/**
 * Instant de référence : vendredi 11 septembre 2026, 15:00 Paris (CEST, UTC+2).
 * Toutes les dates de fixture s'expriment par rapport à cet instant.
 */
const NOW = Date.parse('2026-09-11T13:00:00.000Z'); // 15:00 Paris
const TODAY_0830 = '2026-09-11T06:30:00.000Z'; // 08:30 Paris — passé
const TODAY_1500 = '2026-09-11T13:00:00.000Z'; // 15:00 Paris — maintenant
const TODAY_1630 = '2026-09-11T14:30:00.000Z'; // 16:30 Paris — à venir
const TOMORROW_0900 = '2026-09-12T07:00:00.000Z'; // 09:00 Paris le 12
const YESTERDAY_1000 = '2026-09-10T08:00:00.000Z'; // 10:00 Paris le 10
const LAST_MONTH = '2026-08-20T10:00:00.000Z'; // 20 août

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    patient_name: 'Test Patient',
    patient_email: 'test@example.com',
    patient_phone: '0600000000',
    patient_postal_code: '69006',
    patient_city: 'Lyon',
    patient_reason: 'Suivi',
    appointment_type: 'individual',
    appointment_mode: 'video',
    duration: 60,
    is_first_session: false,
    base_price: 5000,
    discount: 0,
    final_price: 5000,
    credit_applied: 0,
    scheduled_at: TODAY_1500,
    status: 'confirmed',
    invitation_sent_at: null,
    stripe_payment_link_id: null,
    stripe_payment_link_url: null,
    stripe_payment_intent_id: null,
    video_link: null,
    google_calendar_event_id: null,
    therapist_notes: null,
    rescheduled_to: null,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('isActiveAppointment', () => {
  it('excludes declined and cancelled', () => {
    expect(isActiveAppointment(makeAppointment({ status: 'cancelled' }))).toBe(false);
    expect(isActiveAppointment(makeAppointment({ status: 'declined' }))).toBe(false);
  });

  it('includes pending, confirmed, rescheduled, payment_pending, payment_received', () => {
    for (const status of [
      'pending',
      'confirmed',
      'rescheduled',
      'payment_pending',
      'payment_received',
    ] as const) {
      expect(isActiveAppointment(makeAppointment({ status }))).toBe(true);
    }
  });
});

describe('getTriageItems', () => {
  it('keeps pending, payment_pending and rescheduled only', () => {
    const items = getTriageItems(
      [
        makeAppointment({ id: 'a', status: 'pending', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'b', status: 'confirmed', scheduled_at: TODAY_1500 }),
        makeAppointment({ id: 'c', status: 'payment_pending', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'd', status: 'rescheduled', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'e', status: 'payment_received', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'f', status: 'cancelled', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'g', status: 'declined', scheduled_at: TODAY_1630 }),
      ],
      NOW,
    );
    expect(items.map((i) => i.appointment.id)).toEqual(['a', 'c', 'd']);
  });

  it('sorts soonest first and flags late items', () => {
    const items = getTriageItems(
      [
        makeAppointment({ id: 'future', status: 'pending', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'past', status: 'pending', scheduled_at: TODAY_0830 }),
      ],
      NOW,
    );
    expect(items.map((i) => i.appointment.id)).toEqual(['past', 'future']);
    expect(items[0]?.reasons.late).toBe(true);
    expect(items[1]?.reasons.late).toBe(false);
  });

  it('combines flags: a past payment_pending is both late and payment', () => {
    const items = getTriageItems(
      [makeAppointment({ status: 'payment_pending', scheduled_at: YESTERDAY_1000 })],
      NOW,
    );
    expect(items[0]?.reasons).toEqual({ late: true, payment: true, reschedule: false });
  });

  it('counts breakdown flags independently', () => {
    const items = getTriageItems(
      [
        makeAppointment({ id: '1', status: 'pending', scheduled_at: TODAY_0830 }),
        makeAppointment({ id: '2', status: 'payment_pending', scheduled_at: TODAY_0830 }),
        makeAppointment({ id: '3', status: 'payment_pending', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: '4', status: 'rescheduled', scheduled_at: YESTERDAY_1000 }),
      ],
      NOW,
    );
    expect(getTriageBreakdown(items)).toEqual({ late: 3, payment: 2, reschedule: 1 });
  });
});

describe('getTodaySessions', () => {
  it('keeps active sessions of the Paris day, chronological', () => {
    const sessions = getTodaySessions(
      [
        makeAppointment({ id: 'tomorrow', scheduled_at: TOMORROW_0900 }),
        makeAppointment({ id: '1630', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: '0830', scheduled_at: TODAY_0830 }),
        makeAppointment({ id: 'cancelled', status: 'cancelled', scheduled_at: TODAY_1500 }),
      ],
      NOW,
    );
    expect(sessions.map((s) => s.id)).toEqual(['0830', '1630']);
  });
});

describe('getNextSessions', () => {
  it('returns upcoming sessions only, capped and sorted', () => {
    const sessions = getNextSessions(
      [
        makeAppointment({ id: 'tomorrow', scheduled_at: TOMORROW_0900 }),
        makeAppointment({ id: 'past', scheduled_at: TODAY_0830 }),
        makeAppointment({ id: 'now', scheduled_at: TODAY_1500 }),
        makeAppointment({ id: '1630', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'cancelled', status: 'cancelled', scheduled_at: TODAY_1630 }),
      ],
      NOW,
      2,
    );
    expect(sessions.map((s) => s.id)).toEqual(['now', '1630']);
  });
});

describe('getMonthlyVolume', () => {
  it('counts active sessions of the current Paris month and the honored share', () => {
    const volume = getMonthlyVolume(
      [
        makeAppointment({ id: '1', scheduled_at: TODAY_0830 }),
        makeAppointment({ id: '2', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: '3', status: 'cancelled', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: '4', status: 'declined', scheduled_at: TODAY_1500 }),
        makeAppointment({ id: 'other-month', scheduled_at: LAST_MONTH }),
      ],
      NOW,
    );
    expect(volume).toEqual({ total: 2, cancelled: 2, honoredSharePct: 50 });
  });

  it('returns null share for an empty month', () => {
    const volume = getMonthlyVolume(
      [makeAppointment({ scheduled_at: LAST_MONTH })],
      NOW,
    );
    expect(volume).toEqual({ total: 0, cancelled: 0, honoredSharePct: null });
  });
});

describe('getMinutesUntil', () => {
  it('rounds to whole minutes for a future session', () => {
    expect(getMinutesUntil(TODAY_1630, NOW)).toBe(90);
  });

  it('treats a session starting now as not-future', () => {
    expect(getMinutesUntil(TODAY_1500, NOW)).toBeNull();
  });

  it('returns null for a past session', () => {
    expect(getMinutesUntil(TODAY_0830, NOW)).toBeNull();
  });
});
