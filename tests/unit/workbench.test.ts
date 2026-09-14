import { describe, expect, it } from 'vitest';
import type { Appointment } from '../../src/types/appointment';
import {
  aggregatePatients,
  getInitials,
  getMinutesUntil,
  getMonthlyVolume,
  getNextSessions,
  getTodaySessions,
  isActiveAppointment,
  isReschedulable,
  describeSlot,
  // Issue #164 — file « Demandes de RDV », KPI « Ma semaine » et « Demain ».
  getDemandItems,
  getTomorrowSessions,
  getWeekSessions,
} from '../../src/utils/workbench';

/**
 * Instant de référence : vendredi 11 septembre 2026, 15:00 Paris (CEST, UTC+2).
 * Toutes les dates de fixture s'expriment par rapport à cet instant.
 */
const NOW = Date.parse('2026-09-11T13:00:00.000Z'); // 15:00 Paris
const TODAY_0830 = '2026-09-11T06:30:00.000Z'; // 08:30 Paris — passé
const TODAY_1500 = '2026-09-11T13:00:00.000Z'; // 15:00 Paris — maintenant
const TODAY_1630 = '2026-09-11T14:30:00.000Z'; // 16:30 Paris — à venir
const TOMORROW_0900 = '2026-09-12T07:00:00.000Z'; // 09:00 Paris le 12
const YESTERDAY_1000 = '2026-09-10T08:00:00.000Z'; // 10:00 Paris le 10
const LAST_MONTH = '2026-08-20T10:00:00.000Z'; // 20 août

/**
 * Instants et heures de séance additionnels (#164) : bornes de week-end pour
 * « Ma semaine » et nuit du changement d'heure pour « Demain » (jour de 23 h).
 */
const SATURDAY_NOW = Date.parse('2026-09-12T13:00:00.000Z'); // samedi 12 sept, 15:00 Paris
const SUNDAY_NOW = Date.parse('2026-09-13T13:00:00.000Z'); // dimanche 13 sept, 15:00 Paris
// Samedi 28 mars, 15:00 Paris (CET) — l'Europe/Paris passe à l'heure d'été dans la nuit du 28 au 29.
const NOW_DST = Date.parse('2026-03-28T14:00:00.000Z');
// 23:30 Paris (CET) le 28 — soirée avant la bascule : l'arithmétique civile
// (+1 jour) donne le 29 là où le mutant naïf en instants (+24 h) donne le 30.
const NOW_DST_EVE = Date.parse('2026-03-28T22:30:00.000Z');
const LAST_MONDAY_0900 = '2026-09-07T07:00:00.000Z'; // 09:00 Paris le lundi 7 — jour passé de la semaine en cours
const SATURDAY_0900 = '2026-09-12T07:00:00.000Z'; // 09:00 Paris le samedi 12
const SUNDAY_0900 = '2026-09-13T07:00:00.000Z'; // 09:00 Paris le dimanche 13
const NEXT_MONDAY_0900 = '2026-09-14T07:00:00.000Z'; // 09:00 Paris le lundi 14
const NEXT_SUNDAY_0900 = '2026-09-20T07:00:00.000Z'; // 09:00 Paris le dimanche 20 — dernier jour de la semaine suivante
const TOMORROW_1400 = '2026-09-12T12:00:00.000Z'; // 14:00 Paris le 12
const DST_TODAY_EVENING = '2026-03-28T17:00:00.000Z'; // 18:00 Paris (CET) le 28 — même jour Paris que NOW_DST
const DST_TOMORROW_0900 = '2026-03-29T07:00:00.000Z'; // 09:00 Paris (CEST) le 29 — matin du jour de 23 h

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    patient_name: 'Test Patient',
    patient_email: 'test@example.com',
    patient_phone: '0600000000',
    patient_postal_code: '69006',
    patient_city: 'Lyon',
    patient_reason: 'Suivi',
    appointment_type: 'individual',
    appointment_mode: 'video',
    duration: 60,
    is_first_session: false,
    base_price: 5000,
    discount: 0,
    final_price: 5000,
    credit_applied: 0,
    scheduled_at: TODAY_1500,
    status: 'confirmed',
    invitation_sent_at: null,
    stripe_payment_link_id: null,
    stripe_payment_link_url: null,
    stripe_payment_intent_id: null,
    video_link: null,
    google_calendar_event_id: null,
    therapist_notes: null,
    rescheduled_to: null,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('isActiveAppointment', () => {
  it('excludes declined and cancelled', () => {
    expect(isActiveAppointment(makeAppointment({ status: 'cancelled' }))).toBe(
      false,
    );
    expect(isActiveAppointment(makeAppointment({ status: 'declined' }))).toBe(
      false,
    );
  });

  it('includes pending, confirmed, rescheduled, payment_pending, payment_received', () => {
    for (const status of [
      'pending',
      'confirmed',
      'rescheduled',
      'payment_pending',
      'payment_received',
    ] as const) {
      expect(isActiveAppointment(makeAppointment({ status }))).toBe(true);
    }
  });
});

