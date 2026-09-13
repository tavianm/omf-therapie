/**
 * Appointment polling scheduler — pure, dependency-free module for the
 * `/poste-travail/` live dashboard (issue #165).
 *
 * Client-safe by design: zero imports (server-only `src/lib/**` is forbidden
 * in islands), no React, no DOM API — `visibilitychange` listeners and the
 * actual `fetch()` live in the `useAppointmentsPolling` hook, which injects
 * `fetchAppointments`, `isVisible`, `isPaused` and the timers.
 *
 * Contract (spec 165 — SC2, SC2a, SC3, SC4, SC7):
 * - `isVisible`/`isPaused` are re-evaluated on EVERY tick and EVERY
 *   `triggerRefresh()`; a fetch happens only when visible AND not paused.
 * - Fetches are single-flighted: a `triggerRefresh()` while a poll is in
 *   flight marks a pending replay, executed when the in-flight poll settles
 *   (never swallowed, never two fetches in parallel).
 * - Snapshot application is monotonic: a snapshot whose `fetchedAt` is not
 *   strictly greater than the last applied one is ignored (read-after-write
 *   race — a poll started before a mutation can never regress the UI).
 * - Network/5xx failures keep the previously applied data and double the
 *   interval (×2, capped at `maxBackoffMs`); the first success resets it to
 *   the base interval.
 * - A 401/403 surfaced by `fetchAppointments` (a thrown error carrying a
 *   numeric `status` property — e.g. `PollerAuthError`) calls `onAuthError`
 *   and IRREVOCABLY stops the loop: `start()` afterwards is a no-op.
 *
 * State machine: `idle → polling → backing-off → stopped`.
 * Testable in a plain node environment with `vi.useFakeTimers()`: the global
 * timers are resolved at call time, so installing fake timers after module
 * import (and even after poller creation) is picked up; `setTimeout`/
 * `clearTimeout` can also be injected explicitly.
 */

/** Base polling interval: 30 s (spec 165). */
export const POLL_INTERVAL_MS = 30_000;

/** Failure backoff cap: 5 min (spec 165). */
export const MAX_BACKOFF_MS = 300_000;

/** Lifecycle states of the poller: `idle → polling → backing-off → stopped`. */
export type PollerState = 'idle' | 'polling' | 'backing-off' | 'stopped';

/**
 * Server envelope of `GET /api/admin/appointments/` (spec 165). The generic
 * payload keeps this module decoupled from the `Appointment` shape; the
 * consuming hook types it.
 */
export interface AppointmentsSnapshot<TAppointments> {
  appointments: TAppointments;
  /** ISO 8601 server timestamp — monotonic application marker. */
  fetchedAt: string;
}

/**
 * Error thrown by `fetchAppointments` on an HTTP 401/403 (end of session).
 * The poller also honors any thrown error carrying a numeric `status`
 * property equal to 401 or 403 (see `getAuthErrorStatus`).
 */
export class PollerAuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message?: string) {
    super(message ?? `Authentication error (HTTP ${status})`);
    this.name = 'PollerAuthError';
    this.status = status;
  }
}

/**
 * Extracts 401/403 from a thrown error when it carries a numeric `status`
 * property (the convention shared with the hook), `null` otherwise.
 */
export function getAuthErrorStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 ? status : null;
}

/** Opaque timer handle — wide on purpose so any timer implementation fits. */
export type PollerTimerHandle = unknown;

/** Minimal `setTimeout` contract accepted by the poller (node, DOM, fake). */
export type PollerSetTimeout = (
  handler: () => void,
  timeoutMs: number,
) => PollerTimerHandle;

/** Minimal `clearTimeout` contract accepted by the poller. */
export type PollerClearTimeout = (handle: PollerTimerHandle) => void;

