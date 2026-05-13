export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
import { auth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendEmail } from '../../../lib/resend';
import { generateGoogleCalendarLink, generateICSDataUri, CABINET_ADDRESS } from '../../../lib/ics';
import { getTypeLabel, getModeLabel, calculatePrice } from '../../../lib/pricing';
import { stripe, createAppointmentPaymentLink } from '../../../lib/stripe';
import { isWednesdayParis, isWithinBusinessHours } from '../../../utils/date';
import AppointmentConfirmed from '../../../emails/AppointmentConfirmed';
import AppointmentDeclined from '../../../emails/AppointmentDeclined';
import AppointmentRescheduled from '../../../emails/AppointmentRescheduled';
import PaymentRequest from '../../../emails/PaymentRequest';
import type { Appointment } from '../../../types/appointment';

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Construit l'événement ICS pour un rendez-vous confirmé */
function buildICSEvent(appt: Appointment) {
  const start = new Date(appt.scheduled_at);
  const end = new Date(start.getTime() + appt.duration * 60 * 1000);
  const typeLabel = getTypeLabel(appt.appointment_type);
  const modeLabel = getModeLabel(appt.appointment_mode);

  return {
    uid: appt.id,
    summary: `Séance OMF Thérapie — ${typeLabel}`,
    description: `${typeLabel} (${modeLabel}) · ${appt.duration} min`,
    location: appt.appointment_mode === 'in-person'
      ? CABINET_ADDRESS
      : (appt.video_link ?? undefined),
    url: appt.video_link ?? undefined,
    start,
    end,
    organizerName: 'Oriane Montabonnet — OMF Thérapie',
    organizerEmail: import.meta.env.RESEND_FROM_EMAIL ?? 'contact@omf-therapie.fr',
  };
}

// ---------------------------------------------------------------------------
// PATCH handler
// ---------------------------------------------------------------------------

