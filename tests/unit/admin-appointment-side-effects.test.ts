/**
 * RED tests (test-first, issue #126 / T5) defining the CONTRACT of
 * `processAppointmentSideEffects(appt, opts)` — the post-response pipeline
 * extracted from POST /api/admin/appointments/ (T6) and deferred via
 * `locals.netlify.context.waitUntil` by T7.
 *
 * These tests are RED today: the export does not exist in
 * `src/lib/notifications.ts` yet. They must turn GREEN after T6.
 *
 * Contract enforced below (T6 must implement identically):
 *
 *   processAppointmentSideEffects(appt, opts): Promise<void>
 *
 *   appt (inserted appointment row + execution context):
 *     - id: string
 *     - status: string ('payment_pending' | 'payment_received' | 'confirmed' | ...)
 *     - appointment_type: string
 *     - appointment_mode: 'video' | 'in-person'
 *     - duration: number                        // minutes
 *     - scheduled_at: string                    // ISO
 *     - patient_name: string
 *     - patient_email: string
 *     - final_price: number                     // cents
 *     - video_link?: string | null
 *     - google_calendar_event_id?: string | null
 *
 *   opts (DI — defaults = the app's real modules):
 *     - sendEmail: boolean                      // S3 gate
 *     - amountDueCents: number                  // S2 gate: video && > 0
 *     - successUrl?: string                     // Stripe success_url
 *     - baseUrl?: string                        // links base (DI like BuildAndSendOptions)
 *     - adminEmail?: string
 *     - createCalendarEvent?: typeof createCalendarEvent
 *     - createAppointmentPaymentLink?: typeof createAppointmentPaymentLink
 *     - sendFn?: typeof sendEmail
 *     - supabase?: { from(table): chainable update/eq/is }   // L2 flag writes
 *
 * Steps, in order, each isolated (an error is logged and does NOT stop the
 * pipeline):
 *   S1 calendar : createCalendarEvent (skip Meet creation when appt.video_link
 *                 is already set — withMeet:false — but still create the
 *                 standard event); persist event id (+ video_link if Meet).
 *   S2 stripe   : only when mode === 'video' && amountDueCents > 0 → payment
 *                 link + persisted stripe_payment_link_{id,url}.
 *   S3 email    : only when opts.sendEmail → sendFn with idempotencyKey
 *                 `invite:{appt.id}:patient` (Resend L1, ~24h TTL).
 *   flags (L2)  : set-once UPDATE ... .is('invitation_sent_at', null), plus
 *                 confirmation_sent_at in the SAME update when the email was
 *                 the confirmation (status 'payment_received').
 *
 * Per-step observability — exactly one log per step:
 *   console.info('[side-effects]', { step, appointmentId, ms, status })
 *   step ∈ 'calendar' | 'stripe' | 'email' | 'flags'
 *   status ∈ 'ok' | 'skipped' | 'error'
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted shared state (mock factories need it at hoist time) ------------

const h = vi.hoisted(() => {
  /**
   * Supabase-like stub for the L2 flag writes: chainable, CAPTURES update
   * payloads and the set-once `.is()` guards. Awaitable at the terminal link
   * (thenable resolving `{ data: null, error: null }`).
   *
   * C7: `failOnUpdates` makes the update at the given INDICES resolve with a
   * non-null `error` (persistence failure) — every other update succeeds.
   */
  const makeSupabaseLike = (failOnUpdates: number[] = []) => {
    const updates: Record<string, unknown>[] = [];
    const isCalls: { column: string; value: unknown }[] = [];
    const eqCalls: { column: string; value: unknown }[] = [];
    let currentUpdateIndex = -1;
    const chain: Record<string, unknown> = {
      update: (payload: Record<string, unknown>) => {
        currentUpdateIndex = updates.length;
        updates.push(payload);
        return chain;
      },
      select: () => chain,
      eq: (column: string, value: unknown) => {
        eqCalls.push({ column, value });
        return chain;
      },
      is: (column: string, value: unknown) => {
        isCalls.push({ column, value });
        return chain;
      },
      then: (resolve: unknown, reject: unknown) => {
        const error = failOnUpdates.includes(currentUpdateIndex)
          ? { message: `mock update failure at index ${currentUpdateIndex}` }
          : null;
        Promise.resolve({ data: null, error }).then(
          resolve as never,
          reject as never,
        );
      },
    };
    return {
      from: (_table: string) => chain,
      chain,
      updates,
      isCalls,
      eqCalls,
    };
  };

  return {
    makeSupabaseLike,
    sb: makeSupabaseLike(),
    createCalendarEvent: vi
      .fn()
      .mockResolvedValue({
        eventId: 'gcal_mock',
        meetLink: 'https://meet.example/x',
      }),
    createAppointmentPaymentLink: vi
      .fn()
      .mockResolvedValue({ id: 'pl_mock', url: 'https://pay.example/pl' }),
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
  };
});

