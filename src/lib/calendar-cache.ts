/**
 * Availability cache using @netlify/blobs.
 *
 * Gracefully degrades when the Netlify Blobs context is unavailable
 * (e.g., plain `astro dev` without `netlify dev`, or GOOGLE_CALENDAR_MOCK=true).
 * Writes report an explicit CacheWriteResult ('written' | 'skipped-no-store' |
 * 'failed') — failures are logged, never silently swallowed (#153 SC6) — and a
 * failed store init is retried on the next invocation.
 *
 * Cache TTL is enforced via metadata.expiresAt rather than Blobs native TTL
 * to maintain compatibility across Netlify Blobs versions.
 */

import type { TimeSlot } from './google-calendar.js';
import { isCalendarMockEnabled } from './mock-mode.server.js';

const STORE_NAME = 'calendar-availability';
const DEFAULT_TTL_SECONDS = 600; // 10 minutes

type AvailabilityStore = ReturnType<
  (typeof import('@netlify/blobs'))['getStore']
>;

// ---------------------------------------------------------------------------
// Singleton store promise — memoised, but a FAILED init resets it so the
// next invocation retries (#153 SC6): one transient failure must not pin
// `null` for the life of the instance.
// ---------------------------------------------------------------------------

let _storePromise: Promise<AvailabilityStore | null> | null = null;

async function getAvailabilityStore(): Promise<AvailabilityStore | null> {
  if (isCalendarMockEnabled()) return null;
  if (_storePromise) return _storePromise;
  _storePromise = import('@netlify/blobs')
    .then(({ getStore }) => getStore(STORE_NAME))
    .catch((err: unknown) => {
      // Reset the memoised promise — the next invocation retries init.
      _storePromise = null;
      // Sanitized message only — never log the raw error object.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        '[calendar-cache] Initialisation du store Blobs échouée — nouvelle tentative à la prochaine invocation :',
        message,
      );
      return null;
    });
  return _storePromise;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Explicit outcome of a cache write (#153 SC6 — truthful telemetry):
 * callers can distinguish confirmed writes from skips and failures
 * instead of a silently swallowed void.
 */
export type CacheWriteResult = 'written' | 'skipped-no-store' | 'failed';

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
): Promise<CacheWriteResult> {
  // Mock guard short-circuits BEFORE any store interaction — behaviour
  // unchanged, now reported explicitly (#153 SC6).
  if (isCalendarMockEnabled()) return 'skipped-no-store';
  const store = await getAvailabilityStore();
  // `store` is null here only because init failed (the mock guard above
  // already returned) — getAvailabilityStore logged it and reset its
  // memoised promise, so the next invocation retries.
  if (!store) return 'failed';
  try {
    const entry: CacheEntry = {
      slots,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    await store.setJSON(key, entry);
    return 'written';
  } catch (err: unknown) {
    // Cache write failure remains non-fatal for callers, but it is no
    // longer silent — sanitized message only, never the raw error object.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[calendar-cache] Échec d'écriture du cache de disponibilité :",
      message,
    );
    return 'failed';
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
