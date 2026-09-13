/**
 * Netlify Scheduled Function — calendar-keepwarm
 *
 * Runs every 10 minutes to keep the Google OAuth access token warm: when less
 * than 15 minutes of validity remain, the token is refreshed proactively and
 * the rotation persisted. The patient-facing availability path never pays the
 * OAuth refresh latency on a cold request — it always finds a token with a
 * comfortable validity window.
 *
 * V2 (T6) adds the second half of the run: unless the token step is
 * DEFINITIVELY broken (no token row / empty refresh_token / invalid_grant)
 * or transient without enough persisted margin (issue #153 / SC2), the four
 * availability cache keys the booking wizard reads ({in-person,
 * video} × {60, 90}, weeks=4) are pre-computed, so patients are served from a
 * warm cache instead of paying the Google Freebusy round-trip. The warm-up
 * runs on the ONE authenticated OAuth2Client the token step returns
 * (KeepwarmSession) — no per-call fallback, no hidden token refresh: the
 * fall-through is only admitted when the persisted token keeps > 6 min of
 * validity (eager refresh threshold 5 min + 60 s of warm-up budget). Since
 * the mono-snapshot (issue #153 / SC3) the whole warm-up performs exactly ONE
 * availability-snapshot load (one manual-slots read + one Freebusy query)
 * and derives the four games purely from it; a snapshot failure writes
 * NOTHING and preserves existing cache entries (issue #153 / SC5).
 *
 * Supersedes AND deletes calendar-token-heartbeat.ts (weekly refresh against
 * Google's ~6-month idle revocation): this 10-minute cadence keeps the token
 * continuously fresh, which covers the weekly anti-revocation concern a
 * fortiori. The heartbeat file is removed in this same PR (#132).
 *
 * Scope: V1 (issue #132 / T2) — token keep-warm. V2 (T6) — availability-cache
 * warm-up, see warmAvailabilityCache() below.
 *
 * Schedule: every 10 minutes (UTC). The crontab is a plain 5-field expression
 * (minute step 10) so Sentry.withMonitor's MonitorSchedule type accepts it, and
 * the const is shared between Netlify config and the Sentry monitor.
 *
 * NOTE: never write the crontab literal inside a block comment — its leading
 * star-slash sequence terminates the JSDoc early and breaks the parser.
 *
 * Runtime budget: Netlify scheduled functions are synchronous with a default
 * 10 s timeout (no [functions] timeout is declared in netlify.toml; the site
 * ceiling is ~26 s). maxRuntime: 5 below is a Sentry-side classification
 * window, NOT an enforceable budget — the run itself must stay well under
 * 10 s.
 *
 * Observabilité : enveloppé par Sentry.withMonitor (détection de non-exécution).
 *
 * ⚠️  Runtime: Node.js (Netlify Functions) — import.meta.env is NOT available.
 *     All env vars are read via process.env.
 *
 * ⚠️  Dependencies — all already present in package.json:
 *   "googleapis"           ✓
 *   "@supabase/supabase-js" ✓
 *   "@netlify/functions"   ✓ (devDependencies)
 *   "react"                ✓
 *   "@react-email/render"  ✓
 *   "resend"               ✓
 *
 * Env vars required (configure in Netlify dashboard):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   SUPABASE_DATABASE_URL    — Supabase REST URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key
 *   ADMIN_EMAIL              — alert recipient on invalid_grant
 *   RESEND_API_KEY           — for alert emails
 *   GOOGLE_CALENDAR_ID       — consumed by the availability warm-up, NOT by
 *                              the token step: missing → warn + continue
 *                              (warm-up skipped; no Sentry error spam)
 *   GOOGLE_OAUTH_REDIRECT_URI (optional, fallback: https://developers.google.com/oauthplayground)
 *   SITE_URL                  (optional, fallback: https://omf-therapie.fr)
 *   RESEND_FROM_EMAIL         (optional, fallback: OMF Thérapie <contact@omf-therapie.fr>)
 *   PUBLIC_SENTRY_DSN         (optional — Sentry instrumentation)
 */

import type { Config } from '@netlify/functions';
import * as Sentry from '@sentry/node';
import { createElement } from 'react';
import { createClient } from '@supabase/supabase-js';
// google-auth-library's eager-refresh threshold (5 min): a signed API call
// with less remaining validity triggers a HIDDEN token-endpoint refresh. The
// root package does not re-export this constant — it lives in the authclient
// submodule (google-auth-library is a direct dependency).
import { DEFAULT_EAGER_REFRESH_THRESHOLD_MILLIS } from 'google-auth-library/build/src/auth/authclient';
import { google } from 'googleapis';
import ws from 'ws';
// Leaf import for the invalid_grant email-cooldown state (see
// sendInvalidGrantAlert). No new dependency: @netlify/blobs is already part of
// the cron bundle — src/lib/calendar-cache.ts (pulled in by the warm-up below)
// imports the same package.
import { getStore } from '@netlify/blobs';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import CalendarAuthAlert from '../../src/emails/CalendarAuthAlert.js';
// src/lib imports — same specifier style as reconcile-invitations.ts (relative,
// no .js suffix): the lazy-init refactors (#126 / T12) make this module graph
// safe to bundle into the plain-Node cron runtime.
import {
  filterSlotsByBusy,
  generateSlotsForRange,
  loadAvailabilitySnapshot,
  type AvailabilitySnapshot,
  type KeepwarmSession,
} from '../../src/lib/google-calendar';
import {
  buildAvailabilityCacheKey,
  setCachedAvailability,
  type CacheWriteResult,
} from '../../src/lib/calendar-cache';
import { initSentry, captureAndFlush } from './_lib/sentry';
import { logger } from './_lib/logger';

