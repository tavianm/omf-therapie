/**
 * Notifications post-paiement — envoi des emails de confirmation.
 *
 * Module env-agnostic : n'accède jamais directement aux objets d'environnement
 * du runtime (ni celui d'Astro, ni `process.env`). Les valeurs environnementales
 * (BASE_URL, ADMIN_EMAIL, RESEND_FROM_EMAIL, BETTER_AUTH_SECRET) sont injectées
 * par l'appelant. Cela permet de partager la logique entre le webhook Astro et
 * le sweep de réconciliation Netlify.
 *
 * Idempotence L1 : chaque email porte une clé Resend scoppée par destinataire —
 * `confirm:patient:{stripe_payment_intent_id}` pour l'email patient,
 * `confirm:therapist:{stripe_payment_intent_id}` pour la notification thérapeute
 * (~24h TTL). Le scoping par destinataire est essentiel : Resend déduplique
 * uniquement sur la valeur de la clé (PAS sur un hash du body), donc deux
 * emails distincts (to/subject/body différents) partageant la même clé
 * entraîneraient le rejet silencieux du second comme « replay ».
 * Le drapeau durable `confirmation_sent_at` (L2) est géré par l'appelant.
 *
 * Issue #68 (post-rebase review) : les primitives partagées (clés d'idempotence,
 * signeur HMAC) vivent désormais dans `./idempotency-keys` et `./secure-links`
 * (avec DI du secret). Plus de duplication entre webhook et sweep.
 */

import { createElement } from 'react';
import {
  sendEmail,
  buildAppointmentConversationSubject,
  type SendEmailParams,
} from './resend';
import {
  generateGoogleCalendarLink,
  generateOutlookCalendarLink,
  generateAppleCalendarInviteLink,
  CABINET_ADDRESS,
} from './ics';
import { createSecureLinkToken } from './secure-links';
import {
  patientConfirmationKey,
  therapistConfirmationKey,
} from './idempotency-keys';
import { getTypeLabel, getModeLabel } from './pricing';
import { createCalendarEvent } from './google-calendar';
import { createAppointmentPaymentLink } from './stripe';
import { supabaseAdmin } from './supabase';
import AppointmentConfirmed from '../emails/AppointmentConfirmed';
import PaymentReceivedNotification from '../emails/PaymentReceivedNotification';
import PaymentRequest from '../emails/PaymentRequest';
import type { Appointment, AppointmentType } from '../types/appointment';

export interface SendConfirmationsResult {
  patientEmailSent: boolean;
  therapistEmailSent: boolean;
}

export interface BuildAndSendOptions {
  /** Lien visio résolu par l'appelant (le webhook le crée ; le sweep le lit depuis la ligne). */
  videoLink?: string;
  /** Indique si l'événement calendrier a été créé — passé à la notification thérapeute. */
  calendarEventCreated?: boolean;
  /** Injection pour les tests ; par défaut le `sendEmail` du module. */
  sendFn?: typeof sendEmail;
  /** Email admin (le webhook lit la var d'env Astro ADMIN_EMAIL ; le sweep passe process.env.ADMIN_EMAIL). */
  adminEmail?: string;
  /** URL de base pour le jeton d'invitation .ics + le lien tableau de bord.
   *  En prod, l'appelant DOIT résoudre `BETTER_AUTH_URL ?? SITE_URL` et le passer.
   *  Le fallback codé en dur n'est qu'un filet de sécurité pour les tests. */
  baseUrl?: string;
  /**
   * Secret HMAC pour signer le jeton d'invitation .ics (DI — issue #68 review).
   *
   * Par défaut, `createSecureLinkToken` lit `import.meta.env.BETTER_AUTH_SECRET`.
   * Le sweep Netlify (runtime Node) doit passer `process.env.BETTER_AUTH_SECRET`
   * explicitement car `import.meta.env` y est undefined.
   */
  signingSecret?: string;
}

/**
 * Construit l'événement ICS à partir d'un rendez-vous.
 *
 * Lift verbatim du helper local `buildICSEvent` de `stripe-webhook.ts`.
 * `organizerEmail` utilise le fallback `contact@omf-therapie.fr` (ce module est
 * env-agnostic ; T5 réconciliera la copie locale du webhook avec celle-ci).
 */