describe('getTodaySessions', () => {
  it('keeps active sessions of the Paris day, chronological', () => {
    const sessions = getTodaySessions(
      [
        makeAppointment({ id: 'tomorrow', scheduled_at: TOMORROW_0900 }),
        makeAppointment({ id: '1630', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: '0830', scheduled_at: TODAY_0830 }),
        makeAppointment({
          id: 'cancelled',
          status: 'cancelled',
          scheduled_at: TODAY_1500,
        }),
      ],
      NOW,
    );
    expect(sessions.map(s => s.id)).toEqual(['0830', '1630']);
  });
});

describe('getNextSessions', () => {
  it('returns upcoming sessions only, capped and sorted', () => {
    const sessions = getNextSessions(
      [
        makeAppointment({ id: 'tomorrow', scheduled_at: TOMORROW_0900 }),
        makeAppointment({ id: 'past', scheduled_at: TODAY_0830 }),
        makeAppointment({ id: 'now', scheduled_at: TODAY_1500 }),
        makeAppointment({ id: '1630', scheduled_at: TODAY_1630 }),
        makeAppointment({
          id: 'cancelled',
          status: 'cancelled',
          scheduled_at: TODAY_1630,
        }),
      ],
      NOW,
      2,
    );
    expect(sessions.map(s => s.id)).toEqual(['now', '1630']);
  });
});

describe('getMonthlyVolume', () => {
  it('counts active sessions of the current Paris month and the honored share', () => {
    const volume = getMonthlyVolume(
      [
        makeAppointment({ id: '1', scheduled_at: TODAY_0830 }),
        makeAppointment({ id: '2', scheduled_at: TODAY_1630 }),
        makeAppointment({
          id: '3',
          status: 'cancelled',
          scheduled_at: TODAY_1630,
        }),
        makeAppointment({
          id: '4',
          status: 'declined',
          scheduled_at: TODAY_1500,
        }),
        makeAppointment({ id: 'other-month', scheduled_at: LAST_MONTH }),
      ],
      NOW,
    );
    expect(volume).toEqual({ total: 2, cancelled: 2, honoredSharePct: 50 });
  });

  it('returns null share for an empty month', () => {
    const volume = getMonthlyVolume(
      [makeAppointment({ scheduled_at: LAST_MONTH })],
      NOW,
    );
    expect(volume).toEqual({ total: 0, cancelled: 0, honoredSharePct: null });
  });
});

describe('getMinutesUntil', () => {
  it('rounds to whole minutes for a future session', () => {
    expect(getMinutesUntil(TODAY_1630, NOW)).toBe(90);
  });

  it('treats a session starting now as not-future', () => {
    expect(getMinutesUntil(TODAY_1500, NOW)).toBeNull();
  });

  it('returns null for a past session', () => {
    expect(getMinutesUntil(TODAY_0830, NOW)).toBeNull();
  });
});

