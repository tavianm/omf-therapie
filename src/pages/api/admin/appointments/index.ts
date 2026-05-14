export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';
import { supabaseAdmin } from '../../../../lib/supabase';
import { calculatePrice } from '../../../../lib/pricing';
import { sendEmail, buildAppointmentConversationSubject } from '../../../../lib/resend';
import { createAppointmentPaymentLink } from '../../../../lib/stripe';
import { generateGoogleCalendarLink, generateOutlookCalendarLink, generateAppleCalendarInviteLink, CABINET_ADDRESS } from '../../../../lib/ics';
import { createSecureLinkToken } from '../../../../lib/secure-links';
import { createCalendarEvent } from '../../../../lib/google-calendar';
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
  if (!isAdminSession(session)) {
    return errorResponse(403, 'Accès refusé');
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
      patient_phone: patient_phone ? (patient_phone as string).replace(/\s/g, '') : '',
      patient_postal_code: '',
      patient_city: '',
      appointment_type,
      appointment_mode,
      duration: Number(duration),
      scheduled_at,
      patient_reason: patient_reason ?? '',
      is_first_session: isFirstSession,
      status: initialStatus,
      base_price: pricing.basePrice * 100,
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

  if (!isVideo) {
    try {
      const start = new Date(appointment.scheduled_at);
      const end = new Date(start.getTime() + appointment.duration * 60 * 1000);
      await createCalendarEvent({
        title: `${appointment.patient_name} — séance présentielle (${appointment.duration} min)`,
        start: start.toISOString(),
        end: end.toISOString(),
        description: [
          `Patient: ${appointment.patient_name}`,
          `Email: ${appointment.patient_email}`,
          `Mode: Présentiel`,
          `Durée: ${appointment.duration} min`,
        ].join('\n'),
        location: CABINET_ADDRESS,
        attendeeEmail: appointment.patient_email,
        withMeet: false,
        appointmentId: `${appointment.id}-admin-inperson`,
        colorId: '2',
      });
    } catch (calendarErr) {
      console.error('[admin/appointments] Erreur création événement agenda (présentiel):', calendarErr);
    }
  }

  // 7. Envoi email
  if (shouldSendEmail) {
    const origin = new URL(request.url).origin;
    const successUrl = import.meta.env.STRIPE_SUCCESS_URL ?? `${origin}/rdv/merci/?source=payment-success`;

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
          subject: buildAppointmentConversationSubject(
            `Prépaiement de votre séance — ${new Date(appointment.scheduled_at).toLocaleDateString('fr-FR')}`,
            appointment.id,
          ),
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
      const start = new Date(appointment.scheduled_at);
      const end = new Date(start.getTime() + appointment.duration * 60 * 1000);
      const calendarEvent = {
        uid: appointment.id,
        summary: 'Séance de thérapie — OMF Therapie',
        description: `Patient: ${appointment.patient_name}\nMode: ${appointment.appointment_mode === 'video' ? 'Téléconsultation' : 'Présentiel'}`,
        location: appointment.appointment_mode === 'in-person' ? CABINET_ADDRESS : (appointment.video_link ?? undefined),
        url: appointment.video_link ?? undefined,
        start,
        end,
        organizerName: 'Oriane Montabonnet — OMF Thérapie',
        organizerEmail: import.meta.env.RESEND_FROM_EMAIL ?? 'contact@omf-therapie.fr',
      };
      const gcalLink = generateGoogleCalendarLink(calendarEvent);
      const outlookCalendarLink = generateOutlookCalendarLink(calendarEvent);
      const baseUrl = import.meta.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
      const inviteToken = createSecureLinkToken({
        appointmentId: appointment.id,
        purpose: 'ics-invite',
        expiresInSeconds: 60 * 60 * 24 * 180,
        nonce: appointment.scheduled_at,
      });
      const appleCalendarLink = generateAppleCalendarInviteLink(baseUrl, appointment.id, inviteToken);

      sendEmail({
        to: appointment.patient_email,
        subject: buildAppointmentConversationSubject(
          `Votre rendez-vous est confirmé — ${new Date(appointment.scheduled_at).toLocaleDateString('fr-FR')}`,
          appointment.id,
        ),
        react: createElement(AppointmentConfirmed, {
          patientName: appointment.patient_name,
          appointmentType: appointment.appointment_type,
          appointmentMode: appointment.appointment_mode,
          scheduledAt: appointment.scheduled_at,
          duration: appointment.duration,
          finalPrice: appointment.final_price,
          googleCalendarLink: gcalLink,
          appleCalendarLink,
          outlookCalendarLink,
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
