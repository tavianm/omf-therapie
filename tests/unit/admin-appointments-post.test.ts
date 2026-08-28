/**
 * RED tests (test-first, issue #126 / T2) for POST /api/admin/appointments/ —
 * L2 `invitation_sent_at` flag-setting.
 *
 * Expected behaviour AFTER T3 (implementation):
 *   (a) send_email:true + sendEmail resolves → an UPDATE sets
 *       invitation_sent_at (non-null) after the email succeeds.
 *   (b) payment_received via credit (use_credit covers the balance) → the same
 *       UPDATE also sets confirmation_sent_at.
 *   (c) send_email:false → invitation_sent_at is set directly in the INSERT
 *       payload and sendEmail is never called.
 *
 * These tests are RED on the current code (no invitation_sent_at anywhere) and
 * must turn GREEN after T3. All externals (DB, auth, email, Stripe, calendar)
 * are mocked via vi.mock — the handler itself is the real module.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Hoisted shared state (mock factories need it at hoist time) ------------

const h = vi.hoisted(() => {
  /**
   * Factory: chainable supabaseAdmin mock that CAPTURES insert/update payloads.
   * Kept reusable for the V2/V3 test waves (set-once WHERE ... IS NULL guards).
   */
  const makeSupabaseMock = (appointment: Record<string, unknown> = {}) => {
    const row = {
      id: 'appt_test_001',
      patient_name: 'Jeanne Dupont',
      patient_email: 'jeanne.dupont@example.com',
      appointment_type: 'individual',
      appointment_mode: 'in-person',
      duration: 60,
      final_price: 6000,
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      video_link: null,
      google_calendar_event_id: null,
      ...appointment,
    };
    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const chain = {
      insert: (payload: Record<string, unknown>) => {
        inserts.push(payload);
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return chain;
      },
      delete: () => chain,
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      // Terminal calls must resolve like PostgrestBuilder.
      limit: () => Promise.resolve({ data: [], error: null }),
      single: () => Promise.resolve({ data: row, error: null }),
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
    };
    return {
      supabaseAdmin: { from: vi.fn(() => chain) },
      chain,
      inserts,
      updates,
      row,
    };
  };

  return {
    makeSupabaseMock,
    sb: makeSupabaseMock(),
    getSession: vi.fn(),
    isAdminSession: vi.fn(() => true),
    sendEmail: vi.fn(),
    getAvailableCredit: vi.fn().mockResolvedValue(0),
    consumeCredits: vi.fn().mockResolvedValue(undefined),
    createAppointmentPaymentLink: vi.fn(),
    createCalendarEvent: vi.fn().mockResolvedValue({ eventId: 'gcal_mock', meetLink: null }),
    hasAppointmentConflict: vi.fn().mockResolvedValue(false),
    isCabinetEligibleSlot: vi.fn().mockResolvedValue(true),
    invalidateAvailabilityCache: vi.fn().mockResolvedValue(undefined),
  };
});

// --- Mocks (hoisted before importing the handler) ---------------------------

// Indirection: `h.sb` is swapped per-test in beforeEach, so resolve at call time.
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => h.sb.supabaseAdmin.from(table) },
}));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: unknown[]) => h.getSession(...a) } },
}));
vi.mock('@/lib/authz', () => ({
  isAdminSession: (...a: unknown[]) => h.isAdminSession(...a),
}));
vi.mock('@/lib/pricing', () => ({
  calculatePrice: vi.fn(() => ({ basePrice: 60, discount: 0, finalPrice: 60 })),
}));
vi.mock('@/lib/credits', () => ({
  getAvailableCredit: (...a: unknown[]) => h.getAvailableCredit(...a),
  consumeCredits: (...a: unknown[]) => h.consumeCredits(...a),
}));
vi.mock('@/lib/resend', () => ({
  sendEmail: (...a: unknown[]) => h.sendEmail(...a),
  buildAppointmentConversationSubject: vi.fn((base: string) => base),
}));
vi.mock('@/lib/stripe', () => ({
  createAppointmentPaymentLink: (...a: unknown[]) => h.createAppointmentPaymentLink(...a),
}));
vi.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: (...a: unknown[]) => h.createCalendarEvent(...a),
}));
vi.mock('@/lib/appointment-conflicts', () => ({
  hasAppointmentConflict: (...a: unknown[]) => h.hasAppointmentConflict(...a),
}));
vi.mock('@/lib/appointment-eligibility', () => ({
  isCabinetEligibleSlot: (...a: unknown[]) => h.isCabinetEligibleSlot(...a),
}));
// The source imports with an explicit `.js` extension — mock BOTH specifiers.
vi.mock('@/lib/calendar-cache', () => ({
  invalidateAvailabilityCache: (...a: unknown[]) => h.invalidateAvailabilityCache(...a),
}));
vi.mock('@/lib/calendar-cache.js', () => ({
  invalidateAvailabilityCache: (...a: unknown[]) => h.invalidateAvailabilityCache(...a),
}));
vi.mock('@/lib/secure-links', () => ({ createSecureLinkToken: vi.fn(() => 'tok_mock') }));
vi.mock('@/lib/ics', () => ({
  generateGoogleCalendarLink: vi.fn(() => 'https://cal.example/g'),
  generateOutlookCalendarLink: vi.fn(() => 'https://cal.example/o'),
  generateAppleCalendarInviteLink: vi.fn(() => 'https://cal.example/a'),
  CABINET_ADDRESS: '1 rue du Cabinet, 75000 Paris',
}));
vi.mock('@/emails/AppointmentConfirmed', () => ({ default: () => null }));
vi.mock('@/emails/PaymentRequest', () => ({ default: () => null }));

