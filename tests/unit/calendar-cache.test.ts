// ---------------------------------------------------------------------------
// Unit tests — src/lib/calendar-cache.ts (spec #153 SC6, node N4).
//
// Contract under test:
//   setCachedAvailability returns an explicit CacheWriteResult:
//     'written'           — Blob write confirmed
//     'skipped-no-store'  — mock guard short-circuit (zero store interaction)
//                           OR no Netlify Blobs context (revue #154: expected
//                           no-store runtime state, memoised — see below)
//     'failed'            — store init failure OR write failure
//   A failed store init must NOT pin the memoised promise: the next
//   invocation retries init (previously one failure disabled the cache
//   until a cold restart).
//   A MISSING Blobs context (plain `astro dev`, no `netlify dev`) is NOT a
//   failure: detected before init, memoised for the instance, mapped to
//   'skipped-no-store' with zero getStore attempts and zero error logs
//   (revue #154 — previously every read/write re-attempted init + logged).
//
// Mock strategy: only the @netlify/blobs leaf and the mock-mode guard are
// faked — the real calendar-cache logic (key, TTL → expiresAt math,
// memoisation) runs for real. calendar-cache memoises its store promise at
// module level, so every test resets the module registry and dynamically
// re-imports it for a clean slate (same idiom as tests/unit/resend.test.ts).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeSlot } from '@/lib/google-calendar';

const blobsMock = vi.hoisted(() => ({
  getStore: vi.fn(),
}));

vi.mock('@netlify/blobs', () => ({ getStore: blobsMock.getStore }));

const mockMode = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/lib/mock-mode.server', () => ({
  isCalendarMockEnabled: () => mockMode.enabled,
}));

interface FakeStore {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setJSON: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

function createFakeStore(): FakeStore {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    setJSON: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ blobs: [] })),
  };
}

const SLOTS: TimeSlot[] = [
  {
    start: '2026-06-17T08:00:00+02:00',
    end: '2026-06-17T09:00:00+02:00',
    available: true,
  },
];

const CACHE_KEY = 'available:video:60:4w:2026-06-15';