// --- Mock the DEPENDENCIES (never the module under test) ---------------------

vi.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: (...a: unknown[]) => h.createCalendarEvent(...a),
}));
vi.mock('@/lib/stripe', () => ({
  createAppointmentPaymentLink: (...a: unknown[]) =>
    h.createAppointmentPaymentLink(...a),
}));
vi.mock('@/lib/resend', () => ({
  sendEmail: (...a: unknown[]) => h.sendEmail(...a),
  buildAppointmentConversationSubject: vi.fn((base: string) => base),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => h.sb.from(table) },
}));
vi.mock('@/lib/secure-links', () => ({
  createSecureLinkToken: vi.fn(() => 'tok_mock'),
}));
vi.mock('@/emails/AppointmentConfirmed', () => ({ default: () => null }));
vi.mock('@/emails/PaymentRequest', () => ({ default: () => null }));
vi.mock('@/emails/PaymentReceivedNotification', () => ({
  default: () => null,
}));

// --- Import the REAL module under test (missing export → RED) ----------------

import { processAppointmentSideEffects } from '@/lib/notifications';
// C2: spied module mock — assert the signingSecret DI seam reaches the HMAC
// signer (the real createSecureLinkToken throws in pure Node without a secret).
import { createSecureLinkToken } from '@/lib/secure-links';

// --- Fixtures ----------------------------------------------------------------

const baseAppointment = {
  id: 'appt_side_001',
  status: 'payment_pending',
  appointment_type: 'individual',
  appointment_mode: 'video',
  duration: 60,
  scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
  patient_name: 'Jeanne Dupont',
  patient_email: 'jeanne.dupont@example.com',
  final_price: 6000,
  video_link: null,
  google_calendar_event_id: null,
};

function makeOpts(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sendEmail: true,
    amountDueCents: 6000,
    successUrl: 'https://omf-therapie.fr/rdv/merci/?source=payment-success',
    baseUrl: 'https://omf-therapie.fr',
    supabase: h.sb,
    ...overrides,
  };
}

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.sb = h.makeSupabaseLike();
  h.createCalendarEvent.mockResolvedValue({
    eventId: 'gcal_mock',
    meetLink: 'https://meet.example/x',
  });
  h.createAppointmentPaymentLink.mockResolvedValue({
    id: 'pl_mock',
    url: 'https://pay.example/pl',
  });
  h.sendEmail.mockResolvedValue({ success: true });
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Side-effect logs only: console.info('[side-effects]', {...}). */
function sideEffectLogs(): {
  step: string;
  appointmentId: string;
  ms: number;
  status: string;
}[] {
  return infoSpy.mock.calls
    .filter(call => call[0] === '[side-effects]')
    .map(
      call =>
        call[1] as {
          step: string;
          appointmentId: string;
          ms: number;
          status: string;
        },
    );
}

