import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Sentry server module so the logger never phones home and we can
// assert on capture/breadcrumb calls in isolation. vi.hoisted runs the
// factory before vi.mock's own hoist, so the mock fns are initialised in time.
const { captureException, addBreadcrumb } = vi.hoisted(() => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('@/lib/sentry.server', () => ({
  captureException,
  addBreadcrumb,
}));

import { logger } from '@/lib/logger';

// Capture stdout per test so we can assert on the JSON line shape.
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captureException.mockClear();
  addBreadcrumb.mockClear();
  stdoutSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logger — JSON stdout shape', () => {
  it('emits a JSON object with level, msg, and structured fields', () => {
    logger.error('booking failed', {
      requestId: 'req-1',
      appointmentId: 'apt-9',
      route: '/api/appointments/9/',
    });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const line = stdoutSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: 'error',
      msg: 'booking failed',
      requestId: 'req-1',
      appointmentId: 'apt-9',
      route: '/api/appointments/9/',
    });
  });

  it('includes err.message when an Error is passed', () => {
    const err = new Error('supabase timeout');
    logger.error('db down', { requestId: 'req-1' }, err);

    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(parsed.err).toBe('supabase timeout');
  });

  it('stringifies non-Error throwables in err', () => {
    logger.error('weird throw', {}, 'string error');
    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(parsed.err).toBe('string error');
  });

  it('omits err key when no error is passed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.warn('low disk');
    const parsed = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(parsed).not.toHaveProperty('err');
  });
});

describe('logger — Sentry forwarding (DSN set)', () => {
  beforeEach(() => {
    // The logger gates capture/breadcrumb on import.meta.env.PUBLIC_SENTRY_DSN.
    // Stub it so the forwarding path is exercised.
    vi.stubEnv('PUBLIC_SENTRY_DSN', 'https://example@sentry.io/1');
  });

  it('captures the exception when level=error and err is present', () => {
    const err = new Error('boom');
    logger.error('fail', {}, err);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it('adds a breadcrumb for warn/info/debug', () => {
    logger.warn('careful', { appointmentId: 'a1' });
    logger.info('noted', { route: '/api/health/' });
    logger.debug('trace');

    expect(addBreadcrumb).toHaveBeenCalledTimes(3);
    expect(addBreadcrumb).toHaveBeenNthCalledWith(1, {
      level: 'warning',
      message: 'careful',
      data: { appointmentId: 'a1' },
    });
  });

  it('does NOT capture when level=error but no err is passed', () => {
    logger.error('noted without err');
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('logger — Sentry disabled (no DSN)', () => {
  // Restores import.meta.env to setup.ts state (PUBLIC_SENTRY_DSN unset).
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT capture/breadcrumb when PUBLIC_SENTRY_DSN is unset', () => {
    const err = new Error('ignored');
    logger.error('no dsn', {}, err);
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });
});