describe('aggregatePatients', () => {
  it('groups by email and takes identity from the most recent appointment', () => {
    const patients = aggregatePatients(
      [
        makeAppointment({
          id: 'old',
          patient_name: 'Anne Roux',
          patient_phone: '06 30 40 50 60',
          scheduled_at: LAST_MONTH,
          status: 'payment_received',
          final_price: 5000,
        }),
        makeAppointment({
          id: 'recent',
          patient_name: 'Anne R. updated',
          patient_phone: '06 11 22 33 44',
          scheduled_at: TODAY_1630,
          status: 'confirmed',
        }),
      ],
      NOW,
    );
    expect(patients).toHaveLength(1);
    const anne = patients[0];
    expect(anne?.name).toBe('Anne R. updated');
    expect(anne?.phone).toBe('06 11 22 33 44');
    expect(anne?.sessionCount).toBe(2);
    expect(anne?.isActive).toBe(true);
    expect(anne?.paidCents).toBe(5000);
    expect(anne?.completedCount).toBe(1);
    expect(anne?.nextAppointment?.id).toBe('recent');
    expect(anne?.history.map(a => a.id)).toEqual(['recent', 'old']);
  });

  it('marks patients inactive after 3 months without appointments', () => {
    const patients = aggregatePatients(
      [
        makeAppointment({
          scheduled_at: '2026-04-10T08:00:00.000Z',
          status: 'payment_received',
        }),
      ],
      NOW,
    );
    expect(patients[0]?.isActive).toBe(false);
  });

  it('computes completed sessions and pending payments', () => {
    const patients = aggregatePatients(
      [
        makeAppointment({
          id: 'done',
          status: 'payment_received',
          scheduled_at: YESTERDAY_1000,
        }),
        makeAppointment({
          id: 'awaiting',
          status: 'payment_pending',
          scheduled_at: TODAY_0830,
        }),
      ],
      NOW,
    );
    // Le RDV payment_pending passé est en attente de règlement, pas « réalisé ».
    expect(patients[0]?.completedCount).toBe(1);
    expect(patients[0]?.paidCents).toBe(5000);
    expect(patients[0]?.pendingPaymentCents).toBe(5000);
  });

  it('sorts patients by most recent appointment', () => {
    const patients = aggregatePatients(
      [
        makeAppointment({
          id: 'a',
          patient_email: 'a@example.com',
          scheduled_at: LAST_MONTH,
        }),
        makeAppointment({
          id: 'b',
          patient_email: 'b@example.com',
          scheduled_at: TODAY_1630,
        }),
      ],
      NOW,
    );
    expect(patients.map(p => p.email)).toEqual([
      'b@example.com',
      'a@example.com',
    ]);
  });
});

describe('getInitials', () => {
  it('takes the first letter of the two first words', () => {
    expect(getInitials('Anne Roux')).toBe('AR');
    expect(getInitials('Jean')).toBe('J');
    expect(getInitials('  ')).toBe('');
  });
});

describe('describeSlot', () => {
  it('labels today, tomorrow and later days (Paris)', () => {
    expect(describeSlot(TODAY_1630, TODAY_1630, NOW).dayLabel).toBe(
      "Aujourd'hui",
    );
    expect(describeSlot(TOMORROW_0900, TOMORROW_0900, NOW).dayLabel).toBe(
      'Demain',
    );
    expect(
      describeSlot('2026-09-14T08:00:00.000Z', '2026-09-14T09:00:00.000Z', NOW)
        .dayLabel,
    ).toBe('LUN 14 SEPT');
  });

  it('formats the Paris time range from the authoritative slot bounds', () => {
    expect(
      describeSlot('2026-09-14T08:00:00.000Z', '2026-09-14T09:00:00.000Z', NOW)
        .timeLabel,
    ).toBe('10:00 – 11:00');
  });
});

