import { supabaseAdmin } from './supabase';
import {
  isSchedulingBufferMinutes,
  type SchedulingBufferMinutes,
  type SchedulingSettings,
} from '../types/scheduling-settings';

interface SchedulingSettingsRow {
  buffer_minutes: number;
  updated_at: string;
}

function toSchedulingSettings(row: SchedulingSettingsRow): SchedulingSettings {
  if (!isSchedulingBufferMinutes(row.buffer_minutes)) {
    throw new Error('La marge de planification enregistrée est invalide.');
  }
  return { bufferMinutes: row.buffer_minutes, updatedAt: row.updated_at };
}

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  const { data, error } = await supabaseAdmin
    .from('scheduling_settings')
    .select('buffer_minutes, updated_at')
    .eq('singleton', true)
    .single();

  if (error || !data)
    throw error ?? new Error('Réglage de planification introuvable.');
  return toSchedulingSettings(data as SchedulingSettingsRow);
}

export async function updateSchedulingBuffer(
  bufferMinutes: SchedulingBufferMinutes,
): Promise<SchedulingSettings> {
  const { data, error } = await supabaseAdmin.rpc('set_scheduling_buffer', {
    new_buffer_minutes: bufferMinutes,
  });

  if (error || !data?.[0]) {
    throw (
      error ?? new Error('La marge de planification n’a pas été enregistrée.')
    );
  }
  return toSchedulingSettings(data[0] as SchedulingSettingsRow);
}

export function isSchedulingConflictError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'P0001' ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('scheduling_'))
  );
}
