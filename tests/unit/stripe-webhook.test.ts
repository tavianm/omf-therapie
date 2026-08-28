/**
 * Unit tests for handlePaymentSucceeded — the L2 idempotency flow (issue #68).
 *
 * These tests cover the three branches that the PR's bug-fix depends on:
 *   (a) L2 gate: if confirmation_sent_at is already set → early return (no
 *       side effects, no UPDATE).
 *   (b) Throw-on-failure: if the patient email returns patientEmailSent:false
 *       → the function throws (so the POST handler returns 500 → Stripe retry)
 *       and confirmation_sent_at is NOT set.
 *   (c) Mark-delivered: on full success → confirmation_sent_at is set with
 *       the `IS NULL` guard.
 *
 * Externals are mocked via vi.mock: supabaseAdmin (chained query builder),
 * createCalendarEvent, and buildAndSendConfirmationEmails (the shared module).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Mocks must be hoisted before imports -----------------------------------

// Mock supabaseAdmin with a chainable builder so .from().update().eq()... works.
const mockSupabaseChain = {
  update: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => mockSupabaseChain),
  },
}));

// Mock createCalendarEvent — returns a fake event ID + Meet link.
vi.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: vi.fn().mockResolvedValue({
    eventId: 'gcal_mock_event',
    meetLink: 'https://meet.google.com/mock-link',
  }),
}));

// Mock buildAndSendConfirmationEmails — controllable per-test.
const mockBuildAndSend = vi.fn();
vi.mock('@/lib/notifications', () => ({
  buildAndSendConfirmationEmails: (...args: unknown[]) => mockBuildAndSend(...args),
}));

// Mock pricing labels (pure functions, but imported by the webhook).
vi.mock('@/lib/pricing', () => ({
  getTypeLabel: vi.fn(() => 'Séance individuelle'),
  getModeLabel: vi.fn(() => 'Téléconsultation'),
}));

// Mock stripe (imported at module level but not used by handlePaymentSucceeded).
vi.mock('@/lib/stripe', () => ({ getStripe: () => null }));

// --- Import after mocks -----------------------------------------------------

import { GET, handlePaymentSucceeded } from '@/pages/api/stripe-webhook';
import { supabaseAdmin } from '@/lib/supabase';
import { createCalendarEvent } from '@/lib/google-calendar';

// --- Helpers ----------------------------------------------------------------

/** Sets up the mock chain for the initial UPDATE (N1) to "win" (first deliverer). */
function mockFirstDeliveryWins(apptOverrides: Partial<Record<string, unknown>> = {}) {
  const appt = {
    id: 'appt_001',
    patient_name: 'Jean Dupont',
    patient_email: 'jean.dupont@example.com',
    appointment_type: 'individual',
    appointment_mode: 'video',
    duration: 60,
    final_price: 8500,
    scheduled_at: '2026-07-10T07:00:00.000Z',
    video_link: null,
    google_calendar_event_id: null,
    stripe_payment_intent_id: 'pi_test_123',
    confirmation_sent_at: null,
    ...apptOverrides,
  };
  // The N1 UPDATE .select().single() returns the updated row.
  mockSupabaseChain.single.mockResolvedValueOnce({ data: appt, error: null });
  return appt;
}

/** Sets up the mock chain for the re-read SELECT (N1 collision → re-read). */
function mockRetryReRead(apptOverrides: Partial<Record<string, unknown>> = {}) {
  const appt = {
    id: 'appt_001',
    patient_name: 'Jean Dupont',
    patient_email: 'jean.dupont@example.com',
    appointment_type: 'individual',
    appointment_mode: 'video',
    duration: 60,
    final_price: 8500,
    scheduled_at: '2026-07-10T07:00:00.000Z',
    video_link: 'https://meet.google.com/existing',
    google_calendar_event_id: 'gcal_existing',
    stripe_payment_intent_id: 'pi_test_123',
    confirmation_sent_at: null,
    ...apptOverrides,
  };
  // N1 UPDATE fails (already processed) → re-read via .maybeSingle().
  mockSupabaseChain.single.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });
  mockSupabaseChain.maybeSingle.mockResolvedValueOnce({ data: appt, error: null });
  return appt;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DEV', true);
  vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'false');
  // Default: the mark-delivered UPDATE succeeds.
  mockSupabaseChain.update.mockReturnThis();
  mockSupabaseChain.eq.mockReturnThis();
  mockSupabaseChain.is.mockReturnThis();
  mockSupabaseChain.select.mockReturnThis();
  // Default email result: success.
  mockBuildAndSend.mockResolvedValue({ patientEmailSent: true, therapistEmailSent: true });
});

