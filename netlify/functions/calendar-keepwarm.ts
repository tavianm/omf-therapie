/**
 * Netlify Scheduled Function — calendar-keepwarm
 *
 * Runs every 10 minutes to keep the Google OAuth access token warm: when less
 * than 15 minutes of validity remain, the token is refreshed proactively and
 * the rotation persisted. The patient-facing availability path never pays the
 * OAuth refresh latency on a cold request — it always finds a token with a
 * comfortable validity window.
 *
 * Supersedes calendar-token-heartbeat.ts (weekly refresh against Google's
 * ~6-month idle revocation): a 10-minute cadence keeps the token continuously
 * fresh, which covers the inactivity concern a fortiori. The heartbeat file is
 * retired by a follow-up task of issue #132.
 *
 * V1 scope (issue #132 / T2): token keep-warm only. T6 will add the
 * availability-cache warm-up step — see the seam marker at the end of
 * keepwarm().
 *
 * Schedule: every 10 minutes (UTC). The crontab is a plain 5-field expression
 * (minute step 10) so Sentry.withMonitor's MonitorSchedule type accepts it, and
 * the const is shared between Netlify config and the Sentry monitor.
 *
 * NOTE: never write the crontab literal inside a block comment — its leading
 * star-slash sequence terminates the JSDoc early and breaks the parser.
 *
 * Observabilité : enveloppé par Sentry.withMonitor (détection de non-exécution).
 *
 * ⚠️  Runtime: Node.js (Netlify Functions) — import.meta.env is NOT available.
 *     All env vars are read via process.env.
 *
 * ⚠️  Dependencies — all already present in package.json:
 *   "googleapis"           ✓
 *   "@supabase/supabase-js" ✓
 *   "@netlify/functions"   ✓ (devDependencies)
 *   "react"                ✓
 *   "@react-email/render"  ✓
 *   "resend"               ✓
 *
 * Env vars required (configure in Netlify dashboard):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   SUPABASE_DATABASE_URL    — Supabase REST URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key
 *   ADMIN_EMAIL              — alert recipient on invalid_grant
 *   RESEND_API_KEY           — for alert emails
 *   GOOGLE_CALENDAR_ID       — consumed by T6's availability warm-up, NOT by
 *                              the V1 token step: missing → warn + continue
 *                              (T6 skips the warm-up; no Sentry error spam)
 *   GOOGLE_OAUTH_REDIRECT_URI (optional, fallback: https://developers.google.com/oauthplayground)
 *   SITE_URL                  (optional, fallback: https://omf-therapie.fr)
 *   RESEND_FROM_EMAIL         (optional, fallback: OMF Thérapie <contact@omf-therapie.fr>)
 *   PUBLIC_SENTRY_DSN         (optional — Sentry instrumentation)
 */

import type { Config } from '@netlify/functions';
import * as Sentry from '@sentry/node';
import { createElement } from 'react';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import ws from 'ws';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import CalendarAuthAlert from '../../src/emails/CalendarAuthAlert.js';
import { initSentry, captureAndFlush } from './_lib/sentry';
import { logger } from './_lib/logger';

// ---------------------------------------------------------------------------
// Schedule config
// ---------------------------------------------------------------------------

/** Every 10 minutes. Explicit crontab — see file header. */
const SCHEDULE = '*/10 * * * *' as const;

export const config: Config = {
  // ⚠️ NE PAS remplacer par la const SCHEDULE ci-dessus — l'extracteur statique
  // de Netlify (@netlify/zip-it-and-ship-it, parsePrimitive) ne résout QUE les
  // littéraux (StringLiteral), pas les Identifier. `schedule: SCHEDULE` produit
  // `schedule: null` côté Netlify → le scheduler ne déclenche plus (regression
  // #113 introduite par #75). Le littéral DOIT rester inline ici ; le dupliquer
  // avec SCHEDULE est volontaire (DRY brisée par contrainte du bundler).
  schedule: '*/10 * * * *',
  // No schedule_timezone → Netlify defaults to UTC (matches Sentry monitor default).
};

// ---------------------------------------------------------------------------
// Refresh threshold — pure decision, exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Refresh when less than 15 minutes of validity remain: one full cron period
 * (10 min) plus margin, so the next run always finds a usable token even if
 * this run's refresh fails.
 */
