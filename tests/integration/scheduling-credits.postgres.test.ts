/**
 * Integration tests against a REAL PostgreSQL — revue #149 (finding todo
 * [vacuous-guard] on tests/unit/scheduling-migration.test.ts).
 *
 * The unit suite proves SQL shape (lock text before UPDATE text); these tests
 * prove BEHAVIOR: the migrations 000-local→020 are applied to a disposable
 * database and the financial invariants are exercised under real concurrency:
 *
 *   1. restore_credits under two concurrent calls restores exactly once
 *      (advisory-lock serialization, migration 018);
 *   2. restore_credits is idempotent sequentially;
 *   3. cancel_appointment_with_credits (migration 019) performs the CAS
 *      claim + credit restore + cash-credit issuance in one transaction;
 *   4. two concurrent cancels → exactly one winner, the loser raises
 *      cancel_status_conflict (the API maps it to 409);
 *   5. a stale expected status raises cancel_status_conflict;
 *   6. consume_credits (008, body replaced by 020) consumes FIFO with
 *      journaled tranches, fails closed on insufficient balance (no partial
 *      write), and serializes under concurrency: one winner under full
 *      contention, clean split under partial demand.
 *
 * Requires a reachable PostgreSQL via TEST_DATABASE_URL (default: the docker
 * compose service — `npm run db:start`). Skips with an explicit reason when
 * unreachable, so the suite stays green on machines without Docker.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/omf_therapie';

function dbUrl(dbName: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
}

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Local compat (auth stub + Supabase roles) then every migration, in order. */
function migrationFiles(): string[] {
  const compat = join(REPO_ROOT, 'supabase', 'local', '000_local_compat.sql');
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
  return [compat, ...files];
}

// Reachability probe (top-level await) — skips the whole file with a reason
// instead of failing when no server is running.
let unreachableReason: string | null = null;
try {
  const probe = new Pool({
    connectionString: dbUrl('postgres'),
    connectionTimeoutMillis: 3000,
    max: 1,
  });
  await probe.query('SELECT 1');
  await probe.end();
} catch {
  unreachableReason = `PostgreSQL injoignable sur ${BASE_URL} — lancer « npm run db:start » (local) ; en CI le service postgres doit être monté.`;
  console.warn(`[skip] tests/integration/scheduling-credits.postgres.test.ts — ${unreachableReason}`);
}