describe('aggregatePatients activity cutoff (3 calendar months, API parity)', () => {
  it('keeps a patient seen exactly three calendar months ago active', () => {
    // 11 juin 13:00Z = limite exacte de « 3 mois civils » avant NOW (11 sept 13:00Z).
    const boundary = aggregatePatients(
      [makeAppointment({ scheduled_at: '2026-06-11T13:00:00.000Z' })],
      NOW,
    );
    expect(boundary[0]?.isActive).toBe(true);

    // 90 jours avant NOW = 13 juin : l'ancienne approximation le rendait inactif
    // à tort dès le 12 juin — même règle que /api/admin/patients/ désormais.
    const justBefore = aggregatePatients(
      [makeAppointment({ scheduled_at: '2026-06-11T12:59:59.000Z' })],
      NOW,
    );
    expect(justBefore[0]?.isActive).toBe(false);
  });
});

describe('isReschedulable', () => {
  it('allows unpaid and pending statuses — the unpaid-video reschedule flow', () => {
    for (const status of [
      'pending',
      'payment_pending',
      'confirmed',
      'payment_received',
      'rescheduled',
    ] as const) {
      expect(isReschedulable(makeAppointment({ status }))).toBe(true);
    }
  });

  it('rejects terminal statuses', () => {
    expect(isReschedulable(makeAppointment({ status: 'declined' }))).toBe(
      false,
    );
    expect(isReschedulable(makeAppointment({ status: 'cancelled' }))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Issue #164 — file « Demandes de RDV » (SC2), KPI « Ma semaine » (SC4),
// KPI « Demain » (SC5). Contrats implémentés dans `src/utils/workbench.ts`.
// ---------------------------------------------------------------------------

describe('getDemandItems', () => {
  it('exclut les paiements en attente — le lien de paiement agit seul', () => {
    // Arrange / Act
    const items = getDemandItems(
      [
        makeAppointment({
          id: 'paiement',
          status: 'payment_pending',
          scheduled_at: YESTERDAY_1000,
        }),
      ],
      NOW,
    );
    // Assert
    expect(items).toEqual([]);
  });

  it('exclut un report dont la proposition est encore valide (future)', () => {
    // Arrange
    const items = getDemandItems(
      [
        makeAppointment({
          id: 'report-valide',
          status: 'rescheduled',
          scheduled_at: TODAY_0830,
          rescheduled_to: TODAY_1630, // proposition future : le patient peut encore l’accepter
        }),
      ],
      NOW,
    );
    // Assert
    expect(items).toEqual([]);
  });

  it('inclut un report dont la proposition est expirée (passée)', () => {
    // Arrange
    const items = getDemandItems(
      [
        makeAppointment({
          id: 'report-expire',
          status: 'rescheduled',
          scheduled_at: TODAY_0830,
          rescheduled_to: YESTERDAY_1000, // proposition passée : le patient ne peut plus accepter
        }),
      ],
      NOW,
    );
    // Assert
    expect(items.map(i => i.id)).toEqual(['report-expire']);
  });

  it('inclut un report sans proposition (rescheduled_to null) — même règle que la page patient', () => {
    // Arrange (rescheduled_to null par défaut dans la factory) / Act
    const items = getDemandItems(
      [
        makeAppointment({
          id: 'report-sans-proposition',
          status: 'rescheduled',
          scheduled_at: TODAY_0830,
        }),
      ],
      NOW,
    );
    // Assert
    expect(items.map(i => i.id)).toEqual(['report-sans-proposition']);
  });

  it('inclut la borne exacte : une proposition expirant à l’instant même est déjà expirée', () => {
    // Arrange — rescheduled_to === nowMs : la règle patient est `≤ now`, borne incluse.
    const items = getDemandItems(
      [
        makeAppointment({
          id: 'borne',
          status: 'rescheduled',
          scheduled_at: TODAY_0830,
          rescheduled_to: TODAY_1500,
        }),
      ],
      NOW,
    );
    // Assert
    expect(items.map(i => i.id)).toEqual(['borne']);
  });

  it('place une demande en retard en tête : tri par scheduled_at croissant', () => {
    // Arrange — deux demandes à traiter : la plus tôt (en retard) passe en premier.
    const items = getDemandItems(
      [
        makeAppointment({
          id: 'report-expire-tardif',
          status: 'rescheduled',
          scheduled_at: TODAY_1630,
          rescheduled_to: TODAY_1500,
        }),
        makeAppointment({
          id: 'demande-retard',
          status: 'pending',
          scheduled_at: TODAY_0830,
        }),
      ],
      NOW,
    );
    // Assert
    expect(items.map(i => i.id)).toEqual([
      'demande-retard',
      'report-expire-tardif',
    ]);
    expect(items[0]?.id).toBe('demande-retard');
  });

  it('n’inclut jamais les statuts réglés ni terminaux', () => {
    // Arrange / Act
    const items = getDemandItems(
      [
        makeAppointment({
          id: 'confirmee',
          status: 'confirmed',
          scheduled_at: TODAY_0830,
        }),
        makeAppointment({
          id: 'reglee',
          status: 'payment_received',
          scheduled_at: TODAY_0830,
        }),
        makeAppointment({
          id: 'annulee',
          status: 'cancelled',
          scheduled_at: TODAY_1630,
        }),
        makeAppointment({
          id: 'refusee',
          status: 'declined',
          scheduled_at: TODAY_1630,
        }),
      ],
      NOW,
    );
    // Assert
    expect(items).toEqual([]);
  });
});

describe('getWeekSessions', () => {
  it('vendredi : compte la semaine civile en cours, jours passés inclus', () => {
    // Arrange — lundi 7 (jour passé) et vendredi 11 sont dans la semaine 07→13 ; lundi 14 non.
    const week = getWeekSessions(
      [
        makeAppointment({ id: 'lundi-passe', scheduled_at: LAST_MONDAY_0900 }),
        makeAppointment({ id: 'vendredi', scheduled_at: TODAY_0830 }),
        makeAppointment({
          id: 'semaine-suivante',
          scheduled_at: NEXT_MONDAY_0900,
        }),
      ],
      NOW,
    );
    // Assert
    expect(week).toEqual({
      count: 2,
      weekStartKey: '2026-09-07',
      weekEndKey: '2026-09-13',
      label: 'Ma semaine',
    });
  });

  it('samedi : bascule sur la semaine à venir, du lundi suivant au dimanche inclus', () => {
    // Arrange — le samedi 12 (semaine en cours) est ignoré ; le dimanche 20 clôt la semaine à venir.
    const week = getWeekSessions(
      [
        makeAppointment({ id: 'samedi-en-cours', scheduled_at: SATURDAY_0900 }),
        makeAppointment({
          id: 'dimanche-suivant',
          scheduled_at: NEXT_SUNDAY_0900,
        }),
      ],
      SATURDAY_NOW,
    );
    // Assert
    expect(week).toEqual({
      count: 1,
      weekStartKey: '2026-09-14',
      weekEndKey: '2026-09-20',
      label: 'Ma semaine à venir',
    });
  });

  it('dimanche : même règle que samedi — semaine suivante', () => {
    // Arrange — le dimanche 13 (semaine en cours) est ignoré ; le lundi 14 ouvre la suivante.
    const week = getWeekSessions(
      [
        makeAppointment({ id: 'dimanche-en-cours', scheduled_at: SUNDAY_0900 }),
        makeAppointment({
          id: 'lundi-suivant',
          scheduled_at: NEXT_MONDAY_0900,
        }),
      ],
      SUNDAY_NOW,
    );
    // Assert
    expect(week).toEqual({
      count: 1,
      weekStartKey: '2026-09-14',
      weekEndKey: '2026-09-20',
      label: 'Ma semaine à venir',
    });
  });

  it('ne compte jamais les séances annulées ni refusées', () => {
    // Arrange / Act — deux RDV dans la fenêtre mais inactifs.
    const week = getWeekSessions(
      [
        makeAppointment({
          id: 'annulee',
          status: 'cancelled',
          scheduled_at: TODAY_0830,
        }),
        makeAppointment({
          id: 'refusee',
          status: 'declined',
          scheduled_at: TODAY_1630,
        }),
      ],
      NOW,
    );
    // Assert
    expect(week).toEqual({
      count: 0,
      weekStartKey: '2026-09-07',
      weekEndKey: '2026-09-13',
      label: 'Ma semaine',
    });
  });
});

describe('getTomorrowSessions', () => {
  it('retourne uniquement les séances actives du jour Paris suivant, triées', () => {
    // Arrange — samedi 12 seul jour attendu : le soir du 11 et le dimanche 13 sont hors clé de jour.
    const result = getTomorrowSessions(
      [
        makeAppointment({ id: 'demain-1400', scheduled_at: TOMORROW_1400 }),
        makeAppointment({ id: 'ce-soir', scheduled_at: TODAY_1630 }),
        makeAppointment({ id: 'apres-demain', scheduled_at: SUNDAY_0900 }),
        makeAppointment({
          id: 'demain-annule',
          status: 'cancelled',
          scheduled_at: TOMORROW_0900,
        }),
        makeAppointment({ id: 'demain-0900', scheduled_at: TOMORROW_0900 }),
      ],
      NOW,
    );
    // Assert
    expect(result.sessions.map(s => s.id)).toEqual([
      'demain-0900',
      'demain-1400',
    ]);
    expect(result.firstStartIso).toBe(TOMORROW_0900);
  });

  it('renvoie une liste vide et firstStartIso null quand demain est libre', () => {
    // Arrange / Act
    const result = getTomorrowSessions([], NOW);
    // Assert — détail « Aucune séance » de la carte Demain.
    expect(result.sessions).toEqual([]);
    expect(result.firstStartIso).toBeNull();
  });

  it('gère le jour de 23 h (passage à l’heure d’été) : demain est la clé de jour +1, jamais +24 h', () => {
    // Arrange — deux « now » avant la bascule DST de la nuit du 28 au 29 mars :
    // - à 15:00 Paris (NOW_DST), le mutant naïf en instants (+24 h) retombe
    //   lui aussi sur le 29 (16:00 CEST) : ce fixture seul ne le tue pas ;
    // - à 23:30 Paris (NOW_DST_EVE), le mutant atterrit sur le 30 (00:30 CEST)
    //   et rate la séance du 29 matin — c'est lui qui tue le mutant.
    const afternoon = getTomorrowSessions(
      [
        makeAppointment({ id: 'dst-ce-soir', scheduled_at: DST_TODAY_EVENING }),
        makeAppointment({
          id: 'dst-demain-0900',
          scheduled_at: DST_TOMORROW_0900,
        }),
      ],
      NOW_DST,
    );
    const evening = getTomorrowSessions(
      [
        makeAppointment({ id: 'dst2-ce-soir', scheduled_at: DST_TODAY_EVENING }),
        makeAppointment({
          id: 'dst2-demain-0900',
          scheduled_at: DST_TOMORROW_0900,
        }),
      ],
      NOW_DST_EVE,
    );
    // Assert
    expect(afternoon.sessions.map(s => s.id)).toEqual(['dst-demain-0900']);
    expect(afternoon.firstStartIso).toBe(DST_TOMORROW_0900);
    expect(evening.sessions.map(s => s.id)).toEqual(['dst2-demain-0900']);
    expect(evening.firstStartIso).toBe(DST_TOMORROW_0900);
  });
});
