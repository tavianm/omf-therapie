import { describe, it, expect } from 'vitest';

import { shouldDropEvent } from '@/lib/sentry-filter';
import { shouldDropEvent as shouldDropEventFromServer } from '@/lib/sentry.server';
import type { Event } from '@sentry/node';

// Minimal event factory — only the fields shouldDropEvent inspects.
function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: 'evt-1',
    ...overrides,
  } as Event;
}

// Helper: build a single-frame exception value (the common case).
function withFrame(filename: string, message = 'TypeError: boom'): Event {
  return makeEvent({
    message,
    exception: {
      values: [
        {
          value: message,
          stacktrace: {
            frames: [{ filename }],
          },
        },
      ],
    },
  });
}

describe('shouldDropEvent', () => {
  describe('extension frame prefixes', () => {
    it.each([
      'chrome-extension://abcdefgabcdefghijklmnopqrstuvw/page.js',
      'moz-extension://abc123/background.js',
      'safari-web-extension://abc123/injected.js',
      'webkit-masked-url://hidden/',
      'extensions/::ABC123-/script.js',
    ])('drops events whose stacktrace frame is %s', (filename) => {
      // Real-world repro: the cashback-Reminder TypeError seen in production
      // had a single frame `webkit-masked-url://hidden/`. Each prefix here is
      // a distinct extension family — all must be dropped.
      const event = withFrame(filename);
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('is case-insensitive on the scheme (Chrome uppercases sometimes)', () => {
      // Some Safari versions emit `webkit-masked-url://` with mixed casing in
      // error reports. A strict === would miss those.
      const event = withFrame('Webkit-Masked-URL://hidden/');
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('drops when the extension frame is NOT the last frame (anywhere in the stack)', () => {
      // Defends against a mutation that only checks `frames[0]` or
      // `frames[frames.length-1]`. The extension frame can be in the middle.
      const event = makeEvent({
        exception: {
          values: [
            {
              value: 'TypeError: x',
              stacktrace: {
                frames: [
                  { filename: 'https://omf-therapie.fr/_astro/app.js' },
                  { filename: 'moz-extension://abc/page.js' },
                  { filename: 'https://omf-therapie.fr/_astro/other.js' },
                ],
              },
            },
          ],
        },
      });
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('drops when any of multiple exception values has an extension frame', () => {
      // An event may carry several exceptions (cause chains). One noisy
      // extension frame anywhere should drop the whole event — the noise is
      // still noise even when chained with an app frame.
      const event = makeEvent({
        exception: {
          values: [
            {
              value: 'Error: real',
              stacktrace: {
                frames: [{ filename: 'https://omf-therapie.fr/_astro/a.js' }],
              },
            },
            {
              value: 'TypeError: cashback',
              stacktrace: {
                frames: [{ filename: 'chrome-extension://x/p.js' }],
              },
            },
          ],
        },
      });
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('keeps events when no frame matches an extension prefix', () => {
      // Negative control — a real app stacktrace must never be dropped.
      const event = withFrame(
        'https://omf-therapie.fr/_astro/sentry.abc123.js',
        'TypeError: real bug',
      );
      expect(shouldDropEvent(event)).toBe(false);
    });

    it('keeps events with empty frame filenames (missing filename)', () => {
      // Some SDKs omit `filename`. The filter must not crash on missing
      // fields and must not drop on absence alone.
      const event = makeEvent({
        exception: {
          values: [
            {
              value: 'Error: real',
              stacktrace: { frames: [{ filename: undefined }] },
            },
          ],
        },
      });
      expect(shouldDropEvent(event)).toBe(false);
    });

    it('keeps events when exception has no stacktrace at all', () => {
      // Defensive: an exception value without `stacktrace` is structurally
      // valid. No frame to inspect → cannot attribute to an extension.
      const event = makeEvent({
        exception: { values: [{ value: 'Error: no stack' }] },
      });
      expect(shouldDropEvent(event)).toBe(false);
    });

    it('keeps events when exception.values is missing', () => {
      // Bare `exception: {}` shape — must not throw.
      const event = makeEvent({ exception: {} });
      expect(() => shouldDropEvent(event)).not.toThrow();
      expect(shouldDropEvent(event)).toBe(false);
    });

    it('keeps events with no exception at all', () => {
      // Message-only events (e.g. `captureMessage`) must survive unless the
      // message itself matches a noise substring.
      const event = makeEvent({ message: 'deploy: abc123' });
      expect(shouldDropEvent(event)).toBe(false);
    });
  });

  describe('noise message substrings', () => {
    it('drops `response.cashbackReminder` regardless of frame', () => {
      // Real production event: TypeError: undefined is not an object
      // (evaluating 'response.cashbackReminder') — from a cashback extension.
      // The frame was webkit-masked (already covered above) but the message
      // alone should also trigger the drop, in case future variants use a
      // real-looking frame.
      const event = makeEvent({
        message: "TypeError: undefined is not an object (evaluating 'response.cashbackReminder')",
        exception: {
          values: [
            {
              value: "undefined is not an object (evaluating 'response.cashbackReminder')",
              stacktrace: { frames: [{ filename: 'https://omf-therapie.fr/' }] },
            },
          ],
        },
      });
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('drops `ResizeObserver loop completed after delivering a notification`', () => {
      // Browser-spec warning, never actionable. Must be dropped by message
      // match alone (the frame is the app's own layout code).
      const event = makeEvent({
        message: 'ResizeObserver loop completed after delivering a notification',
      });
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('matches message case-insensitively (CASHBACKREMINDER)', () => {
      const event = makeEvent({
        message: 'TypeError: Cannot read CashbackReminder of undefined',
      });
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('matches the exception value when message is absent', () => {
      // captureException(new Error('…')) populates exception.values[].value
      // but leaves `event.message` empty. The substring scan must still fire.
      const event = makeEvent({
        exception: {
          values: [
            {
              value: 'TypeError: cannot read response.cashbackReminder',
              stacktrace: { frames: [{ filename: 'https://omf-therapie.fr/' }] },
            },
          ],
        },
      });
      expect(shouldDropEvent(event)).toBe(true);
    });

    it('does NOT drop an event whose message merely contains "cash" (substring specificity)', () => {
      // Mutation guard: a naive `includes('cash')` would over-match. The
      // rule must match the specific `cashbackreminder` substring.
      const event = makeEvent({ message: 'Checkout: cash payment failed' });
      expect(shouldDropEvent(event)).toBe(false);
    });

    it('does NOT drop unrelated messages', () => {
      const event = makeEvent({ message: 'TypeError: Cannot read property x of undefined' });
      expect(shouldDropEvent(event)).toBe(false);
    });
  });

  describe('parity — re-export identity', () => {
    it('shares the same shouldDropEvent between client and server', () => {
      // H3-style parity guard (mirrors scrubPii's parity test in
      // sentry-scrub.test.ts). The client (Layout.astro) imports from
      // @/lib/sentry-filter directly; the server re-exports it from
      // @/lib/sentry.server. Asserting identity proves the two paths cannot
      // drift.
      expect(shouldDropEventFromServer).toBe(shouldDropEvent);
    });
  });
});
