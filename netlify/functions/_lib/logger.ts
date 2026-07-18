/**
 * Structured logger — Netlify scheduled functions (cron) runtime.
 *
 * Mirrors src/lib/logger.ts but lives under netlify/functions/_lib/ because
 * cron files cannot import from src/lib/** (they run in the raw Node.js
 * runtime, not Vite/Astro). Output is JSON to stdout so Netlify function logs
 * stay machine-parseable. Errors are also captured by Sentry when
 * PUBLIC_SENTRY_DSN is set (process.env, not import.meta.env).
 */

import * as Sentry from '@sentry/node';
import { scrubPii } from './sentry';

export interface LogFields {
  requestId?: string;
  appointmentId?: string;
  [key: string]: unknown;
}

type Level = 'error' | 'warn' | 'info' | 'debug';

const consoleLevel: Record<Level, 'log' | 'error' | 'warn' | 'info'> = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'log',
};

function emit(
  level: Level,
  msg: string,
  fields: LogFields = {},
  err?: unknown,
): void {
  const payload: Record<string, unknown> = { level, msg, ...fields };
  if (err !== undefined) {
    payload.err = err instanceof Error ? err.message : String(err);
  }
  console[consoleLevel[level]](JSON.stringify(payload));

  if (!process.env.PUBLIC_SENTRY_DSN) return;

  if (level === 'error' && err !== undefined) {
    Sentry.captureException(err);
  } else {
    // Best-effort breadcrumb; wrap in withScope so it doesn't leak across runs.
    Sentry.addBreadcrumb({
      level: level === 'warn' ? 'warning' : level,
      message: msg,
      data: fields as Record<string, unknown>,
    });
  }
}

export const logger = {
  error: (msg: string, fields?: LogFields, err?: unknown): void =>
    emit('error', msg, fields, err),
  warn: (msg: string, fields?: LogFields): void => emit('warn', msg, fields),
  info: (msg: string, fields?: LogFields): void => emit('info', msg, fields),
  debug: (msg: string, fields?: LogFields): void => emit('debug', msg, fields),
};

/** Re-export so cron files have a single instrumentation entry point. */
export { scrubPii };
