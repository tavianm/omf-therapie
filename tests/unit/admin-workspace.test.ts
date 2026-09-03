import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/types/appointment';
import {
  getWorkspaceSummary,
  isOverduePendingRequest,
  paginateAppointments,
  upsertWorkspaceAppointment,
} from '@/components/admin/admin-workspace-utils';

function appointment(
  id: string,
  scheduledAt: string,
  status: Appointment['status'] = 'confirmed',
  rescheduledTo: string | null = null,
): Appointment {
  return {
    id,
    scheduled_at: scheduledAt,
    status,
    rescheduled_to: rescheduledTo,
  } as Appointment;
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

describe('workspace summary status rules', () => {
  const now = new Date('2026-09-02T08:00:00.000Z');

  it('excludes future cancelled and declined slots from next and actionable', () => {
    const summary = getWorkspaceSummary(
      [
        appointment('cancelled', '2026-09-02T09:00:00.000Z', 'cancelled'),
        appointment('declined', '2026-09-03T09:00:00.000Z', 'declined'),
      ],
      now,
    );

    expect(summary.next).toBeNull();
    expect(summary.actionable).toEqual([]);
  });

  it('keeps live future slots (confirmed, payment_received) as next', () => {
    for (const status of ['confirmed', 'payment_received'] as const) {
      const summary = getWorkspaceSummary(
        [appointment('live', '2026-09-02T09:00:00.000Z', status)],
        now,
      );
      expect(summary.next?.id).toBe('live');
    }

    // A cancelled slot earlier in the day must not shadow the next live one.
    const mixed = getWorkspaceSummary(
      [
        appointment('cancelled', '2026-09-02T08:30:00.000Z', 'cancelled'),
        appointment('confirmed', '2026-09-02T09:00:00.000Z'),
      ],
      now,
    );
    expect(mixed.next?.id).toBe('confirmed');
  });

  it('keeps a rescheduled proposal with a future slot upcoming and actionable', () => {
    const summary = getWorkspaceSummary(
      [
        appointment(
          'proposal',
          '2026-09-02T09:00:00.000Z',
          'rescheduled',
          '2026-09-04T10:00:00.000Z',
        ),
      ],
      now,
    );

    expect(summary.next?.id).toBe('proposal');
    expect(summary.overdue).toEqual([]);
    expect(summary.actionable.map(item => item.id)).toEqual(['proposal']);
  });

  it('flags an elapsed pending request as overdue', () => {
    const summary = getWorkspaceSummary(
      [appointment('pending', '2026-09-01T09:00:00.000Z', 'pending')],
      now,
    );

    expect(summary.overdue.map(item => item.id)).toEqual(['pending']);
    expect(summary.actionable.map(item => item.id)).toEqual(['pending']);
    expect(summary.next).toBeNull();
  });

  it('flags an elapsed payment_pending request as overdue', () => {
    const summary = getWorkspaceSummary(
      [
        appointment(
          'unpaid',
          '2026-09-01T09:00:00.000Z',
          'payment_pending',
        ),
      ],
      now,
    );

    expect(summary.overdue.map(item => item.id)).toEqual(['unpaid']);
    expect(summary.actionable.map(item => item.id)).toEqual(['unpaid']);
  });

  it('flags a rescheduled request whose proposal has elapsed as overdue', () => {
    const summary = getWorkspaceSummary(
      [
        appointment(
          'stale-proposal',
          '2026-08-30T09:00:00.000Z',
          'rescheduled',
          '2026-09-01T09:00:00.000Z',
        ),
      ],
      now,
    );

    expect(summary.overdue.map(item => item.id)).toEqual(['stale-proposal']);
    expect(summary.actionable.map(item => item.id)).toEqual([
      'stale-proposal',
    ]);
    expect(summary.next).toBeNull();
  });

  it('does not flag a rescheduled request whose proposal is still in the future', () => {
    expect(
      isOverduePendingRequest(
        appointment(
          'open-proposal',
          '2026-08-30T09:00:00.000Z',
          'rescheduled',
          '2026-09-05T09:00:00.000Z',
        ),
        now,
      ),
    ).toBe(false);
  });
});
