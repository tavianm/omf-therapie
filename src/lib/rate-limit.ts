/**
 * Simple in-memory rate limiter for Netlify Functions.
 * Uses a sliding window per IP. Not distributed — suitable for low-traffic sites.
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
