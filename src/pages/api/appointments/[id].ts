export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
import { auth } from '../../../lib/auth';
import { isAdminSession } from '../../../lib/authz';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendEmail, buildAppointmentConversationSubject } from '../../../lib/resend';
import { generateGoogleCalendarLink, generateOutlookCalendarLink, generateAppleCalendarInviteLink, CABINET_ADDRESS } from '../../../lib/ics';
import { createSecureLinkToken, verifySecureLinkToken } from '../../../lib/secure-links';
import { getTypeLabel, getModeLabel, calculatePrice } from '../../../lib/pricing';
import { stripe, createAppointmentPaymentLink } from '../../../lib/stripe';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../../../lib/google-calendar';
import { hasAppointmentConflict } from '../../../lib/appointment-conflicts';
import { isWithinBusinessHours } from '../../../utils/date';
import { isCabinetEligibleSlot } from '../../../lib/appointment-eligibility';
import { invalidateAvailabilityCache } from '../../../lib/calendar-cache.js';
import AppointmentConfirmed from '../../../emails/AppointmentConfirmed';
import AppointmentDeclined from '../../../emails/AppointmentDeclined';
import AppointmentRescheduled from '../../../emails/AppointmentRescheduled';
import AppointmentRescheduledPaid from '../../../emails/AppointmentRescheduledPaid';
import AppointmentCancelled from '../../../emails/AppointmentCancelled';
import PaymentRequest from '../../../emails/PaymentRequest';
import type { Appointment } from '../../../types/appointment';
import { issueCreditForCancellation, restoreCredits } from '../../../lib/credits';
import { isCancellableByTherapist } from '../../../lib/appointment-eligibility';

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

function buildFallbackVideoLink(appointmentId: string): string {
  const slug = appointmentId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24) || 'session';
  return `https://meet.jit.si/omf-therapie-${slug}`;
}

// ---------------------------------------------------------------------------
// PATCH handler
// ---------------------------------------------------------------------------