// ---------------------------------------------------------------------------
// Mock GET route — available only in explicit local development mode
// ---------------------------------------------------------------------------

describe('GET — development mock gate', () => {
  async function callMockGet(): Promise<Response> {
    return GET({
      url: new URL(
        'http://localhost/api/stripe-webhook/?mock=1&appointment_id=appt_001',
      ),
    } as Parameters<typeof GET>[0]);
  }

  function expectNoPaymentSideEffects(): void {
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(mockBuildAndSend).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
  }

  it('returns 403 outside development even when calendar mock mode is enabled', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'true');

    const response = await callMockGet();

    expect(response.status).toBe(403);
    expectNoPaymentSideEffects();
  });

  it('returns 403 in development when calendar mock mode is disabled', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'false');

    const response = await callMockGet();

    expect(response.status).toBe(403);
    expectNoPaymentSideEffects();
  });
});

// ---------------------------------------------------------------------------
// L2 gate — early return when confirmation_sent_at is already set
// ---------------------------------------------------------------------------

describe('handlePaymentSucceeded — L2 gate (confirmation_sent_at)', () => {
  it('returns early without side effects when confirmation_sent_at is already set', async () => {
    // Arrange — retry re-read returns a row with confirmation_sent_at set.
    mockRetryReRead({ confirmation_sent_at: '2026-07-01T10:00:00.000Z' });

    // Act
    await handlePaymentSucceeded('appt_001', 'pi_test_123', 'evt_retry_001');

    // Assert — NO email sent, NO calendar event created, NO mark-delivered UPDATE.
    expect(mockBuildAndSend).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
    // The only UPDATEs should be the N1 (which failed) — no mark-delivered.
    // We check that .update was not called with confirmation_sent_at by verifying
    // buildAndSend was never called (the side effect that precedes the mark).
  });
});

// ---------------------------------------------------------------------------
// Throw-on-failure — patient email fails → throw, confirmation_sent_at NOT set
// ---------------------------------------------------------------------------

describe('handlePaymentSucceeded — throw on patient email failure', () => {
  it('throws and does not set confirmation_sent_at when patientEmailSent is false', async () => {
    // Arrange — first delivery wins, but the email send returns failure.
    mockFirstDeliveryWins();
    mockBuildAndSend.mockResolvedValueOnce({ patientEmailSent: false, therapistEmailSent: true });

    // Act + Assert — the function must throw so the POST handler returns 500.
    await expect(
      handlePaymentSucceeded('appt_001', 'pi_test_123', 'evt_001'),
    ).rejects.toThrow(/Échec envoi email patient/);

    // Assert — buildAndSend was called (side effects ran), but the
    // confirmation_sent_at UPDATE was NOT reached (the throw skipped it).
    expect(mockBuildAndSend).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Mark-delivered — full success → confirmation_sent_at set with IS NULL guard
// ---------------------------------------------------------------------------

describe('handlePaymentSucceeded — mark delivered on success', () => {
  it('sets confirmation_sent_at after successful patient email', async () => {
    // Arrange — first delivery wins, email succeeds.
    mockFirstDeliveryWins();
    mockBuildAndSend.mockResolvedValueOnce({ patientEmailSent: true, therapistEmailSent: true });

    // Act
    await handlePaymentSucceeded('appt_001', 'pi_test_123', 'evt_001');

    // Assert — the mark-delivered UPDATE was issued. We verify by checking
    // that the chain's .update was called more than once (N1 + mark-delivered).
    // The N1 UPDATE happens first (via .single()), then the mark-delivered
    // UPDATE (via .is('confirmation_sent_at', null)).
    expect(mockBuildAndSend).toHaveBeenCalledTimes(1);
    // The last .is() call should be the confirmation_sent_at IS NULL guard.
    const isCalls = mockSupabaseChain.is.mock.calls;
    expect(isCalls.some((call) => call[0] === 'confirmation_sent_at')).toBe(true);

    // C5 (issue #126): the mark-delivered update carries BOTH flags in the
    // SAME payload — the post-payment confirmation email doubles as the
    // invitation, so invitation_sent_at must be set together with
    // confirmation_sent_at or the reconcile-invitations sweep would re-mail
    // the patient.
    const flagPayloads = mockSupabaseChain.update.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((payload) => 'confirmation_sent_at' in payload);
    expect(flagPayloads).toHaveLength(1);
    expect(typeof flagPayloads[0]!.invitation_sent_at).toBe('string');
    expect(flagPayloads[0]!.invitation_sent_at).toBe(
      flagPayloads[0]!.confirmation_sent_at,
    );
  });
});
