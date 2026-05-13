export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
import { auth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendEmail } from '../../../lib/resend';
import { generateGoogleCalendarLink, generateICSDataUri, CABINET_ADDRESS } from '../../../lib/ics';
import { getTypeLabel, getModeLabel } from '../../../lib/pricing';
import AppointmentConfirmed from '../../../emails/AppointmentConfirmed';
import AppointmentDeclined from '../../../emails/AppointmentDeclined';
import AppointmentRescheduled from '../../../emails/AppointmentRescheduled';
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

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Corps de requête JSON invalide');
  }

  const { action, video_link, stripe_payment_link_url, stripe_payment_link_id,
    stripe_payment_intent_id, therapist_notes, rescheduled_to } = body;

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
    if (video_link) updateData.video_link = video_link;
    if (stripe_payment_link_id) updateData.stripe_payment_link_id = stripe_payment_link_id;
    if (stripe_payment_link_url) updateData.stripe_payment_link_url = stripe_payment_link_url;
    if (stripe_payment_intent_id) updateData.stripe_payment_intent_id = stripe_payment_intent_id;

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

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'rescheduled',
        rescheduled_to: newDate.toISOString(),
        therapist_notes: therapist_notes ?? appointment.therapist_notes,
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
