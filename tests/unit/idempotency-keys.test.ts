import { describe, expect, it } from 'vitest';
import {
  patientConfirmationKey,
  therapistConfirmationKey,
  PATIENT_CONFIRMATION_PREFIX,
  THERAPIST_CONFIRMATION_PREFIX,
} from '@/lib/idempotency-keys';

// ---------------------------------------------------------------------------
// Issue #68 post-rebase review : contrat de format des clés d'idempotence.
// Les deux chemins (webhook via notifications.ts + sweep via le module partagé)
// appellent désormais ces constructeurs. Ce test verrouille le format pour
// qu'aucun des deux chemins ne dérive silencieusement et rouvre la fenêtre de
// doublon (Resend déduplique sur la VALEUR de la clé).
// ---------------------------------------------------------------------------

describe('patientConfirmationKey', () => {
  it('returns `confirm:patient:{pi}` when paymentIntentId is provided', () => {
    expect(patientConfirmationKey('pi_test_123')).toBe('confirm:patient:pi_test_123');
  });

  it('returns undefined when paymentIntentId is null (no L1 dedup)', () => {
    expect(patientConfirmationKey(null)).toBeUndefined();
  });

  it('returns undefined when paymentIntentId is undefined', () => {
    expect(patientConfirmationKey(undefined)).toBeUndefined();
  });

  it('returns undefined when paymentIntentId is empty string', () => {
    expect(patientConfirmationKey('')).toBeUndefined();
  });

  it('uses the exported prefix constant (single source of truth)', () => {
    expect(patientConfirmationKey('pi_x')).toBe(`${PATIENT_CONFIRMATION_PREFIX}pi_x`);
  });
});

describe('therapistConfirmationKey', () => {
  it('returns `confirm:therapist:{pi}` when paymentIntentId is provided', () => {
    expect(therapistConfirmationKey('pi_test_456')).toBe('confirm:therapist:pi_test_456');
  });

  it('returns undefined when paymentIntentId is null', () => {
    expect(therapistConfirmationKey(null)).toBeUndefined();
  });

  it('uses the exported prefix constant', () => {
    expect(therapistConfirmationKey('pi_y')).toBe(`${THERAPIST_CONFIRMATION_PREFIX}pi_y`);
  });
});

describe('cross-recipient isolation (Resend dedup invariant)', () => {
  // Resend déduplique sur la valeur de la clé, PAS sur un hash du body.
  // Si patient et thérapeute partageaient la même clé, le second email serait
  // silencieusement rejeté comme « replay » du premier. Les deux clés doivent
  // donc DIFFÉRER pour un même paymentIntentId.
  it('patient and therapist keys differ for the same paymentIntentId', () => {
    const pi = 'pi_shared_789';
    expect(patientConfirmationKey(pi)).not.toBe(therapistConfirmationKey(pi));
  });

  it('patient and therapist keys share the same paymentIntentId suffix', () => {
    const pi = 'pi_shared_789';
    // Le suffixe `{pi}` doit être identique — Resend n'accepte pas de doublons
    // in-flight pour une même clé, donc si le webhook + le sweep envoient
    // simultanément l'email patient, un seul passe (le doublon est dédupliqué).
    expect(patientConfirmationKey(pi)).toMatch(new RegExp(`${pi}$`));
    expect(therapistConfirmationKey(pi)).toMatch(new RegExp(`${pi}$`));
  });
});