const REFRESH_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Pure predicate — no I/O when `nowMs` is injected (defaults to Date.now() so
 * expiry-only calls work; inject `nowMs` for deterministic unit tests).
 *
 * Semantics:
 *   - expiryDateMs null  → true  (unknown validity — refresh defensively)
 *   - expiry in the past → true  (expired)
 *   - remaining validity < thresholdMs → true
 *   - exactly at threshold → false (strict `<`, not `<=`)
 */
export function shouldRefreshToken(
  expiryDateMs: number | null,
  nowMs: number = Date.now(),
  thresholdMs: number = REFRESH_THRESHOLD_MS,
): boolean {
  if (expiryDateMs === null) return true;
  return expiryDateMs - nowMs < thresholdMs;
}

// ---------------------------------------------------------------------------
// Helper — send alert email on invalid_grant
// ---------------------------------------------------------------------------

async function sendInvalidGrantAlert(
  adminEmail: string,
  siteUrl: string,
  resendApiKey: string,
  fromEmail: string,
): Promise<void> {
  const reauthorizeUrl = `${siteUrl}/api/admin/google-oauth`;

  try {
    const resend = new Resend(resendApiKey);
    const html = await render(
      createElement(CalendarAuthAlert, { reauthorizeUrl }),
    );
    const { error } = await resend.emails.send({
      from:    fromEmail,
      to:      [adminEmail],
      subject: '⚠️ Google Calendar — re-autorisation requise',
      html,
    });
    if (error) {
      logger.error('calendar-keepwarm: alert email failed (Resend error)', { adminEmail }, error);
    } else {
      logger.info('calendar-keepwarm: alert email sent', { adminEmail });
    }
  } catch (err: unknown) {
    logger.error('calendar-keepwarm: alert email threw', { adminEmail }, err);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Sentry.withMonitor wraps the work so missed runs raise a Sentry alert.
//
// CRITICAL: `withMonitor(slug, callback, opts)` returns `T` (the callback's
// return value), NOT a function. Exporting it directly breaks Netlify's
// bootstrap (`handler is not a function` TypeError silently fails every run).
// Wrap it in a real handler function Netlify can invoke.
//
// CRITICAL #2 (regression #113): `initSentry()` MUST run BEFORE
// `Sentry.withMonitor()`. `withMonitor` emits an `in_progress` check-in at
// entry, and THAT check-in is the only one carrying the `monitor_config`
// (with `checkInMargin`). If the client isn't initialized yet, the envelope
// is dropped → Sentry never receives the margin → `checkin_margin: null` →
// missed-run detection uses the (tighter) default. initSentry() is idempotent
// (guarded by `initialized`) so calling it here makes the call inside
// runKeepwarm() below a harmless no-op.
async function handler(): Promise<void> {
  initSentry();
  return Sentry.withMonitor(
    'calendar-keepwarm',
    runKeepwarm,
    {
      schedule: { type: 'crontab', value: SCHEDULE },
      checkInMargin: 2,
      maxRuntime: 5,
    },
  );
}

async function runKeepwarm(): Promise<void> {
  // initSentry() now runs in handler() BEFORE withMonitor — see comment above.
  try {
    await keepwarm();
  } catch (err) {
    await captureAndFlush(err);
    throw err;
  } finally {
    if (process.env.PUBLIC_SENTRY_DSN) {
      await Sentry.flush(2000);
    }
  }
}

export default handler;

async function keepwarm(): Promise<void> {
  // 1. Read and validate env vars.
  //    ADMIN_EMAIL/RESEND_API_KEY are required: the invalid_grant alert is
  //    part of this cron's contract, and skipping the run when the channel is
  //    unconfigured surfaces the misconfig in logs instead of silently losing
  //    re-authorization alerts.
  //    GOOGLE_CALENDAR_ID is NOT required by the V1 token step — see the
  //    dedicated warn-only check below the guards.
  const clientId      = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret  = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const calendarId    = process.env.GOOGLE_CALENDAR_ID;
  const supabaseUrl   = process.env.SUPABASE_DATABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail    = process.env.ADMIN_EMAIL;
  const resendApiKey  = process.env.RESEND_API_KEY;
  // Optional, with fallbacks — mirror heartbeat's defaults.
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'https://developers.google.com/oauthplayground';
  const siteUrl     = process.env.SITE_URL ?? 'https://omf-therapie.fr';
  const fromEmail   = process.env.RESEND_FROM_EMAIL ?? 'OMF Thérapie <contact@omf-therapie.fr>';
  // PUBLIC_SENTRY_DSN is optional and consumed by initSentry()/logger directly.

  if (!clientId || !clientSecret) {
    logger.warn('calendar-keepwarm: GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET missing — skipping');
    return;
  }

  if (!supabaseUrl || !serviceRoleKey) {
    logger.warn('calendar-keepwarm: SUPABASE_DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — skipping');
    return;
  }

  if (!adminEmail || !resendApiKey) {
    logger.warn('calendar-keepwarm: ADMIN_EMAIL or RESEND_API_KEY missing — skipping');
    return;
  }

  // GOOGLE_CALENDAR_ID is read by T6's availability warm-up (seam at the end
  // of keepwarm), not by the token step. Warn on a missing value — a warn is
  // one log line + Sentry breadcrumb per run, NOT a captured error, so a
  // 10-minute cadence can't spam exception alerts — then CONTINUE: the token
  // keep-warm has no reason to stop. T6 must skip the warm-up (not the token
  // step) while this is unset.
  if (!calendarId) {
    logger.warn('calendar-keepwarm: GOOGLE_CALENDAR_ID missing — token keep-warm continues; T6 availability warm-up will be skipped');
  }

  // 2. Initialise clients
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // 3. Load persisted token from DB
  const { data: tokens, error: fetchError } = await supabase
    .from('google_oauth_tokens')
    .select('refresh_token, access_token, expiry_date')
    .eq('id', 'therapist')
    .single();

  if (fetchError || !tokens) {
    logger.warn('calendar-keepwarm: no token row in DB — nothing to keep warm. Connect Google Calendar first.', { fetchError });
    return;
  }

  if (!tokens.refresh_token) {
    logger.error('calendar-keepwarm: token row exists but refresh_token is null — re-authorization required');
    await sendInvalidGrantAlert(adminEmail, siteUrl, resendApiKey, fromEmail);
    return;
  }

  // 4. Token keep-warm — refresh only when the validity window runs short
  if (shouldRefreshToken(tokens.expiry_date ?? null, Date.now())) {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      const updated = {
        access_token:  credentials.access_token ?? '',
        // Persist rotated refresh_token if Google returns one (token rotation policy)
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date:   credentials.expiry_date ?? (Date.now() + 3600 * 1000),
        updated_at:    new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from('google_oauth_tokens')
        .update(updated)
        .eq('id', 'therapist');

      if (updateError) {
        logger.error('calendar-keepwarm: failed to persist refreshed token', {}, updateError);
        return;
      }

      logger.info('calendar-keepwarm: token refreshed successfully');
    } catch (err: unknown) {
      // 5a. invalid_grant → token revoked, alert admin
      const errData = (err as { response?: { data?: { error?: string } } })?.response?.data;
      if (errData?.error === 'invalid_grant') {
        logger.error('calendar-keepwarm: invalid_grant — token revoked, sending alert to admin');
        await sendInvalidGrantAlert(adminEmail, siteUrl, resendApiKey, fromEmail);
        // Capture a sanitized error only — NEVER the raw GaxiosError: its
        // response/config payloads may embed client_secret / refresh_token.
        Sentry.captureException(new Error('Google OAuth token refresh failed: invalid_grant'));
        return;
      }

      // 5b. Other errors — log and exit cleanly (don't throw; a 10-minute cron
      // shouldn't fail noisily, the next run retries anyway)
      logger.error('calendar-keepwarm: token refresh failed', {}, err);
      return;
    }
  } else {
    // Token still valid (≥ 15 min remaining) — skip the refresh this run.
    logger.info('calendar-keepwarm: token still valid — refresh skipped', {
      remainingMs: tokens.expiry_date - Date.now(),
    });
  }

  // ---------------------------------------------------------------------------
  // T6 SEAM — availability-cache warm-up (issue #132, NOT in V1 scope)
  // ---------------------------------------------------------------------------
  // Reaching this point means the token step is healthy: either the token was
  // still valid, or the refresh succeeded and was persisted. T6 inserts the
  // warm-up step here (import from '../../src/lib/calendar-cache.js', call
  // e.g. warmAvailabilityCache() with the calendarId read above).
  //
  // Placement contract: every auth-failure path (missing refresh_token,
  // invalid_grant, failed refresh) returns BEFORE this marker — that is what
  // guarantees the warm-up is skipped when Google auth is broken. T6 must
  // additionally skip the warm-up (never the token step) when calendarId is
  // unset — see the warn-only env check at the top of keepwarm(). Any new
  // early-return must stay ABOVE this seam.
}
