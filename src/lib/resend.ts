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
import nodemailer from 'nodemailer';
import type { ReactElement } from 'react';
import { supabaseAdmin } from './supabase';

// ---------------------------------------------------------------------------
// Transport selection — resolved once at module init
// ---------------------------------------------------------------------------

const smtpHost = import.meta.env.SMTP_HOST as string | undefined;
const smtpPort = Number((import.meta.env.SMTP_PORT as string | undefined) ?? 1025);

/** Nodemailer transport — non-null only when SMTP_HOST is set */
const smtpTransport = smtpHost
  ? nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: false })
  : null;

if (smtpTransport) {
  console.info(`[smtp] Transport SMTP initialisé → ${smtpHost}:${smtpPort}`);
}

// ---------------------------------------------------------------------------
// Resend client singleton (always constructed, only used when SMTP is absent)
// ---------------------------------------------------------------------------

const resendApiKey = import.meta.env.RESEND_API_KEY as string | undefined;

if (!smtpTransport && !resendApiKey) {
  // Avertissement au démarrage — ne bloque pas le build mais log clairement
  console.warn('[resend] RESEND_API_KEY manquante. Les emails ne seront pas envoyés.');
}

// Resend client is only used when SMTP is absent (production path)
const resendClient = resendApiKey ? new Resend(resendApiKey) : null;

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
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export function buildAppointmentConversationSubject(subject: string, appointmentId: string): string {
  const normalized = appointmentId.trim();
  const shortId = normalized.split('-')[0]?.toUpperCase() ?? normalized.toUpperCase();
  const prefix = `[RDV ${shortId}]`;
  return subject.startsWith(prefix) ? subject : `${prefix} ${subject}`;
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
  references: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableResendError(error: ResendApiError | null | undefined): boolean {
  if (!error) return false;
  const status = error.statusCode ?? null;
  if (status === null || status >= 500) return true;
  return error.name === 'application_error';
}

function toResendMessageId(id: string): string {
  return `<${id}@resend.dev>`;
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
    .select('thread_key, thread_subject, root_message_id, last_message_id, references')
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
        references: messageId,
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
      references: appendReferences(currentThread.references, messageId),
    })
    .eq('thread_key', threadKey);

  if (error) {
    console.error('[resend] Impossible de mettre à jour le thread email :', error);
  }
}

// ---------------------------------------------------------------------------
// SMTP path (dev local — Mailpit)
// ---------------------------------------------------------------------------

async function sendEmailViaSMTP(
  params: SendEmailParams,
  fromEmail: string,
): Promise<SendEmailResult> {
  const { to, bcc, subject, react, replyTo } = params;

  try {
    const html = await render(react);

    const info = await smtpTransport!.sendMail({
      from: fromEmail,
      to: Array.isArray(to) ? to.join(', ') : to,
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc } : {}),
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });

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
  if (!resendClient) {
    console.error('[resend] Resend client non initialisé — RESEND_API_KEY manquante.');
    return { success: false, error: 'RESEND_API_KEY manquante' };
  }

  const { to, bcc, subject, react, replyTo, threadKey } = params;

  try {
    const html = await render(react);
    const normalizedThreadKey = threadKey?.trim();
    const currentThread = normalizedThreadKey
      ? await loadThreadState(normalizedThreadKey)
      : null;
    const headers: Record<string, string> = {};

    let normalizedSubject = subject;
    if (currentThread) {
      headers['In-Reply-To'] = currentThread.last_message_id;
      headers['References'] = currentThread.references;
      normalizedSubject = /^Re:/i.test(currentThread.thread_subject)
        ? currentThread.thread_subject
        : `Re: ${currentThread.thread_subject}`;
    }

    const payload = {
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
      subject: normalizedSubject,
      html,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    const maxAttempts = 3;
    let lastError: ResendApiError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { data, error } = await resendClient.emails.send(payload);

      if (!error) {
        if (normalizedThreadKey && data?.id) {
          const messageId = toResendMessageId(data.id);
          const threadSubject = currentThread?.thread_subject ?? subject;
          await persistThreadState(
            normalizedThreadKey,
            threadSubject,
            messageId,
            currentThread,
          );
        }
        return { success: true, id: data?.id };
      }

      lastError = error as ResendApiError;
      if (!isRetryableResendError(lastError) || attempt === maxAttempts) {
        console.error('[resend] Erreur API Resend :', lastError);
        return { success: false, error: lastError.message ?? 'Erreur Resend inconnue' };
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

  if (smtpTransport) {
    return sendEmailViaSMTP(resolvedParams, fromEmail);
  }

  return sendEmailViaResend(resolvedParams, fromEmail);
}
