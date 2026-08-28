import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// RED tests — T10 defines the CONTRACT of the T13 scheduled function
// `netlify/functions/reconcile-invitations.ts` (issue #126, slice 3).
//
// The module does NOT exist yet: every test in this file is expected to FAIL
// at import ("module not found") until T13 lands. Once implemented, these
// tests pin down:
//
//   1. Exports: callable default `handler` + named `config` with literal
//      schedule `'20 * * * *'` (offset from #98's `'5 * * * *'`).
//   2. Sentry wiring: `initSentry()` BEFORE `Sentry.withMonitor(
//      'reconcile-invitations', …, { checkInMargin: 5, maxRuntime: 10 })`
//      (patterns #75/#113).
//   3. Constants: DEADLINE_MS = 8500, BATCH_LIMIT = 25, 48 h created_at window.
//   4. Eligibility query on `appointments` — every filter asserted on the
//      mock query chain (see the payment_received deviation note below).
//   5. Per-row DELEGATION to `processAppointmentSideEffects(appt, opts)` with
//      `sendEmail: true` and `amountDueCents: 0` for payment_received (avoir)
//      else `final_price` (cents).
//   6. GOOGLE_CALENDAR_MOCK=true → injected no-op createCalendarEvent that
//      console.warns; the real calendar module is never called; the rest of
//      the per-row reconciliation continues.
//   7. Poison-escape (makeSendFnWithCapture pattern #98): non-retryable Resend
//      4xx on the patient email → the sweep itself sets `invitation_sent_at`
//      (set-once `.is('invitation_sent_at', null)` guard) + error log;
//      retryable 5xx → flag left NULL for the next hourly pass.
//   8. Deadline: the loop stops at now() + DEADLINE_MS (remaining rows are
//      deferred to the next hourly pass).
//   9. Per-row isolation: one throwing row does not block the batch.
//  10. Logs without PII (never the patient email address).
//
// Conventions mirror `tests/unit/cron-handlers.test.ts` (mock leaves, env
// stubs, withMonitor passthrough mock) and the #98 sweep
// `netlify/functions/reconcile-confirmations.ts`.
// ---------------------------------------------------------------------------

// --- Sentry passthrough mock (same contract as cron-handlers.test.ts) -------
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  flush: vi.fn(async (_ms?: number) => true),
  // withMonitor invokes the callback immediately and returns T (NOT a fn).
  withMonitor: vi.fn(
    <T>(_slug: string, callback: () => T, _opts?: unknown): T => callback(),
  ),
}));

vi.mock('@sentry/node', () => ({
  init: sentry.init,
  captureException: sentry.captureException,
  captureMessage: sentry.captureMessage,
  addBreadcrumb: sentry.addBreadcrumb,
  flush: sentry.flush,
  withMonitor: sentry.withMonitor,
}));

// --- Supabase mock: chainable + thenable, records every filter call ---------

const EMPTY_RESULT = {
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: 'OK',
} as const;

interface RecordedUpdate {
  payload: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
}

interface RecordedChain {
  table: string;
  select: unknown[];
  inFilters: Array<[string, unknown[]]>;
  isFilters: Array<[string, unknown]>;
  gtFilters: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean }]>;
  limits: number[];
  updates: RecordedUpdate[];
}

const supabaseState = vi.hoisted(() => {
  const state = {
    chains: [] as RecordedChain[],
    // Queue of PostgrestResponse payloads handed to SELECT-chain awaits
    // (consumed FIFO by the thenable terminal; default = empty result).
    selectResults: [] as unknown[],
  };
  return state;
});

