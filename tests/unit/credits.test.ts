import { describe, expect, it, vi, beforeEach } from 'vitest';

// On mocke supabaseAdmin pour tester credits.ts en isolation (pas de DB).
// Chaque test configure le comportement du mock via mockResolvedValueOnce.
vi.mock('@/lib/supabase', () => {
  const mock = {
    from: vi.fn(),
    rpc: vi.fn(),
  };
  return { supabaseAdmin: mock };
});

import { supabaseAdmin } from '@/lib/supabase';
import {
  getAvailableCredit,
  getCreditBalance,
  issueCreditForCancellation,
  consumeCredits,
  restoreCredits,
} from '@/lib/credits';

/**
 * Construit un faux builder Supabase : un objet chainable (select/eq/gt/order/insert
 * retournent le builder) ET thenable (l'attendre résout `result`). Les méthodes
 * terminales single()/maybeSingle() retournent une promesse résolue sur `result`.
 */
function chainReturning(result: { data: unknown; error: unknown }) {
  // Builder thenable : `await chain` résout `result`.
  const builder: Record<string, unknown> = {};
  const promise = Promise.resolve(result);
  // Rendre le builder thenable pour `await from()` (cas sans terminal).
  builder.then = (resolve: (v: unknown) => unknown) => promise.then(resolve);

  const selfReturning = () => builder;
  builder.select = vi.fn(selfReturning);
  builder.eq = vi.fn(selfReturning);
  builder.gt = vi.fn(selfReturning);
  builder.order = vi.fn(selfReturning);
  builder.insert = vi.fn(selfReturning);
  builder.update = vi.fn(selfReturning);
  builder.single = vi.fn(() => promise);
  builder.maybeSingle = vi.fn(() => promise);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAvailableCredit', () => {
  it('somme les remaining > 0 du patient', async () => {
    const chain = chainReturning({ data: [{ remaining: 2000 }, { remaining: 1500 }], error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const balance = await getAvailableCredit('Alice@Example.com');
    expect(balance).toBe(3500);
    // Normalisation lowercase
    expect(chain.eq).toHaveBeenCalledWith('patient_email', 'alice@example.com');
  });

  it('retourne 0 en cas d\'erreur (dégradation)', async () => {
    const chain = chainReturning({ data: null, error: { message: 'boom' } });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    await expect(getAvailableCredit('a@b.com')).resolves.toBe(0);
  });

  it('retourne 0 si aucun avoir', async () => {
    const chain = chainReturning({ data: [], error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    await expect(getAvailableCredit('a@b.com')).resolves.toBe(0);
  });
});

describe('issueCreditForCancellation', () => {
  const appt = { id: 'rdv-1', patient_email: 'Bob@x.com', final_price: 6500, credit_applied: 0 };

  it('insère un avoir du montant cash et retourne la ligne', async () => {
    const inserted = { id: 'credit-1', amount: 6500, remaining: 6500 };
    const chain = chainReturning({ data: inserted, error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const credit = await issueCreditForCancellation(appt, 6500);
    expect(credit).toEqual(inserted);
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      patient_email: 'bob@x.com',
      source_appointment_id: 'rdv-1',
      amount: 6500,
      remaining: 6500,
      reason: 'cancellation',
    }));
  });

  it('retourne null si amountCash <= 0 (pas d\'avoir)', async () => {
    await expect(issueCreditForCancellation(appt, 0)).resolves.toBeNull();
    await expect(issueCreditForCancellation(appt, -100)).resolves.toBeNull();
  });

  it('est idempotente : unique_violation → retourne l\'avoir existant', async () => {
    // Premier insert → 23505 (existe déjà)
    const existing = { id: 'credit-existing', amount: 6500, remaining: 6500 };
    const insertChain = chainReturning({ data: null, error: { code: '23505', message: 'dup' } });
    // Recherche de l'existant via maybeSingle()
    const lookupChain = chainReturning({ data: existing, error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(insertChain) // insert
      .mockReturnValueOnce(lookupChain); // select existant

    const credit = await issueCreditForCancellation(appt, 6500);
    expect(credit).toEqual(existing);
  });

  it('propage les erreurs non-23505', async () => {
    const chain = chainReturning({ data: null, error: { code: '42P01', message: 'table absente' } });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    await expect(issueCreditForCancellation(appt, 6500)).rejects.toThrow(/table absente/);
  });
});

describe('consumeCredits', () => {
  it('appelle la RPC consume_credits et retourne les tranches', async () => {
    const usages = [{ credit_id: 'c1', amount: 2000 }, { credit_id: 'c2', amount: 1000 }];
    (supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: usages, error: null });

    const result = await consumeCredits('alice@example.com', 3000, 'rdv-2');
    expect(result).toEqual(usages);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('consume_credits', {
      p_email: 'alice@example.com',
      p_amount: 3000,
      p_appointment_id: 'rdv-2',
    });
  });

  it('retourne [] sans appeler la RPC si amount <= 0', async () => {
    await expect(consumeCredits('a@b.com', 0, 'rdv-3')).resolves.toEqual([]);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it('propage l\'erreur (avoir insuffisant côté RPC)', async () => {
    (supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'CREDIT_INSUFFICIENT' },
    });
    await expect(consumeCredits('a@b.com', 99999, 'rdv-4')).rejects.toThrow(/CREDIT_INSUFFICIENT/);
  });
});

describe('restoreCredits', () => {
  it('appelle la RPC restore_credits avec l\'id du RDV', async () => {
    (supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });
    await restoreCredits('rdv-5');
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('restore_credits', { p_appointment_id: 'rdv-5' });
  });

  it('propage l\'erreur RPC', async () => {
    (supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'fk violation' },
    });
    await expect(restoreCredits('rdv-6')).rejects.toThrow(/fk violation/);
  });
});

describe('getCreditBalance', () => {
  it('retourne balance + historique trié', async () => {
    const history = [
      { id: 'c2', remaining: 0, amount: 1000 },
      { id: 'c1', remaining: 2500, amount: 2500 },
    ];
    const chain = chainReturning({ data: history, error: null });
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await getCreditBalance('alice@example.com');
    expect(result.balance).toBe(2500);
    expect(result.history).toHaveLength(2);
  });
});
