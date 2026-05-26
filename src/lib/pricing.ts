/**
 * Grille tarifaire OMF Thérapie
 * Tarifs en vigueur pour les séances de thérapie.
 */

export type AppointmentType = 'individual' | 'couple' | 'family';
/** Standard durations used by the patient booking flow — do not extend. */
export type AppointmentDuration = 60 | 90;
/** Any positive integer duration in minutes — used by the admin flow only. */
export type AdminDuration = number;
export type AppointmentMode = 'in-person' | 'video';

export interface PricingResult {
  /** Prix de base en euros */
  basePrice: number;
  /** Remise en euros (0, 10 ou 15) */
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
export const PRICE_GRID: Record<AppointmentType, Record<AppointmentDuration, number>> = {
  individual: { 60: 50, 90: 65 },
  couple:     { 60: 75, 90: 90 },
  family:     { 60: 85, 90: 100 },
};

/** Réduction première séance (en euros) */
export const FIRST_SESSION_DISCOUNT = 15;

/** Réduction tarif solidaire (RSA / ASS / Étudiant) en euros */
export const SOLIDARITY_DISCOUNT = 10;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/**
 * Calcule le tarif d'une séance.
 *
 * Les remises sont mutuellement exclusives : `isSolidarity` est prioritaire.
 * Si `overridePrice` est fourni (flux admin), il court-circuite la grille tarifaire :
 * aucune remise n'est appliquée et le prix final est exactement `overridePrice`.
 *
 * @param type           - Type de thérapie
 * @param duration       - Durée en minutes (60 ou 90 pour le flux patient)
 * @param isFirstSession - Appliquer la réduction première séance (−15€)
 * @param isSolidarity   - Appliquer le tarif solidaire (−10€, RSA/ASS/Étudiant)
 * @param overridePrice  - Tarif manuel en euros (admin uniquement) — ignore la grille
 */
export function calculatePrice(
  type: AppointmentType,
  duration: AppointmentDuration,
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

  const basePrice = PRICE_GRID[type][duration];
  const discount = isSolidarity
    ? SOLIDARITY_DISCOUNT
    : isFirstSession ? FIRST_SESSION_DISCOUNT : 0;
  const finalPrice = basePrice - discount;

  const label = isSolidarity
    ? `${finalPrice}€ (–${discount}€ tarif solidaire)`
    : discount > 0 ? `${finalPrice}€ (–${discount}€ première séance)` : `${finalPrice}€`;

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
