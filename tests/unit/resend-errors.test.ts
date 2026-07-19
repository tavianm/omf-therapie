import { describe, expect, it } from 'vitest';
import { isRetryableResendError, type ResendApiError } from '@/lib/resend-errors';

// ---------------------------------------------------------------------------
// Issue #68 post-rebase review : contrat de classification d'erreur Resend.
// Le webhook (`src/lib/resend.ts`) et le sweep (`netlify/functions/reconcile-confirmations.ts`)
// partagent désormais ce prédicat. Ce test verrouille la classification pour
// qu'aucun des deux chemins ne dévie sur la politique poison-escape (marquer
// confirmation_sent_at pour stopper les retries sur une 4xx permanente) vs.
// retryable (laisser NULL, le prochain sweep réessaie).
// ---------------------------------------------------------------------------

function err(statusCode: number | null, name?: string): ResendApiError {
  return { statusCode, name, message: 'test error' };
}

describe('isRetryableResendError', () => {
  describe('retryable cases (returns true)', () => {
    it('5xx server errors are retryable', () => {
      expect(isRetryableResendError(err(500))).toBe(true);
      expect(isRetryableResendError(err(502))).toBe(true);
      expect(isRetryableResendError(err(503))).toBe(true);
      expect(isRetryableResendError(err(599))).toBe(true);
    });

    it('429 rate-limit is retryable despite being 4xx', () => {
      // Critical: 429 was added as retryable in #68 because rate limits are
      // transient. If this regresses, the sweep would poison-escape rows that
      // just need to wait out the rate window — permanently dropping emails.
      expect(isRetryableResendError(err(429))).toBe(true);
    });

    it('null statusCode is retryable (network error / unknown)', () => {
      expect(isRetryableResendError(err(null))).toBe(true);
    });

    it('application_error name is retryable regardless of status', () => {
      expect(isRetryableResendError(err(422, 'application_error'))).toBe(true);
    });
  });

  describe('permanent cases (returns false — poison)', () => {
    it('400 bad request is permanent', () => {
      expect(isRetryableResendError(err(400))).toBe(false);
    });

    it('422 validation error is permanent', () => {
      expect(isRetryableResendError(err(422))).toBe(false);
    });

    it('404 not found is permanent', () => {
      expect(isRetryableResendError(err(404))).toBe(false);
    });

    it('401 unauthorized is permanent', () => {
      expect(isRetryableResendError(err(401))).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('null input returns false', () => {
      expect(isRetryableResendError(null)).toBe(false);
    });

    it('undefined input returns false', () => {
      expect(isRetryableResendError(undefined)).toBe(false);
    });

    it('empty error object is retryable (no status = network/unknown error)', () => {
      // An error with no statusCode is treated like null statusCode: retryable.
      // This matches the production behavior — a Resend SDK exception without
      // a status code is a network failure, not a validation rejection.
      expect(isRetryableResendError({})).toBe(true);
    });
  });

  describe('falsifiability (regression net)', () => {
    // If someone changes the predicate to `return true` (treats everything as
    // retryable), this test fails — because then poison-escape never fires and
    // a malformed-email row would retry forever, consuming a sweep slot hourly.
    it('does NOT treat all errors as retryable (a 400 must return false)', () => {
      const allRetryable = [400, 401, 404, 422].every((s) => isRetryableResendError(err(s)));
      expect(allRetryable).toBe(false);
    });

    // If someone removes the 429 branch (regression to pre-#68), this fails.
    it('does NOT treat 429 as permanent (must remain retryable)', () => {
      expect(isRetryableResendError(err(429))).toBe(true);
    });
  });
});
