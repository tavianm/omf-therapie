import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarNetworkError,
  CalendarSharedStageError,
  createCalendarEvent,
  filterSlotsByBusy,
  generateSlotsForRange,
  getAvailableSlots,
  getPersistedOAuthClient,
  GoogleCalendarError,
  loadAvailabilitySnapshot,
  type GenerateSlotsInput,
} from '@/lib/google-calendar';
import type { Period } from '@/types/manual-slots';
import type { Auth, calendar_v3 } from 'googleapis';

// ---------------------------------------------------------------------------
// Supabase mock (idiom: tests/unit/manual-slots.test.ts) — a chainable query
// whose terminal `.single()` resolves a per-test seeded result, plus write
// spies so the SC1 oracles can assert that ZERO writes to google_oauth_tokens
// originate from the token-row READ path (issue #153).
// ---------------------------------------------------------------------------
const supabaseMock = vi.hoisted(() => ({
  // Seed per test: the { data, error } resolved by the token-row select.
  tokenSelect: {
    data: null as unknown,
    error: null as { code?: string; message?: string } | null,
  },
  // Queue consumed by successive `.single()` calls (persist confirm,
  // reconciliation re-reads); falls back to tokenSelect when empty.
  singleQueue: [] as Array<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>,
  singleCalls: 0,
  // Every `.eq(...)` argument tuple — the SC8 CAS tests assert the UPDATE was
  // conditioned on `.eq('updated_at', <value read>)`.
  eqCalls: [] as Array<unknown[]>,
  // Write spies — a read path must never call these.
  update: vi.fn(),
  upsert: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      supabaseMock.eqCalls.push(args);
      return query;
    },
    single: async () => {
      supabaseMock.singleCalls += 1;
      // The FIRST `.single()` of every flow is the token-row READ (seeded via
      // tokenSelect); later calls are persist confirms / reconciliation
      // re-reads and consume the queue.
      if (supabaseMock.singleCalls === 1) return supabaseMock.tokenSelect;
      return supabaseMock.singleQueue.shift() ?? supabaseMock.tokenSelect;
    },
    update: supabaseMock.update,
    upsert: supabaseMock.upsert,
    insert: supabaseMock.insert,
  };
  supabaseMock.update.mockReturnValue(query);
  supabaseMock.upsert.mockReturnValue(query);
  supabaseMock.insert.mockReturnValue(query);
  return {
    supabaseAdmin: { from: (_table: string) => query },
  };
});

// Minimal googleapis mock: the SC8 tests drive getPersistedOAuthClient into
// refreshAccessToken(), which must never hit the real token endpoint. The
// stub client records credentials so tests can assert the in-memory identity.
const googleOAuth = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(async () => ({
    credentials: {
      access_token: 'ya29.refreshed',
      refresh_token: '1//echoed-rt',
      expiry_date: Date.now() + 3_600_000,
    },
  })),
}));

// The calendar() FACTORY is hoisted too so the shared-snapshot tests (SC3/SC5)
// can inject a counting Freebusy fake as the client built from the injected
// OAuth2Client. Default return keeps the previous inert `{}`.
const googleCalendarFactory = vi.hoisted(() => ({
  calendar: vi.fn((): unknown => ({})),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        credentials: Record<string, unknown> = {};
        constructor(
          _clientId?: string,
          _clientSecret?: string,
          _redirectUri?: string,
        ) {}
        setCredentials(creds: Record<string, unknown>) {
          this.credentials = { ...creds };
        }
        refreshAccessToken = googleOAuth.refreshAccessToken;
      },
    },
    calendar: googleCalendarFactory.calendar,
  },
}));

// Manual-slots mock at its module boundary (same idiom as
// tests/unit/availability-batch.test.ts): the shared snapshot's stage 1 is
// observed/failure-seeded here, never through the DB.
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

// ---------------------------------------------------------------------------
// Paris-timezone helpers (deterministic regardless of the host's local TZ).
// Mirrors the prod logic so tests assert against the same calendar the user
// sees in Europe/Paris.
// ---------------------------------------------------------------------------

const TZ = 'Europe/Paris';
const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function parisWeekday(date: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
  }).format(date);
  return WEEKDAY_MAP[wd] ?? 7;
}

function parisDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parisHourMinute(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(
    parts.find(p => p.type === 'minute')?.value ?? '0',
    10,
  );
  return { hour: hour === 24 ? 0 : hour, minute };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_NOTICE_MS = 24 * 60 * 60 * 1000;

// Fixed "now": 2026-06-15. Range covers the next two weeks. DST is stable in
// June (Europe/Paris is UTC+2 throughout), so +DAY_MS stepping stays aligned to
// Paris calendar days.
const NOW = new Date('2026-06-15T01:00:00Z');
const START = new Date(NOW.getTime());
const END = new Date(NOW.getTime() + 14 * DAY_MS);

function buildInput(
  overrides: Partial<GenerateSlotsInput> & { mode: 'in-person' | 'video' },
): GenerateSlotsInput {
  return {
    startDate: START,
    endDate: END,
    duration: 60,
    now: NOW,
    manualSlots: new Map(),
    ...overrides,
  };
}

function manualMap(
  entries: Array<[string, Period[]]>,
): Map<string, Set<Period>> {
  const map = new Map<string, Set<Period>>();
  for (const [date, periods] of entries) {
    map.set(date, new Set(periods));
  }
  return map;
}

/**
 * First Paris-calendar day in range matching `weekday` that can actually yield
 * slots — i.e. strictly after the 24h-notice cutoff (minStart). The first
 * matching weekday may fall entirely before minStart and produce 0 slots, so
 * we skip any day whose Paris date is <= minStart's Paris date.
 */
function firstDateKeyWithWeekday(weekday: number): string {
  const minStartKey = parisDateKey(new Date(NOW.getTime() + MIN_NOTICE_MS));
  for (let i = 0; i < 14; i++) {
    const instant = new Date(START.getTime() + i * DAY_MS);
    if (
      parisWeekday(instant) === weekday &&
      parisDateKey(instant) > minStartKey
    ) {
      return parisDateKey(instant);
    }
  }
  throw new Error(`no weekday ${weekday} found in range after minStart`);
}

describe('generateSlotsForRange — eligibility model', () => {
  describe('default (no manual slots)', () => {
    it('in-person: slots only on Wednesdays', () => {
      const slots = generateSlotsForRange(buildInput({ mode: 'in-person' }));
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) {
        expect(parisWeekday(new Date(slot.start))).toBe(3); // Wednesday
      }
    });

    it('video: slots only on Mon/Tue/Thu/Fri (inverse of cabinet, no Wednesday, no weekend)', () => {
      const slots = generateSlotsForRange(buildInput({ mode: 'video' }));
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) {
        const wd = parisWeekday(new Date(slot.start));
        expect([1, 2, 4, 5]).toContain(wd); // Mon, Tue, Thu, Fri — never Wed (3), never weekend (6,7)
      }
    });

    it('video and in-person are strictly disjoint (no shared slot start)', () => {
      const inPerson = generateSlotsForRange(buildInput({ mode: 'in-person' }));
      const video = generateSlotsForRange(buildInput({ mode: 'video' }));
      const inPersonStarts = new Set(inPerson.map(s => s.start));
      for (const s of video) {
        expect(inPersonStarts.has(s.start)).toBe(false);
      }
    });
  });

  describe('additive manual slots (cabinet gains, visio loses)', () => {
    it('manual morning on a Monday → in-person gains Monday morning only', () => {
      const monday = firstDateKeyWithWeekday(1);
      const slots = generateSlotsForRange(
        buildInput({
          mode: 'in-person',
          manualSlots: manualMap([[monday, ['morning']]]),
        }),
      );

      const mondayStarts = slots.filter(
        s => parisDateKey(new Date(s.start)) === monday,
      );
      expect(mondayStarts.length).toBeGreaterThan(0);
      for (const s of mondayStarts) {
        const { hour } = parisHourMinute(new Date(s.start));
        expect(hour).toBeGreaterThanOrEqual(8);
        expect(hour).toBeLessThan(12); // morning only
      }
    });

    it('manual morning on a Monday → video loses Monday morning, keeps Monday afternoon', () => {
      const monday = firstDateKeyWithWeekday(1);
      const slots = generateSlotsForRange(
        buildInput({
          mode: 'video',
          manualSlots: manualMap([[monday, ['morning']]]),
        }),
      );

      const mondaySlots = slots.filter(
        s => parisDateKey(new Date(s.start)) === monday,
      );
      for (const s of mondaySlots) {
        const { hour } = parisHourMinute(new Date(s.start));
        // Afternoon only — morning is now cabinet, so visio must not offer it.
        expect(hour).toBeGreaterThanOrEqual(14);
        expect(hour).toBeLessThan(19);
      }
      // Monday afternoon video slots exist
      expect(mondaySlots.length).toBeGreaterThan(0);
    });

    it('manual all_day on a weekday → cabinet both halves, video none that day', () => {
      const tuesday = firstDateKeyWithWeekday(2);
      const inPerson = generateSlotsForRange(
        buildInput({
          mode: 'in-person',
          manualSlots: manualMap([[tuesday, ['all_day']]]),
        }),
      );
      const video = generateSlotsForRange(
        buildInput({
          mode: 'video',
          manualSlots: manualMap([[tuesday, ['all_day']]]),
        }),
      );

      const ipTue = inPerson.filter(
        s => parisDateKey(new Date(s.start)) === tuesday,
      );
      const vidTue = video.filter(
        s => parisDateKey(new Date(s.start)) === tuesday,
      );
      expect(ipTue.length).toBeGreaterThan(0);
      expect(vidTue).toHaveLength(0);
    });

    it('Wednesday stays fully cabinet even when a manual slot is added on it (additive)', () => {
      const wednesday = firstDateKeyWithWeekday(3);
      const inPerson = generateSlotsForRange(
        buildInput({
          mode: 'in-person',
          manualSlots: manualMap([[wednesday, ['morning']]]),
        }),
      );
      const video = generateSlotsForRange(
        buildInput({
          mode: 'video',
          manualSlots: manualMap([[wednesday, ['morning']]]),
        }),
      );

      const ipWed = inPerson.filter(
        s => parisDateKey(new Date(s.start)) === wednesday,
      );
      const vidWed = video.filter(
        s => parisDateKey(new Date(s.start)) === wednesday,
      );
      // Wednesday afternoon remains cabinet (not flipped to visio)
      const ipWedPm = ipWed.filter(
        s => parisHourMinute(new Date(s.start)).hour >= 14,
      );
      expect(ipWedPm.length).toBeGreaterThan(0);
      expect(vidWed).toHaveLength(0);
    });
  });

  describe('structural invariants', () => {
    it('never emits weekend slots (Sat/Sun) for either mode', () => {
      const inPerson = generateSlotsForRange(buildInput({ mode: 'in-person' }));
      const video = generateSlotsForRange(buildInput({ mode: 'video' }));
      for (const s of [...inPerson, ...video]) {
        expect([6, 7]).not.toContain(parisWeekday(new Date(s.start)));
      }
    });

    it('respects the 24h minimum notice — no slot starts before now + 24h', () => {
      const minStart = NOW.getTime() + MIN_NOTICE_MS;
      const inPerson = generateSlotsForRange(buildInput({ mode: 'in-person' }));
      for (const s of inPerson) {
        expect(new Date(s.start).getTime()).toBeGreaterThanOrEqual(minStart);
      }
    });

    it('morning slots stay within 08:00–12:00, afternoon within 14:00–19:00 (Paris)', () => {
      const wednesday = firstDateKeyWithWeekday(3);
      const inPerson = generateSlotsForRange(buildInput({ mode: 'in-person' }));
      const wedSlots = inPerson.filter(
        s => parisDateKey(new Date(s.start)) === wednesday,
      );

      const startHours = wedSlots.map(
        s => parisHourMinute(new Date(s.start)).hour,
      );
      const minutes = wedSlots.map(
        s => parisHourMinute(new Date(s.start)).minute,
      );
      // Every start is either in [8,11] (morning, 30-min grid) or [14,18] (afternoon)
      for (let i = 0; i < wedSlots.length; i++) {
        const totalMin = startHours[i] * 60 + minutes[i];
        const inMorning = totalMin >= 8 * 60 && totalMin < 12 * 60;
        const inAfternoon = totalMin >= 14 * 60 && totalMin < 19 * 60;
        expect(inMorning || inAfternoon).toBe(true);
      }
    });

    it('90-min duration does not overflow the period end (no slot ending after 12:00 / 19:00)', () => {
      const inPerson = generateSlotsForRange(
        buildInput({ mode: 'in-person', duration: 90 }),
      );
      for (const s of inPerson) {
        const startHm = parisHourMinute(new Date(s.start));
        const totalMin = startHm.hour * 60 + startHm.minute;
        const endTotalMin = totalMin + 90;
        const inMorning = totalMin >= 8 * 60 && endTotalMin <= 12 * 60;
        const inAfternoon = totalMin >= 14 * 60 && endTotalMin <= 19 * 60;
        expect(inMorning || inAfternoon).toBe(true);
      }
    });
  });

  describe('performance', () => {
    it('generates a 8-week range in well under 50ms (formatter hoisting pays off)', () => {
      const end8w = new Date(NOW.getTime() + 8 * 7 * DAY_MS);
      const input: GenerateSlotsInput = {
        startDate: START,
        endDate: end8w,
        duration: 60,
        mode: 'video',
        now: NOW,
        manualSlots: new Map(),
      };
      // Warm up (JIT / formatter init)
      generateSlotsForRange(input);

      const t0 = Date.now();
      const slots = generateSlotsForRange(input);
      const elapsed = Date.now() - t0;

      expect(slots.length).toBeGreaterThan(0);
      // Generous ceiling; typically a few ms. Catches formatter-per-slot regressions.
      expect(elapsed).toBeLessThan(50);
    });
  });
});

