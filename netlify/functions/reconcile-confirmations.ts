/**
 * Netlify Scheduled Function — Reconciliation sweep for payment confirmations.
 *
 * Issue #68 (Increment B): hourly backstop for the Stripe webhook. Catches
 * `appointments` rows still in `payment_received` status with
 * `confirmation_sent_at IS NULL` and re-sends the confirmation emails.
 *
 * Handles the cases the webhook cannot:
 *   - Netlify Function timeout under load (webhook killed mid-side-effect)
 *   - Deploy-window gaps (webhook 502 during a release)
 *   - Transient infra failures that exceed Stripe's ~3-day retry window
 *
 * Two-layer idempotency (see spec SC table):
 *   - L1: Resend `idempotencyKey = confirm:{patient|therapist}:{stripe_payment_intent_id}`
 *         (~24h TTL, server-side dedup) — concurrent in-flight sends with the
 *         webhook collapse to a single delivered email pair.
 *   - L2: `confirmation_sent_at` flag — set ONLY after the patient email succeeds,
 *         guarded by `WHERE confirmation_sent_at IS NULL` (write-race safety vs.
 *         a concurrent webhook retry). Never reset.
 *
 * ---------------------------------------------------------------------------
 * IMPORT DECISION — Path A (shared module), retired from Path B.
 * ---------------------------------------------------------------------------
 * Historiquement, ce sweep répliquait `buildAndSendConfirmationEmails` localement
 * (Path B) car `src/lib/notifications.ts` importait statiquement `./resend`, qui
 * lit `import.meta.env.*` au chargement du module. `import.meta.env` est un
 * transform Vite/Astro, indéfini dans le runtime Node de Netlify Functions.
 *
 * Issue #68 (post-rebase review) : `src/lib/resend.ts` a été refactoré pour
 * lazy-init les transports (plus de lecture `import.meta.env` au module-load).
 * Le sweep peut donc importer directement `notifications.ts` + `idempotency-keys`
 * + `resend-errors` (primitives partagées entre webhook et sweep — plus de risque
 * de dérive sur le format des clés, la classification d'erreur, ou le signeur HMAC).
 *
 * La fonction `sendEmail` publique reste couplée à `import.meta.env` (pour
 * `RESEND_FROM_EMAIL`, `ADMIN_EMAIL`, et l'auto-BCC admin). Le sweep l'évite en
 * injectant son propre `sendFn` via `BuildAndSendOptions` — ce `sendFn` utilise
 * un client Resend instancié depuis `process.env` et transmet la clé d'idempotence
 * au header Resend. Le threadKey est honoré au niveau contrat (le header
 * `X-Thread-Key` est posé) mais la persistance `email_threads` est webhook-only —
 * le sweep ne crée pas de racine de thread, il s'appuie sur le thread existant
 * créé par le webhook (ou aucun thread si la 1re notification vient du sweep,
 * ce qui est rare car le webhook réussit dans >99% des cas).
 *
 * ---------------------------------------------------------------------------
 * Observability — Sentry.withMonitor + structured logger (pattern #99).
 * ---------------------------------------------------------------------------
 * Le scheduler Netlify n'a pas d'alerting natif. `Sentry.withMonitor` est le
 * seul mécanisme qui détecte une exécution manquée (check-in attendu dans la
 * fenêtre `checkInMargin`). Le logger structuré (`_lib/logger`) route les
 * erreurs vers Sentry avec scrubbing PII (`patient_email`, `patient_phone`, …).
 *
 * ---------------------------------------------------------------------------
 * Required env vars (configure in Netlify dashboard — NEVER inline secrets):
 *   SUPABASE_DATABASE_URL         — Supabase project REST URL
 *   SUPABASE_SERVICE_ROLE_KEY     — service-role key (sweep needs write access
 *                                   to update confirmation_sent_at)
 *   RESEND_API_KEY                — Resend API key
 *   RESEND_FROM_EMAIL             — sender address (fallback: OMF Thérapie <contact@omf-therapie.fr>)
 *   ADMIN_EMAIL                   — therapist notification recipient (optional;
 *                                   if absent, the therapist email is skipped)
 *   BETTER_AUTH_URL | SITE_URL    — base URL for the Apple Calendar invite link
 *                                   + therapist dashboard link
 *   BETTER_AUTH_SECRET            — HMAC secret for the .ics invite token
 *                                   (must match the app's signing key)
 *   PUBLIC_SENTRY_DSN             — Sentry DSN (optional — instrumentation Sentry)
 */

