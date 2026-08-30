import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Contract tests — the #129 transport migration of the
// `netlify/functions/reconcile-confirmations.ts` sweep (SC5/SC6/SC7).
//
// The sweep sends through the shared adapter `netlify/functions/_lib/send-fn`,
// whose `sendFn` DELEGATES to `sendEmail` from `src/lib/resend` and captures
// `result.rawError` into `state.lastError` ONLY on failure (capture-at-failure,
// PR #131 review: a concurrent success must never mask a prior failure). These
// tests mock `sendEmail` (the transport seam) and pin the sweep's behaviour on
// top of it:
//
//   1. SC6 — poison classification via `state.lastError` (fed from
//      `SendEmailResult.rawError`): a NON-retryable 4xx on the PATIENT email
//      → the sweep itself sets `confirmation_sent_at` (set-once
//      `.is('confirmation_sent_at', null)` guard) + error log (Sentry-bound);
//      retryable failures (429, 5xx, statusCode-less network error) → flag
//      left NULL, retried on the next hourly pass.
//   2. lastTo heuristic — the two sends are CONCURRENT (`Promise.allSettled`),
//      so classification only trusts a captured FAILING send: `state.lastTo`
//      must include `patient_email` for the poison escape to fire. A
//      therapist-only failure captures `lastTo=[adminEmail]` → best-effort:
//      no poison escape, and the flag is still set via the success path
//      because the patient email succeeded.
//   3. SC7 — forwarding: the params handed to `sendEmail` are exactly the
//      params built by `buildAndSendConfirmationEmails` (real module, not
//      mocked): `to`, `subject`, `react`, `threadKey`, `idempotencyKey` —
//      verbatim, no mutation by the adapter (L1 keys `confirm:patient:{pi}` /
//      `confirm:therapist:{pi}` unchanged), with the adapter's own budget
//      `{ maxAttempts: 1 }` as the opts argument.
//   4. SC5 — inheritance shape: the sweep itself never constructs a BCC —
//      even with ADMIN_EMAIL configured, no `sendEmail` call carries a
//      manually-injected admin BCC (the BCC becomes `sendEmail`'s job).
//
// Conventions mirror `tests/unit/reconcile-invitations.test.ts` (Sentry
// passthrough, chainable+thenable Supabase mock recording every
// `.eq()/.is()/update` payload). The REAL `buildAndSendConfirmationEmails`
// runs (only the transport is mocked), so the CONCURRENT send shape it
// relies on (patient + therapist via `Promise.allSettled`) is exercised for
// real — the race tests below control which send settles last.
// ---------------------------------------------------------------------------

// --- Sentry passthrough mock (same contract as the invitations suite) -------

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
    selectResults: [] as unknown[],
    updateResults: [] as unknown[],
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
        ? (supabaseState.updateResults.shift() ?? { ...EMPTY_RESULT })
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
  chain.or = vi.fn(() => chain);
  chain.gt = vi.fn((col: string, value: unknown) => {
    record.gtFilters.push([col, value]);
    return chain;
  });
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

  return chain;
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: supabaseFrom })),
}));

vi.mock('ws', () => ({ default: vi.fn(), __esModule: true }));

// --- Transport mock ----------------------------------------------------------
//
// CONTRACT: the sweep's `sendFn` adapter (`_lib/send-fn`) delegates to
// `sendEmail` from `src/lib/resend`; assertions below target the `sendEmail`
// mock (params in, `{ success, error, rawError }` out). The sweep never
// touches the Resend SDK directly, so no SDK mock is needed here.

const sendEmailModule = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('../../src/lib/resend', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/resend')>();
  // `buildAppointmentConversationSubject` (imported by notifications.ts for
  // real) must survive the partial mock — only the transport is replaced.
  return { ...actual, sendEmail: sendEmailModule.sendEmail };
});

// --- google-calendar mock — never called: the confirmations sweep is
// email-only, and notifications.ts merely imports the module for its types /
// POST pipeline. Guards against any accidental calendar side effect. ---------

