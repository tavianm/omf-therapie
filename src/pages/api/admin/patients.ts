export const prerender = false;

import type { APIRoute } from 'astro';
import { auth } from '../../../lib/auth';
import { isAdminSession } from '../../../lib/authz';
import { supabaseAdmin } from '../../../lib/supabase';
import type { AppointmentSummary, Patient } from '../../../types/patient';

type AppointmentRow = {
  id: string;
  patient_email: string;
  patient_name: string;
  patient_phone: string;
  appointment_type: AppointmentSummary['appointmentType'];
  appointment_mode: AppointmentSummary['appointmentMode'];
  status: AppointmentSummary['status'];
  final_price: number;
  duration: number;
  scheduled_at: string;
};

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse(401, 'Non authentifié');
  }
  if (!isAdminSession(session)) {
    return errorResponse(403, 'Accès refusé');
  }

  const includeArchived = url.searchParams.get('includeArchived') === 'true';
  const activeThreshold = new Date();
  activeThreshold.setMonth(activeThreshold.getMonth() - 3);
  const activeThresholdMs = activeThreshold.getTime();

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_email, patient_name, patient_phone, appointment_type, appointment_mode, status, final_price, duration, scheduled_at')
    .is('deleted_at', null);

  if (error) {
    console.error('[admin/patients] Erreur DB:', error);
    return errorResponse(500, 'Erreur lors de la récupération des patients');
  }

  const rows = (data ?? []) as AppointmentRow[];
  const groupedByEmail = new Map<string, AppointmentRow[]>();

  for (const row of rows) {
    const bucket = groupedByEmail.get(row.patient_email);
    if (bucket) {
      bucket.push(row);
    } else {
      groupedByEmail.set(row.patient_email, [row]);
    }
  }

  const patients: Patient[] = [];

  for (const [email, appointmentsRows] of groupedByEmail.entries()) {
    appointmentsRows.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
    const last = appointmentsRows[0];
    if (!last) continue;

    const appointments: AppointmentSummary[] = appointmentsRows.map((appointment) => ({
      id: appointment.id,
      scheduledAt: appointment.scheduled_at,
      appointmentType: appointment.appointment_type,
      appointmentMode: appointment.appointment_mode,
      status: appointment.status,
      finalPrice: appointment.final_price,
      duration: appointment.duration,
    }));

    const isActive = new Date(last.scheduled_at).getTime() >= activeThresholdMs;

    patients.push({
      email,
      name: last.patient_name,
      phone: last.patient_phone,
      sessionCount: appointmentsRows.length,
      lastAppointmentAt: last.scheduled_at,
      lastAppointmentType: last.appointment_type,
      lastAppointmentMode: last.appointment_mode,
      isActive,
      appointments,
    });
  }

  const filteredPatients = includeArchived
    ? patients
    : patients.filter((patient) => patient.isActive);

  filteredPatients.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

  return new Response(JSON.stringify({ patients: filteredPatients }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
