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
 * Hygiène d'état (revue PR #131) : capture À L'ÉCHEC, plus à l'entrée de
 * l'appel. `notifications.ts` envoie patient + thérapeute en CONCURRENT
 * (`Promise.allSettled`) — assigner `lastTo`/`lastError` avant la délégation
 * laissait un SUCCÈS concurrent masquer un ÉCHEC antérieur : quand ADMIN_EMAIL
 * est défini, l'échec patient 4xx n'échappait jamais au retry loop. Désormais
 * un envoi ne touche l'état QUE s'il résout avec `rawError` — un succès
 * concurrent ne peut plus masquer un échec, et `lastTo` désigne le
 * destinataire QUI A ÉCHOUÉ (pas le dernier appel).
 *
 * Résidus assumés (best-effort — on préfère re-réessayer que faux-poisoner) :
 *  - deux échecs concurrents se course : le dernier complété gagne ;
 *  - les échecs du chemin SMTP ne portent pas de `rawError` (contrat #129) →
 *    non capturés → la row reste NULL et sera ré-essayée au passage suivant.
 *
 * Le résultat de `sendEmail` est retourné tel quel (jamais reconstruit).
 */

import {
  sendEmail,
  type SendEmailParams,
  type SendEmailResult,
} from '../../../src/lib/resend';
import type { ResendApiError } from '../../../src/lib/resend-errors';

/** État de capture lu par le sweep après chaque envoi (classification poison). */
export interface SendFnCaptureState {
  /** Dernière erreur Resend brute capturée (`result.rawError` d'un envoi échoué). */
  lastError: ResendApiError | null;
  /** Destinataires du dernier envoi ÉCHOUÉ, verbatim — heuristique patient vs thérapeute. */
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
    const toList = Array.isArray(params.to) ? params.to : [params.to];
    const result = await sendEmail(params, {
      maxAttempts: opts?.maxAttempts ?? 1,
    });
    // Capture UNIQUEMENT à l'échec (sémantique #131 — voir JSDoc fichier) :
    // un succès concurrent ne doit jamais masquer un échec antérieur.
    if (result.rawError) {
      state.lastTo = toList;
      state.lastError = result.rawError;
    }
    return result;
  };
  return { sendFn, state };
}