export function buildICSEvent(appt: Appointment) {
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
    organizerEmail: 'contact@omf-therapie.fr',
  };
}

/**
 * Construit et envoie les deux emails de confirmation (patient + thérapeute)
 * suite à un paiement Stripe.
 *
 * - Extrait verbatim du bloc inline de `stripe-webhook.ts` (lignes ~322-378).
 * - `Promise.allSettled` : un échec n'empêche pas l'autre envoi.
 * - Chaque envoi porte une clé d'idempotence scoppée par destinataire
 *   (`confirm:patient:{pi}` / `confirm:therapist:{pi}`, primitive L1, ~24h TTL Resend).
 *
 * @returns `{ patientEmailSent, therapistEmailSent }` — `true` uniquement si
 *          l'envoi correspondant a résolu avec `success: true`.
 *          `therapistEmailSent` vaut `false` si `options.adminEmail` est absent.
 */
export async function buildAndSendConfirmationEmails(
  appointment: Appointment,
  options: BuildAndSendOptions = {},
): Promise<SendConfirmationsResult> {
  const send = options.sendFn ?? sendEmail;
  // baseUrl : les appelants de production (webhook, sweep) DOIVENT passer
  // `BETTER_AUTH_URL ?? SITE_URL`. Ce fallback codé en dur n'est qu'un filet
  // de sécurité pour les tests — ne pas y compter en prod (issue #68 review).
  const baseUrl = options.baseUrl ?? 'https://omf-therapie.fr';
  const videoLink = options.videoLink ?? appointment.video_link ?? undefined;
  const calendarEventCreated = options.calendarEventCreated ?? false;
  // Clés d'idempotence scoppées par destinataire (issue #68) : Resend déduplique
  // sur la valeur de la clé, pas sur un hash du body. Deux emails distincts
  // (patient vs thérapeute) partageant la même clé entraîneraient le rejet
  // silencieux du second. Le préfixe `patient:` / `therapist:` les isole.
  // Issue #68 post-rebase review : les constructeurs vivent dans ./idempotency-keys
  // (partagés entre webhook et sweep — plus de risque de dérive du format).
  const pi = appointment.stripe_payment_intent_id;
  const patientIdempotencyKey = patientConfirmationKey(pi);
  const therapistIdempotencyKey = therapistConfirmationKey(pi);

  // 1. Construire l'événement ICS + les liens calendrier (lift verbatim du webhook ~325-336)
  const apptForIcs = videoLink ? { ...appointment, video_link: videoLink } : appointment;
  const icsEvent = buildICSEvent(apptForIcs);
  const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
  const outlookCalendarLink = generateOutlookCalendarLink(icsEvent);
  // Le sweep (runtime Node) passe signingSecret=process.env.BETTER_AUTH_SECRET ;
  // le webhook (runtime Astro) omet le paramètre → createSecureLinkToken lit
  // import.meta.env.BETTER_AUTH_SECRET. Les deux chemins partagent le même signeur.
  const inviteToken = createSecureLinkToken({
    appointmentId: appointment.id,
    purpose: 'ics-invite',
    expiresInSeconds: 60 * 60 * 24 * 180,
    nonce: appointment.scheduled_at,
    ...(options.signingSecret ? { secret: options.signingSecret } : {}),
  });
  const appleCalendarLink = generateAppleCalendarInviteLink(baseUrl, appointment.id, inviteToken);

  // 2. Email patient — construction verbatim de l'objet + props (webhook ~339-361)
  const patientEmailParams: SendEmailParams = {
    to: appointment.patient_email,
    threadKey: `appointment:${appointment.id}:patient`,
    subject: buildAppointmentConversationSubject(
      `Votre rendez-vous est confirmé — ${new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
      }).format(new Date(appointment.scheduled_at))}`,
      appointment.id,
    ),
    react: createElement(AppointmentConfirmed, {
      patientName: appointment.patient_name,
      appointmentType: appointment.appointment_type,
      appointmentMode: appointment.appointment_mode,
      scheduledAt: appointment.scheduled_at,
      duration: appointment.duration,
      finalPrice: appointment.final_price,
      videoLink,
      googleCalendarLink,
      appleCalendarLink,
      outlookCalendarLink,
      cabinetAddress: undefined, // vidéo uniquement
    }),
    idempotencyKey: patientIdempotencyKey,
  };

  // 3. Email thérapeute — skip gracieux si pas d'adminEmail ; sinon props verbatim (webhook ~362-378)
  const adminEmail = options.adminEmail;
  const therapistEmailParams: SendEmailParams | null = adminEmail
    ? {
        to: adminEmail,
        subject: `Prépaiement reçu — ${appointment.patient_name}`,
        react: createElement(PaymentReceivedNotification, {
          patientName: appointment.patient_name,
          patientEmail: appointment.patient_email,
          appointmentType: appointment.appointment_type,
          appointmentMode: appointment.appointment_mode,
          scheduledAt: appointment.scheduled_at,
          duration: appointment.duration,
          finalPrice: appointment.final_price,
          videoLink,
          dashboardUrl: `${baseUrl}/mes-rdvs/`,
          calendarEventCreated,
        }),
        idempotencyKey: therapistIdempotencyKey,
      }
    : null;

  // 4. Promise.allSettled — un échec ne doit pas faire échouer l'autre envoi
  const results = await Promise.allSettled([
    send(patientEmailParams),
    therapistEmailParams ? send(therapistEmailParams) : Promise.resolve(null),
  ]);

  // 5. Agréger les statuts
  const patientEmailSent =
    results[0].status === 'fulfilled' && results[0].value?.success === true;
  const therapistEmailSent = therapistEmailParams
    ? results[1].status === 'fulfilled' && results[1].value?.success === true
    : false;

  return { patientEmailSent, therapistEmailSent };
}

