/**
 * Constructeurs de clés d'idempotence Resend — primitives partagées.
 *
 * Module env-agnostic : aucune lecture d'environnement. Partagé entre le webhook
 * (`src/lib/notifications.ts`) et le sweep (`netlify/functions/reconcile-confirmations.ts`).
 *
 * Issue #68 (post-rebase review) : la duplication du format `confirm:patient:{pi}`
 * / `confirm:therapist:{pi}` portait un risque de dérive silencieuse — Resend
 * déduplique sur la VALEUR de la clé (pas un hash du body), donc une clé unique
 * partagée par deux emails distincts aurait silencieusement fait tomber l'email
 * thérapeute comme « replay » du patient. Inversement, deux clés divergentes
 * entre webhook et sweep auraient rouvert la fenêtre de doublon.
 *
 * Le scoping par destinataire (`patient:` vs `therapist:`) est intentionnel et
 * fixe — chaque destinataire doit avoir sa propre clé pour que Resend déduplique
 * correctement les envois concurrents in-flight sans collision inter-destinataires.
 */

/** Préfixe de clé d'idempotence pour l'email de confirmation patient. */
export const PATIENT_CONFIRMATION_PREFIX = 'confirm:patient:' as const;

/** Préfixe de clé d'idempotence pour l'email de notification thérapeute. */
export const THERAPIST_CONFIRMATION_PREFIX = 'confirm:therapist:' as const;

/**
 * Construit la clé d'idempotence Resend pour l'email de confirmation patient.
 * Retourne `undefined` si `paymentIntentId` est absent (pas de dédup Resend).
 */
export function patientConfirmationKey(
  paymentIntentId: string | null | undefined,
): string | undefined {
  return paymentIntentId
    ? `${PATIENT_CONFIRMATION_PREFIX}${paymentIntentId}`
    : undefined;
}

/**
 * Construit la clé d'idempotence Resend pour l'email de notification thérapeute.
 * Retourne `undefined` si `paymentIntentId` est absent (pas de dédup Resend).
 */
export function therapistConfirmationKey(
  paymentIntentId: string | null | undefined,
): string | undefined {
  return paymentIntentId
    ? `${THERAPIST_CONFIRMATION_PREFIX}${paymentIntentId}`
    : undefined;
}