// ---------------------------------------------------------------------------
// S1 → S2 → S3 ordering + per-step logs
// ---------------------------------------------------------------------------
describe('processAppointmentSideEffects (issue #126 / T6)', () => {
  it('runs calendar, then stripe, then email in order for a video appointment with a balance due', async () => {
    // Arrange — shared order recorder pushed by each external call.
    const order: string[] = [];
    h.createCalendarEvent.mockImplementation(async () => {
      order.push('calendar');
      return { eventId: 'gcal_1', meetLink: 'https://meet.example/1' };
    });
    h.createAppointmentPaymentLink.mockImplementation(async () => {
      order.push('stripe');
      return { id: 'pl_1', url: 'https://pay.example/1' };
    });
    h.sendEmail.mockImplementation(async () => {
      order.push('email');
      return { success: true };
    });

    // Act
    await processAppointmentSideEffects({ ...baseAppointment }, makeOpts());

    // Assert — strict S1 → S2 → S3 ordering.
    expect(order).toEqual(['calendar', 'stripe', 'email']);

    // One structured log per step + the flags step, in order, with the
    // documented fields ({ step, appointmentId, ms, status }).
    const logs = sideEffectLogs();
    expect(logs.map(l => l.step)).toEqual([
      'calendar',
      'stripe',
      'email',
      'flags',
    ]);
    for (const log of logs) {
      expect(log.appointmentId).toBe('appt_side_001');
      expect(typeof log.ms).toBe('number');
      expect(['ok', 'skipped', 'error']).toContain(log.status);
    }
    expect(logs.map(l => l.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  // -------------------------------------------------------------------------
  // sendEmail: false → S1 + S2 still run, S3 never does, flags still set
  // -------------------------------------------------------------------------
  it('skips the email but still runs calendar and stripe when sendEmail is false', async () => {
    // Act
    await processAppointmentSideEffects(
      { ...baseAppointment },
      makeOpts({ sendEmail: false }),
    );

    // Assert — S1 and S2 executed…
    expect(h.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(h.createAppointmentPaymentLink).toHaveBeenCalledTimes(1);
    // …S3 NEVER (no email provider contact)…
    expect(h.sendEmail).not.toHaveBeenCalled();
    // …email logged as skipped, other steps ok…
    const logs = sideEffectLogs();
    expect(logs.find(l => l.step === 'email')?.status).toBe('skipped');
    expect(logs.find(l => l.step === 'calendar')?.status).toBe('ok');
    expect(logs.find(l => l.step === 'stripe')?.status).toBe('ok');
    // …and the L2 flag is still written set-once (invitation_sent_at IS NULL).
    const flagged = h.sb.updates.filter(u => !!u.invitation_sent_at);
    expect(flagged.length).toBeGreaterThan(0);
    expect(h.sb.isCalls).toContainEqual({
      column: 'invitation_sent_at',
      value: null,
    });
  });

  // -------------------------------------------------------------------------
  // Idempotence L1 — `invite:{id}:patient` passed to sendFn
  // -------------------------------------------------------------------------
  it('passes the idempotency key invite:{id}:patient to the email send function', async () => {
    // Act
    await processAppointmentSideEffects({ ...baseAppointment }, makeOpts());

    // Assert — exact Resend idempotencyKey option (src/lib/resend.ts field).
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const params = h.sendEmail.mock.calls[0][0] as { idempotencyKey?: string };
    expect(params.idempotencyKey).toBe('invite:appt_side_001:patient');
  });

  // -------------------------------------------------------------------------
  // video_link already provided → no Meet creation, but standard event kept
  // -------------------------------------------------------------------------
  it('still creates a standard calendar event without Meet when video_link is already set', async () => {
    // Act
    await processAppointmentSideEffects(
      {
        ...baseAppointment,
        video_link: 'https://meet.google.com/pre-existing',
      },
      makeOpts(),
    );

    // Assert — S1 runs, but withMeet:false (no second Meet link).
    expect(h.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(h.createCalendarEvent.mock.calls[0][0]).toMatchObject({
      withMeet: false,
    });
  });

  // -------------------------------------------------------------------------
  // Step isolation — calendar failure never blocks stripe/email/flags
  // -------------------------------------------------------------------------
  it('continues with stripe, email and flags when the calendar step throws', async () => {
    // Arrange
    h.createCalendarEvent.mockRejectedValue(new Error('gcal down'));

    // Act — must not reject.
    await expect(
      processAppointmentSideEffects({ ...baseAppointment }, makeOpts()),
    ).resolves.toBeUndefined();

    // Assert — calendar logged as error, the rest of the pipeline ran anyway.
    const logs = sideEffectLogs();
    expect(logs.find(l => l.step === 'calendar')?.status).toBe('error');
    expect(logs.find(l => l.step === 'stripe')?.status).toBe('ok');
    expect(logs.find(l => l.step === 'email')?.status).toBe('ok');
    expect(h.createAppointmentPaymentLink).toHaveBeenCalledTimes(1);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    // The cron sweep relies on the set-once flag being written.
    const flagged = h.sb.updates.filter(u => !!u.invitation_sent_at);
    expect(flagged.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // payment_received → single set-once update carries BOTH L2 flags
  // -------------------------------------------------------------------------
  it('sets invitation_sent_at and confirmation_sent_at together when status is payment_received', async () => {
    // Arrange — video RDV fully covered by credit: nothing due, already paid.
    // The invitation email IS the confirmation.
    const opts = makeOpts({ sendEmail: true, amountDueCents: 0 });

    // Act
    await processAppointmentSideEffects(
      { ...baseAppointment, status: 'payment_received' },
      opts,
    );

    // Assert — no Stripe (nothing due), email sent, ONE update with both flags.
    expect(h.createAppointmentPaymentLink).not.toHaveBeenCalled();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const flagged = h.sb.updates.filter(
      u => !!u.invitation_sent_at && !!u.confirmation_sent_at,
    );
    expect(flagged.length).toBeGreaterThan(0);
    expect(h.sb.isCalls).toContainEqual({
      column: 'invitation_sent_at',
      value: null,
    });
  });

  // -------------------------------------------------------------------------
  // C2 — signingSecret DI seam reaches the .ics HMAC signer (cron runtime)
  // -------------------------------------------------------------------------
  it('forwards opts.signingSecret to createSecureLinkToken for the .ics invite (C2)', async () => {
    const secret = 'x'.repeat(44);
    await processAppointmentSideEffects(
      { ...baseAppointment, status: 'payment_received' },
      makeOpts({ sendEmail: true, amountDueCents: 0, signingSecret: secret }),
    );

    // The AppointmentConfirmed branch signs an .ics invite token. Without the
    // seam, createSecureLinkToken reads import.meta.env (absent in the cron
    // runtime) and THROWS — killing the email step of every swept row.
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(createSecureLinkToken).mock.calls[0][0];
    expect(callArg.secret).toBe(secret);
  });

  it('omits the secret key entirely when signingSecret is not provided (Astro runtime)', async () => {
    await processAppointmentSideEffects(
      { ...baseAppointment, status: 'payment_received' },
      makeOpts({ sendEmail: true, amountDueCents: 0 }),
    );

    const callArg = vi.mocked(createSecureLinkToken).mock.calls[0][0];
    expect('secret' in callArg).toBe(false);
  });

  // -------------------------------------------------------------------------
  // C4 — S2 idempotency: an existing stripe_payment_link_url is REUSED
  // -------------------------------------------------------------------------
  it('never creates a second payment link when stripe_payment_link_url already exists (C4)', async () => {
    // Act — video RDV with a balance due BUT an existing payment link.
    await processAppointmentSideEffects(
      {
        ...baseAppointment,
        stripe_payment_link_id: 'pl_existing',
        stripe_payment_link_url: 'https://pay.example/existing',
      },
      makeOpts(),
    );

    // Assert — no second Stripe link (cascade), step logged as skipped…
    expect(h.createAppointmentPaymentLink).not.toHaveBeenCalled();
    expect(sideEffectLogs().find(l => l.step === 'stripe')?.status).toBe(
      'skipped',
    );
    // …the email leaves with the EXISTING URL…
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const params = h.sendEmail.mock.calls[0][0] as {
      react?: { props?: { stripePaymentUrl?: string } };
    };
    expect(params.react?.props?.stripePaymentUrl).toBe(
      'https://pay.example/existing',
    );
    // …and the L2 flags are still written (email delivered).
    expect(
      h.sb.updates.filter(u => !!u.invitation_sent_at).length,
    ).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // C7 — S1/S2 persistence failures: step error observable, flags stay NULL
  // -------------------------------------------------------------------------
  it('logs the calendar step as error and leaves L2 flags NULL when the S1 persistence update fails (C7)', async () => {
    // Arrange — update #0 is the S1 google_calendar_event_id persistence write.
    h.sb = h.makeSupabaseLike([0]);

    // Act — must resolve (runStep isolates the throw).
    await expect(
      processAppointmentSideEffects({ ...baseAppointment }, makeOpts()),
    ).resolves.toBeUndefined();

    // Assert — calendar logs error, the pipeline continues (stripe + email
    // still run)…
    const logs = sideEffectLogs();
    expect(logs.find(l => l.step === 'calendar')?.status).toBe('error');
    expect(logs.find(l => l.step === 'stripe')?.status).toBe('ok');
    expect(logs.find(l => l.step === 'email')?.status).toBe('ok');
    // …but NO flag update is issued afterwards — the cron sweep must retry
    // the row (otherwise the event id would be lost forever).
    expect(logs.find(l => l.step === 'flags')?.status).toBe('skipped');
    expect(
      h.sb.updates.filter(u => 'invitation_sent_at' in u),
    ).toHaveLength(0);
  });

  it('logs the stripe step as error and leaves L2 flags NULL when the S2 persistence update fails (C7)', async () => {
    // Arrange — update #1 is the S2 stripe_payment_link_{id,url} write.
    h.sb = h.makeSupabaseLike([1]);

    // Act — must resolve.
    await expect(
      processAppointmentSideEffects({ ...baseAppointment }, makeOpts()),
    ).resolves.toBeUndefined();

    // Assert — stripe persistence failed → no paymentLinkUrl → the
    // PaymentRequest email cannot leave → email error → flags skipped.
    const logs = sideEffectLogs();
    expect(logs.find(l => l.step === 'stripe')?.status).toBe('error');
    expect(logs.find(l => l.step === 'email')?.status).toBe('error');
    expect(logs.find(l => l.step === 'flags')?.status).toBe('skipped');
    expect(
      h.sb.updates.filter(u => 'invitation_sent_at' in u),
    ).toHaveLength(0);
  });
});
