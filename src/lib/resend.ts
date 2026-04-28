/**
 * Resend email client — OMF Thérapie
 *
 * Packages requis (à ajouter aux dépendances) :
 *   "resend": "^4.x"
 *
 * Variables d'environnement requises :
 *   RESEND_API_KEY   — clé API Resend (obligatoire)
 *   RESEND_FROM_EMAIL — adresse expéditeur (optionnel, fallback : contact@omf-therapie.fr)
 */

import { Resend } from 'resend';
import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

const resendApiKey = import.meta.env.RESEND_API_KEY as string | undefined;

if (!resendApiKey) {
  // Avertissement au démarrage — ne bloque pas le build mais log clairement
  console.warn('[resend] RESEND_API_KEY manquante. Les emails ne seront pas envoyés.');
}

const resendClient = new Resend(resendApiKey ?? '');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendEmailParams {
  /** Destinataire(s) */
  to: string | string[];
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

// ---------------------------------------------------------------------------
// Helper principal
// ---------------------------------------------------------------------------

/**
 * Envoie un email transactionnel via Resend.
 *
 * @example
 * const result = await sendEmail({
 *   to: 'patient@example.com',
 *   subject: 'Confirmation de rendez-vous',
 *   react: <ConfirmationEmail {...props} />,
 * });
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { to, subject, react, replyTo } = params;

  const fromEmail =
    (import.meta.env.RESEND_FROM_EMAIL as string | undefined) ??
    'OMF Thérapie <contact@omf-therapie.fr>';

  try {
    const { data, error } = await resendClient.emails.send({
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      react,
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      console.error('[resend] Erreur API Resend :', error);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      id: data?.id,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[resend] Exception lors de l'envoi de l'email :', message);
    return {
      success: false,
      error: message,
    };
  }
}
