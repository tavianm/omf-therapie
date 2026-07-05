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
 *   - L1: Resend `idempotencyKey = confirm:{stripe_payment_intent_id}` (~24h TTL,
 *         server-side dedup) — concurrent in-flight sends with the webhook collapse
 *         to a single delivered email pair.
 *   - L2: `confirmation_sent_at` flag — set ONLY after the patient email succeeds,
 *         guarded by `WHERE confirmation_sent_at IS NULL` (write-race safety vs.
 *         a concurrent webhook retry). Never reset.
 *
 * ---------------------------------------------------------------------------
 * IMPORT DECISION — Path B (local replication), not Path A.
 * ---------------------------------------------------------------------------
 * `src/lib/notifications.ts#buildAndSendConfirmationEmails` is itself
 * env-agnostic (T4 ensured DI via `BuildAndSendOptions`), BUT it statically
 * imports `./resend`, which reads `import.meta.env.{SMTP_HOST,RESEND_API_KEY,...}`
 * at MODULE LOAD TIME (resend.ts:25,26,41), and `./secure-links`, which reads
 * `import.meta.env.BETTER_AUTH_SECRET` at runtime. `import.meta.env` is a
 * Vite/Astro build-time transform; in the Netlify Functions Node.js runtime it
 * is `undefined`, so those module-level reads throw `TypeError` at first import.
 *
 * This was verified empirically: bundling a probe that imports
 * `buildAndSendConfirmationEmails` via `@netlify/zip-it-and-ship-it` (the real
 * deploy-time bundler) leaves `import.meta.env.SUPABASE_DATABASE_URL` etc. raw
 * in the emitted bundle — the function would crash on cold start. `astro build`
 * does NOT validate this, because Astro only bundles its own SSR entry, not
 * `netlify/functions/*.ts`.
 *
 * The codebase has already made this call: both existing scheduled functions
 * (`send-reminders.ts:20-22`, `calendar-token-heartbeat.ts:9`) deliberately
 * avoid importing `src/lib/*` for exactly this reason and instantiate clients
 * from `process.env`. This function mirrors that established pattern.
 *
 * To honor spec SC18 ("no duplicated email logic") as far as is safe, the PURE
 * helpers are reused directly: `src/lib/ics.ts` (calendar-link builders),
 * `src/lib/pricing.ts` (labels), and the React email templates
 * (`AppointmentConfirmed`, `PaymentReceivedNotification`). Only the thin Resend
 * send call + the HMAC invite-token are re-implemented locally against
 * `process.env`, matching `send-reminders.ts`.
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
 */

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { createHmac } from 'node:crypto';
import ws from 'ws';
import AppointmentConfirmed from '../../src/emails/AppointmentConfirmed';
import PaymentReceivedNotification from '../../src/emails/PaymentReceivedNotification';
import {
  generateGoogleCalendarLink,
  generateOutlookCalendarLink,
  generateAppleCalendarInviteLink,
  CABINET_ADDRESS,
  type ICSEvent,
} from '../../src/lib/ics';
import { getTypeLabel, getModeLabel } from '../../src/lib/pricing';
import type { Appointment } from '../../src/types/appointment';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Wall-clock budget per invocation. Netlify Functions on the hobby tier enforce
 * a ~10s hard timeout; we leave a 1.5s margin for the final UPDATE + log flush.
 * When elapsed, the loop breaks and remaining rows drain on the next hourly run.
 */
const DEADLINE_MS = 8500;

/** Re-send scope: appointments created within this window are eligible. */
const CREATED_WITHIN_DAYS = 14;

/** Max rows processed per invocation (bounds work + respects the deadline). */
const BATCH_LIMIT = 25;

// ---------------------------------------------------------------------------
// Schedule config — hourly at :05 to dodge webhook contention on the hour
// ---------------------------------------------------------------------------

export const config: Config = {
  schedule: '5 * * * *',
};

// ---------------------------------------------------------------------------
// Local helpers (process.env equivalents of src/lib/* env-coupled code)
// ---------------------------------------------------------------------------

interface ResendApiError {
  name?: string;
  statusCode?: number | null;
  message?: string;
}

/**
 * Classifies a Resend error as retryable (5xx, network, application_error) vs.
 * permanent (4xx validation — poison message). Mirrors the predicate in
 * `src/lib/resend.ts#isRetryableResendError` so the sweep's notion of
 * "permanent" matches the webhook's send path exactly.
 */
