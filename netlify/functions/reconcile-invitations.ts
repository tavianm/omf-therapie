/**
 * Netlify Scheduled Function — Reconciliation sweep for invitation side effects.
 *
 * Issue #126 (slice 3, T13): hourly backstop for the post-response pipeline
 * (`processAppointmentSideEffects`, run via `waitUntil` in the admin POST).
 * Catches `appointments` rows in a post-answer status whose invitation email
 * flag (`invitation_sent_at`) is still NULL — i.e. the waitUntil pipeline
 * failed, was killed by the function timeout, or was interrupted by a deploy.
 *
 * Strategy: DELEGATION (not duplication). Each eligible row is claimed
 * atomically (W2 — `claimInvitationProcessing`, 10 min lease on
 * `invitation_claimed_at`, see 014_invitation_claim_at.sql) then re-run
 * through the shared pipeline `src/lib/notifications.ts` with the shared
 * adapter `_lib/send-fn` (delegates to `sendEmail`, captures `rawError` for
 * the poison escape — patterns #98/#129). The pipeline sets the L2 flags
 * itself on success; the sweep only intervenes on PERMANENT (non-retryable)
 * Resend errors to escape the retry loop (set-once flag update).
 *
 * Runtime constraint: this cron runs in plain Node (`import.meta.env` is
 * absent). Possible only thanks to the lazy-init refactors of `stripe.ts`
 * (T11), `google-calendar.ts` (T12), `resend.ts` (#98) and the env-agnostic
 * `supabase.ts`. NEVER read `import.meta.env` here.
 *
 * ---------------------------------------------------------------------------
 * Observability — Sentry.withMonitor (patterns #75/#99/#113).
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Required env vars (configure in Netlify dashboard — NEVER inline secrets):
 *   SUPABASE_DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY — Supabase access
 *   RESEND_API_KEY / RESEND_FROM_EMAIL                 — invitation emails
 *   GOOGLE_CALENDAR_MOCK (optional)                    — 'true' = no-op calendar
 *   PUBLIC_SENTRY_DSN (optional)                       — Sentry instrumentation
 */

import type { Config } from '@netlify/functions';
import * as Sentry from '@sentry/node';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import type { Appointment } from '../../src/types/appointment';
import { isRetryableResendError } from '../../src/lib/resend-errors';
import {
  claimInvitationProcessing,
  processAppointmentSideEffects,
  type ProcessSideEffectsOptions,
} from '../../src/lib/notifications';
import { createCalendarEvent } from '../../src/lib/google-calendar';
import { scrubPii, shouldDropEvent, captureAndFlush } from './_lib/sentry';
import { BUILD_CONTEXT } from './_lib/build-env';
import { logger } from './_lib/logger';
import { makeSendFnWithCapture } from './_lib/send-fn';

/**
 * Sentry init PER-INVOCATION (not the `initialized`-guarded `_lib/sentry`
 * version). Rationale: the withMonitor `in_progress` check-in — the only one
 * carrying monitor_config (#113) — requires an initialized client at every
 * invocation. In a warm container the shared cross-invocation guard would be
 * a no-op optimization, but re-initializing is cheap and guarantees the
 * monitor config is never dropped. Reuses the shared PII scrubber + noise
 * filter (parity with the other crons).
 */
