import { describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  existing: [] as Array<{ id: string }>,
  insertError: null as { code: string; message: string } | null,
}));

vi.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    limit: async () => ({ data: mockState.existing, error: null }),
    insert: () => query,
    single: async () => ({
      data: null,
      error: mockState.insertError,
    }),
  };

  return {
    supabaseAdmin: {
      from: () => query,
    },
  };
});

import { createManualSlot, ManualSlotDuplicateError } from '@/lib/manual-slots';

describe('manual time slots', () => {
  it('maps the database active-slot unique constraint to a domain duplicate error', async () => {
    mockState.existing = [];
    mockState.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };

    await expect(
      createManualSlot({ slot_date: '2026-10-01', period: 'morning' }),
    ).rejects.toBeInstanceOf(ManualSlotDuplicateError);
  });
});