describe.skipIf(unreachableReason !== null)('credits ledger contre PostgreSQL réel (015–019)', () => {
  const TEST_DB = `omf_fix_test_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let db: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: dbUrl('postgres') });
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    db = new Pool({ connectionString: dbUrl(TEST_DB) });
    for (const file of migrationFiles()) {
      // One pg query per file: the simple-query protocol wraps multiple
      // statements in a single implicit transaction — same semantics as
      // `supabase db push` (each migration is one transaction).
      await db.query(readFileSync(file, 'utf8'));
    }
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  async function seedAppointment(overrides: {
    status?: string;
    credit_applied?: number;
    final_price?: number;
    atOffsetDays?: number;
  }): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO appointments
        (patient_name, patient_email, patient_phone, patient_postal_code,
         patient_city, patient_reason, appointment_type, appointment_mode,
         duration, base_price, discount, final_price, scheduled_at, status,
         credit_applied)
       VALUES ('Patient Test', 'integration@test.example', '0600000000',
         '63000', 'Clermont-Ferrand', 'Séance de test intégration',
         'individual', 'video', 60, $1, 0, $1,
         now() + make_interval(days => $4::int), $2, $3)
       RETURNING id`,
      [
        overrides.final_price ?? 6000,
        overrides.status ?? 'payment_received',
        overrides.credit_applied ?? 0,
        overrides.atOffsetDays ?? 7,
      ],
    );
    return rows[0].id;
  }

  /**
   * Avoir de `amount` entièrement consommé par `appointmentId` (remaining 0).
   * Source NULL : l'avoir provient d'une annulation antérieure sans RDV source
   * (008 autorise plusieurs NULL) — il ne doit PAS partager le
   * `source_appointment_id` du RDV annulé, réservé à l'avoir d'annulation.
   */
  async function seedConsumedCredit(appointmentId: string, amount: number): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO credits (patient_email, source_appointment_id, amount, remaining, reason)
       VALUES ('integration@test.example', NULL, $1, 0, 'cancellation')
       RETURNING id`,
      [amount],
    );
    await db.query(
      `INSERT INTO credit_usages (credit_id, appointment_id, amount) VALUES ($1, $2, $3)`,
      [rows[0].id, appointmentId, amount],
    );
    return rows[0].id;
  }

  async function creditRemaining(creditId: string): Promise<number> {
    const { rows } = await db.query<{ remaining: number }>(
      `SELECT remaining FROM credits WHERE id = $1`,
      [creditId],
    );
    return rows[0]?.remaining ?? -1;
  }

  async function usageCount(appointmentId: string): Promise<number> {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM credit_usages WHERE appointment_id = $1`,
      [appointmentId],
    );
    return rows[0].n;
  }

  it('restaure exactement une fois sous deux appels restore_credits concurrents', async () => {
    const apptId = await seedAppointment({ credit_applied: 3000, atOffsetDays: 7 });
    const creditId = await seedConsumedCredit(apptId, 3000);

    const clientA = await db.connect();
    const clientB = await db.connect();
    try {
      const results = await Promise.allSettled([
        clientA.query('SELECT public.restore_credits($1)', [apptId]),
        clientB.query('SELECT public.restore_credits($1)', [apptId]),
      ]);
      for (const r of results) {
        expect(r.status).toBe('fulfilled');
      }
    } finally {
      clientA.release();
      clientB.release();
    }

    // Les deux appels réussissent (idempotence) mais la restitution ne
    // s'applique qu'UNE fois : remaining += 3000 une seule fois.
    await expect(creditRemaining(creditId)).resolves.toBe(3000);
    await expect(usageCount(apptId)).resolves.toBe(0);
  });

  it('restore_credits est idempotent séquentiellement', async () => {
    const apptId = await seedAppointment({ credit_applied: 2500, atOffsetDays: 14 });
    const creditId = await seedConsumedCredit(apptId, 2500);

    await db.query('SELECT public.restore_credits($1)', [apptId]);
    await db.query('SELECT public.restore_credits($1)', [apptId]);
    await db.query('SELECT public.restore_credits($1)', [apptId]);

    await expect(creditRemaining(creditId)).resolves.toBe(2500);
    await expect(usageCount(apptId)).resolves.toBe(0);
  });

  it('cancel_appointment_with_credits : claim + restitution + émission en une transaction', async () => {
    const apptId = await seedAppointment({ credit_applied: 3000, final_price: 6000, atOffsetDays: 21 });
    const originalCreditId = await seedConsumedCredit(apptId, 3000);

    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT public.cancel_appointment_with_credits($1, $2, $3) AS result',
      [apptId, 'payment_received', 'Note de la thérapeute'],
    );
    const result = rows[0].result as {
      status: string;
      therapist_notes: string | null;
      _restored_amount: number;
      _issued_credit: boolean;
      _credit_cash_amount: number;
    };

    expect(result.status).toBe('cancelled');
    expect(result.therapist_notes).toBe('Note de la thérapeute');
    expect(result._restored_amount).toBe(3000);
    expect(result._issued_credit).toBe(true);
    expect(result._credit_cash_amount).toBe(3000); // 6000 cash − 3000 avoir

    // L'avoir d'origine est restitué une seule fois…
    const { rows: originalRows } = await db.query<{ remaining: number }>(
      'SELECT remaining FROM credits WHERE id = $1',
      [originalCreditId],
    );
    expect(originalRows[0].remaining).toBe(3000);
    await expect(usageCount(apptId)).resolves.toBe(0);

    // …et l'avoir cash est émis une seule fois, rattaché au RDV source.
    const { rows: issuedRows } = await db.query<{ amount: number; remaining: number }>(
      `SELECT amount, remaining FROM credits
        WHERE source_appointment_id = $1`,
      [apptId],
    );
    expect(issuedRows).toHaveLength(1);
    expect(issuedRows[0]).toMatchObject({ amount: 3000, remaining: 3000 });
  });

  it('deux annulations concurrentes : un seul gagnant, le perdant reçoit cancel_status_conflict', async () => {
    const apptId = await seedAppointment({ credit_applied: 0, final_price: 6000, atOffsetDays: 28 });

    const clientA = await db.connect();
    const clientB = await db.connect();
    const settled: PromiseSettledResult<unknown>[] = [];
    try {
      settled.push(
        ...(await Promise.allSettled([
          clientA.query('SELECT public.cancel_appointment_with_credits($1, $2, $3)', [
            apptId,
            'payment_received',
            null,
          ]),
          clientB.query('SELECT public.cancel_appointment_with_credits($1, $2, $3)', [
            apptId,
            'payment_received',
            null,
          ]),
        ])),
      );
    } finally {
      clientA.release();
      clientB.release();
    }

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && String((r as PromiseRejectedResult).reason).includes('cancel_status_conflict'),
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Un seul avoir cash malgré les deux appels.
    const { rows: credits } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM credits WHERE source_appointment_id = $1',
      [apptId],
    );
    expect(credits[0].n).toBe(1);
    const { rows: status } = await db.query<{ status: string }>(
      'SELECT status FROM appointments WHERE id = $1',
      [apptId],
    );
    expect(status[0].status).toBe('cancelled');
  });

  it('statut déjà changé : cancel_status_conflict, la ligne reste intacte', async () => {
    const apptId = await seedAppointment({ status: 'confirmed', final_price: 6000, atOffsetDays: 35 });

    await expect(
      db.query('SELECT public.cancel_appointment_with_credits($1, $2, $3)', [
        apptId,
        'payment_received',
        null,
      ]),
    ).rejects.toThrow(/cancel_status_conflict/);

    const { rows } = await db.query<{ status: string }>(
      'SELECT status FROM appointments WHERE id = $1',
      [apptId],
    );
    expect(rows[0].status).toBe('confirmed');
  });
});

