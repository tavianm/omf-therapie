export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
// @ts-expect-error — stripe pas encore installé
import type Stripe from 'stripe';
import { stripe } from '../../lib/stripe';
import { supabaseAdmin } from '../../lib/supabase';
import { sendEmail } from '../../lib/resend';
import { generateGoogleCalendarLink, generateOutlookCalendarLink, generateAppleCalendarInviteLink, CABINET_ADDRESS } from '../../lib/ics';
import { createSecureLinkToken } from '../../lib/secure-links';
import { getTypeLabel, getModeLabel } from '../../lib/pricing';
import { createCalendarEvent } from '../../lib/google-calendar';
import AppointmentConfirmed from '../../emails/AppointmentConfirmed';
import PaymentReceivedNotification from '../../emails/PaymentReceivedNotification';
import type { Appointment } from '../../types/appointment';

function buildICSEvent(appt: Appointment) {
  const start = new Date(appt.scheduled_at);
  const end = new Date(start.getTime() + appt.duration * 60 * 1000);
  const typeLabel = getTypeLabel(appt.appointment_type);
  const modeLabel = getModeLabel(appt.appointment_mode);
  return {
    uid: appt.id,
    summary: `Séance OMF Thérapie — ${typeLabel}`,
    description: `${typeLabel} (${modeLabel}) · ${appt.duration} min`,
    location: appt.appointment_mode === 'in-person' ? CABINET_ADDRESS : (appt.video_link ?? undefined),
    url: appt.video_link ?? undefined,
    start,
    end,
    organizerName: 'Oriane Montabonnet — OMF Thérapie',
    organizerEmail: import.meta.env.RESEND_FROM_EMAIL ?? 'contact@omf-therapie.fr',
  };
}

async function resolveAppointmentIdFromCheckoutSession(session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.metadata?.appointment_id) {
    return session.metadata.appointment_id;
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

  if (paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const fromPaymentIntent = paymentIntent.metadata?.appointment_id;
      if (fromPaymentIntent) return fromPaymentIntent;
    } catch (err) {
      console.error('[stripe-webhook] Impossible de lire le PaymentIntent pour résoudre appointment_id:', err);
    }
  }

  const paymentLinkId = typeof session.payment_link === 'string'
    ? session.payment_link
    : session.payment_link?.id;

  if (paymentLinkId) {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('stripe_payment_link_id', paymentLinkId)
      .maybeSingle();

    if (error) {
      console.error('[stripe-webhook] Impossible de résoudre appointment_id via stripe_payment_link_id:', error);
      return null;
    }

    return data?.id ?? null;
  }

  return null;
}

function buildFallbackVideoLink(appointmentId: string): string {
  const slug = appointmentId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24) || 'session';
  return `https://meet.jit.si/omf-therapie-${slug}`;
}