// ---------------------------------------------------------------------------
// Schedule config
// ---------------------------------------------------------------------------

/** Every 10 minutes. Explicit crontab — see file header. */
const SCHEDULE = '*/10 * * * *' as const;

export const config: Config = {
  // ⚠️ NE PAS remplacer par la const SCHEDULE ci-dessus — l'extracteur statique
  // de Netlify (@netlify/zip-it-and-ship-it, parsePrimitive) ne résout QUE les
  // littéraux (StringLiteral), pas les Identifier. `schedule: SCHEDULE` produit
  // `schedule: null` côté Netlify → le scheduler ne déclenche plus (regression
  // #113 introduite par #75). Le littéral DOIT rester inline ici ; le dupliquer
  // avec SCHEDULE est volontaire (DRY brisée par contrainte du bundler).
  schedule: '*/10 * * * *',
  // No schedule_timezone → Netlify defaults to UTC (matches Sentry monitor default).
};

// ---------------------------------------------------------------------------
// Refresh threshold — pure decision, exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Refresh when less than 15 minutes of validity remain: one full cron period
 * (10 min) plus margin, so the next run always finds a usable token even if
 * this run's refresh fails.
 */
const REFRESH_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Minimum validity the PERSISTED token must keep for a refresh-failure
 * fall-through to be admitted as 'ok' (issue #153 / SC2):
 *
 *   google-auth-library's eager refresh threshold (5 min — a signed API call
 *   with less remaining triggers a HIDDEN token-endpoint refresh inside the
 *   library) + 60 s of warm-up budget.
 *
 * Why 5 min alone is NOT enough: the availability snapshot (manual-slots
 * read, key building) runs BETWEEN this check and the Freebusy calls — ~500 ms
 * of latency re-crosses the eager threshold and sneaks a second token-endpoint
 * call into the run. The 6-min gate makes that structurally impossible
 * (SC2: ≤ 1 token-endpoint interaction per run).
 *
 * This gate governs the fall-through and session admission ONLY — the
 * proactive refresh TRIGGER above (15 min) is unchanged.
 */
const WARMUP_MIN_TOKEN_VALIDITY_MS =
  DEFAULT_EAGER_REFRESH_THRESHOLD_MILLIS + 60_000;

/**
 * Run-level upstream deadline (revue #154): Netlify scheduled functions are
 * synchronous with a 10 s default platform timeout. Every upstream call —
 * token row read, token refresh, shared snapshot, cache writes — is bounded
 * by ONE shared deadline that leaves the last ~2 s for classification, final
 * telemetry and the `Sentry.flush(2000)` of runKeepwarm's finally block. A
 * stalled socket must never reach the platform kill before the run has been
 * classified: the deadline converts the stall into a typed 'transient' /
 * failed-write outcome instead.
 */
const RUN_DEADLINE_MS = 8_000;

/** Typed marker for "the shared run deadline fired at this stage". */
class KeepwarmDeadlineError extends Error {
  readonly stage: string;
  constructor(stage: string) {
    super(`calendar-keepwarm: run deadline exceeded at stage ${stage}`);
    this.name = 'KeepwarmDeadlineError';
    this.stage = stage;
  }
}

interface RunDeadline {
  /** Aborted the moment the deadline fires — thread into abortable requests. */
  signal: AbortSignal;
  /** Milliseconds left before the deadline (0 once fired). */
  msRemaining(): number;
  /** Binds a non-abortable promise to the deadline (blobs writes, refresh). */
  race<T>(stage: string, promise: Promise<T>): Promise<T>;
  /** Releases the global deadline timer (call once the run's I/O is done). */
  dispose(): void;
}

function createRunDeadline(): RunDeadline {
  const controller = new AbortController();
  const deadlineAt = Date.now() + RUN_DEADLINE_MS;
  const fire = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  // race() alone only bounds the promises handed to it; this global timer
  // guarantees the controller fires at the deadline even for signal-only I/O
  // (the token-row read, the snapshot's Supabase stage) — a stall becomes a
  // classified transient, never a platform kill. keepwarm() releases the
  // timer in its finally once the run's I/O is done.
  const timer = setTimeout(fire, RUN_DEADLINE_MS);
  return {
    signal: controller.signal,
    msRemaining: () => Math.max(0, deadlineAt - Date.now()),
    dispose: (): void => {
      clearTimeout(timer);
    },
    race<T>(stage: string, promise: Promise<T>): Promise<T> {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        fire();
        return Promise.reject(new KeepwarmDeadlineError(stage));
      }
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          fire();
          reject(new KeepwarmDeadlineError(stage));
        }, remaining);
        promise.then(
          value => {
            clearTimeout(timer);
            resolve(value);
          },
          err => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    },
  };
}

/**
 * Pure predicate — no I/O when `nowMs` is injected (defaults to Date.now() so
 * expiry-only calls work; inject `nowMs` for deterministic unit tests).
 *
 * Semantics:
 *   - expiryDateMs null  → true  (unknown validity — refresh defensively)
 *   - expiry in the past → true  (expired)
 *   - remaining validity < thresholdMs → true
 *   - exactly at threshold → false (strict `<`, not `<=`)
 */
