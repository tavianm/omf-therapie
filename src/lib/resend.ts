/**
 * Email client — OMF Thérapie
 *
 * Deux chemins d'envoi :
 *  - SMTP (nodemailer + Mailpit) : activé si `SMTP_HOST` est défini → dev local
 *  - Resend SDK               : chemin production par défaut
 *
 * Variables d'environnement :
 *   SMTP_HOST        — hôte SMTP (ex : "localhost") ; active le chemin SMTP si présent
 *   SMTP_PORT        — port SMTP (défaut : 1025)
 *   RESEND_API_KEY   — clé API Resend (obligatoire en production)
 *   RESEND_FROM_EMAIL — adresse expéditeur (optionnel, fallback : contact@omf-therapie.fr)
 */

import { Resend } from 'resend';
import { render } from '@react-email/render';
// nodemailer 9 + @types/nodemailer 8 dropped the default export — use the
// named `createTransport` export instead of `import nodemailer from 'nodemailer'`.
import { createTransport as createSmtpTransport } from 'nodemailer';
import type { ReactElement } from 'react';
import { supabaseAdmin } from './supabase';
import { isRetryableResendError } from './resend-errors';

// ---------------------------------------------------------------------------
// Transport selection — resolved lazily so this module can be imported from
// runtimes where `import.meta.env` is undefined (Netlify Functions Node.js).
// The Astro runtime reads import.meta.env at module load; the cron runtime
// cannot, so transports must initialize on first use, not on import.
// (Issue #68 post-rebase review : retire la duplication Path B du sweep.)
// ---------------------------------------------------------------------------

let cachedSmtpTransport: ReturnType<typeof createSmtpTransport> | null | undefined;
let cachedResendClient: Resend | null | undefined;

function getSmtpTransport(): ReturnType<typeof createSmtpTransport> | null {
  if (cachedSmtpTransport !== undefined) return cachedSmtpTransport;
  const smtpHost = import.meta.env.SMTP_HOST as string | undefined;
  const smtpPort = Number((import.meta.env.SMTP_PORT as string | undefined) ?? 1025);
  cachedSmtpTransport = smtpHost
    ? createSmtpTransport({ host: smtpHost, port: smtpPort, secure: false })
    : null;
  if (cachedSmtpTransport) {
    console.info(`[smtp] Transport SMTP initialisé → ${smtpHost}:${smtpPort}`);
  }
  return cachedSmtpTransport;
}

