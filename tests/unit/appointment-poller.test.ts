import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  createAppointmentPoller,
  getAuthErrorStatus,
  MAX_BACKOFF_MS,
  POLL_INTERVAL_MS,
  PollerAuthError,
  type AppointmentPoller,
  type AppointmentsSnapshot,
  type PollerState,
} from '../../src/utils/appointment-poller';

// ---------------------------------------------------------------------------
// appointment-poller — scheduler pur du poste de travail (#165).
//
// Contrat testé ici (le hook React reste une coquille mince, toute la logique
// est dans le module pur, cf. spec 165) :
//   SC2  — données vivantes : démarré + visible + non pausé → 1 fetch par
//          intervalle de 30 s, snapshot { appointments, fetchedAt } livré à
//          onSuccess ; aucun fetch au montage (« Au montage, rien ne change »).
//   SC2a — course lecture-après-écriture : un snapshot dont `fetchedAt` n'est
//          pas STRICTEMENT postérieur au dernier appliqué est ignoré ; une
//          seule lane de fetch (tick et triggerRefresh ne chevauchent jamais
//          deux requêtes).
//   SC3  — visibilité : onglet masqué → zéro fetch quelle que soit la durée ;
//          retour au premier plan → refetch immédiat ; un refetch tombé sur un
//          poll en cours est REJOUÉ exactement une fois à la fin de ce poll.
//   SC4  — résilience : échec réseau/5xx → données conservées, intervalle ×2
//          cap 5 min, retour à 30 s au premier succès.
//   SC5  — non-intrusion (oracle poller pur) : tiroir de création ouvert
//          (isPaused) → 0 fetch, même visible et horloge avancée.
//   SC7  — fin de session : 401/403 → onAuthError + arrêt IRRÉVOCABLE (aucune
//          requête ultérieure, y compris après retour de visibilité, tick,
//          triggerRefresh ou start()).
//
// Les timers du module sont résolus depuis globalThis À L'APPEL : aucun
// mock de module n'est nécessaire — vi.useFakeTimers() seul rend le temps
// déterministe, et fetchAppointments (dépendance externe réseau) est le seul
// mock injecté. Aucune couche du module sous test n'est mockée.
// ---------------------------------------------------------------------------

/** Generic appointment payload — the poller is agnostic to the row shape. */
type Snapshot = AppointmentsSnapshot<string[]>;

const T1 = '2026-09-13T08:00:00.000Z';
const T2 = '2026-09-13T08:01:00.000Z';
const T3 = '2026-09-13T08:02:00.000Z';

function snapshot(appointments: string[], fetchedAt: string): Snapshot {
  return { appointments, fetchedAt };
}

interface SnapshotDeferred {
  promise: Promise<Snapshot>;
  resolve: (snapshot: Snapshot) => void;
  reject: (error: unknown) => void;
}

