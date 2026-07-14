import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import {
  buildAndSendConfirmationEmails,
  type BuildAndSendOptions,
} from '@/lib/notifications';
import type { SendEmailParams, SendEmailResult } from '@/lib/resend';
import type { Appointment } from '@/types/appointment';

// ---------------------------------------------------------------------------
// sendFn double — injected via BuildAndSendOptions so the real sendEmail
// (which calls @react-email/render + Resend/SMTP) is fully bypassed.
// ---------------------------------------------------------------------------

const SUCCESS: SendEmailResult = { success: true, id: 're_123' };

function createSendFn(): Mock<[SendEmailParams], Promise<SendEmailResult>> {
  return vi.fn((_: SendEmailParams) => Promise.resolve(SUCCESS));
}

// ---------------------------------------------------------------------------
// Appointment factory — minimal valid record so the React email elements can
// be constructed (createElement only — render() is never invoked because
// sendFn is injected). Mirrors the Appointment interface 1:1.
// ---------------------------------------------------------------------------

function makeAppointment(
  overrides: Partial<Appointment> = {},
): Appointment {
  return {
    id: 'appt_001',
    patient_name: 'Jean Dupont',
    patient_email: 'jean.dupont@example.com',
    patient_phone: '+33612345678',
    patient_postal_code: '34000',
    patient_city: 'Montpellier',
    patient_reason: 'Anxiété',
    appointment_type: 'individual',
    appointment_mode: 'video',
    duration: 60,
    is_first_session: true,
    base_price: 8500,
    discount: 0,
    final_price: 8500,
    credit_applied: 0,
    scheduled_at: '2026-07-10T07:00:00.000Z',
    status: 'payment_received',
    stripe_payment_link_id: 'pl_test_001',
    stripe_payment_link_url: 'https://buy.stripe.com/test_001',
    stripe_payment_intent_id: 'pi_test_123',
    video_link: 'https://meet.google.com/abc-defg-hij',
    google_calendar_event_id: 'gcal_event_001',
    therapist_notes: null,
    rescheduled_to: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    deleted_at: null,
    // L2 idempotency flag (issue #68) — NULL = not yet delivered.
    confirmation_sent_at: null,
    ...overrides,
  };
}

// setup.ts stubs BETTER_AUTH_SECRET to 'test-secret' (11 chars), but
// secure-links.ts requires ≥32 chars. createSecureLinkToken is real source
// called inside buildAndSendConfirmationEmails (before our sendFn), so we
// override the env here with a sufficiently long value. Read happens at call
// time inside getSecureLinksSecret, so vi.stubEnv in beforeEach applies.
const TEST_AUTH_SECRET = 'x'.repeat(48);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BETTER_AUTH_SECRET', TEST_AUTH_SECRET);
});

describe('buildAndSendConfirmationEmails — idempotency key', () => {
  it('passes recipient-scoped idempotency keys to patient and therapist emails', async () => {
    // Arrange — issue #68 fix: keys MUST be scoped per recipient. Resend
    // deduplicates on key value (not body hash), so a shared key would
    // silently drop the second email as a "replay."
    const sendFn = createSendFn();
    const appointment = makeAppointment({ stripe_payment_intent_id: 'pi_test_123' });
    const options: BuildAndSendOptions = {
      sendFn,
      adminEmail: 'therapeute@example.com',
    };

    // Act
    await buildAndSendConfirmationEmails(appointment, options);

    // Assert — two sends, each with a recipient-scoped key
    expect(sendFn).toHaveBeenCalledTimes(2);
    const [patientCall, therapistCall] = sendFn.mock.calls;
    expect(patientCall[0].idempotencyKey).toBe('confirm:patient:pi_test_123');
    expect(therapistCall[0].idempotencyKey).toBe('confirm:therapist:pi_test_123');
  });

  it('uses distinct keys for patient and therapist (key-collision guard)', async () => {
    // Arrange — falsification check: if the recipient prefix were removed,
    // these two keys would be equal and the test would fail.
    const sendFn = createSendFn();
    const appointment = makeAppointment({ stripe_payment_intent_id: 'pi_test_456' });
    const options: BuildAndSendOptions = {
      sendFn,
      adminEmail: 'therapeute@example.com',
    };

    // Act
    await buildAndSendConfirmationEmails(appointment, options);

    // Assert
    const [patientCall, therapistCall] = sendFn.mock.calls;
    expect(patientCall[0].idempotencyKey).not.toBe(therapistCall[0].idempotencyKey);
  });

  it('omits the idempotency key (undefined) when stripe_payment_intent_id is null', async () => {
    // Arrange
    const sendFn = createSendFn();
    const appointment = makeAppointment({ stripe_payment_intent_id: null });
    const options: BuildAndSendOptions = {
      sendFn,
      adminEmail: 'therapeute@example.com',
    };

    // Act
    await buildAndSendConfirmationEmails(appointment, options);

    // Assert
    const [patientCall] = sendFn.mock.calls;
    expect(patientCall[0].idempotencyKey).toBeUndefined();
  });
});