export const PATCH: APIRoute = async ({ request, params }) => {
  // 1. Auth guard
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(401, 'Non autorisé');

  const { id } = params;
  if (!id) return errorResponse(400, 'Identifiant manquant');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) return errorResponse(400, 'Identifiant de rendez-vous invalide');

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Corps de requête JSON invalide');
  }

  const { action, video_link, stripe_payment_intent_id, therapist_notes, rescheduled_to, override_first_session, is_solidarity } = body;

  if (!action || !['confirm', 'decline', 'reschedule', 'save_notes'].includes(action as string))
    return errorResponse(422, 'Action invalide (confirm | decline | reschedule | save_notes)');

  // 3. Récupérer le rendez-vous
  const { data: appt, error: fetchError } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !appt) return errorResponse(404, 'Rendez-vous introuvable');

  const appointment = appt as Appointment;
  const baseUrl = import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr';

  // ---------------------------------------------------------------------------
  // Action: confirm
  // ---------------------------------------------------------------------------
  if (action === 'confirm') {
    if (!['pending', 'payment_received', 'rescheduled'].includes(appointment.status))
      return errorResponse(409, 'Ce rendez-vous ne peut pas être confirmé dans son état actuel');

    let newStatus: Appointment['status'];
    if (appointment.appointment_mode === 'video') {
      newStatus = stripe_payment_intent_id ? 'confirmed' : 'payment_pending';
    } else {
      newStatus = 'confirmed';
    }

    const updateData: Record<string, unknown> = {
      status: newStatus,
      therapist_notes: therapist_notes ?? appointment.therapist_notes,
    };

    // Recalcul tarifaire si l'admin a modifié les options de remise
    const hasOverride = override_first_session !== undefined || is_solidarity !== undefined;
    if (hasOverride) {
      const pricing = calculatePrice(
        appointment.appointment_type,
        appointment.duration,
        typeof override_first_session === 'boolean' ? override_first_session : appointment.is_first_session,
        typeof is_solidarity === 'boolean' ? is_solidarity : false,
      );
      updateData.discount    = pricing.discount * 100;    // → centimes
      updateData.final_price = pricing.finalPrice * 100;  // → centimes
    }

    // Validation URL vidéo
    if (video_link) {
      const ALLOWED_VIDEO_HOSTS = ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'whereby.com', 'jitsi.org'];
      try {
        const parsed = new URL(String(video_link));
        if (parsed.protocol !== 'https:' || !ALLOWED_VIDEO_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
          return errorResponse(400, 'Lien vidéo invalide : seuls les liens sécurisés vers des services de visioconférence connus sont acceptés');
        }
        updateData.video_link = parsed.toString();
      } catch {
        return errorResponse(400, 'Lien vidéo invalide');
      }
    }

    if (stripe_payment_intent_id) updateData.stripe_payment_intent_id = stripe_payment_intent_id;

    // Génération du Payment Link Stripe côté serveur pour les séances vidéo
    if (appointment.appointment_mode === 'video' && newStatus === 'payment_pending') {
      try {
        const successUrl = import.meta.env.STRIPE_SUCCESS_URL ?? ((import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr') + '/rdv/merci');
        const description = `Séance ${getTypeLabel(appointment.appointment_type)} — OMF Thérapie (${appointment.duration} min)`;
        const paymentLink = await createAppointmentPaymentLink({
          appointmentId: appointment.id,
          patientEmail: appointment.patient_email,
          patientName: appointment.patient_name,
          amount: typeof updateData.final_price === 'number' ? updateData.final_price : appointment.final_price,
          description,
          successUrl,
        });
        updateData.stripe_payment_link_id = paymentLink.id;
        updateData.stripe_payment_link_url = paymentLink.url;
      } catch (stripeErr) {
        console.error('[appointments/patch] Erreur Stripe Payment Link:', stripeErr);
        return errorResponse(500, 'Erreur lors de la génération du lien de paiement Stripe');
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur update:', updateError);
      return errorResponse(500, 'Erreur lors de la mise à jour');
    }

    const updatedAppt = updated as Appointment;

    // Envoyer email de demande de paiement si payment_pending (séance vidéo)
    if (newStatus === 'payment_pending' && updatedAppt.stripe_payment_link_url) {
      sendEmail({
        to: updatedAppt.patient_email,
        subject: `Prépaiement de votre séance — ${new Intl.DateTimeFormat('fr-FR', {
          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
        }).format(new Date(updatedAppt.scheduled_at))}`,
        react: createElement(PaymentRequest, {
          patientName: updatedAppt.patient_name,
          scheduledAt: updatedAppt.scheduled_at,
          appointmentType: updatedAppt.appointment_type,
          duration: updatedAppt.duration,
          finalPrice: updatedAppt.final_price,
          stripePaymentUrl: updatedAppt.stripe_payment_link_url,
        }),
      }).catch(err => console.error('[appointments/patch] Erreur email PaymentRequest:', err));
    }

    // Envoyer confirmation seulement si status final = confirmed (pas payment_pending)
    if (newStatus === 'confirmed') {
      const icsEvent = buildICSEvent(updatedAppt);
      const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
      const icsDataUri = generateICSDataUri(icsEvent);

      sendEmail({
        to: updatedAppt.patient_email,
        subject: `Votre rendez-vous est confirmé — ${new Intl.DateTimeFormat('fr-FR', {
          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
        }).format(new Date(updatedAppt.scheduled_at))}`,
        react: createElement(AppointmentConfirmed, {
          patientName: updatedAppt.patient_name,
          appointmentType: updatedAppt.appointment_type,
          appointmentMode: updatedAppt.appointment_mode,
          scheduledAt: updatedAppt.scheduled_at,
          duration: updatedAppt.duration,
          finalPrice: updatedAppt.final_price,
          videoLink: updatedAppt.video_link ?? undefined,
          googleCalendarLink,
          icsDataUri,
          cabinetAddress: updatedAppt.appointment_mode === 'in-person' ? CABINET_ADDRESS : undefined,
        }),
      }).catch(err => console.error('[appointments/patch] Erreur email confirm:', err));
    }

    return jsonResponse({ appointment: updatedAppt, message: newStatus === 'confirmed' ? 'Rendez-vous confirmé.' : 'Lien de paiement à envoyer au patient.' });
  }

  // ---------------------------------------------------------------------------
  // Action: decline
  // ---------------------------------------------------------------------------
  if (action === 'decline') {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'declined', therapist_notes: therapist_notes ?? appointment.therapist_notes })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur decline:', updateError);
      return errorResponse(500, 'Erreur lors de la mise à jour');
    }

    const updatedAppt = updated as Appointment;

    sendEmail({
      to: updatedAppt.patient_email,
      subject: 'Votre demande de rendez-vous',
      react: createElement(AppointmentDeclined, {
        patientName: updatedAppt.patient_name,
        scheduledAt: updatedAppt.scheduled_at,
        therapistNote: typeof therapist_notes === 'string' ? therapist_notes : undefined,
      }),
    }).catch(err => console.error('[appointments/patch] Erreur email decline:', err));

    return jsonResponse({ appointment: updatedAppt, message: 'Rendez-vous refusé.' });
  }

  // ---------------------------------------------------------------------------
  // Action: reschedule
  // ---------------------------------------------------------------------------
  if (action === 'reschedule') {
    if (!rescheduled_to || typeof rescheduled_to !== 'string')
      return errorResponse(422, 'Nouveau créneau requis pour un report');

    const newDate = new Date(rescheduled_to as string);
    if (isNaN(newDate.getTime()))
      return errorResponse(422, 'Format de date invalide pour le report');

    if (newDate.getTime() < Date.now())
      return errorResponse(422, 'Le nouveau créneau doit être dans le futur');

    if (appointment.appointment_mode === 'in-person' && !isWednesdayParis(rescheduled_to as string))
      return errorResponse(422, 'Les rendez-vous en présentiel ont lieu le mercredi uniquement.');

    if (!isWithinBusinessHours(rescheduled_to as string, appointment.duration))
      return errorResponse(422, 'Le créneau doit être dans les plages horaires (8h-12h ou 14h-19h).');

    // Expire l'ancien Payment Link Stripe s'il existe (évite le double-paiement)
    if (appointment.stripe_payment_link_id) {
      try {
        await stripe.paymentLinks.update(appointment.stripe_payment_link_id, { active: false });
      } catch (stripeErr) {
        console.error('[appointments/patch] Erreur expiration Payment Link Stripe:', stripeErr);
        // Non-bloquant : on continue, le lien expiré est préférable à bloquer le report
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'rescheduled',
        rescheduled_to: newDate.toISOString(),
        therapist_notes: therapist_notes ?? appointment.therapist_notes,
        stripe_payment_link_id: null,
        stripe_payment_link_url: null,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur reschedule:', updateError);
      return errorResponse(500, 'Erreur lors de la mise à jour');
    }

    const updatedAppt = updated as Appointment;

    sendEmail({
      to: updatedAppt.patient_email,
      subject: 'Proposition de nouveau créneau',
      react: createElement(AppointmentRescheduled, {
        patientName: updatedAppt.patient_name,
        originalScheduledAt: updatedAppt.scheduled_at,
        newScheduledAt: newDate.toISOString(),
        appointmentMode: updatedAppt.appointment_mode,
        duration: updatedAppt.duration,
        finalPrice: updatedAppt.final_price,
        therapistNote: typeof therapist_notes === 'string' ? therapist_notes : undefined,
        bookingUrl: `${baseUrl}/rendez-vous`,
      }),
    }).catch(err => console.error('[appointments/patch] Erreur email reschedule:', err));

    return jsonResponse({ appointment: updatedAppt, message: 'Nouveau créneau proposé.' });
  }

  // ---------------------------------------------------------------------------
  // Action: save_notes
  // ---------------------------------------------------------------------------
  if (action === 'save_notes') {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({ therapist_notes: typeof therapist_notes === 'string' ? therapist_notes : null })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur save_notes:', updateError);
      return errorResponse(500, 'Erreur lors de la mise à jour des notes');
    }

    return jsonResponse({ appointment: updated as Appointment, message: 'Notes sauvegardées.' });
  }

  return errorResponse(422, 'Action non reconnue');
};
