import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import type {
  SendEmailOpts,
  SendEmailParams,
  SendEmailResult,
} from '../../src/lib/resend';

// ---------------------------------------------------------------------------
// Contract tests — the transport seam of `src/lib/resend.ts` (issue #129,
// amended by the PR #131 review). The seam is implemented; these tests PIN it
// so the invariants below cannot regress:
//
//   (a) SC1 — `SendEmailResult.rawError` (additive field): every failure path
//       (API 4xx/5xx, network throw, outer render/pipeline throw, missing API
//       key) surfaces the ORIGINAL Resend error ({ name, statusCode, message })
//       alongside the human-readable `error` string, so callers (reconcile
//       sweeps, webhook) can classify retryable-vs-poison without re-parsing
//       the message. `rawError` stays absent on success. The idempotency key
//       (L1) is propagated verbatim to the SDK options.
//   (b) SC2 — `sendEmail(params, { maxAttempts })`: the retry budget is
//       caller-controlled and CLAMPED (non-finite → default 3, <1 → 1).
//       Classification (`resend-errors.ts`: 5xx/null/429/application_error →
//       retryable, other 4xx → poison) is untouched.
//   (c) Auto-BCC admin invariant: ADMIN_EMAIL is appended to bcc unless the
//       admin is already a recipient (in `to` or `bcc`, case-insensitively);
//       never duplicated.
//   (d) SC3 — env-agnostic guarded env reads (source assertion, mirrors
//       cron-schedule-source.test.ts): each of RESEND_API_KEY,
//       RESEND_FROM_EMAIL, ADMIN_EMAIL, SMTP_HOST, SMTP_PORT must be read
//       through the stripe.ts:22 idiom
//       `(import.meta as {env?: …}).env?.VAR ?? process.env.VAR`, and no bare
//       `import.meta.env.VAR` read may remain. Verified statically because
//       `import.meta.env` EXISTS under Vitest — runtime stubbing cannot prove
//       env-agnosticism.
//
// Mock leaves: `resend` (Resend class + emails.send), `@react-email/render`,
// and resend.ts's sibling `./supabase` (thread persistence). Module-level
// caches (cachedSmtpTransport/cachedResendClient) are defeated with
// `vi.resetModules()` + a dynamic import per test. SMTP stays OFF (no
// SMTP_HOST stub): every test exercises the Resend transport only. Retry
// tests sleep through the real backoff (~300–900 ms) — acceptable for a
// single file; switch to fake timers if the suite grows.
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, '..', '..');

// --- Resend SDK mock — single shared `emails.send` leaf ---------------------

const resendState = vi.hoisted(() => ({
  send: vi.fn(),
  constructorKeys: [] as string[],
}));

vi.mock('resend', () => ({
  Resend: class {
    apiKey: string;
    emails: { send: typeof resendState.send };
    constructor(apiKey: string) {
      this.apiKey = apiKey;
      resendState.constructorKeys.push(apiKey);
      this.emails = { send: resendState.send };
    }
  },
}));

const renderState = vi.hoisted(() => ({
  render: vi.fn(async () => '<html><body>rendu de test</body></html>'),
}));

vi.mock('@react-email/render', () => ({
  render: renderState.render,
}));

// --- Supabase mock — thread persistence chain only ---------------------------
// resend.ts imports `./supabase`; from tests/unit the same module id resolves
// as `../../src/lib/supabase` (Vitest matches by resolved id). The chain only
// needs to tolerate select().eq().maybeSingle() and insert()/update().eq()
// await chains with empty successes.

interface ThreadQueryResult {
  data: null;
  error: null;
}

interface ThreadChainMock {
  select: ReturnType<typeof vi.fn<() => ThreadChainMock>>;
  eq: ReturnType<typeof vi.fn<() => ThreadChainMock>>;
  insert: ReturnType<typeof vi.fn<() => ThreadChainMock>>;
  update: ReturnType<typeof vi.fn<() => ThreadChainMock>>;
  maybeSingle: ReturnType<typeof vi.fn<() => Promise<ThreadQueryResult>>>;
  then: (
    onFulfilled: (value: ThreadQueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

const supabaseFrom = vi.fn((_table: string): ThreadChainMock => {
  const emptyResult: ThreadQueryResult = { data: null, error: null };
  const chain: ThreadChainMock = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => emptyResult),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(emptyResult).then(onFulfilled, onRejected),
  };
  return chain;
});

vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: supabaseFrom },
  supabaseAdmin: { from: supabaseFrom },
}));

