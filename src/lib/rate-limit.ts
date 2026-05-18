/**
 * Simple in-memory rate limiter for Netlify serverless functions.
 *
 * ⚠️  LIMITATIONS:
 *   1. Cold-start reset — each new Lambda instance starts with an empty store.
 *      On Netlify Functions, instances may spin up and down independently.
 *      Under concurrent load, multiple instances run in parallel, each with their
 *      own counter. Effective limit is approximately `limit × N_instances`.
 *
 *   2. IP extraction requires a trusted header — use `x-nf-client-connection-ip`
 *      (set exclusively by Netlify infrastructure, not spoofable by the client)
 *      rather than `x-forwarded-for` (leftmost entry is client-controlled).
 *
 * For production-grade distributed rate limiting, replace this store with
 * an Upstash Redis counter or a Supabase INSERT … ON CONFLICT increment.
 * This implementation is adequate for low-volume single-warm-instance traffic.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}

export interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(ip: string, key: string, options: RateLimitOptions): RateLimitResult {
  cleanup();
  const storeKey = `${key}:${ip}`;
  const now = Date.now();
  const existing = store.get(storeKey);

  if (!existing || existing.resetAt < now) {
    store.set(storeKey, { count: 1, resetAt: now + options.windowSeconds * 1000 });
    return { allowed: true, remaining: options.limit - 1, resetAt: now + options.windowSeconds * 1000 };
  }

  if (existing.count >= options.limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count++;
  return { allowed: true, remaining: options.limit - existing.count, resetAt: existing.resetAt };
}

export function rateLimitResponse(resetAt: number): Response {
  return new Response(
    JSON.stringify({ error: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
      },
    },
  );
}