// ---------------------------------------------------------------------------
// Issue #126 / T6 — pipeline de side-effects post-réponse
// ---------------------------------------------------------------------------

/**
 * Rendez-vous inséré (ligne `appointments` + contexte d'exécution) tel que
 * renvoyé par le POST /api/admin/appointments/.
 * Structurellement compatible avec `Appointment` (champs utilisés seulement).
 */
export interface SideEffectsAppointment {
  id: string;
  status: string;
  appointment_type: string;
  appointment_mode: 'video' | 'in-person';
  duration: number;
  scheduled_at: string;
  patient_name: string;
  patient_email: string;
  final_price: number;
  /** Avoir déjà consommé sur ce RDV (centimes) — l'appelant déduit le solde dû. */
  credit_applied?: number | null;
  video_link?: string | null;
  google_calendar_event_id?: string | null;
  /** Lien Stripe déjà existant (idempotence S2 — jamais de second lien). */
  stripe_payment_link_id?: string | null;
  stripe_payment_link_url?: string | null;
}

/** Chaîne d'update Supabase minimale (DI test-friendly, set-once via `.is`). */
interface SupabaseUpdateChain extends PromiseLike<{ data: unknown; error: unknown }> {
  eq: (column: string, value: unknown) => SupabaseUpdateChain;
  is: (column: string, value: unknown) => SupabaseUpdateChain;
}

/** Client Supabase minimal requis pour les écritures L2. */
type SupabaseLike = {
  from: (table: string) => { update: (payload: Record<string, unknown>) => SupabaseUpdateChain };
};

export interface ProcessSideEffectsOptions {
  /** S3 : envoyer l'email patient (condition `send_email` du POST). */
  sendEmail: boolean;
  /** S2 : solde dû en centimes (final_price - credit_applied). */
  amountDueCents: number;
  /** URL de succès Stripe (S2). */
  successUrl?: string;
  /** Base des liens sécurisés .ics (DI, comme BuildAndSendOptions). */
  baseUrl?: string;
  /** Email admin (réservé — le POST actuel n'envoie pas de notification thérapeute ici). */
  adminEmail?: string;
  /**
   * Secret HMAC pour signer le jeton d'invitation .ics (DI — parité exacte
   * avec `BuildAndSendOptions.signingSecret`). Le sweep Netlify (runtime Node,
   * `import.meta.env` absent) DOIT passer `process.env.BETTER_AUTH_SECRET`
   * explicitement, sans quoi `createSecureLinkToken` lève en purgeant l'étape
   * email S3 de chaque ligne.
   */
  signingSecret?: string;
  /** DI — défaut : module app. */
  createCalendarEvent?: typeof createCalendarEvent;
  createAppointmentPaymentLink?: typeof createAppointmentPaymentLink;
  sendFn?: typeof sendEmail;
  /** Client Supabase pour les écritures L2 — défaut : `supabaseAdmin`. */
  supabase?: SupabaseLike;
}