// --- Fixtures ----------------------------------------------------------------

const FAKE_REACT_ELEMENT = {} as ReactElement;

function baseParams(overrides?: Partial<SendEmailParams>): SendEmailParams {
  return {
    to: 'patient@example.com',
    subject: 'Confirmation de rendez-vous',
    react: FAKE_REACT_ELEMENT,
    ...overrides,
  };
}

/**
 * Dynamic import per test: `vi.resetModules()` in beforeEach yields a fresh
 * module instance so the module-level transport/client caches never leak
 * between tests. The opts param + rawError field are native seam exports.
 */
async function sendForContract(
  params: SendEmailParams,
  opts?: SendEmailOpts,
): Promise<SendEmailResult> {
  const { sendEmail } = await import('../../src/lib/resend');
  return sendEmail(params, opts);
}

function capturedPayload(callIndex = 0): Record<string, unknown> {
  const calls = resendState.send.mock.calls as unknown[][];
  const args = calls[callIndex];
  expect(args, `emails.send call #${callIndex} not captured`).toBeDefined();
  return args![0] as Record<string, unknown>;
}

/** The SDK options argument (`{ idempotencyKey }` — the L1 propagation pin). */
function capturedOptions(callIndex = 0): Record<string, unknown> {
  const calls = resendState.send.mock.calls as unknown[][];
  const args = calls[callIndex];
  expect(args, `emails.send call #${callIndex} not captured`).toBeDefined();
  return args![1] as Record<string, unknown>;
}

function countAdminOccurrences(emails: string[] | undefined): number {
  return (emails ?? []).filter(
    address => address.trim().toLowerCase() === 'admin@omf-therapie.fr',
  ).length;
}