/**
 * Avoir DISPONIBLE (remaining > 0) pour `email` — DOIT être en minuscules :
 * consume_credits compare LOWER(p_email) au patient_email stocké tel quel.
 * `createdAtISO` est écrit EXPLICITEMENT : la résolution de now() ne suffit
 * pas à ordonner deux avoirs insérés à la même seconde, or la consommation
 * FIFO dépend de created_at (ASC, id ASC).
 */
async function seedAvailableCredit(
  db: Pool,
  email: string,
  amount: number,
  remaining: number,
  createdAtISO: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO credits (patient_email, source_appointment_id, amount, remaining, reason, created_at)
     VALUES ($1, NULL, $2, $3, 'manual', $4::timestamptz)
     RETURNING id`,
    [email, amount, remaining, createdAtISO],
  );
  return rows[0].id;
}

describe.skipIf(unreachableReason !== null)('consume_credits contre PostgreSQL réel (008→020)', () => {
  const TEST_DB = `omf_consume_test_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let db: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: dbUrl('postgres') });
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    db = new Pool({ connectionString: dbUrl(TEST_DB) });
    for (const file of migrationFiles()) {
      await db.query(readFileSync(file, 'utf8'));
    }
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  // Miroir du helper du bloc ci-dessus. atOffsetDays DOIT être distinct par
  // test : le garde 015/018 lève scheduling_conflict si deux RDV actifs se
  // chevauchent (scheduled_at identique = chevauchement garanti).
  async function seedAppointment(overrides: { atOffsetDays?: number } = {}): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO appointments
        (patient_name, patient_email, patient_phone, patient_postal_code,
         patient_city, patient_reason, appointment_type, appointment_mode,
         duration, base_price, discount, final_price, scheduled_at, status,
         credit_applied)
       VALUES ('Patient Test', 'integration@test.example', '0600000000',
         '63000', 'Clermont-Ferrand', 'Séance de test intégration',
         'individual', 'video', 60, 6000, 0, 6000,
         now() + make_interval(days => $1::int), 'payment_received', 0)
       RETURNING id`,
      [overrides.atOffsetDays ?? 7],
    );
    return rows[0].id;
  }

  async function creditRemaining(creditId: string): Promise<number> {
    const { rows } = await db.query<{ remaining: number }>(
      `SELECT remaining FROM credits WHERE id = $1`,
      [creditId],
    );
    return rows[0]?.remaining ?? -1;
  }

  async function usageCount(appointmentId: string): Promise<number> {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM credit_usages WHERE appointment_id = $1`,
      [appointmentId],
    );
    return rows[0].n;
  }

  it('consomme une tranche simple : remaining décrémenté et usage journalisé sur le RDV', async () => {
    const email = 'consume.simple@test.example';
    const apptId = await seedAppointment({ atOffsetDays: 7 });
    const creditId = await seedAvailableCredit(db, email, 6000, 6000, '2026-01-01T10:00:00Z');

    const { rows } = await db.query<{ credit_id: string; amount: number }>(
      'SELECT * FROM public.consume_credits($1, $2, $3)',
      [email, 2500, apptId],
    );

    expect(rows).toEqual([{ credit_id: creditId, amount: 2500 }]);
    await expect(creditRemaining(creditId)).resolves.toBe(3500);
    await expect(usageCount(apptId)).resolves.toBe(1);
  });

  it('consomme en FIFO : le plus ancien dabord, tranches retournées dans lordre', async () => {
    const email = 'consume.fifo@test.example';
    const apptId = await seedAppointment({ atOffsetDays: 14 });
    // created_at EXPLICITES à 1 h d'écart : la résolution de now() ne suffit
    // pas à ordonner deux inserts de la même seconde.
    const olderId = await seedAvailableCredit(db, email, 4000, 4000, '2026-02-01T10:00:00Z');
    const newerId = await seedAvailableCredit(db, email, 5000, 5000, '2026-02-01T11:00:00Z');

    const { rows } = await db.query<{ credit_id: string; amount: number }>(
      'SELECT * FROM public.consume_credits($1, $2, $3)',
      [email, 6000, apptId],
    );

    expect(rows).toEqual([
      { credit_id: olderId, amount: 4000 },
      { credit_id: newerId, amount: 2000 },
    ]);
    await expect(creditRemaining(olderId)).resolves.toBe(0);
    await expect(creditRemaining(newerId)).resolves.toBe(3000);
  });

  it('solde insuffisant : CREDIT_INSUFFICIENT, remaining intact et aucun usage (échec fermé)', async () => {
    const email = 'consume.insufficient@test.example';
    const apptId = await seedAppointment({ atOffsetDays: 21 });
    const creditId = await seedAvailableCredit(db, email, 3000, 3000, '2026-03-01T10:00:00Z');

    // Message TEXT, pas errcode : 008/020 lèvent avec ERRCODE='check_violation'
    // (même convention que cancel_status_conflict ci-dessus).
    await expect(
      db.query('SELECT * FROM public.consume_credits($1, $2, $3)', [email, 3001, apptId]),
    ).rejects.toThrow(/CREDIT_INSUFFICIENT/);

    // Atomique : l'échec ne laisse AUCUNE trace partielle.
    await expect(creditRemaining(creditId)).resolves.toBe(3000);
    await expect(usageCount(apptId)).resolves.toBe(0);
  });

  it('plein contentieux : deux consommations concurrentes de tout le solde → un gagnant, un CREDIT_INSUFFICIENT', async () => {
    const email = 'consume.contention@test.example';
    const apptId = await seedAppointment({ atOffsetDays: 28 });
    const creditId = await seedAvailableCredit(db, email, 5000, 5000, '2026-04-01T10:00:00Z');

    const clientA = await db.connect();
    const clientB = await db.connect();
    const settled: PromiseSettledResult<unknown>[] = [];
    try {
      settled.push(
        ...(await Promise.allSettled([
          clientA.query('SELECT * FROM public.consume_credits($1, $2, $3)', [email, 5000, apptId]),
          clientB.query('SELECT * FROM public.consume_credits($1, $2, $3)', [email, 5000, apptId]),
        ])),
      );
    } finally {
      clientA.release();
      clientB.release();
    }

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' &&
        String((r as PromiseRejectedResult).reason).includes('CREDIT_INSUFFICIENT'),
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Le perdant ne doit rien avoir écrit : solde à 0 (pas négatif) et
    // exactement UNE tranche journalisée.
    await expect(creditRemaining(creditId)).resolves.toBe(0);
    await expect(usageCount(apptId)).resolves.toBe(1);
  });

  it('partage partiel : deux consommations concurrentes de 3000 → les deux aboutissent, 6000 journalisés', async () => {
    const email = 'consume.split@test.example';
    // RDV distincts par consommateur : la contrainte d'unicité
    // credit_usages(credit_id, appointment_id) interdirait sinon deux
    // tranches du même avoir pour un même RDV (artifact schéma, pas
    // concurrence).
    const apptA = await seedAppointment({ atOffsetDays: 35 });
    const apptB = await seedAppointment({ atOffsetDays: 42 });
    const creditId = await seedAvailableCredit(db, email, 6000, 6000, '2026-05-01T10:00:00Z');

    const clientA = await db.connect();
    const clientB = await db.connect();
    const settled: PromiseSettledResult<unknown>[] = [];
    try {
      settled.push(
        ...(await Promise.allSettled([
          clientA.query('SELECT * FROM public.consume_credits($1, $2, $3)', [email, 3000, apptA]),
          clientB.query('SELECT * FROM public.consume_credits($1, $2, $3)', [email, 3000, apptB]),
        ])),
      );
    } finally {
      clientA.release();
      clientB.release();
    }

    for (const r of settled) {
      expect(r.status).toBe('fulfilled');
    }
    const tranches = settled.flatMap(
      (r) =>
        r.status === 'fulfilled'
          ? (r.value as { rows: { credit_id: string; amount: number }[] }).rows
          : [],
    );
    expect(tranches).toEqual([
      { credit_id: creditId, amount: 3000 },
      { credit_id: creditId, amount: 3000 },
    ]);

    await expect(creditRemaining(creditId)).resolves.toBe(0);
    const { rows } = await db.query<{ n: number; total: number }>(
      `SELECT count(*)::int AS n, COALESCE(SUM(amount), 0)::int AS total
        FROM credit_usages WHERE appointment_id IN ($1, $2)`,
      [apptA, apptB],
    );
    expect(rows[0]).toMatchObject({ n: 2, total: 6000 });
  });
});
