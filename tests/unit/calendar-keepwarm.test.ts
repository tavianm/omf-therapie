import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// calendar-keepwarm — */10 cron replacing calendar-token-heartbeat (#132)
//
// V1 scope covered HERE:
//   1. `shouldRefreshToken(expiry)` — refresh decision. The cron refreshes
//      when < 15 min of token validity remain (the patient path refreshes at
//      < 5 min, so the cron's 15-min margin guarantees the patient NEVER has
//      to refresh mid-booking).
//   2. Handler wiring — `initSentry()` then `Sentry.withMonitor(
//      'calendar-keepwarm', …, { schedule: '*/10 * * * *', checkInMargin: 2,
//      maxRuntime: 5 })`.
//   3. invalid_grant handling — token revoked → admin alert email via Resend,
//      and the run aborts BEFORE the availability warm-up (V2 scope).
//
// The V2 warm-up behavior (warmAvailabilityCache) is intentionally NOT
// asserted here beyond the "not reached after invalid_grant" guard; its own
// describe block is appended to this file separately.
//
// Mock strategy mirrors tests/unit/cron-handlers.test.ts exactly: `withMonitor`
// is a passthrough that invokes the callback immediately (so the monitor
// config is capturable AND the work function actually runs), and every
// external dep (Supabase, Resend, googleapis, ws, @react-email/render) is
// mocked at the leaf — no network, no DB.
// ---------------------------------------------------------------------------

// vi.hoisted keeps the spy fns referenceable inside vi.mock factory callbacks
// (which are hoisted above the imports).
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  flush: vi.fn(async (_ms?: number) => true),
  // withMonitor invocation contract (mirrors the real @sentry/node impl):
  // calls `callback()` immediately and returns T, NOT a function.
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

// --- Mock the leaf external deps that the work function touches -------------

// Canonical "empty" Supabase result — same shape as cron-handlers.test.ts.
const EMPTY_RESULT = {
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: 'OK',
} as const;

// Supabase client factory: chainable + thenable builder whose terminal calls
// (`.single()` / `.maybeSingle()` / awaited-then) resolve via `supabaseQuery`,
// so per-test seeding is a `supabaseQuery.mockResolvedValueOnce({ data })`.
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
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      supabaseQuery().then(resolve, reject);
      return chain;
    },
  };
  return chain;
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: supabaseFrom })),
}));

// `ws` is imported as the realtime transport option; the client is mocked
// above so it is never consumed — the import just has to resolve.
vi.mock('ws', () => ({
  default: vi.fn(),
  __esModule: true,
}));

// Resend: `.emails.send()` is reached only on the invalid_grant alert path.
const resendSend = vi.fn(async () => ({ data: { id: 're_123' }, error: null }));
vi.mock('resend', () => {
  return {
    Resend: class {
      constructor(_apiKey: string) {}
      emails = { send: resendSend };
    },
  };
});

// googleapis: keepwarm instantiates `new google.auth.OAuth2(...)`, calls
// `setCredentials`, then `refreshAccessToken()`. The V2 warm-up goes through
// `google.calendar('v3').freebusy.query` (directly or via src/lib/google-
// calendar.ts, which imports the same mocked 'googleapis' module), so the
// `freebusyQuery` spy doubles as the leaf-level "warm-up did NOT run" signal.
const googleMocks = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(async () => ({
    credentials: {
      access_token: 'ya29.new',
      refresh_token: '1//new-rt',
      expiry_date: Date.now() + 3_600_000,
    },
  })),
  setCredentials: vi.fn(),
  freebusyQuery: vi.fn(async () => ({
    data: { calendars: {} },
    error: null,
  })),
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
      calendar: vi.fn(() => ({
        freebusy: { query: googleMocks.freebusyQuery },
      })),
    },
  };
});

// `@react-email/render` backs the CalendarAuthAlert email rendered on the
// invalid_grant path. Render is mocked (template itself loads for real).
vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html/>'),
}));

// ---------------------------------------------------------------------------
// Import the cron module AFTER the mocks are registered. Default export is a
// `handler()` function (Netlify bootstrap contract) wrapping
// Sentry.withMonitor; `shouldRefreshToken` is the exported pure decision fn.
// ---------------------------------------------------------------------------
import keepwarmHandler, {
  shouldRefreshToken,
} from '../../netlify/functions/calendar-keepwarm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Admin recipient asserted in the invalid_grant alert tests. */
const ADMIN_EMAIL_TEST = 'admin@test.omf';

/** Seeds the `google_oauth_tokens` row returned by the `.single()` read. */
function seedTokenRow(expiryDate: number | null): void {
  supabaseQuery.mockResolvedValueOnce({
    ...EMPTY_RESULT,
    data: {
      refresh_token: '1//persisted-rt',
      access_token: 'ya29.old',
      expiry_date: expiryDate,
    },
  });
}

/** Google-style 401 error body signalling a revoked refresh token. */
function invalidGrantError(): Error {
  return Object.assign(new Error('invalid_grant'), {
    response: { data: { error: 'invalid_grant' } },
  });
}

