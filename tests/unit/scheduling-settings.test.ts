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

  it('recognizes database concurrency and buffer conflicts', () => {
    expect(isSchedulingConflictError({ code: 'P0001' })).toBe(true);
    expect(
      isSchedulingConflictError({ message: 'scheduling_buffer_conflict' }),
    ).toBe(true);
    expect(isSchedulingConflictError({ code: '23505' })).toBe(false);
  });
});
