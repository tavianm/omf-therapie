/**
 * Grille tarifaire OMF Thérapie
 * Tarifs en vigueur pour les séances de thérapie.
 */

export type AppointmentType = 'individual' | 'couple' | 'family';
export type AppointmentDuration = 60 | 90;
export type AppointmentMode = 'in-person' | 'video';

export interface PricingResult {
  /** Prix de base en euros */
  basePrice: number;
  /** Remise en euros (0 ou 15) */
  discount: number;
  /** Prix final à payer */
  finalPrice: number;
  /** Label lisible, ex: "65€ (–15€ première séance)" ou "65€" */
  label: string;
}

// ---------------------------------------------------------------------------
// Grille tarifaire
// ---------------------------------------------------------------------------

/** Prix de base par type × durée (en euros) */
const PRICE_GRID: Record<AppointmentType, Record<AppointmentDuration, number>> = {
  individual: { 60: 50, 90: 65 },
  couple:     { 60: 75, 90: 90 },
  family:     { 60: 85, 90: 100 },
};

/** Réduction première séance (en euros) */
const FIRST_SESSION_DISCOUNT = 15;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/**
 * Calcule le tarif d'une séance.
 *
 * @param type          - Type de thérapie
 * @param duration      - Durée en minutes (60 ou 90)
 * @param isFirstSession - Appliquer la réduction première séance (-15€)
 */
export function calculatePrice(
  type: AppointmentType,
  duration: AppointmentDuration,
  isFirstSession: boolean,
): PricingResult {
  const basePrice = PRICE_GRID[type][duration];
  const discount = isFirstSession ? FIRST_SESSION_DISCOUNT : 0;
  const finalPrice = basePrice - discount;

  const label = discount > 0
    ? `${finalPrice}€ (–${discount}€ première séance)`
    : `${finalPrice}€`;

  return { basePrice, discount, finalPrice, label };
}

/**
 * Retourne le label lisible d'un type de thérapie.
 *
 * @example getTypeLabel('individual') // → 'Thérapie individuelle'
 */
export function getTypeLabel(type: AppointmentType): string {
  const labels: Record<AppointmentType, string> = {
    individual: 'Thérapie individuelle',
    couple:     'Thérapie de couple',
    family:     'Thérapie familiale',
  };
  return labels[type];
}

/**
 * Retourne le label lisible d'un mode de consultation.
 *
 * @example getModeLabel('in-person') // → 'Présentiel (cabinet)'
 * @example getModeLabel('video')     // → 'Téléconsultation'
 */
export function getModeLabel(mode: AppointmentMode): string {
  const labels: Record<AppointmentMode, string> = {
    'in-person': 'Présentiel (cabinet)',
    'video':     'Téléconsultation',
  };
  return labels[mode];
}
