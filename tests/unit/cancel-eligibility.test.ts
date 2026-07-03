import { describe, expect, it, vi, beforeAll } from 'vitest';

// `isCancellableByTherapist` est un prédicat pur, mais son module importe
// appointment-eligibility.ts qui importe manual-slots.ts (Supabase). On mocke
// manual-slots pour ne pas déclencher d'I/O à l'import.
vi.mock('@/lib/manual-slots', () => ({
  fetchManualSlots: vi.fn(),
}));

import { isCancellableByTherapist } from '@/lib/appointment-eligibility';
import type { AppointmentStatus } from '@/types/appointment';

function appt(scheduled_at: string, status: AppointmentStatus = 'confirmed') {
  return { scheduled_at, status };
}

// Référence : aujourd'hui supposé = 2026-07-03 (test déterministe via injection).
// La veille Paris = 2026-07-02 à 00:00 Europe/Paris = 2026-07-01T22:00:00Z (UTC+2 été).
// Donc tout scheduled_at >= 2026-07-01T22:00:00Z est éligible.

describe('isCancellableByTherapist', () => {
  beforeAll(() => {
    // Fixe "maintenant" au 2026-07-03 10:00 UTC (12:00 Paris).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T10:00:00Z'));
  });

  it('rend éligible un RDV de la veille (UTC correspondant à 00:00 Paris)', () => {
    // 2026-07-02 08:00 Paris = 2026-07-02T06:00:00Z : clairement dans la fenêtre.
    expect(isCancellableByTherapist(appt('2026-07-02T06:00:00Z'))).toBe(true);
  });

  it('rend éligible un RDV plus récent que la veille', () => {
    expect(isCancellableByTherapist(appt('2026-07-03T08:00:00Z'))).toBe(true);
  });

  it('rend inéligible un RDV avant le début de la veille', () => {
    // 2026-07-01 10:00 Paris = 2026-07-01T08:00:00Z : avant la veille (2026-07-01T22:00Z).
    expect(isCancellableByTherapist(appt('2026-07-01T08:00:00Z'))).toBe(false);
  });

  it('borne exacte : exactement début de la veille = éligible (>=)', () => {
    // 2026-07-02 00:00 Paris = 2026-07-01T22:00:00Z.
    expect(isCancellableByTherapist(appt('2026-07-01T22:00:00Z'))).toBe(true);
  });

  it('statut declined → inéligible même si dans la fenêtre', () => {
    expect(isCancellableByTherapist(appt('2026-07-02T06:00:00Z', 'declined'))).toBe(false);
  });

  it('statut cancelled → inéligible', () => {
    expect(isCancellableByTherapist(appt('2026-07-02T06:00:00Z', 'cancelled'))).toBe(false);
  });

  it('statut payment_received → éligible (cas annulation payée)', () => {
    expect(isCancellableByTherapist(appt('2026-07-02T06:00:00Z', 'payment_received'))).toBe(true);
  });

  it('statut payment_pending → éligible', () => {
    expect(isCancellableByTherapist(appt('2026-07-02T06:00:00Z', 'payment_pending'))).toBe(true);
  });
});
