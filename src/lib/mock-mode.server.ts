import { createHash, timingSafeEqual } from 'node:crypto';

export const MOCK_WEBHOOK_TOKEN_HEADER = 'x-omf-mock-webhook-token';
export const MOCK_WEBHOOK_TOKEN_QUERY_PARAM = 'mock_token';

const MIN_MOCK_WEBHOOK_TOKEN_LENGTH = 32;
const MOCK_WEBHOOK_TOKEN_SENTINELS = new Set([
  'remplacer-par-un-token-aleatoire-local',
  'replace-with-a-random-local-token',
  'change-me',
  'changeme',
  'placeholder',
]);

/**
 * Calendar and payment mocks are local development capabilities only.
 */
export function isCalendarMockEnabled(): boolean {
  try {
    return (
      import.meta.env.DEV && import.meta.env.GOOGLE_CALENDAR_MOCK === 'true'
    );
  } catch {
    return (
      process.env.DEV === 'true' &&
      process.env.GOOGLE_CALENDAR_MOCK === 'true'
    );
  }
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
  let configuredToken: string | undefined;
  try {
    configuredToken = import.meta.env.MOCK_WEBHOOK_TOKEN;
  } catch {
    configuredToken = process.env.MOCK_WEBHOOK_TOKEN;
  }
  const token = configuredToken?.trim() ?? '';
  if (
    token.length < MIN_MOCK_WEBHOOK_TOKEN_LENGTH ||
    MOCK_WEBHOOK_TOKEN_SENTINELS.has(token.toLowerCase())
  ) {
    return null;
  }

  return token;
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