const googleCalendar = vi.hoisted(() => ({
  createCalendarEvent: vi.fn(async () => ({
    eventId: 'evt_real',
    meetLink: undefined,
  })),
}));
vi.mock('../../src/lib/google-calendar', () => ({
  createCalendarEvent: googleCalendar.createCalendarEvent,
}));

// Module under test — sends through the `_lib/send-fn` adapter → `sendEmail`.
import handler, {
  config,
} from '../../netlify/functions/reconcile-confirmations';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_EMAIL = 'patient1@example.com';
const ADMIN_EMAIL_TEST = 'therapeute@omf-therapie.fr';
const PAYMENT_INTENT_ID = 'pi_test_129';

/** Failure double shaped like the post-T2 `SendEmailResult` (+ rawError). */
function sendFailure(
  rawError: { name?: string; statusCode?: number | null; message?: string },
  error = 'Erreur Resend',
) {
  return { success: false, error, rawError };
}

function makeAppt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-confirm-1',
    status: 'payment_received',
    appointment_type: 'consultation',
    appointment_mode: 'in-person',
    duration: 60,
    scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    patient_name: 'Patient Un',
    patient_email: PATIENT_EMAIL,
    final_price: 6000,
    stripe_payment_intent_id: PAYMENT_INTENT_ID,
    video_link: null,
    ...overrides,
  };
}

/** Minimal shape needed to route the mock by recipient. */
interface SendParamsLike {
  to: string | string[];
}

/** Stubs every env var the sweep validates, so no early-return fires. */
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
  supabaseState.updateResults.length = 0;
  sendEmailModule.sendEmail.mockReset();
  // Default: both sends succeed (rawError absent on success).
  sendEmailModule.sendEmail.mockResolvedValue({ success: true, id: 're_ok' });
  googleCalendar.createCalendarEvent.mockClear();
}

