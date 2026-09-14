/**
 * Tests for GET /api/admin/appointments/ — the authenticated admin list the
 * `/poste-travail/` poller consumes (issue #165 / SC1).
 *
 * Contract under test:
 *   (a) Guard mirrors POST BEFORE any DB call: no session → 401
 *       {"error":"Non authentifié"}; non-admin → 403 {"error":"Accès refusé"}.
 *       Neither body may carry an `appointments` key (no data leak).
 *   (b) Success → 200 { appointments, fetchedAt } where every row's keys are
 *       EXACTLY the 24 APPOINTMENT_COLUMNS (id, therapist_notes and
 *       patient_reason included; nothing extra) and fetchedAt parses as a
 *       valid ISO 8601 date (the client-side monotonic marker, SC2a).
 *   (c) DB failure → 502 {"error":"Erreur lors de la récupération des
 *       rendez-vous"} — NEVER a 200 with a silent empty list (the poller must
 *       distinguish « liste vide légitime » from « erreur amont »).
 *   (d) Cache-Control: no-store on ALL FOUR paths (200/401/403/502) — an
 *       endpoint whose value is freshness must not be cacheable by any layer.
 *
 * Mock strategy mirrors tests/unit/admin-appointments-post.test.ts exactly
 * (hoisted `h` + vi.mock at the module boundaries). The GET fork flows through
 * the REAL @/lib/admin-appointments → @/lib/supabase leaf: unlike POST, the
 * helper awaits the `order()` builder directly as a PostgrestBuilder thenable,
 * so the mock chain resolves `then` with { data: rows, error: null } → 200 or
 * { data: null, error } → 502 (see `setQueryResult`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted shared state (mock factories need it at hoist time) ------------

const h = vi.hoisted(() => {
  /**
   * Factory: chainable supabaseAdmin mock for the GET path. `setQueryResult`
   * decides what the awaited `order()` thenable resolves — success rows (200)
   * or a Postgrest error (502).
   */
  const makeSupabaseMock = () => {
    interface QueryResult {
      data: unknown;
      error: unknown;
    }
    const chain = {
      select: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(() =>
        Promise.resolve<QueryResult>({ data: [], error: null }),
      ),
    };
    const setQueryResult = (result: QueryResult): void => {
      chain.order.mockReturnValue(Promise.resolve(result));
    };
    return {
      supabaseAdmin: { from: vi.fn((_table: string) => chain) },
      chain,
      setQueryResult,
    };
  };

  return {
    makeSupabaseMock,
    sb: makeSupabaseMock(),
    getSession: vi.fn(),
    isAdminSession: vi.fn(() => true),
  };
});

// --- Mocks (hoisted before importing the handler) ---------------------------

// Indirection: `h.sb` is swapped per-test in beforeEach, so resolve at call time.
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => h.sb.supabaseAdmin.from(table) },
}));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: unknown[]) => h.getSession(...a) } },
}));
vi.mock('@/lib/authz', () => ({
  isAdminSession: (...a: unknown[]) => h.isAdminSession(...a),
}));
vi.mock('@/lib/pricing', () => ({
  calculatePrice: vi.fn(() => ({ basePrice: 60, discount: 0, finalPrice: 60 })),
}));
vi.mock('@/lib/credits', () => ({
  getAvailableCredit: vi.fn().mockResolvedValue(0),
  consumeCredits: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/resend', () => ({
  sendEmail: vi.fn(),
  buildAppointmentConversationSubject: vi.fn((base: string) => base),
}));
vi.mock('@/lib/stripe', () => ({
  createAppointmentPaymentLink: vi.fn(),
}));
vi.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: vi.fn(),
}));
vi.mock('@/lib/appointment-conflicts', () => ({
  hasAppointmentConflict: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/appointment-eligibility', () => ({
  isCabinetEligibleSlot: vi.fn().mockResolvedValue(true),
}));
// The source imports with an explicit `.js` extension — mock BOTH specifiers.
vi.mock('@/lib/calendar-cache', () => ({
  invalidateAvailabilityCache: vi.fn(),
}));
vi.mock('@/lib/calendar-cache.js', () => ({
  invalidateAvailabilityCache: vi.fn(),
}));
vi.mock('@/lib/secure-links', () => ({
  createSecureLinkToken: vi.fn(() => 'tok_mock'),
}));
vi.mock('@/lib/ics', () => ({
  generateGoogleCalendarLink: vi.fn(() => 'https://cal.example/g'),
  generateOutlookCalendarLink: vi.fn(() => 'https://cal.example/o'),
  generateAppleCalendarInviteLink: vi.fn(() => 'https://cal.example/a'),
  CABINET_ADDRESS: '1 rue du Cabinet, 75000 Paris',
}));
vi.mock('@/emails/AppointmentConfirmed', () => ({ default: () => null }));
vi.mock('@/emails/PaymentRequest', () => ({ default: () => null }));