import type { Config } from '@netlify/functions';
import * as Sentry from '@sentry/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import ws from 'ws';
import type { Appointment } from '../../src/types/appointment';
import type { SendEmailParams, SendEmailResult } from '../../src/lib/resend';
import { isRetryableResendError, type ResendApiError } from '../../src/lib/resend-errors';
import { buildAndSendConfirmationEmails } from '../../src/lib/notifications';
import { initSentry, captureAndFlush } from './_lib/sentry';
import { logger } from './_lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Wall-clock budget per invocation. Netlify Scheduled Functions enforce a
 * 30-second hard timeout (per Netlify docs — NOT 10s, which is the default
 * synchronous function timeout). We use a conservative 8.5s budget to leave
 * generous margin for the final UPDATE + Sentry flush + log drain; when
 * elapsed, the loop breaks and remaining rows drain on the next hourly run.
 * Issue #68 post-rebase review : comment corrigé (30s, pas 10s).
 */
const DEADLINE_MS = 8500;

/** Re-send scope: appointments created within this window are eligible. */
const CREATED_WITHIN_DAYS = 14;

/** Max rows processed per invocation (bounds work + respects the deadline). */
const BATCH_LIMIT = 25;

/**
 * Schedule partagée entre la config Netlify et le monitor Sentry — évite la
 * dérive entre la cadence attendue par Sentry et le déclencheur réel Netlify.
 */
const SCHEDULE = '5 * * * *' as const;

// ---------------------------------------------------------------------------
// Schedule config — hourly at :05 to dodge webhook contention on the hour
// ---------------------------------------------------------------------------

export const config: Config = {
  schedule: SCHEDULE,
};

// ---------------------------------------------------------------------------
// Local sendFn — process.env-instantiated Resend client honoring idempotencyKey
// ---------------------------------------------------------------------------

/**
 * Crée un `sendFn` injecté dans `buildAndSendConfirmationEmails`.
 *
 * Pourquoi ne pas utiliser `sendEmail` de `src/lib/resend.ts` ?
 *  - `sendEmail` lit `import.meta.env.RESEND_FROM_EMAIL` et `ADMIN_EMAIL` (BCC
 *    auto-admin) au runtime — `import.meta.env` est undefined dans le runtime
 *    cron, donc l'appel planterait.
 *  - Le sweep instancie son propre client Resend depuis `process.env` et applique
 *    une politique de retry simplifiée (pas de retry intra-row : le sweep s'appuie
 *    sur sa propre cadence horaire pour ré-essayer les rows échoués).
 *
 * Le threadKey est reçu via `params.threadKey` et transmis comme en-tête
 * `X-Thread-Key` à Resend (parité de contrat avec le webhook). La persistance
 * `email_threads` (supabase) reste webhook-only : le sweep ne crée pas de
 * racine de thread — il s'appuie sur le thread existant créé par le webhook
 * (cas normal) ou émet l'email sans fil (cas rare d'un sweep avant webhook).
 *
 * `idempotencyKey` est transmis via l'en-tête Resend `Idempotency-Key` : deux
 * tentatives concurrentes (webhook + sweep) avec la même clé ne produisent
 * qu'un seul email côté Resend (dedup serveur, ~24h TTL).
 */