function isRetryableResendError(error: ResendApiError | null | undefined): boolean {
  if (!error) return false;
  const status = error.statusCode ?? null;
  if (status === null || status >= 500) return true;
  // 429 (rate limit) is retryable despite being 4xx.
  if (status === 429) return true;
  return error.name === 'application_error';
}

/**
 * Builds the signed .ics invite token (HMAC-SHA256) using process.env.
 * Local replica of `src/lib/secure-links.ts#createSecureLinkToken` — that
 * module reads `import.meta.env.BETTER_AUTH_SECRET` and so is not importable
 * here. The output MUST be byte-identical to the app's signer so the
 * `/api/calendar/invite/:id` endpoint accepts the token.
 */
function createInviteToken(appointmentId: string, nonce: string, secret: string): string {
  const payload = {
    v: 1,
    p: 'ics-invite',
    aid: appointmentId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180, // 180 days
    n: nonce,
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadEncoded).digest('base64url');
  return `${payloadEncoded}.${signature}`;
}

/** Lifts the ICS event shape from notifications.ts#buildICSEvent (pure). */
function buildICSEvent(appt: Appointment): ICSEvent {
  const start = new Date(appt.scheduled_at);
  const end = new Date(start.getTime() + appt.duration * 60 * 1000);
  const typeLabel = getTypeLabel(appt.appointment_type);
  const modeLabel = getModeLabel(appt.appointment_mode);
  const videoLink = appt.video_link ?? undefined;
  return {
    uid: appt.id,
    summary: `Séance OMF Thérapie — ${typeLabel}`,
    description: `${typeLabel} (${modeLabel}) · ${appt.duration} min`,
    location: appt.appointment_mode === 'in-person' ? CABINET_ADDRESS : videoLink,
    url: videoLink,
    start,
    end,
    organizerName: 'Oriane Montabonnet — OMF Thérapie',
    organizerEmail: 'contact@omf-therapie.fr',
  };
}

interface SendOutcome {
  patientEmailSent: boolean;
  /** Present when the patient send returned a non-retryable (permanent) error. */
  permanentError?: ResendApiError;
}

/** Send-context bundle: clients + resolved env values for one invocation. */
interface SendContext {
  resend: Resend;
  fromEmail: string;
  adminEmail?: string;
  baseUrl: string;
  authSecret: string;
}

/**
 * Sends the patient + therapist confirmation emails for one appointment.
 * Local replica of `notifications.ts#buildAndSendConfirmationEmails` send path,
 * using a process.env-instantiated Resend client. Both emails carry the L1
 * idempotency key `confirm:{stripe_payment_intent_id}` so Resend dedupes vs.
 * any concurrent webhook attempt.
 *
 * Returns `{ patientEmailSent }` plus, on permanent patient failure, the
 * classified error so the caller can apply the poison-message escape.
 */
