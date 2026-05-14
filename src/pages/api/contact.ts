/**
 * POST /api/contact — Formulaire de contact
 *
 * Reçoit les données du formulaire de contact et envoie un email
 * à contact@omf-therapie.fr via Resend.
 *
 * Body JSON : { name, email, phone?, message }
 * Réponses  : 200 { success: true }
 *             422 { success: false, error: string }   — validation
 *             500 { success: false, error: string }   — erreur serveur
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { type ReactElement, type CSSProperties, createElement } from 'react';
import { sendEmail } from '../../lib/resend';
import { checkRateLimit, rateLimitResponse } from '../../lib/rate-limit';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ContactBody {
  name: string;
  email: string;
  phone?: string;
  message: string;
}

function validateBody(body: unknown): { data: ContactBody } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Corps de la requête invalide.' };
  }

  const { name, email, phone, message } = body as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    return { error: 'Le nom doit contenir entre 2 et 100 caractères.' };
  }

  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { error: 'Adresse email invalide.' };
  }

  if (typeof message !== 'string' || message.trim().length < 10 || message.trim().length > 2000) {
    return { error: 'Le message doit contenir entre 10 et 2 000 caractères.' };
  }

  return {
    data: {
      name:    name.trim(),
      email:   email.trim().toLowerCase(),
      phone:   typeof phone === 'string' ? phone.trim() : undefined,
      message: message.trim(),
    },
  };
}

// ---------------------------------------------------------------------------
// Template email inline (React natif, sans @react-email/components)
// ---------------------------------------------------------------------------

/**
 * Template HTML du message de contact.
 * Construit avec des éléments React natifs (html, body, table…) pour
 * ne pas dépendre de @react-email/components dans cette route.
 * Resend accepte n'importe quel ReactElement et le rend en HTML.
 */
function ContactEmailTemplate({
  name,
  email,
  phone,
  message,
}: ContactBody): ReactElement {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

  const labelStyle: CSSProperties = {
    fontWeight: 'bold',
    color: '#2d4a3e',
    fontSize: '13px',
    margin: '0 0 2px',
  };
  const valueStyle: CSSProperties = {
    color: '#4a5568',
    fontSize: '14px',
    margin: '0 0 16px',
  };
  const hrStyle: CSSProperties = {
    border: 'none',
    borderTop: '1px solid #e2e8e4',
    margin: '20px 0',
  };

  return createElement(
    'html',
    { lang: 'fr' },
    createElement('head', null,
      createElement('meta', { charSet: 'utf-8' }),
      createElement('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    ),
    createElement(
      'body',
      { style: { fontFamily: 'Arial, Helvetica, sans-serif', backgroundColor: '#f9f9f7', margin: 0, padding: '24px' } },
      createElement(
        'div',
        { style: { maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '8px', padding: '32px' } },
        // En-tête
        createElement('h2', { style: { fontSize: '18px', color: '#2d4a3e', margin: '0 0 8px' } },
          '📬 Nouveau message — OMF Thérapie',
        ),
        createElement('p', { style: { color: '#718096', fontSize: '13px', margin: '0 0 20px' } },
          'Un visiteur a soumis le formulaire de contact.',
        ),
        createElement('hr', { style: hrStyle }),
        // Champs
        createElement('p', { style: labelStyle }, 'Nom'),
        createElement('p', { style: valueStyle }, name),
        createElement('p', { style: labelStyle }, 'Email'),
        createElement('p', { style: valueStyle },
          createElement('a', { href: `mailto:${email}`, style: { color: '#3d9a6e' } }, email),
        ),
        ...(phone
          ? [
              createElement('p', { style: labelStyle }, 'Téléphone'),
              createElement('p', { style: valueStyle },
                createElement('a', { href: `tel:${phone}`, style: { color: '#3d9a6e' } }, phone),
              ),
            ]
          : []
        ),
        createElement('p', { style: labelStyle }, 'Message'),
        createElement('p', { style: { ...valueStyle, whiteSpace: 'pre-wrap', margin: 0 } }, message),
        // Pied de page
        createElement('hr', { style: { ...hrStyle, margin: '24px 0 16px' } }),
        createElement('p', { style: { fontSize: '11px', color: '#a0aec0', margin: 0 } },
          `Message reçu depuis omf-therapie.fr — ${now}`,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request }) => {
  // 0. Rate limiting — 3 requêtes par IP sur 10 minutes
  // x-nf-client-connection-ip est défini exclusivement par Netlify (non falsifiable).
  const clientIp =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    'unknown';
  const rl = checkRateLimit(clientIp, 'contact', { limit: 3, windowSeconds: 600 });
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  // 1. Parser le corps
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'JSON invalide.' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 2. Valider
  const validated = validateBody(rawBody);
  if ('error' in validated) {
    return new Response(
      JSON.stringify({ success: false, error: validated.error }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { name, email, phone, message } = validated.data;

  // 3. Envoyer l'email via Resend
  const recipientEmail =
    (import.meta.env.ADMIN_EMAIL as string | undefined) ?? 'contact@omf-therapie.fr';

  const result = await sendEmail({
    to:      recipientEmail,
    subject: `[Contact] Message de ${name}`,
    react:   createElement(ContactEmailTemplate, { name, email, phone, message }),
    replyTo: email,
  });

  if (!result.success) {
    console.error('[api/contact] Erreur envoi email :', result.error);
    return new Response(
      JSON.stringify({ success: false, error: 'Erreur lors de l\'envoi du message. Veuillez réessayer.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
