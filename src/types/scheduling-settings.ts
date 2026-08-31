export type SchedulingBufferMinutes = 0 | 15 | 20;

export interface SchedulingSettings {
  bufferMinutes: SchedulingBufferMinutes;
  updatedAt: string;
}

export const SCHEDULING_BUFFER_VALUES: readonly SchedulingBufferMinutes[] = [
  0, 15, 20,
];

export function isSchedulingBufferMinutes(
  value: unknown,
): value is SchedulingBufferMinutes {
  return (
    typeof value === 'number' &&
    SCHEDULING_BUFFER_VALUES.includes(value as SchedulingBufferMinutes)
  );
}