export function shouldRefreshToken(
  expiryDateMs: number | null,
  nowMs: number = Date.now(),
  thresholdMs: number = REFRESH_THRESHOLD_MS,
): boolean {
  if (expiryDateMs === null) return true;
  return expiryDateMs - nowMs < thresholdMs;
}

// ---------------------------------------------------------------------------
// Helper — send alert email on invalid_grant (24h email cooldown)
// ---------------------------------------------------------------------------

// --- Cooldown state (Netlify Blobs) -----------------------------------------
//
// Why a cooldown: with the retired weekly heartbeat, one alert email per
// incident was acceptable. At a 10-minute cadence a persistent invalid_grant
// (only the therapist can fix it — manual re-authorization, often days later)
// would send up to 144 identical emails/day. Sentry captures keep firing on
// every run (Sentry's server-side dedup handles those); only the admin EMAIL
// is throttled. The 24h window is enforced on READ (timestamp compare)
// because @netlify/blobs exposes no TTL option on set() — the same constraint
// documented in src/lib/calendar-cache.ts.

const ALERT_STATE_STORE = 'calendar-keepwarm-state';
const INVALID_GRANT_ALERT_KEY = 'invalid-grant-alert';
const ALERT_COOLDOWN_MS = 24 * 3600 * 1000;

/**
 * True when no invalid_grant alert email went out in the last 24h.
 *
 * FAILS OPEN: on any Blobs error the answer is "send" — a broken state store
 * must never suppress re-authorization alerts (alert delivery beats
 * storm-protection when state storage is broken).
 */
async function invalidGrantAlertDue(): Promise<boolean> {
  try {
    const store = await getStore(ALERT_STATE_STORE);
    const lastSentIso = await store.get(INVALID_GRANT_ALERT_KEY);
    if (lastSentIso) {
      const lastSentMs = Date.parse(lastSentIso);
      if (
        Number.isFinite(lastSentMs) &&
        Date.now() - lastSentMs < ALERT_COOLDOWN_MS
      ) {
        logger.info(
          'calendar-keepwarm: invalid_grant alert throttled — email already sent within 24h',
        );
        return false;
      }
    }
    return true;
  } catch {
    logger.warn(
      'calendar-keepwarm: alert cooldown state unavailable — sending anyway (fail open)',
    );
    // The cooldown is best-effort, but a broken state store escalates to repeat emails — it must be alertable.
    Sentry.captureMessage(
      'calendar-keepwarm: alert cooldown state unavailable — failing open',
      'warning',
    );
    return true;
  }
}

/**
 * Records a successful alert send. Best effort: a failed write only means the
 * cooldown may not apply on the next run (repeat emails until Blobs recovers)
 * — accepted by the fail-open policy above.
 */
async function markInvalidGrantAlertSent(): Promise<void> {
  try {
    const store = await getStore(ALERT_STATE_STORE);
    await store.set(INVALID_GRANT_ALERT_KEY, new Date().toISOString());
  } catch {
    logger.warn(
      'calendar-keepwarm: failed to record alert send — cooldown may not apply on the next run',
    );
    // The cooldown is best-effort, but a broken state store escalates to repeat emails — it must be alertable.
    Sentry.captureMessage(
      'calendar-keepwarm: failed to record alert send — cooldown may not apply',
      'warning',
    );
  }
}

async function sendInvalidGrantAlert(
  adminEmail: string,
  siteUrl: string,
  resendApiKey: string,
  fromEmail: string,
): Promise<void> {
  // 24h email cooldown (see the cooldown block above). Checked here so BOTH
  // call sites (null refresh_token row, invalid_grant refresh failure) are
  // covered.
  if (!(await invalidGrantAlertDue())) return;

  const reauthorizeUrl = `${siteUrl}/api/admin/google-oauth/`;

  try {
    const resend = new Resend(resendApiKey);
    const html = await render(
      createElement(CalendarAuthAlert, { reauthorizeUrl }),
    );
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: [adminEmail],
      subject: '⚠️ Google Calendar — re-autorisation requise',
      html,
    });
    if (error) {
      logger.error(
        'calendar-keepwarm: alert email failed (Resend error)',
        { adminEmail },
        error,
      );
    } else {
      // Arm the cooldown only after a CONFIRMED send — a failed send retries
      // on the next run instead of being silenced for 24h.
      await markInvalidGrantAlertSent();
      logger.info('calendar-keepwarm: alert email sent', { adminEmail });
    }
  } catch (err: unknown) {
    logger.error('calendar-keepwarm: alert email threw', { adminEmail }, err);
  }
}

// ---------------------------------------------------------------------------
// Availability-cache warm-up (V2 — issue #132 / T6)
// ---------------------------------------------------------------------------

/** The booking wizard always requests weeks=4 — the only keys the patient path reads. */
const WARMUP_WEEKS = 4;

/**
 * 15 minutes, deliberately longer than the 10-minute cron cadence so a patient
 * request between two runs never hits a miss window; the read path layers its
 * own freshness bounds on top.
 */
const WARMUP_TTL_SECONDS = 900;

