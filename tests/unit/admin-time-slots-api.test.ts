import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  isAdminSession: vi.fn(),
  fetchManualSlots: vi.fn(),
  createManualSlot: vi.fn(),
  updateManualSlot: vi.fn(),
  deleteManualSlot: vi.fn(),
  invalidateSlotCache: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => h.getSession(...args) } },
}));

vi.mock('@/lib/authz', () => ({
  isAdminSession: (...args: unknown[]) => h.isAdminSession(...args),
}));

vi.mock('@/lib/manual-slots', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/manual-slots')>();
  return {
    ...actual,
    fetchManualSlots: (...args: unknown[]) => h.fetchManualSlots(...args),
    createManualSlot: (...args: unknown[]) => h.createManualSlot(...args),
    updateManualSlot: (...args: unknown[]) => h.updateManualSlot(...args),
    deleteManualSlot: (...args: unknown[]) => h.deleteManualSlot(...args),
    invalidateSlotCache: (...args: unknown[]) => h.invalidateSlotCache(...args),
  };
});

import { NotFoundError } from '@/lib/manual-slots';
import { DELETE, PATCH } from '@/pages/api/admin/time-slots/[id]';
import { POST } from '@/pages/api/admin/time-slots/index';

const adminSession = {
  user: { id: 'admin-1', email: 'admin@omf-therapie.fr' },
};

function request(method: string, body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/time-slots/slot-1/', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getSession.mockResolvedValue(adminSession);
  h.isAdminSession.mockReturnValue(true);
  h.invalidateSlotCache.mockResolvedValue(undefined);
});

describe('admin time-slot authorization', () => {
  it.each([
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('returns 401 for unauthenticated %s requests', async (method, handler) => {
    h.getSession.mockResolvedValue(null);

    const response = await handler({
      params: { id: 'slot-1' },
      request: request(
        method,
        method === 'PATCH' ? { period: 'morning' } : undefined,
      ),
    } as never);

    expect(response.status).toBe(401);
  });

  it.each([
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('returns 403 for non-admin %s requests', async (method, handler) => {
    h.isAdminSession.mockReturnValue(false);

    const response = await handler({
      params: { id: 'slot-1' },
      request: request(
        method,
        method === 'PATCH' ? { period: 'morning' } : undefined,
      ),
    } as never);

    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/admin/time-slots/[id]/', () => {
  it('rejects deleted_at before calling the library', async () => {
    const response = await PATCH({
      params: { id: 'slot-1' },
      request: request('PATCH', { period: 'morning', deleted_at: null }),
    } as never);

    expect(response.status).toBe(400);
    expect(h.updateManualSlot).not.toHaveBeenCalled();
  });

  it('maps NotFoundError to 404', async () => {
    h.updateManualSlot.mockRejectedValue(new NotFoundError());

    const response = await PATCH({
      params: { id: 'missing' },
      request: request('PATCH', { period: 'morning' }),
    } as never);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Créneau introuvable',
    });
  });

  it('keeps non-not-found database errors as 500', async () => {
    h.updateManualSlot.mockRejectedValue(new Error('permission denied'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await PATCH({
      params: { id: 'slot-1' },
      request: request('PATCH', { period: 'afternoon' }),
    } as never);

    expect(response.status).toBe(500);
    errorSpy.mockRestore();
  });
});

describe('DELETE /api/admin/time-slots/[id]/', () => {
  it('returns 204 once, then 404 when the same slot is already deleted', async () => {
    h.deleteManualSlot
      .mockResolvedValueOnce({ id: 'slot-1' })
      .mockRejectedValueOnce(new NotFoundError());

    const firstResponse = await DELETE({
      params: { id: 'slot-1' },
      request: request('DELETE'),
    } as never);
    const secondResponse = await DELETE({
      params: { id: 'slot-1' },
      request: request('DELETE'),
    } as never);

    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(404);
    await expect(secondResponse.json()).resolves.toEqual({
      error: 'Créneau introuvable',
    });
  });

  it('maps NotFoundError to 404', async () => {
    h.deleteManualSlot.mockRejectedValue(new NotFoundError());

    const response = await DELETE({
      params: { id: 'missing' },
      request: request('DELETE'),
    } as never);

    expect(response.status).toBe(404);
  });

  it('keeps non-not-found database errors as 500', async () => {
    h.deleteManualSlot.mockRejectedValue(new Error('timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await DELETE({
      params: { id: 'slot-1' },
      request: request('DELETE'),
    } as never);

    expect(response.status).toBe(500);
    errorSpy.mockRestore();
  });
});

describe('POST /api/admin/time-slots/', () => {
  it('maps unique violation 23505 to 409', async () => {
    h.createManualSlot.mockRejectedValue(
      Object.assign(new Error('duplicate key value'), { code: '23505' }),
    );

    const response = await POST({
      request: new Request('http://localhost/api/admin/time-slots/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_date: '2026-09-01', period: 'morning' }),
      }),
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Une plage horaire existe déjà pour cette date et cette période',
    });
  });
});