function initSentry(): void {
  const dsn = process.env.PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: BUILD_CONTEXT === 'production' ? 'production' : 'staging',
    beforeSend: event => (shouldDropEvent(event) ? null : scrubPii(event)),
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wall-clock budget per invocation (30s Netlify hard timeout, wide margin). */
const DEADLINE_MS = 8500;

/**
 * Reconcile scope: appointments created within this window are eligible.
 *
 * W3 review fix: bounded to the ~24h TTL of the Resend L1 idempotency key
 * (`invite:{id}:patient`). Beyond that window a replayed pass would no longer
 * be deduplicated by Resend and could RE-SEND the invitation (the exact
 * scenario is: email delivered + flag write failed → row still selectable on
 * a later pass). Past 24h, either the email was delivered (case covered) or
 * it is in chronic failure, visible in the logs.
 */
const CREATED_WITHIN_HOURS = 24;

/** Max rows processed per invocation (bounds work + respects the deadline). */
const BATCH_LIMIT = 25;

/** Schedule partagée entre la config Netlify et le monitor Sentry. */
const SCHEDULE = '20 * * * *' as const;

export const config: Config = {
  /**
   * Chaque heure à H:20 (décalé du sweep #98 à H:05 pour éviter la contention).
   *
   * ⚠️  NE PAS remplacer par la const SCHEDULE ci-dessus — l'extracteur statique
   * de Netlify ne résout QUE les littéraux (régression #113/#114). Le littéral
   * DOIT rester inline ici ; la synchronisation SCHEDULE ↔ littéral est
   * verrouillée par tests.
   */
  schedule: '20 * * * *',
  // No schedule_timezone → Netlify defaults to UTC (matches Sentry monitor).
};

// ---------------------------------------------------------------------------
// Calendar DI — no-op when GOOGLE_CALENDAR_MOCK=true (dev-only skip)
// ---------------------------------------------------------------------------

type CalendarFn = NonNullable<ProcessSideEffectsOptions['createCalendarEvent']>;

/** No-op calendar fn injected when GOOGLE_CALENDAR_MOCK=true (warns once). */
function makeNoopCalendarEvent(): CalendarFn {
  let warned = false;
  return async () => {
    if (!warned) {
      warned = true;
      console.warn(
        '[reconcile-invitations] GOOGLE_CALENDAR_MOCK=true — calendar step skipped (no-op)',
      );
    }
    // W4 : AUCUN eventId exploitable — S1 (processAppointmentSideEffects)
    // traite ce résultat comme un skip SANS persistance. Un faux id
    // `calendar-mock-*` persisté ferait croire aux passages suivants que
    // l'événement Google existe déjà et verrouillerait le skip S1 à tort.
    return { eventId: null, meetLink: undefined };
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function runReconcile(): Promise<void> {
  try {
    await reconcile();
  } catch (err) {
    await captureAndFlush(err);
    throw err;
  } finally {
    if (process.env.PUBLIC_SENTRY_DSN) {
      await Sentry.flush(2000);
    }
  }
}

// CRITIQUE (#75) : withMonitor retourne T, pas une fonction — on l'enveloppe
// dans une vraie fonction handler invoquable par le bootstrap Netlify.
// CRITIQUE (#113) : initSentry() DOIT précéder withMonitor (check-in
// in_progress porteur du monitor_config).
async function handler(): Promise<void> {
  initSentry();
  return Sentry.withMonitor('reconcile-invitations', runReconcile, {
    schedule: { type: 'crontab', value: SCHEDULE },
    checkInMargin: 5,
    maxRuntime: 10,
  });
}

export default handler;

async function reconcile(): Promise<void> {
  const startedAt = Date.now();

  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  // C2 : le jeton d'invitation .ics (email S3 des RDV confirmés/payés par
  // avoir) est signé HMAC — `import.meta.env` est absent ici, le secret DOIT
  // venir de process.env (parité reconcile-confirmations.ts).
  const authSecret = process.env.BETTER_AUTH_SECRET;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    logger.error(
      'reconcile-invitations: SUPABASE_DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — aborting',
    );
    return;
  }
  if (!resendApiKey) {
    logger.error('reconcile-invitations: RESEND_API_KEY missing — aborting');
    return;
  }
  if (!authSecret || authSecret.trim().length < 32) {
    logger.error(
      'reconcile-invitations: BETTER_AUTH_SECRET missing or too short — aborting',
    );
    return;
  }

  // Clients from process.env ONLY (import.meta.env is absent in the cron runtime).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient<any>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  // Envoi via l'adaptateur partagé `_lib/send-fn` : délègue à `sendEmail`
  // (lectures env gardées, BCC admin auto, idempotence, threads email) et
  // capture `rawError` pour la classification poison ci-dessous.
  const sendBundle = makeSendFnWithCapture();

  // Calendar DI: real module unless GOOGLE_CALENDAR_MOCK==='true' (default false).
  const isCalendarMock = process.env.GOOGLE_CALENDAR_MOCK === 'true';
  const calendarFn: CalendarFn = isCalendarMock
    ? makeNoopCalendarEvent()
    : createCalendarEvent;

  // Eligibility query (post-answer statuses, L2 flag still NULL, soft-delete
  // guard, 24h creation window — W3, bounded to the Resend L1 dedup TTL,
  // upcoming only, oldest first, bounded batch).
  // NOTE — écart assumé vs spec §5 : `payment_received` est inclus (en plus de
  // 'confirmed' et 'payment_pending') car un RDV payé par avoir (SC3) est
  // inséré directement à payment_received et son email d'invitation peut
  // tout aussi bien échouer.
  const { data: rows, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .in('status', ['confirmed', 'payment_pending', 'payment_received'])
    .is('invitation_sent_at', null)
    .is('deleted_at', null)
    .gt(
      'created_at',
      new Date(Date.now() - CREATED_WITHIN_HOURS * 3_600_000).toISOString(),
    )
    .gt('scheduled_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchError) {
    logger.error(
      'reconcile-invitations: Supabase query failed',
      {},
      fetchError,
    );
    return;
  }

  const appointments = (rows ?? []) as Appointment[];
  const counts = {
    found: appointments.length,
    reconciled: 0,
    failed: 0,
    claimed: 0,
    deadlineHit: false,
  };

  if (appointments.length === 0) {
    logger.info('reconcile-invitations: done (empty batch)', {
      ...counts,
      msElapsed: Date.now() - startedAt,
    });
    return;
  }

  for (const appt of appointments) {
    // Deadline guard — remaining rows drain on the next hourly pass.
    if (Date.now() - startedAt > DEADLINE_MS) {
      counts.deadlineHit = true;
      break;
    }

    // Per-row isolation: a throwing row never blocks the rest of the batch.
    try {
      // W2 — atomic claim (10 min lease) BEFORE delegating: if the admin POST
      // waitUntil pipeline (or another worker/pass) already owns this row, do
      // NOT run the pipeline — two concurrent pipelines would create duplicate
      // Google events and duplicate Stripe Payment Links. Neither reconciled
      // nor failed: counted as `claimed` (the owning worker owns the outcome).
      const claimed = await claimInvitationProcessing(supabase, appt.id);
      if (!claimed) {
        logger.info('reconcile-invitations: row already claimed — skipping', {
          appointmentId: appt.id,
        });
        counts.claimed += 1;
        continue;
      }

      sendBundle.state.lastError = null;

      await processAppointmentSideEffects(appt, {
        sendEmail: true,
        // C3 : solde dû = prix final − avoir déjà consommé. Sans cette
        // déduction, un RDV payment_pending partiellement couvert par un
        // avoir était re-facturé à plein tarif par le sweep (surfacturation).
        // payment_received est déjà réglé → 0 (aucune re-facturation).
        amountDueCents:
          appt.status === 'payment_received'
            ? 0
            : Math.max(0, (appt.final_price ?? 0) - (appt.credit_applied ?? 0)),
        createCalendarEvent: calendarFn,
        sendFn: sendBundle.sendFn,
        // C2 : secret HMAC explicite — createSecureLinkToken ne peut pas lire
        // import.meta.env dans ce runtime Node.
        signingSecret: authSecret,
        // The pipeline sets the L2 flags itself on success (set-once guard).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
      });

      const lastError = sendBundle.state.lastError;
      if (lastError && !isRetryableResendError(lastError)) {
        // Poison-escape: permanent 4xx on the patient email → the sweep itself
        // sets invitation_sent_at (set-once) to stop the hourly retry loop.
        // Log sans PII : appointment ID seulement, jamais patient_email.
        // Diagnostics explicites : `logger` stringifie un non-Error en
        // "[object Object]" — on passe la classification en fields + un
        // message synthétisé (champs de classification uniquement : le message
        // Resend brut peut citer l'adresse destinataire, RGPD).
        logger.error(
          'reconcile-invitations: poison row — permanent Resend error, escaping retry loop',
          {
            appointmentId: appt.id,
            resendName: lastError.name,
            resendStatus: lastError.statusCode,
          },
          new Error(
            `resend ${lastError.name ?? 'unknown'} ${lastError.statusCode ?? 'no-status'}`,
          ),
        );
        const { error: escapeError } = await supabase
          .from('appointments')
          .update({ invitation_sent_at: new Date().toISOString() })
          .eq('id', appt.id)
          .is('invitation_sent_at', null);
        if (escapeError) {
          logger.error(
            'reconcile-invitations: poison-escape UPDATE failed',
            { appointmentId: appt.id },
            escapeError,
          );
        }
        counts.failed += 1;
      } else if (lastError) {
        // Retryable (5xx, 429, network) → leave the flag NULL; next pass retries.
        logger.warn(
          'reconcile-invitations: retryable email failure; will retry next sweep',
          {
            appointmentId: appt.id,
          },
        );
        counts.failed += 1;
      } else {
        counts.reconciled += 1;
      }
    } catch (err: unknown) {
      logger.error(
        'reconcile-invitations: unexpected error for row',
        { appointmentId: appt.id },
        err,
      );
      counts.failed += 1;
    }
  }

  logger.info('reconcile-invitations: done', {
    ...counts,
    msElapsed: Date.now() - startedAt,
  });
}
