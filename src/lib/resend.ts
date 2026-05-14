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

interface ResendApiError {
  name?: string;
  statusCode?: number | null;
  message?: string;
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

  const { to, bcc, subject, react, replyTo } = params;

  try {
    const html = await render(react);
    const payload = {
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    };
    const maxAttempts = 3;
    let lastError: ResendApiError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { data, error } = await resendClient.emails.send(payload);

      if (!error) {
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
