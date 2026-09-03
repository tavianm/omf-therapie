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
// V2 warm-up scope (warmAvailabilityCache, issue #132 / T6): its own describe
// block below drives the handler with a valid token row and asserts the cache
// writes through the REAL src/lib/calendar-cache.ts (only the @netlify/blobs
// leaf is mocked). RED by design until T6 lands — the warm-up tests fail at
// assertion level (zero getAvailableSlots / setJSON calls) while V1 stays green.
//
// Mock strategy mirrors tests/unit/cron-handlers.test.ts exactly: `withMonitor`
// is a passthrough that invokes the callback immediately (so the monitor
// config is capturable AND the work function actually runs), and every
// external dep (Supabase, Resend, googleapis, ws, @react-email/render) is
// mocked at the leaf — no network, no DB.
//
// Review-fix contracts (#132 review round 2) — encoded test-first; the tests
// below marked RED-until-impl fail at ASSERTION level until the reworked
// netlify/functions/calendar-keepwarm.ts lands:
//   B1 fall-through — warm-up skipped ONLY on no-row / null refresh_token /
//     invalid_grant. Non-invalid_grant refresh failures (log + proceed) and
//     persist verification failures (warn + proceed) still reach the warm-up.
//   W2 — persist verification via .select('id').single(): a null data payload
//     (zero rows matched) counts as persist failure → warn + proceed.
//   B4 — the invalid_grant admin alert is throttled via a cooldown stored in
//     the 'calendar-keepwarm-state' @netlify/blobs store (key
//     'invalid-grant-alert', 24 h TTL), fail-open when blobs is unavailable.
//   W1 — every missing-required-env guard also captures a Sentry message at
//     level 'error' before returning.
//   B2 — GOOGLE_CALENDAR_ID unset skips ONLY the warm-up, never the token step.
//   S4 — Sentry.flush(2000) after healthy runs; a keepwarm throw is captured
//     AND rethrown (ported from the retired calendar-token-heartbeat tests).
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

// Fixture slot returned by the file-wide getAvailableSlots mock (V2 warm-up).
const MOCK_SLOT = {
  start: '2030-01-02T10:00:00+01:00',
  end: '2030-01-02T11:00:00+01:00',
  available: true,
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
// `setCredentials`, then `refreshAccessToken()`. NOTE: `freebusyQuery` is
// retained as a refresh-path leaf only — it is NO LONGER a valid "warm-up did
// NOT run" signal, because src/lib/google-calendar is mocked file-wide (see
// below): a RUNNING warm-up would never reach googleapis, so a freebusy
// assertion would pass even when the warm-up runs (tautology). The guard test
// asserts on the google-calendar getAvailableSlots spy instead.
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

// src/lib/google-calendar is mocked FILE-WIDE with an injectable
// getAvailableSlots spy. The specifier is resolved relative to THIS test
// file — vitest intercepts by resolved module ID, so the cron's own import
// (any specifier style, e.g. '../../src/lib/google-calendar.js') is captured.
// This is the ONLY valid observable for "did the warm-up run": see the
// googleapis note above for why the freebusy leaf became tautological once
// this mock exists.
const googleCalendar = vi.hoisted(() => ({
  getAvailableSlots: vi.fn(),
}));

vi.mock('../../src/lib/google-calendar', () => ({
  getAvailableSlots: googleCalendar.getAvailableSlots,
}));

// `@react-email/render` backs the CalendarAuthAlert email rendered on the
// invalid_grant path. Render is mocked (template itself loads for real).
vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html/>'),
}));