/**
 * Crée un `sendFn` injecté dans `buildAndSendConfirmationEmails` + un accesseur
 * pour récupérer la dernière erreur brute Resend (pour classification poison).
 *
 * Pourquoi ne pas utiliser `sendEmail` de `src/lib/resend.ts` ?
 *  - `sendEmail` lit `import.meta.env.RESEND_FROM_EMAIL` et `ADMIN_EMAIL` (BCC
 *    auto-admin) au runtime — `import.meta.env` est undefined dans le runtime
 *    cron, donc l'appel planterait.
 *  - Le sweep instancie son propre client Resend depuis `process.env` et applique
 *    une politique de retry simplifiée (pas de retry intra-row : le sweep s'appuie
 *    sur sa propre cadence horaire pour ré-essayer les rows échoués).
 *
 * Le threadKey est reçu via `params.threadKey` et transmis comme en-tête
 * `X-Thread-Key` à Resend (parité de contrat avec le webhook). La persistance
 * `email_threads` (supabase) reste webhook-only : le sweep ne crée pas de
 * racine de thread — il s'appuie sur le thread existant créé par le webhook
 * (cas normal) ou émet l'email sans fil (cas rare d'un sweep avant webhook).
 *
 * `idempotencyKey` est transmis via l'en-tête Resend `Idempotency-Key` : deux
 * tentatives concurrentes (webhook + sweep) avec la même clé ne produisent
 * qu'un seul email côté Resend (dedup serveur, ~24h TTL).
 *
 * Retourne `{ sendFn, lastError }` : `lastError` est mis à jour à chaque appel
 * sendFn (récupère l'objet error brut de Resend avec statusCode/name pour la
 * classification poison vs retryable).
 */