/**
 * Pre-computes the four availability cache keys the booking path reads
 * ({in-person, video} × {60, 90}, weeks=4), so a patient request is served
 * from the cache instead of paying the Google Freebusy round-trip.
 *
 * MONO-SNAPSHOT (issue #153 / SC3): the whole run is served by ONE
 * `loadAvailabilitySnapshot` call on the ok session's authenticated client —
 * exactly one `manual_time_slots` read and one Freebusy query. The four games
 * are then derived PURELY (`generateSlotsForRange` + the shared
 * `filterSlotsByBusy`, issue #153 / N3) — no per-game I/O, no
 * getAvailableSlots fan-out (removed with #153). The cron performs no token
 * lookup and no hidden refresh of its own.
 *
 * A snapshot failure is a SHARED-STAGE failure (issue #153 / SC5): NOTHING is
 * written — existing Blobs entries are preserved, never overwritten with a
 * partial or empty derivation — and the failed stage is logged. No
 * invalid_grant alert originates here: token alerts stay in keepTokenWarm().
 *
 * dbBusy is deliberately empty: DB appointments change minute to minute and
 * the read path re-applies live busy filtering on every cache hit
 * (filterSlotsByBusy) — warm entries must not bake busy state in. Mock mode
 * (GOOGLE_CALENDAR_MOCK=true) yields an empty snapshot with zero I/O; the
 * derived dev slots then hit the store's mock short-circuit
 * ('skipped-no-store') — unchanged dev semantics.
 */
