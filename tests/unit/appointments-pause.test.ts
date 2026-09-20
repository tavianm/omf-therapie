/**
 * POST /api/appointments/ — booking-pause guard (issue #184).
 *
 * BOOKING_OPEN=false must disable the PUBLIC booking endpoint before any
 * side effect: hiding the wizard is presentation, not enforcement (cached
 * bundles, direct calls). Exercises the real handler with a synthetic
 * Request (direct call, no HTTP layer):
 *   - paused → 503 with the exact BOOKING_PAUSED_MESSAGE, and the gate fires
 *     BEFORE body parsing (non-JSON body still 503, not 400) and before any
 *     DB write / email (supabase.from and sendEmail never called)
 *   - open → the same requests pass the gate and reach the pre-existing
 *     behaviour (422 field validation / 400 invalid JSON body)
 *
 * Like e2e/smoke.spec.ts, every assertion branches on the REAL imported
 * const: flipping BOOKING_OPEN back to true makes the suite resume asserting
 * the open contract with zero edits (cf. reopen runbook in
 * src/config/booking.config.ts).
 *
 * Mock boundaries: supabaseAdmin (DB) and resend (emails) — the key
 * assertion is that they stay untouched. checkRateLimit stays REAL
 * (in-memory, far under the 5/15min limit here).
 */
import { describe, expect, it, vi } from 'vitest';
import { BOOKING_OPEN, BOOKING_PAUSED_MESSAGE } from '@/config/booking.config';

const h = vi.hoisted(() => ({
  from: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: h.from },
}));

vi.mock('@/lib/resend', () => ({
  sendEmail: h.sendEmail,
  buildAppointmentConversationSubject: (subject: string) => subject,
}));

type PostHandler = import('@/pages/api/appointments/index')['POST'];

async function callPost(
  body: BodyInit,
  contentType: string,
): Promise<Response> {
  const { POST } = await import('@/pages/api/appointments/index');
  return POST({
    request: new Request('https://example.test/api/appointments/', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }),
    url: 'https://example.test/api/appointments/',
  } as Parameters<PostHandler>[0]);
}

describe('POST /api/appointments/ — garde de pause (BOOKING_OPEN)', () => {
  it('corps JSON : 503 message de pause (fermé) ou validation champs (ouvert)', async () => {
    const res = await callPost(
      JSON.stringify({ patient_name: 'Patiente Test' }),
      'application/json',
    );

    if (BOOKING_OPEN) {
      // Open: the request sails past the pause gate and fails validation.
      expect(res.status).toBe(422);
      const payload = (await res.json()) as { error?: string; field?: string };
      expect(payload.error).toBe('Adresse email invalide');
      expect(payload.field).toBe('patient_email');
      return;
    }

    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/json');

    const payload = (await res.json()) as { error?: string; field?: string };
    expect(payload.error).toBe(BOOKING_PAUSED_MESSAGE);
    expect(payload.error).toContain('congé maternité');
    expect(payload.field).toBeUndefined();
  });

  it('corps non-JSON : la garde précède le parse (503 fermé, 400 ouvert)', async () => {
    const res = await callPost('not json', 'text/plain');

    // Paused → 503 (gate order proof); open → the pre-existing 400.
    expect(res.status).toBe(BOOKING_OPEN ? 400 : 503);
  });

  it('aucun effet de bord pendant la pause — ni écriture BD ni email', async () => {
    await callPost(
      JSON.stringify({ patient_name: 'Patiente Test' }),
      'application/json',
    );

    // Holds in BOTH states at this point of the flow (paused: gate; open:
    // 422 before any persistence) — the paused state is the one that must
    // never reach these boundaries.
    expect(h.from).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});