/** Resets every shared mock + re-stubs the default resolutions. */
function resetMocks(): void {
  sentry.init.mockClear();
  sentry.captureException.mockClear();
  sentry.captureMessage.mockClear();
  sentry.addBreadcrumb.mockClear();
  sentry.flush.mockClear();
  sentry.flush.mockImplementation(async () => true);
  // NOTE: withMonitor is intentionally NOT cleared here (same rationale as
  // cron-handlers.test.ts). The wiring test clears it explicitly right before
  // invoking the handler whose call it wants to capture.

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
  googleMocks.freebusyQuery.mockClear();
  googleMocks.freebusyQuery.mockResolvedValue({
    data: { calendars: {} },
    error: null,
  });
}

beforeEach(() => {
  resetMocks();
  // PUBLIC_SENTRY_DSN gates the `finally { await Sentry.flush(2000) }` block.
  vi.stubEnv('PUBLIC_SENTRY_DSN', 'https://example@sentry.io/1');
  // Required env vars so the handler does not hit its env-guard early-return.
  vi.stubEnv('SUPABASE_DATABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'OMF <contact@omf-therapie.fr>');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'test-client-id');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv(
    'GOOGLE_OAUTH_REDIRECT_URI',
    'https://developers.google.com/oauthplayground',
  );
  vi.stubEnv('ADMIN_EMAIL', ADMIN_EMAIL_TEST);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ===========================================================================
// shouldRefreshToken — refresh decision (threshold: 15 min, strict `remaining
// < threshold`; the patient path threshold is 5 min, so the cron refreshes
// well before the patient ever has to).
// ===========================================================================

describe('shouldRefreshToken', () => {
  it('refreshes when 14 min of validity remain', () => {
    // 14 min < 15 min threshold → proactive refresh must fire.
    const expiry = Date.now() + 14 * 60_000;
    expect(shouldRefreshToken(expiry)).toBe(true);
  });

  it('skips refresh when 16 min of validity remain', () => {
    // 16 min ≥ 15 min threshold → plenty of margin, no refresh needed.
    const expiry = Date.now() + 16 * 60_000;
    expect(shouldRefreshToken(expiry)).toBe(false);
  });

  it('refreshes when expiry is unknown (null)', () => {
    // Unknown expiry = unknown risk → refresh defensively.
    expect(shouldRefreshToken(null)).toBe(true);
  });

  it('refreshes when expiry is in the past', () => {
    // Already-expired token → refresh unconditionally.
    const expiry = Date.now() - 60_000;
    expect(shouldRefreshToken(expiry)).toBe(true);
  });
});

// ===========================================================================
// Handler wiring — initSentry() then Sentry.withMonitor('calendar-keepwarm')
// ===========================================================================

describe('calendar-keepwarm handler wiring', () => {
  it("wraps work in Sentry.withMonitor slug 'calendar-keepwarm' with crontab '*/10 * * * *', checkInMargin 2, maxRuntime 5", async () => {
    sentry.withMonitor.mockClear();
    // Seed a token row so the wrapped work function resolves cleanly (the
    // withMonitor mock invokes the callback immediately).
    seedTokenRow(Date.now() + 16 * 60_000);

    await keepwarmHandler();

    expect(sentry.withMonitor).toHaveBeenCalledWith(
      'calendar-keepwarm',
      expect.any(Function),
      expect.objectContaining({
        schedule: { type: 'crontab', value: '*/10 * * * *' },
        checkInMargin: 2,
        maxRuntime: 5,
      }),
    );
  });
});

// ===========================================================================
// invalid_grant handling — revoked refresh token
// ===========================================================================

describe('calendar-keepwarm invalid_grant handling', () => {
  it('sends the admin alert email (ADMIN_EMAIL) via Resend when refresh fails with invalid_grant', async () => {
    seedTokenRow(Date.now() - 60_000); // expired → refresh is attempted
    googleMocks.refreshAccessToken.mockRejectedValueOnce(invalidGrantError());

    // invalid_grant is handled, not thrown: the scheduled run must resolve
    // (no noisy cron failure), after having alerted the admin.
    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(resendSend).toHaveBeenCalledTimes(1);
    const call = resendSend.mock.calls[0][0] as {
      to: string[];
      subject?: string;
      html?: string;
    };
    expect(call.to).toEqual([ADMIN_EMAIL_TEST]);
    expect(call.html, 'alert email must carry rendered HTML body').toBeTruthy();
  });

  it('does not run the availability warm-up after invalid_grant', async () => {
    seedTokenRow(Date.now() - 60_000);
    googleMocks.refreshAccessToken.mockRejectedValueOnce(invalidGrantError());

    await keepwarmHandler();

    // Non-tautological precondition: we really reached the invalid_grant
    // branch (the alert went out) — otherwise the assertion below would pass
    // vacuously on an early return.
    expect(resendSend).toHaveBeenCalledTimes(1);
    // Leaf-level warm-up signal: zero freebusy queries. This holds whether
    // the V2 warm-up calls google.calendar('v3').freebusy.query directly or
    // via src/lib/google-calendar.ts (same mocked 'googleapis' module).
    expect(googleMocks.freebusyQuery).not.toHaveBeenCalled();
  });
});
