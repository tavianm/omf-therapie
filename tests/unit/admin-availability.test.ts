import { describe, expect, it } from 'vitest';
import {
  calendarMonth,
  calendarMonthBounds,
  calendarMonthDays,
  shiftCalendarMonth,
} from '@/components/admin/admin-availability-utils';

describe('admin availability calendar', () => {
  it('renders each day of the visible month without a fixed list of presences', () => {
    expect(calendarMonthDays(calendarMonth(2026, 1))).toHaveLength(28);
    expect(calendarMonthDays(calendarMonth(2028, 1))).toHaveLength(29);
  });

  it('navigates calendar months with stable Europe/Paris date keys', () => {
    const october = shiftCalendarMonth(calendarMonth(2026, 8), 1);

    expect(calendarMonthBounds(october)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(calendarMonthDays(october)[0]).toEqual({
      day: 1,
      key: '2026-10-01',
    });
  });
});
