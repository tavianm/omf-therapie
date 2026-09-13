/**
 * Golden availability fixtures — equivalence suite (issue #153, tasks T1+T8).
 *
 * The fixtures (tests/fixtures/availability/*.json) capture the PRE-refactor
 * success-path output of `getAvailableSlots` for the 4 games
 * {in-person, video} × {60, 90} under 4 frozen-clock scenarios. They are the
 * oracle for SC4 (équivalence de dérivation); this suite replays them through
 * BOTH consumers of the refactor:
 *
 *   1. PURE DERIVATION (cron side) — `loadAvailabilitySnapshot` (1 manual-slot
 *      read + 1 Freebusy query, SC3 budget) → per game `generateSlotsForRange`
 *      + `filterSlotsByBusy([...snapshot.busyPeriods, ...dbBusy])`, exactly
 *      the combination `warmAvailabilityCache` (dbBusy=[]) and the patient
 *      path perform.
 *   2. LIVE PATIENT PATH — `getAvailableSlots` regression: the shared core
 *      must keep reproducing the same games (SC7 "contrat inchangé").
 *
 * Mock strategy — external API boundary ONLY, so the suite survives internal
 * refactors:
 *   - `fetchManualSlots` is mocked at its module boundary (no DB, no
 *     supabaseAdmin in the loop).
 *   - Freebusy is faked twice, once per injection style: through the
 *     `CalendarClientOptions.calendar` DI seam for the live path (the token
 *     path is NEVER exercised), and through a mocked `googleapis` calendar
 *     factory for `loadAvailabilitySnapshot` (which builds its own client
 *     from the injected OAuth2Client).
 *   - The clock is frozen with `vi.setSystemTime` (the derivation reads
 *     `new Date()` for the 24h-notice cutoff).
 *   - Range bounds come from the fixture (4-week horizon, cron default).
 *   - No calendar-cache interaction; error paths are out of scope (SC4).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth, calendar_v3 } from 'googleapis';
import {
  filterSlotsByBusy,
  generateSlotsForRange,
  getAvailableSlots,
  loadAvailabilitySnapshot,
  type AppointmentDuration,
  type AppointmentMode,
  type TimeSlot,
} from '@/lib/google-calendar';
import type { ManualTimeSlot } from '@/types/manual-slots';

// ---------------------------------------------------------------------------
// External-boundary mock: manual slots (same signature as the real module)
// ---------------------------------------------------------------------------

const manualSlots = vi.hoisted(() => ({
  fetchManualSlots: vi.fn(
    async (
      _from: Date,
      _to: Date,
    ): Promise<Array<Record<string, unknown>>> => [],
  ),
}));

vi.mock('@/lib/manual-slots', () => ({
  fetchManualSlots: manualSlots.fetchManualSlots,
}));

// ---------------------------------------------------------------------------
// External-boundary mock: googleapis calendar factory — the seam
// `loadAvailabilitySnapshot` uses (it builds its own calendar from the
// injected OAuth2Client, which is why the client itself can stay a dummy:
// the token path is never exercised). `state.busy` is read LAZILY at query
// time, so each scenario seeds it right before calling the loader.
// ---------------------------------------------------------------------------

const googleApis = vi.hoisted(() => {
  const state = {
    calendarId: 'primary',
    busy: [] as Array<{ start: string; end: string }>,
  };
  const freebusyQuery = vi.fn(async () => ({
    data: {
      calendars: {
        [state.calendarId]: {
          busy: state.busy.map(b => ({ start: b.start, end: b.end })),
        },
      },
    },
  }));
  const calendarFactory = vi.fn(() => ({
    freebusy: { query: freebusyQuery },
  }));
  return { state, freebusyQuery, calendarFactory };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      // Shape-only: getPersistedOAuthClient is never reached in this suite.
      OAuth2: class {
        setCredentials = vi.fn();
        refreshAccessToken = vi.fn();
      },
    },
    calendar: googleApis.calendarFactory,
  },
}));

// ---------------------------------------------------------------------------
// Fixture model
// ---------------------------------------------------------------------------

interface FixtureBusyPeriod {
  start: string;
  end: string;
}

interface AvailabilityFixture {
  scenario: string;
  description: string;
  inputs: {
    frozenNow: string;
    range: { start: string; end: string };
    horizonWeeks: number;
    timezone: string;
    calendarId: string;
    mockMode: boolean;
    manualSlotRows: ManualTimeSlot[];
    freebusyBusyPeriods: FixtureBusyPeriod[];
    dbBusyPeriods: FixtureBusyPeriod[];
  };
  expected: Record<string, TimeSlot[]>;
}

const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures/availability');

const FIXTURE_NAMES = [
  'manual-slots-week',
  'partial-busy-overlaps',
  'dst-transition-week',
  'mock-mode',
] as const;

function loadFixture(name: string): AvailabilityFixture {
  const raw = readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as AvailabilityFixture;
}

const GAMES: Array<{
  key: string;
  mode: AppointmentMode;
  duration: AppointmentDuration;
}> = [
  { key: 'in-person/60', mode: 'in-person', duration: 60 },
  { key: 'in-person/90', mode: 'in-person', duration: 90 },
  { key: 'video/60', mode: 'video', duration: 60 },
  { key: 'video/90', mode: 'video', duration: 90 },
];

// ---------------------------------------------------------------------------
// Harness — replays one fixture scenario against the CURRENT implementation
// ---------------------------------------------------------------------------

function fakeCalendarClient(
  calendarId: string,
  busyPeriods: FixtureBusyPeriod[],
): { client: calendar_v3.Calendar; freebusyQuery: ReturnType<typeof vi.fn> } {
  const freebusyQuery = vi.fn(async () => ({
    data: {
      calendars: {
        [calendarId]: {
          busy: busyPeriods.map(b => ({ start: b.start, end: b.end })),
        },
      },
    },
  }));
  const client = {
    freebusy: { query: freebusyQuery },
  } as unknown as calendar_v3.Calendar;
  return { client, freebusyQuery };
}

async function runScenario(fixture: AvailabilityFixture): Promise<{
  actual: Record<string, TimeSlot[]>;
  freebusyQuery: ReturnType<typeof vi.fn>;
}> {
  const { inputs } = fixture;

  vi.stubEnv('DEV', inputs.mockMode);
  vi.stubEnv('GOOGLE_CALENDAR_MOCK', inputs.mockMode ? 'true' : 'false');
  vi.setSystemTime(new Date(inputs.frozenNow));

  manualSlots.fetchManualSlots.mockReset();
  manualSlots.fetchManualSlots.mockResolvedValue(
    inputs.manualSlotRows.map(row => ({ ...row })),
  );

  const { client, freebusyQuery } = fakeCalendarClient(
    inputs.calendarId,
    inputs.freebusyBusyPeriods,
  );

  const start = new Date(inputs.range.start);
  const end = new Date(inputs.range.end);
  const options = { calendarId: inputs.calendarId, calendar: client };

  const actual: Record<string, TimeSlot[]> = {};
  for (const game of GAMES) {
    actual[game.key] = inputs.mockMode
      ? await getAvailableSlots(
          start,
          end,
          game.duration,
          game.mode,
          inputs.dbBusyPeriods,
        )
      : await getAvailableSlots(
          start,
          end,
          game.duration,
          game.mode,
          inputs.dbBusyPeriods,
          options,
        );
  }

  return { actual, freebusyQuery };
}

/**
 * Pure-derivation replay (cron side): one shared snapshot per scenario, then
 * the 4 games derived locally with `generateSlotsForRange` +
 * `filterSlotsByBusy([...snapshot.busyPeriods, ...fixtureDbBusy])` — exactly
 * the combination the patient path performs (the cron derives with dbBusy=[]
 * from the same building blocks). Returns the games for deep-equal against
 * the fixture.
 */