// --- Import the handler AFTER mocks ------------------------------------------

import { POST } from '@/pages/api/admin/appointments';

// --- Helpers -----------------------------------------------------------------

function makeRequest(payload: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/appointments/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patient_name: 'Jeanne Dupont',
      patient_email: 'jeanne.dupont@example.com',
      patient_phone: '0612345678',
      appointment_type: 'individual',
      appointment_mode: 'in-person',
      duration: 60,
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      patient_reason: 'Suivi',
      ...payload,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sb = h.makeSupabaseMock();
  h.getSession.mockResolvedValue({ user: { id: 'admin_001', email: 'pro@omf-therapie.fr' } });
  h.isAdminSession.mockReturnValue(true);
  h.sendEmail.mockResolvedValue({ success: true });
  h.getAvailableCredit.mockResolvedValue(0);
  h.consumeCredits.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// (a) send_email: true → UPDATE sets invitation_sent_at after email success
// ---------------------------------------------------------------------------
describe('POST /api/admin/appointments/ — invitation_sent_at flags (issue #126)', () => {
  it('sets invitation_sent_at via an UPDATE after sendEmail succeeds when send_email is true', async () => {
    // Arrange
    const request = makeRequest({ send_email: true });

    // Act
    const response = await POST({ request, url: request.url } as never);
    expect(response.status).toBe(201);

    // Assert — the email was sent AND an UPDATE carried a non-null
    // invitation_sent_at (mark-delivered after the successful send).
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const flagged = h.sb.updates.filter((u) => !!u.invitation_sent_at);
    expect(flagged.length).toBeGreaterThan(0);
    expect(typeof flagged[0].invitation_sent_at).toBe('string');
  });

  // -------------------------------------------------------------------------
  // (b) payment_received via avoir → same UPDATE also sets confirmation_sent_at
  // -------------------------------------------------------------------------
  it('sets both invitation_sent_at and confirmation_sent_at when a credit fully covers a video appointment', async () => {
    // Arrange — video RDV, use_credit:true, available credit covers the full
    // 6000 cents price → amount due 0 → status payment_received.
    const request = makeRequest({
      appointment_mode: 'video',
      send_email: true,
      use_credit: true,
    });
    h.getAvailableCredit.mockResolvedValue(6000);
    h.consumeCredits.mockResolvedValue({ consumed: 6000 });

    // Act
    const response = await POST({ request, url: request.url } as never);
    expect(response.status).toBe(201);
    expect(h.sb.inserts[0].status).toBe('payment_received');

    // Assert — one UPDATE sets BOTH L2 flags (séance réglée par avoir).
    const flagged = h.sb.updates.filter(
      (u) => !!u.invitation_sent_at && !!u.confirmation_sent_at,
    );
    expect(flagged.length).toBeGreaterThan(0);
    expect(typeof flagged[0].invitation_sent_at).toBe('string');
    expect(typeof flagged[0].confirmation_sent_at).toBe('string');
  });

  // -------------------------------------------------------------------------
  // (c) send_email: false → invitation_sent_at in the INSERT, sendEmail never called
  // -------------------------------------------------------------------------
  it('sets invitation_sent_at in the INSERT payload and never calls sendEmail when send_email is false', async () => {
    // Arrange
    const request = makeRequest({ send_email: false });

    // Act
    const response = await POST({ request, url: request.url } as never);
    expect(response.status).toBe(201);

    // Assert — the flag is carried by the INSERT (no email will ever be sent)
    // and the email provider is never contacted.
    expect(h.sb.inserts.length).toBeGreaterThan(0);
    expect(typeof h.sb.inserts[0].invitation_sent_at).toBe('string');
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});