// @netlify/blobs leaf mock — availability-cache write assertions go through
// the REAL src/lib/calendar-cache.ts (real key construction, real
// TTL → expiresAt math); only the store leaf is faked.
//
// TWO named stores are served from the SAME in-memory implementation
// (contract B4): 'calendar-availability' (calendar-cache's warm-up store) and
// 'calendar-keepwarm-state' (the invalid_grant alert-cooldown store). Stores
// have REAL get/set semantics — writes go through to a per-store Map, get
// reads it back — because the cooldown contract needs a SECOND handler run to
// observe the state persisted by the first. Unknown store names resolve to an
// isolated misc store, so an impl writing the cooldown to the wrong store
// stays behaviorally functional but fails the state-store key assertions
// below. `blobsStore.store` remains the availability store so every existing
// warm-up assertion is preserved verbatim.
const blobsStore = vi.hoisted(() => {
  interface FakeStore {
    setJSON: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  }

  function createStore(): { store: FakeStore; backing: Map<string, unknown> } {
    const backing = new Map<string, unknown>();
    const store: FakeStore = {
      // Write-through (not call-recording-only): the B4 cooldown reads back
      // what a previous handler run wrote.
      setJSON: vi.fn(async (key: string, value: unknown) => {
        backing.set(key, value);
      }),
      set: vi.fn(async (key: string, value: unknown) => {
        backing.set(key, value);
      }),
      get: vi.fn(async (key: string) => backing.get(key) ?? null),
      delete: vi.fn(async (key: string) => {
        backing.delete(key);
      }),
      list: vi.fn(async () => ({
        blobs: Array.from(backing.keys()).map(key => ({ key })),
      })),
    };
    return { store, backing };
  }

  const availability = createStore();
  const state = createStore();
  const misc = createStore();

  const stores: Record<string, FakeStore> = {
    'calendar-availability': availability.store,
    'calendar-keepwarm-state': state.store,
  };
  const defaultGetStore = (name: string) => stores[name] ?? misc.store;
  const getStore = vi.fn(defaultGetStore);

  /** Clears call history + in-memory data and re-arms write-through impls. */
  function reset(): void {
    for (const { store, backing } of [availability, state, misc]) {
      backing.clear();
      store.setJSON.mockClear();
      store.setJSON.mockImplementation(async (key: string, value: unknown) => {
        backing.set(key, value);
      });
      store.set.mockClear();
      store.set.mockImplementation(async (key: string, value: unknown) => {
        backing.set(key, value);
      });
      store.get.mockClear();
      store.get.mockImplementation(
        async (key: string) => backing.get(key) ?? null,
      );
      store.delete.mockClear();
      store.delete.mockImplementation(async (key: string) => {
        backing.delete(key);
      });
      store.list.mockClear();
      store.list.mockImplementation(async () => ({ blobs: [] }));
    }
    getStore.mockClear();
    getStore.mockImplementation(defaultGetStore);
  }

  return {
    store: availability.store,
    stateStore: state.store,
    getStore,
    defaultGetStore,
    reset,
  };
});

vi.mock('@netlify/blobs', () => ({
  getStore: blobsStore.getStore,
}));

// ---------------------------------------------------------------------------
// Import the cron module AFTER the mocks are registered. Default export is a
// `handler()` function (Netlify bootstrap contract) wrapping
// Sentry.withMonitor; `shouldRefreshToken` is the exported pure decision fn.
// ---------------------------------------------------------------------------
import keepwarmHandler, {
  shouldRefreshToken,
} from '../../netlify/functions/calendar-keepwarm';
// REAL calendar-cache (only its @netlify/blobs leaf is mocked above) — used
// to compute the expected `available:{mode}:{duration}:4w:{weekStart}` keys.
import { buildAvailabilityCacheKey } from '../../src/lib/calendar-cache';

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

/**
 * Gaxios-like transient refresh error carrying raw config/response payloads
 * (fake secrets): pins that only err.message — never the payload objects —
 * reaches Sentry on the transient path.
 */
function transientRefreshError(): Error {
  return Object.assign(new Error('network glitch'), {
    config: {
      data: 'client_secret=RAW_CLIENT_SECRET&refresh_token=RAW_REFRESH_TOKEN',
    },
    response: { status: 503, data: 'RAW_CLIENT_SECRET must not leak' },
  });
}

/** Keys written to the 'calendar-keepwarm-state' store during this test. */
function stateStoreWriteKeys(): string[] {
  return [
    ...blobsStore.stateStore.setJSON.mock.calls.map(c => c[0] as string),
    ...blobsStore.stateStore.set.mock.calls.map(c => c[0] as string),
  ];
}

/**
 * W1 — missing-required-env guards must surface the misconfiguration to
 * Sentry at level 'error', not only to the logs. Accepts Sentry's canonical
 * string level ('error') or an options object carrying level: 'error'.
 */
