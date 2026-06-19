import { describe, expect, it } from 'vitest';
import {
  generateSlotsForRange,
  type GenerateSlotsInput,
} from '@/lib/google-calendar';
import type { Period } from '@/types/manual-slots';

// ---------------------------------------------------------------------------
// Paris-timezone helpers (deterministic regardless of the host's local TZ).
// Mirrors the prod logic so tests assert against the same calendar the user
// sees in Europe/Paris.
// ---------------------------------------------------------------------------

const TZ = 'Europe/Paris';
const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

function parisWeekday(date: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date);
  return WEEKDAY_MAP[wd] ?? 7;
}

function parisDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parisHourMinute(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
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

function manualMap(entries: Array<[string, Period[]]>): Map<string, Set<Period>> {
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
    if (parisWeekday(instant) === weekday && parisDateKey(instant) > minStartKey) {
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
      const inPersonStarts = new Set(inPerson.map((s) => s.start));
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

      const mondayStarts = slots.filter((s) => parisDateKey(new Date(s.start)) === monday);
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

      const mondaySlots = slots.filter((s) => parisDateKey(new Date(s.start)) === monday);
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
        buildInput({ mode: 'in-person', manualSlots: manualMap([[tuesday, ['all_day']]]) }),
      );
      const video = generateSlotsForRange(
        buildInput({ mode: 'video', manualSlots: manualMap([[tuesday, ['all_day']]]) }),
      );

      const ipTue = inPerson.filter((s) => parisDateKey(new Date(s.start)) === tuesday);
      const vidTue = video.filter((s) => parisDateKey(new Date(s.start)) === tuesday);
      expect(ipTue.length).toBeGreaterThan(0);
      expect(vidTue).toHaveLength(0);
    });

    it('Wednesday stays fully cabinet even when a manual slot is added on it (additive)', () => {
      const wednesday = firstDateKeyWithWeekday(3);
      const inPerson = generateSlotsForRange(
        buildInput({ mode: 'in-person', manualSlots: manualMap([[wednesday, ['morning']]]) }),
      );
      const video = generateSlotsForRange(
        buildInput({ mode: 'video', manualSlots: manualMap([[wednesday, ['morning']]]) }),
      );

      const ipWed = inPerson.filter((s) => parisDateKey(new Date(s.start)) === wednesday);
      const vidWed = video.filter((s) => parisDateKey(new Date(s.start)) === wednesday);
      // Wednesday afternoon remains cabinet (not flipped to visio)
      const ipWedPm = ipWed.filter((s) => parisHourMinute(new Date(s.start)).hour >= 14);
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
      const wedSlots = inPerson.filter((s) => parisDateKey(new Date(s.start)) === wednesday);

      const startHours = wedSlots.map((s) => parisHourMinute(new Date(s.start)).hour);
      const minutes = wedSlots.map((s) => parisHourMinute(new Date(s.start)).minute);
      // Every start is either in [8,11] (morning, 30-min grid) or [14,18] (afternoon)
      for (let i = 0; i < wedSlots.length; i++) {
        const totalMin = startHours[i] * 60 + minutes[i];
        const inMorning = totalMin >= 8 * 60 && totalMin < 12 * 60;
        const inAfternoon = totalMin >= 14 * 60 && totalMin < 19 * 60;
        expect(inMorning || inAfternoon).toBe(true);
      }
    });

    it('90-min duration does not overflow the period end (no slot ending after 12:00 / 19:00)', () => {
      const inPerson = generateSlotsForRange(buildInput({ mode: 'in-person', duration: 90 }));
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
