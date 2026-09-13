/**
 * Handlers admin des présences manuelles — mapping service → HTTP
 * (revue #149 : les traductions 409/404 des contrats update/delete ajoutés
 * par le portage #133 pouvaient régresser sans échec de test).
 *
 * Le service `@/lib/manual-slots` est mocké : ces tests vérifient la
 * TRADUCTION des erreurs typées en codes HTTP, pas l'implémentation du
 * service (couverte par manual-slots.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: 'admin-1' } })) } },
}));
vi.mock('@/lib/authz', () => ({
  isAdminSession: vi.fn(() => true),
}));

vi.mock('@/lib/manual-slots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/manual-slots')>();
  return {
    ...actual,
    updateManualSlot: vi.fn(),
    deleteManualSlot: vi.fn(),
    invalidateSlotCache: vi.fn(async () => undefined),
  };
});

import {
  updateManualSlot,
  deleteManualSlot,
  ManualSlotDuplicateError,
  ManualSlotNotFoundError,
} from '@/lib/manual-slots';
import { PATCH, DELETE } from '@/pages/api/admin/time-slots/[id]';

const updateMock = vi.mocked(updateManualSlot);
const deleteMock = vi.mocked(deleteManualSlot);

function patchRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/time-slots/slot-1/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request('http://localhost/api/admin/time-slots/slot-1/', {
    method: 'DELETE',
  });
}

describe('PATCH /api/admin/time-slots/[id] — mapping HTTP', () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it('ManualSlotDuplicateError → 409', async () => {
    updateMock.mockRejectedValue(new ManualSlotDuplicateError());

    const res = await PATCH({
      params: { id: 'slot-1' },
      request: patchRequest({ period: 'afternoon' }),
    } as never);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'Cette présence existe déjà pour cette période.',
    });
  });

  it('ManualSlotNotFoundError → 404', async () => {
    updateMock.mockRejectedValue(new ManualSlotNotFoundError());

    const res = await PATCH({
      params: { id: 'slot-inconnu' },
      request: patchRequest({ period: 'morning' }),
    } as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Créneau introuvable' });
  });

  it('erreur non typée → 500', async () => {
    updateMock.mockRejectedValue(new Error('boom'));

    const res = await PATCH({
      params: { id: 'slot-1' },
      request: patchRequest({ period: 'morning' }),
    } as never);

    expect(res.status).toBe(500);
  });

  it('mise à jour réussie → 200 + slot JSON, payload validé avant appel', async () => {
    const slot = { id: 'slot-1', period: 'afternoon' };
    updateMock.mockResolvedValue(slot as never);

    const res = await PATCH({
      params: { id: 'slot-1' },
      request: patchRequest({ period: 'afternoon' }),
    } as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(slot);
    expect(updateMock).toHaveBeenCalledWith('slot-1', { period: 'afternoon' });
  });
});

describe('DELETE /api/admin/time-slots/[id] — mapping HTTP', () => {
  beforeEach(() => {
    deleteMock.mockReset();
  });

  it('ManualSlotNotFoundError → 404', async () => {
    deleteMock.mockRejectedValue(new ManualSlotNotFoundError());

    const res = await DELETE({
      params: { id: 'slot-inconnu' },
      request: deleteRequest(),
    } as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Créneau introuvable' });
  });

  it('erreur non typée → 500', async () => {
    deleteMock.mockRejectedValue(new Error('boom'));

    const res = await DELETE({
      params: { id: 'slot-1' },
      request: deleteRequest(),
    } as never);

    expect(res.status).toBe(500);
  });

  it('suppression réussie → 200 + { deleted: true, id }', async () => {
    deleteMock.mockResolvedValue(undefined);

    const res = await DELETE({
      params: { id: 'slot-1' },
      request: deleteRequest(),
    } as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, id: 'slot-1' });
  });
});