function expectErrorLevelCaptureMessage(): void {
  expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  const [, level] = sentry.captureMessage.mock.calls[0] as [string, unknown];
  const isError =
    level === 'error' ||
    (typeof level === 'object' &&
      level !== null &&
      (level as { level?: unknown }).level === 'error');
  expect(
    isError,
    `captureMessage must carry level 'error' (got ${JSON.stringify(level)})`,
  ).toBe(true);
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

  // V2 warm-up + B4 cooldown mocks: google-calendar spy + @netlify/blobs
  // stores. reset() re-arms the write-through get/set implementations (a
  // fail-open test may have replaced them with mockRejectedValue) and clears
  // BOTH stores' in-memory data so cooldown state never leaks between tests.
  googleCalendar.getAvailableSlots.mockReset();
  googleCalendar.getAvailableSlots.mockResolvedValue([MOCK_SLOT]);

  blobsStore.reset();
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
  // T6's warm-up gates on GOOGLE_CALENDAR_ID (warn-and-continue in V1), and
  // calendar-cache's store lookup on GOOGLE_CALENDAR_MOCK. afterEach's
  // unstubAllEnvs() reverts the setup.ts stubs (and .env sets MOCK=true), so
  // both are re-stubbed here — mock mode OFF so the real calendar-cache store
  // path (mocked @netlify/blobs leaf) is exercised instead of its no-op.
  vi.stubEnv('GOOGLE_CALENDAR_ID', 'primary');
  vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'false');
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

  it('runs initSentry() BEFORE Sentry.withMonitor() (regression #113)', async () => {
    // The in_progress check-in — the only one carrying monitor_config —
    // requires an initialized client, so init must precede withMonitor.
    // Unlike reconcile-invitations (local initSentry on every invocation),
    // this cron uses the SHARED idempotent initSentry from _lib/sentry —
    // its module-level `initialized` flag was already consumed by the wiring
    // test above (and any earlier handler run), so re-import the cron module
    // with a fresh module registry to observe a first-ever invocation. The
    // vi.mock registrations survive resetModules, so the re-imported graph
    // still lands on the hoisted sentry spies.
    vi.resetModules();
    const { default: freshHandler } = await import(
      '../../netlify/functions/calendar-keepwarm'
    );
    sentry.init.mockClear();
    sentry.withMonitor.mockClear();
    // Still-valid token → the wrapped work function resolves cleanly.
    seedTokenRow(Date.now() + 16 * 60_000);

    await freshHandler();

    expect(sentry.init).toHaveBeenCalled();
    expect(sentry.withMonitor).toHaveBeenCalled();
    expect(sentry.init.mock.invocationCallOrder[0]).toBeLessThan(
      sentry.withMonitor.mock.invocationCallOrder[0],
    );
  });
});

// ===========================================================================
// Env guard alerting (W1) — a missing required env var is a configuration
// error that silences the alert channel itself: it must surface in Sentry at
// level 'error', not only in the function logs.
// RED-until-impl: the pre-rework guards only logger.warn + return.
// ===========================================================================

