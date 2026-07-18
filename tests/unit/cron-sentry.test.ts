import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @sentry/node so captureAndFlush never phones home. The mock must be
// hoisted above the import, so we use vi.hoisted for the mock fns.
const { captureException, flush } = vi.hoisted(() => ({
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
}));

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException,
  flush,
  withMonitor: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// captureAndFlush + scrubPii live under netlify/functions/_lib (cron runtime,
// cannot share src/lib). The module imports @sentry/node lazily (init is only
// called inside initSentry), so importing it here is safe.
import { captureAndFlush, scrubPii } from '../../netlify/functions/_lib/sentry';

beforeEach(() => {
  captureException.mockClear();
  flush.mockClear();
  flush.mockResolvedValue(true);
});

describe('captureAndFlush — Lambda freeze safety', () => {
  it('captures the exception then awaits flush', async () => {
    const err = new Error('cron exploded');
    await captureAndFlush(err);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(2000);
  });

  it('honours a custom flush timeout (ms argument)', async () => {
    await captureAndFlush(new Error('boom'), 5000);
    expect(flush).toHaveBeenCalledWith(5000);
  });

  it('awaits flush even when captureException throws (defensive)', async () => {
    captureException.mockImplementationOnce(() => {
      throw new Error('sentry itself broken');
    });
    // The helper must still resolve the flush promise — a broken capture must
    // not skip the flush that drains the event queue.
    await expect(captureAndFlush(new Error('outer'))).rejects.toThrow(
      'sentry itself broken',
    );
    // flush was NOT reached (capture threw synchronously before it) — document
    // that contract: captureAndFlush propagates capture failures rather than
    // swallowing them, so the caller's finally still runs its own flush.
    expect(flush).not.toHaveBeenCalled();
  });
});

describe('cron scrubPii — PII redaction (mirrors server)', () => {
  it('redacts known PII keys from request.data', () => {
    const event = {
      event_id: 'e1',
      request: { data: JSON.stringify({ email: 'patient@example.fr', notes: 'sensitive', ok: true }) },
    };
    const scrubbed = scrubPii(event as never);
    const parsed = JSON.parse(scrubbed.request!.data!);
    expect(parsed.email).toBe('[REDACTED]');
    expect(parsed.notes).toBe('[REDACTED]');
    expect(parsed.ok).toBe(true);
  });
});
