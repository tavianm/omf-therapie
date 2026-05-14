/**
 * POST /api/send-review-email
 *
 * Route admin protégée — envoie un email de demande d'avis Google / Pages Jaunes
 * au patient d'un rendez-vous terminé.
 *
 * Auth : BetterAuth session requise (cookie de session thérapeute).
 *
 * Body JSON :
 *   { appointmentId: string, therapistNote?: string }
 *
 * Réponse :
 *   200  { success: true, emailId?: string }
 *   400  { error: string }
 *   401  { error: 'Non autorisé' }
 *   404  { error: 'Rendez-vous introuvable' }
 *   500  { error: string }
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createElement } from 'react';
import { auth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabase';
import { sendEmail, buildAppointmentConversationSubject } from '../../lib/resend';
import ReviewRequest from '../../emails/ReviewRequest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonSuccess(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request }) => {
  // 1. Auth guard
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return jsonError(401, 'Non autorisé');
  }

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError(400, 'Corps de requête JSON invalide');
  }

  const { appointmentId, therapistNote } = body;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!appointmentId || typeof appointmentId !== 'string' || !UUID_RE.test(appointmentId.trim())) {
    return jsonError(400, 'Paramètre manquant ou invalide : appointmentId doit être un UUID valide');
  }

  if (therapistNote !== undefined && typeof therapistNote !== 'string') {
    return jsonError(400, 'Paramètre invalide : therapistNote doit être une chaîne de caractères');
  }

  // 3. Récupérer le rendez-vous
  const { data: appt, error: fetchError } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_name, patient_email')
    .eq('id', appointmentId.trim())
    .single();

  if (fetchError || !appt) {
    return jsonError(404, 'Rendez-vous introuvable');
  }

  const patientName = appt.patient_name as string;
  const patientEmail = appt.patient_email as string;

  // 4. URLs de plateformes d'avis (optionnelles)
  const googleBusinessUrl = (import.meta.env.GOOGLE_BUSINESS_URL as string | undefined) || undefined;
  const pagesJaunesUrl = (import.meta.env.PAGES_JAUNES_URL as string | undefined) || undefined;
  const psychologueNetUrl = (import.meta.env.PSYCHOLOGUE_NET_URL as string | undefined) || undefined;

  // 5. Envoyer l'email ReviewRequest
  const result = await sendEmail({
    to: patientEmail,
    threadKey: `appointment:${appointmentId.trim()}:patient`,
    subject: buildAppointmentConversationSubject(
      'Votre avis nous tient à cœur — OMF Thérapie',
      appointmentId.trim(),
    ),
    react: createElement(ReviewRequest, {
      patientName,
      therapistNote: typeof therapistNote === 'string' ? therapistNote : undefined,
      googleBusinessUrl,
      pagesJaunesUrl,
      psychologueNetUrl,
    }),
  });

  if (!result.success) {
    console.error('[send-review-email] Échec envoi email :', result.error);
    return jsonError(500, result.error ?? 'Erreur lors de l\'envoi de l\'email');
  }

  return jsonSuccess({ success: true, emailId: result.id });
};
