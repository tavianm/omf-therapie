import { supabaseAdmin } from './supabase';
import type {
  ManualTimeSlot,
  CreateManualSlotData,
  UpdateManualSlotData,
} from '@/types/manual-slots';

const PARIS_TIMEZONE = 'Europe/Paris';

export class NotFoundError extends Error {
  readonly status = 404;

  constructor(message = 'Créneau introuvable') {
    super(message);
    this.name = 'NotFoundError';
  }
}

function parisDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '';

  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

/**
 * Fetch manual time slots for a date range
 * @param from - Start date (inclusive)
 * @param to - End date (inclusive)
 * @returns Array of manual time slots
 */
export async function fetchManualSlots(
  from: Date,
  to: Date,
): Promise<ManualTimeSlot[]> {
  const { data, error } = await supabaseAdmin
    .from('manual_time_slots')
    .select('*')
    .gte('slot_date', parisDateKey(from))
    .lte('slot_date', parisDateKey(to))
    .is('deleted_at', null)
    .order('slot_date', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch manual slots: ${error.message}`);
  }

  return data || [];
}

/**
 * Create a new manual time slot
 * @param data - Slot data to create
 * @returns Created manual time slot
 */
export async function createManualSlot(
  data: CreateManualSlotData,
): Promise<ManualTimeSlot> {
  const { data: slot, error } = await supabaseAdmin
    .from('manual_time_slots')
    .insert({
      slot_date: data.slot_date,
      period: data.period,
    })
    .select()
    .single();

  if (error) {
    const createError = new Error(
      `Failed to create manual slot: ${error.message}`,
    ) as Error & {
      code?: string;
    };
    createError.code = error.code;
    throw createError;
  }

  return slot;
}

/**
 * Update an existing manual time slot
 * @param id - Slot ID to update
 * @param data - Updated slot data
 * @returns Updated manual time slot
 */
export async function updateManualSlot(
  id: string,
  data: UpdateManualSlotData,
): Promise<ManualTimeSlot> {
  const { data: slot, error } = await supabaseAdmin
    .from('manual_time_slots')
    .update({
      ...(data.period !== undefined && { period: data.period }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update manual slot: ${error.message}`);
  }

  if (!slot) {
    throw new NotFoundError();
  }

  return slot;
}

/**
 * Soft delete a manual time slot
 * @param id - Slot ID to delete
 */
export async function deleteManualSlot(id: string): Promise<ManualTimeSlot> {
  const { data: slot, error } = await supabaseAdmin
    .from('manual_time_slots')
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to delete manual slot: ${error.message}`);
  }

  if (!slot) {
    throw new NotFoundError();
  }

  return slot;
}

/**
 * Invalidate the availability cache after a manual-slot mutation.
 *
 * The real availability cache lives in Netlify Blobs (see `calendar-cache.ts`),
 * NOT in a Supabase `cache_keys` table. A CRUD on manual_time_slots changes
 * which days/periods are cabinet-eligible, so the cached `/api/availability`
 * responses (TTL 10 min) must be dropped to avoid serving stale slots.
 *
 * Failure is non-blocking: worst case the cache serves stale data until its
 * TTL expires. The slot mutation itself already succeeded.
 */
export async function invalidateSlotCache(): Promise<void> {
  try {
    const { invalidateAvailabilityCache } = await import('./calendar-cache.js');
    await invalidateAvailabilityCache();
  } catch (err) {
    console.error(
      '[invalidateSlotCache] Availability cache invalidation failed (non-blocking):',
      err instanceof Error ? err.message : err,
    );
  }
}
