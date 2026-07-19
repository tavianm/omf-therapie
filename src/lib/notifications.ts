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
import AppointmentConfirmed from '../emails/AppointmentConfirmed';
import PaymentReceivedNotification from '../emails/PaymentReceivedNotification';
import type { Appointment } from '../types/appointment';

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
