/**
 * Availability cache using @netlify/blobs.
 *
 * Gracefully degrades when the Netlify Blobs context is unavailable
 * (e.g., plain `astro dev` without `netlify dev`, or GOOGLE_CALENDAR_MOCK=true).
 * Writes report an explicit CacheWriteResult ('written' | 'skipped-no-store' |
 * 'failed') — failures are logged, never silently swallowed (#153 SC6) — and a
 * failed store init is retried on the next invocation.
 *
 * Outside Netlify is an EXPECTED no-store state, not a failure (revue #154):
 * the absence of a Blobs context is detected before initialization, memoised
 * for the instance lifetime, and mapped to silent no-ops (reads → null,
 * writes → 'skipped-no-store') — previously every read/write re-attempted
 * init and logged an error, twice per cache miss under plain `astro dev`.
 * Only GENUINE initialization failures reset the memoised promise and retry.
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
// `null` for the life of the instance. A missing Blobs context is different
// (revue #154): memoised as permanently unavailable — retrying an expected
// state would only spam init attempts + logs on every invocation.
// ---------------------------------------------------------------------------

let _storePromise: Promise<AvailabilityStore | null> | null = null;
let _blobsUnavailable = false;

/**
 * Mirrors @netlify/blobs' own context resolution (`globalThis.
 * netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT`): when both are
 * absent, getStore() is guaranteed to throw MissingBlobsEnvironmentError —
 * checked BEFORE initialization so the expected no-store state never costs
 * an error log.
 */
function blobsContextConfigured(): boolean {
  const globalContext = (
    globalThis as { netlifyBlobsContext?: unknown }
  ).netlifyBlobsContext;
  if (globalContext !== undefined && globalContext !== null) return true;
  const envContext = process.env.NETLIFY_BLOBS_CONTEXT;
  return envContext !== undefined && envContext !== '';
}

async function getAvailabilityStore(): Promise<AvailabilityStore | null> {
  if (isCalendarMockEnabled()) return null;
  if (_blobsUnavailable) return null;
  if (!blobsContextConfigured()) {
    _blobsUnavailable = true;
    // One line per instance (memoised) — informational, not an error.
    console.info(
      '[calendar-cache] Aucun contexte Netlify Blobs — cache de disponibilité désactivé pour cette instance (hors Netlify).',
    );
    return null;
  }
  if (_storePromise) return _storePromise;
  _storePromise = import('@netlify/blobs')
    .then(({ getStore }) => getStore(STORE_NAME))
    .catch((err: unknown) => {
      if (
        err instanceof Error &&
        err.name === 'MissingBlobsEnvironmentError'
      ) {
        // The context exists but is incomplete (e.g. token missing) — the
        // library says this runtime cannot serve Blobs: memoise unavailable,
        // never retry.
        _blobsUnavailable = true;
        console.info(
          '[calendar-cache] Contexte Netlify Blobs incomplet — cache de disponibilité désactivé pour cette instance.',
        );
        return null;
      }
      // Reset the memoised promise — the next invocation retries init.
      _storePromise = null;
      // Fixed classification only (revue #154): a raw upstream message could
      // embed credential-shaped content — the log carries the operation and
      // the error class, never the message text or the raw error object.
      console.error(
        '[calendar-cache] Initialisation du store Blobs échouée — nouvelle tentative à la prochaine invocation :',
        err instanceof Error ? err.name : 'unknown',
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
  if (!store) {
    // Outside Netlify (no Blobs context, memoised unavailable) — an expected
    // no-store state reported as a skip, NOT a failure (revue #154). The only
    // remaining null path is a GENUINE init failure, which
    // getAvailabilityStore logged and reset for the next-invocation retry.
    if (_blobsUnavailable) return 'skipped-no-store';
    return 'failed';
  }
  try {
    const entry: CacheEntry = {
      slots,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    await store.setJSON(key, entry);
    return 'written';
  } catch (err: unknown) {
    // Cache write failure remains non-fatal for callers, but it is no longer
    // silent — fixed classification only (revue #154): a raw upstream message
    // could embed credential-shaped content — the log carries the operation
    // and the error class, never the message text or the raw error object.
    console.error(
      "[calendar-cache] Échec d'écriture du cache de disponibilité :",
      err instanceof Error ? err.name : 'unknown',
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
