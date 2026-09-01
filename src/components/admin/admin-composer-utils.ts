export const STANDARD_DURATIONS = [60, 90] as const;
export const EXPOSED_CUSTOM_DURATIONS = [45, 120] as const;

export function isCustomDurationValid(value: number): boolean {
  return Number.isInteger(value) && value >= 15 && value <= 240;
}

export function requiresManualPrice(duration: number): boolean {
  return !STANDARD_DURATIONS.includes(duration as 60 | 90);
}
