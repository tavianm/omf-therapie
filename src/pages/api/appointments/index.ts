export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
import { supabaseAdmin } from '../../../lib/supabase';
import { calculatePrice } from '../../../lib/pricing';
import { sendEmail } from '../../../lib/resend';
import AppointmentRequestReceived from '../../../emails/AppointmentRequestReceived';
import AppointmentRequestNotification from '../../../emails/AppointmentRequestNotification';
import type { AppointmentType, AppointmentDuration, AppointmentMode } from '../../../types/appointment';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(?:\+33|0033|0)[1-9](?:[0-9]{8})$/;
const POSTAL_RE = /^[0-9]{5}$/;

const VALID_TYPES = new Set<string>(['individual', 'couple', 'family']);
const VALID_MODES = new Set<string>(['in-person', 'video']);
const VALID_DURATIONS = new Set<number>([60, 90]);

function errorResponse(status: number, message: string, field?: string): Response {
  return new Response(JSON.stringify({ error: message, field }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Vérifie que scheduled_at tombe un mercredi en heure Paris */
function isWednesdayParis(isoDate: string): boolean {
  const date = new Date(isoDate);
  const parisDay = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
  }).format(date);
  return parisDay === 'mercredi';
}

/** Vérifie que la séance est dans les plages horaires (8h-12h ou 14h-19h) en heure Paris */
function isWithinBusinessHours(isoDate: string, durationMin: number): boolean {
  const start = new Date(isoDate);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  const toParisMinutes = (d: Date): number => {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(d);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    return h * 60 + m;
  };

  const startMin = toParisMinutes(start);
  const endMin = toParisMinutes(end);

  // Plages : 8h00-12h00 (480-720) ou 14h00-19h00 (840-1140)
  const inMorning = startMin >= 480 && endMin <= 720;
  const inAfternoon = startMin >= 840 && endMin <= 1140;

  return inMorning || inAfternoon;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request }) => {
  // 1. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Corps de requête JSON invalide');
  }

  // 2. Validation des champs
  const {
    patient_name,
    patient_email,
    patient_phone,
    patient_postal_code,
    patient_city,
    patient_reason,
    appointment_type,
    appointment_mode,
    duration,
    is_first_session,
    scheduled_at,
  } = body;

  if (!patient_name || typeof patient_name !== 'string' || patient_name.trim().length < 2 || patient_name.trim().length > 100)
    return errorResponse(422, 'Nom invalide (2-100 caractères requis)', 'patient_name');

  if (!patient_email || typeof patient_email !== 'string' || !EMAIL_RE.test(patient_email))
    return errorResponse(422, 'Adresse email invalide', 'patient_email');

  if (!patient_phone || typeof patient_phone !== 'string' || !PHONE_RE.test(patient_phone.replace(/\s/g, '')))
    return errorResponse(422, 'Numéro de téléphone français invalide', 'patient_phone');

  if (!patient_postal_code || typeof patient_postal_code !== 'string' || !POSTAL_RE.test(patient_postal_code))
    return errorResponse(422, 'Code postal invalide (5 chiffres)', 'patient_postal_code');

  if (!patient_city || typeof patient_city !== 'string' || patient_city.trim().length < 2 || patient_city.trim().length > 100)
    return errorResponse(422, 'Ville invalide', 'patient_city');

  if (!patient_reason || typeof patient_reason !== 'string' || patient_reason.trim().length < 10 || patient_reason.trim().length > 1500)
    return errorResponse(422, 'Le motif doit contenir entre 10 et 1500 caractères', 'patient_reason');

  if (!appointment_type || !VALID_TYPES.has(appointment_type as string))
    return errorResponse(422, 'Type de thérapie invalide', 'appointment_type');

  if (!appointment_mode || !VALID_MODES.has(appointment_mode as string))
    return errorResponse(422, 'Mode de consultation invalide', 'appointment_mode');

  if (!duration || !VALID_DURATIONS.has(duration as number))
    return errorResponse(422, 'Durée invalide (60 ou 90 minutes)', 'duration');

  if (typeof is_first_session !== 'boolean')
    return errorResponse(422, 'Champ première séance invalide', 'is_first_session');

  if (!scheduled_at || typeof scheduled_at !== 'string')
    return errorResponse(422, 'Date de rendez-vous manquante', 'scheduled_at');

  const scheduledDate = new Date(scheduled_at as string);
  if (isNaN(scheduledDate.getTime()))
    return errorResponse(422, 'Format de date invalide', 'scheduled_at');

  // La date doit être dans le futur (> now + 1h)
  if (scheduledDate.getTime() < Date.now() + 60 * 60 * 1000)
    return errorResponse(422, 'Le rendez-vous doit être pris au moins 1 heure à l\'avance', 'scheduled_at');

  // 3. Règles métier
  if (appointment_mode === 'in-person' && !isWednesdayParis(scheduled_at as string))
    return errorResponse(422, 'Les rendez-vous en présentiel ont lieu le mercredi uniquement.');

  if (!isWithinBusinessHours(scheduled_at as string, duration as number))
    return errorResponse(422, 'Le créneau est en dehors des horaires d\'ouverture (8h-12h et 14h-19h).');

  // 4. Anti-doublon : vérifier qu'aucun rdv ne chevauche ce créneau
  const slotStart = scheduledDate;
  const slotEnd = new Date(scheduledDate.getTime() + (duration as number) * 60 * 1000);

  const { data: conflictingRows, error: conflictError } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .neq('status', 'cancelled')
    .neq('status', 'declined')
    .lt('scheduled_at', slotEnd.toISOString())
    .gt('scheduled_at', new Date(slotStart.getTime() - (duration as number) * 60 * 1000).toISOString())
    .limit(1);

  if (conflictError) {
    console.error('[appointments] Erreur vérification doublon:', conflictError);
    return errorResponse(500, 'Erreur lors de la vérification du créneau');
  }

  if (conflictingRows && conflictingRows.length > 0)
    return errorResponse(409, 'Ce créneau n\'est plus disponible, veuillez en choisir un autre.');

  // 5. Calcul du prix (en centimes)
  const pricing = calculatePrice(
    appointment_type as AppointmentType,
    duration as AppointmentDuration,
    is_first_session as boolean,
  );

  // 6. Insertion en base
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('appointments')
    .insert({
      patient_name: (patient_name as string).trim(),
      patient_email: (patient_email as string).toLowerCase().trim(),
      patient_phone: (patient_phone as string).replace(/\s/g, ''),
      patient_postal_code: patient_postal_code as string,
      patient_city: (patient_city as string).trim(),
      patient_reason: (patient_reason as string).trim(),
      appointment_type: appointment_type as AppointmentType,
      appointment_mode: appointment_mode as AppointmentMode,
      duration: duration as AppointmentDuration,
      is_first_session: is_first_session as boolean,
      base_price: pricing.basePrice * 100,
      discount: pricing.discount * 100,
      final_price: pricing.finalPrice * 100,
      scheduled_at: scheduledDate.toISOString(),
      status: 'pending',
    })
    .select()
    .single();

  if (insertError || !inserted) {
    console.error('[appointments] Erreur insertion:', insertError);
    return errorResponse(500, 'Erreur lors de l\'enregistrement du rendez-vous');
  }

  // 7. Emails en parallèle (non-bloquants)
  const baseUrl = import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr';

  Promise.all([
    sendEmail({
      to: inserted.patient_email,
      subject: 'Votre demande de rendez-vous a bien été reçue',
      react: createElement(AppointmentRequestReceived, {
        patientName: inserted.patient_name,
        appointmentType: inserted.appointment_type,
        appointmentMode: inserted.appointment_mode,
        scheduledAt: inserted.scheduled_at,
        duration: inserted.duration,
        finalPrice: inserted.final_price,
        isFirstSession: inserted.is_first_session,
      }),
    }),
    sendEmail({
      to: import.meta.env.ADMIN_EMAIL,
      subject: `Nouvelle demande de rendez-vous — ${inserted.patient_name}`,
      react: createElement(AppointmentRequestNotification, {
        patientName: inserted.patient_name,
        patientEmail: inserted.patient_email,
        patientPhone: inserted.patient_phone,
        patientPostalCode: inserted.patient_postal_code,
        patientCity: inserted.patient_city,
        patientReason: inserted.patient_reason,
        appointmentType: inserted.appointment_type,
        appointmentMode: inserted.appointment_mode,
        scheduledAt: inserted.scheduled_at,
        duration: inserted.duration,
        finalPrice: inserted.final_price,
        isFirstSession: inserted.is_first_session,
        dashboardUrl: `${baseUrl}/mes-rdvs`,
      }),
    }),
  ]).catch(err => console.error('[appointments] Erreur envoi emails:', err));

  // 8. Réponse 201 — ne retourner que les champs utiles au patient
  // (jamais therapist_notes, stripe_*, video_link — champs admin-only)
  const publicAppointment = {
    id: inserted.id,
    patient_name: inserted.patient_name,
    patient_email: inserted.patient_email,
    appointment_type: inserted.appointment_type,
    appointment_mode: inserted.appointment_mode,
    duration: inserted.duration,
    is_first_session: inserted.is_first_session,
    final_price: inserted.final_price,
    scheduled_at: inserted.scheduled_at,
    status: inserted.status,
    created_at: inserted.created_at,
  };

  return new Response(
    JSON.stringify({
      appointment: publicAppointment,
      message: 'Votre demande a bien été enregistrée.',
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    },
  );
};