export const PATCH: APIRoute = async ({ request, params }) => {
  // 1. Parse body FIRST — needed before the auth guard to check action
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Corps de requête JSON invalide');
  }

  const {
    action,
    video_link,
    stripe_payment_intent_id,
    therapist_notes,
    rescheduled_to,
    override_first_session,
    is_solidarity,
    token,
  } = body;

  // 2. Auth guard — accept_reschedule est public via token signé.
  // Toutes les autres actions requièrent une session admin.
  const session = await auth.api.getSession({ headers: request.headers });
  if (action !== 'accept_reschedule') {
    if (!session) return errorResponse(401, 'Non autorisé');
    if (!isAdminSession(session)) return errorResponse(403, 'Accès refusé');
  }

  const { id } = params;
  if (!id) return errorResponse(400, 'Identifiant manquant');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) return errorResponse(400, 'Identifiant de rendez-vous invalide');

  if (!action || !['confirm', 'decline', 'cancel', 'reschedule', 'reschedule_paid', 'save_notes', 'accept_reschedule', 'cancel_reschedule'].includes(action as string))
    return errorResponse(422, 'Action invalide (confirm | decline | cancel | reschedule | reschedule_paid | save_notes | accept_reschedule | cancel_reschedule)');

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
      const resolvedFirstSession =
        typeof override_first_session === 'boolean'
          ? override_first_session
          : appointment.is_first_session;
      const pricing = calculatePrice(
        appointment.appointment_type,
        appointment.duration,
        resolvedFirstSession,
        typeof is_solidarity === 'boolean' ? is_solidarity : false,
      );
      updateData.is_first_session = resolvedFirstSession;
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
        const successUrl = import.meta.env.STRIPE_SUCCESS_URL ?? ((import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr') + '/rdv/merci/?source=payment-success');
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

    // Génération automatique du lien Google Meet pour les séances vidéo directement confirmées (edge case)
    if (appointment.appointment_mode === 'video' && newStatus === 'confirmed' && !updateData.video_link) {
      try {
        const start = new Date(appointment.scheduled_at);
        const end = new Date(start.getTime() + appointment.duration * 60 * 1000);
        // Idempotency: skip if event already exists
        if (!appointment.google_calendar_event_id) {
          const meetResult = await createCalendarEvent({
            title: `🎥 ${appointment.patient_name} — ${getTypeLabel(appointment.appointment_type)} (${appointment.duration} min)`,
            start: start.toISOString(),
            end: end.toISOString(),
            description: [
              `Patient: ${appointment.patient_name}`,
              `Email: ${appointment.patient_email}`,
              `Mode: ${getModeLabel(appointment.appointment_mode)}`,
              `Type: ${getTypeLabel(appointment.appointment_type)}`,
              `Durée: ${appointment.duration} min`,
            ].join('\n'),
            location: appointment.appointment_mode === 'in-person' ? CABINET_ADDRESS : 'Téléconsultation',
            attendeeEmail: appointment.patient_email,
            withMeet: true,
            appointmentId: id,
            colorId: appointment.appointment_mode === 'video' ? '11' : '2',
          });
          if (meetResult.meetLink) {
            updateData.video_link = meetResult.meetLink;
          } else {
            updateData.video_link = buildFallbackVideoLink(appointment.id);
          }
          updateData.google_calendar_event_id = meetResult.eventId;
        }
      } catch (meetErr) {
        // Dégradation gracieuse : fallback visio non bloquant
        console.error('[appointments/patch] Erreur génération Google Meet:', meetErr);
        updateData.video_link = buildFallbackVideoLink(appointment.id);
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

    await invalidateAvailabilityCache().catch(console.error);

    if (newStatus === 'confirmed' && updatedAppt.appointment_mode === 'in-person' && !updatedAppt.google_calendar_event_id) {
      const start = new Date(updatedAppt.scheduled_at);
      const end = new Date(start.getTime() + updatedAppt.duration * 60 * 1000);
      try {
        const calResult = await createCalendarEvent({
          title: `${updatedAppt.patient_name} — ${getTypeLabel(updatedAppt.appointment_type)} (${updatedAppt.duration} min)`,
          start: start.toISOString(),
          end: end.toISOString(),
          description: [
            `Patient: ${updatedAppt.patient_name}`,
            `Email: ${updatedAppt.patient_email}`,
            `Mode: ${getModeLabel(updatedAppt.appointment_mode)}`,
            `Type: ${getTypeLabel(updatedAppt.appointment_type)}`,
            `Durée: ${updatedAppt.duration} min`,
          ].join('\n'),
          location: CABINET_ADDRESS,
          attendeeEmail: updatedAppt.patient_email,
          withMeet: false,
          appointmentId: `${updatedAppt.id}-inperson-confirm`,
          colorId: '2',
        });
        await supabaseAdmin
          .from('appointments')
          .update({ google_calendar_event_id: calResult.eventId })
          .eq('id', updatedAppt.id);
      } catch (calendarErr) {
        console.error('[appointments/patch] Erreur création événement agenda (présentiel):', calendarErr);
      }
    }

    // Envoyer email de demande de paiement si payment_pending (séance vidéo)
    if (newStatus === 'payment_pending' && updatedAppt.stripe_payment_link_url) {
      await sendEmail({
        to: updatedAppt.patient_email,
        threadKey: `appointment:${updatedAppt.id}:patient`,
        subject: buildAppointmentConversationSubject(
          `Prépaiement de votre séance — ${new Intl.DateTimeFormat('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
          }).format(new Date(updatedAppt.scheduled_at))}`,
          updatedAppt.id,
        ),
        react: createElement(PaymentRequest, {
          patientName: updatedAppt.patient_name,
          scheduledAt: updatedAppt.scheduled_at,
          appointmentType: updatedAppt.appointment_type,
          duration: updatedAppt.duration,
          finalPrice: updatedAppt.final_price,
          stripePaymentUrl: updatedAppt.stripe_payment_link_url,
        }),
      });
    }

    // Envoyer confirmation seulement si status final = confirmed (pas payment_pending)
    if (newStatus === 'confirmed') {
      const icsEvent = buildICSEvent(updatedAppt);
      const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
      const outlookCalendarLink = generateOutlookCalendarLink(icsEvent);
      const inviteToken = createSecureLinkToken({
        appointmentId: updatedAppt.id,
        purpose: 'ics-invite',
        expiresInSeconds: 60 * 60 * 24 * 180,
        nonce: updatedAppt.scheduled_at,
      });
      const appleCalendarLink = generateAppleCalendarInviteLink(baseUrl, updatedAppt.id, inviteToken);

      await sendEmail({
        to: updatedAppt.patient_email,
        threadKey: `appointment:${updatedAppt.id}:patient`,
        subject: buildAppointmentConversationSubject(
          `Votre rendez-vous est confirmé — ${new Intl.DateTimeFormat('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
          }).format(new Date(updatedAppt.scheduled_at))}`,
          updatedAppt.id,
        ),
        react: createElement(AppointmentConfirmed, {
          patientName: updatedAppt.patient_name,
          appointmentType: updatedAppt.appointment_type,
          appointmentMode: updatedAppt.appointment_mode,
          scheduledAt: updatedAppt.scheduled_at,
          duration: updatedAppt.duration,
          finalPrice: updatedAppt.final_price,
          videoLink: updatedAppt.video_link ?? undefined,
          googleCalendarLink,
          appleCalendarLink,
          outlookCalendarLink,
          cabinetAddress: updatedAppt.appointment_mode === 'in-person' ? CABINET_ADDRESS : undefined,
        }),
      });
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

    await invalidateAvailabilityCache().catch(console.error);

    await sendEmail({
      to: updatedAppt.patient_email,
      threadKey: `appointment:${updatedAppt.id}:patient`,
      subject: buildAppointmentConversationSubject(
        "Votre demande de rendez-vous n'a pas pu être confirmée",
        updatedAppt.id,
      ),
      react: createElement(AppointmentDeclined, {
        patientName: updatedAppt.patient_name,
        scheduledAt: updatedAppt.scheduled_at,
        therapistNote: typeof therapist_notes === 'string' ? therapist_notes : undefined,
      }),
    });

    // Delete calendar event if exists (non-blocking — don't fail the decline if calendar fails)
    if (appointment.google_calendar_event_id) {
      await deleteCalendarEvent(appointment.google_calendar_event_id).catch((calendarErr: unknown) => {
        console.error('[appointments/patch] Erreur suppression événement agenda (decline):', calendarErr);
      });
    }

    return jsonResponse({ appointment: updatedAppt, message: 'Rendez-vous refusé.' });
  }

  // ---------------------------------------------------------------------------
  // Action: cancel — annule un RDV (confirmé/payé/etc.), gère l'avoir
  // ---------------------------------------------------------------------------
  // Règle consolidée :
  //   1. Toujours restituer l'avoir consommé par ce RDV (si credit_applied > 0).
  //   2. Émettre un nouvel avoir du cash réellement encaissé (final_price −
  //      credit_applied) UNIQUEMENT si status === 'payment_received' et si ce
  //      montant > 0 (sinon : aucun cash, aucun nouvel avoir).
  // Aucune exclusion pour les RDV déjà écoulés : la fenêtre d'éligibilité
  // (veille incluse) est validée par isCancellableByTherapist — le jugement
  // de la thérapeute est le garde-fou intentionnel (annulation de dernière minute).
  // ---------------------------------------------------------------------------
  if (action === 'cancel') {
    if (!isCancellableByTherapist(appointment))
      return errorResponse(409, 'Ce rendez-vous ne peut pas être annulé (hors fenêtre ou statut terminal).');

    // 1. Restituer l'avoir consommé par ce RDV (avant toute autre écriture).
    let restoredAmount = 0;
    if (appointment.credit_applied > 0) {
      try {
        await restoreCredits(appointment.id);
        restoredAmount = appointment.credit_applied;
      } catch (restoreErr) {
        // La cohérence du ledger prime : on bloque l'annulation si la restitution échoue.
        console.error('[appointments/patch] Erreur restitution avoir (cancel):', restoreErr);
        return errorResponse(500, 'Erreur lors de la restitution de l\'avoir');
      }
    }

    // 2. Émettre un nouvel avoir pour le cash encaissé (RDV payé uniquement).
    let issuedCredit = false;
    let creditCashAmount = 0;
    if (appointment.status === 'payment_received') {
      creditCashAmount = appointment.final_price - appointment.credit_applied;
      if (creditCashAmount > 0) {
        try {
          await issueCreditForCancellation(appointment, creditCashAmount);
          issuedCredit = true;
        } catch (creditErr) {
          console.error('[appointments/patch] Erreur émission avoir (cancel):', creditErr);
          return errorResponse(500, 'Erreur lors de l\'émission de l\'avoir');
        }
      }
    }

    // 3. Passer le RDV en cancelled.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        therapist_notes: therapist_notes ?? appointment.therapist_notes,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur cancel:', updateError);
      return errorResponse(500, 'Erreur lors de l\'annulation');
    }

    const updatedAppt = updated as Appointment;

    await invalidateAvailabilityCache().catch(console.error);

    // 4. Supprimer l'événement Google Calendar (non-bloquant).
    if (appointment.google_calendar_event_id) {
      await deleteCalendarEvent(appointment.google_calendar_event_id).catch((calendarErr: unknown) => {
        console.error('[appointments/patch] Erreur suppression événement agenda (cancel):', calendarErr);
      });
    }

    // 5. Notifier le patient par email (non-bloquant).
    //    Wording contract : jamais le mot « remboursement ». L'avoir est interne.
    await sendEmail({
      to: updatedAppt.patient_email,
      threadKey: `appointment:${updatedAppt.id}:patient`,
      subject: buildAppointmentConversationSubject(
        'Votre rendez-vous a été annulé',
        updatedAppt.id,
      ),
      react: createElement(AppointmentCancelled, {
        patientName: updatedAppt.patient_name,
        scheduledAt: updatedAppt.scheduled_at,
        appointmentMode: updatedAppt.appointment_mode,
        hasCredit: issuedCredit,
        creditAmount: issuedCredit ? creditCashAmount : undefined,
        therapistNote: typeof therapist_notes === 'string' ? therapist_notes : undefined,
      }),
    }).catch((emailErr: unknown) => {
      console.error('[appointments/patch] Erreur envoi email (cancel):', emailErr);
    });

    const messageParts = ['Rendez-vous annulé.'];
    if (issuedCredit) messageParts.push(`Avoir de ${creditCashAmount / 100}€ émis.`);
    if (restoredAmount > 0) messageParts.push(`Avoir de ${restoredAmount / 100}€ restitué.`);

    return jsonResponse({ appointment: updatedAppt, message: messageParts.join(' ') });
  }

  // ---------------------------------------------------------------------------
  // Action: reschedule_paid — move direct admin d'un RDV vidéo déjà payé
  // ---------------------------------------------------------------------------
  // Corrige le bug de double-facturation : l'action `reschedule` classique
  // expire le Payment Link et accept_reschedule en régénère un nouveau,
  // re-facturant un RDV déjà payé. Ici : on déplace juste le créneau, le
  // paiement est conservé, aucun lien Stripe, aucune re-accept patient.
  // Conditions : vidéo + payment_received + éligible (fenêtre veille).
  // ---------------------------------------------------------------------------
  if (action === 'reschedule_paid') {
    if (appointment.appointment_mode !== 'video' || appointment.status !== 'payment_received')
      return errorResponse(409, 'Le report direct ne s\'applique qu\'aux téléconsultations déjà payées.');
    if (!isCancellableByTherapist(appointment))
      return errorResponse(409, 'Ce rendez-vous ne peut pas être reporté (hors fenêtre).');

    if (!rescheduled_to || typeof rescheduled_to !== 'string')
      return errorResponse(422, 'Nouveau créneau requis pour un report');

    const newDate = new Date(rescheduled_to as string);
    if (isNaN(newDate.getTime()))
      return errorResponse(422, 'Format de date invalide pour le report');
    if (newDate.getTime() < Date.now())
      return errorResponse(422, 'Le nouveau créneau doit être dans le futur');

    if (!isWithinBusinessHours(rescheduled_to as string, appointment.duration))
      return errorResponse(422, 'Le créneau doit être dans les plages horaires (8h-12h ou 14h-19h).');

    try {
      const slotEnd = new Date(newDate.getTime() + appointment.duration * 60 * 1000);
      const hasConflict = await hasAppointmentConflict({
        slotStartIso: newDate.toISOString(),
        slotEndIso: slotEnd.toISOString(),
        excludeAppointmentId: appointment.id,
      });
      if (hasConflict) {
        return errorResponse(409, 'Ce créneau n\'est plus disponible. Veuillez sélectionner un autre horaire.');
      }
    } catch (conflictError) {
      console.error('[appointments/patch] Erreur vérification doublon (reschedule_paid):', conflictError);
      return errorResponse(500, 'Erreur lors de la vérification du créneau');
    }

    // AUCUN appel Stripe, AUCUN changement de status/prix/credit_applied.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        scheduled_at: newDate.toISOString(),
        therapist_notes: therapist_notes ?? appointment.therapist_notes,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur reschedule_paid:', updateError);
      return errorResponse(500, 'Erreur lors du report');
    }

    const updatedAppt = updated as Appointment;

    await invalidateAvailabilityCache().catch(console.error);

    // Mettre à jour l'événement Google Calendar existant (non-bloquant).
    if (appointment.google_calendar_event_id) {
      const start = new Date(updatedAppt.scheduled_at);
      const end = new Date(start.getTime() + updatedAppt.duration * 60 * 1000);
      await updateCalendarEvent(appointment.google_calendar_event_id, { start, end }).catch((calendarErr: unknown) => {
        console.error('[appointments/patch] Erreur MAJ événement agenda (reschedule_paid):', calendarErr);
      });
    }

    // Notifier le patient (email simple de notification, PAS de demande de paiement).
    await sendEmail({
      to: updatedAppt.patient_email,
      threadKey: `appointment:${updatedAppt.id}:patient`,
      subject: buildAppointmentConversationSubject(
        'Votre rendez-vous a été reporté',
        updatedAppt.id,
      ),
      react: createElement(AppointmentRescheduledPaid, {
        patientName: updatedAppt.patient_name,
        originalScheduledAt: appointment.scheduled_at,
        newScheduledAt: newDate.toISOString(),
        appointmentMode: updatedAppt.appointment_mode,
        duration: updatedAppt.duration,
        finalPrice: updatedAppt.final_price,
        therapistNote: typeof therapist_notes === 'string' ? therapist_notes : undefined,
      }),
    }).catch((emailErr: unknown) => {
      console.error('[appointments/patch] Erreur envoi email (reschedule_paid):', emailErr);
    });

    return jsonResponse({ appointment: updatedAppt, message: 'Rendez-vous reporté (paiement conservé).' });
  }

  // ---------------------------------------------------------------------------
  // Action: cancel_reschedule — annule la proposition de report, remet en pending 
  // ---------------------------------------------------------------------------
  if (action === 'cancel_reschedule') {
    if (appointment.status !== 'rescheduled')
      return errorResponse(409, 'Ce rendez-vous n\'est pas en attente d\'acceptation de report');

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'pending', rescheduled_to: null })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur cancel_reschedule:', updateError);
      return errorResponse(500, 'Erreur lors de la mise à jour');
    }

    return jsonResponse({ appointment: updated as Appointment, message: 'Proposition de report annulée.' });
  }

  // ---------------------------------------------------------------------------
  // Action: reschedule
  // ---------------------------------------------------------------------------
  if (action === 'reschedule') {
    if (!['pending', 'payment_pending', 'payment_received', 'confirmed', 'rescheduled'].includes(appointment.status))
      return errorResponse(409, 'Ce rendez-vous ne peut pas être reporté dans son état actuel');

    if (!rescheduled_to || typeof rescheduled_to !== 'string')
      return errorResponse(422, 'Nouveau créneau requis pour un report');

    const newDate = new Date(rescheduled_to as string);
    if (isNaN(newDate.getTime()))
      return errorResponse(422, 'Format de date invalide pour le report');

    if (newDate.getTime() < Date.now())
      return errorResponse(422, 'Le nouveau créneau doit être dans le futur');

    if (appointment.appointment_mode === 'in-person' && !(await isCabinetEligibleSlot(rescheduled_to as string)))
      return errorResponse(422, 'Les rendez-vous en présentiel ne sont pas disponibles sur ce créneau.');

    if (!isWithinBusinessHours(rescheduled_to as string, appointment.duration))
      return errorResponse(422, 'Le créneau doit être dans les plages horaires (8h-12h ou 14h-19h).');

    try {
      const slotEnd = new Date(newDate.getTime() + appointment.duration * 60 * 1000);
      const hasConflict = await hasAppointmentConflict({
        slotStartIso: newDate.toISOString(),
        slotEndIso: slotEnd.toISOString(),
        excludeAppointmentId: appointment.id,
      });
      if (hasConflict) {
        return errorResponse(409, 'Ce créneau n\'est plus disponible. Veuillez sélectionner un autre horaire.');
      }
    } catch (conflictError) {
      console.error('[appointments/patch] Erreur vérification doublon (reschedule):', conflictError);
      return errorResponse(500, 'Erreur lors de la vérification du créneau');
    }

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

    await invalidateAvailabilityCache().catch(console.error);

    await sendEmail({
      to: updatedAppt.patient_email,
      threadKey: `appointment:${updatedAppt.id}:patient`,
      subject: buildAppointmentConversationSubject(
        'Proposition de nouveau créneau',
        updatedAppt.id,
      ),
      react: createElement(AppointmentRescheduled, {
        patientName: updatedAppt.patient_name,
        originalScheduledAt: updatedAppt.scheduled_at,
        newScheduledAt: newDate.toISOString(),
        appointmentMode: updatedAppt.appointment_mode,
        duration: updatedAppt.duration,
        finalPrice: updatedAppt.final_price,
        therapistNote: typeof therapist_notes === 'string' ? therapist_notes : undefined,
        acceptUrl: (() => {
          const acceptToken = createSecureLinkToken({
            appointmentId: updatedAppt.id,
            purpose: 'accept-reschedule',
            expiresInSeconds: 60 * 60 * 24 * 14,
            nonce: updatedAppt.rescheduled_to ?? '',
          });
          return `${baseUrl.replace(/\/+$/, '')}/rdv/accepter-report/?id=${updatedAppt.id}&token=${encodeURIComponent(acceptToken)}`;
        })(),
      }),
    });

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

  // ---------------------------------------------------------------------------
  // Action: accept_reschedule (public — appelée depuis la page /rdv/accepter-report)
  // ---------------------------------------------------------------------------
  if (action === 'accept_reschedule') {
    if (typeof token !== 'string' || token.length < 32) {
      return errorResponse(403, 'Lien de confirmation invalide');
    }
    const isValidToken = verifySecureLinkToken({
      token,
      appointmentId: appointment.id,
      purpose: 'accept-reschedule',
      nonce: appointment.rescheduled_to ?? '',
    });
    if (!isValidToken) {
      return errorResponse(403, 'Lien de confirmation invalide');
    }

    // Idempotency : le statut doit être 'rescheduled'
    if (appointment.status !== 'rescheduled')
      return errorResponse(409, 'Ce lien a déjà été utilisé ou est invalide');

    // Le créneau proposé doit être dans le futur
    if (!appointment.rescheduled_to || appointment.rescheduled_to <= new Date().toISOString())
      return errorResponse(410, 'Ce créneau proposé a expiré. Contactez le thérapeute.');

    try {
      const acceptedStart = new Date(appointment.rescheduled_to);
      const acceptedEnd = new Date(acceptedStart.getTime() + appointment.duration * 60 * 1000);
      const hasConflict = await hasAppointmentConflict({
        slotStartIso: acceptedStart.toISOString(),
        slotEndIso: acceptedEnd.toISOString(),
        excludeAppointmentId: appointment.id,
      });
      if (hasConflict) {
        return errorResponse(409, 'Ce créneau n\'est plus disponible. Contactez la thérapeute pour une nouvelle proposition.');
      }
    } catch (conflictError) {
      console.error('[appointments/patch] Erreur vérification doublon (accept_reschedule):', conflictError);
      return errorResponse(500, 'Erreur lors de la vérification du créneau');
    }

    let newStatus: Appointment['status'];
    if (appointment.appointment_mode === 'video') {
      newStatus = 'payment_pending';
    } else {
      newStatus = 'confirmed';
    }

    const updateData: Record<string, unknown> = {
      status: newStatus,
      scheduled_at: appointment.rescheduled_to,
      rescheduled_to: null,
    };

    // Génération du Payment Link Stripe pour les séances vidéo
    if (appointment.appointment_mode === 'video') {
      try {
        const successUrl = import.meta.env.STRIPE_SUCCESS_URL ?? (`${baseUrl}/rdv/merci/?source=payment-success`);
        const description = `Séance ${getTypeLabel(appointment.appointment_type)} — OMF Thérapie (${appointment.duration} min)`;
        const paymentLink = await createAppointmentPaymentLink({
          appointmentId: appointment.id,
          patientEmail: appointment.patient_email,
          patientName: appointment.patient_name,
          amount: appointment.final_price,
          description,
          successUrl,
        });
        updateData.stripe_payment_link_id = paymentLink.id;
        updateData.stripe_payment_link_url = paymentLink.url;
      } catch (stripeErr) {
        console.error('[appointments/patch] accept_reschedule Erreur Stripe Payment Link:', stripeErr);
        return errorResponse(500, 'Erreur lors de la génération du lien de paiement Stripe');
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update(updateData)
      .eq('id', id)
      .select([
        'id', 'status', 'scheduled_at', 'rescheduled_to',
        'appointment_mode', 'appointment_type', 'duration',
        'patient_name', 'patient_email', 'final_price',
        'video_link', 'stripe_payment_link_url',
        'google_calendar_event_id',
        // therapist_notes, stripe_payment_intent_id, stripe_payment_link_id excluded — unauthenticated caller
      ].join(', '))
      .single();

    if (updateError || !updated) {
      console.error('[appointments/patch] Erreur accept_reschedule update:', updateError);
      return errorResponse(500, 'Erreur lors de la mise à jour');
    }

    const updatedAppt = updated as Appointment;

    await invalidateAvailabilityCache().catch(console.error);

    if (newStatus === 'confirmed' && updatedAppt.appointment_mode === 'in-person') {
      const start = new Date(updatedAppt.scheduled_at);
      const end = new Date(start.getTime() + updatedAppt.duration * 60 * 1000);
      try {
        let syncedEventId = appointment.google_calendar_event_id ?? updatedAppt.google_calendar_event_id ?? null;

        if (syncedEventId) {
          // Patch existing event; if orphaned/missing on Google, fallback to create.
          try {
            await updateCalendarEvent(syncedEventId, { start, end });
          } catch (patchErr) {
            console.warn('[appointments/patch] Patch événement échoué après acceptation de report, fallback création:', patchErr);
            syncedEventId = null;
          }
        }

        if (!syncedEventId) {
          // No existing event (or patch failed) — create one
          const calResult = await createCalendarEvent({
            title: `${updatedAppt.patient_name} — ${getTypeLabel(updatedAppt.appointment_type)} (${updatedAppt.duration} min)`,
            start: start.toISOString(),
            end: end.toISOString(),
            description: [
              `Patient: ${updatedAppt.patient_name}`,
              `Email: ${updatedAppt.patient_email}`,
              `Mode: ${getModeLabel(updatedAppt.appointment_mode)}`,
              `Type: ${getTypeLabel(updatedAppt.appointment_type)}`,
              `Durée: ${updatedAppt.duration} min`,
            ].join('\n'),
            location: CABINET_ADDRESS,
            attendeeEmail: updatedAppt.patient_email,
            withMeet: false,
            appointmentId: `${updatedAppt.id}-inperson-reschedule`,
            colorId: '2',
          });
          syncedEventId = calResult.eventId;
        }

        if (syncedEventId && syncedEventId !== updatedAppt.google_calendar_event_id) {
          const { data: refreshedAfterCalendar, error: refreshError } = await supabaseAdmin
            .from('appointments')
            .update({ google_calendar_event_id: syncedEventId })
            .eq('id', updatedAppt.id)
            .select([
              'id', 'status', 'scheduled_at', 'rescheduled_to',
              'appointment_mode', 'appointment_type', 'duration',
              'patient_name', 'patient_email', 'final_price',
              'video_link', 'stripe_payment_link_url',
              'google_calendar_event_id',
            ].join(', '))
            .single();
          if (refreshError || !refreshedAfterCalendar) {
            console.error('[appointments/patch] Erreur persistance google_calendar_event_id après acceptation de report:', refreshError);
            return errorResponse(500, 'Erreur lors de la synchronisation agenda');
          }
          updatedAppt = refreshedAfterCalendar as Appointment;
        }
      } catch (calendarErr) {
        console.error('[appointments/patch] Erreur mise à jour événement agenda après acceptation de report:', calendarErr);
        return errorResponse(500, 'Erreur lors de la synchronisation agenda');
      }
    }

    // Email : demande de paiement pour les séances vidéo
    if (newStatus === 'payment_pending' && updatedAppt.stripe_payment_link_url) {
      await sendEmail({
        to: updatedAppt.patient_email,
        threadKey: `appointment:${updatedAppt.id}:patient`,
        subject: buildAppointmentConversationSubject(
          `Prépaiement de votre séance — ${new Intl.DateTimeFormat('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
          }).format(new Date(updatedAppt.scheduled_at))}`,
          updatedAppt.id,
        ),
        react: createElement(PaymentRequest, {
          patientName: updatedAppt.patient_name,
          scheduledAt: updatedAppt.scheduled_at,
          appointmentType: updatedAppt.appointment_type,
          duration: updatedAppt.duration,
          finalPrice: updatedAppt.final_price,
          stripePaymentUrl: updatedAppt.stripe_payment_link_url,
        }),
      });
    }

    // Email : confirmation pour les séances en présentiel
    if (newStatus === 'confirmed') {
      const icsEvent = buildICSEvent(updatedAppt);
      const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
      const outlookCalendarLink = generateOutlookCalendarLink(icsEvent);
      const inviteToken = createSecureLinkToken({
        appointmentId: updatedAppt.id,
        purpose: 'ics-invite',
        expiresInSeconds: 60 * 60 * 24 * 180,
        nonce: updatedAppt.scheduled_at,
      });
      const appleCalendarLink = generateAppleCalendarInviteLink(baseUrl, updatedAppt.id, inviteToken);

      await sendEmail({
        to: updatedAppt.patient_email,
        threadKey: `appointment:${updatedAppt.id}:patient`,
        subject: buildAppointmentConversationSubject(
          `Votre rendez-vous est confirmé — ${new Intl.DateTimeFormat('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
          }).format(new Date(updatedAppt.scheduled_at))}`,
          updatedAppt.id,
        ),
        react: createElement(AppointmentConfirmed, {
          patientName: updatedAppt.patient_name,
          appointmentType: updatedAppt.appointment_type,
          appointmentMode: updatedAppt.appointment_mode,
          scheduledAt: updatedAppt.scheduled_at,
          duration: updatedAppt.duration,
          finalPrice: updatedAppt.final_price,
          videoLink: updatedAppt.video_link ?? undefined,
          googleCalendarLink,
          appleCalendarLink,
          outlookCalendarLink,
          cabinetAddress: updatedAppt.appointment_mode === 'in-person' ? CABINET_ADDRESS : undefined,
        }),
      });
    }

    return jsonResponse({
      appointment: updatedAppt,
      status: newStatus,
      message: newStatus === 'confirmed' ? 'Rendez-vous confirmé.' : 'Lien de paiement envoyé.',
    });
  }

  return errorResponse(422, 'Action non reconnue');
};
