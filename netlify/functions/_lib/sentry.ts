/**
 * Sentry instrumentation — Netlify scheduled functions (cron).
 *
 * Cron files run in the Netlify Node.js runtime, NOT inside Vite/Astro, so
 * `import.meta.env` is unavailable. Env vars are read via `process.env`, and
 * this module cannot import from src/lib/** (server-side Astro module graph).
 *
 * TODO: Mirrors src/lib/pii-scrub.ts AND src/lib/sentry-filter.ts — keep both
 * in sync. Cannot share because the cron bundler doesn't resolve src/lib.
 * (Parity test is a separate medium finding, deferred.) When updating
 * PII_KEYS, the breadcrumb/extra walk, or the extension/noise filter rules,
 * apply the same change to BOTH src/lib modules.
 */

import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
// build-env.ts is auto-generated at build time by scripts/generate-build-env.mjs.
// It snapshots Netlify's build-only CONTEXT/COMMIT_REF so the cron runtime
// (esbuild-bundled, no Vite, no import.meta.env) can still read them. Netlify
// does NOT expose these vars at function runtime by default — without this,
// every prod cron tagged 'environment: staging' (production bug 2026-07-19).
import { BUILD_CONTEXT } from './build-env';

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
    // BUILD_CONTEXT is inlined at build time. process.env.CONTEXT is NOT
    // exposed at function runtime — production bug 2026-07-19.
    environment: BUILD_CONTEXT === 'production' ? 'production' : 'staging',
    // Drop → scrub pipeline (same order as src/lib/sentry.server.ts).
    beforeSend: (event) => {
      if (shouldDropEvent(event)) return null;
      return scrubPii(event) as Sentry.ErrorEvent;
    },
  });
}

// ---------------------------------------------------------------------------
// Extension / noise filter — MUST mirror src/lib/sentry-filter.ts.
// Cron functions don't load in a browser so extension frames are unlikely,
// but a cron-initiated fetch could still surface an exception value that
// matches a known noise substring. Keeping the parity avoids drift.
// ---------------------------------------------------------------------------

const EXTENSION_FRAME_PREFIXES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-web-extension://',
  'webkit-masked-url://',
  'extensions/',
] as const;

const NOISE_MESSAGE_SUBSTRINGS = [
  'cashbackreminder',
  'resizeobserver loop',
] as const;

interface FilterableEvent {
  message?: string;
  exception?: {
    values?: Array<{
      value?: string;
      stacktrace?: {
        frames?: Array<{ filename?: string }>;
      };
    }>;
  };
}

function hasExtensionFrame(event: FilterableEvent): boolean {
  const values = event.exception?.values;
  if (!Array.isArray(values)) return false;
  for (const ex of values) {
    const frames = ex?.stacktrace?.frames;
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      const filename = frame?.filename;
      if (typeof filename !== 'string') continue;
      const lower = filename.toLowerCase();
      if (
        EXTENSION_FRAME_PREFIXES.some((prefix) => lower.startsWith(prefix))
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasNoiseMessage(event: FilterableEvent): boolean {
  const candidates: string[] = [];
  if (typeof event.message === 'string') candidates.push(event.message);
  const values = event.exception?.values;
  if (Array.isArray(values)) {
    for (const ex of values) {
      if (typeof ex?.value === 'string') candidates.push(ex.value);
    }
  }
  if (candidates.length === 0) return false;
  const hay = candidates.join('\n').toLowerCase();
  return NOISE_MESSAGE_SUBSTRINGS.some((sub) => hay.includes(sub));
}

/** Mirror of src/lib/sentry-filter.ts shouldDropEvent — keep in sync. */
export function shouldDropEvent<T extends FilterableEvent = FilterableEvent>(
  event: T,
): boolean {
  return hasExtensionFrame(event) || hasNoiseMessage(event);
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