describe('buildAndSendConfirmationEmails — result aggregation', () => {
  it('returns { patientEmailSent: true, therapistEmailSent: true } on full success', async () => {
    // Arrange
    const sendFn = createSendFn();
    const appointment = makeAppointment();
    const options: BuildAndSendOptions = {
      sendFn,
      adminEmail: 'therapeute@example.com',
    };

    // Act
    const result = await buildAndSendConfirmationEmails(appointment, options);

    // Assert
    expect(result).toEqual({ patientEmailSent: true, therapistEmailSent: true });
  });

  it('returns therapistEmailSent: false and only sends the patient email when adminEmail is omitted', async () => {
    // Arrange
    const sendFn = createSendFn();
    const appointment = makeAppointment();
    const options: BuildAndSendOptions = { sendFn };

    // Act
    const result = await buildAndSendConfirmationEmails(appointment, options);

    // Assert — patient send only, therapist flagged false
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0].to).toBe(appointment.patient_email);
    expect(result).toEqual({ patientEmailSent: true, therapistEmailSent: false });
  });

  it('does not crash the other send when one email rejects (Promise.allSettled)', async () => {
    // Arrange — patient send rejects, therapist send succeeds.
    // First call (patient) rejects, second call (therapist) resolves.
    const sendFn = createSendFn();
    sendFn
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ success: true, id: 're_456' });
    const appointment = makeAppointment();
    const options: BuildAndSendOptions = {
      sendFn,
      adminEmail: 'therapeute@example.com',
    };

    // Act — must NOT throw despite the rejection (allSettled swallows it).
    const result = await buildAndSendConfirmationEmails(appointment, options);

    // Assert — partial success reflected, no throw propagated.
    expect(result).toEqual({ patientEmailSent: false, therapistEmailSent: true });
  });

  it('returns patientEmailSent: false when sendFn resolves with {success: false} (not a throw)', async () => {
    // Arrange — issue #68 review: the real sendEmail returns {success:false}
    // on a permanent Resend 4xx WITHOUT throwing. The guard
    // `results[0].value?.success === true` must catch this. If the `=== true`
    // were deleted, this test would fail (patientEmailSent would be true).
    // This is the falsification test for the guard.
    const sendFn = createSendFn();
    sendFn
      .mockResolvedValueOnce({ success: false, error: 'validation_failed' })
      .mockResolvedValueOnce({ success: true, id: 're_789' });
    const appointment = makeAppointment();
    const options: BuildAndSendOptions = {
      sendFn,
      adminEmail: 'therapeute@example.com',
    };

    // Act
    const result = await buildAndSendConfirmationEmails(appointment, options);

    // Assert — patient send "succeeded" (resolved) but returned success:false.
    // The guard must detect this so confirmation_sent_at is NOT set.
    expect(result.patientEmailSent).toBe(false);
    expect(result.therapistEmailSent).toBe(true);
  });
});
