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

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const appointmentId = session.metadata?.appointment_id;
        const paymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;

        if (!appointmentId) {
          console.warn('[stripe-webhook] checkout.session.completed sans appointment_id');
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

  // 2. Envoyer l'email de confirmation avec ICS (non-bloquant)
  try {
    const icsEvent = buildICSEvent(updatedAppt);
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
        videoLink: updatedAppt.video_link ?? undefined,
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
