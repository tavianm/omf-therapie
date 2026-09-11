/**
 * Shared domain constants for appointments — single source of truth.
 *
 * Client-safe: no server, environment, or database dependency, so it can be
 * imported from API routes, Astro pages, and React islands alike. Values only;
 * the type unions they encode live in `src/types/**`.
 */

import type {
  AppointmentDuration,
  AppointmentMode,
  AppointmentStatus,
  AppointmentType,
} from '../types/appointment';
import type { Period } from '../types/manual-slots';
import { SCHEDULING_BUFFER_VALUES } from '../types/scheduling-settings';

// ---------------------------------------------------------------------------
// Séance — types, modes, durées
// ---------------------------------------------------------------------------

/** Accepted `appointment_type` values — single source of truth. */
export const VALID_TYPES: ReadonlySet<string> = new Set<AppointmentType>([
  'individual',
  'couple',
  'family',
]);

/** Accepted `appointment_mode` values — single source of truth. */
export const VALID_MODES: ReadonlySet<string> = new Set<AppointmentMode>([
  'in-person',
  'video',
]);

/** Durées standard couvertes par la grille tarifaire — single source of truth. */
export const STANDARD_DURATIONS: readonly AppointmentDuration[] = [60, 90];

/** Durées acceptées par les routes patient (grid 60/90) — single source of truth. */
export const VALID_DURATIONS: ReadonlySet<number> = new Set<number>(
  STANDARD_DURATIONS,
);

/** Lower bound of a custom (admin) session duration — single source of truth. */
export const MIN_APPOINTMENT_DURATION_MINUTES = 15;

/** Upper bound of any session duration — single source of truth. */
export const MAX_APPOINTMENT_DURATION_MINUTES = 240;

// ---------------------------------------------------------------------------
// Créneaux manuels — périodes
// ---------------------------------------------------------------------------

/** Accepted manual-slot periods — single source of truth (mirrors `Period`). */
export const VALID_PERIODS: readonly Period[] = [
  'morning',
  'afternoon',
  'all_day',
];

// ---------------------------------------------------------------------------
// Statuts de rendez-vous
// ---------------------------------------------------------------------------

/** French labels for appointment statuses — single source of truth. */
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'En attente',
  confirmed: 'Confirmé',
  declined: 'Refusé',
  rescheduled: 'Reporté',
  payment_pending: 'Paiement en attente',
  payment_received: 'Paiement reçu',
  cancelled: 'Annulé',
};

/**
 * Statuts qui rendent un créneau occupé (bloque toute nouvelle réservation
 * chevauchante) — single source of truth for the TS copies (the SQL triggers
 * in supabase/migrations keep their own in-SQL list by design).
 */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'confirmed',
  'payment_pending',
  'payment_received',
  'rescheduled',
];

/** Statuts nécessitant une action de la thérapeute — single source of truth. */
export const ACTIONABLE_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'rescheduled',
  'payment_pending',
];

// ---------------------------------------------------------------------------
// Marge de planification
// ---------------------------------------------------------------------------

/**
 * Plus grande marge configurable — single source of truth, derived from
 * `SCHEDULING_BUFFER_VALUES` (types/scheduling-settings.ts). Used as the
 * lookback bound when scanning rescheduled proposals in conflict checks.
 */
export const MAX_SCHEDULING_BUFFER_MINUTES = Math.max(
  ...SCHEDULING_BUFFER_VALUES,
);
