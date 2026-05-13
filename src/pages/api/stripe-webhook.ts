export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
// @ts-ignore — stripe pas encore installé
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
      import.meta.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[stripe-webhook] Signature invalide:', msg);
    return new Response(`Webhook signature invalide: ${msg}`, { status: 400 });
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

        await handlePaymentSucceeded(appointmentId, paymentIntent.id);
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

        await handlePaymentSucceeded(appointmentId, paymentIntentId ?? '');
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

async function handlePaymentSucceeded(appointmentId: string, paymentIntentId: string): Promise<void> {
  // 1. Récupérer le rendez-vous
  const { data: appt, error: fetchError } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (fetchError || !appt) {
    console.error('[stripe-webhook] Rendez-vous introuvable:', appointmentId);
    return;
  }

  const appointment = appt as Appointment;

  // 2. Idempotence : ignorer si déjà traité
  if (appointment.status !== 'payment_pending') {
    console.info('[stripe-webhook] Paiement déjà traité pour:', appointmentId);
    return;
  }

  // 3. Mettre à jour le statut
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('appointments')
    .update({
      status: 'payment_received',
      stripe_payment_intent_id: paymentIntentId || appointment.stripe_payment_intent_id,
    })
    .eq('id', appointmentId)
    .select()
    .single();

  if (updateError || !updated) {
    console.error('[stripe-webhook] Erreur mise à jour statut:', updateError);
    throw new Error('Erreur DB lors de la mise à jour du statut');
  }

  const updatedAppt = updated as Appointment;

  // 4. Envoyer l'email de confirmation avec ICS (non-bloquant)
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