function getResendClient(): Resend | null {
  if (cachedResendClient !== undefined) return cachedResendClient;
  const resendApiKey = import.meta.env.RESEND_API_KEY as string | undefined;
  const smtp = getSmtpTransport();
  if (!smtp && !resendApiKey) {
    // Avertissement au démarrage — ne bloque pas le build mais log clairement
    console.warn('[resend] RESEND_API_KEY manquante. Les emails ne seront pas envoyés.');
  }
  // Resend client is only used when SMTP is absent (production path)
  cachedResendClient = resendApiKey ? new Resend(resendApiKey) : null;
  return cachedResendClient;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendEmailParams {
  /** Destinataire(s) */
  to: string | string[];
  /** Copie cachée (optionnelle) */
  bcc?: string | string[];
  /** Identifiant de fil (thread) pour enchaîner les emails d'une même conversation */
  threadKey?: string;
  /** Objet de l'email */
  subject: string;
  /** Composant React Email rendu côté serveur */
  react: ReactElement;
  /** Adresse de réponse optionnelle */
  replyTo?: string;
  /**
   * Clé d'idempotence Resend (~24h TTL) — déduplique les envois concurrents
   * in-flight côté serveur via l'en-tête `Idempotency-Key`. Deux tentatives
   * simultanées (ex : webhook + sweep de réconciliation) avec la même clé
   * ne produisent qu'un seul email. En chemin SMTP (dev/Mailpit), la clé est
   * répercutée dans un en-tête `Message-ID` déterministe (parité de contrat).
   */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export function buildAppointmentConversationSubject(subject: string, _appointmentId?: string): string {
  return subject;
}

interface ResendApiError {
  name?: string;
  statusCode?: number | null;
  message?: string;
}

interface EmailThreadState {
  thread_key: string;
  thread_subject: string;
  root_message_id: string;
  last_message_id: string;
  thread_references: string;
}

interface ThreadSendContext {
  thread: EmailThreadState | null;
  subject: string;
  headers?: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toResendMessageId(id: string): string {
  return `<${id}@resend.dev>`;
}

function normalizeMessageId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return trimmed;
  return /^<.+>$/.test(trimmed) ? trimmed : `<${trimmed}>`;
}

function appendReferences(existing: string, nextMessageId: string): string {
  const refs = existing
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean);
  if (!refs.includes(nextMessageId)) refs.push(nextMessageId);
  return refs.join(' ');
}

async function loadThreadState(threadKey: string): Promise<EmailThreadState | null> {
  const { data, error } = await supabaseAdmin
    .from('email_threads')
    .select('thread_key, thread_subject, root_message_id, last_message_id, thread_references')
    .eq('thread_key', threadKey)
    .maybeSingle();

  if (error) {
    console.error('[resend] Impossible de charger le thread email :', error);
    return null;
  }
  return (data as EmailThreadState | null) ?? null;
}

async function persistThreadState(
  threadKey: string,
  threadSubject: string,
  messageId: string,
  currentThread: EmailThreadState | null,
): Promise<void> {
  if (!currentThread) {
    const { error } = await supabaseAdmin
      .from('email_threads')
      .insert({
        thread_key: threadKey,
        thread_subject: threadSubject,
        root_message_id: messageId,
        last_message_id: messageId,
        thread_references: messageId,
      });
    if (error) {
      console.error('[resend] Impossible de créer le thread email :', error);
    }
    return;
  }

  const { error } = await supabaseAdmin
    .from('email_threads')
    .update({
      last_message_id: messageId,
      thread_references: appendReferences(currentThread.thread_references, messageId),
    })
    .eq('thread_key', threadKey);

  if (error) {
    console.error('[resend] Impossible de mettre à jour le thread email :', error);
  }
}

async function prepareThreadSendContext(
  threadKey: string | undefined,
  subject: string,
): Promise<ThreadSendContext> {
  const normalizedThreadKey = threadKey?.trim();
  if (!normalizedThreadKey) {
    return { thread: null, subject };
  }

  const thread = await loadThreadState(normalizedThreadKey);
  if (!thread) {
    return { thread: null, subject };
  }

  return {
    thread,
    subject,
    headers: {
      'In-Reply-To': thread.last_message_id,
      References: thread.thread_references,
    },
  };
}

// ---------------------------------------------------------------------------
// SMTP path (dev local — Mailpit)
// ---------------------------------------------------------------------------

async function sendEmailViaSMTP(
  params: SendEmailParams,
  fromEmail: string,
): Promise<SendEmailResult> {
  const { to, bcc, subject, react, replyTo, threadKey, idempotencyKey } = params;

  try {
    const html = await render(react);
    const normalizedThreadKey = threadKey?.trim();
    const threadContext = await prepareThreadSendContext(normalizedThreadKey, subject);

    const info = await getSmtpTransport()!.sendMail({
      from: fromEmail,
      to: Array.isArray(to) ? to.join(', ') : to,
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc } : {}),
      subject: threadContext.subject,
      html,
      ...(threadContext.headers ? { headers: threadContext.headers } : {}),
      ...(replyTo ? { replyTo } : {}),
      // Parité dev : répercute la clé d'idempotence dans un Message-ID déterministe
      // (Mailpit ne déduplique pas réellement, mais le contrat reste honnête).
      ...(idempotencyKey
        ? { messageId: `<${idempotencyKey}@omf-therapie.local>` }
        : {}),
    });

    if (normalizedThreadKey && info.messageId) {
      await persistThreadState(
        normalizedThreadKey,
        threadContext.thread?.thread_subject ?? subject,
        normalizeMessageId(info.messageId),
        threadContext.thread,
      );
    }

    console.info('[smtp] Email envoyé :', info.messageId);
    return { success: true, id: info.messageId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error(`[smtp] Exception lors de l'envoi de l'email :`, message);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Resend path (production)
// ---------------------------------------------------------------------------

async function sendEmailViaResend(
  params: SendEmailParams,
  fromEmail: string,
): Promise<SendEmailResult> {
  const resendClient = getResendClient();
  if (!resendClient) {
    console.error('[resend] Resend client non initialisé — RESEND_API_KEY manquante.');
    return { success: false, error: 'RESEND_API_KEY manquante' };
  }

  const { to, bcc, subject, react, replyTo, threadKey, idempotencyKey } = params;

  try {
    const html = await render(react);
    const normalizedThreadKey = threadKey?.trim();
    const threadContext = await prepareThreadSendContext(normalizedThreadKey, subject);

    const payload = {
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
      subject: threadContext.subject,
      html,
      ...(threadContext.headers ? { headers: threadContext.headers } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    const maxAttempts = 3;
    let lastError: ResendApiError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { data, error } = await resendClient.emails.send(
          payload,
          // Clé d'idempotence Resend (~24h TTL) — envoyée via l'en-tête
          // `Idempotency-Key` ; déduplique les envois concurrents in-flight.
          { ...(idempotencyKey ? { idempotencyKey } : {}) },
        );

        if (!error) {
          if (normalizedThreadKey && data?.id) {
            const messageId = toResendMessageId(data.id);
            const threadSubject = threadContext.thread?.thread_subject ?? subject;
            await persistThreadState(
              normalizedThreadKey,
              threadSubject,
              messageId,
              threadContext.thread,
            );
          }
          return { success: true, id: data?.id };
        }

        lastError = error as ResendApiError;
        if (!isRetryableResendError(lastError) || attempt === maxAttempts) {
          console.error('[resend] Erreur API Resend :', lastError);
          return { success: false, error: lastError.message ?? 'Erreur Resend inconnue' };
        }
      } catch (networkErr: unknown) {
        const message = networkErr instanceof Error ? networkErr.message : 'Erreur réseau inconnue';
        lastError = { name: 'network_error', message };
        if (attempt === maxAttempts) {
          console.error('[resend] Exception réseau non récupérable :', message);
          return { success: false, error: message };
        }
        console.warn(`[resend] Exception réseau (tentative ${attempt}/${maxAttempts}), retry...`);
      }

      console.warn(`[resend] Erreur transitoire (tentative ${attempt}/${maxAttempts}), retry...`);
      await sleep(attempt * 300);
    }
    return { success: false, error: lastError?.message ?? 'Erreur Resend inconnue' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error(`[resend] Exception lors de l'envoi de l'email :`, message);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public helper — dispatches to the appropriate transport
// ---------------------------------------------------------------------------

/**
 * Envoie un email transactionnel.
 *
 * En dev local (SMTP_HOST défini) : via nodemailer → Mailpit
 * En production                   : via Resend SDK
 *
 * @example
 * const result = await sendEmail({
 *   to: 'patient@example.com',
 *   subject: 'Confirmation de rendez-vous',
 *   react: <ConfirmationEmail {...props} />,
 * });
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const fromEmail =
    (import.meta.env.RESEND_FROM_EMAIL as string | undefined) ??
    'OMF Thérapie <contact@omf-therapie.fr>';
  const adminEmail = (import.meta.env.ADMIN_EMAIL as string | undefined)?.trim().toLowerCase();
  const toList = (Array.isArray(params.to) ? params.to : [params.to])
    .map(email => email.trim().toLowerCase());
  const explicitBccList = (params.bcc ? (Array.isArray(params.bcc) ? params.bcc : [params.bcc]) : [])
    .map(email => email.trim());
  const adminAlreadyTargeted =
    !!adminEmail &&
    (toList.includes(adminEmail) || explicitBccList.some(email => email.toLowerCase() === adminEmail));

  const resolvedParams: SendEmailParams =
    adminEmail && !adminAlreadyTargeted
      ? { ...params, bcc: [...explicitBccList, adminEmail] }
      : params;

  if (getSmtpTransport()) {
    return sendEmailViaSMTP(resolvedParams, fromEmail);
  }

  return sendEmailViaResend(resolvedParams, fromEmail);
}
