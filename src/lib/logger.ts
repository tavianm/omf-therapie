/**
 * Structured logger — JSON to stdout + Sentry capture/breadcrumb.
 *
 * Replaces the ~101 ad-hoc `console.*` calls across the server surface with a
 * single structured emitter. Every line is a JSON object so Netlify function
 * logs are machine-parseable (filter by level, requestId, route).
 *
 * Behaviour:
 *   - Always writes JSON to stdout (console.log/error/warn/info), even when
 *     Sentry is not configured — local dev keeps visible logs.
 *   - When PUBLIC_SENTRY_DSN is set:
 *       level=error + err      → captureException (creates a Sentry issue)
 *       level=error, no err    → captureMessage(msg, 'error') so config-fatal
 *                                strings ("missing STRIPE_WEBHOOK_SECRET",
 *                                "refresh_token is null", "invalid_grant")
 *                                still create issues rather than vanishing
 *                                into a breadcrumb.
 *       warn/info/debug        → addBreadcrumb (cheap, batched).
 *   - PII never reaches Sentry: the SDK's beforeSend (sentry.server.ts) scrubs
 *     known-sensitive keys. Fields passed here are also safe by convention —
 *     pass structured context, not raw request bodies.
 *
 * Note: for error-without-err we keep the fields on the preceding breadcrumb
 * (warn/info/debug calls still emit one) rather than attaching them via a
 * `withScope` wrapper — keeps emit() simple and the breadcrumb trail already
 * carries the structured context alongside the issue.
 *
 * Convention: caller passes `{ requestId, appointmentId, ... }` as `fields`;
 * the logger never reads locals directly (stays a pure module, testable).
 */

import {
  captureException,
  captureMessage,
  addBreadcrumb,
} from './sentry.server';
import type { SeverityLevel } from '@sentry/node';

/** Structured context attached to every log line. */
export interface LogFields {
  /** API route pathname, e.g. /api/appointments/123/. */
  route?: string;
  /** Per-request UUID from middleware — threads to Sentry scope. */
  requestId?: string;
  /** Appointment id when the log relates to a specific booking. */
  appointmentId?: string;
  /** Arbitrary structured context (must be JSON-serialisable, PII-free). */
  [key: string]: unknown;
}

type Level = 'error' | 'warn' | 'info' | 'debug';

const consoleLevel: Record<Level, 'log' | 'error' | 'warn' | 'info'> = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'log',
};

// Map our public Level names to Sentry's SeverityLevel enum (`warning`, not
// `warn`; `debug` is valid).
const sentryLevel: Record<Level, SeverityLevel> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  debug: 'debug',
};

/**
 * Emit one structured log line + forward to Sentry when configured.
 * Errors are surfaced as `err` in the JSON and captured (level=error only).
 */
function emit(
  level: Level,
  msg: string,
  fields: LogFields = {},
  err?: unknown,
): void {
  const payload: Record<string, unknown> = {
    level,
    msg,
    ...fields,
  };
  if (err !== undefined) {
    payload.err = err instanceof Error ? err.message : String(err);
  }
  console[consoleLevel[level]](JSON.stringify(payload));

  if (!import.meta.env.PUBLIC_SENTRY_DSN) return;

  if (level === 'error') {
    // err present → real exception (full stack/cause). err absent → still
    // surface a Sentry issue for the message so config-fatal strings are not
    // silently demoted to a breadcrumb. Structured fields stay on the
    // breadcrumb trail (see module note).
    if (err !== undefined) {
      captureException(err);
    } else {
      captureMessage(msg, 'error');
    }
  } else {
    addBreadcrumb({
      level: sentryLevel[level],
      message: msg,
      data: fields as Record<string, unknown>,
    });
  }
}

export const logger = {
  error: (msg: string, fields?: LogFields, err?: unknown): void =>
    emit('error', msg, fields, err),
  warn: (msg: string, fields?: LogFields, err?: unknown): void =>
    emit('warn', msg, fields, err),
  info: (msg: string, fields?: LogFields): void => emit('info', msg, fields),
  debug: (msg: string, fields?: LogFields): void => emit('debug', msg, fields),
};