describe('env guard alerting (W1)', () => {
  it("captures a Sentry 'error'-level message and skips the run when ADMIN_EMAIL is missing", async () => {
    vi.stubEnv('ADMIN_EMAIL', '');

    // The guard skips the run — it must not crash the scheduled handler.
    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expectErrorLevelCaptureMessage();
    // The run aborted before any warm-up work.
    expect(googleCalendar.getAvailableSlots).not.toHaveBeenCalled();
  });

  it("captures a Sentry 'error'-level message and skips the run when a GOOGLE_OAUTH credential is missing", async () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expectErrorLevelCaptureMessage();
    expect(googleCalendar.getAvailableSlots).not.toHaveBeenCalled();
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
    // Sanitized capture contract: only the static sanitized Error reaches
    // captureException — the raw GaxiosError (whose response/config payloads
    // embed client_secret / refresh_token) must never be captured.
    expect(sentry.captureException).toHaveBeenCalledWith(
      new Error('Google OAuth token refresh failed: invalid_grant'),
    );
  });

  it('does not run the availability warm-up after invalid_grant', async () => {
    seedTokenRow(Date.now() - 60_000);
    googleMocks.refreshAccessToken.mockRejectedValueOnce(invalidGrantError());

    await keepwarmHandler();

    // Non-tautological precondition: we really reached the invalid_grant
    // branch (the alert went out) — otherwise the assertion below would pass
    // vacuously on an early return.
    expect(resendSend).toHaveBeenCalledTimes(1);
    // Primary warm-up signal: src/lib/google-calendar is mocked FILE-WIDE
    // (getAvailableSlots spy), so this assertion observes the cron's warm-up
    // import regardless of its specifier style. The previous leaf-level
    // signal (googleapis freebusy.query) was retired: once google-calendar is
    // mocked, a RUNNING warm-up could never reach googleapis, so that
    // assertion would pass even when the warm-up runs — a tautology.
    expect(googleCalendar.getAvailableSlots).not.toHaveBeenCalled();
    // B4: this run must also ARM the alert cooldown — the 10-minute cadence
    // must not re-alert every run while the token stays revoked. The state
    // store's spies are cleared per test, so this observes THIS run only;
    // a key landing on the state store also proves the dedicated
    // 'calendar-keepwarm-state' store name is used (unknown names resolve to
    // an isolated misc store in the blobs mock).
    expect(
      stateStoreWriteKeys(),
      'invalid_grant run must arm the cooldown in the calendar-keepwarm-state store under key invalid-grant-alert',
    ).toContain('invalid-grant-alert');
  });
});

// ===========================================================================
// Warm-up fall-through contract (B1 / B2 / W2) — the warm-up is skipped ONLY
// when auth is known-broken (no token row, null refresh_token, invalid_grant).
// Every other token-step outcome — non-invalid_grant refresh failure (B1 row
// 2 of the spec edge cases), persist verification failure (W2), refresh
// success — still reaches the warm-up.
// ===========================================================================