export const POST: APIRoute = async ({ request }) => {
  // 0. Vérifier que le secret webhook est configuré
  const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET absent — webhooks désactivés');
    return new Response('Configuration webhook manquante', { status: 500 });
  }

  // 1. Lire le raw body (obligatoire pour la vérification de signature Stripe)
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('Signature Stripe manquante', { status: 400 });
  }

  // 2. Vérifier la signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    // Logguer en interne, retourner un message générique (pas de détails techniques)
    console.error('[stripe-webhook] Signature invalide:', err instanceof Error ? err.message : err);
    return new Response('Signature invalide', { status: 400 });
  }

  // 3. Traiter les événements pertinents
  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const appointmentId = paymentIntent.metadata?.appointment_id;

        if (!appointmentId) {
          console.warn('[stripe-webhook] payment_intent.succeeded sans appointment_id');
          break;
        }

        await handlePaymentSucceeded(appointmentId, paymentIntent.id, event.id);
        break;
      }

      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        const appointmentId = await resolveAppointmentIdFromCheckoutSession(session);
        const paymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;

        if (!appointmentId) {
          console.warn('[stripe-webhook] checkout.session.completed sans appointment_id (metadata/payment_intent/payment_link)');
          break;
        }

        await handlePaymentSucceeded(appointmentId, paymentIntentId ?? '', event.id);
        break;
      }

      default:
        // Ignorer les autres événements
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] Erreur traitement:', err);
    // Retourner 500 pour que Stripe retente
    return new Response('Erreur interne', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ---------------------------------------------------------------------------
// Handler interne — paiement reçu
// ---------------------------------------------------------------------------

async function handlePaymentSucceeded(appointmentId: string, paymentIntentId: string, eventId: string): Promise<void> {
  // Atomic idempotency: only update if status is still payment_pending AND stripe_event_id is null
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('appointments')
    .update({
      status: 'payment_received',
      stripe_event_id: eventId,
      stripe_payment_intent_id: paymentIntentId || undefined,
    })
    .eq('id', appointmentId)
    .eq('status', 'payment_pending')
    .is('stripe_event_id', null)
    .select()
    .single();

  if (updateErr || !updated) {
    // Already processed or not in payment_pending state — idempotent, return 200
    console.info('[stripe-webhook] Événement déjà traité ou RDV non en attente de paiement:', appointmentId);
    return;
  }

  const updatedAppt = updated as Appointment;

  // Génération événement calendrier + lien visio (non-bloquant)
  let videoLink = updatedAppt.video_link ?? undefined;
  let calendarEventCreated = false;
  if (updatedAppt.appointment_mode === 'video' && !videoLink) {
    const start = new Date(updatedAppt.scheduled_at);
    const end = new Date(start.getTime() + updatedAppt.duration * 60 * 1000);
    const title = `🎥 ${updatedAppt.patient_name} — ${getTypeLabel(updatedAppt.appointment_type)} (${updatedAppt.duration} min)`;
    const description = [
      `Patient: ${updatedAppt.patient_name}`,
      `Email: ${updatedAppt.patient_email}`,
      `Mode: ${getModeLabel(updatedAppt.appointment_mode)}`,
      `Type: ${getTypeLabel(updatedAppt.appointment_type)}`,
      `Durée: ${updatedAppt.duration} min`,
    ].join('\n');

    try {
      const result = await createCalendarEvent({
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        description,
        location: 'Téléconsultation',
        attendeeEmail: updatedAppt.patient_email,
        withMeet: !videoLink,
        appointmentId: updatedAppt.id,
        colorId: '11',
      });
      calendarEventCreated = true;
      if (result.meetLink) {
        videoLink = result.meetLink;
        await supabaseAdmin
          .from('appointments')
          .update({ video_link: result.meetLink })
          .eq('id', updatedAppt.id);
      } else {
        throw new Error('Meet non retourné par Google Calendar');
      }
    } catch (meetErr) {
      console.error('[stripe-webhook] Erreur création événement Meet, fallback sans Meet:', meetErr);
      const fallbackVideoLink = buildFallbackVideoLink(updatedAppt.id);
      videoLink = fallbackVideoLink;
      try {
        await supabaseAdmin
          .from('appointments')
          .update({ video_link: fallbackVideoLink })
          .eq('id', updatedAppt.id);
      } catch (persistErr) {
        console.error('[stripe-webhook] Échec persistance fallback vidéo:', persistErr);
      }
      try {
        await createCalendarEvent({
          title,
          start: start.toISOString(),
          end: end.toISOString(),
          description: `${description}\nLien visio: ${fallbackVideoLink}`,
          location: 'Téléconsultation',
          attendeeEmail: updatedAppt.patient_email,
          withMeet: false,
          appointmentId: `${updatedAppt.id}-fallback`,
          colorId: '11',
        });
        calendarEventCreated = true;
      } catch (calendarErr) {
        console.error('[stripe-webhook] Échec fallback événement calendrier:', calendarErr);
      }
    }
  } else if (updatedAppt.appointment_mode === 'video') {
    const start = new Date(updatedAppt.scheduled_at);
    const end = new Date(start.getTime() + updatedAppt.duration * 60 * 1000);
    const title = `🎥 ${updatedAppt.patient_name} — ${getTypeLabel(updatedAppt.appointment_type)} (${updatedAppt.duration} min)`;
    const description = [
      `Patient: ${updatedAppt.patient_name}`,
      `Email: ${updatedAppt.patient_email}`,
      `Mode: ${getModeLabel(updatedAppt.appointment_mode)}`,
      `Type: ${getTypeLabel(updatedAppt.appointment_type)}`,
      `Durée: ${updatedAppt.duration} min`,
      ...(videoLink ? [`Lien visio: ${videoLink}`] : []),
    ].join('\n');

    try {
      await createCalendarEvent({
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        description,
        location: 'Téléconsultation',
        attendeeEmail: updatedAppt.patient_email,
        withMeet: false,
        appointmentId: `${updatedAppt.id}-event`,
        colorId: '11',
      });
      calendarEventCreated = true;
    } catch (calendarErr) {
      console.error('[stripe-webhook] Erreur création événement calendrier:', calendarErr);
    }
  }

  // 2. Envoyer les emails (patient + thérapeute) en non-bloquant
  try {
    const apptForIcs = videoLink ? { ...updatedAppt, video_link: videoLink } : updatedAppt;
    const icsEvent = buildICSEvent(apptForIcs);
    const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
    const outlookCalendarLink = generateOutlookCalendarLink(icsEvent);
    const baseUrl = import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr';
    const inviteToken = createSecureLinkToken({
      appointmentId: updatedAppt.id,
      purpose: 'ics-invite',
      expiresInSeconds: 60 * 60 * 24 * 180,
      nonce: updatedAppt.scheduled_at,
    });
    const appleCalendarLink = generateAppleCalendarInviteLink(baseUrl, updatedAppt.id, inviteToken);

    await Promise.allSettled([
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
          videoLink,
          googleCalendarLink,
          appleCalendarLink,
          outlookCalendarLink,
          cabinetAddress: undefined, // vidéo uniquement
        }),
      }),
      sendEmail({
        to: import.meta.env.ADMIN_EMAIL,
        subject: `Prépaiement reçu — ${updatedAppt.patient_name}`,
        react: createElement(PaymentReceivedNotification, {
          patientName: updatedAppt.patient_name,
          patientEmail: updatedAppt.patient_email,
          appointmentType: updatedAppt.appointment_type,
          appointmentMode: updatedAppt.appointment_mode,
          scheduledAt: updatedAppt.scheduled_at,
          duration: updatedAppt.duration,
          finalPrice: updatedAppt.final_price,
          videoLink,
          dashboardUrl: `${baseUrl}/mes-rdvs/`,
          calendarEventCreated,
        }),
      }),
    ]);
  } catch (emailErr) {
    // L'email ne doit pas bloquer le webhook
    console.error('[stripe-webhook] Erreur envoi emails post-paiement:', emailErr);
  }
}
