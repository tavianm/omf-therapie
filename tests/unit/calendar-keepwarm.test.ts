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
// TTL → expiresAt math); only the store leaf is faked. getStore returns a
// stable in-memory store object so calendar-cache's module-level store
// promise stays valid for the whole file; call history is cleared per test.
const blobsStore = vi.hoisted(() => {
  const store = {
    setJSON: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ blobs: [] })),
  };
  return { store, getStore: vi.fn(() => store) };
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

  // V2 warm-up mocks: google-calendar spy + @netlify/blobs store leaf.
  // mockReset (not mockClear) so a per-test mockImplementation/isolation
  // rejection cannot leak into the next test, then restore the default
  // resolution (one fixture slot per lookup).
  googleCalendar.getAvailableSlots.mockReset();
  googleCalendar.getAvailableSlots.mockResolvedValue([MOCK_SLOT]);

  blobsStore.getStore.mockClear();
  blobsStore.store.setJSON.mockClear();
  blobsStore.store.setJSON.mockResolvedValue(undefined);
  blobsStore.store.set.mockClear();
  blobsStore.store.get.mockClear();
  blobsStore.store.get.mockResolvedValue(null);
  blobsStore.store.delete.mockClear();
  blobsStore.store.list.mockClear();
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
    // Primary warm-up signal: src/lib/google-calendar is mocked FILE-WIDE
    // (getAvailableSlots spy), so this assertion observes the cron's warm-up
    // import regardless of its specifier style. The previous leaf-level
    // signal (googleapis freebusy.query) was retired: once google-calendar is
    // mocked, a RUNNING warm-up could never reach googleapis, so that
    // assertion would pass even when the warm-up runs — a tautology.
    expect(googleCalendar.getAvailableSlots).not.toHaveBeenCalled();
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
    const seenCombos = googleCalendar.getAvailableSlots.mock.calls.map(
      call => {
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
      },
    );
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
  });
});
