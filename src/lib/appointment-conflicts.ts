import { supabaseAdmin } from './supabase';

const BLOCKING_STATUSES = [
  'pending',
  'confirmed',
  'payment_pending',
  'payment_received',
  'rescheduled',
] as const;

const MAX_APPOINTMENT_DURATION_MINUTES = 90;

interface ConflictCheckInput {
  slotStartIso: string;
  slotEndIso: string;
  excludeAppointmentId?: string;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

export async function hasAppointmentConflict({
  slotStartIso,
  slotEndIso,
  excludeAppointmentId,
}: ConflictCheckInput): Promise<boolean> {
  const baseConflictQuery = supabaseAdmin
    .from('appointments')
    .select('id')
    .in('status', BLOCKING_STATUSES)
    .is('deleted_at', null)
    .lt('scheduled_at', slotEndIso)
    .gt('scheduled_end', slotStartIso)
    .limit(1);

  const { data: directConflicts, error: directError } = excludeAppointmentId
    ? await baseConflictQuery.neq('id', excludeAppointmentId)
    : await baseConflictQuery;

  if (directError) {
    throw directError;
  }

  if ((directConflicts ?? []).length > 0) {
    return true;
  }

  const slotStart = new Date(slotStartIso).getTime();
  const slotEnd = new Date(slotEndIso).getTime();
  const rescheduledLookback = new Date(
    slotStart - MAX_APPOINTMENT_DURATION_MINUTES * 60 * 1000,
  ).toISOString();

  const baseRescheduledQuery = supabaseAdmin
    .from('appointments')
    .select('id, duration, rescheduled_to')
    .eq('status', 'rescheduled')
    .is('deleted_at', null)
    .not('rescheduled_to', 'is', null)
    .gte('rescheduled_to', rescheduledLookback)
    .lt('rescheduled_to', slotEndIso);

  const { data: rescheduledRows, error: rescheduledError } = excludeAppointmentId
    ? await baseRescheduledQuery.neq('id', excludeAppointmentId)
    : await baseRescheduledQuery;

  if (rescheduledError) {
    throw rescheduledError;
  }

  return (rescheduledRows ?? []).some((row) => {
    if (typeof row.rescheduled_to !== 'string') return false;
    const start = new Date(row.rescheduled_to).getTime();
    const end = start + Number(row.duration) * 60 * 1000;
    return overlaps(slotStart, slotEnd, start, end);
  });
}
