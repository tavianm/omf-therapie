/**
 * Classification des erreurs Resend — primitive partagée.
 *
 * Module env-agnostic : aucune lecture d'environnement (ni `import.meta.env`
 * Astro, ni `process.env` Netlify). Cela permet au webhook (`src/lib/resend.ts`)
 * et au sweep (`netlify/functions/reconcile-confirmations.ts`) de partager une
 * seule définition de « erreur retryable vs permanente ».
 *
 * Issue #68 (post-rebase review) : la duplication précédente (prédicat miroir
 * dans le sweep) portait un risque de dérive — un statut ajouté d'un côté sans
 * l'autre aurait silencieusement fait dévier les politiques de retry/poison.
 */

export interface ResendApiError {
  name?: string;
  statusCode?: number | null;
  message?: string;
}

/**
 * Classifie une erreur Resend comme retryable (5xx, réseau, application_error,
 * 429 rate-limit) vs permanente (4xx validation — poison message).
 *
 * 429 est retryable malgré être un 4xx : la limite de taux est transitoire.
 */
export function isRetryableResendError(
  error: ResendApiError | null | undefined,
): boolean {
  if (!error) return false;
  const status = error.statusCode ?? null;
  if (status === null || status >= 500) return true;
  // 429 (rate limit) est retryable malgré être un 4xx — la limite est transitoire.
  if (status === 429) return true;
  return error.name === 'application_error';
}
