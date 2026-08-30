import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { makeSendFnWithCapture } from '../../netlify/functions/_lib/send-fn';
import type { SendEmailParams } from '../../src/lib/resend';

// ---------------------------------------------------------------------------
// Contract tests for the shared sweep adapter `netlify/functions/_lib/send-fn`
// (post-#129, amended by the PR #131 review).
//
// The adapter DELEGATES every send to `sendEmail` from `src/lib/resend` and
// exposes a capture state (`lastTo`/`lastError`) that the reconcile sweeps read
// after a failed row to classify poison vs retryable. The pinned contract:
//
//   1. Delegation — `sendEmail` is called as `(params, { maxAttempts })`, with
//      maxAttempts defaulting to 1 (sweep cadence budget) and an explicit
//      `makeSendFnWithCapture({ maxAttempts })` forwarded verbatim.
//   2. Capture-at-failure — the state is touched ONLY when the result carries
//      `rawError`. `notifications.ts` sends patient + therapist CONCURRENTLY
//      (`Promise.allSettled`), so assigning the state per call let a concurrent
//      SUCCESS mask a prior FAILURE (the patient 4xx poison escape never fired
//      once ADMIN_EMAIL was set). Here `lastTo` names the FAILING recipient.
//   3. Result verbatim — the `sendEmail` result is returned as-is, never
//      rebuilt, so callers observe the exact transport contract.
//   4. SMTP-shaped failures (no `rawError` by the #129 contract) leave the
//      state untouched — the row is simply retried on the next pass.
//
// Only the transport seam is mocked (`sendEmail`); the adapter itself is real.
// ---------------------------------------------------------------------------

const sendEmailModule = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('../../src/lib/resend', () => ({
  sendEmail: sendEmailModule.sendEmail,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_REACT_ELEMENT = {} as ReactElement;

function baseParams(to: string | string[]): SendEmailParams {
  return {
    to,
    subject: '[test] sujet',
    react: FAKE_REACT_ELEMENT,
  };
}

beforeEach(() => {
  sendEmailModule.sendEmail.mockReset();
  // Default: success with no rawError (the success shape of the seam).
  sendEmailModule.sendEmail.mockResolvedValue({ success: true, id: 're_ok' });
});

describe('makeSendFnWithCapture adapter contract (#129 / PR #131 review)', () => {
  describe('delegation', () => {
    it('calls sendEmail with (params, { maxAttempts: 1 }) by default', async () => {
      await makeSendFnWithCapture().sendFn(baseParams('patient@example.com'));

      expect(sendEmailModule.sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmailModule.sendEmail.mock.calls[0][1]).toEqual({
        maxAttempts: 1,
      });
    });

    it('forwards an explicit maxAttempts verbatim', async () => {
      await makeSendFnWithCapture({ maxAttempts: 5 }).sendFn(
        baseParams('patient@example.com'),
      );

      expect(sendEmailModule.sendEmail.mock.calls[0][1]).toEqual({
        maxAttempts: 5,
      });
    });

    it('hands the params over untouched (no normalization, no injected bcc)', async () => {
      const params = baseParams('patient@example.com');
      await makeSendFnWithCapture().sendFn(params);

      expect(sendEmailModule.sendEmail.mock.calls[0][0]).toBe(params);
    });
  });

  describe('capture-at-failure', () => {
    it('leaves the state untouched on success and returns the result verbatim', async () => {
      const result = { success: true, id: 're_ok' };
      sendEmailModule.sendEmail.mockResolvedValueOnce(result);
      const { sendFn, state } = makeSendFnWithCapture();

      const returned = await sendFn(baseParams('patient@example.com'));

      // Verbatim — the caller must observe the exact transport result.
      expect(returned).toBe(result);
      expect(state.lastError).toBeNull();
      expect(state.lastTo).toEqual([]);
    });

    it('captures lastTo as a normalized list + lastError when rawError is set (`to` as a string)', async () => {
      const rawError = {
        name: 'validation_error',
        statusCode: 422,
        message: 'Invalid to',
      };
      sendEmailModule.sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'Invalid to',
        rawError,
      });
      const { sendFn, state } = makeSendFnWithCapture();

      await sendFn(baseParams('patient@example.com'));

      expect(state.lastTo).toEqual(['patient@example.com']);
      expect(state.lastError).toBe(rawError);
    });

    it('captures lastTo as a normalized list when `to` is already an array', async () => {
      const rawError = {
        name: 'validation_error',
        statusCode: 422,
        message: 'Invalid to',
      };
      sendEmailModule.sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'Invalid to',
        rawError,
      });
      const { sendFn, state } = makeSendFnWithCapture();

      await sendFn(baseParams(['a@example.com', 'b@example.com']));

      expect(state.lastTo).toEqual(['a@example.com', 'b@example.com']);
      expect(state.lastError).toBe(rawError);
    });

    it('does NOT let a concurrent success mask a prior failure (Promise.allSettled race)', async () => {
      // THE PR #131 regression: patient fails 422, therapist succeeds — under
      // assign-before-delegation the success reset lastError to null and the
      // poison escape never fired. Capture-at-failure keeps the failure.
      const rawError = {
        name: 'validation_error',
        statusCode: 422,
        message: 'Invalid to',
      };
      sendEmailModule.sendEmail
        .mockResolvedValueOnce({
          success: false,
          error: 'Invalid to',
          rawError,
        })
        .mockResolvedValueOnce({ success: true, id: 're_admin' });
      const { sendFn, state } = makeSendFnWithCapture();

      await Promise.allSettled([
        sendFn(baseParams('patient@example.com')),
        sendFn(baseParams('admin@omf-therapie.fr')),
      ]);

      expect(state.lastError).toBe(rawError);
      expect(state.lastTo).toEqual(['patient@example.com']);
    });

    it('leaves the state untouched on an SMTP-shaped failure (no rawError by contract)', async () => {
      sendEmailModule.sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'SMTP rejected the message',
      });
      const { sendFn, state } = makeSendFnWithCapture();

      const returned = await sendFn(baseParams('patient@example.com'));

      expect(returned).toEqual({
        success: false,
        error: 'SMTP rejected the message',
      });
      expect(state.lastError).toBeNull();
      expect(state.lastTo).toEqual([]);
    });
  });
});
