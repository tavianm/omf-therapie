import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Cron handler integration tests — `Sentry.withMonitor` wrapper + finally-flush
//
// The cron files (`netlify/functions/send-reminders.ts`,
// `netlify/functions/calendar-token-heartbeat.ts`) are NOT covered by
// `cron-sentry.test.ts`, which only exercises the extracted `captureAndFlush`
// helper and the duplicated `scrubPii`. This file closes that gap by importing
// the actual cron modules and asserting:
//
//   1. `withMonitor` is wired with the right slug + crontab schedule +
//      checkInMargin/maxRuntime (so missed executions surface as alerts).
//   2. The success path runs the handler and the `finally { await
//      Sentry.flush(2000) }` block fires when `PUBLIC_SENTRY_DSN` is set
//      (Lambda-freeze safety).
//   3. The error path: a thrown work function triggers `captureException`
//      (via captureAndFlush) AND `flush`, and the handler rethrows so the
//      monitor registers a failed run.
//
// `withMonitor` is mocked as a passthrough (`(slug, handler) => handler`) so
// the default export of each cron module IS the wrapped handler. External
// deps (Supabase client, Resend, googleapis OAuth2, `ws` transport) are
// mocked at the leaf so the work function resolves without network/DB.
// ---------------------------------------------------------------------------

// vi.hoisted keeps the spy fns referenceable inside vi.factory callbacks
// (which are hoisted above the imports).
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  flush: vi.fn(async (_ms?: number) => true),
  // withMonitor invocation contract (mirrors the real @sentry/node impl):
  //   - calls `callback()` immediately
  //   - returns T (the callback's return value), NOT a function
  //   - captures `in_progress` then `ok`/`error` check-ins
  // The cron modules wrap withMonitor in a `handler()` function (because
  // Netlify's bootstrap requires a callable default export), so the mock must
  // invoke the callback — otherwise the work function never runs.
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

// --- Mock the leaf external deps that the work functions touch -------------

// Canonical "empty" Supabase result — full PostgrestResponse-ish shape so the
// spy's inferred signature stays consistent across mockResolvedValue variants.
const EMPTY_RESULT = {
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: 'OK',
} as const;

// Supabase client factory: returns a builder whose terminal calls resolve
// with empty data so send-reminders hits the "nothing to do" early-return
// path (success without sending email). Chainable + thenable, so every
// chain shape works:
//   - `await supabase.from('t').select().gte().lte().in().is().is()` (thenable)
//   - `await supabase.from('t').select().eq().single()`               (.single)
const supabaseQuery = vi.fn(async () => ({ ...EMPTY_RESULT }));
const supabaseFrom = vi.fn(() => {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    gt: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    single: supabaseQuery,
    maybeSingle: supabaseQuery,
    // Thenable terminal — `await builder` resolves to a PostgrestResponse.
    then: (
      resolve: (v: unknown) => void,
      reject?: (e: unknown) => void,
    ) => {
      supabaseQuery().then(resolve, reject);
      return chain;
    },
  };
  return chain;
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: supabaseFrom })),
}));

// `ws` is imported as a default-value transport option by both cron files
// (`realtime: { transport: ws }`). The Supabase client is mocked above so
// `ws` is never actually consumed as a WebSocket, but the import must resolve.
vi.mock('ws', () => ({
  default: vi.fn(),
  __esModule: true,
}));

// Resend: only `.emails.send()` is called, and only on the non-empty path
// (empty queries short-circuit). Make it resolvable so any stray call is safe.
// The cron code does `new Resend(apiKey)`, so the mock must be a constructor.
const resendSend = vi.fn(async () => ({ data: { id: 're_123' }, error: null }));
vi.mock('resend', () => {
  return {
    Resend: class {
      constructor(_apiKey: string) {}
      emails = { send: resendSend };
    },
  };
});

// googleapis: heartbeat instantiates `new google.auth.OAuth2(...)`, calls
// `setCredentials`, then `refreshAccessToken()`. The success path requires
// credentials to be returned. Hoist the instance stubs so vi.mock's factory
// (hoisted above imports) can reference them. The mock must be a constructor
// since the cron code does `new google.auth.OAuth2(...)`.
const googleMocks = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(async () => ({
    credentials: {
      access_token: 'ya29.new',
      refresh_token: '1//new-rt',
      expiry_date: Date.now() + 3_600_000,
    },
  })),
  setCredentials: vi.fn(),
}));
vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: class {
          constructor(
            _clientId?: string,
            _clientSecret?: string,
            _redirectUri?: string,
          ) {}
          setCredentials = googleMocks.setCredentials;
          refreshAccessToken = googleMocks.refreshAccessToken;
        },
      },
    },
  };
});

