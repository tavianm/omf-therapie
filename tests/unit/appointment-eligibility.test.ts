import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ManualTimeSlot } from '@/types/manual-slots';

// Mock fetchManualSlots so isCabinetEligibleSlot stays a pure logic test
// (no Supabase I/O). The records injected per-case are filtered by Paris date
// inside fetchManualPeriodsForDate, mirroring production.
vi.mock('@/lib/manual-slots', () => ({
  fetchManualSlots: vi.fn(),
}));

import { fetchManualSlots } from '@/lib/manual-slots';
import {
  cabinetEligibility,
  isCabinetEligibleSlot,
  dayHalfFor,
} from '@/lib/appointment-eligibility';
import type { Period } from '@/types/manual-slots';

// Deterministic Paris dates (UTC+2 in June 2026):
//   Mon 2026-06-15 · Tue 2026-06-16 · Wed 2026-06-17
// Morning 09:00 Paris = 07:00Z ; Afternoon 15:00 Paris = 13:00Z.
const MON_MORNING = '2026-06-15T07:00:00.000Z';
const MON_AFTERNOON = '2026-06-15T13:00:00.000Z';
const TUE_MORNING = '2026-06-16T07:00:00.000Z';
const WED_MORNING = '2026-06-17T07:00:00.000Z';

function record(date: string, period: Period): ManualTimeSlot {
  return {
    id: `${date}-${period}`,
    slot_date: date,
    period,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  };
}

function mockSlots(records: ManualTimeSlot[]): void {
  (fetchManualSlots as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(records);
}

beforeEach(() => {
  mockSlots([]);
});

describe('cabinetEligibility — additive rule', () => {
  const empty = new Set<Period>();

  it('treats Wednesday as cabinet-eligible both halves by default', () => {
    expect(cabinetEligibility(true, empty)).toEqual({ morning: true, afternoon: true });
  });

  it('is not eligible on a non-Wednesday day without manual slots', () => {
    expect(cabinetEligibility(false, empty)).toEqual({ morning: false, afternoon: false });
  });

  it('adds a manual half on top of the default', () => {
    expect(cabinetEligibility(false, new Set(['morning'])))
      .toEqual({ morning: true, afternoon: false });
  });

  it('covers both halves with an all_day manual slot', () => {
    expect(cabinetEligibility(false, new Set(['all_day'])))
      .toEqual({ morning: true, afternoon: true });
  });
});

describe('dayHalfFor', () => {
  it('classifies a morning slot', () => {
    expect(dayHalfFor(MON_MORNING)).toBe('morning');
  });

  it('classifies an afternoon slot', () => {
    expect(dayHalfFor(MON_AFTERNOON)).toBe('afternoon');
  });
});

describe('isCabinetEligibleSlot — booking validation gate', () => {
  it('allows in-person on Wednesday without manual slots', async () => {
    expect(await isCabinetEligibleSlot(WED_MORNING)).toBe(true);
  });

  it('rejects in-person on Monday without manual slots', async () => {
    expect(await isCabinetEligibleSlot(MON_MORNING)).toBe(false);
  });

  it('allows in-person on Monday when a morning manual slot exists', async () => {
    mockSlots([record('2026-06-15', 'morning')]);
    expect(await isCabinetEligibleSlot(MON_MORNING)).toBe(true);
  });

  it('rejects the afternoon half when only the morning manual slot exists', async () => {
    mockSlots([record('2026-06-15', 'morning')]);
    expect(await isCabinetEligibleSlot(MON_AFTERNOON)).toBe(false);
  });

  it('allows the afternoon half when an afternoon manual slot exists', async () => {
    mockSlots([record('2026-06-15', 'afternoon')]);
    expect(await isCabinetEligibleSlot(MON_AFTERNOON)).toBe(true);
  });

  it('covers both halves with an all_day manual slot', async () => {
    mockSlots([record('2026-06-16', 'all_day')]);
    expect(await isCabinetEligibleSlot(TUE_MORNING)).toBe(true);
  });

  it('does not leak an adjacent day manual slot into the checked day', async () => {
    mockSlots([record('2026-06-16', 'all_day')]); // Tuesday, not Monday
    expect(await isCabinetEligibleSlot(MON_MORNING)).toBe(false);
  });
});