// --- Import the handler AFTER mocks ------------------------------------------
// The GET fork flows through the REAL fetchActiveAppointments (only the
// supabase leaf above is faked) — APPOINTMENT_COLUMNS is imported from it to
// build the literal-vs-constant column oracle.

import { GET } from '@/pages/api/admin/appointments';
import { APPOINTMENT_COLUMNS } from '@/lib/admin-appointments';

// --- Fixtures ----------------------------------------------------------------

const SCHEDULED_AT = new Date(Date.now() + 86_400_000).toISOString();

/**
 * A row carrying EXACTLY the 24 SSR columns — written out LITERALLY so the
 * response key-set assertion is a real literal-vs-APPOINTMENT_COLUMNS
 * comparison (spec SC1 : « pas une de plus ni une de moins »), not a
 * self-fulfilling derivation.
 */
function makeRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'appt_test_001',
    status: 'pending',
    scheduled_at: SCHEDULED_AT,
    rescheduled_to: null,
    appointment_type: 'individual',
    appointment_mode: 'video',
    duration: 60,
    base_price: 6000,
    discount: 0,
    final_price: 6000,
    is_first_session: false,
    patient_name: 'Jeanne Dupont',
    patient_email: 'jeanne.dupont@example.com',
    patient_phone: '0612345678',
    patient_postal_code: '69006',
    patient_city: 'Lyon',
    patient_reason: 'Suivi',
    therapist_notes: null,
    video_link: null,
    google_calendar_event_id: null,
    stripe_payment_link_url: null,
    stripe_payment_link_id: null,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

// --- Helpers -----------------------------------------------------------------

function makeRequest(): Request {
  return new Request('http://localhost/api/admin/appointments/', {
    method: 'GET',
  });
}

/** GET reads only `{ request }` — no Netlify decorator needed. */
function makeContext(request: Request): Record<string, unknown> {
  return { request, url: request.url };
}

/** Every path (200 included) must answer JSON and be uncacheable (SC1). */
function assertNoStoreJson(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Content-Type')).toBe('application/json');
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sb = h.makeSupabaseMock();
  h.getSession.mockResolvedValue({
    user: { id: 'admin_001', email: 'pro@omf-therapie.fr' },
  });
  h.isAdminSession.mockReturnValue(true);
  h.sb.setQueryResult({ data: [makeRow()], error: null });
});

