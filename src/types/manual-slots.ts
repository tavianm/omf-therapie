export type Period = 'morning' | 'afternoon' | 'all_day';

export interface ManualTimeSlot {
  id: string;
  slot_date: string; // YYYY-MM-DD
  period: Period;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateManualSlotData {
  slot_date: string;
  period: Period;
}

export interface UpdateManualSlotData {
  period?: Period;
  deleted_at?: string | null;
}
