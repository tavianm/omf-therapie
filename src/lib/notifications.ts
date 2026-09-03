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
import { formatParisDate } from '../utils/datetime';
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
import {
  createCalendarEvent,
  type CreateEventParams,
  type CalendarClientOptions,
} from './google-calendar';
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
    location:
      appt.appointment_mode === 'in-person'
        ? CABINET_ADDRESS
        : (appt.video_link ?? undefined),
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
  const apptForIcs = videoLink
    ? { ...appointment, video_link: videoLink }
    : appointment;
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
  const appleCalendarLink = generateAppleCalendarInviteLink(
    baseUrl,
    appointment.id,
    inviteToken,
  );

  // 2. Email patient — construction verbatim de l'objet + props (webhook ~339-361)
  const patientEmailParams: SendEmailParams = {
    to: appointment.patient_email,
    threadKey: `appointment:${appointment.id}:patient`,
    subject: buildAppointmentConversationSubject(
      `Votre rendez-vous est confirmé — ${formatParisDate(appointment.scheduled_at)}`,
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

/**
 * Résultat de l'étape S1 élargi (W4) : un `calendarFn` injecté peut résoudre
 * SANS eventId exploitable (ex. no-op mock du sweep) — S1 traite alors l'étape
 * comme un skip SANS persistance (aucun update `google_calendar_event_id`).
 */
export interface CalendarStepResult {
  eventId?: string | null;
  meetLink?: string;
}

/** calendarFn injectable (DI) — accepte les résultats sans eventId (W4). */
export type CalendarFn = (
  params: CreateEventParams,
  options?: CalendarClientOptions,
) => Promise<CalendarStepResult>;

/** Chaîne d'update Supabase minimale (DI test-friendly, set-once via `.is`, bail via `.or`). */
interface SupabaseUpdateChain extends PromiseLike<{
  data: unknown;
  error: unknown;
}> {
  eq: (column: string, value: unknown) => SupabaseUpdateChain;
  is: (column: string, value: unknown) => SupabaseUpdateChain;
  or: (filter: string) => SupabaseUpdateChain;
  select: (...columns: string[]) => SupabaseUpdateChain;
}

/** Client Supabase minimal requis pour les écritures L2. */
type SupabaseLike = {
  from: (table: string) => {
    update: (payload: Record<string, unknown>) => SupabaseUpdateChain;
  };
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
  /** DI — défaut : module app. Accepte les résultats sans eventId (W4). */
  createCalendarEvent?: CalendarFn;
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
 *
 * W4 : `isSkipped` permet à une étape qui RÉSOUT sans produire d'effet
 * exploitable (ex. calendarFn no-op sans eventId) de se loguer `skipped`
 * plutôt que `ok` — sans lever ni persister quoi que ce soit.
 */
async function runStep<T>(
  step: StepName,
  appointmentId: string,
  fn: () => Promise<T>,
  isSkipped?: (value: T) => boolean,
): Promise<{ status: StepStatus; value?: T }> {
  const start = Date.now();
  try {
    const value = await fn();
    const status: StepStatus = isSkipped?.(value) ? 'skipped' : 'ok';
    console.info('[side-effects]', {
      step,
      appointmentId,
      ms: Date.now() - start,
      status,
    });
    return { status, value };
  } catch (err) {
    console.error('[side-effects] step failed:', step, appointmentId, err);
    console.info('[side-effects]', {
      step,
      appointmentId,
      ms: Date.now() - start,
      status: 'error',
    });
    return { status: 'error' };
  }
}

function logSkipped(step: StepName, appointmentId: string): void {
  console.info('[side-effects]', {
    step,
    appointmentId,
    ms: 0,
    status: 'skipped',
  });
}

// ---------------------------------------------------------------------------
// Issue #126 / W2 — bail atomique waitUntil ↔ sweep
// ---------------------------------------------------------------------------

/** Bail par défaut : 10 min (le claim est un LEASE, pas un marqueur de complétion). */
const DEFAULT_CLAIM_LEASE_MS = 10 * 60_000;

/**
 * Claim atomique d'une ligne `appointments` AVANT d'exécuter le pipeline de
 * side-effects (W2). Sans ce bail, le POST (`waitUntil`) et le sweep
 * `reconcile-invitations` peuvent démarrer le pipeline simultanément sur un
 * drapeau NULL → deux `events.insert` Google, deux Payment Links Stripe (la
 * garde set-once finale ne déduplique que l'email/flag — trop tard).
 *
 * L'update conditionnel est atomique côté Postgres :
 *   SET invitation_claimed_at = now()
 *   WHERE id = $1
 *     AND (invitation_claimed_at IS NULL OR invitation_claimed_at < now() − lease)
 * Une ligne retournée = claim obtenu ; zéro ligne = déjà claimé (bail vivant).
 *
 * Fail-closed : en cas d'erreur DB on retourne false — sans certitude
 * d'exclusivité on ne démarre PAS le pipeline (mieux vaut ne rien faire que
 * doubler un effet externe ; le sweep repassera à la prochaine heure).
 *
 * ⚠️ `invitation_claimed_at` n'est JAMAIS un marqueur de complétion — la
 * complétion reste `invitation_sent_at` (013). Voir 014_invitation_claim_at.sql.
 */
export async function claimInvitationProcessing(
  supabase: SupabaseLike,
  appointmentId: string,
  opts: { leaseMs?: number } = {},
): Promise<boolean> {
  const leaseMs = opts.leaseMs ?? DEFAULT_CLAIM_LEASE_MS;
  const cutoff = new Date(Date.now() - leaseMs).toISOString();
  const { data, error } = await supabase
    .from('appointments')
    .update({ invitation_claimed_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .or(`invitation_claimed_at.is.null,invitation_claimed_at.lt.${cutoff}`)
    .select('id');
  if (error) {
    console.error('[side-effects] claim failed:', { appointmentId });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Pipeline agenda → Stripe → email + drapeaux L2, extrait du
 * POST /api/admin/appointments/ (issue #126). Conçu pour être exécuté
 * POST-RÉPONSE via `waitUntil` (T7) ET par le futur cron de rattrapage :
 *
 * - S1 calendar : événement standard TOUJOURS créé (`withMeet:false` si un
 *   `video_link` existe déjà) ; persistance de l'event id (+ meet link).
 *   W4 : un résultat SANS eventId exploitable (ex. no-op mock du sweep) est
 *   un skip SANS persistance — le pipeline continue normalement.
 * - S2 stripe   : uniquement `mode vidéo && amountDueCents > 0` ; idempotent —
 *   un `stripe_payment_link_url` déjà présent est réutilisé (skip), jamais de
 *   second lien.
 * - S3 email    : uniquement `opts.sendEmail` ; clé d'idempotence Resend L1
 *   `invite:{id}:patient`. Réutilise la composition d'emails du POST.
 * - flags L2    : un SEUL update set-once `.is('invitation_sent_at', null)` ;
 *   `confirmation_sent_at` posé dans le MÊME update quand
 *   `status === 'payment_received'`. W1 : écrit SEULEMENT si TOUTES les étapes
 *   S1/S2/S3 sont ok ou skipped — TOUTE erreur d'étape (API OU persistance)
 *   laisse les drapeaux NULL pour que le cron de rattrapage repasse (les
 *   gardes de skip S1/S2 empêchent les doublons d'effets externes au re-jeu ;
 *   l'email re-joué est dédupliqué par la clé L1 Resend).
 *
 * Chaque étape est isolée : une erreur est loguée (`status:'error'`) et le
 * pipeline CONTINUE. Ne jette jamais.
 *
 * @returns `{ flagsSet }` — true uniquement si l'update set-once des drapeaux
 *          a résolu. Les appelants actuels (POST waitUntil, sweep) ignorent
 *          la valeur (le sweep classifie via sa capture Resend), mais les
 *          tests et futurs appelants peuvent l'observer.
 */
export async function processAppointmentSideEffects(
  appt: SideEffectsAppointment,
  opts: ProcessSideEffectsOptions,
): Promise<{ flagsSet: boolean }> {
  const db = opts.supabase ?? (supabaseAdmin as unknown as SupabaseLike);
  const calendarFn = opts.createCalendarEvent ?? createCalendarEvent;
  const paymentLinkFn =
    opts.createAppointmentPaymentLink ?? createAppointmentPaymentLink;
  const send = opts.sendFn ?? sendEmail;
  const isVideo = appt.appointment_mode === 'video';
  const baseUrl = opts.baseUrl ?? 'https://omf-therapie.fr';

  // --- S1 : événement agenda (standard ; pas de Meet si video_link déjà fourni)
  let resolvedVideoLink: string | undefined = appt.video_link ?? undefined;
  // W1 : accumulateur d'échecs par étape (API OU persistance). Les drapeaux L2
  // ne sont écrits qu'en l'absence de TOUT échec — sinon invitation_sent_at
  // reste NULL et le sweep rattrape la ligne (SC3).
  const stepFailed = { calendar: false, stripe: false, email: false };

  if (appt.google_calendar_event_id) {
    logSkipped('calendar', appt.id);
  } else {
    const cal = await runStep(
      'calendar',
      appt.id,
      async () => {
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
        // W4 : résultat sans eventId exploitable (ex. no-op mock) → skip SANS
        // persistance. Un faux id persisté ferait croire aux passages suivants
        // que l'événement Google existe déjà (skip S1 définitif erroné).
        if (!calResult.eventId) return calResult;
        // Persistance technique (update simple, distinct du set-once final).
        // C7 : une erreur d'update est THROWN → statut `error` observable pour
        // l'étape (sinon l'event id était perdu silencieusement et les flags
        // finissaient posés — le RDV ne serait jamais rattrapé).
        const calendarUpdate: Record<string, string> = {
          google_calendar_event_id: calResult.eventId,
        };
        if (isVideo && calResult.meetLink)
          calendarUpdate.video_link = calResult.meetLink;
        const { error: calendarUpdateError } = await db
          .from('appointments')
          .update(calendarUpdate)
          .eq('id', appt.id);
        if (calendarUpdateError) throw calendarUpdateError;
        return calResult;
      },
      value => !value.eventId,
    );
    if (cal.status === 'error') stepFailed.calendar = true;
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
      const { error: stripeUpdateError } = await db
        .from('appointments')
        .update({
          stripe_payment_link_id: paymentLink.id,
          stripe_payment_link_url: paymentLink.url,
        })
        .eq('id', appt.id);
      if (stripeUpdateError) throw stripeUpdateError;
      return paymentLink;
    });
    if (stripe.status === 'error') stepFailed.stripe = true;
    if (stripe.status === 'ok' && stripe.value)
      paymentLinkUrl = stripe.value.url;
  }

  // --- S3 : email patient (demande de prépaiement OU confirmation)
  if (!opts.sendEmail) {
    // Email non requis (send_email:false) — pas un échec : les flags seront posés.
    logSkipped('email', appt.id);
  } else {
    const email = await runStep('email', appt.id, async () => {
      const threadKey = `appointment:${appt.id}:patient`;
      const idempotencyKey = `invite:${appt.id}:patient`;
      const dateFr = new Date(appt.scheduled_at).toLocaleDateString('fr-FR');

      let params: SendEmailParams;
      if (isVideo && opts.amountDueCents > 0) {
        if (!paymentLinkUrl)
          throw new Error(
            'stripe payment link unavailable for PaymentRequest email',
          );
        params = {
          to: appt.patient_email,
          threadKey,
          subject: buildAppointmentConversationSubject(
            `Prépaiement de votre séance — ${dateFr}`,
            appt.id,
          ),
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
          location:
            appt.appointment_mode === 'in-person'
              ? CABINET_ADDRESS
              : (resolvedVideoLink ?? undefined),
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
        const appleCalendarLink = generateAppleCalendarInviteLink(
          baseUrl,
          appt.id,
          inviteToken,
        );
        params = {
          to: appt.patient_email,
          threadKey,
          subject: buildAppointmentConversationSubject(
            `Votre rendez-vous est confirmé — ${dateFr}`,
            appt.id,
          ),
          react: createElement(AppointmentConfirmed, {
            patientName: appt.patient_name,
            appointmentType: appt.appointment_type as AppointmentType,
            appointmentMode: appt.appointment_mode,
            scheduledAt: appt.scheduled_at,
            duration: appt.duration,
            finalPrice: appt.final_price,
            ...(isVideo
              ? { videoLink: resolvedVideoLink }
              : { cabinetAddress: CABINET_ADDRESS }),
            googleCalendarLink,
            appleCalendarLink,
            outlookCalendarLink,
          }),
          idempotencyKey,
        };
      }

      const emailResult = await send(params);
      if (!emailResult.success) {
        throw new Error(
          `email send failed: ${JSON.stringify(emailResult.error)}`,
        );
      }
      return emailResult;
    });
    stepFailed.email = email.status !== 'ok';
  }

  // --- L2 : drapeaux set-once (un seul update) — uniquement si TOUT est ok/skipped
  if (stepFailed.calendar || stepFailed.stripe || stepFailed.email) {
    // W1 : au moins une étape a échoué (API OU persistance) — on laisse
    // invitation_sent_at NULL ; le sweep rattrapera la ligne (l'échec email
    // permanent est géré par le poison-escape du sweep, inchangé).
    logSkipped('flags', appt.id);
    return { flagsSet: false };
  }
  const flags = await runStep('flags', appt.id, async () => {
    const now = new Date().toISOString();
    const payload: Record<string, string> = { invitation_sent_at: now };
    if (appt.status === 'payment_received') payload.confirmation_sent_at = now;
    const { error } = await db
      .from('appointments')
      .update(payload)
      .eq('id', appt.id)
      .is('invitation_sent_at', null);
    if (error) throw error;
  });
  return { flagsSet: flags.status === 'ok' };
}