async function deriveGamesViaSnapshot(
  fixture: AvailabilityFixture,
): Promise<{ actual: Record<string, TimeSlot[]> }> {
  const { inputs } = fixture;

  vi.stubEnv('DEV', inputs.mockMode);
  vi.stubEnv('GOOGLE_CALENDAR_MOCK', inputs.mockMode ? 'true' : 'false');
  // The snapshot loader resolves the calendar id from env (no DI seam).
  vi.stubEnv('GOOGLE_CALENDAR_ID', 'primary');
  vi.setSystemTime(new Date(inputs.frozenNow));

  manualSlots.fetchManualSlots.mockReset();
  manualSlots.fetchManualSlots.mockResolvedValue(
    inputs.manualSlotRows.map(row => ({ ...row })),
  );
  googleApis.state.calendarId = 'primary';
  googleApis.state.busy = inputs.freebusyBusyPeriods.map(b => ({ ...b }));
  googleApis.freebusyQuery.mockClear();
  googleApis.calendarFactory.mockClear();

  const start = new Date(inputs.range.start);
  const end = new Date(inputs.range.end);

  const snapshot = await loadAvailabilitySnapshot(
    {} as unknown as Auth.OAuth2Client,
    start,
    end,
  );

  const actual: Record<string, TimeSlot[]> = {};
  for (const game of GAMES) {
    const candidates = generateSlotsForRange({
      startDate: start,
      endDate: end,
      duration: game.duration,
      mode: game.mode,
      now: new Date(inputs.frozenNow),
      manualSlots: snapshot.manualSlots,
    });
    actual[game.key] = filterSlotsByBusy(candidates, [
      ...snapshot.busyPeriods,
      ...inputs.dbBusyPeriods,
    ]);
  }

  return { actual };
}

