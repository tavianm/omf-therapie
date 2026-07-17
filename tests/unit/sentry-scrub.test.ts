import { describe, it, expect } from 'vitest';

import { scrubPii } from '@/lib/sentry.server';
import type { Event } from '@sentry/node';

// Minimal event factory — only the fields scrubPii inspects.
function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: 'evt-1',
    ...overrides,
  } as Event;
}

describe('scrubPii', () => {
  const PII_KEYS = [
    'patient_reason',
    'patientReason',
    'email',
    'phone',
    'message',
    'notes',
  ] as const;

  it('redacts every known PII key from request.data (JSON string)', () => {
    const data = JSON.stringify({
      patient_reason: 'angoisse sévère',
      patientReason: 'angoisse sévère',
      email: 'patient@example.fr',
      phone: '+33 6 12 34 56 78',
      message: 'je me sens mal',
      notes: 'historique familial',
      appointmentId: 'apt-1', // not PII — must survive
    });
    const event = makeEvent({ request: { data } });

    const scrubbed = scrubPii(event);
    const parsed = JSON.parse(scrubbed.request!.data!);

    for (const key of PII_KEYS) {
      expect(parsed[key]).toBe('[REDACTED]');
    }
    expect(parsed.appointmentId).toBe('apt-1');
  });

  it('redacts PII keys nested inside extra', () => {
    const event = makeEvent({
      extra: {
        context: {
          email: 'patient@example.fr',
          notes: 'sensitive',
          appointmentId: 'apt-1',
        },
        list: [{ phone: '+33 6 00 00 00 00' }],
      },
    });

    const scrubbed = scrubPii(event);
    expect(scrubbed.extra!.context).toMatchObject({
      email: '[REDACTED]',
      notes: '[REDACTED]',
      appointmentId: 'apt-1',
    });
    expect((scrubbed.extra!.list as Array<{ phone: string }>)[0].phone).toBe(
      '[REDACTED]',
    );
  });

  it('redacts PII keys inside breadcrumb data', () => {
    const event = makeEvent({
      breadcrumbs: [
        {
          timestamp: 0,
          data: { message: 'patient called', level: 'info' },
        },
        {
          timestamp: 0,
          data: { patient_reason: 'cry for help' },
        },
      ],
    });

    const scrubbed = scrubPii(event);
    expect(scrubbed.breadcrumbs![0]!.data).toMatchObject({
      message: '[REDACTED]',
      level: 'info',
    });
    expect(scrubbed.breadcrumbs![1]!.data).toMatchObject({
      patient_reason: '[REDACTED]',
    });
  });

  it('leaves a non-PII body untouched', () => {
    const data = JSON.stringify({ appointmentId: 'apt-1', mode: 'video' });
    const event = makeEvent({ request: { data } });

    const scrubbed = scrubPii(event);
    expect(JSON.parse(scrubbed.request!.data!)).toMatchObject({
      appointmentId: 'apt-1',
      mode: 'video',
    });
  });

  it('does not throw on a malformed request.data string', () => {
    const event = makeEvent({ request: { data: 'not-json{' } });
    expect(() => scrubPii(event)).not.toThrow();
    // Falls back to passing the body through unchanged.
    expect(scrubPii(event).request!.data).toBe('not-json{');
  });

  it('returns the event unchanged when there is nothing to scrub', () => {
    const event = makeEvent({ message: 'clean event' });
    const scrubbed = scrubPii(event);
    expect(scrubbed.message).toBe('clean event');
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
  });

  it('does not mutate the input event', () => {
    const data = JSON.stringify({ email: 'patient@example.fr' });
    const event = makeEvent({ request: { data } });
    const before = event.request!.data;

    scrubPii(event);

    expect(event.request!.data).toBe(before);
  });
});