function makeSendFnWithCapture(resend: Resend, fromEmail: string) {
  const state: { lastError: ResendApiError | null; lastTo: string[] } = {
    lastError: null,
    lastTo: [],
  };
  const sendFn = async (params: SendEmailParams): Promise<SendEmailResult> => {
    const { to, bcc, subject, react, replyTo, threadKey, idempotencyKey } = params;
    state.lastTo = Array.isArray(to) ? to : [to];
    state.lastError = null;
    // `react` est un ReactElement (React Email) — Resend l'accepte directement
    // via son SDK (il appelle @react-email/render en interne).
    const { data, error } = await resend.emails.send(
      {
        from: fromEmail,
        to: state.lastTo,
        ...(bcc ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
        subject,
        react,
        ...(replyTo ? { replyTo } : {}),
        ...(threadKey ? { headers: { 'X-Thread-Key': threadKey } } : {}),
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (error) {
      state.lastError = error as ResendApiError;
      return { success: false, error: (error as ResendApiError).message ?? 'Erreur Resend' };
    }
    return { success: true, id: data?.id };
  };
  return { sendFn, state };
}

// ---------------------------------------------------------------------------
// Per-row processing
// ---------------------------------------------------------------------------

interface SendOutcome {
  patientEmailSent: boolean;
  /** Present when the patient send returned a non-retryable (permanent) error. */
  permanentError?: ResendApiError;
}

/**
 * Envoie les emails de confirmation (patient + thérapeute) pour un RDV via le
 * module partagé `notifications.ts`. Le client Resend est injecté via `sendFn`.
 *
 * Retourne `{ patientEmailSent }` + l'erreur classifiée en cas d'échec permanent
 * (poison message) pour que l'appelant applique l'échappatoire.
 *
 * NOTE : `buildAndSendConfirmationEmails` ne distingue pas permanent vs retryable
 * (elle retourne juste `{ patientEmailSent: false }`). Pour conserver la logique
 * poison-escape du sweep (marquer livré pour stopper les retries sur une 4xx
 * validation), on récupère l'erreur brute Resend via `state.lastError` et on la
 * classifie via `isRetryableResendError` (partagé avec `src/lib/resend.ts`).
 *
 * Heuristique pour distinguer patient vs thérapeute : `state.lastTo` contient le
 * destinataire du dernier sendFn appelé en échec. `notifications.ts` appelle le
 * patient en 1er, puis le thérapeute — donc si lastTo contient appt.patient_email,
 * l'échec est sur le patient. Si lastTo contient adminEmail, c'est le thérapeute
 * (qui est best-effort, donc ignoré par la classification poison).
 */
async function sendConfirmationEmails(
  appt: Appointment,
  ctx: {
    sendBundle: ReturnType<typeof makeSendFnWithCapture>;
    adminEmail?: string;
    baseUrl: string;
    authSecret: string;
  },
): Promise<SendOutcome> {
  const result = await buildAndSendConfirmationEmails(appt, {
    sendFn: ctx.sendBundle.sendFn,
    adminEmail: ctx.adminEmail,
    baseUrl: ctx.baseUrl,
    signingSecret: ctx.authSecret,
  });

  if (!result.patientEmailSent) {
    const lastError = ctx.sendBundle.state.lastError;
    const lastToWasPatient = ctx.sendBundle.state.lastTo.includes(appt.patient_email);
    if (lastError && lastToWasPatient && !isRetryableResendError(lastError)) {
      return { patientEmailSent: false, permanentError: lastError };
    }
  }
  return { patientEmailSent: result.patientEmailSent };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handler body. Wrapped by Sentry.withMonitor on export so missed executions
 * surface as a Sentry monitor alert (Netlify's scheduler has no native
 * alerting). The shared SCHEDULE const guarantees the monitor's expected
 * cadence matches Netlify's actual trigger.
 */
async function runReconcile(): Promise<void> {
  initSentry();
  try {
    await reconcile();
  } catch (err) {
    // Flush avant le retour : Lambda/Netlify gèle l'environnement d'exécution
    // au retour, ce qui abandonnerait tout événement Sentry in-flight.
    await captureAndFlush(err);
    throw err;
  } finally {
    if (process.env.PUBLIC_SENTRY_DSN) {
      await Sentry.flush(2000);
    }
  }
}

// Sentry.withMonitor enveloppe le handler : une exécution manquée (pas de
// check-in dans `checkInMargin` minutes du schedule) lève une alerte Sentry.
// checkInMargin et maxRuntime sont en minutes.
export default Sentry.withMonitor(
  'reconcile-confirmations',
  runReconcile,
  {
    schedule: { type: 'crontab', value: SCHEDULE },
    checkInMargin: 5,
    maxRuntime: 10,
  },
);

async function reconcile(): Promise<void> {
  const startedAt = Date.now();

  // 1. Read + validate required env vars (fail fast with a clear log).
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? 'OMF Thérapie <contact@omf-therapie.fr>';
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || undefined;
  const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.SITE_URL ?? 'https://omf-therapie.fr';
  const authSecret = process.env.BETTER_AUTH_SECRET;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    logger.error('reconcile: SUPABASE_DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — aborting');
    return;
  }
  if (!resendApiKey) {
    logger.error('reconcile: RESEND_API_KEY missing — aborting');
    return;
  }
  if (!authSecret || authSecret.trim().length < 32) {
    logger.error('reconcile: BETTER_AUTH_SECRET missing or too short — aborting');
    return;
  }

  // 2. Instantiate clients from process.env (NOT import.meta.env).
  //    Service-role key is required: the sweep writes confirmation_sent_at.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient<any>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  const resend = new Resend(resendApiKey);
  const sendBundle = makeSendFnWithCapture(resend, fromEmail);

  // 3. Query stale rows — payment_received, confirmation pending, within the
  //    14-day window, soonest-first. LIMIT bounds the batch.
  //    Filtre `deleted_at IS NULL` (issue #68) : un RDV soft-supprimé ne doit
  //    pas être re-emailé — mirage du pattern send-reminders.ts:126.
  const { data: rows, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'payment_received')
    .is('confirmation_sent_at', null)
    .is('deleted_at', null)
    .gt('created_at', new Date(Date.now() - CREATED_WITHIN_DAYS * 86_400_000).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchError) {
    logger.error('reconcile: Supabase query failed', {}, fetchError);
    return;
  }

  const allRows = (rows ?? []) as Appointment[];

  // Post-filtre vidéo (issue #68) : le sweep est email-only et ne crée pas
  // l'événement calendrier. Un RDV vidéo sans video_link signifie que le webhook
  // n'a pas encore créé le Meet — le sweep ne doit pas envoyer un email de
  // confirmation sans lien de connexion. Les rows ignorées restent
  // confirmation_sent_at=NULL et seront rattrapées au prochain sweep une fois
  // le video_link persisté par le webhook.
  const skippedNoVideo: string[] = [];
  const appointments = allRows.filter((appt) => {
    if (appt.appointment_mode === 'video' && !appt.video_link) {
      skippedNoVideo.push(appt.id);
      return false;
    }
    return true;
  });
  const counts = {
    found: appointments.length,
    sent: 0,
    failed: 0,
    deadlineHit: false,
    skippedNoVideo: skippedNoVideo.length,
  };

  if (appointments.length === 0) {
    if (skippedNoVideo.length > 0) {
      // Log sans PII : appointment IDs seulement (pas d'emails).
      logger.warn('reconcile: skipped video appointments without video_link', {
        count: skippedNoVideo.length,
        appointmentIds: skippedNoVideo,
      });
    }
    logger.info('reconcile: done (empty batch)', { ...counts, msElapsed: Date.now() - startedAt });
    return;
  }

  // 4. Process each row with per-row error isolation + deadline guard.
  for (const appt of appointments) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      counts.deadlineHit = true;
      break;
    }

    try {
      const outcome = await sendConfirmationEmails(appt, {
        sendBundle,
        adminEmail,
        baseUrl,
        authSecret,
      });

      if (outcome.patientEmailSent) {
        // Success → mark delivered. The IS NULL guard prevents a write race
        // with a concurrent webhook retry that may have set it first.
        const { error: updateError } = await supabase
          .from('appointments')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', appt.id)
          .is('confirmation_sent_at', null);

        if (updateError) {
          // Email envoyé mais drapeau non persisté → le prochain sweep renverra
          // (L1 dédup côté Resend absorbera le doublon si dans les 24h).
          logger.error('reconcile: failed to mark delivered (email was sent)', { appointmentId: appt.id }, updateError);
        }
        counts.sent += 1;
      } else if (outcome.permanentError) {
        // Permanent 4xx (validation, e.g. undeliverable address) → poison escape.
        // Mark delivered to stop retrying; log at error so it surfaces in Sentry.
        // PII: on ne log PAS patient_email (scrub Sentry le retirerait de toute
        // façon, mais on garde aussi le drain Netlify propre).
        logger.error(
          'reconcile: poison row — permanent Resend error, escaping retry loop',
          { appointmentId: appt.id },
          outcome.permanentError,
        );
        const { error: escapeError } = await supabase
          .from('appointments')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', appt.id)
          .is('confirmation_sent_at', null);
        if (escapeError) {
          logger.error('reconcile: poison-escape UPDATE failed', { appointmentId: appt.id }, escapeError);
        }
        counts.failed += 1;
      } else {
        // Retryable failure (5xx, 429, network) → leave confirmation_sent_at NULL;
        // the next hourly sweep retries. L1 dedupes any partial send.
        logger.warn('reconcile: retryable failure; will retry next sweep', { appointmentId: appt.id });
        counts.failed += 1;
      }
    } catch (err: unknown) {
      // Unexpected exception — isolate to this row, continue the batch.
      logger.error('reconcile: unexpected error for row', { appointmentId: appt.id }, err);
      counts.failed += 1;
    }
  }

  // 5. Structured summary for Netlify's log drain + Sentry breadcrumb.
  logger.info('reconcile: done', { ...counts, msElapsed: Date.now() - startedAt });
}
