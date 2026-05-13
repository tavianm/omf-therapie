export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
import { auth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import { calculatePrice } from '../../../../lib/pricing';
import { sendEmail } from '../../../../lib/resend';
import { createAppointmentPaymentLink } from '../../../../lib/stripe';
import { generateGoogleCalendarLink, generateICSDataUri, CABINET_ADDRESS } from '../../../../lib/ics';
import AppointmentConfirmed from '../../../../emails/AppointmentConfirmed';
import PaymentRequest from '../../../../emails/PaymentRequest';
import type { AppointmentType, AppointmentDuration } from '../../../../types/appointment';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(?:\+33|0033|0)[1-9](?:[0-9]{8})$/;

const VALID_TYPES = new Set<string>(['individual', 'couple', 'family']);
const VALID_MODES = new Set<string>(['in-person', 'video']);
const VALID_DURATIONS = new Set<number>([60, 90]);

function errorResponse(status: number, message: string, field?: string): Response {
  return new Response(JSON.stringify({ error: message, field }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// POST — création manuelle d'un rendez-vous par l'admin
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request }) => {
  // 1. Auth guard — admin seulement
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse(401, 'Non authentifié');
  }

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Corps de requête JSON invalide');
  }

  const {
    patient_name,
    patient_email,
    patient_phone,
    appointment_type,
    appointment_mode,
    duration,
    scheduled_at,
    patient_reason,
    override_first_session,
    is_solidarity,
    send_email: shouldSendEmail = true,
    video_link,
  } = body;

  // 3. Validation
  if (!patient_name || typeof patient_name !== 'string' || patient_name.trim().length < 2)
    return errorResponse(400, 'Nom requis (2 caractères minimum)', 'patient_name');

  if (!patient_email || typeof patient_email !== 'string' || !EMAIL_RE.test(patient_email))
    return errorResponse(400, 'Email invalide', 'patient_email');

  if (patient_phone && (typeof patient_phone !== 'string' || !PHONE_RE.test(patient_phone.replace(/\s/g, ''))))
    return errorResponse(400, 'Numéro de téléphone invalide', 'patient_phone');

  if (!appointment_type || !VALID_TYPES.has(appointment_type as string))
    return errorResponse(400, 'Type de séance invalide', 'appointment_type');

  if (!appointment_mode || !VALID_MODES.has(appointment_mode as string))
    return errorResponse(400, 'Mode de séance invalide', 'appointment_mode');

  if (!duration || !VALID_DURATIONS.has(Number(duration)))
    return errorResponse(400, 'Durée invalide (60 ou 90 minutes)', 'duration');

  if (!scheduled_at || typeof scheduled_at !== 'string' || isNaN(Date.parse(scheduled_at)))
    return errorResponse(400, 'Date de séance invalide', 'scheduled_at');

  if (appointment_mode === 'video' && video_link && typeof video_link !== 'string')
    return errorResponse(400, 'Lien vidéo invalide', 'video_link');

  // 4. Calcul tarifaire
  // Pour une création manuelle, on calcule toujours la remise nouveau client si applicable.
  // L'admin peut activer le tarif solidaire via is_solidarity.
  const { data: existingAppointments } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('patient_email', (patient_email as string).toLowerCase())
    .in('status', ['confirmed', 'completed'])
    .limit(1);

  const autoDetectedFirstSession = !existingAppointments || existingAppointments.length === 0;
  // override_first_session allows admin to manually force/disable first-session discount
  const isFirstSession = typeof override_first_session === 'boolean'
    ? override_first_session
    : autoDetectedFirstSession;
  const pricing = calculatePrice(
    appointment_type as AppointmentType,
    Number(duration) as AppointmentDuration,
    isFirstSession,
    typeof is_solidarity === 'boolean' ? is_solidarity : false,
  );

  // 5. Statut initial
  // in-person → confirmed directement (pas de paiement requis)
  // video → payment_pending (lien Stripe envoyé si shouldSendEmail)
  const isVideo = appointment_mode === 'video';
  const initialStatus = isVideo ? 'payment_pending' : 'confirmed';

  // 6. Insertion en base
  const { data: appointment, error: dbError } = await supabaseAdmin
    .from('appointments')
    .insert({
      patient_name: (patient_name as string).trim(),
      patient_email: (patient_email as string).toLowerCase(),
      patient_phone: patient_phone ? (patient_phone as string).replace(/\s/g, '') : null,
      appointment_type,
      appointment_mode,
      duration: Number(duration),
      scheduled_at,
      patient_reason: patient_reason ?? '',
      is_first_session: isFirstSession,
      status: initialStatus,
      discount: pricing.discount * 100,
      final_price: pricing.finalPrice * 100,
      video_link: isVideo ? (video_link ?? null) : null,
    })
    .select()
    .single();

  if (dbError || !appointment) {
    console.error('[admin/appointments] DB insert error:', dbError);
    return errorResponse(500, 'Erreur lors de la création du rendez-vous');
  }

  // 7. Envoi email
  if (shouldSendEmail) {
    const successUrl = `${new URL(request.url).origin}/rendez-vous/confirmation?id=${appointment.id}`;

    if (isVideo) {
      // Créer le lien Stripe et envoyer une demande de paiement
      try {
        const paymentLink = await createAppointmentPaymentLink({
          appointmentId: appointment.id,
          patientEmail: appointment.patient_email,
          patientName: appointment.patient_name,
          amount: appointment.final_price,
          description: `Séance de thérapie — ${new Date(appointment.scheduled_at).toLocaleDateString('fr-FR')}`,
          successUrl,
        });

        await supabaseAdmin
          .from('appointments')
          .update({ stripe_payment_url: paymentLink.url })
          .eq('id', appointment.id);

        sendEmail({
          to: appointment.patient_email,
          subject: `Prépaiement de votre séance — ${new Date(appointment.scheduled_at).toLocaleDateString('fr-FR')}`,
          react: createElement(PaymentRequest, {
            patientName: appointment.patient_name,
            scheduledAt: appointment.scheduled_at,
            appointmentType: appointment.appointment_type,
            duration: appointment.duration,
            finalPrice: appointment.final_price,
            stripePaymentUrl: paymentLink.url,
          }),
        }).catch(e => console.error('[admin/appointments] email PaymentRequest error:', e));
      } catch (e) {
        console.error('[admin/appointments] Stripe error (non-bloquant):', e);
      }
    } else {
      // Confirmer directement et envoyer l'email de confirmation
      const gcalLink = generateGoogleCalendarLink({
        title: 'Séance de thérapie — OMF Therapie',
        startDate: new Date(appointment.scheduled_at),
        durationMinutes: appointment.duration,
        description: 'Séance de thérapie avec Oriane Montabonnet',
        location: CABINET_ADDRESS,
      });

      const icsDataUri = generateICSDataUri({
        title: 'Séance de thérapie — OMF Therapie',
        startDate: new Date(appointment.scheduled_at),
        durationMinutes: appointment.duration,
        description: 'Séance de thérapie avec Oriane Montabonnet',
        location: CABINET_ADDRESS,
      });

      sendEmail({
        to: appointment.patient_email,
        subject: `Votre rendez-vous est confirmé — ${new Date(appointment.scheduled_at).toLocaleDateString('fr-FR')}`,
        react: createElement(AppointmentConfirmed, {
          patientName: appointment.patient_name,
          appointmentType: appointment.appointment_type,
          appointmentMode: appointment.appointment_mode,
          scheduledAt: appointment.scheduled_at,
          duration: appointment.duration,
          finalPrice: appointment.final_price,
          googleCalendarLink: gcalLink,
          icsDataUri,
          cabinetAddress: CABINET_ADDRESS,
        }),
      }).catch(e => console.error('[admin/appointments] email AppointmentConfirmed error:', e));
    }
  }

  return new Response(JSON.stringify({ appointment }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
