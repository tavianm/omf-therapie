/**
 * Availability cache using @netlify/blobs.
 *
 * Gracefully degrades to a no-op when the Netlify Blobs context is unavailable
 * (e.g., plain `astro dev` without `netlify dev`, or GOOGLE_CALENDAR_MOCK=true).
 *
 * Cache TTL is enforced via metadata.expiresAt rather than Blobs native TTL
 * to maintain compatibility across Netlify Blobs versions.
 */

import type { TimeSlot } from './google-calendar.js';
import { isCalendarMockEnabled } from './mock-mode.server.js';
import { getParisISOWeekday } from '../utils/date.js';

const STORE_NAME = 'calendar-availability';
const DEFAULT_TTL_SECONDS = 600; // 10 minutes

// ---------------------------------------------------------------------------
// Singleton store promise — initialised once, reused across requests
// ---------------------------------------------------------------------------

let _storePromise: Promise<ReturnType<
  (typeof import('@netlify/blobs'))['getStore']
> | null> | null = null;

async function getAvailabilityStore(): Promise<ReturnType<
  (typeof import('@netlify/blobs'))['getStore']
> | null> {
  if (isCalendarMockEnabled()) return null;
  if (_storePromise) return _storePromise;
  _storePromise = import('@netlify/blobs')
    .then(({ getStore }) => getStore(STORE_NAME))
    .catch(() => null);
  return _storePromise;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheEntry {
  slots: TimeSlot[];
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getCachedAvailability(
  key: string,
): Promise<TimeSlot[] | null> {
  const store = await getAvailabilityStore();
  if (!store) return null;
  try {
    const raw = (await store.get(key, { type: 'json' })) as CacheEntry | null;
    if (!raw) return null;
    if (Date.now() > raw.expiresAt) {
      store.delete(key).catch(() => {});
      return null;
    }
    return raw.slots;
  } catch {
    return null;
  }
}

export async function setCachedAvailability(
  key: string,
  slots: TimeSlot[],
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const store = await getAvailabilityStore();
  if (!store) return;
  try {
    const entry: CacheEntry = {
      slots,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    await store.setJSON(key, entry);
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function invalidateAvailabilityCache(): Promise<void> {
  const store = await getAvailabilityStore();
  if (!store) return;
  try {
    const { blobs } = await store.list();
    await Promise.allSettled(
      blobs.map((b: { key: string }) => store.delete(b.key)),
    );
  } catch {
    // Non-fatal — worst case: stale data served until TTL expires
  }
}

/**
 * Builds a stable cache key from request parameters.
 * Key is scoped to the week (Paris timezone Monday date) so it never
 * includes raw timestamps that would cause every request to miss.
 */
export function buildAvailabilityCacheKey(
  mode: string,
  duration: number,
  weeks: number,
  fromDate: Date,
): string {
  // Get Monday of the week containing fromDate in Paris timezone
  // (ISO weekday: 1 = Monday … 7 = Sunday, so days back to Monday = 1 - weekday)
  const daysToMonday = 1 - getParisISOWeekday(fromDate);
  const monday = new Date(fromDate);
  monday.setDate(monday.getDate() + daysToMonday);
  const weekStart = monday.toISOString().slice(0, 10);
  return `available:${mode}:${duration}:${weeks}w:${weekStart}`;
}