// `@react-email/render` is imported by calendar-token-heartbeat's alert
// helper, which is only reached on `invalid_grant`. Mock it so the import
// resolves even though we never hit that path here.
vi.mock('@react-email/render', () => ({ render: vi.fn(async () => '<html/>') }));

// ---------------------------------------------------------------------------
// Import the cron modules AFTER the mocks are registered. The default export
// of each module is a `handler()` function (callable by Netlify's bootstrap)
// that internally invokes `Sentry.withMonitor(slug, runX, opts)`.
// ---------------------------------------------------------------------------
import sendRemindersHandler from '../../netlify/functions/send-reminders';
import heartbeatHandler from '../../netlify/functions/calendar-token-heartbeat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resets every shared mock + re-stubs the Sentry flush default resolution. */
function resetMocks(): void {
  sentry.init.mockClear();
  sentry.captureException.mockClear();
  sentry.captureMessage.mockClear();
  sentry.addBreadcrumb.mockClear();
  sentry.flush.mockClear();
  sentry.flush.mockImplementation(async () => true);
  // NOTE: withMonitor is intentionally NOT cleared here. The wiring tests
  // assert against the call recorded at module-import time (when each cron
  // file's `export default Sentry.withMonitor(...)` runs). Clearing would
  // erase that evidence. The call count is fixed per module load, so it does
  // not accumulate across tests.

  supabaseFrom.mockClear();
  supabaseQuery.mockClear();
  supabaseQuery.mockResolvedValue({ ...EMPTY_RESULT });

  resendSend.mockClear();
  resendSend.mockResolvedValue({ data: { id: 're_123' }, error: null });

  googleMocks.refreshAccessToken.mockClear();
  googleMocks.refreshAccessToken.mockResolvedValue({
    credentials: {
      access_token: 'ya29.new',
      refresh_token: '1//new-rt',
      expiry_date: Date.now() + 3_600_000,
    },
  });
  googleMocks.setCredentials.mockClear();
}

