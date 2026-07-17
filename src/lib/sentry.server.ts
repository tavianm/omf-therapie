/**
 * Sentry instrumentation — server side (Astro API routes + middleware).
 *
 * Shape 2 (manual wiring, see artifacts/analyses/75-*.mdx): chosen over
 * @sentry/astro to avoid Netlify-adapter compatibility risk and Astro-version
 * coupling. This module is the single init point for the server runtime.
 *
 * Layer rule: src/lib/** is server-only. The browser SDK is initialised in
 * src/layouts/Layout.astro — both sides share scrubPii via duplication (the
 * client cannot import a server module).
 */

import * as Sentry from '@sentry/node';
import type { APIContext } from 'astro';
import type { Event } from '@sentry/node';

/**
 * Keys that may carry patient-identifying or otherwise sensitive data.
 * Redacted from breadcrumbs, extra, and request body before any event leaves
 * the process. Mirrors the client-side list in Layout.astro.
 */
const PII_KEYS = [
  'patient_reason',
  'patientReason',
  'email',
  'phone',
  'message',
  'notes',
] as const;

const REDACTED = '[REDACTED]';

/** True when `v` is a record we can walk for PII keys. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Redact PII keys in a mutable record (returns the same reference). */
function redactRecord(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if ((PII_KEYS as readonly string[]).includes(key)) {
      record[key] = REDACTED;
    }
  }
}

/** Deep-walk a value redacting PII keys on every nested record. */
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

/**
 * Pure PII scrubber applied to every outbound Sentry event via `beforeSend`.
 * Walks breadcrumbs, extra, and request body and replaces PII keys with
 * `[REDACTED]`. Returns a new event (does not mutate the input).
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
        const data = { ...copy.data };
        redactRecord(data);
        copy.data = data;
      }
      return copy;
    });
  }

  return next;
}

/** Best-effort redaction inside a JSON string body. */
function redactJsonString(body: string): string {
  // Avoid throwing on malformed bodies — this is defensive, not authoritative.
  try {
    const parsed = JSON.parse(body);
    const scrubbed = redactDeep(parsed);
    return JSON.stringify(scrubbed);
  } catch {
    return body;
  }
}

let initialized = false;
let canarySent = false;

/**
 * Idempotent Sentry init. Safe to call on every cold start; subsequent calls
 * are no-ops. When PUBLIC_SENTRY_DSN is unset the SDK stays inert — local dev
 * and any environment without a DSN degrade gracefully (logger falls back to
 * console.* only).
 */
export function initSentry(): void {
  const dsn = import.meta.env.PUBLIC_SENTRY_DSN;
  if (!dsn || initialized) return;
  initialized = true;

  Sentry.init({
    dsn,
    environment:
      process.env.CONTEXT === 'production' ? 'production' : 'staging',
    // scrubPii is written against the base Event type and is structurally
    // compatible with ErrorEvent (which extends Event). The SDK's beforeSend
    // signature is narrower (ErrorEvent), so we narrow here; the runtime
    // behaviour is identical.
    beforeSend: (event) => scrubPii(event) as Sentry.ErrorEvent,
    // Traces/APM intentionally disabled (frame scope is error tracking + logs).
    // tracesSampleRate governs performance traces only, not error capture.
  });
}

/**
 * Run `fn` inside a fresh Sentry scope tagged with this request's id + route.
 * The scope is cleared in `finally` to avoid leakage across warm-container
 * requests (Lambda/Netlify function instances are reused).
 */
export async function withRequestScope<T>(
  ctx: APIContext,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.withScope(async (scope) => {
    const requestId = ctx.locals.requestId as string | undefined;
    const route = ctx.locals.route as string | undefined;
    if (requestId) scope.setTag('requestId', requestId);
    if (route) scope.setTag('route', route);
    try {
      return await fn();
    } finally {
      scope.clear();
    }
  });
}

/**
 * Emit one `deploy: <sha>` message per cold start. Closes the falsifiability
 * hole: "0 events after N days" no longer ambiguates a healthy quiet site from
 * broken ingestion. Canary absence = the SDK never initialised or the DSN is
 * wrong. Safe to call when the DSN is unset (no-ops).
 */
export function emitDeployCanary(): void {
  if (canarySent || !initialized) return;
  canarySent = true;
  Sentry.captureMessage(`deploy: ${process.env.COMMIT_REF ?? 'unknown'}`);
}

// Re-export the capture primitives so callers depend on this module, not on
// @sentry/node directly (single wiring point to swap later if needed).
export const { captureException, captureMessage, addBreadcrumb, withScope, flush } =
  Sentry;

export type { Event } from '@sentry/node';
