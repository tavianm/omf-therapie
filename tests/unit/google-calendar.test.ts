import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarNetworkError,
  createCalendarEvent,
  generateSlotsForRange,
  getPersistedOAuthClient,
  GoogleCalendarError,
  type GenerateSlotsInput,
} from '@/lib/google-calendar';
import type { Period } from '@/types/manual-slots';

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
    calendar: vi.fn(() => ({})),
  },
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