type StepName = 'calendar' | 'stripe' | 'email' | 'flags';
type StepStatus = 'ok' | 'skipped' | 'error';

/**
 * Exécute une étape du pipeline avec isolation + observabilité :
 * durée mesurée, log structuré unique `[side-effects]`, erreur avalée
 * (le pipeline continue — le cron de rattrapage repasse sur les flags NULL).
 */
async function runStep<T>(
  step: StepName,
  appointmentId: string,
  fn: () => Promise<T>,
): Promise<{ status: StepStatus; value?: T }> {
  const start = Date.now();
  try {
    const value = await fn();
    console.info('[side-effects]', { step, appointmentId, ms: Date.now() - start, status: 'ok' });
    return { status: 'ok', value };
  } catch (err) {
    console.error('[side-effects] step failed:', step, appointmentId, err);
    console.info('[side-effects]', { step, appointmentId, ms: Date.now() - start, status: 'error' });
    return { status: 'error' };
  }
}

function logSkipped(step: StepName, appointmentId: string): void {
  console.info('[side-effects]', { step, appointmentId, ms: 0, status: 'skipped' });
}

/**
 * Pipeline agenda → Stripe → email + drapeaux L2, extrait du
 * POST /api/admin/appointments/ (issue #126). Conçu pour être exécuté
 * POST-RÉPONSE via `waitUntil` (T7) ET par le futur cron de rattrapage :
 *
 * - S1 calendar : événement standard TOUJOURS créé (`withMeet:false` si un
 *   `video_link` existe déjà) ; persistance de l'event id (+ meet link).
 * - S2 stripe   : uniquement `mode vidéo && amountDueCents > 0` ; idempotent —
 *   un `stripe_payment_link_url` déjà présent est réutilisé (skip), jamais de
 *   second lien.
 * - S3 email    : uniquement `opts.sendEmail` ; clé d'idempotence Resend L1
 *   `invite:{id}:patient`. Réutilise la composition d'emails du POST.
 * - flags L2    : un SEUL update set-once `.is('invitation_sent_at', null)` ;
 *   `confirmation_sent_at` posé dans le MÊME update quand
 *   `status === 'payment_received'`. SKIPPÉ si l'email a échoué OU si une
 *   écriture de persistance S1/S2 a échoué (C7) — drapeaux laissés NULL pour
 *   que le cron de rattrapage repasse.
 *
 * Chaque étape est isolée : une erreur est loguée (`status:'error'`) et le
 * pipeline CONTINUE. Ne jette jamais.
 */
