export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../../lib/auth';
import { isAdminSession } from '../../../../lib/authz';
import { supabaseAdmin } from '../../../../lib/supabase';
import { calculatePrice } from '../../../../lib/pricing';
import { getAvailableCredit, consumeCredits } from '../../../../lib/credits';
import { hasAppointmentConflict } from '../../../../lib/appointment-conflicts';
import type { AppointmentType } from '../../../../types/appointment';
import { invalidateAvailabilityCache } from '../../../../lib/calendar-cache.js';
import { isCabinetEligibleSlot } from '../../../../lib/appointment-eligibility';
import { processAppointmentSideEffects } from '../../../../lib/notifications';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(?:\+33|0033|0)[1-9](?:[0-9]{8})$/;

const VALID_TYPES = new Set<string>(['individual', 'couple', 'family']);
const VALID_MODES = new Set<string>(['in-person', 'video']);

function errorResponse(status: number, message: string, field?: string): Response {
  return new Response(JSON.stringify({ error: message, field }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// POST — création manuelle d'un rendez-vous par l'admin
// ---------------------------------------------------------------------------

// Issue #126 : les fonctions synchrones Netlify sont tuées à ~10s (504).
// Le chemin critique ne fait AUCUN appel réseau externe (Google/Stripe/Resend) :
// agenda, lien de paiement et email partent post-réponse via
// `locals.netlify.context.waitUntil` (adaptateur @astrojs/netlify), avec un
// repli inline best-effort (non attendu) hors runtime Netlify.
export const POST: APIRoute = async ({ request, locals }) => {
  // 1. Auth guard — admin seulement
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse(401, 'Non authentifié');
  }
  if (!isAdminSession(session)) {
    return errorResponse(403, 'Accès refusé');
  }

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Corps de requête JSON invalide');
  }

  const {
    patient_name,
    patient_email,
    patient_phone,
    appointment_type,
    appointment_mode,
    duration,
    scheduled_at,
    patient_reason,
    override_first_session,
    is_solidarity,
    send_email: rawSendEmail,
    video_link,
    override_price,
    use_credit,
  } = body;

  // send_email optionnel (défaut : envoi) — normalisé en booléen strict
  const shouldSendEmail = rawSendEmail === undefined ? true : rawSendEmail === true;

  // 3. Validation
  if (!patient_name || typeof patient_name !== 'string' || patient_name.trim().length < 2)
    return errorResponse(400, 'Nom requis (2 caractères minimum)', 'patient_name');

  if (!patient_email || typeof patient_email !== 'string' || !EMAIL_RE.test(patient_email))
    return errorResponse(400, 'Email invalide', 'patient_email');

  if (patient_phone && (typeof patient_phone !== 'string' || !PHONE_RE.test(patient_phone.replace(/\s/g, ''))))
    return errorResponse(400, 'Numéro de téléphone invalide', 'patient_phone');

  if (!appointment_type || !VALID_TYPES.has(appointment_type as string))
    return errorResponse(400, 'Type de séance invalide', 'appointment_type');

  if (!appointment_mode || !VALID_MODES.has(appointment_mode as string))
    return errorResponse(400, 'Mode de séance invalide', 'appointment_mode');

  if (!duration || !Number.isInteger(Number(duration)) || Number(duration) < 15 || Number(duration) > 240)
    return errorResponse(400, 'Durée invalide (entre 15 et 240 minutes)', 'duration');

  const GRID_DURATIONS = new Set([60, 90]);
  if (!GRID_DURATIONS.has(Number(duration)) && override_price === undefined)
    return errorResponse(400, 'Durée personnalisée : le tarif manuel est obligatoire', 'override_price');

  if (!scheduled_at || typeof scheduled_at !== 'string' || isNaN(Date.parse(scheduled_at)))
    return errorResponse(400, 'Date de séance invalide', 'scheduled_at');

  if (appointment_mode === 'video' && video_link) {
    if (typeof video_link !== 'string') return errorResponse(400, 'Lien vidéo invalide', 'video_link');
    try {
      const parsed = new URL(video_link as string);
      if (parsed.protocol !== 'https:')
        return errorResponse(400, 'Lien vidéo invalide (HTTPS requis)', 'video_link');
    } catch {
      return errorResponse(400, 'Lien vidéo invalide', 'video_link');
    }
  }

  if (override_price !== undefined && (
    !Number.isInteger(Number(override_price)) ||
    Number(override_price) < 0 ||
    Number(override_price) > 500
  ))
    return errorResponse(400, 'Tarif manuel invalide (entre 0 et 500€)', 'override_price');

  const scheduledDate = new Date(scheduled_at);
  if (scheduledDate.getTime() < Date.now())
    return errorResponse(400, 'La date de séance doit être dans le futur', 'scheduled_at');

  if (appointment_mode === 'in-person' && !(await isCabinetEligibleSlot(scheduled_at)))
    return errorResponse(400, 'Les rendez-vous en présentiel ne sont pas disponibles sur ce créneau.', 'scheduled_at');

  try {
    const slotEnd = new Date(scheduledDate.getTime() + Number(duration) * 60 * 1000);
    const hasConflict = await hasAppointmentConflict({
      slotStartIso: scheduledDate.toISOString(),
      slotEndIso: slotEnd.toISOString(),
    });
    if (hasConflict) {
      return errorResponse(409, 'Ce créneau n\'est plus disponible. Veuillez sélectionner un autre horaire.', 'scheduled_at');
    }
  } catch (conflictError) {
    console.error('[admin/appointments] Erreur vérification doublon:', conflictError);
    return errorResponse(500, 'Erreur lors de la vérification du créneau');
  }

  // 4. Calcul tarifaire
  const { data: existingAppointments } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('patient_email', (patient_email as string).toLowerCase())
    .in('status', ['confirmed', 'completed'])
    .limit(1);

  const autoDetectedFirstSession = !existingAppointments || existingAppointments.length === 0;
  const isFirstSession = typeof override_first_session === 'boolean'
    ? override_first_session
    : autoDetectedFirstSession;
  const pricing = calculatePrice(
    appointment_type as AppointmentType,
    Number(duration),
    isFirstSession,
    typeof is_solidarity === 'boolean' ? is_solidarity : false,
    override_price !== undefined ? Number(override_price) : undefined,
  );

  // 5. Avoir (avoir interne) — montant dû = final_price − crédit consommé
  const isVideo = appointment_mode === 'video';
  const finalPriceCents = pricing.finalPrice * 100;
  let creditApplied = 0;

  if (use_credit === true) {
    const balance = await getAvailableCredit((patient_email as string).toLowerCase());
    if (balance > 0) {
      creditApplied = Math.min(balance, finalPriceCents);
    }
  }
  const amountDueCents = Math.max(0, finalPriceCents - creditApplied);

  // 6. Statut initial
  const initialStatus: string = isVideo
    ? (amountDueCents === 0 ? 'payment_received' : 'payment_pending')
    : 'confirmed';

  // 7. Insertion en base
  const { data: appointment, error: dbError } = await supabaseAdmin
    .from('appointments')
    .insert({
      patient_name: (patient_name as string).trim(),
      patient_email: (patient_email as string).toLowerCase(),
      patient_phone: patient_phone ? (patient_phone as string).replace(/\s/g, '') : '',
      patient_postal_code: '',
      patient_city: '',
      appointment_type,
      appointment_mode,
      duration: Number(duration),
      scheduled_at: scheduledDate.toISOString(),
      patient_reason: patient_reason ?? '',
      is_first_session: isFirstSession,
      status: initialStatus,
      base_price: pricing.basePrice * 100,
      discount: pricing.discount * 100,
      final_price: finalPriceCents,
      credit_applied: creditApplied,
      video_link: isVideo ? (video_link ?? null) : null,
      // send_email:false → aucun email ne partira jamais : on pose le(s) flag(s)
      // L2 dès l'insert pour que les sweeps (#126/#98) ne tentent pas d'envoi de
      // rattrapage. Statut initial payment_received (avoir couvrant tout) :
      // l'invitation EST la confirmation — le pipeline aval ne repassera pas
      // (son set-once est gardé `.is('invitation_sent_at', null)`, déjà posé),
      // donc les DEUX drapeaux partent dans le payload INSERT (C6).
      ...(shouldSendEmail
        ? {}
        : initialStatus === 'payment_received'
          ? {
              invitation_sent_at: new Date().toISOString(),
              confirmation_sent_at: new Date().toISOString(),
            }
          : { invitation_sent_at: new Date().toISOString() }),
    })
    .select()
    .single();

  if (dbError || !appointment) {
    console.error('[admin/appointments] DB insert error:', dbError);
    return errorResponse(500, 'Erreur lors de la création du rendez-vous');
  }

  // 8. Consommer l'avoir (atomique, FIFO) — échec → rollback INSERT + 409.
  if (creditApplied > 0) {
    try {
      await consumeCredits(
        (patient_email as string).toLowerCase(),
        creditApplied,
        appointment.id,
      );
    } catch (creditErr) {
      console.error('[admin/appointments] Erreur consommation avoir:', creditErr);
      await supabaseAdmin.from('appointments').delete().eq('id', appointment.id);
      return errorResponse(409, 'Avoir insuffisant ou erreur lors de la consommation de l\'avoir.');
    }
  }

  await invalidateAvailabilityCache().catch(console.error);

  // 9. Side-effects post-réponse (issue #126) : agenda → Stripe → email +
  // drapeaux L2. Le pipeline ne jette jamais ; chaque étape est isolée et
  // observable (`[side-effects]` logs), le cron de rattrapage repasse sur les
  // flags NULL.
  // Le démarrage du pipeline est différé d'un macrotask : le préfixe de
  // `processAppointmentSideEffects` est synchrone (l'appel à createCalendarEvent
  // précède son premier await) et ne doit pas s'exécuter avant que la réponse
  // 201 soit construite et retournée. `setImmediate` (runtime Node/Netlify) est
  // FIFO avec les autres immediates ; fallback `setTimeout` ailleurs.
  const schedule = typeof setImmediate === 'function' ? setImmediate : setTimeout;
  // `status` est le statut INSÉRÉ (payment_received/… ) : il pilote le drapeau
  // confirmation_sent_at côté pipeline. Fallback défensif si la ligne retournée
  // ne portait pas la colonne.
  const apptForSideEffects = { ...appointment, status: appointment.status ?? initialStatus };
  const sideEffects: Promise<void> = new Promise((resolve) => {
    schedule(() => {
      void processAppointmentSideEffects(apptForSideEffects, {
        sendEmail: shouldSendEmail,
        amountDueCents,
        successUrl: import.meta.env.STRIPE_SUCCESS_URL
          ?? `${new URL(request.url).origin}/rdv/merci/?source=payment-success`,
        baseUrl: import.meta.env.BETTER_AUTH_URL ?? new URL(request.url).origin,
      }).then(resolve, resolve);
    });
  });

  // waitUntil : promesse capturée par le runtime Netlify, exécutée APRÈS la
  // réponse. `locals` n'est pas typé pour `netlify` — accès optionnel sûr.
  const netlifyLocals = (locals as { netlify?: { context?: { waitUntil?: unknown } } } | undefined)?.netlify;
  const waitUntil = netlifyLocals?.context?.waitUntil;
  if (typeof waitUntil === 'function') {
    (waitUntil as (p: Promise<unknown>) => void)(sideEffects);
  } else {
    // Repli inline best-effort (dev / hors Netlify) — NON attendu avant 201.
    void sideEffects;
  }

  // 10. 201 immédiat — ligne insérée telle quelle (pas de re-fetch : les champs
  // agenda/Stripe ne sont pas encore produits ; le client admin recharge la page).
  return new Response(JSON.stringify({ appointment }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