const supabaseFrom = vi.fn((table: string) => {
  const record: RecordedChain = {
    table,
    select: [],
    inFilters: [],
    isFilters: [],
    gtFilters: [],
    orders: [],
    limits: [],
    updates: [],
  };
  supabaseState.chains.push(record);

  let isUpdateChain = false;
  const chain: Record<string, unknown> = {};
  const makeThenable = () => {
    chain.then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => {
      const result = isUpdateChain
        ? { ...EMPTY_RESULT }
        : (supabaseState.selectResults.shift() ?? { ...EMPTY_RESULT });
      Promise.resolve(result).then(resolve, reject);
      return chain;
    };
  };

  chain.select = vi.fn((...args: unknown[]) => {
    record.select.push(...args);
    return chain;
  });
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    isUpdateChain = true;
    record.updates.push({ payload, eqs: [], iss: [] });
    return chain;
  });
  chain.delete = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, value: unknown) => {
    record.updates[record.updates.length - 1]?.eqs.push([col, value]);
    return chain;
  });
  chain.neq = vi.fn(() => chain);
  chain.gt = vi.fn((col: string, value: unknown) => {
    record.gtFilters.push([col, value]);
    return chain;
  });
  chain.gte = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.in = vi.fn((col: string, values: unknown[]) => {
    record.inFilters.push([col, values]);
    return chain;
  });
  chain.is = vi.fn((col: string, value: unknown) => {
    record.isFilters.push([col, value]);
    record.updates[record.updates.length - 1]?.iss.push([col, value]);
    return chain;
  });
  chain.order = vi.fn((col: string, opts: { ascending: boolean }) => {
    record.orders.push([col, opts]);
    return chain;
  });
  chain.limit = vi.fn((n: number) => {
    record.limits.push(n);
    return chain;
  });
  makeThenable();
  // Re-arm the thenable after each await (the sweep awaits the chain once,
  // but keep it thenable-safe like the cron-handlers mock).
  const origThen = chain.then as unknown as (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void,
  ) => unknown;
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    origThen(resolve, reject);

  return chain;
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: supabaseFrom })),
}));

vi.mock('ws', () => ({ default: vi.fn(), __esModule: true }));

// --- Resend mock (client instantiated from process.env by the sweep) --------
const resendSend = vi.fn(async () => ({
  data: { id: 're_123' },
  error: null,
}));
vi.mock('resend', () => ({
  Resend: class {
    constructor(_apiKey: string) {}
    emails = { send: resendSend };
  },
}));

// --- notifications.ts mock — the sweep DELEGATES each row here (T6) --------
const notifications = vi.hoisted(() => ({
  processAppointmentSideEffects: vi.fn(
    // Default behaviour-preserving stub: when called, exercise the injected
    // sendFn exactly like the real S3 step would (so the sweep's capture
    // wrapper sees the Resend error) and swallow it (the real pipeline never
    // throws — the sweep must read the captured error, not a rejection).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (appt: any, opts: any) => {
      if (opts.sendEmail && typeof opts.sendFn === 'function') {
        try {
          await opts.sendFn({
            to: appt.patient_email,
            subject: '[test] invitation',
            react: null,
          });
        } catch {
          // Swallowed, mirroring runStep('email', ...) in notifications.ts.
        }
      }
      if (typeof opts.createCalendarEvent === 'function') {
        try {
          await opts.createCalendarEvent({ appointmentId: appt.id });
        } catch {
          // Swallowed.
        }
      }
    },
  ),
}));
vi.mock('../../src/lib/notifications', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/lib/notifications')>();
  return {
    ...actual,
    processAppointmentSideEffects: notifications.processAppointmentSideEffects,
  };
});

// --- google-calendar mock — must NEVER be called (the sweep injects its own
// calendar fn, real or no-op depending on GOOGLE_CALENDAR_MOCK) --------------
const googleCalendar = vi.hoisted(() => ({
  createCalendarEvent: vi.fn(async () => ({
    eventId: 'evt_real',
    meetLink: undefined,
  })),
}));
vi.mock('../../src/lib/google-calendar', () => ({
  createCalendarEvent: googleCalendar.createCalendarEvent,
}));

// Module under test — DOES NOT EXIST YET (T13). All tests are RED at import.
import handler, { config } from '../../netlify/functions/reconcile-invitations';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAppt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    status: 'confirmed',
    appointment_type: 'consultation',
    appointment_mode: 'in-person',
    duration: 60,
    scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    patient_name: 'Patient Un',
    patient_email: 'patient1@example.com',
    final_price: 6000,
    video_link: null,
    google_calendar_event_id: null,
    ...overrides,
  };
}

/** Stubs every env var the sweep reads, so no env-guard early-return fires. */
function stubEnv(): void {
  vi.stubEnv('PUBLIC_SENTRY_DSN', 'https://example@sentry.io/1');
  vi.stubEnv('SUPABASE_DATABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'OMF <contact@omf-therapie.fr>');
  vi.stubEnv('BETTER_AUTH_URL', 'https://omf-therapie.fr');
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'test-secret-that-is-long-enough-32-chars-min',
  );
}

