/**
 * Adaptateur d'envoi partagé des sweeps de réconciliation (#129, slice 2).
 *
 * Pourquoi un adaptateur aussi mince : les sweeps tournent dans le runtime cron
 * Netlify (Node pur, sans `import.meta.env`). Depuis le refactoring seam de
 * `src/lib/resend.ts` (lectures env gardées + lazy-init des transports),
 * déléguer à `sendEmail` y est sûr — plus aucun client Resend local à
 * instancier depuis `process.env`, aucune réplique du contrat transport.
 *
 * Ce que le sweep hérite ainsi de `sendEmail` (invariants de transport — ne
 * surtout pas les répliquer ici) :
 *  - BCC auto `ADMIN_EMAIL`, dédoublonné si l'admin est déjà destinataire ;
 *  - clé d'idempotence Resend (~24h TTL) via l'en-tête `Idempotency-Key` ;
 *  - en-têtes de fil (`In-Reply-To`/`References`) + persistance `email_threads` ;
 *  - `rawError` sur échec — source de la classification poison/retryable.
 *
 * `maxAttempts` défaut 1 : la cadence des sweeps est horaire, un retry
 * intra-row ne ferait que consommer le budget `DEADLINE_MS` (8,5 s) — c'est le
 * passage suivant qui ré-essaie la row (la clé L1 dédup côté Resend absorbe
 * les doublons dans la fenêtre de 24h).
 *
 * Hygiène d'état (revue architect C5) : `lastTo` est assigné et `lastError`
 * reset AVANT la délégation — l'heuristique poison du sweep lit ces champs
 * après un échec. Le résultat de `sendEmail` est retourné tel quel.
 */

import {
  sendEmail,
  type SendEmailParams,
  type SendEmailResult,
} from '../../../src/lib/resend';
import type { ResendApiError } from '../../../src/lib/resend-errors';

/** État de capture lu par le sweep après chaque envoi (classification poison). */
export interface SendFnCaptureState {
  /** Dernière erreur Resend brute (`result.rawError`), null en succès. */
  lastError: ResendApiError | null;
  /** Destinataires du dernier envoi, verbatim — heuristique patient vs thérapeute. */
  lastTo: string[];
}

/** Options de l'adaptateur. */
export interface SendFnCaptureOpts {
  /** Budget de retry délégué à `sendEmail` (défaut : 1 — voir JSDoc fichier). */
  maxAttempts?: number;
}

/**
 * Crée un `sendFn` déléguant à `sendEmail` + l'état de capture de la dernière
 * erreur brute (poison-escape pattern #98, alimenté par le seam `rawError` #129).
 */
export function makeSendFnWithCapture(opts?: SendFnCaptureOpts): {
  sendFn: (params: SendEmailParams) => Promise<SendEmailResult>;
  state: SendFnCaptureState;
} {
  const state: SendFnCaptureState = { lastError: null, lastTo: [] };
  const sendFn = async (params: SendEmailParams): Promise<SendEmailResult> => {
    state.lastTo = Array.isArray(params.to) ? params.to : [params.to];
    state.lastError = null;
    const result = await sendEmail(params, {
      maxAttempts: opts?.maxAttempts ?? 1,
    });
    state.lastError = result.rawError ?? null;
    return result;
  };
  return { sendFn, state };
}
