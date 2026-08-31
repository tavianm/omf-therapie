import { describe, expect, it } from 'vitest';
import { monthDays } from '@/components/admin/AvailabilityManager';

describe('admin availability calendar', () => {
  it('renders each day of the visible month without a fixed list of presences', () => {
    expect(monthDays(new Date('2026-02-01T00:00:00.000Z'))).toHaveLength(28);
    expect(monthDays(new Date('2028-02-01T00:00:00.000Z'))).toHaveLength(29);
  });
});
