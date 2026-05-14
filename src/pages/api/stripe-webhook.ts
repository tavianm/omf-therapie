export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
// @ts-expect-error — stripe pas encore installé
import type Stripe from 'stripe';
import { stripe } from '../../lib/stripe';
import { supabaseAdmin } from '../../lib/supabase';
import { sendEmail } from '../../lib/resend';
import { generateGoogleCalendarLink, generateICSDataUri, CABINET_ADDRESS } from '../../lib/ics';
import { getTypeLabel, getModeLabel } from '../../lib/pricing';
import { createCalendarEvent } from '../../lib/google-calendar';
import AppointmentConfirmed from '../../emails/AppointmentConfirmed';
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

  // Génération automatique du lien Google Meet pour les séances vidéo (non-bloquant)
  let videoLink = updatedAppt.video_link ?? undefined;
  if (updatedAppt.appointment_mode === 'video' && !videoLink) {
    try {
      const start = new Date(updatedAppt.scheduled_at);
      const end = new Date(start.getTime() + updatedAppt.duration * 60 * 1000);
      const result = await createCalendarEvent({
        title: `Séance OMF Thérapie — ${getTypeLabel(updatedAppt.appointment_type)}`,
        start: start.toISOString(),
        end: end.toISOString(),
        description: `${getTypeLabel(updatedAppt.appointment_type)} (${getModeLabel(updatedAppt.appointment_mode)}) · ${updatedAppt.duration} min`,
        attendeeEmail: updatedAppt.patient_email,
        withMeet: true,
        appointmentId: updatedAppt.id,
      });
      if (result.meetLink) {
        videoLink = result.meetLink;
        await supabaseAdmin
          .from('appointments')
          .update({ video_link: result.meetLink })
          .eq('id', updatedAppt.id);
      }
    } catch (meetErr) {
      // Dégradation gracieuse : la séance est confirmée même si Meet échoue
      console.error('[stripe-webhook] Erreur génération Google Meet:', meetErr);
    }
  }

  // 2. Envoyer l'email de confirmation avec ICS (non-bloquant)
  try {
    const apptForIcs = videoLink ? { ...updatedAppt, video_link: videoLink } : updatedAppt;
    const icsEvent = buildICSEvent(apptForIcs);
    const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
    const icsDataUri = generateICSDataUri(icsEvent);

    await sendEmail({
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
        icsDataUri,
        cabinetAddress: undefined, // vidéo uniquement
      }),
    });
  } catch (emailErr) {
    // L'email ne doit pas bloquer le webhook
    console.error('[stripe-webhook] Erreur envoi email confirmation:', emailErr);
  }
}
