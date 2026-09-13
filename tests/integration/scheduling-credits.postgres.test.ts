/**
 * Integration tests against a REAL PostgreSQL — revue #149 (finding todo
 * [vacuous-guard] on tests/unit/scheduling-migration.test.ts).
 *
 * The unit suite proves SQL shape (lock text before UPDATE text); these tests
 * prove BEHAVIOR: the migrations 000-local→019 are applied to a disposable
 * database and the financial invariants are exercised under real concurrency:
 *
 *   1. restore_credits under two concurrent calls restores exactly once
 *      (advisory-lock serialization, migration 018);
 *   2. restore_credits is idempotent sequentially;
 *   3. cancel_appointment_with_credits (migration 019) performs the CAS
 *      claim + credit restore + cash-credit issuance in one transaction;
 *   4. two concurrent cancels → exactly one winner, the loser raises
 *      cancel_status_conflict (the API maps it to 409);
 *   5. a stale expected status raises cancel_status_conflict.
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
