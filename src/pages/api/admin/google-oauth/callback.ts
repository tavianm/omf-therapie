export const prerender = false;

/**
 * GET /api/admin/google-oauth/callback
 *
 * Receives the OAuth callback from Google after admin consent.
 * Exchanges the authorization code for tokens and persists them to Supabase.
 *
 * Security: no session check here — Google redirects to this URL without the
 * admin session cookie. The state cookie (set by the authorize endpoint) is
 * the CSRF protection mechanism.
 *
 * Flow:
 *   1. Check for error param from Google
 *   2. Verify CSRF state cookie against state query param
 *   3. Exchange code → tokens via googleapis
 *   4. Validate refresh_token is present
 *   5. Upsert tokens into google_oauth_tokens (id = 'therapist')
 *   6. Clear state cookie and redirect to /mes-rdvs?google_connected=true
 */

import type { APIRoute } from 'astro';
import { google } from 'googleapis';
import { supabaseAdmin } from '../../../../lib/supabase';

export const GET: APIRoute = async ({ url, cookies }) => {
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // 1. CSRF state verification — applies to ALL callback paths including error responses
  // (RFC 6749 §4.1.2.1: state is returned by Google even on error responses)
  const storedState = cookies.get('google_oauth_state')?.value;
  if (!storedState || storedState !== state) {
    console.error('[google-oauth/callback] CSRF state mismatch or missing cookie');
    return new Response('Invalid state parameter', { status: 400 });
  }

  // 2. Handle Google-side error (e.g. user denied consent)
  if (error) {
    console.warn(`[google-oauth/callback] Google returned error: ${error}`);
    return new Response(null, {
      status:  302,
      headers: { Location: `/mes-rdvs?google_error=${encodeURIComponent(error)}` },
    });
  }

  // 3. Validate required env vars
  const clientId     = import.meta.env.GOOGLE_OAUTH_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.GOOGLE_OAUTH_CLIENT_SECRET as string | undefined;
  const redirectUri  = import.meta.env.GOOGLE_OAUTH_REDIRECT_URI as string | undefined;

  if (!clientId || !clientSecret || !redirectUri || !code) {
    console.error('[google-oauth/callback] Missing env vars or code param');
    return new Response(null, {
      status:  302,
      headers: { Location: '/mes-rdvs?google_error=token_exchange_failed' },
    });
  }

  try {
    // 4. Exchange authorization code for tokens
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    // 5. Ensure refresh_token is present (safety net — should always be set when prompt=consent)
    if (!tokens.refresh_token) {
      console.warn(
        '[google-oauth/callback] No refresh_token in response — ' +
        'this should not happen when prompt=consent is used. ' +
        'The user may need to revoke access in their Google account and try again.',
      );
      return new Response(null, {
        status:  302,
        headers: { Location: '/mes-rdvs?google_error=no_refresh_token' },
      });
    }

    // 6. Persist tokens — upsert singleton row for the therapist
    const { error: dbError } = await supabaseAdmin.from('google_oauth_tokens').upsert({
      id:            'therapist',
      access_token:  tokens.access_token ?? '',
      refresh_token: tokens.refresh_token,
      expiry_date:   tokens.expiry_date ?? (Date.now() + 3600 * 1000),
      updated_at:    new Date().toISOString(),
    });

    if (dbError) {
      console.error('[google-oauth/callback] DB upsert error:', dbError.message);
      return new Response(null, {
        status:  302,
        headers: { Location: '/mes-rdvs?google_error=token_exchange_failed' },
      });
    }

    // 7. Clear CSRF state cookie
    cookies.set('google_oauth_state', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure:   true,
      maxAge:   0,
      path:     '/api/admin/google-oauth/callback',
    });

    console.info('[google-oauth/callback] Google Calendar successfully re-authorized');

    return new Response(null, {
      status:  302,
      headers: { Location: '/mes-rdvs?google_connected=true' },
    });

  } catch (err: unknown) {
    console.error(
      '[google-oauth/callback] Token exchange failed:',
      err instanceof Error ? err.message : err,
    );
    return new Response(null, {
      status:  302,
      headers: { Location: '/mes-rdvs?google_error=token_exchange_failed' },
    });
  }
};
