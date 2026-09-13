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
// V2 warm-up scope (warmAvailabilityCache, issue #153 / T6): its own describe
// block below drives the handler with a valid token row and asserts the
// mono-snapshot contract — ONE loadAvailabilitySnapshot (1 manual read +
// 1 Freebusy), pure derivation ×4, strict {computed, written, failed}
// telemetry — through the REAL src/lib/google-calendar + calendar-cache
// (I/O mocked at the leaves: manual-slots, googleapis, @netlify/blobs).
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

// Fixture slot is gone with the fan-out: T6's warm-up writes REAL slots
// derived by the pure engine, asserted against an in-test recomputation.

// Supabase client factory: chainable + thenable builder whose terminal calls
// (`.single()` / `.maybeSingle()` / awaited-then) resolve via `supabaseQuery`,
// so per-test seeding is a `supabaseQuery.mockResolvedValueOnce({ data })`.
const supabaseQuery = vi.fn(async () => ({ ...EMPTY_RESULT }));
// Every `.eq(...)` argument tuple across all chains — the SC8 CAS tests assert
// the UPDATE was conditioned on `.eq('updated_at', <value read>)`.
const supabaseEqCalls: Array<unknown[]> = [];
// Verb-aware recording (revue #154): `.eq(...)` tuples are attributed to the
// statement they actually condition — the flattened builder previously let a
// CAS assertion be satisfied by the SELECT's own `.eq('id', 'therapist')`.
const supabaseUpdateEqCalls: Array<unknown[]> = [];
// The SET payload of every update() call, in order.
const supabaseUpdatePayloads: Array<unknown> = [];
const supabaseFrom = vi.fn(() => {
  let lastVerb: 'select' | 'insert' | 'update' | 'delete' | null = null;
  const chain = {
    select: vi.fn(() => {
      lastVerb = 'select';
      return chain;
    }),
    insert: vi.fn((..._args: unknown[]) => {
      lastVerb = 'insert';
      return chain;
    }),
    update: vi.fn((...args: unknown[]) => {
      lastVerb = 'update';
      supabaseUpdatePayloads.push(args[0]);
      return chain;
    }),
    delete: vi.fn(() => {
      lastVerb = 'delete';
      return chain;
    }),
    eq: vi.fn((...args: unknown[]) => {
      supabaseEqCalls.push(args);
      if (lastVerb === 'update') supabaseUpdateEqCalls.push(args);
      return chain;
    }),
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
// `setCredentials`, then `refreshAccessToken()`. Since T6 (issue #153) the
// google.calendar FACTORY is consumed by the REAL loadAvailabilitySnapshot —
// the cron no longer builds a calendar itself — so the factory returns a
// counting Freebusy fake and freebusy.query IS the valid warm-up I/O
// observable again (no file-wide google-calendar mock anymore).
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
    // Healthy Freebusy response: the requested calendar entry MUST be present
    // with a structurally valid busy array (strict fail-closed contract — a
    // missing entry now throws a typed shared-stage error).
    data: { calendars: { primary: { busy: [] } } },
    error: null,
  })),
  // T6 (issue #153): ONE calendar built by the snapshot loader from the
  // ok-session client — captured here so tests can assert the construction
  // AND that the client carries the session's credentials.
  calendar: vi.fn(() => ({
    freebusy: { query: googleMocks.freebusyQuery },
  })),
}));
vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: class {
          // Mirrors google-auth-library's setCredentials contract (REPLACE,
          // not merge) so tests can observe `client.credentials` identity.
          credentials: Record<string, unknown> = {};
          constructor(
            _clientId?: string,
            _clientSecret?: string,
            _redirectUri?: string,
          ) {}
          setCredentials = (creds: Record<string, unknown>) => {
            googleMocks.setCredentials(creds);
            this.credentials = { ...creds };
          };
          refreshAccessToken = googleMocks.refreshAccessToken;
        },
      },
      calendar: googleMocks.calendar,
    },
  };
});

