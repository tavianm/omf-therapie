import { createHmac, timingSafeEqual } from 'node:crypto';

type SecureLinkPurpose = 'ics-invite' | 'accept-reschedule';

interface SecureLinkPayload {
  v: 1;
  p: SecureLinkPurpose;
  aid: string;
  exp: number;
  n?: string;
}

interface CreateSecureLinkTokenInput {
  appointmentId: string;
  purpose: SecureLinkPurpose;
  expiresInSeconds: number;
  nonce?: string;
  /**
   * Secret HMAC explicite (DI seam — issue #68 post-rebase review).
   *
   * Par défaut, le secret est lu via `getSecureLinksSecret()` (import.meta.env).
   * Le sweep Netlify (`netlify/functions/reconcile-confirmations.ts`) s'exécute
   * dans le runtime Node où `import.meta.env` est undefined — il doit donc
   * passer `process.env.BETTER_AUTH_SECRET` explicitement. Les deux chemins
   * utilisent alors le même signeur canonique (plus de duplication du payload
   * + signature → plus de risque de dérive sur la vérification /api/calendar/invite).
   */
  secret?: string;
}

interface VerifySecureLinkTokenInput {
  token: string;
  appointmentId: string;
  purpose: SecureLinkPurpose;
  nonce?: string;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSecureLinksSecret(explicit?: string): string {
  const secret = explicit ?? import.meta.env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error('BETTER_AUTH_SECRET manquant ou trop court pour signer les liens sécurisés.');
  }
  return secret;
}

function signPayload(payloadEncoded: string, secret?: string): string {
  const resolvedSecret = getSecureLinksSecret(secret);
  return createHmac('sha256', resolvedSecret).update(payloadEncoded).digest('base64url');
}

export function createSecureLinkToken({
  appointmentId,
  purpose,
  expiresInSeconds,
  nonce,
  secret,
}: CreateSecureLinkTokenInput): string {
  const payload: SecureLinkPayload = {
    v: 1,
    p: purpose,
    aid: appointmentId,
    exp: Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresInSeconds)),
    ...(nonce ? { n: nonce } : {}),
  };

  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadEncoded, secret);
  return `${payloadEncoded}.${signature}`;
}

export function verifySecureLinkToken({
  token,
  appointmentId,
  purpose,
  nonce,
}: VerifySecureLinkTokenInput): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadEncoded, signatureEncoded] = parts;
  if (!payloadEncoded || !signatureEncoded) return false;

  const expectedSignature = signPayload(payloadEncoded);
  const providedBuffer = Buffer.from(signatureEncoded, 'base64url');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return false;

  let payload: SecureLinkPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded)) as SecureLinkPayload;
  } catch {
    return false;
  }

  if (payload.v !== 1) return false;
  if (payload.p !== purpose) return false;
  if (payload.aid !== appointmentId) return false;
  if (!Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return false;
  if (nonce !== undefined && payload.n !== nonce) return false;

  return true;
}
