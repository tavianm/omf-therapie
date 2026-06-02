export const prerender = false;

/**
 * GET /api/admin/google-oauth
 *
 * Generates a Google OAuth authorization URL and redirects the admin to it.
 * Protected — requires a valid admin session.
 *
 * Flow:
 *   1. Verify admin session
 *   2. Build OAuth URL with offline access + forced consent prompt
 *   3. Set CSRF state cookie (5 min TTL)
 *   4. Redirect to Google consent page
 */

import type { APIRoute } from 'astro';
import { google } from 'googleapis';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';

export const GET: APIRoute = async ({ request, cookies }) => {
  // 1. Auth guard — admin only
  const session = await auth.api.getSession({ headers: request.headers });
  if (!isAdminSession(session)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Validate required env vars
  const clientId     = import.meta.env.GOOGLE_OAUTH_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.GOOGLE_OAUTH_CLIENT_SECRET as string | undefined;
  const redirectUri  = import.meta.env.GOOGLE_OAUTH_REDIRECT_URI as string | undefined;

  if (!clientId || !clientSecret || !redirectUri) {
    return new Response(
      'Missing required environment variables: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI',
      { status: 500, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  // 3. Build OAuth2 client and generate consent URL
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // CSRF state token — verified in the callback
  const state = crypto.randomUUID();

  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent', // Critical: forces Google to return a fresh refresh_token
    scope: [
      'https://www.googleapis.com/auth/calendar',
    ],
    state,
  });

  // 4. Persist CSRF state in a short-lived httpOnly cookie scoped to the callback path
  cookies.set('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   true,
    maxAge:   300, // 5 minutes
    path:     '/api/admin/google-oauth/callback',
  });

  // 5. Redirect admin to Google consent screen
  return new Response(null, {
    status:  302,
    headers: { Location: authorizationUrl },
  });
};