export interface AppointmentPollerOptions<TAppointments> {
  /**
   * Performs the authenticated GET and parses the `{ appointments, fetchedAt }`
   * envelope. Must REJECT with an error carrying `status: 401 | 403` when the
   * session is gone (see `PollerAuthError`).
   */
  fetchAppointments: () => Promise<AppointmentsSnapshot<TAppointments>>;
  /** Tab visibility — re-evaluated on every tick and every `triggerRefresh()`. */
  isVisible: () => boolean;
  /** Pause guard (e.g. creation drawer open) — same evaluation points. */
  isPaused: () => boolean;
  /** Called with each applied (fresh) snapshot. Must not throw. */
  onSuccess: (snapshot: AppointmentsSnapshot<TAppointments>) => void;
  /** Called on network/5xx failures (never on auth errors). Must not throw. */
  onError: (error: unknown) => void;
  /** Called once with 401 or 403, right before the irrevocable stop. Must not throw. */
  onAuthError: (status: 401 | 403) => void;
  /** Base interval between ticks. Default: `POLL_INTERVAL_MS` (30 s). */
  intervalMs?: number;
  /** Cap reached by doubling on consecutive failures. Default: `MAX_BACKOFF_MS` (5 min). */
  maxBackoffMs?: number;
  /**
   * Injectable clock (defaults to `Date.now`). Reserved by the module
   * signature: the monotonic guard relies solely on the server-side
   * `fetchedAt`, so the current logic never consults this clock.
   */
  now?: () => number;
  /**
   * Injectable `setTimeout` (fake timers in tests). Defaults to the global
   * one, resolved at call time so late-installed fake timers are honored.
   */
  setTimeout?: PollerSetTimeout;
  /** Injectable `clearTimeout`. Defaults to the global one, resolved at call time. */
  clearTimeout?: PollerClearTimeout;
}

export interface AppointmentPoller {
  /**
   * Starts the loop (no-op if already running, or after an auth stop — SC7).
   * The first fetch happens at the first tick, `intervalMs` after `start()`:
   * mount-time data comes from SSR props (« Au montage, rien ne change »).
   * An immediate first fetch can be requested right after via
   * `triggerRefresh()`.
   */
  start(): void;
  /**
   * Clears pending timers and prevents future fetches. `start()` is allowed
   * again afterwards — unless the stop was caused by a 401/403, which is
   * irrevocable. An in-flight fetch is not cancelled; its result is dropped
   * silently when it settles.
   */
  stop(): void;
  /**
   * Immediate refetch (visibility return, post-action refresh). Gates are
   * re-evaluated; while a poll is in flight the request is NOT swallowed —
   * it is replayed when the in-flight poll settles (single lane, SC3).
   * No-op when the loop is not running.
   */
  triggerRefresh(): void;
  /** Current lifecycle state (observability and tests). */
  readonly state: PollerState;
}

/**
 * Creates the polling scheduler. Pure orchestration: it never touches the
 * network or the DOM itself — every side effect is injected or notified
 * through the callbacks.
 */