beforeEach(() => {
  resetMocks();
  stubEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** All update payloads recorded across every table chain. */
function allUpdates(): Array<{ chain: RecordedChain; update: RecordedUpdate }> {
  return supabaseState.chains.flatMap(c =>
    c.updates.map(u => ({ chain: c, update: u })),
  );
}

/** The (unique) set-once flag update, if any. */
function flagUpdate():
  { chain: RecordedChain; update: RecordedUpdate } | undefined {
  return allUpdates().find(
    ({ update }) => 'confirmation_sent_at' in update.payload,
  );
}

// ===========================================================================
// Contract tests — the sweep wired to the sendEmail transport via _lib/send-fn.
// ===========================================================================

describe('reconcile-confirmations cron handler (#129 sendEmail transport contract)', () => {
  describe('module contract', () => {
    it('exports a callable handler (withMonitor returns T, not a function)', () => {
      expect(typeof handler).toBe('function');
    });

    it("exports config with literal schedule '5 * * * *'", () => {
      // The Netlify bundler only resolves string LITERALS (regression #113) —
      // locked by cron-schedule-source.test.ts; re-asserted here as a guard.
      expect(config.schedule).toBe('5 * * * *');
    });
  });

  describe('poison 4xx patient (SC6)', () => {
    it('sets confirmation_sent_at itself (set-once guard) and logs the poison row when the patient send fails with a non-retryable 4xx', async () => {
      // ADMIN_EMAIL unset → the therapist email is skipped entirely, so the
      // only (hence failing) send targets the patient. The admin-set variant —
      // BOTH branches are now covered and deterministic under capture-at-failure:
      // see the concurrent-sends tests in the lastTo group below.
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      sendEmailModule.sendEmail.mockResolvedValue(
        sendFailure(
          {
            name: 'validation_error',
            statusCode: 422,
            message: 'Invalid "to" address',
          },
          'Invalid "to" address',
        ),
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handler();

      // The transport seam was actually exercised.
      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmailModule.sendEmail.mock.calls[0][0].to).toBe(PATIENT_EMAIL);

      // Poison escape: the sweep itself marks the row delivered.
      const escape = flagUpdate();
      expect(escape).toBeDefined();
      expect(escape!.chain.table).toBe('appointments');
      expect(escape!.update.eqs).toContainEqual(['id', appt.id]);
      // Set-once write-race guard (L2, mirrors the webhook's UPDATE).
      expect(escape!.update.iss).toContainEqual(['confirmation_sent_at', null]);
      expect(typeof escape!.update.payload.confirmation_sent_at).toBe('string');
      // Exactly ONE flag write: the escape, not a success-path write.
      expect(
        allUpdates().filter(u => 'confirmation_sent_at' in u.update.payload),
      ).toHaveLength(1);

      // Surfaced at error level (logger routes it to Sentry).
      const serialized = errorSpy.mock.calls.map(call => JSON.stringify(call));
      expect(serialized.some(line => line.includes('poison row'))).toBe(true);
      // RGPD (miroir invitations) : l'adresse patient ne fuit dans aucun log.
      expect(serialized.some(line => line.includes(PATIENT_EMAIL))).toBe(false);

      errorSpy.mockRestore();
    });
  });

  describe('retryable failures: 429 / 5xx / network (SC6)', () => {
    it('leaves confirmation_sent_at NULL on a retryable 429 (next hourly pass retries)', async () => {
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      sendEmailModule.sendEmail.mockResolvedValue(
        sendFailure({
          name: 'rate_limit_error',
          statusCode: 429,
          message: 'Rate limited',
        }),
      );

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(1);
      // No escape, no success write — the row stays eligible for the sweep.
      expect(flagUpdate()).toBeUndefined();
      expect(allUpdates()).toHaveLength(0);
    });

    it('leaves confirmation_sent_at NULL on a retryable 503 (next hourly pass retries)', async () => {
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      sendEmailModule.sendEmail.mockResolvedValue(
        sendFailure({
          name: 'internal_server_error',
          statusCode: 503,
          message: 'Resend unavailable',
        }),
      );

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(1);
      expect(flagUpdate()).toBeUndefined();
      expect(allUpdates()).toHaveLength(0);
    });

    it('treats an error WITHOUT statusCode (network throw) as retryable — flag left NULL', async () => {
      // Spec edge case: `isRetryableResendError` classifies a statusCode-less
      // rawError as retryable → the adapter must not poison the row.
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      sendEmailModule.sendEmail.mockResolvedValue(
        sendFailure({ name: 'network_error', message: 'fetch failed' }),
      );

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(1);
      expect(flagUpdate()).toBeUndefined();
      expect(allUpdates()).toHaveLength(0);
    });
  });

  describe('lastTo heuristic (patient vs therapist, concurrent sends)', () => {
    it('does NOT poison on a therapist-only 4xx — best-effort: flag still set via the success path', async () => {
      // Patient send succeeds, therapist notification fails permanently.
      // `patientEmailSent` is true → the sweep never consults the capture
      // state (therapist delivery is best-effort) → no poison escape, and the
      // L2 flag is set normally via the success path.
      vi.stubEnv('ADMIN_EMAIL', ADMIN_EMAIL_TEST);
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      sendEmailModule.sendEmail.mockImplementation(
        async (params: SendParamsLike) => {
          const to = Array.isArray(params.to) ? params.to[0] : params.to;
          if (to === PATIENT_EMAIL) return { success: true, id: 're_patient' };
          return sendFailure(
            {
              name: 'validation_error',
              statusCode: 422,
              message: 'Invalid "to" address',
            },
            'Invalid "to" address',
          );
        },
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handler();

      // Both sends went through the seam, patient first.
      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(2);
      expect(sendEmailModule.sendEmail.mock.calls[0][0].to).toBe(PATIENT_EMAIL);
      expect(sendEmailModule.sendEmail.mock.calls[1][0].to).toBe(
        ADMIN_EMAIL_TEST,
      );

      // The flag is set by the SUCCESS path (set-once guard), not an escape.
      const success = flagUpdate();
      expect(success).toBeDefined();
      expect(success!.update.eqs).toContainEqual(['id', appt.id]);
      expect(success!.update.iss).toContainEqual([
        'confirmation_sent_at',
        null,
      ]);
      expect(
        allUpdates().filter(u => 'confirmation_sent_at' in u.update.payload),
      ).toHaveLength(1);

      // No poison log — a therapist failure must never escape the retry loop.
      const serialized = errorSpy.mock.calls.map(call => JSON.stringify(call));
      expect(serialized.some(line => line.includes('poison row'))).toBe(false);

      errorSpy.mockRestore();
    });

    it('poisons on a patient 4xx even when the CONCURRENT therapist send succeeds (production branch, ADMIN_EMAIL set)', async () => {
      // PR #131 regression pin: the two sends race inside `Promise.allSettled`.
      // Under the old assign-before-delegation capture, the therapist SUCCESS
      // overwrote the state (lastError=null) after the patient FAILURE → the
      // poison escape never fired with ADMIN_EMAIL set. Capture-at-failure
      // keeps the patient's rawError → the escape MUST fire.
      vi.stubEnv('ADMIN_EMAIL', ADMIN_EMAIL_TEST);
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      sendEmailModule.sendEmail.mockImplementation(
        async (params: SendParamsLike) => {
          const to = Array.isArray(params.to) ? params.to[0] : params.to;
          if (to === PATIENT_EMAIL) {
            return sendFailure(
              {
                name: 'validation_error',
                statusCode: 422,
                message: 'Invalid to',
              },
              'Invalid to',
            );
          }
          return { success: true, id: 're_admin' };
        },
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(2);

      // Poison escape fires: the sweep itself marks the row delivered.
      const escape = flagUpdate();
      expect(escape).toBeDefined();
      expect(escape!.chain.table).toBe('appointments');
      expect(escape!.update.eqs).toContainEqual(['id', appt.id]);
      expect(escape!.update.iss).toContainEqual(['confirmation_sent_at', null]);
      expect(
        allUpdates().filter(u => 'confirmation_sent_at' in u.update.payload),
      ).toHaveLength(1);

      const serialized = errorSpy.mock.calls.map(call => JSON.stringify(call));
      expect(serialized.some(line => line.includes('poison row'))).toBe(true);

      errorSpy.mockRestore();
    });

    it('does NOT poison when both sends fail 4xx and the therapist promise settles LAST (best-effort race)', async () => {
      // Residual of capture-at-failure: two concurrent failures race and the
      // last completion wins the capture — here the therapist's, so
      // `lastToWasPatient` is false → no poison, the row stays NULL and the
      // next hourly pass retries (best-effort: never mis-poisons).
      vi.stubEnv('ADMIN_EMAIL', ADMIN_EMAIL_TEST);
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });
      sendEmailModule.sendEmail.mockImplementation(
        async (params: SendParamsLike) => {
          const to = Array.isArray(params.to) ? params.to[0] : params.to;
          const failure = sendFailure(
            {
              name: 'validation_error',
              statusCode: 422,
              message: 'Invalid to',
            },
            'Invalid to',
          );
          if (to === PATIENT_EMAIL) return failure;
          // Explicit resolution-order control: a macrotask turn guarantees the
          // therapist promise settles AFTER the patient's immediate microtask.
          await new Promise(resolve => setTimeout(resolve, 0));
          return failure;
        },
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(2);
      // No escape, no success write — the row stays eligible for the sweep.
      expect(flagUpdate()).toBeUndefined();
      expect(allUpdates()).toHaveLength(0);
      const serialized = errorSpy.mock.calls.map(call => JSON.stringify(call));
      expect(serialized.some(line => line.includes('poison row'))).toBe(false);

      errorSpy.mockRestore();
    });
  });

  describe('per-row state hygiene (capture reset between rows)', () => {
    it('does NOT let a row-1 poison capture leak into a row-2 rawError-less failure (same patient)', async () => {
      // Pins the per-row `sendBundle.state.lastError = null` reset: row 1
      // poisons (422 patient) ; row 2 — même patient_email — échoue SANS
      // rawError (échec SMTP-shaped, permis par le contrat #129). Sans reset,
      // la capture stale de la row 1 (422 + lastTo=[patient]) produirait une
      // fausse échappatoire poison sur la row 2.
      const appt1 = makeAppt();
      const appt2 = makeAppt({
        id: 'appt-confirm-2',
        stripe_payment_intent_id: 'pi_test_129_row2',
      });
      supabaseState.selectResults.push({
        ...EMPTY_RESULT,
        data: [appt1, appt2],
      });
      let call = 0;
      sendEmailModule.sendEmail.mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          return sendFailure(
            {
              name: 'validation_error',
              statusCode: 422,
              message: 'Invalid "to" address',
            },
            'Invalid "to" address',
          );
        }
        // Row 2 : échec SANS rawError (chemin SMTP du contrat) — la capture
        // reste intacte, seul le reset par-row protège la classification.
        return { success: false, error: 'SMTP error' };
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(2);
      // Exactement UNE écriture de flag : l'échappatoire de la row 1.
      const escapes = allUpdates().filter(
        u => 'confirmation_sent_at' in u.update.payload,
      );
      expect(escapes).toHaveLength(1);
      expect(escapes[0]!.update.eqs).toContainEqual(['id', appt1.id]);
      expect(escapes[0]!.update.eqs).not.toContainEqual(['id', appt2.id]);

      errorSpy.mockRestore();
    });
  });

  describe('SC7 param forwarding (verbatim, no mutation by the adapter)', () => {
    it('forwards the patient params exactly: to, subject, react, threadKey, idempotencyKey — nothing added', async () => {
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(1);
      // toEqual on the WHOLE params object: extra/renamed keys (a local bcc,
      // a normalized `to` array, a rewritten subject…) would fail — the L1
      // key `confirm:patient:{pi}` and the threadKey pass through verbatim.
      expect(sendEmailModule.sendEmail.mock.calls[0][0]).toEqual({
        to: PATIENT_EMAIL,
        subject: expect.stringContaining('Votre rendez-vous est confirmé'),
        react: expect.anything(),
        threadKey: `appointment:${appt.id}:patient`,
        idempotencyKey: `confirm:patient:${PAYMENT_INTENT_ID}`,
      });
      // The adapter's own budget rides along as the opts argument (sweep
      // cadence: one attempt per pass, the next hour retries).
      expect(sendEmailModule.sendEmail.mock.calls[0][1]).toEqual({
        maxAttempts: 1,
      });
    });

    it('forwards the therapist params exactly: idempotencyKey confirm:therapist:{pi}, no threadKey', async () => {
      vi.stubEnv('ADMIN_EMAIL', ADMIN_EMAIL_TEST);
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(2);
      expect(sendEmailModule.sendEmail.mock.calls[1][0]).toEqual({
        to: ADMIN_EMAIL_TEST,
        subject: `Prépaiement reçu — ${appt.patient_name}`,
        react: expect.anything(),
        idempotencyKey: `confirm:therapist:${PAYMENT_INTENT_ID}`,
      });
    });
  });

  describe('SC5 inheritance shape (no sweep-level BCC)', () => {
    it('never injects the admin BCC itself — every sendEmail call carries no bcc, even with ADMIN_EMAIL set', async () => {
      // Recette 8a84a22 moved the admin copy INTO sendEmail (auto-BCC); the
      // migrated sweep must not re-add it (would double the copy).
      vi.stubEnv('ADMIN_EMAIL', ADMIN_EMAIL_TEST);
      const appt = makeAppt();
      supabaseState.selectResults.push({ ...EMPTY_RESULT, data: [appt] });

      await handler();

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(2);
      for (const [params] of sendEmailModule.sendEmail.mock.calls) {
        expect(params.bcc).toBeUndefined();
      }
      // Sanity: the recipient list contains only patient + therapist.
      expect(sendEmailModule.sendEmail.mock.calls.map(c => c[0].to)).toEqual([
        PATIENT_EMAIL,
        ADMIN_EMAIL_TEST,
      ]);
    });
  });
});