describe('warm-up fall-through contract (B1/B2/W2)', () => {
  it('skips the warm-up when there is no token row in the DB', async () => {
    // Default supabaseQuery resolution is the canonical empty result
    // (data: null) — the "no row" case. Deliberately no seedTokenRow().
    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Non-tautological precondition: the DB read really ran, so the skip is
    // attributable to the no-row guard and not an earlier env abort.
    expect(supabaseQuery).toHaveBeenCalled();
    expect(googleMocks.refreshAccessToken).not.toHaveBeenCalled();
    expect(googleCalendar.getAvailableSlots).not.toHaveBeenCalled();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    // Auth-broken on EVERY run while the cron monitor stays green — the
    // capture is the durable signal (same invariant as the env guards).
    expectErrorLevelCaptureMessage();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('no token row'),
      'error',
    );
  });

  it('sends the alert and skips the warm-up when the token row has a null refresh_token', async () => {
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: {
        refresh_token: null,
        access_token: 'ya29.old',
        expiry_date: Date.now() + 60 * 60_000,
      },
    });

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Non-tautological precondition: the alert path was really taken.
    expect(resendSend).toHaveBeenCalledTimes(1);
    // The cron monitor stays green here — the every-run Sentry capture is
    // the only durable signal if the alert email itself fails.
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('refresh_token is null'),
      'error',
    );
    expect(googleMocks.refreshAccessToken).not.toHaveBeenCalled();
    expect(googleCalendar.getAvailableSlots).not.toHaveBeenCalled();
  });

  it('still runs the warm-up (4 writes) when refresh fails with a NON-invalid_grant error', async () => {
    // Spec edge-case row 2: a transient refresh failure must not disable the
    // warm-up — log + proceed. RED-until-impl: the pre-rework code returns.
    seedTokenRow(Date.now() - 60_000); // expired → refresh is attempted
    googleMocks.refreshAccessToken.mockRejectedValueOnce(transientRefreshError());

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Precondition: the refresh was really attempted (and rejected above).
    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    // A transient failure is NOT invalid_grant — no admin alert email.
    expect(resendSend).not.toHaveBeenCalled();
    expect(googleCalendar.getAvailableSlots).toHaveBeenCalledTimes(4);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    // Sanitized capture contract: exactly one capture, a plain Error whose
    // message starts with the static prefix and never embeds the raw payload
    // fields the mock error carries (client_secret / refresh_token).
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const captured = sentry.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    const capturedMessage = (captured as Error).message;
    expect(
      capturedMessage.startsWith('Google OAuth token refresh failed (transient): '),
    ).toBe(true);
    expect(capturedMessage).not.toContain('RAW_CLIENT_SECRET');
    expect(capturedMessage).not.toContain('RAW_REFRESH_TOKEN');
  });

  it('still runs the warm-up when the refreshed token persist verification matches zero rows (W2)', async () => {
    seedTokenRow(Date.now() - 60_000); // expired → refresh is attempted
    // W2: the persist step verifies via .select('id').single(); the mock's
    // second queued resolution is that verification. data: null = zero rows
    // matched = persist failure → warn + proceed, NOT abort.
    supabaseQuery.mockResolvedValueOnce({ ...EMPTY_RESULT, data: null });

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(googleCalendar.getAvailableSlots).toHaveBeenCalledTimes(4);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    // W2 observability: the run still succeeds ('ok'), so the monitor stays
    // green — the recurring persist failure must surface in Sentry.
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('NOT confirmed persisted'),
      'warning',
    );
  });

  it('still runs the warm-up when persisting the refreshed token errors (W2)', async () => {
    seedTokenRow(Date.now() - 60_000);
    // Persist verification resolves a DB error → persist failure; the run
    // must still proceed to the warm-up. RED-until-impl: the pre-rework code
    // returns on updateError.
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: null,
      error: { message: 'persist failed', code: 'XX000' },
    });

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(googleCalendar.getAvailableSlots).toHaveBeenCalledTimes(4);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    // W2 observability: same contract as the zero-rows case above — the
    // failed persist is captured at 'warning' despite the green run.
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('NOT confirmed persisted'),
      'warning',
    );
  });

  it('runs the warm-up (4 writes) after a successful refresh AND persist — pins the refresh-branch coupling', async () => {
    seedTokenRow(Date.now() - 60_000); // expired → the refresh branch runs
    // Persist verification returns the matched row → persist succeeded.
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: { id: 'therapist' },
    });

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Non-tautological precondition: this really exercised the REFRESH branch
    // (the older warm-up tests only cover the still-valid shortcut).
    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(googleCalendar.getAvailableSlots).toHaveBeenCalledTimes(4);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
  });

  it('skips only the warm-up, not the token step, when GOOGLE_CALENDAR_ID is unset (B2)', async () => {
    vi.stubEnv('GOOGLE_CALENDAR_ID', '');
    seedTokenRow(Date.now() - 60_000); // expired → the token step must refresh

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Precondition: the run reached the refresh path — the warm-up skip is
    // attributable to the calendar-id guard, not an earlier abort.
    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(googleCalendar.getAvailableSlots).not.toHaveBeenCalled();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// warmAvailabilityCache (V2 warm-up, issue #132 / T6) — availability-cache
// pre-fill after a healthy token step.
//
// RED by design (test-first): until the cron implements the warm-up, these
// tests fail at ASSERTION level (getAvailableSlots / setJSON never called)
// while the V1 tests above stay green.
//
// Contract under test (approved plan):
//   - 4 combinations: {in-person, video} × {60, 90}
//   - horizon: now → now + 28 days (weeks=4); dbBusyPeriods = [] because the
//     patient read path re-applies live DB busy periods on a cache hit
//   - writes via setCachedAvailability(key, slots, 900): TTL 900 s must
//     outlast the 600 s cron cadence
//   - one (mode, duration) lookup failing must not cancel the other writes
//     (Promise.allSettled isolation)
//
// Keys + TTL are validated through the REAL src/lib/calendar-cache.ts — only
// the @netlify/blobs leaf is mocked (see blobsStore above).
// ===========================================================================

describe('warmAvailabilityCache (V2 warm-up)', () => {
  const WARM_MODES = ['in-person', 'video'] as const;
  const WARM_DURATIONS = [60, 90] as const;
  const FOUR_WEEKS_MS = 28 * 24 * 3600 * 1000;

  /** The 4 expected cache keys, built by the REAL calendar-cache key fn. */
  function expectedCacheKeys(): string[] {
    return WARM_MODES.flatMap(mode =>
      WARM_DURATIONS.map(duration =>
        buildAvailabilityCacheKey(mode, duration, 4, new Date()),
      ),
    );
  }

  it('writes the 4 cache keys {in-person,video}×{60,90} with TTL 900 s', async () => {
    // Valid token far in the future → no refresh → flow reaches the V2 seam.
    seedTokenRow(Date.now() + 60 * 60_000);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleCalendar.getAvailableSlots).toHaveBeenCalledTimes(4);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);

    // Keys: exactly the {in-person,video}×{60,90} grid for the current week.
    const writtenKeys = blobsStore.store.setJSON.mock.calls.map(c => c[0]);
    expect(new Set(writtenKeys)).toEqual(new Set(expectedCacheKeys()));

    // Payload + TTL: expiresAt = write time + 900_000 ms (TTL 900 s, which
    // must outlast the 600 s cron cadence). The (840_000, 900_000] ms window
    // excludes both the 600 s default and a 1800 s overshoot.
    for (const call of blobsStore.store.setJSON.mock.calls) {
      const entry = call[1] as { slots: unknown[]; expiresAt: number };
      expect(entry.slots).toEqual([MOCK_SLOT]);
      const remainingTtlMs = entry.expiresAt - Date.now();
      expect(remainingTtlMs).toBeLessThanOrEqual(900_000);
      expect(remainingTtlMs).toBeGreaterThan(900_000 - 60_000);
    }
  });

  it('calls getAvailableSlots with weeks=4 horizon (endDate ≈ now + 28 days) and empty DB busy periods', async () => {
    seedTokenRow(Date.now() + 60 * 60_000);
    const before = Date.now();

    await keepwarmHandler();

    expect(googleCalendar.getAvailableSlots).toHaveBeenCalledTimes(4);
    const seenCombos = googleCalendar.getAvailableSlots.mock.calls.map(call => {
      const [start, end, duration, mode, dbBusyPeriods] = call as [
        Date,
        Date,
        number,
        string,
        Array<{ start: string; end: string }>,
      ];
      // start ≈ run time (few-second tolerance).
      expect(start.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(start.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
      // Horizon: end − start ≈ 28 days (±1 min tolerance).
      expect(
        Math.abs(end.getTime() - start.getTime() - FOUR_WEEKS_MS),
      ).toBeLessThanOrEqual(60_000);
      // Duration is a number in {60, 90} (combo set asserted below).
      expect(duration).toBeTypeOf('number');
      // Patient read path re-applies live DB busy on cache hit → empty array.
      expect(dbBusyPeriods).toEqual([]);
      return `${mode}:${duration}`;
    });
    expect(seenCombos.sort()).toEqual([
      'in-person:60',
      'in-person:90',
      'video:60',
      'video:90',
    ]);
  });

  it('one key failing keeps the 3 other writes (Promise.allSettled isolation)', async () => {
    seedTokenRow(Date.now() + 60 * 60_000);
    googleCalendar.getAvailableSlots.mockImplementation(
      async (_start, _end, duration, mode) => {
        if (mode === 'video' && duration === 90) {
          throw new Error('boom — single (mode, duration) lookup fails');
        }
        return [MOCK_SLOT];
      },
    );

    // allSettled isolation: the single rejection must NOT propagate — the
    // handler still resolves (Promise.all here would reject → test fails).
    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(3);
    const writtenKeys = blobsStore.store.setJSON.mock.calls.map(c => c[0]);
    const survivors = expectedCacheKeys().filter(
      key => key !== buildAvailabilityCacheKey('video', 90, 4, new Date()),
    );
    expect(writtenKeys.sort()).toEqual(survivors.sort());
    // Per-key failure capture: exactly the failing key, at 'warning'
    // (beforeEach's resetMocks cleared the spy; the token step emitted no
    // capture on this still-valid-token path).
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('video/90'),
      'warning',
    );
  });
});

// ===========================================================================
// invalid_grant alert cooldown (B4) — the admin alert is throttled via a
// state entry in the 'calendar-keepwarm-state' blobs store (key
// 'invalid-grant-alert', 24 h TTL): the 10-minute cadence must not email the
// admin every run while the token stays revoked. Sentry still captures on
// every run, and blobs failures fail OPEN (the alert must never be lost
// because the cooldown mechanism itself is broken).
// ===========================================================================

describe('invalid_grant alert cooldown (B4)', () => {
  /** Seeds a revoked-token world: expired row + invalid_grant on refresh. */
  function seedRevokedToken(): void {
    seedTokenRow(Date.now() - 60_000); // expired → refresh is attempted
    googleMocks.refreshAccessToken.mockRejectedValueOnce(invalidGrantError());
  }

  it('first invalid_grant run sends the alert and records cooldown state in the calendar-keepwarm-state store', async () => {
    seedRevokedToken();

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(resendSend).toHaveBeenCalledTimes(1);
    // The cooldown state must be persisted for the next run to observe —
    // under the contract key, in the contract store (see stateStoreWriteKeys).
    expect(
      stateStoreWriteKeys(),
      'first invalid_grant run must arm the cooldown under key invalid-grant-alert in the calendar-keepwarm-state store',
    ).toContain('invalid-grant-alert');
  });

  it('second run within the cooldown window does NOT resend the alert but still captures to Sentry', async () => {
    // Persistent (non-Once) stubs so BOTH runs see the identical revoked-token
    // world — only the email spy is reset between runs. The cooldown read on
    // run 2 must observe the state run 1 wrote (the blobs mock is a real
    // in-memory write-through store).
    supabaseQuery.mockResolvedValue({
      ...EMPTY_RESULT,
      data: {
        refresh_token: '1//persisted-rt',
        access_token: 'ya29.old',
        expiry_date: Date.now() - 60_000,
      },
    });
    googleMocks.refreshAccessToken.mockRejectedValue(invalidGrantError());

    // Run 1 — alert goes out, cooldown is armed.
    await keepwarmHandler();
    expect(resendSend).toHaveBeenCalledTimes(1);
    const capturesAfterRun1 = sentry.captureException.mock.calls.length;
    expect(capturesAfterRun1).toBeGreaterThan(0);

    resendSend.mockClear(); // reset ONLY the email spy

    // Run 2, within the 24 h window — throttled email, Sentry still fires.
    await keepwarmHandler();
    expect(
      resendSend,
      'alert email must be throttled within the cooldown window',
    ).not.toHaveBeenCalled();
    expect(sentry.captureException.mock.calls.length).toBeGreaterThan(
      capturesAfterRun1,
    );
  });

  it('still sends the alert when writing the cooldown state throws (fail open)', async () => {
    seedRevokedToken();
    blobsStore.stateStore.setJSON.mockRejectedValue(
      new Error('blobs write failed'),
    );
    blobsStore.stateStore.set.mockRejectedValue(
      new Error('blobs write failed'),
    );

    await expect(keepwarmHandler()).resolves.toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(1);
    // Fail-open must stay alertable: a broken state store means repeat
    // emails (up to 144/day), not silence.
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed to record alert send'),
      'warning',
    );
  });

  it('still sends the alert when the blobs store is unavailable (fail open)', async () => {
    seedRevokedToken();
    blobsStore.getStore.mockRejectedValue(
      new Error('Netlify Blobs context unavailable'),
    );

    await expect(keepwarmHandler()).resolves.toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(1);
    // Fail-open must stay alertable (read-side failure — and the write side
    // fails the same way once the alert is sent, see the test above).
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('cooldown state unavailable'),
      'warning',
    );
  });
});

// ===========================================================================
// Sentry flush + failure capture (S4) — ported from the retired
// calendar-token-heartbeat tests: a healthy run flushes the Sentry client
// (Netlify freezes the instance on handler return), and a keepwarm throw is
// captured AND rethrown (so the Sentry monitor run is marked errored).
// ===========================================================================

describe('Sentry flush + failure capture (S4, ported from heartbeat)', () => {
  it('flushes Sentry with the 2 s budget after a healthy run', async () => {
    seedTokenRow(Date.now() + 60 * 60_000); // valid token → clean run

    await keepwarmHandler();

    // PUBLIC_SENTRY_DSN is stubbed in beforeEach, so the finally block runs.
    expect(sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('captures the exception and rethrows when the token step throws', async () => {
    supabaseQuery.mockRejectedValue(new Error('supabase unavailable'));

    // The handler must NOT swallow the failure: runKeepwarm captures +
    // rethrows so the scheduled run surfaces as errored.
    await expect(keepwarmHandler()).rejects.toThrow('supabase unavailable');

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'supabase unavailable' }),
    );
  });
});