/** An unsettled fetch promise the test resolves/rejects explicitly. */
function deferredSnapshot(): SnapshotDeferred {
  let resolve!: (snapshot: Snapshot) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Snapshot>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PollerFixture {
  fetchAppointments: Mock<() => Promise<Snapshot>>;
  isVisible: Mock<() => boolean>;
  isPaused: Mock<() => boolean>;
  onSuccess: Mock<(snapshot: Snapshot) => void>;
  onError: Mock<(error: unknown) => void>;
  onAuthError: Mock<(status: 401 | 403) => void>;
  poller: AppointmentPoller;
}

/** Wires a poller over fully observable fakes — visible and unpaused by default. */
function createFixture(): PollerFixture {
  const fetchAppointments = vi.fn<() => Promise<Snapshot>>();
  const isVisible = vi.fn<() => boolean>(() => true);
  const isPaused = vi.fn<() => boolean>(() => false);
  const onSuccess = vi.fn<(snapshot: Snapshot) => void>();
  const onError = vi.fn<(error: unknown) => void>();
  const onAuthError = vi.fn<(status: 401 | 403) => void>();
  const poller = createAppointmentPoller<string[]>({
    fetchAppointments,
    isVisible,
    isPaused,
    onSuccess,
    onError,
    onAuthError,
  });
  return {
    fetchAppointments,
    isVisible,
    isPaused,
    onSuccess,
    onError,
    onAuthError,
    poller,
  };
}

/** Drains pending promise continuations WITHOUT moving the fake clock. */
const flushMicrotasks = (): Promise<void> => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// SC2 — données vivantes (polling cadencé)
// ===========================================================================

describe('createAppointmentPoller — SC2 données vivantes', () => {
  it('performs NO fetch on start() and exactly one fetch at the first 30 s tick, delivering the snapshot to onSuccess', async () => {
    const f = createFixture();
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));

    f.poller.start();

    // « Au montage, rien ne change » — les props SSR restent l'état initial.
    expect(f.poller.state).toBe('polling');
    expect(f.fetchAppointments).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
    expect(f.onSuccess).toHaveBeenCalledWith({
      appointments: ['a'],
      fetchedAt: T1,
    });
  });

  it('keeps polling on every interval while visible and not paused', async () => {
    const f = createFixture();
    f.fetchAppointments
      .mockResolvedValueOnce(snapshot(['a'], T1))
      .mockResolvedValueOnce(snapshot(['a', 'b'], T2))
      .mockResolvedValueOnce(snapshot(['a', 'b', 'c'], T3));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    expect(f.fetchAppointments).toHaveBeenCalledTimes(3);
    expect(f.onSuccess).toHaveBeenCalledTimes(3);
    expect(f.onSuccess.mock.calls.map(call => call[0]?.appointments)).toEqual([
      ['a'],
      ['a', 'b'],
      ['a', 'b', 'c'],
    ]);
  });

  it('ignores start() while already running (no duplicate timer, still one fetch per interval)', async () => {
    // Garde-fou : si start() ne vérifiait pas l'état courant, trois appels
    // armeraient trois timers → trois fetchs au premier tick.
    const f = createFixture();
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));

    f.poller.start();
    f.poller.start();
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
  });

  it('ignores triggerRefresh() when the loop is not running', async () => {
    const f = createFixture();
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));

    f.poller.triggerRefresh(); // never started

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(f.fetchAppointments).not.toHaveBeenCalled();
    expect(f.onSuccess).not.toHaveBeenCalled();
    expect(f.poller.state).toBe('idle');
  });
});

// ===========================================================================
// SC2a — course lecture-après-écriture (application monotone) + single-flight
// ===========================================================================

describe('createAppointmentPoller — SC2a monotonic fetchedAt + single flight', () => {
  it('ignores a snapshot whose fetchedAt is OLDER than the last applied one (read-after-write race)', async () => {
    // Un poll parti avant une mutation et résolu après le refresh post-action
    // ne doit jamais faire régresser l'UI vers des données pré-mutation.
    const f = createFixture();
    f.fetchAppointments
      .mockResolvedValueOnce(snapshot(['after-mutation'], T2))
      .mockResolvedValueOnce(snapshot(['before-mutation'], T1)); // stale
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
    expect(f.onSuccess.mock.calls[0]?.[0]?.appointments).toEqual([
      'after-mutation',
    ]);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);
    // The stale snapshot is ignored ENTIRELY — no onSuccess, no regression.
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('ignores a snapshot whose fetchedAt EQUALS the last applied one', async () => {
    const f = createFixture();
    f.fetchAppointments
      .mockResolvedValueOnce(snapshot(['a'], T2))
      .mockResolvedValueOnce(snapshot(['b'], T2)); // same server stamp
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
    expect(f.onSuccess.mock.calls[0]?.[0]?.appointments).toEqual(['a']);
  });

  it('applies the first snapshot even when its fetchedAt is unparseable, then a valid snapshot still applies', async () => {
    const f = createFixture();
    f.fetchAppointments
      .mockResolvedValueOnce(snapshot(['a'], 'not-a-date'))
      .mockResolvedValueOnce(snapshot(['b'], T1));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
    expect(f.onSuccess.mock.calls[0]?.[0]?.appointments).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    // No valid stamp ever landed, so the monotonic marker is still unset and
    // the next snapshot applies regardless of its own stamp.
    expect(f.onSuccess).toHaveBeenCalledTimes(2);
    expect(f.onSuccess.mock.calls[1]?.[0]?.appointments).toEqual(['b']);
  });

  it('single-flights a tick firing while a fetch is still in flight (never two concurrent fetches)', async () => {
    const f = createFixture();
    const deferred = deferredSnapshot();
    f.fetchAppointments.mockReturnValue(deferred.promise);
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // tick 1 → fetch #1 in flight
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // tick 2 while fetch #1 pending
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);

    deferred.resolve(snapshot(['a'], T1));
    await flushMicrotasks();
    // The swallowed tick never became a second fetch.
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
    expect(f.onSuccess).toHaveBeenCalledTimes(1);

    // The loop survived: the swallowed tick re-armed, the next tick fetches.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);
  });

  it('single-flights triggerRefresh() during an in-flight poll (no second concurrent fetch, SC2a)', async () => {
    const f = createFixture();
    const deferred = deferredSnapshot();
    f.fetchAppointments.mockReturnValue(deferred.promise);
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // fetch #1 in flight
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);

    f.poller.triggerRefresh(); // post-action refresh during the poll
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1); // NOT started concurrently

    deferred.resolve(snapshot(['a'], T1));
    await flushMicrotasks();
    // Replayed on the same lane once the in-flight poll settled.
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);

    deferred.resolve(snapshot(['b'], T2));
    await flushMicrotasks();
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2); // no third call from this replay
  });
});

