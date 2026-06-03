/**
 * TypeScript types — Patients
 *
 * There is no `patients` table in the database.
 * Patient records are derived by aggregating the `appointments` table,
 * grouped by `patient_email`.
 *
 * Prices are always expressed in centimes (integer, consistent with appointments).
 * Dates are ISO 8601 strings (TIMESTAMPTZ → string via JSON).
 */

import type { AppointmentType, AppointmentMode, AppointmentStatus } from './appointment';

// ---------------------------------------------------------------------------
// Re-export for consumers that only import from this module
// ---------------------------------------------------------------------------

export type { AppointmentType, AppointmentMode, AppointmentStatus };

// ---------------------------------------------------------------------------
// Lightweight appointment snapshot attached to a patient record
// ---------------------------------------------------------------------------

/**
 * A condensed view of a single appointment used inside a `Patient` aggregate.
 * Contains only the fields relevant for patient history display; for the full
 * record use the `Appointment` type from `./appointment`.
 */
export interface AppointmentSummary {
  /** UUID of the appointment row. */
  id: string;
  /** ISO 8601 timestamp — maps to `appointments.scheduled_at`. */
  scheduledAt: string;
  /** Session category (individual / couple / family). */
  appointmentType: AppointmentType;
  /** Delivery mode (in-person / video). */
  appointmentMode: AppointmentMode;
  /** Workflow status of the appointment. */
  status: AppointmentStatus;
  /** Amount charged in centimes — maps to `appointments.final_price`. */
  finalPrice: number;
  /** Session length in minutes — maps to `appointments.duration`. */
  duration: number;
}

// ---------------------------------------------------------------------------
// Patient aggregate (derived from appointments)
// ---------------------------------------------------------------------------

/**
 * A patient record built by aggregating all non-soft-deleted appointments
 * sharing the same `patient_email`.
 *
 * Aggregation rules:
 * - `name` / `phone` → taken from the most recent appointment (`MAX(scheduled_at)`).
 * - `sessionCount` → `COUNT(*)` excluding soft-deleted rows (`deleted_at IS NULL`).
 * - `lastAppointmentAt` → `MAX(scheduled_at)` ISO string.
 * - `isActive` → `lastAppointmentAt >= NOW() - INTERVAL '3 months'`.
 * - `appointments` → full history, ordered by `scheduled_at DESC`.
 */
export interface Patient {
  /** Aggregation key — maps to `appointments.patient_email`. */
  email: string;
  /** Patient display name from the most recent known appointment. */
  name: string;
  /** Contact phone number from the most recent known appointment. */
  phone: string;
  /** Total number of non-soft-deleted appointments for this patient. */
  sessionCount: number;
  /** ISO 8601 timestamp of the most recent appointment (`MAX(scheduled_at)`). */
  lastAppointmentAt: string;
  /** Appointment type of the most recent appointment. */
  lastAppointmentType: AppointmentType;
  /** Appointment mode of the most recent appointment. */
  lastAppointmentMode: AppointmentMode;
  /**
   * Whether the patient is considered active.
   * `true` when `lastAppointmentAt >= NOW() - INTERVAL '3 months'`.
   */
  isActive: boolean;
  /** Full appointment history for this patient, ordered by `scheduledAt` DESC. */
  appointments: AppointmentSummary[];
}

// ---------------------------------------------------------------------------
// Pre-fill payload for AdminCreateButton
// ---------------------------------------------------------------------------

/**
 * Pre-fill data passed to `AdminCreateButton` (and the underlying booking form)
 * when creating a new appointment on behalf of an existing patient.
 * Field names intentionally match the `CreateAppointmentData` / form field names
 * so they can be spread directly into the form's default values.
 */
export interface PrefillData {
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  /** Suggested appointment type based on the patient's last session. */
  appointment_type: AppointmentType;
}
