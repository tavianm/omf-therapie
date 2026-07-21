import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  createSecureLinkToken,
  verifySecureLinkToken,
} from '@/lib/secure-links';

// ---------------------------------------------------------------------------
// Issue #68 post-rebase review : contrat du signeur HMAC pour le jeton .ics.
//
// Le webhook (runtime Astro, import.meta.env) et le sweep (runtime Node, process.env)
// doivent produire des jetons vérifiables par le MÊME endpoint /api/calendar/invite/:id.
// Si le signeur dérive (champ payload modifié, version bumpée, encoding différent),
// tous les liens .ics envoyés par un chemin seront invalides côté l'autre.
//
// Post-refactor : `createSecureLinkToken` accepte un `secret?` optionnel.
// Le webhook passe rien (lit import.meta.env.BETTER_AUTH_SECRET via getSecureLinksSecret).
// Le sweep passe process.env.BETTER_AUTH_SECRET explicitement.
// Ce test verrouille la parité.
// ---------------------------------------------------------------------------

const TEST_SECRET = 'x'.repeat(48); // ≥32 chars requirement

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_SECRET', TEST_SECRET);
});

describe('createSecureLinkToken — secret injection parity', () => {
  it('accepts an explicit secret param (sweep path: process.env)', () => {
    const token = createSecureLinkToken({
      appointmentId: 'appt_001',
      purpose: 'ics-invite',
      expiresInSeconds: 60 * 60 * 24 * 180,
      nonce: '2026-07-10T07:00:00.000Z',
      secret: TEST_SECRET,
    });
    // Token format: base64url(payload).base64url(signature)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('falls back to import.meta.env.BETTER_AUTH_SECRET when secret is omitted (webhook path)', () => {
    const token = createSecureLinkToken({
      appointmentId: 'appt_001',
      purpose: 'ics-invite',
      expiresInSeconds: 60 * 60 * 24 * 180,
      nonce: '2026-07-10T07:00:00.000Z',
      // No secret → reads import.meta.env.BETTER_AUTH_SECRET (stubbed via vitest setup)
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('produces tokens verifiable by verifySecureLinkToken under the SAME secret (cross-path guarantee)', () => {
    // The sweep creates with explicit secret; the verifier reads env default.
    // If both resolve to the same secret, verification MUST pass.
    const nonce = '2026-07-10T07:00:00.000Z';
    const token = createSecureLinkToken({
      appointmentId: 'appt_xyz',
      purpose: 'ics-invite',
      expiresInSeconds: 60 * 60, // 1 hour
      nonce,
      secret: TEST_SECRET,
    });
    const isValid = verifySecureLinkToken({
      token,
      appointmentId: 'appt_xyz',
      purpose: 'ics-invite',
      nonce,
    });
    expect(isValid).toBe(true);
  });

  it('fails verification when secrets differ (catches env-config drift)', () => {
    // Sweep has secret A; the verifier has env secret B → token must NOT verify.
    vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(48));
    const tokenFromSweep = createSecureLinkToken({
      appointmentId: 'appt_drift',
      purpose: 'ics-invite',
      expiresInSeconds: 60 * 60,
      nonce: 'n',
      secret: 'b'.repeat(48), // sweep's secret ≠ verifier's env
    });
    const isValid = verifySecureLinkToken({
      token: tokenFromSweep,
      appointmentId: 'appt_drift',
      purpose: 'ics-invite',
      nonce: 'n',
    });
    expect(isValid).toBe(false);
  });
});

describe('createSecureLinkToken — payload schema lock', () => {
  // The payload structure MUST stay in sync with the verifier's expectations.
  // If a future edit adds/removes/renames a field, the verifier breaks silently.
  it('emits payload with version=1, purpose, aid, exp, and optional nonce', () => {
    const token = createSecureLinkToken({
      appointmentId: 'appt_schema',
      purpose: 'ics-invite',
      expiresInSeconds: 3600,
      nonce: 'my-nonce',
      secret: TEST_SECRET,
    });
    const [payloadEncoded] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadEncoded, 'base64url').toString('utf8'),
    );
    expect(payload).toMatchObject({
      v: 1,
      p: 'ics-invite',
      aid: 'appt_schema',
      n: 'my-nonce',
    });
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('omits the nonce field when not provided (matches sweep replica contract)', () => {
    // The sweep's old createInviteToken emitted `...(nonce ? { n: nonce } : {})`.
    // createSecureLinkToken must do the same — if it always emits `n: undefined`,
    // the JSON serialization differs and the byte-identity claim breaks.
    const token = createSecureLinkToken({
      appointmentId: 'appt_no_nonce',
      purpose: 'ics-invite',
      expiresInSeconds: 3600,
      secret: TEST_SECRET,
    });
    const [payloadEncoded] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadEncoded, 'base64url').toString('utf8'),
    );
    expect(payload).not.toHaveProperty('n');
  });
});

describe('createSecureLinkToken — secret length validation', () => {
  it('throws if secret is too short (<32 chars)', () => {
    expect(() =>
      createSecureLinkToken({
        appointmentId: 'appt_x',
        purpose: 'ics-invite',
        expiresInSeconds: 3600,
        secret: 'short',
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('throws if env secret is too short when no explicit secret given', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'short');
    expect(() =>
      createSecureLinkToken({
        appointmentId: 'appt_x',
        purpose: 'ics-invite',
        expiresInSeconds: 3600,
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});
