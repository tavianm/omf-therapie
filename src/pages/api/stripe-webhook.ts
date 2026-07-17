export const prerender = false;

import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { stripe } from '../../lib/stripe';
import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { getTypeLabel, getModeLabel } from '../../lib/pricing';
import { createCalendarEvent } from '../../lib/google-calendar';
import { buildAndSendConfirmationEmails } from '../../lib/notifications';
import type { Appointment } from '../../types/appointment';

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
      logger.error('stripe-webhook: failed to retrieve PaymentIntent to resolve appointment_id', { paymentIntentId }, err);
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
      logger.error('stripe-webhook: failed to resolve appointment_id via stripe_payment_link_id', { paymentLinkId }, error);
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
    logger.error('stripe-webhook: STRIPE_WEBHOOK_SECRET missing — webhooks disabled');
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
    logger.error('stripe-webhook: invalid signature', {}, err);
    return new Response('Signature invalide', { status: 400 });
  }

  // 3. Traiter les événements pertinents
  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const appointmentId = paymentIntent.metadata?.appointment_id;

        if (!appointmentId) {
          logger.warn('stripe-webhook: payment_intent.succeeded without appointment_id', { paymentIntentId: paymentIntent.id });
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
          logger.warn('stripe-webhook: checkout.session.completed without resolvable appointment_id (metadata/payment_intent/payment_link)', { paymentIntentId });
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
    logger.error('stripe-webhook: error processing event', { eventType: event.type, eventId: event.id }, err);
    // Retourner 500 pour que Stripe retente
    return new Response('Erreur interne', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const GET: APIRoute = async ({ url }) => {
  const isMockMode = import.meta.env.GOOGLE_CALENDAR_MOCK === 'true';
  if (!isMockMode) {
    return new Response('Mode mock non activé', { status: 403 });
  }

  const mockEnabled = url.searchParams.get('mock') === '1';
  const appointmentId = url.searchParams.get('appointment_id');

  if (!mockEnabled) {
    return new Response('Paramètre mock=1 requis', { status: 400 });
  }
  if (!appointmentId) {
    return new Response('appointment_id manquant', { status: 400 });
  }

  try {
    const paymentIntentId = `pi_mock_${appointmentId.replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
    const eventId = `evt_mock_${appointmentId.replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
    await handlePaymentSucceeded(appointmentId, paymentIntentId, eventId);

    return new Response(JSON.stringify({ ok: true, mocked: true, appointmentId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.error('stripe-webhook: mock GET handler failed', { appointmentId }, err);
    return new Response(JSON.stringify({ ok: false, error: 'Erreur interne mock' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// ---------------------------------------------------------------------------
// Handler interne — paiement reçu
// ---------------------------------------------------------------------------

export async function handlePaymentSucceeded(appointmentId: string, paymentIntentId: string, eventId: string): Promise<void> {
  // N1 — Reçu de paiement (idempotence L1 sur stripe_event_id).
  // On ne transitionne que si le statut est encore `payment_pending` ET
  // `stripe_event_id` est NULL : premier livreur seulement effectue l'UPDATE.
  // En cas de retry (0 lignes / erreur), on retombe sur un SELECT pour relire
  // la ligne et vérifier le drapeau L2 `confirmation_sent_at` (N2 ci-dessous).
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

  let updatedAppt: Appointment;

  if (updateErr || !updated) {
    // Retry ou statut inattendu : relire la ligne plutôt que de bailer.
    // Le garde-fou L2 (confirmation_sent_at) ci-dessous décide si l'on rejoue
    // les side-effects ou si l'on retourne tôt (déjà livré).
    const { data: fetched, error: fetchErr } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .maybeSingle();

    if (fetchErr || !fetched) {
      // Ligne introuvable : on ne peut rien faire, sortir proprement (200).
      logger.info('stripe-webhook: RDV introuvable après reçu de paiement', { appointmentId });
      return;
    }

    updatedAppt = fetched as Appointment;
  } else {
    updatedAppt = updated as Appointment;
  }

  // N2 — Garde-fou durable des side-effects (idempotence L2, issue #68).
  // `confirmation_sent_at` est positionné UNIQUEMENT après succès complet
  // (email patient délivré). Non-null ⇒ déjà livré, retour tôt idempotent.
  // NB : ce garde-fou remplace l'ancienne logique « bail si stripe_event_id set »
  // comme garde principal des side-effects — stripe_event_id (N1) ne déduplique
  // que l'accusé de paiement, pas les emails.
  if (updatedAppt.confirmation_sent_at) {
    logger.info('stripe-webhook: confirmations déjà délivrées (L2), skip idempotent', { appointmentId });
    return;
  }

  // Génération événement calendrier + lien visio (non-bloquant)
  let videoLink = updatedAppt.video_link ?? undefined;
  let calendarEventCreated = false;

  // If admin already created the calendar event at booking time, skip creation to avoid duplicates.
  if (updatedAppt.google_calendar_event_id) {
    calendarEventCreated = true;
  } else if (updatedAppt.appointment_mode === 'video' && !videoLink) {
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
        // Persister video_link ET google_calendar_event_id (issue #68) : le
        // garde-fou `if (google_calendar_event_id)` en ligne 233 devient ainsi
        // un vrai check d'idempotence. Sans cela, chaque retry recrée un
        // événement calendrier + salle Meet (le garde était mort car on ne
        // persistait que video_link).
        const { error: persistMeetErr } = await supabaseAdmin
          .from('appointments')
          .update({ video_link: result.meetLink, google_calendar_event_id: result.eventId })
          .eq('id', updatedAppt.id);
        if (persistMeetErr) {
          console.error('[stripe-webhook] Échec persistance google_calendar_event_id ( Meet):', persistMeetErr);
        }
      } else {
        throw new Error('Meet non retourné par Google Calendar');
      }
    } catch (meetErr) {
      logger.error('stripe-webhook: Meet event creation failed, falling back without Meet', { appointmentId: updatedAppt.id }, meetErr);
      const fallbackVideoLink = buildFallbackVideoLink(updatedAppt.id);
      videoLink = fallbackVideoLink;
      try {
        await supabaseAdmin
          .from('appointments')
          .update({ video_link: fallbackVideoLink })
          .eq('id', updatedAppt.id);
      } catch (persistErr) {
        logger.error('stripe-webhook: failed to persist fallback video link', { appointmentId: updatedAppt.id }, persistErr);
      }
      try {
        const fallbackResult = await createCalendarEvent({
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
        // Persister l'eventId du fallback (issue #68) — même raison que ci-dessus.
        const { error: persistFallbackErr } = await supabaseAdmin
          .from('appointments')
          .update({ google_calendar_event_id: fallbackResult.eventId })
          .eq('id', updatedAppt.id);
        if (persistFallbackErr) {
          console.error('[stripe-webhook] Échec persistance google_calendar_event_id (fallback):', persistFallbackErr);
        }
      } catch (calendarErr) {
        logger.error('stripe-webhook: fallback calendar event creation failed', { appointmentId: updatedAppt.id }, calendarErr);
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
      const eventResult = await createCalendarEvent({
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
      // Persister l'eventId (issue #68) — évite la duplication sur retry.
      const { error: persistEventErr } = await supabaseAdmin
        .from('appointments')
        .update({ google_calendar_event_id: eventResult.eventId })
        .eq('id', updatedAppt.id);
      if (persistEventErr) {
        console.error('[stripe-webhook] Échec persistance google_calendar_event_id (event):', persistEventErr);
      }
    } catch (calendarErr) {
      logger.error('stripe-webhook: calendar event creation failed (existing video link)', { appointmentId: updatedAppt.id }, calendarErr);
    }
  }

  // N2bis — Envoyer les emails de confirmation (patient + thérapeute) via le
  // module partagé. L'idempotence L1 (clé Resend `confirm:{stripe_payment_intent_id}`,
  // ~24h TTL) est gérée à l'intérieur de `buildAndSendConfirmationEmails`.
  // Ici, on n'attrape PAS l'exception : si l'appel rejette, elle propage vers
  // le gestionnaire POST qui retourne 500 → Stripe retry. C'est intentionnel :
  // on ne positionne `confirmation_sent_at` QUE sur succès complet.
  const result = await buildAndSendConfirmationEmails(updatedAppt, {
    videoLink,
    calendarEventCreated,
    adminEmail: import.meta.env.ADMIN_EMAIL,
    baseUrl: import.meta.env.BETTER_AUTH_URL ?? import.meta.env.SITE_URL,
  });

  // N3 — Marquer livré (drapeau durable L2). UNIQUEMENT si l'email patient
  // (le must-succeed) est délivré. Sur échec, on ne positionne RIEN afin que
  // l'appelant retourne 500 et que Stripe rejoue tout l'événement.
  // Garde `confirmation_sent_at IS NULL` contre une write race concurrente
  // (sweep + webhook). Ne JAMAIS reset.
  if (!result.patientEmailSent) {
    logger.error(
      'stripe-webhook: échec envoi email patient — confirmation_sent_at non positionné, Stripe retry',
      { appointmentId },
    );
    throw new Error(`Échec envoi email patient pour ${appointmentId}`);
  }

  const { error: confirmUpdateErr } = await supabaseAdmin
    .from('appointments')
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .is('confirmation_sent_at', null);

  if (confirmUpdateErr) {
    // L'email est parti mais le drapeau n'est pas persisté : la prochaine
    // retry verra confirmation_sent_at=NULL et renverra l'email (L1 dédup
    // côté Resend absorbera le doublon si dans la fenêtre de 24h). On log
    // sans throw — ne pas échouer après un envoi réussi.
    logger.error(
      'stripe-webhook: échec persistance confirmation_sent_at (L1 dédup absorbera le doublon)',
      { appointmentId },
      confirmUpdateErr,
    );
  }
}