beforeEach(() => {
  // Fake ONLY the clock: async flows keep real microtasks/timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  // Defaults for real-path scenarios; the mock-mode fixture re-stubs both.
  vi.stubEnv('DEV', false);
  vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'false');
  // Insurance: keep the setup.ts env stubs alive across afterEach unstubbing
  // (the module graph reads them lazily on first supabase access — which this
  // suite never triggers, but the lazy proxy reads env on ANY access).
  vi.stubEnv('SUPABASE_DATABASE_URL', 'http://localhost:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  // Snapshot loader resolves the calendar id from env.
  vi.stubEnv('GOOGLE_CALENDAR_ID', 'primary');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ===========================================================================
// SC4 — EQUIVALENCE (cron side): the pure derivation (shared snapshot →
// generateSlotsForRange + filterSlotsByBusy) must reproduce every golden
// game captured from the pre-refactor implementation, across all 4 scenarios.
// ===========================================================================

describe('pure derivation vs golden fixtures (SC4 — snapshot → generate + filter)', () => {
  describe('scenario: manual-slots week', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('manual-slots-week');
      const { actual } = await deriveGamesViaSnapshot(fixture);
      expect(actual).toEqual(fixture.expected);
    });
  });

  describe('scenario: partial busy overlaps', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('partial-busy-overlaps');
      const { actual } = await deriveGamesViaSnapshot(fixture);
      expect(actual).toEqual(fixture.expected);
    });
  });

  describe('scenario: DST transition week Europe/Paris 2026-10-25', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('dst-transition-week');
      const { actual } = await deriveGamesViaSnapshot(fixture);
      expect(actual).toEqual(fixture.expected);
    });
  });

  describe('scenario: mock mode', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('mock-mode');
      const { actual } = await deriveGamesViaSnapshot(fixture);
      expect(actual).toEqual(fixture.expected);
      // Mock mode = zero I/O: no manual-slots read, no googleapis calendar
      // built, hence no Freebusy query.
      expect(manualSlots.fetchManualSlots).not.toHaveBeenCalled();
      expect(googleApis.calendarFactory).not.toHaveBeenCalled();
      expect(googleApis.freebusyQuery).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// SC3 evidence (snapshot side) — ONE manual-slot read and ONE Freebusy query
// per loadAvailabilitySnapshot call, with the exact fixture range window.
// The cron-side 1/1/1 counters are asserted end-to-end in
// tests/unit/calendar-keepwarm.test.ts.
// ===========================================================================

describe('loadAvailabilitySnapshot — shared-stage I/O budget (SC3)', () => {
  it('per snapshot: exactly one manual-slots read and one Freebusy query with the fixture range window', async () => {
    const fixture = loadFixture('partial-busy-overlaps');
    await deriveGamesViaSnapshot(fixture);
    const start = new Date(fixture.inputs.range.start);
    const end = new Date(fixture.inputs.range.end);

    expect(manualSlots.fetchManualSlots).toHaveBeenCalledTimes(1);
    expect(manualSlots.fetchManualSlots).toHaveBeenCalledWith(start, end);

    expect(googleApis.calendarFactory).toHaveBeenCalledTimes(1);
    expect(googleApis.freebusyQuery).toHaveBeenCalledTimes(1);
    expect(googleApis.freebusyQuery).toHaveBeenCalledWith({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: fixture.inputs.timezone,
        items: [{ id: 'primary' }],
      },
    });
  });

  it('mock mode: returns an empty snapshot with zero I/O', async () => {
    const fixture = loadFixture('mock-mode');
    await deriveGamesViaSnapshot(fixture);

    expect(manualSlots.fetchManualSlots).not.toHaveBeenCalled();
    expect(googleApis.freebusyQuery).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// SC4/SC7 — LIVE PATIENT PATH: getAvailableSlots (which now delegates to the
// same snapshot core) must still reproduce every golden game — the external
// contract is unchanged by the refactor.
// ===========================================================================

describe('getAvailableSlots — golden fixtures (characterization, SC4)', () => {
  describe('scenario: manual-slots week', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('manual-slots-week');
      const { actual } = await runScenario(fixture);
      expect(actual).toEqual(fixture.expected);
    });
  });

  describe('scenario: partial busy overlaps', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('partial-busy-overlaps');
      const { actual } = await runScenario(fixture);
      expect(actual).toEqual(fixture.expected);
    });
  });

  describe('scenario: DST transition week Europe/Paris 2026-10-25', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('dst-transition-week');
      const { actual } = await runScenario(fixture);
      expect(actual).toEqual(fixture.expected);
    });
  });

  describe('scenario: mock mode', () => {
    it('derives the 4 {mode}×{duration} games deep-equal to the golden fixture', async () => {
      const fixture = loadFixture('mock-mode');
      const { actual, freebusyQuery } = await runScenario(fixture);
      expect(actual).toEqual(fixture.expected);
      // Mock mode = zero I/O: no manual-slots read, no Freebusy query.
      expect(manualSlots.fetchManualSlots).not.toHaveBeenCalled();
      expect(freebusyQuery).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// External I/O contract pinned alongside the fixtures — exactly one
// manual-slots read and one Freebusy query per getAvailableSlots invocation,
// with the fixture range window (pre-refactor: 4 reads + 4 queries for the
// full 4-game batch; SC3 reduces the cron to 1+1 via the shared snapshot).
// ===========================================================================

describe('external I/O contract pinned by the characterization', () => {
  it('per game: exactly one manual-slots read and one Freebusy query with the fixture range window', async () => {
    const fixture = loadFixture('partial-busy-overlaps');
    const { freebusyQuery } = await runScenario(fixture);
    const start = new Date(fixture.inputs.range.start);
    const end = new Date(fixture.inputs.range.end);

    expect(manualSlots.fetchManualSlots).toHaveBeenCalledTimes(GAMES.length);
    for (const call of manualSlots.fetchManualSlots.mock.calls) {
      expect(call[0].getTime()).toBe(start.getTime());
      expect(call[1].getTime()).toBe(end.getTime());
    }

    expect(freebusyQuery).toHaveBeenCalledTimes(GAMES.length);
    expect(freebusyQuery).toHaveBeenCalledWith({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: fixture.inputs.timezone,
        items: [{ id: fixture.inputs.calendarId }],
      },
    });
  });
});

// ===========================================================================
// Fixture structural sanity — guards the golden files themselves against
// corruption: every captured slot must respect the generation invariants.
// ===========================================================================

describe('golden fixture structural sanity', () => {
  // Paris-timezone helpers (same approach as google-calendar.test.ts —
  // deterministic regardless of the host's local TZ).
  const TZ = 'Europe/Paris';

  function parisWeekday(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
    }).format(new Date(iso));
  }

  function parisHourMinute(iso: string): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(iso));
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(
      parts.find(p => p.type === 'minute')?.value ?? '0',
      10,
    );
    return { hour: hour === 24 ? 0 : hour, minute };
  }

  it('every fixture exposes exactly the 4 game keys, and every slot respects the generation invariants', () => {
    for (const name of FIXTURE_NAMES) {
      const fixture = loadFixture(name);
      expect(Object.keys(fixture.expected).sort()).toEqual(
        GAMES.map(g => g.key).sort(),
      );

      const minStart =
        new Date(fixture.inputs.frozenNow).getTime() + 24 * 60 * 60 * 1000;
      for (const game of GAMES) {
        for (const slot of fixture.expected[game.key]) {
          // Success path: only available slots survive the busy filter.
          expect(slot.available).toBe(true);
          // 24h minimum notice against the frozen clock.
          expect(new Date(slot.start).getTime()).toBeGreaterThanOrEqual(
            minStart,
          );
          // Ordered ISO pair.
          expect(new Date(slot.end).getTime()).toBeGreaterThan(
            new Date(slot.start).getTime(),
          );
          // Weekdays only (Europe/Paris).
          expect(['Sat', 'Sun']).not.toContain(parisWeekday(slot.start));
          // Starts within a business half-day: morning 08:00–12:00 or
          // afternoon 14:00–19:00 (Paris) — the start never straddles lunch.
          const { hour, minute } = parisHourMinute(slot.start);
          const totalMinutes = hour * 60 + minute;
          const inMorning = totalMinutes >= 8 * 60 && totalMinutes < 12 * 60;
          const inAfternoon = totalMinutes >= 14 * 60 && totalMinutes < 19 * 60;
          expect(inMorning || inAfternoon).toBe(true);
        }
      }
    }
  });
});
