import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Mock supabase : chaînes select/insert/update couvrant les trois terminaisons
// réelles — .limit() (pré-check création), .single() (insert + update) et
// l'attente directe du builder (delete `.select('id')` → thenable).
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  existing: [] as Array<{ id: string }>,
  insertError: null as { code?: string; message: string } | null,
  updateError: null as { code?: string; message: string } | null,
  updateSingleData: null as unknown,
  updateRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    limit: async () => ({ data: mockState.existing, error: null }),
    insert: () => query,
    update: () => query,
    single: async () => ({
      data: mockState.updateSingleData,
      error: mockState.insertError ?? mockState.updateError,
    }),
    // deleteManualSlot awaits the builder itself (no .single()).
    then: (
      onFulfilled?: (v: { data: Array<Record<string, unknown>>; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: mockState.updateRows, error: mockState.updateError }).then(onFulfilled, onRejected),
  };

  return {
    supabaseAdmin: {
      from: () => query,
    },
  };
});

import {
  createManualSlot,
  updateManualSlot,
  deleteManualSlot,
  ManualSlotDuplicateError,
  ManualSlotNotFoundError,
} from '@/lib/manual-slots';

describe('manual time slots', () => {
  beforeEach(() => {
    mockState.existing = [];
    mockState.insertError = null;
    mockState.updateError = null;
    mockState.updateSingleData = null;
    mockState.updateRows = [];
  });

  it('maps the database active-slot unique constraint to a domain duplicate error', async () => {
    mockState.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };

    await expect(
      createManualSlot({ slot_date: '2026-10-01', period: 'morning' }),
    ).rejects.toBeInstanceOf(ManualSlotDuplicateError);
  });

  it('archives existing active duplicates before enforcing uniqueness', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/016_manual_time_slot_uniqueness.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('ROW_NUMBER() OVER');
    expect(migration).toContain('SET deleted_at = now()');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS manual_time_slots_active_date_period_unique',
    );
    // Revue #149 : le nettoyage et la pose de l'index partagent un verrou qui
    // bloque les writers concurrents, sinon une présence créée entre le CTE
    // et le CREATE UNIQUE INDEX fait échouer la migration sur son doublon.
    expect(migration).toContain(
      'LOCK TABLE public.manual_time_slots IN SHARE ROW EXCLUSIVE MODE;',
    );
  });

  // -- Contrats update (revue #149 : branches sans aucun test auparavant) --

  it('23505 sur un changement de période → ManualSlotDuplicateError', async () => {
    mockState.updateError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };

    await expect(
      updateManualSlot('slot-1', { period: 'afternoon' }),
    ).rejects.toBeInstanceOf(ManualSlotDuplicateError);
  });

  it('PGRST116 (.single() sans ligne) → ManualSlotNotFoundError', async () => {
    mockState.updateError = {
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    };

    await expect(
      updateManualSlot('slot-inconnu', { period: 'morning' }),
    ).rejects.toBeInstanceOf(ManualSlotNotFoundError);
  });

  it('erreur générique → Error non typée (pas de mapping 409/404)', async () => {
    mockState.updateError = { message: 'connection refused' };

    await expect(
      updateManualSlot('slot-1', { period: 'morning' }),
    ).rejects.toThrow(/Failed to update manual slot/);
  });

  it('mise à jour réussie → retourne la ligne mise à jour', async () => {
    const slot = { id: 'slot-1', slot_date: '2026-10-01', period: 'afternoon' };
    mockState.updateSingleData = slot;

    await expect(updateManualSlot('slot-1', { period: 'afternoon' })).resolves.toEqual(
      slot,
    );
  });

  // -- Contrats delete (revue #149) --

  it('soft-delete sans ligne matchée → ManualSlotNotFoundError', async () => {
    mockState.updateRows = [];

    await expect(deleteManualSlot('slot-inconnu')).rejects.toBeInstanceOf(
      ManualSlotNotFoundError,
    );
  });

  it('erreur Supabase → Error générique', async () => {
    mockState.updateError = { message: 'connection refused' };

    await expect(deleteManualSlot('slot-1')).rejects.toThrow(
      /Failed to delete manual slot/,
    );
  });

  it('soft-delete réussi → résout sans erreur', async () => {
    mockState.updateRows = [{ id: 'slot-1' }];

    await expect(deleteManualSlot('slot-1')).resolves.toBeUndefined();
  });
});
