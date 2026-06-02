export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../../../lib/auth';
import { isAdminSession } from '../../../../../lib/authz';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { createCalendarEvent, CalendarAuthError, CalendarPermissionError, CalendarQuotaError } from '../../../../../lib/google-calendar';

// ---------------------------------------------------------------------------
// POST — régénère l'événement Google Calendar et le lien Meet pour un RDV existant
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ params, request }) => {
  // 1. Auth guard — admin seulement
  const session = await auth.api.getSession({ headers: request.headers });
  if (!isAdminSession(session)) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Fetch appointment
  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'ID manquant' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_name, patient_email, appointment_mode, scheduled_at, duration, google_calendar_event_id, video_link')
    .eq('id', id)
    .single();

  if (error || !appointment) {
    return new Response(JSON.stringify({ error: 'Rendez-vous introuvable' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Guard: téléconsultation uniquement
  if (appointment.appointment_mode !== 'video') {
    return new Response(
      JSON.stringify({ error: 'Ce rendez-vous n\'est pas en téléconsultation' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    // 4. Call createCalendarEvent
    const start = new Date(appointment.scheduled_at);
    const end = new Date(start.getTime() + appointment.duration * 60 * 1000);

    const calResult = await createCalendarEvent({
      title: `🎥 ${appointment.patient_name} — séance téléconsultation (${appointment.duration} min)`,
      start: start.toISOString(),
      end: end.toISOString(),
      description: [
        `Patient: ${appointment.patient_name}`,
        `Email: ${appointment.patient_email}`,
        'Mode: Téléconsultation',
        `Durée: ${appointment.duration} min`,
      ].join('\n'),
      location: 'Téléconsultation',
      attendeeEmail: appointment.patient_email,
      withMeet: true,
      appointmentId: `${appointment.id}-regen-${Date.now()}`,
      colorId: '11',
    });

    // 5. Update DB
    const { error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        google_calendar_event_id: calResult.eventId,
        ...(calResult.meetLink ? { video_link: calResult.meetLink } : {}),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[regenerate-calendar] DB update failed:', updateError.message);
      return new Response(
        JSON.stringify({ error: 'Événement créé mais sauvegarde échouée' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 6. Return updated calendar info
    return new Response(
      JSON.stringify({
        google_calendar_event_id: calResult.eventId,
        video_link: calResult.meetLink ?? null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      return new Response(
        JSON.stringify({
          error: 'oauth_required',
          message: 'Reconnectez Google Calendar via le tableau de bord admin',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (err instanceof CalendarPermissionError) {
      return new Response(
        JSON.stringify({ error: 'permission_denied', message: 'Permissions insuffisantes sur Google Calendar' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (err instanceof CalendarQuotaError) {
      return new Response(
        JSON.stringify({ error: 'quota_exceeded', message: 'Quota Google Calendar dépassé, réessayez plus tard' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }

    console.error('[admin/appointments/regenerate-calendar] Erreur régénération événement:', err instanceof Error ? { name: err.name, message: err.message } : String(err));
    return new Response(
      JSON.stringify({ error: 'Erreur lors de la régénération de l\'événement agenda' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
