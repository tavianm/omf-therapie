/**
 * Sentry instrumentation — Netlify scheduled functions (cron).
 *
 * Cron files run in the Netlify Node.js runtime, NOT inside Vite/Astro, so
 * `import.meta.env` is unavailable. Env vars are read via `process.env`, and
 * this module cannot import from src/lib/** (server-side Astro module graph).
 *
 * TODO: Mirrors src/lib/pii-scrub.ts — keep in sync. Cannot share because the
 * cron bundler doesn't resolve src/lib. (Parity test is a separate medium
 * finding, deferred.) When updating PII_KEYS or the breadcrumb/extra walk,
 * apply the same change to src/lib/pii-scrub.ts.
 */

import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';

const PII_KEYS = [
  // Real appointment columns (supabase/migrations/001_init.sql)
  'patient_name',
  'patient_email',
  'patient_phone',
  'patient_postal_code',
  'patient_city',
  'patient_reason',
  'therapist_notes',
  // Aliases / generic key forms (camelCase, bare)
  'patientReason',
  'email',
  'phone',
  'message',
  'notes',
  // Operator PII (therapist/practitioner) — calendar heartbeat logs adminEmail
  'adminEmail',
  'admin_email',
  // Video session link (sensitive: meeting URL)
  'video_link',
  'videoLink',
] as const;

const REDACTED = '[REDACTED]';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

/**
 * PII scrubber applied to every outbound Sentry event via beforeSend.
 * Breadcrumbs use the same deep walk as extra so nested forwarded fields are
 * redacted at every depth.
 */
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
        copy.data = redactDeep(copy.data) as Record<string, unknown>;
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
