import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/types/appointment';
import {
  getWorkspaceSummary,
  paginateAppointments,
  upsertWorkspaceAppointment,
} from '@/components/admin/admin-workspace-utils';

function appointment(
  id: string,
  scheduledAt: string,
  status: Appointment['status'] = 'confirmed',
): Appointment {
  return { id, scheduled_at: scheduledAt, status } as Appointment;
}

describe('admin workspace helpers', () => {
  it('derives the operational summary before history', () => {
    const summary = getWorkspaceSummary(
      [
        appointment('past', '2026-08-30T09:00:00.000Z'),
        appointment('next', '2026-08-31T10:00:00.000Z'),
        appointment('pending', '2026-08-31T11:00:00.000Z', 'pending'),
      ],
      new Date('2026-08-31T08:00:00.000Z'),
    );

    expect(summary.next?.id).toBe('next');
    expect(summary.actionable.map(item => item.id)).toEqual(['pending']);
    expect(summary.today.map(item => item.id)).toEqual(['next', 'pending']);
  });

  it('keeps list rendering bounded and reconciles an updated appointment', () => {
    const items = Array.from({ length: 360 }, (_, index) =>
      appointment(String(index), '2026-09-01T09:00:00.000Z'),
    );
    expect(paginateAppointments(items, 0).items).toHaveLength(25);
    expect(paginateAppointments(items, 99).page).toBe(14);
    expect(
      upsertWorkspaceAppointment(
        [appointment('one', '2026-09-01T09:00:00.000Z')],
        appointment('one', '2026-09-02T09:00:00.000Z', 'cancelled'),
      )[0].status,
    ).toBe('cancelled');
  });
});
