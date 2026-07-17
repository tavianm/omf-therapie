import { describe, it, expect } from 'vitest';

import { scrubPii as scrubPiiFromServer } from '@/lib/sentry.server';
import { scrubPii } from '@/lib/pii-scrub';
import type { Event } from '@sentry/node';

// Minimal event factory — only the fields scrubPii inspects.
function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: 'evt-1',
    ...overrides,
  } as Event;
}

describe('scrubPii', () => {
  // Canonical list mirroring src/lib/pii-scrub.ts. Kept inline so the test is
  // self-describing and does not import the module's private constant.
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
    // Operator PII (calendar heartbeat logs adminEmail)
    'adminEmail',
    'admin_email',
    // Video session link (sensitive: meeting URL)
    'video_link',
    'videoLink',
  ] as const;

  it('redacts every known PII key from request.data (JSON string)', () => {
    const data = JSON.stringify({
      patient_name: 'Jean Dupont',
      patient_email: 'patient@example.fr',
      patient_phone: '+33 6 12 34 56 78',
      patient_postal_code: '75011',
      patient_city: 'Paris',
      patient_reason: 'angoisse sévère',
      therapist_notes: 'historique familial',
      video_link: 'https://meet.google.com/abc',
      patientReason: 'angoisse sévère',
      email: 'patient@example.fr',
      phone: '+33 6 12 34 56 78',
      message: 'je me sens mal',
      notes: 'historique familial',
      adminEmail: 'therapeute@example.fr',
      admin_email: 'therapeute@example.fr',
      videoLink: 'https://meet.google.com/abc',
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

  it('covers every appointment-schema column (supabase/migrations/001_init.sql)', () => {
    // Regression guard for B2: PII_KEYS drifted from the real DB schema once.
    // Construct an event with every patient/therapist/video column and assert
    // all are redacted.
    const data = JSON.stringify({
      patient_name: 'Jean Dupont',
      patient_email: 'patient@example.fr',
      patient_phone: '+33 6 12 34 56 78',
      patient_postal_code: '75011',
      patient_city: 'Paris',
      patient_reason: 'angoisse',
      therapist_notes: 'notes',
      video_link: 'https://meet.google.com/abc',
      adminEmail: 'therapeute@example.fr',
    });
    const scrubbed = scrubPii(makeEvent({ request: { data } }));
    const parsed = JSON.parse(scrubbed.request!.data!);
    expect(parsed.patient_name).toBe('[REDACTED]');
    expect(parsed.patient_email).toBe('[REDACTED]');
    expect(parsed.patient_phone).toBe('[REDACTED]');
    expect(parsed.patient_postal_code).toBe('[REDACTED]');
    expect(parsed.patient_city).toBe('[REDACTED]');
    expect(parsed.patient_reason).toBe('[REDACTED]');
    expect(parsed.therapist_notes).toBe('[REDACTED]');
    expect(parsed.video_link).toBe('[REDACTED]');
    expect(parsed.adminEmail).toBe('[REDACTED]');
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

  it('redacts nested PII inside breadcrumb data (deep walk, not shallow)', () => {
    // H2 regression guard: the logger forwards structured fields as breadcrumb
    // data, e.g. logger.error('x', { body: { email } }). A shallow redact would
    // leave the nested email intact; the scrubber must deep-walk.
    const event = makeEvent({
      breadcrumbs: [
        {
          timestamp: 0,
          data: {
            body: { email: 'leak@example.fr', phone: '+33 6 00 00 00 00' },
            meta: { admin_email: 'op@example.fr' },
            list: [{ video_link: 'https://meet.google.com/x' }],
            ok: 'survives',
          },
        },
      ],
    });

    const scrubbed = scrubPii(event);
    const data = scrubbed.breadcrumbs![0]!.data as Record<string, unknown>;
    expect((data.body as Record<string, unknown>).email).toBe('[REDACTED]');
    expect((data.body as Record<string, unknown>).phone).toBe('[REDACTED]');
    expect((data.meta as Record<string, unknown>).admin_email).toBe(
      '[REDACTED]',
    );
    expect(
      (data.list as Array<Record<string, unknown>>)[0]!.video_link,
    ).toBe('[REDACTED]');
    expect(data.ok).toBe('survives');
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

  it('shares the same scrubPii between client and server (H3 parity)', () => {
    // The spec requires a shared scrub test that runs against both the server
    // and client scrub functions. The client (Layout.astro) and the server
    // (sentry.server.ts) both import the pure scrubPii from @/lib/pii-scrub;
    // the server re-exports it. Asserting identity proves they cannot drift.
    expect(scrubPiiFromServer).toBe(scrubPii);
  });
});
