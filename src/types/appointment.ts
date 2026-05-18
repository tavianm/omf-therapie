/**
 * Types TypeScript — Rendez-vous (appointments)
 *
 * Reflète fidèlement la table `appointments` de la migration 001_init.sql.
 * Les prix sont toujours exprimés en centimes (integer côté DB).
 * Les dates sont des ISO strings (TIMESTAMPTZ → string via JSON).
 */

// ---------------------------------------------------------------------------
// Ré-export des types de pricing pour centralisation
// ---------------------------------------------------------------------------

export type {
  AppointmentType,
  AppointmentDuration,
  AppointmentMode,
} from '../lib/pricing';

// ---------------------------------------------------------------------------
// Statut du rendez-vous
// ---------------------------------------------------------------------------

export type AppointmentStatus =
  | 'pending'           // soumis, en attente de confirmation
  | 'confirmed'         // confirmé par la thérapeute
  | 'declined'          // refusé par la thérapeute
  | 'rescheduled'       // reporté (voir rescheduled_to)
  | 'payment_pending'   // lien Stripe envoyé, paiement attendu
  | 'payment_received'  // paiement Stripe confirmé
  | 'cancelled';        // annulé (par le patient ou la thérapeute)

// ---------------------------------------------------------------------------
// Entité complète (image 1:1 de la table DB)
// ---------------------------------------------------------------------------

export interface Appointment {
  id: string;

  // Patient
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  patient_postal_code: string;
  patient_city: string;
  patient_reason: string;

  // Séance
  appointment_type: 'individual' | 'couple' | 'family';
  appointment_mode: 'in-person' | 'video';
  duration: 60 | 90;
  is_first_session: boolean;

  // Tarification (centimes)
  base_price: number;
  discount: number;
  final_price: number;

  // Planification
  scheduled_at: string; // ISO 8601

  // Workflow
  status: AppointmentStatus;

  // Stripe (téléconsultations uniquement)
  stripe_payment_link_id: string | null;
  stripe_payment_link_url: string | null;
  stripe_payment_intent_id: string | null;

  // Google Meet (renseigné manuellement par la thérapeute)
  video_link: string | null;

  // Usage interne
  therapist_notes: string | null;

  // Report
  rescheduled_to: string | null; // ISO 8601

  // Horodatages RGPD
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
  deleted_at: string | null; // null = actif, soft delete
}

// ---------------------------------------------------------------------------
// DTO création — champs soumis par le patient via le formulaire public
// ---------------------------------------------------------------------------

/**
 * Données fournies lors de la création d'un rendez-vous.
 * Exclut les champs auto-générés (id, timestamps) et ceux gérés
 * côté thérapeute/admin (status, stripe*, video_link, notes, rescheduled_to).
 */
export type CreateAppointmentData = Omit<
  Appointment,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
  | 'status'
  | 'stripe_payment_link_id'
  | 'stripe_payment_link_url'
  | 'stripe_payment_intent_id'
  | 'video_link'
  | 'therapist_notes'
  | 'rescheduled_to'
>;

// ---------------------------------------------------------------------------
// DTO mise à jour — champs modifiables par la thérapeute (back-office)
// ---------------------------------------------------------------------------

/**
 * Champs qu'une thérapeute peut modifier sur un rendez-vous existant.
 * Tous optionnels : on envoie uniquement les champs à modifier (PATCH).
 */
export type UpdateAppointmentData = Partial<
  Pick<
    Appointment,
    | 'status'
    | 'stripe_payment_link_id'
    | 'stripe_payment_link_url'
    | 'stripe_payment_intent_id'
    | 'video_link'
    | 'therapist_notes'
    | 'rescheduled_to'
  >
>;

// ---------------------------------------------------------------------------
// Réponses API
// ---------------------------------------------------------------------------

/** GET /api/appointments — liste paginée */
export interface AppointmentsListResponse {
  appointments: Appointment[];
  total: number;
}

/** POST /api/appointments — confirmation de création */
export interface CreateAppointmentResponse {
  appointment: Appointment;
  message: string;
}
