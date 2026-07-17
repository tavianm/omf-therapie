/**
 * Lightweight health probe target for uptime monitoring.
 *
 * Deliberately dependency-free (no Supabase, no Google Calendar): an external
 * monitor hitting this endpoint answers "is the site up?" without paying the
 * cost of /api/availability (which requires query params and hits both
 * Supabase and Google on every request).
 *
 * Paired with the site root (`/`) for a two-tier probe: `/` catches a broken
 * build or static-asset failure, `/api/health` catches a broken serverless
 * runtime.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
