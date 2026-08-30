import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from '@/lib/supabase';
import {
  createManualSlot,
  deleteManualSlot,
  fetchManualSlots,
  NotFoundError,
  updateManualSlot,
} from '@/lib/manual-slots';

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

function chainReturning(result: QueryResult) {
  const promise = Promise.resolve(result);
  const builder: Record<string, unknown> = {};
  const selfReturning = () => builder;

  builder.then = (resolve: (value: QueryResult) => unknown) =>
    promise.then(resolve);
  builder.select = vi.fn(selfReturning);
  builder.insert = vi.fn(selfReturning);
  builder.update = vi.fn(selfReturning);
  builder.eq = vi.fn(selfReturning);
  builder.gte = vi.fn(selfReturning);
  builder.lte = vi.fn(selfReturning);
  builder.is = vi.fn(selfReturning);
  builder.order = vi.fn(selfReturning);
  builder.single = vi.fn(() => promise);
  builder.maybeSingle = vi.fn(() => promise);

  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('manual slot mutations', () => {
  it('throws NotFoundError when updateManualSlot affects no row', async () => {
    const chain = chainReturning({ data: null, error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(
      updateManualSlot('missing', { period: 'morning' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(chain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ deleted_at: expect.anything() }),
    );
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('throws NotFoundError when deleteManualSlot affects no row', async () => {
    const chain = chainReturning({ data: null, error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(deleteManualSlot('missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('returns the soft-deleted row when deleteManualSlot succeeds', async () => {
    const deletedSlot = {
      id: 'slot-1',
      slot_date: '2026-09-01',
      period: 'morning',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-30T00:00:00.000Z',
      deleted_at: '2026-08-30T00:00:00.000Z',
    };
    const chain = chainReturning({ data: deletedSlot, error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(deleteManualSlot('slot-1')).resolves.toEqual(deletedSlot);
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('throws NotFoundError when a slot is deleted a second time', async () => {
    const deletedSlot = {
      id: 'slot-1',
      slot_date: '2026-09-01',
      period: 'morning',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-30T00:00:00.000Z',
      deleted_at: '2026-08-30T00:00:00.000Z',
    };
    const firstDelete = chainReturning({ data: deletedSlot, error: null });
    const secondDelete = chainReturning({ data: null, error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstDelete)
      .mockReturnValueOnce(secondDelete);

    await expect(deleteManualSlot('slot-1')).resolves.toEqual(deletedSlot);
    await expect(deleteManualSlot('slot-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(firstDelete.is).toHaveBeenCalledWith('deleted_at', null);
    expect(secondDelete.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('preserves Postgres code 23505 on create failure', async () => {
    const chain = chainReturning({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(
      createManualSlot({ slot_date: '2026-09-01', period: 'morning' }),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('fetchManualSlots', () => {
  it('queries the range with Paris calendar dates instead of UTC dates', async () => {
    const chain = chainReturning({ data: [], error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await fetchManualSlots(
      new Date('2026-07-01T22:30:00.000Z'),
      new Date('2026-07-02T22:30:00.000Z'),
    );

    expect(chain.gte).toHaveBeenCalledWith('slot_date', '2026-07-02');
    expect(chain.lte).toHaveBeenCalledWith('slot_date', '2026-07-03');
  });
});