export async function warmAvailabilityCache(
  session: KeepwarmSession,
  deadline?: RunDeadline,
): Promise<void> {
  // Structural gate (issue #153 / SC2): only an 'ok' session carries the
  // authenticated client the snapshot needs. (keepwarm() already gates on
  // 'ok'; this guard keeps the function safe on its own.)
  if (session.status !== 'ok') {
    logger.info(
      'calendar-keepwarm: availability warm-up skipped — session is not ok',
      { status: session.status },
    );
    return;
  }

  // Skip rather than fail: without a calendar id the snapshot's Freebusy
  // query would throw the same configuration error every 10 minutes. One
  // short warn here, NOT a captured error.
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    logger.warn(
      'calendar-keepwarm: GOOGLE_CALENDAR_ID missing — skipping availability warm-up',
    );
    return;
  }

  // KEEP IN SYNC with the booking wizard's options
  // (src/components/booking/BookingWizard.tsx — mode picker + duration picker)
  // and the availability API's accepted values: the wizard only ever requests
  // these {mode} × {duration} × weeks=4 keys. A wizard change without a
  // matching change here SILENTLY invalidates the warm-up — the cron would
  // warm keys nobody requests while patients pay the cold Freebusy
  // round-trip again.
  const modes = ['in-person', 'video'] as const;
  const durations = [60, 90] as const;
  const now = new Date();
  // 4 weeks ahead in ms — same horizon as the availability API's weeks=4.
  const end = new Date(now.getTime() + WARMUP_WEEKS * 7 * 24 * 3600 * 1000);

  // ONE shared snapshot for the whole run (issue #153 / SC3), bounded by the
  // run deadline when one is provided (revue #154): the manual-slots read
  // carries the abort signal and the Freebusy query gets a per-request
  // timeout through gaxios — a stalled upstream aborts into the typed
  // shared-stage failure below (SC5: zero writes, entries preserved).
  let snapshot: AvailabilitySnapshot;
  try {
    snapshot = await loadAvailabilitySnapshot(
      session.oauth2Client,
      now,
      end,
      deadline
        ? { timeoutMs: deadline.msRemaining(), signal: deadline.signal }
        : undefined,
    );
  } catch (err: unknown) {
    // Shared-stage failure (issue #153 / SC5): the snapshot is unusable, so
    // the run writes NOTHING and every existing cache entry survives. The
    // typed error's message is sanitized and names the failed stage; the raw
    // error object is never logged (its payloads may embed credentials), and
    // no invalid_grant alert is sent from this path.
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(
      'calendar-keepwarm: availability snapshot failed (shared stage) — no cache write, existing entries preserved',
      { stage: 'availability-snapshot', reason },
    );
    Sentry.captureMessage(
      `calendar-keepwarm: availability snapshot failed (stage: availability-snapshot): ${reason}`,
      'warning',
    );
    return;
  }

  const pairs = modes.flatMap(mode =>
    durations.map(duration => ({ mode, duration })),
  );

  // Pure derivation ×4 (issue #153 / N3) — deterministic, zero I/O: the same
  // engine the patient path runs, from the ONE snapshot.
  const games = pairs.map(({ mode, duration }) => ({
    mode,
    duration,
    slots: filterSlotsByBusy(
      generateSlotsForRange({
        startDate: now,
        endDate: end,
        duration,
        mode,
        now,
        manualSlots: snapshot.manualSlots,
      }),
      snapshot.busyPeriods,
    ),
  }));

  // Strict writes (issue #153 / SC6): every write reports an explicit
  // CacheWriteResult; 'written' counts CONFIRMED writes only. Sequential on
  // purpose — four tiny writes, deterministic log order. When a run deadline
  // is provided each write is raced against it (revue #154): a stall counts
  // as a failed write in the telemetry, never an unclassified hang.
  let written = 0;
  let failed = 0;
  for (const { mode, duration, slots } of games) {
    const key = buildAvailabilityCacheKey(mode, duration, WARMUP_WEEKS, now);
    let result: CacheWriteResult;
    try {
      const write = setCachedAvailability(key, slots, WARMUP_TTL_SECONDS);
      result = deadline
        ? await deadline.race(`cache-write:${mode}/${duration}`, write)
        : await write;
    } catch {
      result = 'failed';
    }
    if (result === 'written') {
      written += 1;
      continue;
    }
    if (result === 'skipped-no-store') {
      // Mock mode (or no Blobs context): dev short-circuit — neither a
      // confirmed write nor a failure.
      continue;
    }
    failed += 1;
    logger.error('calendar-keepwarm: availability cache write failed', {
      mode,
      duration,
    });
    Sentry.captureMessage(
      `calendar-keepwarm: availability cache write failed (${mode}/${duration})`,
      'warning',
    );
  }

  logger.info('calendar-keepwarm: availability cache warm-up complete', {
    computed: games.length,
    written,
    failed,
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Sentry.withMonitor wraps the work so missed runs raise a Sentry alert.
//
// CRITICAL: `withMonitor(slug, callback, opts)` returns `T` (the callback's
// return value), NOT a function. Exporting it directly breaks Netlify's
// bootstrap (`handler is not a function` TypeError silently fails every run).
// Wrap it in a real handler function Netlify can invoke.
//
// CRITICAL #2 (regression #113): `initSentry()` MUST run BEFORE
// `Sentry.withMonitor()`. `withMonitor` emits an `in_progress` check-in at
// entry, and THAT check-in is the only one carrying the `monitor_config`
// (with `checkInMargin`). If the client isn't initialized yet, the envelope
// is dropped → Sentry never receives the margin → `checkin_margin: null` →
// missed-run detection uses the (tighter) default. initSentry() is idempotent
// (guarded by `initialized`).
async function handler(): Promise<void> {
  initSentry();
  return Sentry.withMonitor('calendar-keepwarm', runKeepwarm, {
    schedule: { type: 'crontab', value: SCHEDULE },
    checkInMargin: 2,
    maxRuntime: 5,
  });
}

async function runKeepwarm(): Promise<void> {
  try {
    await keepwarm();
  } catch (err) {
    await captureAndFlush(err);
    throw err;
  } finally {
    if (process.env.PUBLIC_SENTRY_DSN) {
      await Sentry.flush(2000);
    }
  }
}

export default handler;

// ---------------------------------------------------------------------------
// Token keep-warm step (V1 — issue #132 / T2)
// ---------------------------------------------------------------------------

// The token-step outcome type is `KeepwarmSession`
// (src/lib/google-calendar.ts, imported above) — the STRUCTURAL gate for the
// availability warm-up in keepwarm(). See its doc block for the full
// 3-state contract (issue #153 / SC2).

/** Env values keepwarm() has already validated — passed down, not re-read. */
interface TokenKeepwarmEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  adminEmail: string;
  siteUrl: string;
  resendApiKey: string;
  fromEmail: string;
}

/**
 * Runs one token keep-warm pass: load the persisted token row, refresh when
 * less than 15 min of validity remain, persist the rotated credentials.
 * Returns the KeepwarmSession — never throws for expected auth failures.
 * The 'ok' session carries the AUTHENTICATED client the whole warm-up run
 * builds on (issue #153 / SC2). Every upstream call is bounded by `deadline`
 * (revue #154): a stalled read/refresh is classified, never left to the
 * platform kill.
 */
async function keepTokenWarm(
  env: TokenKeepwarmEnv,
  deadline: RunDeadline,
): Promise<KeepwarmSession> {
  // Service-role client: this cron owns the token row (no RLS session).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient<any>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });

  const oauth2Client = new google.auth.OAuth2(
    env.clientId,
    env.clientSecret,
    env.redirectUri,
  );

  // Load persisted token from DB. `updated_at` is the CAS witness for the
  // refresh persist below (issue #153 / SC8). The read carries the run
  // deadline's abort signal (revue #154) so a stalled connection aborts
  // BEFORE the platform timeout — an abort is classified transient below,
  // never "no row" and never an unclassified monitor error.
  let tokensResult: {
    data: {
      refresh_token: string | null;
      access_token: string | null;
      expiry_date: number | null;
      updated_at: string;
    } | null;
    error: { code?: string } | null;
  };
  try {
    tokensResult = await supabase
      .from('google_oauth_tokens')
      .select('refresh_token, access_token, expiry_date, updated_at')
      .eq('id', 'therapist')
      .abortSignal(deadline.signal)
      .single();
  } catch (err: unknown) {
    // Deadline abort on the read: same transient classification as a fetch
    // error. Classified on the signal ALONE (revue #154): upstream clients
    // may represent an abort differently than `name === 'AbortError'`, and
    // once the run deadline has fired the read's outcome is a deadline
    // overrun by definition. ANY other throw keeps the S4 contract (capture +
    // rethrow — the monitor run is marked errored).
    if (!deadline.signal.aborted) {
      throw err;
    }
    logger.warn(
      'calendar-keepwarm: token row read failed (transient) — warm-up skipped this run',
      { code: 'deadline-abort' },
    );
    Sentry.captureMessage(
      'calendar-keepwarm: token row read failed (transient) — warm-up skipped this run',
      'warning',
    );
    return { status: 'transient', reason: 'deadline-exceeded' };
  }
  const { data: tokens, error: fetchError } = tokensResult;

  // Classify the read failure (issue #153 / SC2): a transient fetch error
  // (network, 5xx, timeout) is NOT "no row" — it must not be reported as
  // auth-broken. PGRST116 = .single() matched no row → definitively broken
  // (unchanged #132 behavior, handled by the guard below); anything else is
  // transient infra: log + capture sanitisée, PAS d'email (l'alerte email
  // reste réservée à invalid_grant), warm-up skipped this run. La capture
  // est le seul signal durable : le run reste vert et le moniteur cron ne
  // détecte que les runs manquants, pas les runs no-op — une panne DB
  // persistante serait sinon invisible (revue #154). La dédup server-side
  // Sentry absorbe la répétition à chaque run.
  if (fetchError && fetchError.code !== 'PGRST116') {
    logger.warn(
      'calendar-keepwarm: token row read failed (transient) — warm-up skipped this run',
      { code: fetchError.code },
    );
    // Sanitisée : seul le libellé fixe circule — jamais le message brut.
    Sentry.captureMessage(
      'calendar-keepwarm: token row read failed (transient) — warm-up skipped this run',
      'warning',
    );
    return { status: 'transient', reason: 'token-row-read-failed' };
  }

  // No token row = definitively broken: nothing to keep warm, and the warm-up
  // has no credentials to authenticate its Freebusy calls with either.
  if (!tokens) {
    const msg =
      'calendar-keepwarm: no token row in DB — nothing to keep warm. Connect Google Calendar first.';
    logger.warn(msg, { fetchError });
    Sentry.captureMessage(msg, 'error');
    return { status: 'auth-broken' };
  }

  if (!tokens.refresh_token) {
    const msg =
      'calendar-keepwarm: token row exists but refresh_token is null — re-authorization required';
    logger.error(msg);
    // Same every-run capture as the invalid_grant branch — the cron monitor
    // stays green here, so Sentry is the only durable signal if the alert
    // email itself fails (e.g. Resend down).
    Sentry.captureMessage(msg, 'error');
    await sendInvalidGrantAlert(
      env.adminEmail,
      env.siteUrl,
      env.resendApiKey,
      env.fromEmail,
    );
    return { status: 'auth-broken' };
  }

  // Token keep-warm — refresh only when the validity window runs short.
  // An EMPTY persisted access_token forces the refresh too (revue #154):
  // google-auth-library treats '' as absent (`!this.credentials.access_token`
  // → eager refresh), so admitting it would hand the warm-up a client that
  // refreshes hiddenly on its first signed call — the exact SC2 violation.
  if (
    shouldRefreshToken(tokens.expiry_date ?? null, Date.now()) ||
    !tokens.access_token
  ) {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

    try {
      const { credentials } = await deadline.race(
        'token-refresh',
        oauth2Client.refreshAccessToken(),
      );

      // A refresh response WITHOUT an access token is unusable (revue #154):
      // persisting `access_token: ''` would poison the row, and admitting the
      // session would re-create the hidden-refresh trap. Reject the response —
      // classified transient, the next run retries.
      if (!credentials.access_token) {
        const msg =
          'calendar-keepwarm: token refresh returned no access_token — warm-up skipped this run';
        logger.warn(msg);
        Sentry.captureMessage(msg, 'warning');
        return {
          status: 'transient',
          reason: 'refresh-response-missing-access-token',
        };
      }

      const updated = {
        access_token: credentials.access_token ?? '',
        // google-auth-library's refreshAccessToken() never surfaces a
        // server-rotated refresh token: it echoes back the credential it was
        // given, so this persists the same refresh_token we loaded. Google
        // does not currently rotate refresh tokens out-of-band; if it ever
        // does, this path will keep persisting the ORIGINAL token and needs
        // revisiting.
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date: credentials.expiry_date ?? Date.now() + 3600 * 1000,
        updated_at: new Date().toISOString(),
      };

      // Verify the write AND guard it with CAS (issue #153 / SC8): the UPDATE
      // may only overwrite the row AS READ — `.eq('updated_at', <value read
      // at select time>)` — so a newer write (reconnexion callback,
      // concurrent refresh) always survives. Chaining .select('id').single()
      // surfaces a zero-row conditional update as PGRST116.
      const { data: persisted, error: updateError } = await supabase
        .from('google_oauth_tokens')
        .update(updated)
        .eq('id', 'therapist')
        .eq('updated_at', tokens.updated_at)
        .abortSignal(deadline.signal)
        .select('id')
        .single();

      if (updateError && updateError.code !== 'PGRST116') {
        // Infra error on the conditional UPDATE (5xx / timeout / network) —
        // a TRANSIENT error, NEVER a collision: reconcile with a re-read and
        // keep the W2 observability. NOT 'auth-broken': the in-memory token
        // is fresh (refreshAccessToken() set it on the client) and the next
        // run self-heals. Sanitized fields only, no raw error object.
        const reread = await supabase
          .from('google_oauth_tokens')
          .select('updated_at')
          .eq('id', 'therapist')
          .single()
          .then(
            result => result,
            () => null,
          );
        logger.error(
          'calendar-keepwarm: refreshed token NOT confirmed persisted (transient infra)',
          {
            persistErrorCode: updateError.code ?? 'unknown',
            currentUpdatedAt: reread?.data?.updated_at ?? 'unavailable',
          },
        );
        // The run still succeeds ('ok' → warm-up proceeds), so the Sentry
        // monitor stays green: a persist failure recurring every 10 min
        // would otherwise never surface. Sanitized fields only.
        Sentry.captureMessage(
          'calendar-keepwarm: refreshed token NOT confirmed persisted — warm-up proceeds on the persisted token',
          'warning',
        );
        return { status: 'ok', oauth2Client };
      }

      if (!persisted) {
        // CAS MISS: zero rows matched — a NEWER version of the row exists
        // (reconnexion callback or a concurrent writer). Benign by design:
        // reconcile (re-read for the log), preserve the recent row, and
        // continue on the in-memory credentials. Never fatal, never an alert;
        // the next run re-reads the fresh row anyway.
        const reread = await supabase
          .from('google_oauth_tokens')
          .select('updated_at')
          .eq('id', 'therapist')
          .single()
          .then(
            result => result,
            () => null,
          );
        logger.warn('calendar-keepwarm: CAS miss — ligne récente préservée', {
          readUpdatedAt: tokens.updated_at,
          currentUpdatedAt: reread?.data?.updated_at ?? 'unavailable',
        });
        return { status: 'ok', oauth2Client };
      }

      // Success log only on a confirmed write.
      logger.info('calendar-keepwarm: token refreshed and persist confirmed');
      // refreshAccessToken() already set the fresh credentials on the client.
      return { status: 'ok', oauth2Client };
    } catch (err: unknown) {
      // invalid_grant → token revoked, alert admin (24h email cooldown — see
      // sendInvalidGrantAlert) and skip the warm-up: auth is definitively
      // broken.
      const errData = (err as { response?: { data?: { error?: string } } })
        ?.response?.data;
      if (errData?.error === 'invalid_grant') {
        logger.error(
          'calendar-keepwarm: invalid_grant — token revoked, sending alert to admin',
        );
        await sendInvalidGrantAlert(
          env.adminEmail,
          env.siteUrl,
          env.resendApiKey,
          env.fromEmail,
        );
        // Capture a sanitized error only — NEVER the raw GaxiosError: its
        // response/config payloads may embed client_secret / refresh_token.
        Sentry.captureException(
          new Error('Google OAuth token refresh failed: invalid_grant'),
        );
        return { status: 'auth-broken' };
      }

      // Run out of time — no fall-through admission once the deadline fired
      // (revue #154): the remaining budget is reserved for classification and
      // the Sentry flush. The invalid_grant branch above keeps priority — a
      // definitive auth error arriving at the deadline must still alert.
      if (deadline.signal.aborted) {
        return { status: 'transient', reason: 'deadline-exceeded' };
      }

      // Transient failure (network blip, Google 5xx, quota…). The fall-through
      // GATE (issue #153 / SC2): admit 'ok' ONLY if the PERSISTED token still
      // keeps > WARMUP_MIN_TOKEN_VALIDITY_MS of validity — otherwise the
      // warm-up's signed calls could cross the library's eager refresh
      // threshold mid-run and trigger a HIDDEN token-endpoint refresh.
      const remainingMs =
        typeof tokens.expiry_date === 'number'
          ? tokens.expiry_date - Date.now()
          : null;

      // Empty persisted access_token: the fall-through can NEVER be admitted
      // (revue #154) — a client seeded with '' refreshes hiddenly on its first
      // signed call (google-auth-library's eager path), breaking SC2's
      // one-token-endpoint-interaction budget even with ample expiry margin.
      if (!tokens.access_token) {
        logger.warn(
          'calendar-keepwarm: token refresh failed (transient) — persisted access_token empty, fall-through refused, warm-up skipped this run',
        );
        Sentry.captureException(
          new Error(
            'Google OAuth token refresh failed (transient) — persisted access_token empty, fall-through refused',
          ),
        );
        return {
          status: 'transient',
          reason: 'missing-persisted-access-token',
        };
      }

      if (remainingMs !== null && remainingMs > WARMUP_MIN_TOKEN_VALIDITY_MS) {
        // Fall-through admitted: serve the warm-up from the persisted
        // credentials, straight from the row. The raw error is NOT logged —
        // sanitized fields only.
        oauth2Client.setCredentials({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date,
        });
        const responseStatus = (err as { response?: { status?: unknown } })
          ?.response?.status;
        const httpStatus =
          typeof responseStatus === 'number' ? responseStatus : undefined;
        logger.warn(
          'calendar-keepwarm: token refresh failed (transient) — fall-through on the persisted token',
          {
            httpStatus,
            remainingMs,
          },
        );
        // Capture SANITIZED — the raw GaxiosError may embed client_secret /
        // refresh_token in its response/config payloads.
        Sentry.captureException(
          new Error(
            `Google OAuth token refresh failed (transient) — fall-through on persisted token (remainingMs=${remainingMs})`,
          ),
        );
        return { status: 'ok', oauth2Client };
      }

      // Below the margin (or unknown expiry): warm-up skipped this run.
      // Log « transient », PAS d'email (l'alerte email reste réservée à
      // invalid_grant) — mais capture Sentry sanitisée : le run reste vert
      // et le moniteur cron ne détecte que les runs manquants, pas les runs
      // no-op. Un échec PERSISTANT non-invalid_grant (invalid_client, panne
      // soutenue) serait sinon totalement silencieux — régression vs l'ancien
      // code qui capturait chaque échec transient (revue #154). La dédup
      // server-side Sentry absorbe la répétition à chaque run.
      logger.warn(
        'calendar-keepwarm: token refresh failed (transient) — persisted margin insufficient, warm-up skipped this run',
        {
          remainingMs,
        },
      );
      // Sanitisée : message fixe + remainingMs (numérique) — le payload brut
      // de l'erreur (config/response, peut porter client_secret /
      // refresh_token) ne circule jamais.
      Sentry.captureException(
        new Error(
          `Google OAuth token refresh failed (transient) — persisted margin insufficient, warm-up skipped (remainingMs=${remainingMs})`,
        ),
      );
      return {
        status: 'transient',
        reason:
          remainingMs === null
            ? 'missing-expiry'
            : 'insufficient-persisted-margin',
      };
    }
  }

  // Token still valid (≥ 15 min remaining) AND non-empty access_token (the
  // refresh trigger above fires on an empty token, so this path is only
  // reachable with a usable credential) — admit the persisted credentials
  // as-is: the margin dwarfs the eager refresh threshold, so the warm-up's
  // signed calls cannot trigger a hidden token refresh.
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });
  logger.info('calendar-keepwarm: token still valid — refresh skipped', {
    remainingMs: tokens.expiry_date - Date.now(),
  });
  return { status: 'ok', oauth2Client };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function keepwarm(): Promise<void> {
  // 1. Read and validate env vars.
  //    ADMIN_EMAIL/RESEND_API_KEY are required: the invalid_grant alert is
  //    part of this cron's contract, and skipping the run when the channel is
  //    unconfigured surfaces the misconfig in logs instead of silently losing
  //    re-authorization alerts.
  //    Each guard ALSO captures an error to Sentry: a warn alone would leave
  //    the monitor green while the cron silently does nothing on every run.
  //    GOOGLE_CALENDAR_ID is NOT required here — see the dedicated warn-only
  //    check below the guards.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  const resendApiKey = process.env.RESEND_API_KEY;
  // Optional, with fallbacks — mirror heartbeat's defaults.
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    'https://developers.google.com/oauthplayground';
  const siteUrl = process.env.SITE_URL ?? 'https://omf-therapie.fr';
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? 'OMF Thérapie <contact@omf-therapie.fr>';
  // PUBLIC_SENTRY_DSN is optional and consumed by initSentry()/logger directly.

  if (!clientId || !clientSecret) {
    const msg =
      'calendar-keepwarm: required env missing — run skipped (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)';
    logger.warn(msg);
    Sentry.captureMessage(msg, 'error');
    return;
  }

  if (!supabaseUrl || !serviceRoleKey) {
    const msg =
      'calendar-keepwarm: required env missing — run skipped (SUPABASE_DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY)';
    logger.warn(msg);
    Sentry.captureMessage(msg, 'error');
    return;
  }

  if (!adminEmail || !resendApiKey) {
    const msg =
      'calendar-keepwarm: required env missing — run skipped (ADMIN_EMAIL / RESEND_API_KEY)';
    logger.warn(msg);
    Sentry.captureMessage(msg, 'error');
    return;
  }

  // GOOGLE_CALENDAR_ID is read by the availability warm-up at the end of
  // keepwarm(), not by the token step. Warn on a missing value — a warn is
  // one log line + Sentry breadcrumb per run, NOT a captured error, so a
  // 10-minute cadence can't spam exception alerts — then CONTINUE: the token
  // keep-warm has no reason to stop. The warm-up skips itself (never the
  // token step) while this is unset — see warmAvailabilityCache()'s guard.
  if (!calendarId) {
    logger.warn(
      'calendar-keepwarm: GOOGLE_CALENDAR_ID missing — token keep-warm continues; availability warm-up will be skipped',
    );
  }

  // ONE shared deadline for every upstream call of the run (revue #154):
  // 8 s of work, ~2 s reserved for classification + Sentry flush before the
  // 10 s platform default.
  const deadline = createRunDeadline();

  // 2. Token step, then the availability warm-up. The gate is STRUCTURAL:
  //    keepTokenWarm() returns 'auth-broken' ONLY when Google auth is
  //    definitively unusable (no token row / empty refresh_token /
  //    invalid_grant), and 'transient' when the run cannot proceed safely
  //    (token-row read failure, refresh failure with persisted margin
  //    ≤ 6 min, expired or unknown expiry) — the warm-up is skipped in both
  //    non-ok cases. On 'ok' the session carries the AUTHENTICATED client:
  //    it is handed to warmAvailabilityCache(), which loads ONE shared
  //    availability snapshot from it (mono-snapshot, issue #153 / SC3).
  //    warmAvailabilityCache() skips itself when GOOGLE_CALENDAR_ID is unset.
  //    The finally releases the deadline's global abort timer: a finished run
  //    (including a throw — the S4 rethrow path) must not leave a live timer
  //    behind it (revue #154).
  try {
    const session = await keepTokenWarm(
      {
        clientId,
        clientSecret,
        redirectUri,
        supabaseUrl,
        serviceRoleKey,
        adminEmail,
        siteUrl,
        resendApiKey,
        fromEmail,
      },
      deadline,
    );
    if (session.status === 'ok') {
      await warmAvailabilityCache(session, deadline);
    }
  } finally {
    deadline.dispose();
  }
}