// ===========================================================================
// SC3 — visibilité
// ===========================================================================

describe('createAppointmentPoller — SC3 visibilité', () => {
  it('performs zero fetches while the tab is hidden, whatever the elapsed time', async () => {
    const f = createFixture();
    f.isVisible.mockReturnValue(false);
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 20);

    expect(f.fetchAppointments).not.toHaveBeenCalled();
    expect(f.onSuccess).not.toHaveBeenCalled();
    // The loop re-arms silently instead of dying while hidden.
    expect(f.poller.state).toBe('polling');
  });

  it('refetches immediately on visibility return, without waiting for the next tick', async () => {
    const f = createFixture();
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));
    f.poller.start();

    f.isVisible.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(f.fetchAppointments).not.toHaveBeenCalled();

    // What the hook calls on 'visibilitychange' → visible.
    f.isVisible.mockReturnValue(true);
    f.poller.triggerRefresh();

    expect(f.fetchAppointments).toHaveBeenCalledTimes(1); // immediate — no timer advance
    await flushMicrotasks();
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('replays exactly once a visibility refetch swallowed by an in-flight poll', async () => {
    const f = createFixture();
    const first = deferredSnapshot();
    const second = deferredSnapshot();
    f.fetchAppointments
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(snapshot(['c'], T3));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // fetch #1 in flight
    f.poller.triggerRefresh(); // visibility return during the poll
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);

    first.resolve(snapshot(['a'], T1));
    await flushMicrotasks();
    // Replayed immediately at settle — no timer advance needed.
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);

    second.resolve(snapshot(['b'], T2));
    await flushMicrotasks();
    // Never replayed twice.
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);

    // Normal cadence resumes from the replay's own settle.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(3);
    expect(f.onSuccess.mock.calls.map(call => call[0]?.appointments)).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('re-evaluates the gates at replay time: a replay queued while visible is not fetched when hidden at settle', async () => {
    const f = createFixture();
    const first = deferredSnapshot();
    f.fetchAppointments
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(snapshot(['a'], T1));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // fetch #1 in flight
    f.poller.triggerRefresh(); // replay queued while visible

    f.isVisible.mockReturnValue(false); // hidden again before the poll settles
    first.resolve(snapshot(['a'], T1));
    await flushMicrotasks();

    expect(f.fetchAppointments).toHaveBeenCalledTimes(1); // replay swallowed — hidden
    expect(f.onSuccess).toHaveBeenCalledTimes(1); // the poll's own snapshot applied

    // The loop re-armed: visible again, the next scheduled tick fetches.
    f.isVisible.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// SC4 — résilience (backoff ×2, cap 5 min, retour à 30 s au premier succès)
// ===========================================================================

describe('createAppointmentPoller — SC4 résilience', () => {
  it('doubles the interval on consecutive failures and caps it at maxBackoffMs: 30s→60s→120s→240s→300s→300s', async () => {
    const f = createFixture();
    const failure = new Error('network down');
    f.fetchAppointments.mockRejectedValue(failure);
    f.poller.start();

    // Failures land at t = 30s, 90s, 210s, 450s, 750s, 1050s — the gap doubles
    // after each failure until min(480s, 300s) = 300s, then stays capped.
    const steps = [
      POLL_INTERVAL_MS, // 30 s
      60_000,
      120_000,
      240_000,
      300_000, // cap reached: min(240 × 2, 300) = 300
      300_000, // stays capped: min(300 × 2, 300) = 300
    ];
    for (const [index, step] of steps.entries()) {
      await vi.advanceTimersByTimeAsync(step - 1);
      expect(
        f.fetchAppointments,
        `tick ${index + 1} must not fire early`,
      ).toHaveBeenCalledTimes(index);
      await vi.advanceTimersByTimeAsync(1);
      expect(
        f.fetchAppointments,
        `tick ${index + 1} must fire at the doubled interval`,
      ).toHaveBeenCalledTimes(index + 1);
    }

    expect(f.onError).toHaveBeenCalledTimes(6);
    expect(f.onError).toHaveBeenLastCalledWith(failure);
    expect(f.onSuccess).not.toHaveBeenCalled();
    expect(f.poller.state).toBe('backing-off');
    expect(MAX_BACKOFF_MS).toBe(300_000); // the cap under test is the spec constant
  });

  it('resets the interval to the base 30 s on the first success after failures', async () => {
    const f = createFixture();
    f.fetchAppointments
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue(snapshot(['a'], T1));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // t=30s: failure → interval 60 s
    expect(f.poller.state).toBe('backing-off');

    await vi.advanceTimersByTimeAsync(60_000); // t=90s: second tick SUCCEEDS
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);
    expect(f.poller.state).toBe('polling'); // backoff cleared

    // Base cadence restored: next tick 30 s after the success, not 60 s.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(3);
  });

  it('keeps the previously applied data on failure: onError fires, onSuccess never re-fires', async () => {
    const f = createFixture();
    const failure = new Error('boom');
    f.fetchAppointments
      .mockResolvedValueOnce(snapshot(['a'], T1))
      .mockRejectedValueOnce(failure);
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.onSuccess).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.onError).toHaveBeenCalledWith(failure);
    // The displayed data is preserved — no re-emit, never a callback with
    // undefined data.
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
    expect(f.onSuccess.mock.calls[0]?.[0]).toEqual({
      appointments: ['a'],
      fetchedAt: T1,
    });
  });
});

