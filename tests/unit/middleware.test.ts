import { describe, it, expect, vi, beforeEach } from 'vitest';

// `astro:middleware` is an Astro virtual module unavailable under vitest.
// defineMiddleware just wraps the handler — we provide a passthrough that
// calls the factory so the middleware body is exercised.
//
// IMPORTANT: we do NOT mock `@/lib/sentry.server` here. The middleware's
// warm-container PII-leak guard lives in the real `withRequestScope`'s finally
// (`scope.clear()`). Mocking it out (with an inline reimplementation that
// calls `scope.clear()` itself) makes the "clears the scope" assertions
// tautological — they would still pass if the real code were broken. Instead
// we mock only the external SDK boundary (`@sentry/node`'s `withScope`) so the
// REAL `withRequestScope` runs and exercises its own setTag/clear contract.
//
// `scope` is hoisted because the `vi.mock('@sentry/node', ...)` factory runs
// before any top-level const (vitest 4 hoisting rule).
const { scope } = vi.hoisted(() => ({
  scope: {
    setTag: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('astro:middleware', () => ({
  defineMiddleware: <H>(handler: H): H => handler,
}));

vi.mock('@sentry/node', () => ({
  // Synchronously invoke the callback with the shared scope and RETURN its
  // value (the promise) so `await withRequestScope(...)` resolves correctly —
  // the real implementation relies on withScope returning the callback's value.
  withScope: vi.fn(<T>(cb: (s: typeof scope) => T): T => cb(scope)),
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  flush: vi.fn(async () => true),
}));

// Import after mocks are registered.
const onRequestModule = await import('@/middleware');
const onRequest = onRequestModule.onRequest;

function makeNext(response: Response = new Response('ok', { status: 200 })) {
  return vi.fn(async () => response);
}

function makeContext(pathname = '/api/appointments/9/') {
  return {
    url: new URL(`https://omf-therapie.fr${pathname}`),
    locals: {} as { requestId?: string; route?: string },
  };
}

beforeEach(() => {
  scope.setTag.mockClear();
  scope.clear.mockClear();
});

describe('middleware — requestId + route tagging', () => {
  it('assigns a UUID requestId to locals', async () => {
    const ctx = makeContext();
    await onRequest(ctx as never, makeNext() as never);

    expect(ctx.locals.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('assigns the route pathname to locals', async () => {
    const ctx = makeContext('/api/stripe-webhook/');
    await onRequest(ctx as never, makeNext() as never);
    expect(ctx.locals.route).toBe('/api/stripe-webhook/');
  });

  it('tags the Sentry scope with requestId and route', async () => {
    const ctx = makeContext('/api/appointments/9/');
    await onRequest(ctx as never, makeNext() as never);

    expect(scope.setTag).toHaveBeenCalledWith('requestId', ctx.locals.requestId);
    expect(scope.setTag).toHaveBeenCalledWith('route', '/api/appointments/9/');
  });

  it('clears the scope after a successful response (warm-container safety)', async () => {
    await onRequest(makeContext() as never, makeNext() as never);
    expect(scope.clear).toHaveBeenCalledTimes(1);
  });

  it('clears the scope even when the handler throws', async () => {
    const next = vi.fn(async () => {
      throw new Error('downstream exploded');
    });
    await expect(
      onRequest(makeContext() as never, next as never),
    ).rejects.toThrow('downstream exploded');
    expect(scope.clear).toHaveBeenCalledTimes(1);
  });
});