async function sendConfirmationEmails(appt: Appointment, ctx: SendContext): Promise<SendOutcome> {
  const idempotencyKey = appt.stripe_payment_intent_id
    ? `confirm:${appt.stripe_payment_intent_id}`
    : undefined;
  const videoLink = appt.video_link ?? undefined;
  const icsEvent = buildICSEvent(appt);
  const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
  const outlookCalendarLink = generateOutlookCalendarLink(icsEvent);

  // Patient email ----------------------------------------------------------
  const patientHtml = await render(
    createElement(AppointmentConfirmed, {
      patientName: appt.patient_name,
      appointmentType: appt.appointment_type,
      appointmentMode: appt.appointment_mode,
      scheduledAt: appt.scheduled_at,
      duration: appt.duration as 60 | 90,
      finalPrice: appt.final_price,
      videoLink,
      googleCalendarLink,
      appleCalendarLink: generateAppleCalendarInviteLink(
        ctx.baseUrl,
        appt.id,
        createInviteToken(appt.id, appt.scheduled_at, ctx.authSecret),
      ),
      outlookCalendarLink,
      cabinetAddress: undefined,
    }),
  );

  const { error: patientError } = await ctx.resend.emails.send(
    {
      from: ctx.fromEmail,
      to: [appt.patient_email],
      subject: `Votre rendez-vous est confirmé — ${new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Paris',
      }).format(new Date(appt.scheduled_at))}`,
      html: patientHtml,
    },
    idempotencyKey ? { idempotencyKey } : undefined,
  );

  if (patientError) {
    return {
      patientEmailSent: false,
      permanentError: isRetryableResendError(patientError as ResendApiError)
        ? undefined
        : (patientError as ResendApiError),
    };
  }

  // Therapist email — graceful skip if no admin email; never blocks the patient result.
  if (ctx.adminEmail) {
    try {
      const therapistHtml = await render(
        createElement(PaymentReceivedNotification, {
          patientName: appt.patient_name,
          patientEmail: appt.patient_email,
          appointmentType: appt.appointment_type,
          appointmentMode: appt.appointment_mode,
          scheduledAt: appt.scheduled_at,
          duration: appt.duration as 60 | 90,
          finalPrice: appt.final_price,
          videoLink,
          dashboardUrl: `${ctx.baseUrl}/mes-rdvs/`,
          calendarEventCreated: false, // sweep is email-only; calendar is webhook-only
        }),
      );
      await ctx.resend.emails.send(
        {
          from: ctx.fromEmail,
          to: [ctx.adminEmail],
          subject: `Prépaiement reçu — ${appt.patient_name}`,
          html: therapistHtml,
        },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
    } catch (err: unknown) {
      // Therapist notification is best-effort; don't fail the row over it.
      console.warn(
        `[reconcile] Therapist email failed for ${appt.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { patientEmailSent: true };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(): Promise<void> {
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
    console.error(
      '[reconcile] SUPABASE_DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — aborting.',
    );
    return;
  }
  if (!resendApiKey) {
    console.error('[reconcile] RESEND_API_KEY missing — aborting.');
    return;
  }
  if (!authSecret || authSecret.trim().length < 32) {
    console.error('[reconcile] BETTER_AUTH_SECRET missing or too short — aborting.');
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

  // 3. Query stale rows — payment_received, confirmation pending, within the
  //    14-day window, soonest-first. LIMIT bounds the batch.
  const { data: rows, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'payment_received')
    .is('confirmation_sent_at', null)
    .gt('created_at', new Date(Date.now() - CREATED_WITHIN_DAYS * 86_400_000).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchError) {
    console.error('[reconcile] Supabase query failed:', fetchError.message);
    return;
  }

  const appointments = (rows ?? []) as Appointment[];
  const counts = { found: appointments.length, sent: 0, failed: 0, deadlineHit: false };

  if (appointments.length === 0) {
    console.log(
      JSON.stringify({ ...counts, msElapsed: Date.now() - startedAt }),
    );
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
        resend,
        fromEmail,
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
          console.error(
            `[reconcile] Failed to mark ${appt.id} delivered (email was sent):`,
            updateError.message,
          );
          // Email sent but flag not set → next sweep re-attempts; L1 dedupes. Count as sent.
        }
        counts.sent += 1;
      } else if (outcome.permanentError) {
        // Permanent 4xx (validation, e.g. undeliverable address) → poison escape.
        // Mark delivered to stop retrying; log at error so it surfaces.
        console.error(
          `[reconcile] Poison row ${appt.id} (${appt.patient_email}): permanent Resend error — escaping retry loop.`,
          outcome.permanentError,
        );
        const { error: escapeError } = await supabase
          .from('appointments')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', appt.id)
          .is('confirmation_sent_at', null);
        if (escapeError) {
          console.error(`[reconcile] Poison-escape UPDATE failed for ${appt.id}:`, escapeError.message);
        }
        counts.failed += 1;
      } else {
        // Retryable failure (5xx, 429, network) → leave confirmation_sent_at NULL;
        // the next hourly sweep retries. L1 dedupes any partial send.
        console.warn(
          `[reconcile] Retryable failure for ${appt.id} (${appt.patient_email}); will retry next sweep.`,
        );
        counts.failed += 1;
      }
    } catch (err: unknown) {
      // Unexpected exception — isolate to this row, continue the batch.
      console.error(
        `[reconcile] Unexpected error for ${appt.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      counts.failed += 1;
    }
  }

  // 5. Structured summary for Netlify's log drain.
  console.log(
    JSON.stringify({ ...counts, msElapsed: Date.now() - startedAt }),
  );
}