// ---------------------------------------------------------------------------
// (a) Auth guard — miroir exact du guard POST, AVANT tout appel DB
// ---------------------------------------------------------------------------
describe('GET /api/admin/appointments/ — liste admin authentifiée (issue #165, SC1)', () => {
  // Safety net: a test that installs a console.error spy but throws before
  // its inline mockRestore must not leak the spy into the next test.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 {"error":"Non authentifié"} with no-store, NO appointments key, and ZERO DB call when there is no session', async () => {
    // Arrange — session absente/expirée.
    h.getSession.mockResolvedValue(null);

    // Act
    const response = await GET(makeContext(makeRequest()) as never);
    const body = await readJson(response);

    // Assert — status + typed body (toEqual asserts the WHOLE body: no
    // `appointments` key can hide in it — no data leak), uncacheable, and the
    // guard fired BEFORE the query was built.
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Non authentifié' });
    assertNoStoreJson(response);
    expect(h.sb.supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('returns 403 {"error":"Accès refusé"} with no-store and ZERO DB call for a non-admin session', async () => {
    // Arrange — session authentifiée mais non admin.
    h.isAdminSession.mockReturnValue(false);

    // Act
    const response = await GET(makeContext(makeRequest()) as never);
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Accès refusé' });
    assertNoStoreJson(response);
    expect(h.sb.supabaseAdmin.from).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (b) 200 admin — clés de chaque ligne == colonnes SSR littérales (+fetchedAt ISO)
  // -------------------------------------------------------------------------
  it('returns 200 whose rows carry EXACTLY the 24 SSR columns and a valid ISO fetchedAt for an admin session', async () => {
    // Arrange — two rows so « les clés de CHAQUE ligne » is really asserted.
    h.sb.setQueryResult({
      data: [makeRow({ id: 'appt_a' }), makeRow({ id: 'appt_b' })],
      error: null,
    });

    // Act
    const response = await GET(makeContext(makeRequest()) as never);
    const body = await readJson(response);

    // Assert — status + envelope present.
    expect(response.status).toBe(200);
    const rows = body.appointments as Record<string, unknown>[];
    expect(Array.isArray(rows)).toBe(true);

    // The literal 24-key set, compared against the shared APPOINTMENT_COLUMNS
    // constant — sorted deep-equal fails on ANY extra or missing key.
    const expectedKeys = [...APPOINTMENT_COLUMNS.split(',')].sort();
    expect(expectedKeys).toHaveLength(24);
    expect(expectedKeys).toContain('id');
    expect(expectedKeys).toContain('therapist_notes');
    expect(expectedKeys).toContain('patient_reason');
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(expectedKeys);
    }

    // fetchedAt — ISO 8601 server stamp (the client-side monotonic marker).
    expect(typeof body.fetchedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.fetchedAt as string))).toBe(false);

    // The shared loader queried the exact SSR column list, excluded
    // soft-deleted rows and sorted most-recent-first (parity /mes-rdvs).
    expect(h.sb.chain.select).toHaveBeenCalledTimes(1);
    expect(h.sb.chain.select).toHaveBeenCalledWith(APPOINTMENT_COLUMNS);
    expect(h.sb.chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(h.sb.chain.order).toHaveBeenCalledWith('scheduled_at', {
      ascending: false,
    });
  });

  // -------------------------------------------------------------------------
  // (c) DB error → 502 typé — JAMAIS 200 avec une liste vide silencieuse
  // -------------------------------------------------------------------------
  it('returns 502 {"error":"Erreur lors de la récupération des rendez-vous"} — never 200 with a silent empty list — when the DB read fails', async () => {
    // Arrange — the awaited order() thenable resolves a Postgrest error.
    h.sb.setQueryResult({
      data: null,
      error: { message: 'connection reset by peer' },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    const response = await GET(makeContext(makeRequest()) as never);
    const body = await readJson(response);

    // Assert — typed 502 body with NO appointments key (the poller must
    // distinguish « liste vide légitime » from « erreur amont »), uncacheable,
    // and the failure is logged server-side.
    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: 'Erreur lors de la récupération des rendez-vous',
    });
    assertNoStoreJson(response);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[admin/appointments] Erreur fetch rendez-vous :',
      ),
      // The structured Supabase error is logged WHOLE (message + code/details/
      // hint when present) — not flattened to error.message.
      { message: 'connection reset by peer' },
    );
    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // (d) Cache-Control: no-store sur les QUATRE chemins (200/401/403/502)
  // -------------------------------------------------------------------------
  it('sends Cache-Control: no-store on ALL four paths — 200, 401, 403 and 502', async () => {
    // 1. 200 — succès.
    let response = await GET(makeContext(makeRequest()) as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    // 2. 401 — session absente.
    h.getSession.mockResolvedValue(null);
    response = await GET(makeContext(makeRequest()) as never);
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    // 3. 403 — session non admin.
    h.getSession.mockResolvedValue({
      user: { id: 'user_001', email: 'patient@example.com' },
    });
    h.isAdminSession.mockReturnValue(false);
    response = await GET(makeContext(makeRequest()) as never);
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    // 4. 502 — erreur amont DB.
    h.getSession.mockResolvedValue({
      user: { id: 'admin_001', email: 'pro@omf-therapie.fr' },
    });
    h.isAdminSession.mockReturnValue(true);
    h.sb.setQueryResult({
      data: null,
      error: { message: 'db unavailable' },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    response = await GET(makeContext(makeRequest()) as never);
    errorSpy.mockRestore();
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  // -------------------------------------------------------------------------
  // (b-bis) Enveloppe { appointments, fetchedAt } — contrat consommé par le poller
  // -------------------------------------------------------------------------
  it('wraps the rows in the { appointments, fetchedAt } envelope with fetchedAt alongside appointments', async () => {
    // Arrange — default beforeEach seeding (one literal fixture row).

    // Act
    const response = await GET(makeContext(makeRequest()) as never);
    const body = await readJson(response);

    // Assert — EXACT envelope: both keys, nothing more (the poller keys on
    // fetchedAt; a renamed/extra key would silently break SC2a monotony).
    expect(Object.keys(body).sort()).toEqual(['appointments', 'fetchedAt']);
    expect(Array.isArray(body.appointments)).toBe(true);
    expect(typeof body.fetchedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.fetchedAt as string))).toBe(false);
    // Pass-through fidelity: the rows reach the client untouched.
    expect(body.appointments).toEqual([makeRow()]);
  });
});
