/**
 * Shared server-side loader for the admin appointments list.
 *
 * Single source of truth for the SSR query used by /mes-rdvs and
 * /poste-travail (and reusable by server-only API routes).
 *
 * ⚠️  SERVER-ONLY — never import this module from a client island
 * (src/lib/** is server-only; islands get data via Astro props or API routes).
 */

import { supabaseAdmin } from './supabase';
import type { Appointment } from '../types/appointment';

/**
 * Explicit column list shared by every admin appointments read.
 *
 * Deliberately includes `therapist_notes` and `patient_reason` (the current
 * SSR props contract) and excludes every other field, so no superfluous
 * PII/clinical data is serialized into Astro props or API payloads.
 */
export const APPOINTMENT_COLUMNS = [
  'id',
  'status',
  'scheduled_at',
  'rescheduled_to',
  'appointment_type',
  'appointment_mode',
  'duration',
  'base_price',
  'discount',
  'final_price',
  'is_first_session',
  'patient_name',
  'patient_email',
  'patient_phone',
  'patient_postal_code',
  'patient_city',
  'patient_reason',
  'therapist_notes',
  'video_link',
  'google_calendar_event_id',
  'stripe_payment_link_url',
  'stripe_payment_link_id',
  'created_at',
  'updated_at',
].join(',');

/**
 * Fetch every active (non soft-deleted) appointment, most recent first.
 *
 * Degradation contract shared by both pages: on a Supabase error the caller
 * gets `{ appointments: [], error }` — an empty list renders a degraded
 * dashboard instead of masking the error as fake Appointment rows. The
 * `Appointment` cast runs only on the verified-success branch: the Supabase
 * error shape (GenericStringError) does not overlap with Appointment, so the
 * cast must never execute when `error` is truthy.
 */
export async function fetchActiveAppointments(): Promise<{
  appointments: Appointment[];
  error: string | null;
}> {
  const { data: rows, error } = await supabaseAdmin
    .from('appointments')
    .select(APPOINTMENT_COLUMNS)
    .is('deleted_at', null)
    .order('scheduled_at', { ascending: false });

  if (error) {
    return { appointments: [], error: error.message };
  }

  return { appointments: rows as unknown as Appointment[], error: null };
}