export function createAppointmentPoller<TAppointments>(
  options: AppointmentPollerOptions<TAppointments>,
): AppointmentPoller {
  const {
    fetchAppointments,
    isVisible,
    isPaused,
    onSuccess,
    onError,
    onAuthError,
  } = options;
  const baseIntervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
  const setTimeoutFn = options.setTimeout ?? defaultSetTimeout;
  const clearTimeoutFn = options.clearTimeout ?? defaultClearTimeout;

  let state: PollerState = 'idle';
  let currentIntervalMs = baseIntervalMs;
  let timerHandle: PollerTimerHandle = null;
  let inFlight = false;
  let pendingReplay = false;
  let authStopped = false;
  let lastAppliedFetchedAtMs: number | null = null;

  const clearTimer = (): void => {
    if (timerHandle === null) return;
    clearTimeoutFn(timerHandle);
    timerHandle = null;
  };

  const scheduleNextTick = (): void => {
    clearTimer();
    timerHandle = setTimeoutFn(() => {
      timerHandle = null;
      runTick();
    }, currentIntervalMs);
  };

  /** Monotonic application (SC2a) + backoff reset on any 2xx (SC4). */
  const applySnapshot = (
    snapshot: AppointmentsSnapshot<TAppointments>,
  ): void => {
    // A successful response resets the backoff even when the snapshot itself
    // turns out to be stale — freshness of the transport, not of the data.
    currentIntervalMs = baseIntervalMs;
    if (state === 'backing-off') state = 'polling';

    const fetchedAtMs = Date.parse(snapshot.fetchedAt);
    const hasValidStamp = !Number.isNaN(fetchedAtMs);
    const isFresh =
      lastAppliedFetchedAtMs === null ||
      (hasValidStamp && fetchedAtMs > lastAppliedFetchedAtMs);
    if (!isFresh) return; // stale or equal snapshot — ignored entirely
    if (hasValidStamp) lastAppliedFetchedAtMs = fetchedAtMs;
    onSuccess(snapshot);
  };

  const handleFetchError = (error: unknown): void => {
    const authStatus = getAuthErrorStatus(error);
    if (authStatus !== null) {
      // SC7 — end of session: stop IRREVOCABLY before notifying, so the
      // callback observes a stopped poller and no further fetch (tick,
      // visibility return or replay) can ever be scheduled again.
      authStopped = true;
      state = 'stopped';
      clearTimer();
      pendingReplay = false;
      onAuthError(authStatus);
      return;
    }
    // SC4 — network/5xx: keep the displayed data, back off (×2, capped).
    onError(error);
    currentIntervalMs = Math.min(currentIntervalMs * 2, maxBackoffMs);
    state = 'backing-off';
  };

  /** Settles one fetch: applies or reports, then replays or reschedules. */
  const finishFetch = (
    error: unknown,
    snapshot: AppointmentsSnapshot<TAppointments> | null,
  ): void => {
    inFlight = false;
    if (state !== 'polling' && state !== 'backing-off') {
      // stop() (or an auth stop) while the fetch was in flight: drop the
      // result entirely — no callback, no replay, no rescheduling.
      pendingReplay = false;
      return;
    }
    if (snapshot !== null) applySnapshot(snapshot);
    else handleFetchError(error);
    if (authStopped || (state !== 'polling' && state !== 'backing-off')) {
      // Auth stop (SC7), or stop() called from within a callback.
      return;
    }
    if (pendingReplay) {
      pendingReplay = false;
      if (isVisible() && !isPaused()) {
        // SC3 — the visibility-triggered refetch is replayed at the end of
        // the in-flight poll, on the same single lane. Its own settle
        // schedules the next tick.
        runFetch();
        return;
      }
    }
    scheduleNextTick();
  };

  /** The one and only fetch lane — never two fetches in parallel (SC2). */
  const runFetch = (): void => {
    if (inFlight) return;
    inFlight = true;
    let pending: Promise<AppointmentsSnapshot<TAppointments>>;
    try {
      pending = fetchAppointments();
    } catch (error) {
      // Contract guard: a synchronous throw is treated like a rejected fetch.
      finishFetch(error, null);
      return;
    }
    pending.then(
      snapshot => finishFetch(null, snapshot),
      error => finishFetch(error, null),
    );
  };

  const runTick = (): void => {
    if (authStopped || (state !== 'polling' && state !== 'backing-off')) return;
    if (inFlight || !isVisible() || isPaused()) {
      // Single-flight: a tick never intercalates with the lane. Hidden or
      // paused: zero fetch, the loop simply re-arms (SC3, SC5).
      scheduleNextTick();
      return;
    }
    runFetch();
  };

  const start = (): void => {
    if (authStopped) return; // SC7 — irrevocable after a 401/403
    if (state === 'polling' || state === 'backing-off') return;
    currentIntervalMs = baseIntervalMs;
    state = 'polling';
    scheduleNextTick();
  };

  const stop = (): void => {
    if (state === 'stopped') return;
    state = 'stopped';
    clearTimer();
    pendingReplay = false;
  };

  const triggerRefresh = (): void => {
    if (authStopped || (state !== 'polling' && state !== 'backing-off')) return;
    // Gates are re-evaluated on EVERY trigger (spec 165).
    if (!isVisible() || isPaused()) return;
    if (inFlight) {
      pendingReplay = true; // replayed when the in-flight poll settles (SC3)
      return;
    }
    runFetch();
  };

  return {
    start,
    stop,
    triggerRefresh,
    get state(): PollerState {
      return state;
    },
  };
}

// ---------------------------------------------------------------------------
// Default timers — resolved through `globalThis` AT CALL TIME so that fake
// timers installed after this module is imported (or after the poller is
// created) are honored by `vi.useFakeTimers()`.
// ---------------------------------------------------------------------------

function defaultSetTimeout(
  handler: () => void,
  timeoutMs: number,
): PollerTimerHandle {
  return (globalThis.setTimeout as PollerSetTimeout)(handler, timeoutMs);
}

function defaultClearTimeout(handle: PollerTimerHandle): void {
  (globalThis.clearTimeout as PollerClearTimeout)(handle);
}
