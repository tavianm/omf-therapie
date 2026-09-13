/**
 * useAppointmentsPolling — React adapter for the pure appointment poller
 * (`src/utils/appointment-poller.ts`, issue #165).
 *
 * Owns the live appointments list of the Workbench (`/poste-travail/`):
 * SSR props seed the state at mount, then polls against
 * `GET /api/admin/appointments/` keep it fresh (30 s cadence, visible-only,
 * paused while the creation drawer is open, exponential backoff on failure —
 * all handled by the pure poller).
 *
 * Non-intrusion (SC5): an incoming poll whose payload is deep-equal to the
 * current list keeps the SAME array reference — zero `setState`, zero
 * re-render — so unmount-free views and local UI states are never disturbed.
 * Local UI state downstream is never re-derived from these props after mount.
 *
 * End of session (SC7): a 401/403 stops the polling loop for good and
 * redirects exactly like the SSR guard —
 * 401 → `/login/?redirect=/poste-travail/`, 403 → `/login/?error=acces-refuse`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Appointment } from '../types/appointment';
import {
  createAppointmentPoller,
  PollerAuthError,
  type AppointmentsSnapshot,
} from '../utils/appointment-poller';

export interface UseAppointmentsPollingOptions {
  /**
   * Pause guard — true while the creation drawer is open: zero fetch during
   * the whole drawer lifetime (SC5). Evaluated at poll time, so a plain value
   * is enough (mirrored into a ref for the mount-time poller closure).
   */
  paused: boolean;
}

export interface UseAppointmentsPollingResult {
  /** Live list — same reference as the SSR props until a poll changes the data. */
  appointments: Appointment[];
  /** Explicit refetch (post-action refresh); single-flighted by the poller. */
  refresh: () => void;
  /** `fetchedAt` of the first successful poll, then of polls that changed the data; null before. */
  lastUpdated: string | null;
  /** True since the last poll failure (data shown is degraded); reset on the next success. */
  isStale: boolean;
}

/** JSON-value deep equality — key order independent, cycle free (server JSON). */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, index) => isDeepEqual(item, b[index]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return aKeys.every(
    key =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      isDeepEqual(aRecord[key], bRecord[key]),
  );
}

/** Authenticated GET + envelope parsing (contract of the pure poller). */
async function fetchAppointments(): Promise<
  AppointmentsSnapshot<Appointment[]>
> {
  // Trailing slash required — ADR-013 (otherwise Astro answers with an HTML
  // redirect and response.json() explodes).
  const response = await fetch('/api/admin/appointments/', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) {
    throw new PollerAuthError(response.status);
  }
  if (!response.ok) {
    throw new Error(`Appointments poll failed with HTTP ${response.status}`);
  }
  return (await response.json()) as AppointmentsSnapshot<Appointment[]>;
}

/**
 * @param initialAppointments SSR payload — initial state, never re-read after mount.
 */
export function useAppointmentsPolling(
  initialAppointments: Appointment[],
  options: UseAppointmentsPollingOptions,
): UseAppointmentsPollingResult {
  const [appointments, setAppointments] =
    useState<Appointment[]>(initialAppointments);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Refs mirroring the state for the mount-time poller callbacks (stable
  // closures) — the callbacks must always compare against the CURRENT list.
  const appointmentsRef = useRef<Appointment[]>(initialAppointments);
  const lastUpdatedRef = useRef<string | null>(null);
  const isStaleRef = useRef(false);
  const pausedRef = useRef(options.paused);
  const pollerRef = useRef<ReturnType<
    typeof createAppointmentPoller<Appointment[]>
  > | null>(null);

  // Latest-ref mirror of `paused`, synced during render (never read while
  // rendering) rather than in an effect: the drawer's post-creation refresh
  // fires in the same commit that closes it (SC5/SC6) and must observe the
  // lifted pause deterministically. A discarded concurrent render holding a
  // stale value is corrected by the next render before any tick can run.
  pausedRef.current = options.paused;

  useEffect(() => {
    const poller = createAppointmentPoller<Appointment[]>({
      fetchAppointments,
      isVisible: () => document.visibilityState === 'visible',
      isPaused: () => pausedRef.current,
      onSuccess: snapshot => {
        const incoming = snapshot.appointments;
        const changed = !isDeepEqual(incoming, appointmentsRef.current);
        if (changed) {
          appointmentsRef.current = incoming;
          setAppointments(incoming);
        }
        // Freshness stamp: the first successful poll always stamps (the
        // indicator is hidden until then); identical polls never re-stamp —
        // they stay at zero setState / zero re-render (SC5).
        if (changed || lastUpdatedRef.current === null) {
          lastUpdatedRef.current = snapshot.fetchedAt;
          setLastUpdated(snapshot.fetchedAt);
        }
        if (isStaleRef.current) {
          isStaleRef.current = false;
          setIsStale(false);
        }
      },
      onError: error => {
        // SC4 — degraded but usable page: keep the displayed data, flag
        // staleness, log silently. Nothing blocking.
        isStaleRef.current = true;
        setIsStale(true);
        console.error('[useAppointmentsPolling] poll failed', error);
      },
      onAuthError: status => {
        // SC7 — exact mirror of the SSR guard.
        window.location.href =
          status === 401
            ? '/login/?redirect=/poste-travail/'
            : '/login/?error=acces-refuse';
      },
    });
    pollerRef.current = poller;

    // SC3 — a return to the foreground triggers an immediate refetch; the
    // poller itself makes it single-flighted and replayable.
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') poller.triggerRefresh();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    poller.start();
    // start() only arms the first tick (30 s) — request the immediate first
    // fetch here. No-op while hidden or paused, replayed if a poll is in flight.
    poller.triggerRefresh();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      poller.stop();
      pollerRef.current = null;
    };
  }, []);

  const refresh = useCallback(() => {
    // Explicit refetch for action handlers after a mutation — shares the
    // poller's single-flight lane. Paused (drawer open) → no-op, per SC5.
    pollerRef.current?.triggerRefresh();
  }, []);

  return { appointments, refresh, lastUpdated, isStale };
}
