/**
 * Astro middleware — per-request Sentry scope + deploy canary.
 *
 * Runs once per cold start (module top-level): initSentry() and the deploy
 * canary, so a broken ingestion is detectable within minutes of deploy.
 *
 * Per request: assigns a requestId (UUID v4) and route to `locals`, then runs
 * the downstream handler inside a Sentry scope tagged with both. The scope is
 * cleared in `withRequestScope`'s finally — critical because Netlify reuses
 * function instances (warm containers) and a stale scope would leak tags
 * across unrelated requests.
 */

import { defineMiddleware } from 'astro:middleware';
import { randomUUID } from 'node:crypto';
import {
  initSentry,
  emitDeployCanary,
  withRequestScope,
} from './lib/sentry.server';

// Cold start only — module body runs once per function instance.
initSentry();
emitDeployCanary();

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.requestId = randomUUID();
  context.locals.route = context.url.pathname;
  return withRequestScope(context, () => next());
});
