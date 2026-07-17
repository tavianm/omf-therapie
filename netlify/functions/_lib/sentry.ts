/**
 * Sentry instrumentation — Netlify scheduled functions (cron).
 *
 * Cron files run in the Netlify Node.js runtime, NOT inside Vite/Astro, so
 * `import.meta.env` is unavailable. Env vars are read via `process.env`, and
 * this module cannot import from src/lib/** (server-side Astro module graph).
 *
 * The PII scrubber is duplicated here for the same reason — a shared module
 * under src/lib would not resolve at cron build time.
 */

import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';

const PII_KEYS = [
  'patient_reason',
  'patientReason',
  'email',
  'phone',
  'message',
  'notes',
] as const;

const REDACTED = '[REDACTED]';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function redactRecord(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if ((PII_KEYS as readonly string[]).includes(key)) {
      record[key] = REDACTED;
    }
  }
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      clone[k] = (PII_KEYS as readonly string[]).includes(k) ? REDACTED : redactDeep(v);
    }
    return clone;
  }
  return value;
}

function redactJsonString(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(redactDeep(parsed));
  } catch {
    return body;
  }
}

/** PII scrubber applied to every outbound Sentry event via beforeSend. */
export function scrubPii(event: Event): Event {
  const next: Event = { ...event };

  if (next.request) {
    next.request = { ...next.request };
    if (typeof next.request.data === 'string') {
      next.request.data = redactJsonString(next.request.data);
    }
  }
  if (next.extra) {
    next.extra = redactDeep(next.extra) as Record<string, unknown>;
  }
  if (Array.isArray(next.breadcrumbs)) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => {
      const copy = { ...crumb };
      if (isRecord(copy.data)) {
        const data = { ...copy.data };
        redactRecord(data);
        copy.data = data;
      }
      return copy;
    });
  }

  return next;
}

let initialized = false;

/**
 * Idempotent Sentry init for the cron runtime. Uses process.env (not
 * import.meta.env). No-ops when PUBLIC_SENTRY_DSN is unset.
 */
export function initSentry(): void {
  const dsn = process.env.PUBLIC_SENTRY_DSN;
  if (!dsn || initialized) return;
  initialized = true;

  Sentry.init({
    dsn,
    environment:
      process.env.CONTEXT === 'production' ? 'production' : 'staging',
    beforeSend: (event) => scrubPii(event) as Sentry.ErrorEvent,
  });
}

/**
 * Capture an exception AND flush the Sentry client before returning.
 *
 * Netlify function instances freeze on handler return — without an explicit
 * flush, in-flight events are dropped. The default 2s timeout matches the
 * Sentry-recommended floor and stays well under the function time budget.
 */
export async function captureAndFlush(err: unknown, ms = 2000): Promise<void> {
  Sentry.captureException(err);
  await Sentry.flush(ms);
}

export const { withMonitor, flush, captureException } = Sentry;