describe('sendEmail transport seam — issue #129 (contract)', () => {
  beforeEach(() => {
    vi.resetModules();
    resendState.send.mockReset();
    resendState.constructorKeys.length = 0;
    // mockClear (not reset): keeps the default render implementation so only
    // the outer-throw test needs to override it.
    renderState.render.mockClear();
    // Client instantiation gate — read through the guarded seam
    // (vi.stubEnv covers both import.meta.env and process.env sources).
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // (a) SC1 — rawError: additive field on every failure path
  // -------------------------------------------------------------------------

  describe('(a) SC1 — result.rawError carries the original Resend error', () => {
    it('exposes rawError {name, statusCode} on a permanent 422 validation error', async () => {
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'validation_error',
          statusCode: 422,
          message: 'Invalid to',
        },
      });

      const result = await sendForContract(baseParams());

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error).toBeTruthy();
      expect(result.rawError).toMatchObject({
        statusCode: 422,
        name: 'validation_error',
      });
      // 422 is a poison message — never retried.
      expect(resendState.send).toHaveBeenCalledTimes(1);
    });

    it('exposes rawError {statusCode: 503} on a retryable server error', async () => {
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'server_error',
          statusCode: 503,
          message: 'Service unavailable',
        },
      });

      // maxAttempts: 1 keeps this single-call (future opts param — see (b)).
      const result = await sendForContract(baseParams(), { maxAttempts: 1 });

      expect(result.success).toBe(false);
      expect(result.rawError?.statusCode).toBe(503);
    });

    it('exposes rawError {name: network_error} when emails.send rejects', async () => {
      resendState.send.mockRejectedValue(new Error('fetch failed'));

      const result = await sendForContract(baseParams(), { maxAttempts: 1 });

      expect(result.success).toBe(false);
      expect(result.rawError?.name).toBe('network_error');
      expect(resendState.send).toHaveBeenCalledTimes(1);
    });

    it('keeps rawError absent on success and returns the Resend id', async () => {
      resendState.send.mockResolvedValue({
        data: { id: 'email-id-1' },
        error: null,
      });

      const result = await sendForContract(baseParams());

      expect(result.success).toBe(true);
      expect(result.id).toBe('email-id-1');
      expect(result.rawError).toBeUndefined();
      // The client was built from the stubbed RESEND_API_KEY.
      expect(resendState.constructorKeys).toEqual(['re_test_key']);
    });

    it('wraps an outer throw (render rejection) as rawError {name: unexpected_error}', async () => {
      // render() runs before the SDK call inside the same try — a rejection
      // must surface as a structured failure (the "every error has a rawError"
      // contract), never as an exception escaping sendEmail.
      renderState.render.mockRejectedValueOnce(new Error('render exploded'));

      const result = await sendForContract(baseParams());

      expect(result.success).toBe(false);
      expect(result.rawError?.name).toBe('unexpected_error');
      expect(result.error).toBe('render exploded');
      expect(resendState.send).not.toHaveBeenCalled();
    });

    it('propagates the idempotencyKey to the SDK options (L1 — Idempotency-Key header)', async () => {
      resendState.send.mockResolvedValue({
        data: { id: 'email-id-1' },
        error: null,
      });

      await sendForContract(
        baseParams({ idempotencyKey: 'invite:appt-1:patient' }),
      );

      expect(capturedOptions()).toEqual({
        idempotencyKey: 'invite:appt-1:patient',
      });
    });

    it('sends empty SDK options when no idempotencyKey is set', async () => {
      resendState.send.mockResolvedValue({
        data: { id: 'email-id-1' },
        error: null,
      });

      await sendForContract(baseParams());

      expect(capturedOptions()).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // (b) SC2 — opts.maxAttempts: caller-controlled retry budget
  // -------------------------------------------------------------------------

  describe('(b) SC2 — opts.maxAttempts controls the retry budget', () => {
    it('retries a retryable 503 exactly 3 times with the default call', async () => {
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'server_error',
          statusCode: 503,
          message: 'Service unavailable',
        },
      });

      await sendForContract(baseParams()); // no opts → default budget (3)

      expect(resendState.send).toHaveBeenCalledTimes(3);
    });

    it('honors maxAttempts: 1 — single call, no retry', async () => {
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'server_error',
          statusCode: 503,
          message: 'Service unavailable',
        },
      });

      const result = await sendForContract(baseParams(), { maxAttempts: 1 });

      expect(resendState.send).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
    });

    it('retries a 429 rate-limit by default (classification intact)', async () => {
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'rate_limit_error',
          statusCode: 429,
          message: 'Too many requests',
        },
      });

      await sendForContract(baseParams());

      expect(resendState.send).toHaveBeenCalledTimes(3);
    });

    it('caps a 429 retry at maxAttempts (classification respects the budget)', async () => {
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'rate_limit_error',
          statusCode: 429,
          message: 'Too many requests',
        },
      });

      await sendForContract(baseParams(), { maxAttempts: 2 });

      expect(resendState.send).toHaveBeenCalledTimes(2);
    });

    it('clamps maxAttempts: 0 up to 1 — exactly one SDK call, no zero-budget silent skip', async () => {
      // A 0 budget must not make the loop body run zero times (a failure
      // reported without any SDK call would corrupt the retry semantics).
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'server_error',
          statusCode: 503,
          message: 'Service unavailable',
        },
      });

      const result = await sendForContract(baseParams(), { maxAttempts: 0 });

      expect(resendState.send).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
    });

    it('treats a non-finite maxAttempts (NaN) as the default budget 3', async () => {
      resendState.send.mockResolvedValue({
        data: null,
        error: {
          name: 'server_error',
          statusCode: 503,
          message: 'Service unavailable',
        },
      });

      await sendForContract(baseParams(), { maxAttempts: Number.NaN });

      expect(resendState.send).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['Infinity (non-finite)', Number.POSITIVE_INFINITY, 3],
      ['fractional 0.5 (floors + clamps up)', 0.5, 1],
    ] as const)(
      'clamps maxAttempts: %s → budget %d',
      async (_label, input, expectedCalls) => {
        resendState.send.mockResolvedValue({
          data: null,
          error: {
            name: 'server_error',
            statusCode: 503,
            message: 'Service unavailable',
          },
        });

        await sendForContract(baseParams(), { maxAttempts: input });

        expect(resendState.send).toHaveBeenCalledTimes(expectedCalls);
      },
    );

    it('synthesizes rawError {missing_api_key} when the client cannot initialize', async () => {
      // Amendement 12 : la sortie client-absent porte elle aussi un rawError
      // (sans statusCode → retryable → la row est re-essayée au passage
      // suivant, cohérent avec la garde startup des sweeps).
      vi.stubEnv('RESEND_API_KEY', '');

      const result = await sendForContract(baseParams());

      expect(result.success).toBe(false);
      expect(result.rawError).toMatchObject({ name: 'missing_api_key' });
      expect(resendState.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (c) Invariant pin — auto-BCC admin (already green today)
  // -------------------------------------------------------------------------

  describe('(c) invariant — auto-BCC admin, never duplicated', () => {
    it('appends ADMIN_EMAIL to bcc when the admin is not a recipient', async () => {
      vi.stubEnv('ADMIN_EMAIL', 'admin@omf-therapie.fr');
      resendState.send.mockResolvedValue({
        data: { id: 'email-id-1' },
        error: null,
      });

      await sendForContract(baseParams({ to: 'patient@example.com' }));

      expect(resendState.send).toHaveBeenCalledTimes(1);
      const payload = capturedPayload();
      expect(countAdminOccurrences(payload.bcc as string[] | undefined)).toBe(
        1,
      );
    });

    it('does not add the admin to bcc when it is already in `to`', async () => {
      vi.stubEnv('ADMIN_EMAIL', 'admin@omf-therapie.fr');
      resendState.send.mockResolvedValue({
        data: { id: 'email-id-1' },
        error: null,
      });

      await sendForContract(
        baseParams({ to: ['patient@example.com', 'admin@omf-therapie.fr'] }),
      );

      const payload = capturedPayload();
      expect(countAdminOccurrences(payload.to as string[])).toBe(1);
      expect(countAdminOccurrences(payload.bcc as string[] | undefined)).toBe(
        0,
      );
    });

    it('does not duplicate the admin when explicit `bcc` already contains it', async () => {
      vi.stubEnv('ADMIN_EMAIL', 'admin@omf-therapie.fr');
      resendState.send.mockResolvedValue({
        data: { id: 'email-id-1' },
        error: null,
      });

      // Mixed case on purpose — the dedup must be case-insensitive.
      await sendForContract(baseParams({ bcc: 'Admin@Omf-Therapie.fr' }));

      const payload = capturedPayload();
      expect(countAdminOccurrences(payload.bcc as string[] | undefined)).toBe(
        1,
      );
    });

    it('detects the admin in `to` case-insensitively', async () => {
      vi.stubEnv('ADMIN_EMAIL', 'admin@omf-therapie.fr');
      resendState.send.mockResolvedValue({
        data: { id: 'email-id-1' },
        error: null,
      });

      await sendForContract(baseParams({ to: 'ADMIN@Omf-Therapie.FR' }));

      const payload = capturedPayload();
      expect(countAdminOccurrences(payload.bcc as string[] | undefined)).toBe(
        0,
      );
    });
  });

  // -------------------------------------------------------------------------
  // (d) SC3 — env-agnostic guarded env reads (static source assertion)
  // -------------------------------------------------------------------------

  describe('(d) SC3 — guarded env reads in src/lib/resend.ts (source assertion)', () => {
    // Read the SOURCE as text (cron-schedule-source.test.ts idiom): Vitest
    // injects import.meta.env, so runtime behavior can never prove
    // env-agnosticism — only the source shape can.
    const source = (() => {
      const raw = readFileSync(resolve(REPO_ROOT, 'src/lib/resend.ts'), 'utf8');
      // Strip comments so documentation examples cannot false-positive.
      return raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    })();

    const SEAM_ENV_VARS: readonly string[] = [
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
      'ADMIN_EMAIL',
      'SMTP_HOST',
      'SMTP_PORT',
    ];

    it.each(SEAM_ENV_VARS)(
      'reads %s via the guarded `env?.VAR ?? process.env.VAR` idiom (stripe.ts:22)',
      variable => {
        const guarded = new RegExp(
          `env\\s*\\?\\.\\s*${variable}\\s*\\?\\?\\s*process\\.env\\.${variable}\\b`,
        );
        expect(source).toMatch(guarded);
      },
    );

    it('keeps no bare `import.meta.env.<VAR>` read for the five seam variables', () => {
      const bareRead = new RegExp(
        `import\\.meta\\.env\\.(${SEAM_ENV_VARS.join('|')})\\b`,
      );
      expect(
        source,
        'bare import.meta.env reads remain — the seam is still env-dependent',
      ).not.toMatch(bareRead);
    });
  });
});