beforeEach(() => {
  resetMocks();
  // PUBLIC_SENTRY_DSN gates the `finally { await Sentry.flush(2000) }` block
  // in both handlers. Without it, flush would never be awaited and the
  // finally-flush assertion could not distinguish "ran" from "skipped".
  vi.stubEnv('PUBLIC_SENTRY_DSN', 'https://example@sentry.io/1');
  // Required env vars so neither handler hits its env-guard early-return
  // (which would skip the body we want to exercise).
  vi.stubEnv('SUPABASE_DATABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'OMF <contact@omf-therapie.fr>');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'test-client-id');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'https://developers.google.com/oauthplayground');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ===========================================================================
// send-reminders — slug 'send-reminders', schedule '0 18 * * *' (daily 18:00 UTC)
// ===========================================================================

describe('send-reminders cron handler', () => {
  describe('default export contract', () => {
    it('exports a callable handler (regression: withMonitor returns T, not a function)', () => {
      // Regression guard: `Sentry.withMonitor(slug, callback, opts)` returns
      // the callback's return value (T), NOT a function. Exporting it
      // directly breaks Netlify's bootstrap (`handler is not a function`
      // TypeError silently fails every scheduled run). The default export
      // MUST be a callable function that Netlify can invoke as handler().
      expect(typeof sendRemindersHandler).toBe('function');
    });
  });

  describe('Sentry.init environment (regression: CONTEXT is build-time only)', () => {
    it('derives the environment from BUILD_CONTEXT, NOT process.env.CONTEXT', async () => {
      // Production bug 2026-07-19: every prod cron tagged
      // `environment: 'staging'` because process.env.CONTEXT is undefined at
      // function runtime (Netlify exposes it at BUILD time only). The fix
      // reads BUILD_CONTEXT from a build-time-generated module instead.
      //
      // In this test environment:
      //   - process.env.CONTEXT is undefined (vitest does not set it)
      //   - netlify/functions/_lib/build-env.ts is the committed stub with
      //     BUILD_CONTEXT = 'dev'
      // So Sentry.init must receive `environment: 'staging'` (the dev
      // fallback). If it received `environment: undefined` or derived from
      // process.env.CONTEXT, the test would catch the regression.
      sentry.init.mockClear();
      await sendRemindersHandler();
      expect(sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'staging',
        }),
      );
    });
  });

  describe('Sentry.withMonitor wiring', () => {
    it('registers the monitor with the expected slug, crontab schedule and margins', async () => {
      // withMonitor is invoked inside handler() at call time, not at module
      // load. Invoke once so the spy captures the wiring call.
      sentry.withMonitor.mockClear();
      await sendRemindersHandler();
      expect(sentry.withMonitor).toHaveBeenCalledWith(
        'send-reminders',
        expect.any(Function),
        expect.objectContaining({
          schedule: { type: 'crontab', value: '0 18 * * *' },
          checkInMargin: 5,
          maxRuntime: 10,
        }),
      );
    });
  });

  describe('finally-flush on the resolved path', () => {
    it('awaits Sentry.flush(2000) in the finally block when the handler resolves', async () => {
      // Empty appointment queue → `sendReminders()` returns without throwing,
      // so the `try` block completes and the `finally` flush fires.
      await sendRemindersHandler();

      // The success-path invariant: the finally block ran.
      expect(sentry.flush).toHaveBeenCalledWith(2000);
      // No error captured on the happy path.
      expect(sentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe('error path — captureAndFlush + rethrow', () => {
    it('captures the exception, flushes, and rethrows when the work function throws', async () => {
      // Force the Supabase query to reject so `sendReminders()` throws inside
      // the `try`, hitting the `catch (err) { await captureAndFlush(err);
      // throw err; }` branch.
      const boom = new Error('supabase exploded');
      supabaseQuery.mockRejectedValueOnce(boom);

      // The handler rethrows (it does NOT swallow), so the cron failure is
      // visible to Netlify/Sentry's check-in status.
      await expect(sendRemindersHandler()).rejects.toThrow('supabase exploded');

      // captureAndFlush → captureException(err)
      expect(sentry.captureException).toHaveBeenCalledWith(boom);
      // Flush fired at least once: inside `captureAndFlush` AND in `finally`.
      // Both code paths independently call Sentry.flush(2000), so the spy
      // sees >= 1 invocation with 2000ms on the error path.
      const flush2000Calls = sentry.flush.mock.calls.filter(
        (c) => c[0] === 2000,
      );
      expect(flush2000Calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ===========================================================================
// calendar-token-heartbeat — slug 'calendar-token-heartbeat',
// schedule '0 0 * * 0' (Sunday 00:00 UTC)
// ===========================================================================

describe('calendar-token-heartbeat cron handler', () => {
  describe('default export contract', () => {
    it('exports a callable handler (regression: withMonitor returns T, not a function)', () => {
      // Same regression guard as send-reminders — see comment there.
      expect(typeof heartbeatHandler).toBe('function');
    });
  });

  describe('Sentry.withMonitor wiring', () => {
    it('registers the monitor with the expected slug, crontab schedule and margins', async () => {
      sentry.withMonitor.mockClear();
      // Seed a token row so heartbeat() resolves without throwing.
      supabaseQuery.mockResolvedValueOnce({
        ...EMPTY_RESULT,
        data: {
          refresh_token: '1//persisted-rt',
          access_token: 'ya29.old',
          expiry_date: Date.now() - 60_000,
        },
      });
      await heartbeatHandler();
      expect(sentry.withMonitor).toHaveBeenCalledWith(
        'calendar-token-heartbeat',
        expect.any(Function),
        expect.objectContaining({
          schedule: { type: 'crontab', value: '0 0 * * 0' },
          checkInMargin: 5,
          maxRuntime: 10,
        }),
      );
    });
  });

  describe('finally-flush on the resolved path', () => {
    it('awaits Sentry.flush(2000) in the finally block when the handler resolves', async () => {
      // Seed a real token row so heartbeat() reaches the OAuth refresh + DB
      // update path (exercises googleapis + supabase .update()), not just
      // the "no token row" early-return. The work function still resolves,
      // so the `try` completes and the `finally` flush fires.
      supabaseQuery.mockResolvedValueOnce({
        ...EMPTY_RESULT,
        data: {
          refresh_token: '1//persisted-rt',
          access_token: 'ya29.old',
          expiry_date: Date.now() - 60_000,
        },
      });

      await heartbeatHandler();

      // Proves heartbeat() actually ran the refresh path (not an early return),
      // so the finally-flush assertion below is non-tautological.
      expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
      // The success-path invariant: the finally block ran.
      expect(sentry.flush).toHaveBeenCalledWith(2000);
      // No error captured on the happy path.
      expect(sentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe('error path — captureAndFlush + rethrow', () => {
    it('captures the exception, flushes, and rethrows when the work function throws', async () => {
      // Make the token fetch itself reject (the `.single()` terminal), so
      // `heartbeat()` throws inside the `try` and the catch+rethrow path runs.
      const boom = new Error('supabase unreachable');
      supabaseQuery.mockRejectedValueOnce(boom);

      await expect(heartbeatHandler()).rejects.toThrow('supabase unreachable');

      expect(sentry.captureException).toHaveBeenCalledWith(boom);
      const flush2000Calls = sentry.flush.mock.calls.filter(
        (c) => c[0] === 2000,
      );
      expect(flush2000Calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
