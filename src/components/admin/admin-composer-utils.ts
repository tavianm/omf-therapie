import {
  MAX_APPOINTMENT_DURATION_MINUTES,
  MIN_APPOINTMENT_DURATION_MINUTES,
  VALID_DURATIONS,
} from '../../utils/domain';

export const EXPOSED_CUSTOM_DURATIONS = [45, 120] as const;

export function isCustomDurationValid(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_APPOINTMENT_DURATION_MINUTES &&
    value <= MAX_APPOINTMENT_DURATION_MINUTES
  );
}

export function requiresManualPrice(duration: number): boolean {
  return !VALID_DURATIONS.has(duration);
}

/**
 * Client-side mirror of the avoir math in POST /api/admin/appointments/
 * (step 5): creditApplied = min(balance, finalPrice) when balance > 0,
 * amountDue = max(0, finalPrice − creditApplied). The ledger stores cents,
 * so the math runs in cents and only the display values are converted back.
 */
export function computeCreditEstimate(
  finalPriceEuros: number,
  balanceCents: number,
): { appliedEuros: number; dueEuros: number } {
  const finalPriceCents = Math.round(finalPriceEuros * 100);
  const appliedCents = Math.max(0, Math.min(balanceCents, finalPriceCents));
  return {
    appliedEuros: appliedCents / 100,
    dueEuros: Math.max(0, finalPriceCents - appliedCents) / 100,
  };
}

/** Format a euro amount for the French UI ("30 €", "32,5 €"). */
export function formatEuros(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
