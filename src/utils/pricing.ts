/**
 * Shared pricing contract. This module is browser-safe: it has no server,
 * environment, or database dependency.
 */

export type AppointmentType = 'individual' | 'couple' | 'family';
export type AppointmentDuration = 60 | 90;
export type AdminDuration = number;
export type AppointmentMode = 'in-person' | 'video';

export interface PricingResult {
  basePrice: number;
  discount: number;
  finalPrice: number;
  label: string;
}

export const PRICE_GRID: Record<
  AppointmentType,
  Record<AppointmentDuration, number>
> = {
  individual: { 60: 50, 90: 65 },
  couple: { 60: 75, 90: 90 },
  family: { 60: 85, 90: 100 },
};

export const FIRST_SESSION_DISCOUNT = 15;
export const SOLIDARITY_DISCOUNT = 10;

export function calculatePrice(
  type: AppointmentType,
  duration: number,
  isFirstSession: boolean,
  isSolidarity = false,
  overridePrice?: number,
): PricingResult {
  if (overridePrice !== undefined) {
    return {
      basePrice: overridePrice,
      discount: 0,
      finalPrice: overridePrice,
      label: `${overridePrice}€ (tarif manuel)`,
    };
  }

  const basePrice = PRICE_GRID[type]?.[duration as AppointmentDuration];
  if (basePrice === undefined) {
    throw new Error(
      `Durée ${duration} min non couverte par la grille tarifaire — utiliser overridePrice`,
    );
  }
  const discount = isSolidarity
    ? SOLIDARITY_DISCOUNT
    : isFirstSession
      ? FIRST_SESSION_DISCOUNT
      : 0;
  const finalPrice = basePrice - discount;
  const label = isSolidarity
    ? `${finalPrice}€ (–${discount}€ tarif solidaire)`
    : discount > 0
      ? `${finalPrice}€ (–${discount}€ première séance)`
      : `${finalPrice}€`;

  return { basePrice, discount, finalPrice, label };
}

export function getTypeLabel(type: AppointmentType): string {
  const labels: Record<AppointmentType, string> = {
    individual: 'Thérapie individuelle',
    couple: 'Thérapie de couple',
    family: 'Thérapie familiale',
  };
  return labels[type];
}

export function getModeLabel(mode: AppointmentMode): string {
  const labels: Record<AppointmentMode, string> = {
    'in-person': 'Présentiel (cabinet)',
    video: 'Téléconsultation',
  };
  return labels[mode];
}
