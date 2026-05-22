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

const MOCK_MODE = import.meta.env.GOOGLE_CALENDAR_MOCK === 'true';
const STORE_NAME = 'calendar-availability';
const DEFAULT_TTL_SECONDS = 600; // 10 minutes

// ---------------------------------------------------------------------------
// Singleton store promise — initialised once, reused across requests
// ---------------------------------------------------------------------------

let _storePromise: Promise<ReturnType<typeof import('@netlify/blobs')['getStore']> | null> | null =
  null;

async function getAvailabilityStore(): Promise<ReturnType<
  typeof import('@netlify/blobs')['getStore']
> | null> {
  if (MOCK_MODE) return null;
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

export async function getCachedAvailability(key: string): Promise<TimeSlot[] | null> {
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
    const entry: CacheEntry = { slots, expiresAt: Date.now() + ttlSeconds * 1000 };
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
    await Promise.allSettled(blobs.map((b: { key: string }) => store.delete(b.key)));
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
  const parisDayStr = fromDate.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // Parse day-of-week offset (fr-FR abbreviated weekdays: dim, lun, mar, mer, jeu, ven, sam)
  const weekdayMap: Record<string, number> = {
    dim: 0,
    lun: 1,
    mar: 2,
    mer: 3,
    jeu: 4,
    ven: 5,
    sam: 6,
  };
  const parts = parisDayStr.split(' ');
  const dayAbbr = parts[0].replace('.', '').toLowerCase();
  const dayOfWeek = weekdayMap[dayAbbr] ?? 1;
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(fromDate);
  monday.setDate(monday.getDate() + daysToMonday);
  const weekStart = monday.toISOString().slice(0, 10);
  return `available:${mode}:${duration}:${weeks}w:${weekStart}`;
}