// ---------------------------------------------------------------------------
// getPersistedOAuthClient — token-row READ classification (issue #153 / SC1)
//
// Production incident 2026-09-13: the token-row select ignored its error, so
// a transient fetch failure (network / 5xx / timeout) was treated as "no row"
// and fell into the env bootstrap, which UPSERTED a stale
// GOOGLE_OAUTH_REFRESH_TOKEN over the fresh row before refreshing → phantom
// invalid_grant. SC1 contract under test:
//   - select failure (≠ PGRST116) → CalendarNetworkError, ZERO writes;
//   - no row (PGRST116) → null, ZERO writes, deprecation warn IFF the legacy
//     GOOGLE_OAUTH_REFRESH_TOKEN env var is still set.
// The env bootstrap itself is REMOVED from runtime — no table write may
// originate from a read path.
// ---------------------------------------------------------------------------
describe('getPersistedOAuthClient — token-row read classification (SC1)', () => {
  const ENV_KEYS = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REFRESH_TOKEN',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    supabaseMock.tokenSelect = { data: null, error: null };
    supabaseMock.singleQueue.length = 0;
    supabaseMock.singleCalls = 0;
    supabaseMock.eqCalls.length = 0;
    supabaseMock.update.mockClear();
    supabaseMock.upsert.mockClear();
    supabaseMock.insert.mockClear();
    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
    // Absent by default — the "with env var" test re-sets it explicitly.
    delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('PostgREST 504 on the token select → CalendarNetworkError, ZERO writes', async () => {
    supabaseMock.tokenSelect = {
      data: null,
      error: { code: '504', message: 'Gateway timeout' },
    };

    const err: unknown = await getPersistedOAuthClient().catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CalendarNetworkError);
    // Sanitized message only — the raw error payloads must never be carried
    // (they may embed credentials).
    expect((err as Error).message).not.toContain('Gateway timeout');
    expect(supabaseMock.update).not.toHaveBeenCalled();
    expect(supabaseMock.upsert).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('network timeout on the select (error without code) → CalendarNetworkError, ZERO writes', async () => {
    supabaseMock.tokenSelect = {
      data: null,
      error: { message: 'fetch failed' },
    };

    await expect(getPersistedOAuthClient()).rejects.toBeInstanceOf(
      CalendarNetworkError,
    );
    expect(supabaseMock.update).not.toHaveBeenCalled();
    expect(supabaseMock.upsert).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('PGRST116 (no row) with GOOGLE_OAUTH_REFRESH_TOKEN set → null, ZERO writes, deprecation warn', async () => {
    supabaseMock.tokenSelect = {
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    };
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = 'stale-env-refresh-token';

    await expect(getPersistedOAuthClient()).resolves.toBeNull();
    expect(supabaseMock.update).not.toHaveBeenCalled();
    expect(supabaseMock.upsert).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warned = String(warnSpy.mock.calls[0]?.[0]);
    expect(warned).toContain('bootstrap env supprimé');
    expect(warned).toContain('/api/admin/google-oauth');
    // Never echo the stale token value into the logs.
    expect(warned).not.toContain('stale-env-refresh-token');
  });

  it('PGRST116 (no row) without the env var → null, ZERO writes, NO warn', async () => {
    supabaseMock.tokenSelect = {
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    };

    await expect(getPersistedOAuthClient()).resolves.toBeNull();
    expect(supabaseMock.update).not.toHaveBeenCalled();
    expect(supabaseMock.upsert).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no row keeps the caller contract: createCalendarEvent throws the stable "OAuth non configuré" error', async () => {
    supabaseMock.tokenSelect = {
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    };

    await expect(
      createCalendarEvent({
        title: 'Séance test',
        start: '2030-01-02T10:00:00+01:00',
        end: '2030-01-02T11:00:00+01:00',
      }),
    ).rejects.toThrow('OAuth non configuré');
    // And the null path triggers no write either.
    expect(supabaseMock.upsert).not.toHaveBeenCalled();
    expect(supabaseMock.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getPersistedOAuthClient — CAS updated_at on the refresh persist (SC8) —
// PATIENT writer.
//
// The conditional UPDATE may only overwrite the row AS READ (`.eq('updated_at',
// <value read at select time>)`): a newer write — the reconnexion callback or
// the cron — must SURVIVE.
//   miss (PGRST116, 0 rows matched) → reconciliation re-read, warn
//     « CAS miss — ligne récente préservée », client returned on the
//     in-memory credentials — never fatal;
//   infra error (non-PGRST116) on the UPDATE → transient handling +
//     reconciliation re-read, NEVER collision/CAS wording.
// ---------------------------------------------------------------------------

describe('getPersistedOAuthClient — CAS on the refresh persist (SC8)', () => {
  const T1 = '2026-09-13T01:00:00.000Z';
  const T2 = '2026-09-13T01:05:00.000Z';
  const ENV_KEYS = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    supabaseMock.tokenSelect = { data: null, error: null };
    supabaseMock.singleQueue.length = 0;
    supabaseMock.singleCalls = 0;
    supabaseMock.eqCalls.length = 0;
    supabaseMock.update.mockClear();
    supabaseMock.upsert.mockClear();
    supabaseMock.insert.mockClear();
    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** Seeds a near-expiry v1 row (updated_at = T1) → the refresh branch runs. */
  function seedV1Row(): void {
    supabaseMock.tokenSelect = {
      data: {
        access_token: 'ya29.old',
        refresh_token: '1//rt-v1',
        expiry_date: Date.now() + 60_000,
        updated_at: T1,
      },
      error: null,
    };
  }

  it('race: v2 lands after the read → conditional UPDATE misses (PGRST116) → v2 preserved, CAS-miss logged, client returned on in-memory credentials', async () => {
    seedV1Row();
    // Persist confirm: the CAS-guarded UPDATE matched 0 rows (v2 landed).
    supabaseMock.singleQueue.push({
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });
    // Reconciliation re-read observes the SURVIVING v2 row.
    supabaseMock.singleQueue.push({
      data: {
        access_token: 'ya29.v2',
        refresh_token: '1//rt-v2',
        expiry_date: Date.now() + 3_600_000,
        updated_at: T2,
      },
      error: null,
    });

    const client = await getPersistedOAuthClient();

    // Never fatal: the client comes back carrying the FRESH IN-MEMORY
    // credentials from the refresh (not the stale row, not v2).
    expect(client).not.toBeNull();
    expect(client?.credentials.access_token).toBe('ya29.refreshed');
    // The UPDATE was CAS-conditioned on the value read at select time.
    expect(supabaseMock.eqCalls).toContainEqual(['updated_at', T1]);
    expect(supabaseMock.eqCalls).toContainEqual(['id', 'therapist']);
    // Exactly ONE write attempt — the conditional update; no other writes.
    expect(supabaseMock.update).toHaveBeenCalledTimes(1);
    expect(supabaseMock.upsert).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
    // 3 selects: v1 read, persist confirm, reconciliation re-read.
    expect(supabaseMock.singleCalls).toBe(3);
    // CAS-miss logged with the spec wording.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      'CAS miss — ligne récente préservée',
    );
  });

  it('infra error (non-PGRST116) on the conditional UPDATE → reconciliation re-read, NO CAS/collision wording, client still returned', async () => {
    seedV1Row();
    supabaseMock.singleQueue.push({
      data: null,
      error: { code: 'XX000', message: 'connection terminated unexpectedly' },
    });
    supabaseMock.singleQueue.push({
      data: {
        access_token: 'ya29.v2',
        refresh_token: '1//rt-v2',
        expiry_date: Date.now() + 3_600_000,
        updated_at: T2,
      },
      error: null,
    });

    const client = await getPersistedOAuthClient();

    expect(client).not.toBeNull();
    expect(client?.credentials.access_token).toBe('ya29.refreshed');
    expect(supabaseMock.eqCalls).toContainEqual(['updated_at', T1]);
    expect(supabaseMock.singleCalls).toBe(3);
    const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(warned).not.toContain('CAS');
    expect(warned).not.toContain('collision');
  });

  it('clean confirm (1 row matched) → no CAS-miss log, no reconciliation re-read', async () => {
    seedV1Row();
    supabaseMock.singleQueue.push({ data: { id: 'therapist' }, error: null });

    const client = await getPersistedOAuthClient();

    expect(client).not.toBeNull();
    // Only the initial read + the persist confirm — no re-read.
    expect(supabaseMock.singleCalls).toBe(2);
    expect(supabaseMock.eqCalls).toContainEqual(['updated_at', T1]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loadAvailabilitySnapshot — shared availability batch (issue #153 / SC3+SC5)
//
// The snapshot is the ONE upstream I/O unit shared by the keepwarm cron
// (T6) and the patient path: exactly ONE `manual_time_slots` read and ONE
// Freebusy query per call, served from the injected authenticated client.
// Every stage failure — transport, OR a response-level calendar error on an
// HTTP 200 (`calendars[id].errors` non-empty) — must throw a TYPED
// shared-stage error so NO writer ever persists the failure as empty
// availability (SC5: the old `return []` on response-level errors poisoned
// downstream caches). Mock mode: empty snapshot, ZERO I/O.
// All error messages are sanitized: no raw GaxiosError/PostgREST payload is
// ever attached (may embed client_secret / refresh_token).
// ---------------------------------------------------------------------------

describe('loadAvailabilitySnapshot — shared snapshot + typed shared-stage errors (SC3/SC5)', () => {
  const CAL_ID = 'cal-test@group.calendar.google.com';
  const SNAPSHOT_START = new Date('2026-06-15T00:00:00.000Z');
  const SNAPSHOT_END = new Date('2026-06-29T00:00:00.000Z');

  // The client is only threaded into the (mocked) google.calendar factory —
  // a bare object is enough to assert the threading via the factory call.
  const fakeOAuth2Client = {
    credentials: {},
  } as unknown as Auth.OAuth2Client;

  let errorSpy: ReturnType<typeof vi.spyOn>;

  /** Builds a fake calendar whose freebusy.query is a counting mock. */
  function freebusyCalendar(impl: () => unknown): {
    calendar: calendar_v3.Calendar;
    query: ReturnType<typeof vi.fn>;
  } {
    const query = vi.fn(impl);
    const calendar = {
      freebusy: { query },
    } as unknown as calendar_v3.Calendar;
    return { calendar, query };
  }

  beforeEach(() => {
    // Real path by default (same env idiom as availability-batch.test.ts —
    // vi.stubEnv covers both import.meta.env and process.env).
    vi.stubEnv('DEV', false);
    vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'false');
    vi.stubEnv('GOOGLE_CALENDAR_ID', CAL_ID);
    manualSlotsApi.fetchManualSlots.mockReset();
    manualSlotsApi.fetchManualSlots.mockResolvedValue([]);
    googleCalendarFactory.calendar.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('happy path: returns manual periods + busy periods with EXACTLY 1 manual read and 1 Freebusy query (SC3)', async () => {
    const { calendar, query } = freebusyCalendar(() => ({
      data: {
        calendars: {
          [CAL_ID]: {
            // Healthy response: the requested entry is present with a
            // structurally valid busy array (strict fail-closed contract —
            // malformed entries are REJECTED, see the negative tests below).
            busy: [
              {
                start: '2026-06-16T10:00:00+02:00',
                end: '2026-06-16T11:00:00+02:00',
              },
            ],
          },
        },
      },
    }));
    googleCalendarFactory.calendar.mockReturnValue(calendar);
    manualSlotsApi.fetchManualSlots.mockResolvedValue([
      { slot_date: '2026-06-17', period: 'morning', id: 'm1' },
      { slot_date: '2026-06-17', period: 'afternoon', id: 'm2' },
      { slot_date: '2026-06-18', period: 'all_day', id: 'm3' },
    ]);

    const snapshot = await loadAvailabilitySnapshot(
      fakeOAuth2Client,
      SNAPSHOT_START,
      SNAPSHOT_END,
    );

    // --- I/O budget: exactly 1 + 1.
    expect(manualSlotsApi.fetchManualSlots).toHaveBeenCalledTimes(1);
    expect(manualSlotsApi.fetchManualSlots).toHaveBeenCalledWith(
      SNAPSHOT_START,
      SNAPSHOT_END,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      requestBody: {
        timeMin: SNAPSHOT_START.toISOString(),
        timeMax: SNAPSHOT_END.toISOString(),
        timeZone: 'Europe/Paris',
        items: [{ id: CAL_ID }],
      },
    });
    // The client built from the INJECTED OAuth2Client is used (no re-auth).
    expect(googleCalendarFactory.calendar).toHaveBeenCalledTimes(1);

    // --- Snapshot content.
    expect(snapshot.busyPeriods).toEqual([
      {
        start: '2026-06-16T10:00:00+02:00',
        end: '2026-06-16T11:00:00+02:00',
      },
    ]);
    expect(snapshot.manualSlots.get('2026-06-17')).toEqual(
      new Set<Period>(['morning', 'afternoon']),
    );
    expect(snapshot.manualSlots.get('2026-06-18')).toEqual(
      new Set<Period>(['all_day']),
    );
  });

  it('Freebusy 200 with calendars[id].errors non-empty → typed shared-stage error, sanitized cause', async () => {
    const { calendar, query } = freebusyCalendar(() => ({
      data: {
        calendars: {
          [CAL_ID]: {
            errors: [
              { domain: 'global', reason: 'notFound', message: 'Not Found' },
            ],
          },
        },
      },
    }));
    googleCalendarFactory.calendar.mockReturnValue(calendar);

    const err: unknown = await loadAvailabilitySnapshot(
      fakeOAuth2Client,
      SNAPSHOT_START,
      SNAPSHOT_END,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CalendarSharedStageError);
    // Subclass of GoogleCalendarError → the existing /api/availability catch
    // maps it to 503 without any change there.
    expect(err).toBeInstanceOf(GoogleCalendarError);
    const message = (err as Error).message;
    expect(message).toContain('stage partagé');
    // Sanitized: only the reason code travels in the cause — never raw
    // response payloads.
    expect((err as { cause?: unknown }).cause).toEqual({
      googleErrorCode: 'notFound',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('getAvailableSlots converts the SAME response-level condition into the typed error — never an empty array (SC5)', async () => {
    // Frozen clock BEFORE the range: with the SC7 early return restored, a
    // past range would yield zero candidates and never reach Freebusy.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
    const { calendar, query } = freebusyCalendar(() => ({
      data: {
        calendars: {
          [CAL_ID]: { errors: [{ domain: 'global', reason: 'forbidden' }] },
        },
      },
    }));

    const outcome: { slots?: unknown; err?: unknown } = await getAvailableSlots(
      SNAPSHOT_START,
      SNAPSHOT_END,
      60,
      'in-person',
      [],
      { calendarId: CAL_ID, calendar },
    ).then(
      slots => ({ slots }),
      (e: unknown) => ({ err: e }),
    );

    // The pre-refactor behavior returned [] here — that empty result used to
    // be persisted downstream as fake free availability (issue #153).
    expect(outcome.err).toBeInstanceOf(CalendarSharedStageError);
    expect(outcome.slots).toBeUndefined();
    expect(Array.isArray(outcome.err)).toBe(false);
    // Same I/O budget on the patient path (shared snapshot core).
    expect(manualSlotsApi.fetchManualSlots).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('Freebusy 200 with the requested calendar ABSENT from calendars → typed shared-stage error, NOT empty-busy (SC5 fail-closed)', async () => {
    // A truncated/absent entry must never be conflated with a valid
    // empty-busy calendar: both writers would otherwise cache every
    // candidate as free (review #154 — fail-open hole).
    const { calendar, query } = freebusyCalendar(() => ({
      data: { calendars: {} },
    }));
    googleCalendarFactory.calendar.mockReturnValue(calendar);

    const err: unknown = await loadAvailabilitySnapshot(
      fakeOAuth2Client,
      SNAPSHOT_START,
      SNAPSHOT_END,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CalendarSharedStageError);
    expect(err).toBeInstanceOf(GoogleCalendarError);
    expect((err as Error).message).toContain('stage partagé');
    // No raw payload attached as cause.
    expect((err as { cause?: unknown }).cause).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('Freebusy 200 with a malformed busy array → typed shared-stage error — malformed entries REJECTED, not silently dropped', async () => {
    // Malformed busy content (non-array busy, or an interval whose bounds
    // are not strings) is a protocol violation: treating it as empty would
    // poison downstream caches with fake free availability.
    for (const payload of [
      { data: { calendars: { [CAL_ID]: { busy: 'not-an-array' } } } },
      {
        data: {
          calendars: {
            [CAL_ID]: {
              busy: [
                {
                  start: '2026-06-16T10:00:00+02:00',
                  end: '2026-06-16T11:00:00+02:00',
                },
                { start: 12, end: null },
              ],
            },
          },
        },
      },
      { data: { calendars: { [CAL_ID]: {} } } },
    ]) {
      const { calendar, query } = freebusyCalendar(() => payload);
      googleCalendarFactory.calendar.mockReturnValue(calendar);

      const err: unknown = await loadAvailabilitySnapshot(
        fakeOAuth2Client,
        SNAPSHOT_START,
        SNAPSHOT_END,
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CalendarSharedStageError);
      expect((err as Error).message).toContain('malformée');
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it('getAvailableSlots with the requested calendar ABSENT → typed shared-stage error, never an empty array (SC5 patient path)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
    const { calendar, query } = freebusyCalendar(() => ({
      data: { calendars: {} },
    }));

    const err: unknown = await getAvailableSlots(
      SNAPSHOT_START,
      SNAPSHOT_END,
      60,
      'in-person',
      [],
      { calendarId: CAL_ID, calendar },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CalendarSharedStageError);
    expect(err).toBeInstanceOf(GoogleCalendarError);
    expect((err as Error).message).toContain('stage partagé');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('getAvailableSlots with zero eligible candidates → [] with NO Freebusy query and NO client build (SC7 early return)', async () => {
    // 2026-06-20 is a Saturday: the derivation engine only emits weekday
    // slots, so the candidate set is empty and the Freebusy stage must never
    // run (the pre-snapshot refactor behavior is restored for the patient
    // path — a short empty window costs zero Google I/O).
    const { calendar, query } = freebusyCalendar(() => {
      throw new Error('Freebusy must never be called without candidates');
    });
    googleCalendarFactory.calendar.mockReturnValue(calendar);

    const slots = await getAvailableSlots(
      new Date('2026-06-20T00:00:00.000Z'),
      new Date('2026-06-21T00:00:00.000Z'),
      60,
      'in-person',
      [],
      { calendarId: CAL_ID, calendar },
    );

    expect(slots).toEqual([]);
    expect(manualSlotsApi.fetchManualSlots).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });

  it('manual-slots read failure surfacing through the snapshot → typed shared-stage error, sanitized, NO Freebusy call', async () => {
    const { calendar, query } = freebusyCalendar(() => ({
      data: { calendars: { [CAL_ID]: { busy: [] } } },
    }));
    googleCalendarFactory.calendar.mockReturnValue(calendar);
    manualSlotsApi.fetchManualSlots.mockRejectedValue(
      new Error('Failed to fetch manual slots: 504 Gateway timeout'),
    );

    const err: unknown = await loadAvailabilitySnapshot(
      fakeOAuth2Client,
      SNAPSHOT_START,
      SNAPSHOT_END,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CalendarSharedStageError);
    expect(err).toBeInstanceOf(GoogleCalendarError);
    const message = (err as Error).message;
    expect(message).toContain('stage partagé');
    // Sanitized: the raw upstream message must NOT leak into the typed error.
    expect(message).not.toContain('Gateway timeout');
    expect(message).not.toContain('Failed to fetch manual slots');
    // No raw error object attached as cause.
    expect((err as { cause?: unknown }).cause).toBeUndefined();
    // Stage isolation: the Freebusy stage never runs after a failed read.
    expect(query).not.toHaveBeenCalled();
  });

  it('Freebusy transport failure (504) → typed shared-stage error, sanitized status-only cause', async () => {
    // Shaped like a GaxiosError: response.status is the only safe field —
    // the rest (config/data) may embed OAuth credentials and must not travel.
    const gaxiosLike = Object.assign(
      new Error('Request failed with status code 504'),
      {
        response: {
          status: 504,
          data: { secret: 'client_secret=GOCSPX-should-never-leak' },
        },
      },
    );
    const { calendar, query } = freebusyCalendar(() => {
      throw gaxiosLike;
    });
    googleCalendarFactory.calendar.mockReturnValue(calendar);

    const err: unknown = await loadAvailabilitySnapshot(
      fakeOAuth2Client,
      SNAPSHOT_START,
      SNAPSHOT_END,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CalendarSharedStageError);
    expect((err as Error).message).toContain('stage partagé');
    // Sanitized cause: status only. The secret-bearing payload never travels.
    expect((err as { cause?: unknown }).cause).toEqual({ status: 504 });
    expect((err as Error).message).not.toContain('GOCSPX-should-never-leak');
    expect(errorSpy.mock.calls.map(String).join('\n')).not.toContain(
      'GOCSPX-should-never-leak',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('mock mode → empty snapshot with ZERO I/O (no manual read, no Freebusy, no client build)', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'true');
    const { calendar, query } = freebusyCalendar(() => {
      throw new Error('must never be called in mock mode');
    });
    googleCalendarFactory.calendar.mockReturnValue(calendar);

    const snapshot = await loadAvailabilitySnapshot(
      fakeOAuth2Client,
      SNAPSHOT_START,
      SNAPSHOT_END,
    );

    expect(snapshot.manualSlots.size).toBe(0);
    expect(snapshot.busyPeriods).toEqual([]);
    expect(manualSlotsApi.fetchManualSlots).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    // Zero I/O also means: no calendar client is ever built.
    expect(googleCalendarFactory.calendar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// filterSlotsByBusy — shared pure filter (deduplicates the availability.ts
// local copy; T7 swaps that copy for this export).
// ---------------------------------------------------------------------------

describe('filterSlotsByBusy — shared pure overlap filter', () => {
  const SLOT = (start: string, end: string) => ({
    start,
    end,
    available: true,
  });

  it('drops every slot overlapping a busy period, keeps the rest untouched', () => {
    const slots = [
      SLOT('2026-06-16T09:00:00+02:00', '2026-06-16T10:30:00+02:00'),
      SLOT('2026-06-16T10:00:00+02:00', '2026-06-16T11:00:00+02:00'),
      SLOT('2026-06-16T11:30:00+02:00', '2026-06-16T12:30:00+02:00'),
    ];
    const busy = [
      { start: '2026-06-16T10:30:00+02:00', end: '2026-06-16T11:30:00+02:00' },
    ];

    const kept = filterSlotsByBusy(slots, busy);

    // Slot 2 overlaps ([10:00,11:00] × [10:30,11:30]); slots 1 and 3 only
    // TOUCH the busy window (end === busy.start, start === busy.end) —
    // touching endpoints do NOT overlap.
    expect(kept).toEqual([slots[0], slots[2]]);
  });

  it('returns the input unchanged when there is no busy period (same reference)', () => {
    const slots = [
      SLOT('2026-06-16T09:00:00+02:00', '2026-06-16T10:00:00+02:00'),
    ];
    expect(filterSlotsByBusy(slots, [])).toBe(slots);
  });
});
