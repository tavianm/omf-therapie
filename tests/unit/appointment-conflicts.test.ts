import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bufferMinutes: 15,
  directFilters: [] as Array<{ method: string; args: unknown[] }>,
  rescheduledFilters: [] as Array<{ method: string; args: unknown[] }>,
  directRows: [] as unknown[],
  rescheduledRows: [] as unknown[],
  calls: 0,
}));

vi.mock('@/lib/scheduling-settings', () => ({
  getSchedulingSettings: async () => ({
    bufferMinutes: h.bufferMinutes,
    updatedAt: '2026-08-31T00:00:00.000Z',
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const filters = h.calls++ === 0 ? h.directFilters : h.rescheduledFilters;
      const rows = h.calls === 1 ? h.directRows : h.rescheduledRows;
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          filters.push({ method: 'eq', args });
          return chain;
        },
        in: (...args: unknown[]) => {
          filters.push({ method: 'in', args });
          return chain;
        },
        is: (...args: unknown[]) => {
          filters.push({ method: 'is', args });
          return chain;
        },
        lt: (...args: unknown[]) => {
          filters.push({ method: 'lt', args });
          return chain;
        },
        gt: (...args: unknown[]) => {
          filters.push({ method: 'gt', args });
          return chain;
        },
        gte: (...args: unknown[]) => {
          filters.push({ method: 'gte', args });
          return chain;
        },
        not: (...args: unknown[]) => {
          filters.push({ method: 'not', args });
          return chain;
        },
        neq: (...args: unknown[]) => {
          filters.push({ method: 'neq', args });
          return chain;
        },
        limit: async () => ({ data: rows, error: null }),
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));

import { hasAppointmentConflict } from '@/lib/appointment-conflicts';

beforeEach(() => {
  h.bufferMinutes = 15;
  h.directFilters = [];
  h.rescheduledFilters = [];
  h.directRows = [];
  h.rescheduledRows = [];
  h.calls = 0;
});

describe('hasAppointmentConflict', () => {
  it('compares clinical starts against blocked_until including the configured margin', async () => {
    await expect(
      hasAppointmentConflict({
        slotStartIso: '2026-09-01T09:00:00.000Z',
        slotEndIso: '2026-09-01T10:00:00.000Z',
      }),
    ).resolves.toBe(false);

    expect(h.directFilters).toContainEqual({
      method: 'gt',
      args: ['blocked_until', '2026-09-01T09:00:00.000Z'],
    });
    expect(h.directFilters).toContainEqual({
      method: 'lt',
      args: ['scheduled_at', '2026-09-01T10:15:00.000Z'],
    });
  });

  it('reserves a reschedule proposal for its duration plus the margin', async () => {
    h.rescheduledRows = [
      {
        duration: 240,
        rescheduled_to: '2026-09-01T08:00:00.000Z',
      },
    ];

    await expect(
      hasAppointmentConflict({
        slotStartIso: '2026-09-01T12:00:00.000Z',
        slotEndIso: '2026-09-01T12:15:00.000Z',
      }),
    ).resolves.toBe(true);
  });
});
