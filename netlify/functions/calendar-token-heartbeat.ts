/**
 * Netlify Scheduled Function — calendar-token-heartbeat
 *
 * Runs weekly to proactively refresh the Google OAuth access token, preventing
 * Google from revoking it due to inactivity (~6 months idle = automatic revocation).
 *
 * Schedule: @weekly (every Sunday at 00:00 UTC)
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
 *   SUPABASE_DATABASE_URL     — Supabase REST URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REDIRECT_URI (optional, fallback: https://developers.google.com/oauthplayground)
 *   ADMIN_EMAIL               — alert recipient on invalid_grant
 *   SITE_URL                  (optional, fallback: https://omf-therapie.fr)
 *   RESEND_API_KEY            — for alert emails
 *   RESEND_FROM_EMAIL         (optional, fallback: OMF Thérapie <contact@omf-therapie.fr>)
 */

import type { Config } from '@netlify/functions';
import { createElement } from 'react';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import CalendarAuthAlert from '../../src/emails/CalendarAuthAlert.js';

// ---------------------------------------------------------------------------
// Schedule config
// ---------------------------------------------------------------------------

export const config: Config = {
  schedule: '@weekly',
};

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
      console.error('[calendar-heartbeat] Alert email failed (Resend error):', error);
    } else {
      console.info('[calendar-heartbeat] Alert email sent to', adminEmail);
    }
  } catch (err: unknown) {
    console.error(
      '[calendar-heartbeat] Alert email exception:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(): Promise<void> {
  // 1. Read and validate required env vars
  const clientId    = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'https://developers.google.com/oauthplayground';
  const supabaseUrl  = process.env.SUPABASE_DATABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail   = process.env.ADMIN_EMAIL;
  const siteUrl      = process.env.SITE_URL ?? 'https://omf-therapie.fr';
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail    = process.env.RESEND_FROM_EMAIL ?? 'OMF Thérapie <contact@omf-therapie.fr>';

  if (!clientId || !clientSecret) {
    console.warn('[calendar-heartbeat] GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET missing — skipping.');
    return;
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[calendar-heartbeat] SUPABASE_DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — skipping.');
    return;
  }

  // 2. Initialise clients
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // 3. Load persisted token from DB
  const { data: tokens, error: fetchError } = await supabase
    .from('google_oauth_tokens')
    .select('refresh_token, access_token, expiry_date')
    .eq('id', 'therapist')
    .single();

  if (fetchError || !tokens) {
    console.warn('[calendar-heartbeat] No token row found in DB — nothing to refresh. Connect Google Calendar first.');
    return;
  }

  if (!tokens.refresh_token) {
    console.warn('[calendar-heartbeat] Token row exists but refresh_token is null — re-authorization required.');
    return;
  }

  // 4. Attempt proactive token refresh
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
      console.error('[calendar-heartbeat] Failed to persist refreshed token:', updateError.message);
      return;
    }

    console.info('[calendar-heartbeat] Token refreshed successfully');
  } catch (err: unknown) {
    // 5a. invalid_grant → token revoked, alert admin
    const errData = (err as { response?: { data?: { error?: string } } })?.response?.data;
    if (errData?.error === 'invalid_grant') {
      console.error('[calendar-heartbeat] invalid_grant — token revoked. Sending alert to admin.');
      if (adminEmail && resendApiKey) {
        await sendInvalidGrantAlert(adminEmail, siteUrl, resendApiKey, fromEmail);
      } else {
        console.warn('[calendar-heartbeat] ADMIN_EMAIL or RESEND_API_KEY missing — cannot send alert.');
      }
      return;
    }

    // 5b. Other errors — log and exit cleanly (don't throw; scheduled functions shouldn't fail noisily)
    console.error(
      '[calendar-heartbeat] Token refresh failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
