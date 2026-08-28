import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasValidMockWebhookToken,
  isAuthorizedLocalMockRequest,
  isCalendarMockEnabled,
  isLoopbackHostname,
  MOCK_WEBHOOK_TOKEN_QUERY_PARAM,
} from '@/lib/mock-mode.server';

beforeEach(() => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'true');
  vi.stubEnv('MOCK_WEBHOOK_TOKEN', 'test-mock-webhook-token');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_placeholder');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('local mock mode', () => {
  it('enables calendar mocks only in Astro development', () => {
    expect(isCalendarMockEnabled()).toBe(true);

    vi.stubEnv('DEV', false);

    expect(isCalendarMockEnabled()).toBe(false);
  });

  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])(
    'accepts the loopback hostname %s',
    hostname => {
      expect(isLoopbackHostname(hostname)).toBe(true);
    },
  );

  it('rejects non-loopback hostnames', () => {
    expect(isLoopbackHostname('omf-therapie.fr')).toBe(false);
  });

  it('accepts only the configured capability token', () => {
    expect(hasValidMockWebhookToken('test-mock-webhook-token')).toBe(true);
    expect(hasValidMockWebhookToken('wrong-token')).toBe(false);
    expect(hasValidMockWebhookToken(null)).toBe(false);
  });

  it('rejects authorization when the configured token is missing', () => {
    vi.stubEnv('MOCK_WEBHOOK_TOKEN', '');

    expect(
      isAuthorizedLocalMockRequest(
        new URL('http://localhost/api/stripe-webhook/'),
        'test-mock-webhook-token',
      ),
    ).toBe(false);
  });

  it('rejects authorization outside loopback', () => {
    expect(
      isAuthorizedLocalMockRequest(
        new URL('https://omf-therapie.fr/api/stripe-webhook/'),
        'test-mock-webhook-token',
      ),
    ).toBe(false);
  });

  it('adds the capability to a generated local Stripe mock redirect', async () => {
    vi.resetModules();
    const { createAppointmentPaymentLink } = await import('@/lib/stripe');

    const result = await createAppointmentPaymentLink({
      appointmentId: 'appt_001',
      patientEmail: 'patient@example.com',
      patientName: 'Jean Dupont',
      amount: 5000,
      description: 'Séance vidéo',
      successUrl: 'http://localhost:4321/rdv/merci/',
    });
    const redirect = new URL(result.url);

    expect(redirect.searchParams.get('mock')).toBe('1');
    expect(redirect.searchParams.get('appointment_id')).toBe('appt_001');
    expect(redirect.searchParams.get(MOCK_WEBHOOK_TOKEN_QUERY_PARAM)).toBe(
      'test-mock-webhook-token',
    );
  });
});
