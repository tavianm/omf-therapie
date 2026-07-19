/**
 * Sentry instrumentation — server side (Astro API routes + middleware).
 *
 * Shape 2 (manual wiring, see artifacts/analyses/75-*.mdx): chosen over
 * @sentry/astro to avoid Netlify-adapter compatibility risk and Astro-version
 * coupling. This module is the single init point for the server runtime.
 *
 * Layer rule: src/lib/** is server-only. The browser SDK is initialised in
 * src/layouts/Layout.astro — both sides now share the pure scrubPii from
 * ./pii-scrub (the client can import that module because it has no Sentry
 * dependency).
 */

import * as Sentry from '@sentry/node';
import type { APIContext } from 'astro';
import { scrubPii } from './pii-scrub';
import { shouldDropEvent } from './sentry-filter';

// Re-export the shared scrubber + its structural type so existing callers
// (import { scrubPii } from '@/lib/sentry.server') keep working and tests can
// assert the server path uses the same function reference as the client path.
export { scrubPii } from './pii-scrub';
export type { ScrubbableEvent } from './pii-scrub';
// Re-export the filter so callers (and tests) can reach it via the single
// server wiring module, mirroring the scrubPii re-export pattern.
export { shouldDropEvent } from './sentry-filter';
export type { FilterableEvent } from './sentry-filter';

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
    // beforeSend pipeline: drop → scrub. `shouldDropEvent` runs first because
    // dropping is cheaper than scrubbing (no object cloning) and because a
    // dropped event should never see its PII fields touched anyway. Returning
    // `null` is the Sentry-blessed drop signal — no rate-limit consumption.
    beforeSend: (event) => {
      if (shouldDropEvent(event)) return null;
      return scrubPii(event);
    },
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
