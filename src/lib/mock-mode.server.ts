import { createHash, timingSafeEqual } from 'node:crypto';

export const MOCK_WEBHOOK_TOKEN_HEADER = 'x-omf-mock-webhook-token';
export const MOCK_WEBHOOK_TOKEN_QUERY_PARAM = 'mock_token';

function readEnv(key: string): string | boolean | undefined {
  const fromMeta = (import.meta as {
    env?: Record<string, string | boolean | undefined>;
  }).env?.[key];
  return fromMeta ?? process.env[key];
}

/**
 * Calendar and payment mocks are local development capabilities only.
 */
export function isCalendarMockEnabled(): boolean {
  const development = readEnv('DEV');
  return (
    (development === true || development === 'true') &&
    readEnv('GOOGLE_CALENDAR_MOCK') === 'true'
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

export function getMockWebhookToken(): string | null {
  const token = readEnv('MOCK_WEBHOOK_TOKEN');
  return token && token.trim().length > 0 ? token : null;
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function hasValidMockWebhookToken(
  candidate: string | null | undefined,
): boolean {
  const configuredToken = getMockWebhookToken();
  if (!configuredToken || !candidate) return false;

  return timingSafeEqual(digestToken(candidate), digestToken(configuredToken));
}

export function isAuthorizedLocalMockRequest(
  url: URL,
  candidateToken: string | null | undefined,
): boolean {
  return (
    isCalendarMockEnabled() &&
    isLoopbackHostname(url.hostname) &&
    hasValidMockWebhookToken(candidateToken)
  );
}
