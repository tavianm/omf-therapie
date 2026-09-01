import { describe, expect, it } from 'vitest';
import { isSchedulingConflictError } from '@/lib/scheduling-settings';
import {
  isSchedulingBufferMinutes,
  SCHEDULING_BUFFER_VALUES,
} from '@/types/scheduling-settings';

describe('scheduling settings contracts', () => {
  it('accepts only the three supported global buffers', () => {
    expect(SCHEDULING_BUFFER_VALUES).toEqual([0, 15, 20]);
    expect(isSchedulingBufferMinutes(0)).toBe(true);
    expect(isSchedulingBufferMinutes(15)).toBe(true);
    expect(isSchedulingBufferMinutes(20)).toBe(true);
    expect(isSchedulingBufferMinutes(10)).toBe(false);
    expect(isSchedulingBufferMinutes('15')).toBe(false);
  });

  it('recognizes only the scheduling conflict messages raised by migration 015', () => {
    expect(
      isSchedulingConflictError({ message: 'scheduling_conflict' }),
    ).toBe(true);
    expect(
      isSchedulingConflictError({ message: 'scheduling_buffer_conflict' }),
    ).toBe(true);
    // P0001 est le code par défaut de tout RAISE EXCEPTION (ex. CREDIT_NO_OP
    // dans 008) — il ne doit PAS être interprété comme un conflit de créneau.
    expect(isSchedulingConflictError({ code: 'P0001' })).toBe(false);
    expect(isSchedulingConflictError({ code: '23505' })).toBe(false);
  });
});