describe('setCachedAvailability — CacheWriteResult (SC6)', () => {
  // Fresh module instance per test: calendar-cache keeps `_storePromise` in
  // module-level state, and the spec under test is precisely that a failed
  // init must not poison it across invocations.
  let cache: typeof import('@/lib/calendar-cache');
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    blobsMock.getStore.mockReset();
    mockMode.enabled = false;
    // Simulate the Netlify runtime for the context-present tests: the module
    // mirrors @netlify/blobs' own resolution (globalThis.netlifyBlobsContext
    // || NETLIFY_BLOBS_CONTEXT) and skips init entirely without one.
    vi.stubEnv('NETLIFY_BLOBS_CONTEXT', JSON.stringify({ siteID: 'test' }));
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cache = await import('@/lib/calendar-cache');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("happy path — returns 'written' and persists the entry with the requested TTL", async () => {
    const store = createFakeStore();
    blobsMock.getStore.mockReturnValue(store);

    const before = Date.now();
    const result = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);
    const after = Date.now();

    expect(result).toBe('written');
    expect(blobsMock.getStore).toHaveBeenCalledTimes(1);
    expect(blobsMock.getStore).toHaveBeenCalledWith('calendar-availability');
    expect(store.setJSON).toHaveBeenCalledTimes(1);

    const [key, entry] = store.setJSON.mock.calls[0] as [
      string,
      { slots: TimeSlot[]; expiresAt: number },
    ];
    expect(key).toBe(CACHE_KEY);
    expect(entry.slots).toEqual(SLOTS);
    // TTL (seconds) → expiresAt (ms), computed around the write time.
    expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 900 * 1000);
    expect(entry.expiresAt).toBeLessThanOrEqual(after + 900 * 1000);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("write failure — returns 'failed' and logs a fixed classification (no raw error object, no credential-shaped message text)", async () => {
    const store = createFakeStore();
    // Credential-shaped sentinel: production logs err.message verbatim, a
    // message carrying secrets would reach the log unchanged (revue #154 —
    // the old assertion only checked the value's TYPE).
    store.setJSON.mockRejectedValue(
      new Error(
        'blobs write timeout: refresh_token=1//SECRET_REFRESH_TOKEN client_secret=GOCSPX-SECRET',
      ),
    );
    blobsMock.getStore.mockReturnValue(store);

    const result = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);

    expect(result).toBe('failed');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const args = errorSpy.mock.calls[0] as unknown[];
    // Log prefix style: '[calendar-cache] …' with a French message.
    expect(String(args[0])).toContain('calendar-cache');
    // Sanitized: the raw error object itself is never logged…
    expect(args.some(a => a instanceof Error)).toBe(false);
    // …and neither is any sensitive content from its message (fixed
    // classification only — error class, no message text).
    const rendered = args.map(String).join(' ');
    expect(rendered).not.toContain('SECRET_REFRESH_TOKEN');
    expect(rendered).not.toContain('GOCSPX-SECRET');
    expect(rendered).not.toContain('blobs write timeout');
    expect(rendered).toContain('Error');
  });

  it('init failure log carries no credential-shaped content either', async () => {
    blobsMock.getStore.mockRejectedValue(
      new Error(
        'getStore failed: Authorization: Bearer SECRET_BEARER_TOKEN',
      ),
    );

    const result = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);

    expect(result).toBe('failed');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const rendered = (errorSpy.mock.calls[0] as unknown[])
      .map(String)
      .join(' ');
    expect(rendered).not.toContain('SECRET_BEARER_TOKEN');
    expect(rendered).not.toContain('getStore failed');
    expect(rendered).toContain('calendar-cache');
  });

  it("init failure then success — first call 'failed', init retried on next invocation, second call 'written'", async () => {
    const store = createFakeStore();
    blobsMock.getStore
      .mockRejectedValueOnce(new Error('no Netlify context'))
      .mockReturnValueOnce(store);

    const first = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);
    expect(first).toBe('failed');
    expect(store.setJSON).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1); // init failure logged once

    // The memoised promise must have been reset — the store init is retried
    // (previously it stayed pinned to null until a cold restart).
    const second = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);
    expect(second).toBe('written');
    expect(blobsMock.getStore).toHaveBeenCalledTimes(2);
    expect(store.setJSON).toHaveBeenCalledTimes(1);
  });

  it("mock guard — returns 'skipped-no-store' with zero store interactions", async () => {
    mockMode.enabled = true;
    blobsMock.getStore.mockRejectedValue(new Error('should never be reached'));

    const result = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);

    expect(result).toBe('skipped-no-store');
    expect(blobsMock.getStore).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Outside Netlify (revue #154) — a MISSING Blobs context is an expected
// no-store runtime state, never a failure: no init attempt, no error log,
// writes report 'skipped-no-store', and the outcome is memoised for the
// instance (no re-detection storm on every read/write).
// ---------------------------------------------------------------------------

describe('no Netlify Blobs context — expected no-store state (revue #154)', () => {
  let cache: typeof import('@/lib/calendar-cache');
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    blobsMock.getStore.mockReset();
    mockMode.enabled = false;
    // Plain Node/`astro dev` runtime: NO Blobs context anywhere.
    vi.unstubAllEnvs();
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    cache = await import('@/lib/calendar-cache');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no context → writes report 'skipped-no-store', ZERO getStore attempts, ZERO error logs", async () => {
    const result = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);

    expect(result).toBe('skipped-no-store');
    expect(blobsMock.getStore).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    // Detection is announced once per instance — informationally, not as an
    // error.
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it('the unavailable outcome is MEMOISED — a second write neither re-detects nor logs again', async () => {
    await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);
    await cache.setCachedAvailability('available:video:90:4w:2026-06-15', SLOTS, 900);

    expect(blobsMock.getStore).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it('reads degrade to null with zero store interaction', async () => {
    const cached = await cache.getCachedAvailability(CACHE_KEY);

    expect(cached).toBeNull();
    expect(blobsMock.getStore).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("getStore throwing MissingBlobsEnvironmentError (context present but incomplete) → same memoised 'skipped-no-store' outcome, ONE attempt only", async () => {
    // Context IS configured (env stubbed) but the library still rejects —
    // e.g. token missing from the context payload. Same class, same
    // behaviour: memoised unavailable, never retried, never an error log.
    vi.stubEnv('NETLIFY_BLOBS_CONTEXT', JSON.stringify({ siteID: 'test' }));
    const missingEnvError = new Error(
      'Both siteID and token must be provided',
    );
    missingEnvError.name = 'MissingBlobsEnvironmentError';
    blobsMock.getStore.mockRejectedValue(missingEnvError);

    const first = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);
    expect(first).toBe('skipped-no-store');
    expect(blobsMock.getStore).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();

    const second = await cache.setCachedAvailability(CACHE_KEY, SLOTS, 900);
    expect(second).toBe('skipped-no-store');
    // Memoised: no second init attempt.
    expect(blobsMock.getStore).toHaveBeenCalledTimes(1);
  });
});