function resetMocks(): void {
  sentry.flush.mockClear();
  sentry.flush.mockImplementation(async () => true);
  supabaseFrom.mockClear();
  supabaseState.chains.length = 0;
  supabaseState.selectResults.length = 0;
  resendSend.mockClear();
  resendSend.mockResolvedValue({ data: { id: 're_123' }, error: null });
  notifications.processAppointmentSideEffects.mockClear();
  // Keep the default delegation implementation unless a test overrides it.
  notifications.processAppointmentSideEffects.mockImplementation(
    notifications.processAppointmentSideEffects.getMockImplementation()!,
  );
  googleCalendar.createCalendarEvent.mockClear();
  // withMonitor intentionally NOT cleared (wiring recorded at invocation
  // time; each wiring test clears it explicitly).
}

beforeEach(() => {
  resetMocks();
  stubEnv();
  delete process.env.GOOGLE_CALENDAR_MOCK;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ===========================================================================
// Contract tests — all RED until T13 implements the module.
// ===========================================================================

describe('reconcile-invitations cron handler (T13 contract)', () => {
  describe('default export contract', () => {
    it('exports a callable handler (withMonitor returns T, not a function)', () => {
      // Regression guard mirroring cron-handlers.test.ts / bug #75: the
      // default export must be a function Netlify's bootstrap can invoke.
      expect(typeof handler).toBe('function');
    });

    it("exports config with literal schedule '20 * * * *' (offset from #98's '5 * * * *')", () => {
      // The Netlify bundler only resolves string LITERALS in the config
      // export (regression #113/#114) — the schedule must be inline here.
      expect(config.schedule).toBe('20 * * * *');
    });
  });

  describe('Sentry monitor wiring', () => {
    it("registers withMonitor('reconcile-invitations') with checkInMargin 5 and maxRuntime 10", async () => {
      sentry.withMonitor.mockClear();
      await handler();
      expect(sentry.withMonitor).toHaveBeenCalledWith(
        'reconcile-invitations',
        expect.any(Function),
        expect.objectContaining({
          schedule: { type: 'crontab', value: '20 * * * *' },
          checkInMargin: 5,
          maxRuntime: 10,
        }),
      );
    });

    it('runs initSentry() BEFORE Sentry.withMonitor() (regression #113)', async () => {
      // The in_progress check-in — the only one carrying monitor_config —
      // requires an initialized client, so init must precede withMonitor.
      sentry.init.mockClear();
      sentry.withMonitor.mockClear();
      await handler();
      expect(sentry.init).toHaveBeenCalled();
      expect(sentry.withMonitor).toHaveBeenCalled();
      expect(sentry.init.mock.invocationCallOrder[0]).toBeLessThan(
        sentry.withMonitor.mock.invocationCallOrder[0],
      );
    });

    it('awaits Sentry.flush(2000) in the finally block on the empty-batch path', async () => {
      // No seeded select results → empty batch → handler resolves → finally
      // flush fires (PUBLIC_SENTRY_DSN is stubbed).
      await handler();
      expect(sentry.flush).toHaveBeenCalledWith(2000);
    });
  });

  describe('eligibility query', () => {
    it('filters on status/flags/window/future and bounds the batch', async () => {
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [] });
      const before = Date.now();
      await handler();
      const after = Date.now();

      const chain = supabaseState.chains.find(
        c => c.select.length > 0 && c.updates.length === 0,
      );
      expect(chain).toBeDefined();
      expect(chain!.table).toBe('appointments');

      // status IN (…) — ÉCART ASSUMÉ vs spec §5: the spec lists only
      // ('confirmed','payment_pending'), but SC3 ("aucun RDV à venir ne reste
      // invitation_sent_at IS NULL") must also hold for avoir-paid RDVs whose
      // email failed: `payment_received` is inserted directly at INSERT time
      // (slice 1, step 2(d)) and its invitation email can equally fail, so it
      // MUST be in the sweep's eligibility set.
      expect(chain!.inFilters).toContainEqual([
        'status',
        ['confirmed', 'payment_pending', 'payment_received'],
      ]);

      // Set-once flag still NULL + soft-delete guard.
      expect(chain!.isFilters).toContainEqual(['invitation_sent_at', null]);
      expect(chain!.isFilters).toContainEqual(['deleted_at', null]);

      // created_at > now − 48 h (tolerance for the awaited call duration).
      const createdFilter = chain!.gtFilters.find(
        ([col]) => col === 'created_at',
      );
      expect(createdFilter).toBeDefined();
      const createdValue = new Date(createdFilter![1] as string).getTime();
      expect(createdValue).toBeGreaterThanOrEqual(
        before - 48 * 3_600_000 - 5_000,
      );
      expect(createdValue).toBeLessThanOrEqual(after - 48 * 3_600_000 + 5_000);

      // scheduled_at > now (only upcoming appointments).
      const scheduledFilter = chain!.gtFilters.find(
        ([col]) => col === 'scheduled_at',
      );
      expect(scheduledFilter).toBeDefined();
      const scheduledValue = new Date(scheduledFilter![1] as string).getTime();
      expect(scheduledValue).toBeGreaterThanOrEqual(before - 5_000);
      expect(scheduledValue).toBeLessThanOrEqual(after + 5_000);

      // Oldest first + bounded batch.
      expect(chain!.orders).toContainEqual(['created_at', { ascending: true }]);
      expect(chain!.limits).toContainEqual(25);
    });
  });

  describe('per-row delegation to processAppointmentSideEffects', () => {
    it('delegates each row with sendEmail:true and amountDueCents = final_price (cents)', async () => {
      const appt = makeAppt({ id: 'appt-unpaid', status: 'payment_pending' });
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });

      await handler();

      expect(notifications.processAppointmentSideEffects).toHaveBeenCalledTimes(
        1,
      );
      const [calledAppt, calledOpts] =
        notifications.processAppointmentSideEffects.mock.calls[0];
      expect(calledAppt).toEqual(appt);
      // Eligible rows are exactly those whose email did NOT go out — so the
      // sweep always re-runs the email step. send_email=false rows get the
      // flag at INSERT time and are never eligible.
      expect(calledOpts).toMatchObject({ sendEmail: true });
      expect(calledOpts.amountDueCents).toBe(6000);
    });

    it('delegates payment_received (avoir) rows with amountDueCents: 0 — no re-charge', async () => {
      const appt = makeAppt({ id: 'appt-avoir', status: 'payment_received' });
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });

      await handler();

      expect(notifications.processAppointmentSideEffects).toHaveBeenCalledTimes(
        1,
      );
      const [, calledOpts] =
        notifications.processAppointmentSideEffects.mock.calls[0];
      // Already paid via internal credit → S2 (Stripe link) must be skipped
      // by the delegated pipeline, which gates on amountDueCents > 0.
      expect(calledOpts.amountDueCents).toBe(0);
      expect(calledOpts.sendEmail).toBe(true);
    });

    it('subtracts credit_applied from final_price on payment_pending rows (C3 — no over-billing)', async () => {
      // Regression: a partially-covered RDV re-swept after a failed email was
      // delegated with amountDueCents = final_price (6000) — re-charging the
      // patient for the 2000 cents already covered by the avoir.
      const appt = makeAppt({
        id: 'appt-partial-credit',
        status: 'payment_pending',
        final_price: 6000,
        credit_applied: 2000,
      });
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });

      await handler();

      expect(notifications.processAppointmentSideEffects).toHaveBeenCalledTimes(
        1,
      );
      const [, calledOpts] =
        notifications.processAppointmentSideEffects.mock.calls[0];
      expect(calledOpts.amountDueCents).toBe(4000);
    });

    it('injects signingSecret (process.env.BETTER_AUTH_SECRET) into the delegation (C2)', async () => {
      // The pipeline's S3 signs an .ics invite token; in this pure-Node runtime
      // createSecureLinkToken cannot fall back to import.meta.env — the sweep
      // MUST hand over the secret or the email step throws for every row.
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });

      await handler();

      const [, calledOpts] =
        notifications.processAppointmentSideEffects.mock.calls[0];
      expect(calledOpts.signingSecret).toBe(
        'test-secret-that-is-long-enough-32-chars-min',
      );
    });

    it('aborts without delegating when BETTER_AUTH_SECRET is missing or too short (C2)', async () => {
      // Parity with reconcile-confirmations.ts: fail fast with a clear log
      // rather than signing every swept row with a broken secret.
      vi.stubEnv('BETTER_AUTH_SECRET', '');
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handler();

      expect(notifications.processAppointmentSideEffects).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('GOOGLE_CALENDAR_MOCK=true (dev-only calendar skip)', () => {
    it('injects a console.warn-ing no-op calendar fn, never touches the real module, and still reconciles the row', async () => {
      process.env.GOOGLE_CALENDAR_MOCK = 'true';
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await handler();

      expect(notifications.processAppointmentSideEffects).toHaveBeenCalledTimes(
        1,
      );
      const [, opts] =
        notifications.processAppointmentSideEffects.mock.calls[0];
      expect(typeof opts.createCalendarEvent).toBe('function');

      // The injected fn warns (dev-only skip must be visible in logs)…
      const calResult = await opts.createCalendarEvent({
        appointmentId: appt.id,
      });
      expect(calResult).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();

      // …and the REAL calendar module is never called.
      expect(googleCalendar.createCalendarEvent).not.toHaveBeenCalled();

      // The rest of the per-row reconciliation still ran (Stripe/email/flags
      // are delegated through the same call — asserted via the email sendFn).
      expect(resendSend).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('poison-escape (makeSendFnWithCapture pattern)', () => {
    it('sets invitation_sent_at itself (set-once guard) on a NON-retryable Resend 4xx', async () => {
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      // Resend returns a validation 4xx → isRetryableResendError === false →
      // poison. processAppointmentSideEffects swallows it (mocked impl calls
      // the injected sendFn), so the sweep must detect it via its capture
      // wrapper and escape the retry loop itself.
      resendSend.mockResolvedValue({
        data: null,
        error: {
          name: 'validation_error',
          statusCode: 422,
          message: 'Invalid "to" address',
        },
      });

      await handler();

      const flagUpdate = supabaseState.chains
        .flatMap(c => c.updates.map(u => ({ chain: c, update: u })))
        .find(({ update }) => 'invitation_sent_at' in update.payload);
      expect(flagUpdate).toBeDefined();
      expect(flagUpdate!.update.eqs).toContainEqual(['id', appt.id]);
      // Set-once write-race guard (mirrors #98 L2).
      expect(flagUpdate!.update.iss).toContainEqual([
        'invitation_sent_at',
        null,
      ]);
    });

    it('leaves invitation_sent_at NULL on a RETRYABLE Resend 5xx (next hourly pass retries)', async () => {
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      resendSend.mockResolvedValue({
        data: null,
        error: {
          name: 'internal_server_error',
          statusCode: 500,
          message: 'Resend unavailable',
        },
      });

      await handler();

      const flagUpdate = supabaseState.chains
        .flatMap(c => c.updates.map(u => u.payload))
        .find(payload => 'invitation_sent_at' in payload);
      expect(flagUpdate).toBeUndefined();
    });
  });

  describe('deadline (DEADLINE_MS = 8500)', () => {
    it('stops the loop at the deadline — remaining rows deferred to the next pass', async () => {
      const rows = [makeAppt({ id: 'appt-a' }), makeAppt({ id: 'appt-b' })];
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: rows });

      // Fake the wall clock: while processing the FIRST row, time jumps past
      // the 8.5 s budget (slow external call). Row B must not be attempted.
      vi.useFakeTimers({ toFake: ['Date'] });
      const t0 = Date.now();
      notifications.processAppointmentSideEffects.mockImplementationOnce(
        async () => {
          vi.setSystemTime(t0 + 9000);
        },
      );

      await handler();

      expect(notifications.processAppointmentSideEffects).toHaveBeenCalledTimes(
        1,
      );
      expect(
        notifications.processAppointmentSideEffects.mock.calls[0][0].id,
      ).toBe('appt-a');
    });
  });

  describe('per-row isolation', () => {
    it('a throwing row does not prevent the following rows (handler resolves)', async () => {
      const rows = [
        makeAppt({ id: 'appt-poison' }),
        makeAppt({ id: 'appt-next' }),
      ];
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: rows });
      notifications.processAppointmentSideEffects
        .mockRejectedValueOnce(new Error('row exploded'))
        .mockResolvedValue(undefined);

      // Must NOT reject — the failed row is logged + counted, the batch goes on.
      await expect(handler()).resolves.toBeUndefined();
      expect(notifications.processAppointmentSideEffects).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe('logs without PII', () => {
    it('never logs the patient email address on the poison-escape error path', async () => {
      const appt = makeAppt({ patient_email: 'secret-patient@example.com' });
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      resendSend.mockResolvedValue({
        data: null,
        error: {
          name: 'validation_error',
          statusCode: 422,
          message: 'Invalid "to" address',
        },
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handler();

      for (const call of errorSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('secret-patient@example.com');
      }
      errorSpy.mockRestore();
    });
  });
});
