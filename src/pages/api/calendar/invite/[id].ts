export const prerender = false;

import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { generateICS, CABINET_ADDRESS } from '@/lib/ics';
import { getModeLabel, getTypeLabel } from '@/lib/pricing';
import { verifySecureLinkToken } from '@/lib/secure-links';
import type { Appointment } from '@/types/appointment';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id || !UUID_RE.test(id)) {
    return new Response('Invitation invalide.', { status: 400 });
  }
  const token = new URL(request.url).searchParams.get('token');
  if (!token) {
    return new Response("Lien d'invitation invalide.", { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return new Response('Rendez-vous introuvable.', { status: 404 });
  }

  const appt = data as Appointment;
  const isTokenValid = verifySecureLinkToken({
    token,
    appointmentId: appt.id,
    purpose: 'ics-invite',
    nonce: appt.scheduled_at,
  });
  if (!isTokenValid) {
    return new Response("Lien d'invitation invalide.", { status: 403 });
  }

  const start = new Date(appt.scheduled_at);
  const end = new Date(start.getTime() + appt.duration * 60 * 1000);
  const location = appt.appointment_mode === 'in-person'
    ? CABINET_ADDRESS
    : (appt.video_link ?? undefined);

  const ics = generateICS({
    uid: appt.id,
    summary: `Séance OMF Thérapie — ${getTypeLabel(appt.appointment_type)}`,
    description: [
      `Mode: ${getModeLabel(appt.appointment_mode)}`,
      `Durée: ${appt.duration} min`,
    ].join('\n'),
    location,
    url: appt.video_link ?? undefined,
    start,
    end,
    organizerName: 'Oriane Montabonnet — OMF Thérapie',
    organizerEmail: import.meta.env.RESEND_FROM_EMAIL ?? 'contact@omf-therapie.fr',
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="omf-rdv-${appt.id}.ics"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
};
