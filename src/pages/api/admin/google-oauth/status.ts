export const prerender = false;

/**
 * GET /api/admin/google-oauth/status
 *
 * Returns the current state of the Google OAuth token stored in Supabase.
 * Consumed by the GoogleCalendarStatus React island on the /mes-rdvs page.
 *
 * Response shape:
 *   { connected, expiresAt, updatedAt, tokenValid }
 */

import type { APIRoute } from 'astro';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';
import { supabaseAdmin } from '../../../../lib/supabase';

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface StatusResponse {
  /** Whether a token row exists in the DB */
  connected: boolean;
  /** ISO string of access token expiry, null if unknown */
  expiresAt: string | null;
  /** ISO string of last token update */
  updatedAt: string | null;
  /** true if expiry_date is more than 5 minutes in the future */
  tokenValid: boolean;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ request }) => {
  // 1. Admin session guard
  const session = await auth.api.getSession({ headers: request.headers });
  if (!isAdminSession(session)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Query the persisted token row
  const { data } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('refresh_token, access_token, expiry_date, updated_at')
    .eq('id', 'therapist')
    .single();

  // 3. Build response
  let body: StatusResponse;

  if (!data) {
    body = {
      connected:  false,
      expiresAt:  null,
      updatedAt:  null,
      tokenValid: false,
    };
  } else {
    const expiryDate: number | null = data.expiry_date ?? null;
    body = {
      connected:  true,
      expiresAt:  expiryDate !== null ? new Date(expiryDate).toISOString() : null,
      updatedAt:  (data.updated_at as string | null) ?? null,
      tokenValid: expiryDate !== null && expiryDate > Date.now() + 5 * 60 * 1000,
    };
  }

  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
};
