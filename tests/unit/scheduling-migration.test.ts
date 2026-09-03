import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static guard assertions over migration SQL (review fix F12). Every guard is
// pinned by identifier and statement context — the advisory lock must appear
// inside the body of the function that enforces conflicts, each trigger is
// matched by name/timing/target/function, and the partial unique index is
// matched as one statement including its predicate. Deleting any of those
// guards must turn this file red; loose `includes` greps stayed green.

function readMigration(fileName: string): string {
  return readFileSync(
    resolve(process.cwd(), 'supabase/migrations', fileName),
    'utf8',
  );
}

// Collapse whitespace runs to single spaces so assertions survive SQL
// reformatting while still anchoring on token order, not raw substrings.
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

// Build a regex from a SQL snippet: regex metacharacters are escaped and each
// whitespace run matches any layout, so only the tokens carry meaning.
function sqlPattern(sqlSnippet: string): RegExp {
  return new RegExp(
    sqlSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
  );
}

// Extract the $$ ... $$ body of one CREATE [OR REPLACE] FUNCTION so
// assertions target that function instead of matching anywhere in the file.
function extractFunctionBody(sql: string, functionName: string): string {
  const match = sql.match(
    new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION public\\.${functionName}\\s*\\([^)]*\\)[\\s\\S]*?AS\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;`,
    ),
  );
  expect(
    match,
    `public.${functionName}() must remain defined in the migration`,
  ).toBeTruthy();
  return normalizeSql(match?.[1] ?? '');
}

const migration015 = readMigration('015_scheduling_settings.sql');
const migration016 = readMigration('016_manual_time_slot_uniqueness.sql');
const migration018 = readMigration('018_scheduling_fail_closed.sql');

const advisoryLockStatement = `PERFORM pg_advisory_xact_lock(hashtext('omf-therapie:appointment-schedule'));`;

describe('015 scheduling settings migration', () => {
  const sql = normalizeSql(migration015);

  describe('advisory lock serialization', () => {
    it('runs the transaction-scoped advisory lock inside the conflict-enforcing trigger function', () => {
      const body = extractFunctionBody(
        migration015,
        'appointments_enforce_schedule_conflict',
      );

      expect(body).toMatch(sqlPattern(advisoryLockStatement));
    });

    it('takes the same advisory lock before revalidating appointments on a buffer change', () => {
      const body = extractFunctionBody(migration015, 'set_scheduling_buffer');

      expect(body).toMatch(sqlPattern(advisoryLockStatement));
    });
  });

  describe('trigger wiring', () => {
    it('creates the scheduling-policy trigger BEFORE insert/update of scheduled_at and duration', () => {
      expect(sql).toMatch(
        sqlPattern(`CREATE TRIGGER appointments_apply_scheduling_policy
          BEFORE INSERT OR UPDATE OF scheduled_at, duration ON public.appointments
          FOR EACH ROW EXECUTE FUNCTION public.appointments_apply_scheduling_policy();`),
      );
    });

    it('creates the conflict trigger BEFORE insert/update of every scheduling column', () => {
      expect(sql).toMatch(
        sqlPattern(`CREATE TRIGGER appointments_enforce_schedule_conflict
          BEFORE INSERT OR UPDATE OF scheduled_at, duration, status, rescheduled_to, deleted_at
          ON public.appointments
          FOR EACH ROW EXECUTE FUNCTION public.appointments_enforce_schedule_conflict();`),
      );
    });
  });

  describe('conflict check inside the enforce function', () => {
    it('checks blocking statuses and the blocked-interval overlap, then raises scheduling_conflict', () => {
      const body = extractFunctionBody(
        migration015,
        'appointments_enforce_schedule_conflict',
      );

      expect(body).toMatch(
        sqlPattern(`blocking_statuses TEXT[] := ARRAY[
          'pending', 'confirmed', 'payment_pending', 'payment_received', 'rescheduled'
        ];`),
      );
      expect(body).toMatch(
        sqlPattern(`existing.status = ANY (blocking_statuses)
          AND existing.scheduled_at < NEW.blocked_until
          AND existing.blocked_until > NEW.scheduled_at`),
      );
      expect(body).toMatch(sqlPattern(`RAISE EXCEPTION 'scheduling_conflict'`));
    });

    it('also rejects overlaps with pending reschedule proposals', () => {
      const body = extractFunctionBody(
        migration015,
        'appointments_enforce_schedule_conflict',
      );

      expect(body).toMatch(
        sqlPattern(`proposal.rescheduled_to < NEW.blocked_until`),
      );
    });
  });

  describe('buffer change only revalidates future appointments', () => {
    it('excludes historical appointments from settings conflicts and bound refreshes', () => {
      expect(sql).toMatch(
        sqlPattern(`scheduled_at + duration * interval '1 minute'
          + new_buffer_minutes * interval '1 minute' > now()`),
      );
      expect(sql).toMatch(
        sqlPattern(`rescheduled_to + duration * interval '1 minute'
          + new_buffer_minutes * interval '1 minute' > now()`),
      );
      expect(sql).toMatch(
        sqlPattern(`UPDATE public.appointments
          SET blocked_until = scheduled_at + duration * interval '1 minute'
          + new_buffer_minutes * interval '1 minute'
          WHERE scheduled_at + duration * interval '1 minute'
          + new_buffer_minutes * interval '1 minute' > now()`),
      );
    });
  });
});

describe('016 manual time slot uniqueness migration', () => {
  it('enforces one active presence per (slot_date, period) via a partial unique index', () => {
    const sql = normalizeSql(migration016);

    // The WHERE deleted_at IS NULL predicate must belong to the index
    // statement itself: a plain toContain would also match the archiving CTE.
    expect(sql).toMatch(
      sqlPattern(`CREATE UNIQUE INDEX IF NOT EXISTS manual_time_slots_active_date_period_unique
        ON public.manual_time_slots (slot_date, period)
        WHERE deleted_at IS NULL;`),
    );
  });
});

describe('018 scheduling fail-closed migration', () => {
  const sql = normalizeSql(migration018);

  describe('fail-closed conflict guard', () => {
    it('raises scheduling_guard_violation after the lock and the early return, before the first EXISTS check', () => {
      const body = extractFunctionBody(
        migration018,
        'appointments_enforce_schedule_conflict',
      );

      expect(body).toMatch(
        sqlPattern(
          `DETAIL = 'blocked_until is NULL when the conflict guard runs; appointments_apply_scheduling_policy must fire first (alphabetical trigger order).'`,
        ),
      );

      // Ordering, not just presence: the guard must sit between the early
      // return and the first overlap check to fail closed on trigger inversion.
      const lockIndex = body.search(sqlPattern(advisoryLockStatement));
      const earlyReturnIndex = body.search(
        sqlPattern(`IF NOT (NEW.status = ANY (blocking_statuses)) OR NEW.deleted_at IS NOT NULL THEN
          RETURN NEW;
        END IF;`),
      );
      const guardIndex = body.search(
        sqlPattern(`IF NEW.blocked_until IS NULL THEN
          RAISE EXCEPTION 'scheduling_guard_violation'`),
      );
      const firstExistsIndex = body.search(sqlPattern(`IF EXISTS (`));

      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(earlyReturnIndex).toBeGreaterThanOrEqual(0);
      expect(guardIndex).toBeGreaterThanOrEqual(0);
      expect(firstExistsIndex).toBeGreaterThanOrEqual(0);
      expect(lockIndex).toBeLessThan(guardIndex);
      expect(earlyReturnIndex).toBeLessThan(guardIndex);
      expect(guardIndex).toBeLessThan(firstExistsIndex);
    });

    it('wraps the proposal-branch buffer call in COALESCE so a NULL buffer cannot disable the check', () => {
      const body = extractFunctionBody(
        migration018,
        'appointments_enforce_schedule_conflict',
      );

      expect(body).toMatch(
        sqlPattern(`proposal.rescheduled_to
          + proposal.duration * interval '1 minute'
          + COALESCE(public.scheduling_buffer_minutes(), 0) * interval '1 minute'
          > NEW.scheduled_at`),
      );
    });

    it('keeps the original 015 guards intact in the re-declared body', () => {
      const body = extractFunctionBody(
        migration018,
        'appointments_enforce_schedule_conflict',
      );

      expect(body).toMatch(
        sqlPattern(`blocking_statuses TEXT[] := ARRAY[
          'pending', 'confirmed', 'payment_pending', 'payment_received', 'rescheduled'
        ];`),
      );
      expect(body).toMatch(
        sqlPattern(`existing.scheduled_at < NEW.blocked_until
          AND existing.blocked_until > NEW.scheduled_at`),
      );
      expect(body).toMatch(sqlPattern(`RAISE EXCEPTION 'scheduling_conflict'`));
    });
  });

  describe('serialized credit restore', () => {
    it('takes the per-appointment advisory lock before the credits UPDATE', () => {
      const body = extractFunctionBody(migration018, 'restore_credits');

      const lockIndex = body.search(
        sqlPattern(
          `PERFORM pg_advisory_xact_lock(hashtext('omf-therapie:credits:' || p_appointment_id::TEXT));`,
        ),
      );
      const updateIndex = body.search(
        sqlPattern(
          `UPDATE credits c SET remaining = c.remaining + cu.consumed`,
        ),
      );

      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(updateIndex).toBeGreaterThanOrEqual(0);
      expect(lockIndex).toBeLessThan(updateIndex);
    });
  });

  describe('append-only migration shape', () => {
    it('replaces functions without creating, altering or dropping triggers', () => {
      expect(sql).not.toMatch(/\bCREATE\s+TRIGGER\b/i);
      expect(sql).not.toMatch(/\bALTER\s+TRIGGER\b/i);
      expect(sql).not.toMatch(/\bDROP\s+TRIGGER\b/i);
    });

    it('keeps restore_credits executable only by service_role', () => {
      expect(sql).toMatch(
        sqlPattern(`REVOKE ALL ON FUNCTION restore_credits(UUID) FROM PUBLIC;`),
      );
      expect(sql).toMatch(
        sqlPattern(
          `GRANT EXECUTE ON FUNCTION restore_credits(UUID) TO service_role;`,
        ),
      );
    });
  });
});