// ===========================================================================
// SC5 — non-intrusion (oracle poller pur : garde tiroir de création)
// ===========================================================================

describe('createAppointmentPoller — SC5 pause (tiroir de création ouvert)', () => {
  it('performs zero fetches while paused, even when visible and timers advanced', async () => {
    const f = createFixture();
    f.isPaused.mockReturnValue(true);
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 20);
    f.poller.triggerRefresh(); // gates are re-evaluated on every trigger too

    expect(f.fetchAppointments).not.toHaveBeenCalled();
    expect(f.onSuccess).not.toHaveBeenCalled();
    expect(f.poller.state).toBe('polling'); // loop intact, just gated
  });

  it('resumes fetching once unpaused', async () => {
    const f = createFixture();
    f.isPaused.mockReturnValue(true);
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(f.fetchAppointments).not.toHaveBeenCalled();

    f.isPaused.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// SC7 — fin de session (401/403 → arrêt irrévocable)
// ===========================================================================

describe('createAppointmentPoller — SC7 fin de session', () => {
  it('stops irrevocably on PollerAuthError(401): notifies with the status, then zero further fetches from timers, visibility, triggerRefresh or start()', async () => {
    const f = createFixture();
    let stateAtAuthError: PollerState | null = null;
    f.onAuthError.mockImplementation(() => {
      // The poller must stop BEFORE notifying — the callback observes a
      // stopped poller (redirect can proceed safely).
      stateAtAuthError = f.poller.state;
    });
    f.fetchAppointments.mockRejectedValue(new PollerAuthError(401));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
    expect(f.onAuthError).toHaveBeenCalledTimes(1);
    expect(f.onAuthError).toHaveBeenCalledWith(401);
    expect(stateAtAuthError).toBe('stopped');
    expect(f.poller.state).toBe('stopped');
    // Auth errors are never surfaced as poll errors.
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.onSuccess).not.toHaveBeenCalled();

    // Irrevocable: clock, visibility return, explicit refresh and restart are
    // ALL no-ops.
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 10);
    f.isVisible.mockReturnValue(true);
    f.poller.triggerRefresh();
    f.poller.start();
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 10);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
  });

  it('stops irrevocably on PollerAuthError(403) exactly like on 401', async () => {
    const f = createFixture();
    f.fetchAppointments.mockRejectedValue(new PollerAuthError(403));
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(f.onAuthError).toHaveBeenCalledTimes(1);
    expect(f.onAuthError).toHaveBeenCalledWith(403);
    expect(f.poller.state).toBe('stopped');

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 10);
    f.poller.triggerRefresh();
    f.poller.start();
    f.isVisible.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 10);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
  });

  it('drops a pending replay when the in-flight poll settles with an auth error', async () => {
    const f = createFixture();
    const deferred = deferredSnapshot();
    f.fetchAppointments.mockReturnValue(deferred.promise);
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // fetch #1 in flight
    f.poller.triggerRefresh(); // replay queued — must NOT survive the auth stop

    deferred.reject(new PollerAuthError(401));
    await flushMicrotasks();

    expect(f.onAuthError).toHaveBeenCalledWith(401);
    expect(f.poller.state).toBe('stopped');
    // The queued replay is dropped with the loop.
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
    f.poller.triggerRefresh();
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// getAuthErrorStatus — convention d'erreur d'auth partagée avec le hook (SC7)
// ===========================================================================

describe('getAuthErrorStatus', () => {
  it('extracts 401 and 403 from errors carrying a numeric status', () => {
    expect(getAuthErrorStatus(new PollerAuthError(401))).toBe(401);
    expect(getAuthErrorStatus(new PollerAuthError(403))).toBe(403);
    expect(
      getAuthErrorStatus(
        Object.assign(new Error('raw response'), { status: 403 }),
      ),
    ).toBe(403);
  });

  it('returns null for any other status, string status, missing status or non-object input', () => {
    expect(
      getAuthErrorStatus(Object.assign(new Error('srv'), { status: 500 })),
    ).toBeNull();
    expect(getAuthErrorStatus(new Error('plain'))).toBeNull();
    expect(
      getAuthErrorStatus(Object.assign(new Error('str'), { status: '401' })),
    ).toBeNull();
    expect(getAuthErrorStatus(null)).toBeNull();
    expect(getAuthErrorStatus('401')).toBeNull();
    expect(getAuthErrorStatus(undefined)).toBeNull();
  });
});

// ===========================================================================
// Lifecycle stop()/start() — contraste avec l'arrêt d'authentification (SC7)
// ===========================================================================

describe('createAppointmentPoller — manual stop()/start() lifecycle', () => {
  it('stop() halts the loop and silently drops an in-flight result', async () => {
    const f = createFixture();
    const deferred = deferredSnapshot();
    f.fetchAppointments.mockReturnValue(deferred.promise);
    f.poller.start();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);

    f.poller.stop();
    expect(f.poller.state).toBe('stopped');

    deferred.resolve(snapshot(['a'], T1));
    await flushMicrotasks();
    // The in-flight result is dropped — no callback, no replay.
    expect(f.onSuccess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);
  });

  it('start() works again after a manual stop() (unlike an auth stop — SC7 contrast)', async () => {
    const f = createFixture();
    f.fetchAppointments.mockResolvedValue(snapshot(['a'], T1));
    f.poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(1);

    f.poller.stop();
    f.poller.start();
    expect(f.poller.state).toBe('polling');

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(f.fetchAppointments).toHaveBeenCalledTimes(2);
  });
});