// Manual-slots mock at its module boundary (same idiom as
// tests/unit/availability-batch.test.ts): the mono-snapshot's manual read is
// counted / failure-seeded here, never through the DB. src/lib/google-calendar
// is NOT mocked — the cron exercises the REAL loadAvailabilitySnapshot + the
// REAL pure derivation, with every I/O leaf mocked (manual-slots here,
// googleapis freebusy above, supabase for the token step).
const manualSlotsApi = vi.hoisted(() => ({
  fetchManualSlots: vi.fn(
    async (
      _from: Date,
      _to: Date,
    ): Promise<Array<Record<string, unknown>>> => [],
  ),
}));

vi.mock('@/lib/manual-slots', () => ({
  fetchManualSlots: manualSlotsApi.fetchManualSlots,
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
// REAL pure derivation — the cron's written payloads are asserted against an
// in-test recomputation with the exact same engine (frozen clock).
import {
  filterSlotsByBusy,
  generateSlotsForRange,
} from '../../src/lib/google-calendar';

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
 * The cron's logger.warn/info/error lines, observed through the Sentry
 * breadcrumb each emits (PUBLIC_SENTRY_DSN is stubbed in beforeEach).
 */
function breadcrumbMessages(): string[] {
  return sentry.addBreadcrumb.mock.calls.map(
    call => (call[0] as { message?: string }).message ?? '',
  );
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
  supabaseEqCalls.length = 0;
  supabaseUpdateEqCalls.length = 0;
  supabaseUpdatePayloads.length = 0;

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
  googleMocks.calendar.mockClear();
  googleMocks.freebusyQuery.mockResolvedValue({
    data: { calendars: { primary: { busy: [] } } },
    error: null,
  });

  // V2 warm-up + B4 cooldown mocks: manual-slots counter + @netlify/blobs
  // stores. reset() re-arms the write-through get/set implementations (a
  // fail-open test may have replaced them with mockRejectedValue) and clears
  // BOTH stores' in-memory data so cooldown state never leaks between tests.
  manualSlotsApi.fetchManualSlots.mockReset();
  manualSlotsApi.fetchManualSlots.mockResolvedValue([]);

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
    const { default: freshHandler } =
      await import('../../netlify/functions/calendar-keepwarm');
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
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
  });

  it("captures a Sentry 'error'-level message and skips the run when a GOOGLE_OAUTH credential is missing", async () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expectErrorLevelCaptureMessage();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
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
    // Primary warm-up signal: src/lib/google-calendar is NOT mocked anymore,
    // so a RUNNING warm-up would issue exactly ONE Freebusy query through the
    // googleapis factory fake and write 4 cache keys. Zero on both = skipped.
    expect(googleMocks.freebusyQuery).not.toHaveBeenCalled();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
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
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
  });

  it('still runs the warm-up (4 writes) when refresh fails with a NON-invalid_grant error', async () => {
    // Spec edge-case row 2 (SC2 rework): a transient refresh failure must not
    // disable the warm-up as long as the PERSISTED token keeps > 6 min of
    // validity (the fall-through margin gate). 10 min → refresh fires
    // (< 15 min) AND the fall-through is admitted (> 6 min).
    seedTokenRow(Date.now() + 10 * 60_000);
    googleMocks.refreshAccessToken.mockRejectedValueOnce(
      transientRefreshError(),
    );

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Precondition: the refresh was really attempted (and rejected above).
    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    // A transient failure is NOT invalid_grant — no admin alert email.
    expect(resendSend).not.toHaveBeenCalled();
    // The warm-up ran on the fall-through session: ONE snapshot, 4 writes.
    expect(googleMocks.freebusyQuery).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    // Sanitized capture contract: exactly one capture, a plain Error whose
    // message starts with the static prefix and never embeds the raw payload
    // fields the mock error carries (client_secret / refresh_token).
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const captured = sentry.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    const capturedMessage = (captured as Error).message;
    expect(
      capturedMessage.startsWith(
        'Google OAuth token refresh failed (transient): ',
      ),
    ).toBe(true);
    expect(capturedMessage).not.toContain('RAW_CLIENT_SECRET');
    expect(capturedMessage).not.toContain('RAW_REFRESH_TOKEN');
  });

  it('preserves the newer row when the CAS-guarded persist matches zero rows (SC8 miss, was W2 zero-rows)', async () => {
    seedTokenRow(Date.now() - 60_000); // expired → refresh is attempted
    // CAS (SC8): the persist confirm surfaces a zero-row conditional UPDATE
    // as PGRST116 — a NEWER row exists (reconnexion or concurrent writer).
    // The miss is BENIGN: log + reconciliation re-read + continue on the
    // in-memory credentials — no longer a Sentry warning.
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });
    // The reconciliation re-read resolves via the resetMocks default.

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    const logs = breadcrumbMessages().join('\n');
    expect(logs).toContain('CAS miss — ligne récente préservée');
    // A miss is a benign race outcome — no alert of any kind.
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
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
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
  });

  it('skips only the warm-up, not the token step, when GOOGLE_CALENDAR_ID is unset (B2)', async () => {
    vi.stubEnv('GOOGLE_CALENDAR_ID', '');
    seedTokenRow(Date.now() - 60_000); // expired → the token step must refresh

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Precondition: the run reached the refresh path — the warm-up skip is
    // attributable to the calendar-id guard, not an earlier abort.
    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    // Warm-up skipped BEFORE the shared snapshot: no Freebusy, no writes.
    expect(googleMocks.freebusyQuery).not.toHaveBeenCalled();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// warmAvailabilityCache — mono-snapshot (issue #153 / T6, SC3/SC5/SC6)
//
// The T3-transitory ×4 fan-out (getAvailableSlots + {calendar} threading) is
// REPLACED by the batch contract:
//   SC3 — ONE loadAvailabilitySnapshot per run: exactly 1 manual_time_slots
//         read + 1 Freebusy query + 1 google_oauth_tokens select (the token
//         step's own), then a PURE derivation ×4 (generateSlotsForRange +
//         filterSlotsByBusy) with dbBusy=[] — the patient read path re-applies
//         live DB busy periods on every cache hit (N3, by design).
//   SC5 — a snapshot failure (Freebusy response-level errors on an HTTP 200,
//         transport failure, manual-slots read failure) performs ZERO cache
//         writes and PRESERVES existing entries; the log names the failed
//         stage. No invalid_grant alert from this path.
//   SC6 — strict writes: the final log reports {computed, written, failed}
//         where written counts ONLY confirmed writes.
//
// The cron runs the REAL src/lib/google-calendar (not mocked): its I/O leaves
// are the mocked ones — manual-slots (counter), googleapis calendar factory +
// freebusy (counter), supabase (token step). Keys + TTL go through the REAL
// calendar-cache (only @netlify/blobs is faked).
// ===========================================================================

describe('warmAvailabilityCache — mono-snapshot (SC3/SC5/SC6)', () => {
  const WARM_MODES = ['in-person', 'video'] as const;
  const WARM_DURATIONS = [60, 90] as const;
  const FOUR_WEEKS_MS = 28 * 24 * 3600 * 1000;

  /** The 4 expected cache keys, built by the REAL calendar-cache key fn. */
  function expectedCacheKeys(from: Date): string[] {
    return WARM_MODES.flatMap(mode =>
      WARM_DURATIONS.map(duration =>
        buildAvailabilityCacheKey(mode, duration, 4, from),
      ),
    );
  }

  /** Breadcrumb log-field payloads for messages containing `fragment`. */
  function breadcrumbData(fragment: string): Array<Record<string, unknown>> {
    return sentry.addBreadcrumb.mock.calls
      .filter(call =>
        String((call[0] as { message?: string }).message ?? '').includes(
          fragment,
        ),
      )
      .map(
        call =>
          ((call[0] as { data?: Record<string, unknown> }).data ??
            {}) as Record<string, unknown>,
      );
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SC3 healthy run: exactly 1 manual read + 1 Freebusy + 1 token select, then 4 confirmed writes', async () => {
    // Still-valid token → no refresh → the run's ONLY supabase terminal call
    // is keepTokenWarm's own token-row select.
    seedTokenRow(Date.now() + 60 * 60_000);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // ONE shared snapshot = the whole run's upstream availability I/O.
    expect(manualSlotsApi.fetchManualSlots).toHaveBeenCalledTimes(1);
    expect(googleMocks.freebusyQuery).toHaveBeenCalledTimes(1);
    // ONE calendar client, built by the snapshot loader from the session.
    expect(googleMocks.calendar).toHaveBeenCalledTimes(1);
    // ONE google_oauth_tokens select — the token step's own; the warm-up
    // performs NO token lookup of its own.
    expect(supabaseQuery).toHaveBeenCalledTimes(1);
    // The 4 derived keys, written through the REAL calendar-cache key fn.
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    expect(new Set(blobsStore.store.setJSON.mock.calls.map(c => c[0]))).toEqual(
      new Set(expectedCacheKeys(new Date())),
    );
  });

  it('SC6 telemetry: final log reports {computed: 4, written: 4, failed: 0} on a healthy run', async () => {
    seedTokenRow(Date.now() + 60 * 60_000);

    await keepwarmHandler();

    const logs = breadcrumbData('availability cache warm-up complete');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({ computed: 4, written: 4, failed: 0 });
  });

  it('SC6 telemetry: one cache write failing → {computed: 4, written: 3, failed: 1} — never a silent success', async () => {
    seedTokenRow(Date.now() + 60 * 60_000);
    // Writes are sequential in {mode}×{duration} pair order — the FIRST write
    // (in-person/60) fails; setCachedAvailability reports 'failed'.
    blobsStore.store.setJSON.mockRejectedValueOnce(
      new Error('blobs write failed'),
    );

    // The write failure is non-fatal: the run still resolves.
    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // All 4 writes were ATTEMPTED — exactly one failed, three landed.
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    const logs = breadcrumbData('availability cache warm-up complete');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({ computed: 4, written: 3, failed: 1 });
    // The failed key is reported at 'warning', never folded into a green
    // 'warmed' count (the old telemetry's failure mode).
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('(in-person/60)'),
      'warning',
    );
  });

  it('SC5 cron: Freebusy 200 with calendars[id].errors → 0 writes, existing entries INTACT, stage-named log', async () => {
    seedTokenRow(Date.now() + 60 * 60_000);
    googleMocks.freebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          primary: {
            errors: [{ domain: 'global', reason: 'notFound' }],
          },
        },
      },
    });
    // Pre-existing warm entry — must SURVIVE the failed run untouched.
    const protectedKey = 'available:in-person:60:4w:2026-09-07';
    const protectedEntry = {
      slots: [{ start: 's', end: 'e', available: true }],
      expiresAt: Date.now() + 900_000,
    };
    await blobsStore.store.setJSON(protectedKey, protectedEntry);
    blobsStore.store.setJSON.mockClear();

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.freebusyQuery).toHaveBeenCalledTimes(1);
    // ZERO writes — the failure must never be persisted as empty availability.
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    // The existing entry is intact (never overwritten, never deleted).
    expect(await blobsStore.store.get(protectedKey)).toEqual(protectedEntry);
    // The log names the failed shared stage; Sentry carries it at 'warning'.
    const stageLogs = breadcrumbData('availability snapshot failed');
    expect(stageLogs).toHaveLength(1);
    expect(String(stageLogs[0]?.['stage'])).toContain('availability-snapshot');
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('availability-snapshot'),
      'warning',
    );
    // No invalid_grant alert from this path — token alerts stay in the step.
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('SC5 cron: manual-slots read failure → 0 writes, existing entries INTACT, stage-named log, NO Freebusy', async () => {
    seedTokenRow(Date.now() + 60 * 60_000);
    manualSlotsApi.fetchManualSlots.mockRejectedValue(
      new Error('Failed to fetch manual slots: 504 Gateway timeout'),
    );
    const protectedKey = 'available:video:90:4w:2026-09-07';
    const protectedEntry = {
      slots: [{ start: 's', end: 'e', available: true }],
      expiresAt: Date.now() + 900_000,
    };
    await blobsStore.store.setJSON(protectedKey, protectedEntry);
    blobsStore.store.setJSON.mockClear();

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Stage isolation: the Freebusy query never runs after a failed read.
    expect(googleMocks.freebusyQuery).not.toHaveBeenCalled();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    expect(await blobsStore.store.get(protectedKey)).toEqual(protectedEntry);
    const stageLogs = breadcrumbData('availability snapshot failed');
    expect(stageLogs).toHaveLength(1);
    expect(String(stageLogs[0]?.['stage'])).toContain('availability-snapshot');
    // Sanitized: the raw upstream message never reaches the Sentry capture.
    const captured = String(sentry.captureMessage.mock.calls[0]?.[0] ?? '');
    expect(captured).toContain('availability-snapshot');
    expect(captured).not.toContain('Gateway timeout');
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('derives the 4 games PURELY from the snapshot: written payloads equal the local derivation, ONE query with the 4-week horizon (frozen clock)', async () => {
    // Frozen clock: the cron's `now`, the cache keys, the 24h-notice cutoff
    // and the Freebusy window all become deterministic — the expected
    // payloads below are recomputed with the SAME pure engine the cron runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T02:00:00Z'));
    seedTokenRow(Date.now() + 60 * 60_000);

    await keepwarmHandler();

    const now = new Date();
    const end = new Date(now.getTime() + FOUR_WEEKS_MS);
    // ONE Freebusy query covering the run's exact 4-week horizon.
    expect(googleMocks.freebusyQuery).toHaveBeenCalledTimes(1);
    expect(googleMocks.freebusyQuery).toHaveBeenCalledWith({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        timeZone: 'Europe/Paris',
        items: [{ id: 'primary' }],
      },
    });

    for (const mode of WARM_MODES) {
      for (const duration of WARM_DURATIONS) {
        const key = buildAvailabilityCacheKey(mode, duration, 4, now);
        const entry = (await blobsStore.store.get(key)) as {
          slots: unknown[];
          expiresAt: number;
        } | null;
        expect(entry, `key ${key} must be warm`).not.toBeNull();
        // dbBusy=[] by design (N3): the derivation sees ONLY the snapshot's
        // busy periods — the patient read path re-applies live DB busy.
        const expected = filterSlotsByBusy(
          generateSlotsForRange({
            startDate: now,
            endDate: end,
            duration,
            mode,
            now,
            manualSlots: new Map(),
          }),
          [],
        );
        expect(entry?.slots).toEqual(expected);
        // TTL 900 s — must outlast the 600 s cron cadence (unchanged).
        const remainingTtlMs = (entry?.expiresAt ?? 0) - Date.now();
        expect(remainingTtlMs).toBeLessThanOrEqual(900_000);
        expect(remainingTtlMs).toBeGreaterThan(900_000 - 60_000);
      }
    }
  });

  it('mock mode: snapshot performs ZERO I/O and the writes report skipped-no-store → {computed: 4, written: 0, failed: 0}', async () => {
    // DEV + GOOGLE_CALENDAR_MOCK=true — the dev mock short-circuits BOTH the
    // snapshot (empty, zero I/O) and the cache store ('skipped-no-store').
    vi.stubEnv('DEV', true);
    vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'true');
    seedTokenRow(Date.now() + 60 * 60_000);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Zero upstream I/O: no manual read, no Freebusy, no client build.
    expect(manualSlotsApi.fetchManualSlots).not.toHaveBeenCalled();
    expect(googleMocks.freebusyQuery).not.toHaveBeenCalled();
    expect(googleMocks.calendar).not.toHaveBeenCalled();
    // No store write (mock short-circuit preserved) — and NOT a failure.
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    const logs = breadcrumbData('availability cache warm-up complete');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({ computed: 4, written: 0, failed: 0 });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
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

// ===========================================================================
// KeepwarmSession — 3 honest states + 6-min margin gate (issue #153 / SC2)
//
// keepTokenWarm returns a session carrying the authenticated client instead
// of discarding it:
//   ok          — token valid (≥ 15 min), OR refreshed (persist confirmed or
//                 not), OR fall-through: refresh failed transiently but the
//                 PERSISTED token keeps > WARMUP_MIN_TOKEN_VALIDITY_MS
//                 (eager refresh threshold 5 min + 60 s warm-up budget =
//                 6 min) → client.setCredentials straight from the row.
//   transient   — the cron's own token-row READ fails (log « transient »,
//                 NOT « no token row »), OR refresh failed with margin
//                 ≤ threshold / token expired / expiry_date absent —
//                 warm-up skipped, NO alert of any kind.
//   auth-broken — unchanged #132 behavior (no row / null refresh_token /
//                 invalid_grant + cooled alert).
//
// The ok session's client is observable through the setCredentials spy, the
// ONE google.calendar({ version: 'v3', auth }) construction inside the REAL
// loadAvailabilitySnapshot (T6 mono-snapshot), and the 4 confirmed cache
// writes the run produces from the ONE snapshot.
//
// Margin boundaries need a FROZEN clock: real-time drift between seeding the
// row and the in-run margin check would flip the exact "6 min + 1 ms" case.
// ===========================================================================

describe('KeepwarmSession — 3 states + 6-min margin gate (SC2)', () => {
  /** Frozen clock instant shared by the boundary cases. */
  const T0 = new Date('2026-09-13T02:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Seeds a row that TRIGGERS the refresh, then fails it transiently. */
  function seedRowAndFailRefresh(expiryDate: number | null): void {
    seedTokenRow(expiryDate);
    googleMocks.refreshAccessToken.mockRejectedValueOnce(
      transientRefreshError(),
    );
  }

  it('fall-through (> 6 min persisted margin) → ok: warm-up client carries the ROW credentials, ONE calendar built from it, ≤ 1 token-endpoint call', async () => {
    const rowExpiry = T0 + 10 * 60_000; // 10 min: refresh fires (<15), margin >6
    seedRowAndFailRefresh(rowExpiry);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Token-endpoint budget: exactly the ONE (failed) refresh — no hidden or
    // retried token-endpoint interaction while the 4 warm-up calls run.
    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    // Fall-through identity: the session client is set straight from the row.
    expect(googleMocks.setCredentials).toHaveBeenLastCalledWith({
      access_token: 'ya29.old',
      refresh_token: '1//persisted-rt',
      expiry_date: rowExpiry,
    });
    // ONE calendar client built from the session's authenticated OAuth2Client
    // — inside loadAvailabilitySnapshot since T6 (no cron-side construction).
    expect(googleMocks.calendar).toHaveBeenCalledTimes(1);
    const built = googleMocks.calendar.mock.calls[0][0] as {
      version: string;
      auth: { credentials: Record<string, unknown> };
    };
    expect(built.version).toBe('v3');
    expect(
      built.auth.credentials.access_token,
      'fall-through identity: client.credentials.access_token === row.access_token',
    ).toBe('ya29.old');
    // The ONE snapshot served the whole warm-up: 1 Freebusy query, 4 writes.
    expect(googleMocks.freebusyQuery).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
  });

  it('still-valid token (≥ 15 min) → ok with credentials from the row, ZERO token-endpoint calls', async () => {
    seedTokenRow(T0 + 60 * 60_000);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).not.toHaveBeenCalled();
    expect(googleMocks.setCredentials).toHaveBeenCalledWith({
      access_token: 'ya29.old',
      refresh_token: '1//persisted-rt',
      expiry_date: T0 + 60 * 60_000,
    });
    expect(googleMocks.calendar).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
  });

  it('6 min + 1 ms of persisted margin → transient is avoided: ok, warm-up runs', async () => {
    seedRowAndFailRefresh(T0 + 6 * 60_000 + 1);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
    // No alert on the transient refresh failure.
    expect(resendSend).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('6 min exactly of persisted margin → transient: warm-up skipped, no alert', async () => {
    seedRowAndFailRefresh(T0 + 6 * 60_000);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // The refresh WAS attempted — the skip is attributable to the margin
    // gate, not an earlier abort.
    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    // Warm-up skipped BEFORE the snapshot: no Freebusy, no writes.
    expect(googleMocks.freebusyQuery).not.toHaveBeenCalled();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    // « aucune alerte » = no EMAIL (invalid_grant only) — but the under-margin
    // branch emits a durable SANITIZED Sentry capture (revue #154): the run
    // stays green and the cron monitor only detects missed runs, so a
    // persistent non-invalid_grant failure would otherwise be invisible.
    expect(resendSend).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const underMarginCapture = String(
      sentry.captureException.mock.calls[0][0] ?? '',
    );
    expect(underMarginCapture).toContain('margin insufficient');
    // Sanitized: the raw transient error (whose config/response payloads
    // embed test secrets) must never travel.
    expect(underMarginCapture).not.toContain('RAW_CLIENT_SECRET');
    expect(underMarginCapture).not.toContain('network glitch');
  });

  it('4 min of persisted margin → transient: warm-up skipped', async () => {
    seedRowAndFailRefresh(T0 + 4 * 60_000);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
    // Durable sanitized capture on the under-margin branch (revue #154).
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(String(sentry.captureException.mock.calls[0][0])).toContain(
      'margin insufficient',
    );
  });

  it('expired persisted token → transient: warm-up skipped', async () => {
    seedRowAndFailRefresh(T0 - 60_000);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
    // Expired token → under-margin branch → durable sanitized capture.
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(String(sentry.captureException.mock.calls[0][0])).toContain(
      'margin insufficient',
    );
  });

  it('unknown expiry (null expiry_date) → transient: warm-up skipped', async () => {
    seedRowAndFailRefresh(null);

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(googleMocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
    // Unknown expiry → under-margin branch → durable sanitized capture.
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(String(sentry.captureException.mock.calls[0][0])).toContain(
      'remainingMs=null',
    );
  });

  it('cron token-row read failure (504) → transient: log « transient », NOT « no token row », no email', async () => {
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      error: { code: '504', message: 'gateway timeout' },
    });

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // Precondition: the read really ran and nothing downstream followed.
    expect(supabaseQuery).toHaveBeenCalledTimes(1);
    expect(googleMocks.refreshAccessToken).not.toHaveBeenCalled();
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
    // No EMAIL on a transient read failure (invalid_grant only) — but a
    // durable sanitized capture exists (revue #154): persistent DB outages
    // must stay visible.
    expect(resendSend).not.toHaveBeenCalled();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const readFailureCapture = String(
      sentry.captureMessage.mock.calls[0][0] ?? '',
    );
    expect(readFailureCapture).toContain('token row read failed');
    // Sanitized: the raw error details never travel.
    expect(readFailureCapture).not.toContain('504');
    expect(readFailureCapture).not.toContain('gateway timeout');
    // Log wording (spec SC2): the run logs « transient », never the #132
    // « no token row » wording on a fetch failure.
    const logs = breadcrumbMessages().join('\n');
    expect(logs).toContain('transient');
    expect(logs).not.toContain('no token row');
  });

  it('PGRST116 (genuinely no row) on the cron select → auth-broken, unchanged #132 behavior', async () => {
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // No row is DEFINITIVE (not transient): the #132 contract holds — Sentry
    // capture at level 'error' with the « no token row » wording, warm-up
    // skipped.
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('no token row'),
      'error',
    );
    expect(blobsStore.store.setJSON).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CAS updated_at on the refresh persist (issue #153 / SC8) — CRON writer
//
// The conditional UPDATE may only overwrite the row AS READ (`.eq('updated_at',
// <value read at select time>)`): a newer write — the reconnexion callback or
// a concurrent refresh — must SURVIVE.
//   miss (PGRST116, 0 rows matched) → reconciliation re-read, log
//     « CAS miss — ligne récente préservée », run continues ok on the
//     in-memory credentials — never fatal, never an alert;
//   infra error (non-PGRST116) on the UPDATE → transient handling +
//     reconciliation re-read, NEVER collision/CAS wording.
// ===========================================================================

describe('CAS updated_at on the refresh persist (SC8) — cron writer', () => {
  const T1 = '2026-09-13T01:00:00.000Z';
  const T2 = '2026-09-13T01:05:00.000Z';

  const PGRST116 = {
    code: 'PGRST116',
    message: 'JSON object requested, multiple (or no) rows returned',
  };

  /** Seeds the v1 row (expired → the refresh fires) with updated_at = T1. */
  function seedV1Row(): void {
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: {
        refresh_token: '1//rt-v1',
        access_token: 'ya29.v1',
        expiry_date: Date.now() - 60_000,
        updated_at: T1,
      },
    });
  }

  it('race: v2 lands after the read → UPDATE conditioned on updated_at=T1 matches 0 rows → v2 preserved, CAS-miss logged, run continues ok', async () => {
    seedV1Row();
    // Refresh succeeds (default mock → ya29.new / 1//new-rt).
    // Persist confirm: the conditional UPDATE matched 0 rows (v2 landed).
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: null,
      error: PGRST116,
    });
    // Reconciliation re-read observes the SURVIVING v2 row.
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: {
        refresh_token: '1//rt-v2',
        access_token: 'ya29.v2',
        expiry_date: Date.now() + 3_600_000,
        updated_at: T2,
      },
    });

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    // The UPDATE was CAS-conditioned on the value READ at select time —
    // asserted on the UPDATE chain specifically (verb-aware recording, revue
    // #154): the global array is trivially satisfied by the SELECT.
    expect(supabaseUpdateEqCalls).toContainEqual(['updated_at', T1]);
    expect(supabaseUpdateEqCalls).toContainEqual(['id', 'therapist']);
    // The SET payload carries the refreshed credentials.
    expect(supabaseUpdatePayloads).toHaveLength(1);
    expect(supabaseUpdatePayloads[0]).toMatchObject({
      access_token: 'ya29.new',
      refresh_token: '1//new-rt',
    });
    // 3 selects: v1 read, persist confirm, reconciliation re-read (v2 back).
    expect(supabaseQuery).toHaveBeenCalledTimes(3);
    // CAS-miss logged with the spec wording; a miss is benign — no alert.
    const logs = breadcrumbMessages().join('\n');
    expect(logs).toContain('CAS miss — ligne récente préservée');
    expect(resendSend).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    // Run continues 'ok' on the in-memory credentials → warm-up ran.
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
  });

  it('infra error (non-PGRST116) on the conditional UPDATE → reconciliation re-read, transient handling, NO CAS/collision wording', async () => {
    seedV1Row();
    supabaseQuery.mockResolvedValueOnce({
      ...EMPTY_RESULT,
      data: null,
      error: { code: 'XX000', message: 'connection terminated unexpectedly' },
    });
    // Reconciliation re-read (row state unknown — tolerated).

    await expect(keepwarmHandler()).resolves.toBeUndefined();

    expect(supabaseUpdateEqCalls).toContainEqual(['updated_at', T1]);
    expect(supabaseUpdatePayloads).toHaveLength(1);
    expect(supabaseUpdatePayloads[0]).toMatchObject({
      access_token: 'ya29.new',
      refresh_token: '1//new-rt',
    });
    expect(supabaseQuery).toHaveBeenCalledTimes(3);
    const logs = breadcrumbMessages().join('\n');
    expect(logs).not.toContain('CAS');
    expect(logs).not.toContain('collision');
    // Transient infra observability (W2 wording kept).
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('NOT confirmed persisted'),
      'warning',
    );
    // Run continues 'ok' → warm-up ran.
    expect(blobsStore.store.setJSON).toHaveBeenCalledTimes(4);
  });
});
