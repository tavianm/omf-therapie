import { describe, it, expect, vi, beforeEach } from 'vitest';

// `astro:middleware` is an Astro virtual module unavailable under vitest.
// defineMiddleware just wraps the handler — we provide a passthrough that
// calls the factory so the middleware body is exercised.
const scope = {
  setTag: vi.fn(),
  clear: vi.fn(),
};

vi.mock('astro:middleware', () => ({
  defineMiddleware: <H>(handler: H): H => handler,
}));

vi.mock('@/lib/sentry.server', () => ({
  initSentry: vi.fn(),
  emitDeployCanary: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  // The middleware uses withRequestScope, which internally calls Sentry.withScope
  // and scope.setTag/clear. Re-implement it here against the shared `scope` so
  // assertions on setTag/clear stay uniform with the real contract.
  withRequestScope: vi.fn(
    async <T>(
      ctx: { locals: { requestId?: string; route?: string } },
      fn: () => Promise<T>,
    ): Promise<T> => {
      if (ctx.locals.requestId) scope.setTag('requestId', ctx.locals.requestId);
      if (ctx.locals.route) scope.setTag('route', ctx.locals.route);
      try {
        return await fn();
      } finally {
        scope.clear();
      }
    },
  ),
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