export async function processAppointmentSideEffects(
  appt: SideEffectsAppointment,
  opts: ProcessSideEffectsOptions,
): Promise<void> {
  const db = opts.supabase ?? (supabaseAdmin as unknown as SupabaseLike);
  const calendarFn = opts.createCalendarEvent ?? createCalendarEvent;
  const paymentLinkFn = opts.createAppointmentPaymentLink ?? createAppointmentPaymentLink;
  const send = opts.sendFn ?? sendEmail;
  const isVideo = appt.appointment_mode === 'video';
  const baseUrl = opts.baseUrl ?? 'https://omf-therapie.fr';

  // --- S1 : événement agenda (standard ; pas de Meet si video_link déjà fourni)
  let resolvedVideoLink: string | undefined = appt.video_link ?? undefined;
  // C7 : un échec de PERSISTANCE (update event id / lien Stripe) doit laisser
  // les drapeaux L2 à NULL — le cron de rattrapage repassera. Distinct d'un
  // échec d'API (calendarFn/paymentLinkFn) où l'email prime sur les flags.
  let persistFailed = false;

  if (appt.google_calendar_event_id) {
    logSkipped('calendar', appt.id);
  } else {
    const cal = await runStep('calendar', appt.id, async () => {
      const start = new Date(appt.scheduled_at);
      const end = new Date(start.getTime() + appt.duration * 60 * 1000);
      const modeLabel = isVideo ? 'Téléconsultation' : 'Présentiel';
      const calResult = await calendarFn({
        title: `${isVideo ? '🎥 ' : ''}${appt.patient_name} — séance ${modeLabel.toLowerCase()} (${appt.duration} min)`,
        start: start.toISOString(),
        end: end.toISOString(),
        description: [
          `Patient: ${appt.patient_name}`,
          `Email: ${appt.patient_email}`,
          `Mode: ${modeLabel}`,
          `Durée: ${appt.duration} min`,
          ...(resolvedVideoLink ? [`Lien visio: ${resolvedVideoLink}`] : []),
        ].join('\n'),
        location: isVideo ? 'Téléconsultation' : CABINET_ADDRESS,
        attendeeEmail: appt.patient_email,
        withMeet: isVideo && !resolvedVideoLink,
        appointmentId: `${appt.id}-admin-${isVideo ? 'video' : 'inperson'}`,
        colorId: isVideo ? '11' : '2',
      });
      // Persistance technique (update simple, distinct du set-once final).
      // C7 : une erreur d'update est THROWN → statut `error` observable pour
      // l'étape (sinon l'event id était perdu silencieusement et les flags
      // finissaient posés — le RDV ne serait jamais rattrapé).
      const calendarUpdate: Record<string, string> = { google_calendar_event_id: calResult.eventId };
      if (isVideo && calResult.meetLink) calendarUpdate.video_link = calResult.meetLink;
      const { error: calendarUpdateError } = await db.from('appointments')
        .update(calendarUpdate)
        .eq('id', appt.id);
      if (calendarUpdateError) {
        persistFailed = true;
        throw calendarUpdateError;
      }
      return calResult;
    });
    if (cal.status === 'ok' && cal.value && isVideo && cal.value.meetLink) {
      resolvedVideoLink = cal.value.meetLink;
    }
  }

  // --- S2 : lien de paiement Stripe (solde dû, vidéo uniquement)
  let paymentLinkUrl: string | undefined;
  if (appt.stripe_payment_link_url) {
    // Idempotence (miroir exact de la garde S1 sur google_calendar_event_id) :
    // un lien déjà présent est RÉUTILISÉ pour l'email S3 — jamais de second
    // lien (cascade Stripe + sur-facturation du patient).
    paymentLinkUrl = appt.stripe_payment_link_url;
    logSkipped('stripe', appt.id);
  } else if (!(isVideo && opts.amountDueCents > 0)) {
    logSkipped('stripe', appt.id);
  } else {
    const stripe = await runStep('stripe', appt.id, async () => {
      const paymentLink = await paymentLinkFn({
        appointmentId: appt.id,
        patientEmail: appt.patient_email,
        patientName: appt.patient_name,
        amount: opts.amountDueCents,
        description: `Séance de thérapie — ${new Date(appt.scheduled_at).toLocaleDateString('fr-FR')}`,
        successUrl: opts.successUrl ?? `${baseUrl}/rdv/merci/`,
      });
      // C7 : idem S1 — l'erreur de persistance est observable, le sweep
      // rattrape (le lien Stripe orphelin reste payable mais non référencé).
      const { error: stripeUpdateError } = await db.from('appointments')
        .update({ stripe_payment_link_id: paymentLink.id, stripe_payment_link_url: paymentLink.url })
        .eq('id', appt.id);
      if (stripeUpdateError) {
        persistFailed = true;
        throw stripeUpdateError;
      }
      return paymentLink;
    });
    if (stripe.status === 'ok' && stripe.value) paymentLinkUrl = stripe.value.url;
  }

  // --- S3 : email patient (demande de prépaiement OU confirmation)
  let emailDelivered = true; // sendEmail:false → flags quand même posés
  if (!opts.sendEmail) {
    emailDelivered = true;
    logSkipped('email', appt.id);
  } else {
    const email = await runStep('email', appt.id, async () => {
      const threadKey = `appointment:${appt.id}:patient`;
      const idempotencyKey = `invite:${appt.id}:patient`;
      const dateFr = new Date(appt.scheduled_at).toLocaleDateString('fr-FR');

      let params: SendEmailParams;
      if (isVideo && opts.amountDueCents > 0) {
        if (!paymentLinkUrl) throw new Error('stripe payment link unavailable for PaymentRequest email');
        params = {
          to: appt.patient_email,
          threadKey,
          subject: buildAppointmentConversationSubject(`Prépaiement de votre séance — ${dateFr}`, appt.id),
          react: createElement(PaymentRequest, {
            patientName: appt.patient_name,
            scheduledAt: appt.scheduled_at,
            appointmentType: appt.appointment_type as AppointmentType,
            duration: appt.duration,
            finalPrice: opts.amountDueCents,
            stripePaymentUrl: paymentLinkUrl,
          }),
          idempotencyKey,
        };
      } else {
        // Avoir couvrant tout (payment_received) OU présentiel (confirmed).
        const start = new Date(appt.scheduled_at);
        const end = new Date(start.getTime() + appt.duration * 60 * 1000);
        const calendarEvent = {
          uid: appt.id,
          summary: 'Séance de thérapie — OMF Therapie',
          description: `Patient: ${appt.patient_name}\nMode: ${isVideo ? 'Téléconsultation' : 'Présentiel'}`,
          location: appt.appointment_mode === 'in-person' ? CABINET_ADDRESS : (resolvedVideoLink ?? undefined),
          url: resolvedVideoLink ?? undefined,
          start,
          end,
          organizerName: 'Oriane Montabonnet — OMF Thérapie',
          organizerEmail: 'contact@omf-therapie.fr',
        };
        const googleCalendarLink = generateGoogleCalendarLink(calendarEvent);
        const outlookCalendarLink = generateOutlookCalendarLink(calendarEvent);
        const inviteToken = createSecureLinkToken({
          appointmentId: appt.id,
          purpose: 'ics-invite',
          expiresInSeconds: 60 * 60 * 24 * 180,
          nonce: appt.scheduled_at,
          // C2 : DI du secret (parité buildAndSendConfirmationEmails). Sans
          // cette seam, createSecureLinkToken lève en runtime Node pur
          // (import.meta.env absent) et purge l'étape email de chaque ligne.
          ...(opts.signingSecret ? { secret: opts.signingSecret } : {}),
        });
        const appleCalendarLink = generateAppleCalendarInviteLink(baseUrl, appt.id, inviteToken);
        params = {
          to: appt.patient_email,
          threadKey,
          subject: buildAppointmentConversationSubject(`Votre rendez-vous est confirmé — ${dateFr}`, appt.id),
          react: createElement(AppointmentConfirmed, {
            patientName: appt.patient_name,
            appointmentType: appt.appointment_type as AppointmentType,
            appointmentMode: appt.appointment_mode,
            scheduledAt: appt.scheduled_at,
            duration: appt.duration,
            finalPrice: appt.final_price,
            ...(isVideo ? { videoLink: resolvedVideoLink } : { cabinetAddress: CABINET_ADDRESS }),
            googleCalendarLink,
            appleCalendarLink,
            outlookCalendarLink,
          }),
          idempotencyKey,
        };
      }

      const emailResult = await send(params);
      if (!emailResult.success) {
        throw new Error(`email send failed: ${JSON.stringify(emailResult.error)}`);
      }
      return emailResult;
    });
    emailDelivered = email.status === 'ok';
  }

  // --- L2 : drapeaux set-once (un seul update)
  if (!emailDelivered || persistFailed) {
    // Échec d'envoi OU de persistance (C7) : on laisse invitation_sent_at
    // NULL — le cron rattrapera.
    logSkipped('flags', appt.id);
    return;
  }
  await runStep('flags', appt.id, async () => {
    const now = new Date().toISOString();
    const payload: Record<string, string> = { invitation_sent_at: now };
    if (appt.status === 'payment_received') payload.confirmation_sent_at = now;
    const { error } = await db.from('appointments')
      .update(payload)
      .eq('id', appt.id)
      .is('invitation_sent_at', null);
    if (error) throw error;
  });
}
