import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Appointment } from '../src/types/appointment';

// ────────────────────────────────────────────────────────────
// E2E Tests — Poste de travail : rafraîchissement automatique (issue #165)
//
// Covers the SC5 "non-intrusion" UI oracles of the spec
// (artifacts/specs/165-poste-travail-auto-refresh-spec.md):
//   1. unsaved notes survive a poll returning MODIFIED data;
//   2. an open appointment that vanishes from the payload closes the detail;
//   3. the open detail stays open on the same appointment across a poll
//      with changed data.
// (The 4th SC5 oracle — creation drawer open → 0 fetch — is assigned to the
// pure poller unit tests, tests/unit/appointment-poller.test.ts.)
//
// Prerequisites (same as manual-slots.spec.ts): a running dev server on
// :4321 (npx playwright test starts it via webServer), local PostgreSQL
// (`npm run db:start`) and a seeded admin account (`npx tsx
// scripts/seed-admin.ts`, or PLAYWRIGHT_ADMIN_EMAIL /
// PLAYWRIGHT_ADMIN_PASSWORD). Without them the login fails and the tests
// are skipped with an explicit reason — CI never runs Playwright
// (gates are lint → test → build).
//
// How the poll is forced without waiting 30 s: GET /api/admin/appointments/
// is intercepted with page.route — this also lets each test deliver a
// MODIFIED (or amputated) payload without writing to the database. The
// immediate refetch is triggered by replaying the DOM `visibilitychange`
// event (tab back in the foreground, SC3) — the production code path, no
// test seam added to product code.
// ────────────────────────────────────────────────────────────

/** Server envelope of GET /api/admin/appointments/ (spec 165). */
interface AppointmentsPayload {
  appointments: Appointment[];
  fetchedAt: string;
}

/**
 * Full Appointment fixture (1:1 with the DB table shape the endpoint
 * serializes). Timestamps are computed per call, so two fixtures are never
 * deep-equal — a payload swap is always detected as "changed" by the
 * hook's isDeepEqual guard (deterministic, no 30 s wait).
 */
function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const now = Date.now();
  return {
    id: 'e2e-165-marie',
    patient_name: 'Marie Dupont',
    patient_email: 'marie.dupont@exemple.fr',
    patient_phone: '06 12 34 56 78',
    patient_postal_code: '34000',
    patient_city: 'Montpellier',
    patient_reason: 'Première consultation',
    appointment_type: 'individual',
    appointment_mode: 'in-person',
    duration: 60,
    is_first_session: true,
    base_price: 6000,
    discount: 0,
    final_price: 6000,
    credit_applied: 0,
    scheduled_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    stripe_payment_link_id: null,
    stripe_payment_link_url: null,
    stripe_payment_intent_id: null,
    confirmation_sent_at: null,
    invitation_sent_at: null,
    video_link: null,
    google_calendar_event_id: null,
    therapist_notes: null,
    rescheduled_to: null,
    created_at: new Date(now - 60 * 60 * 1000).toISOString(),
    updated_at: new Date(now - 60 * 60 * 1000).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

/** Paul — the "other" row used as poll-applied evidence and replacement data. */
function makePaulAppointment(): Appointment {
  return makeAppointment({
    id: 'e2e-165-paul',
    patient_name: 'Paul Martin',
    patient_email: 'paul.martin@exemple.fr',
  });
}

/**
 * Intercepts the poll endpoint and serves `getPayload()` on every GET.
 * `fetchedAt` is stamped per response — strictly increasing, satisfying the
 * poller's monotonic snapshot guard (SC2a). Non-GET requests (e.g. POST
 * creation) fall through to the real handler.
 */
async function mockAppointmentsEndpoint(
  page: Page,
  getPayload: () => AppointmentsPayload,
): Promise<void> {
  await page.route('**/api/admin/appointments/', route => {
    if (route.request().method() !== 'GET') {
      void route.fallback();
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(getPayload()),
    });
  });
}

/**
 * Forces an immediate poll instead of waiting 30 s: the hook refetches right
 * away when the tab "returns to the foreground" (SC3) and the page is
 * visible in the Playwright browser, so dispatching the same DOM event the
 * hook listens to exercises the production path.
 */
function triggerPoll(page: Page): Promise<void> {
  return page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const NO_RELOAD_MARKER = '__e2e_no_reload_marker__';

/**
 * Arms the reload detector: a full page reload creates a fresh `window`
 * (marker gone), while an in-place React update keeps it. Every oracle must
 * prove the refresh landed WITHOUT a navigation.
 */
async function armNoReloadDetector(page: Page): Promise<void> {
  await page.evaluate(key => {
    Reflect.set(window, key, true);
  }, NO_RELOAD_MARKER);
}

async function expectNoReload(page: Page): Promise<void> {
  const marker: unknown = await page.evaluate(
    key => Reflect.get(window, key),
    NO_RELOAD_MARKER,
  );
  expect(
    marker,
    'window marker wiped — a full page reload happened where the update had to land in place',
  ).toBe(true);
}

/**
 * Helper: Login as admin through the UI flow.
 * Same idiom as manual-slots.spec.ts — env vars in CI, defaults for local dev.
 */
async function loginAsAdmin(page: Page) {
  await page.goto('/login/');

  // Wait for the auth form to load (SSR page with client-side hydration)
  await page.waitForLoadState('networkidle');

  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'admin@omf-therapie.fr';
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD || 'admin-password';

  const emailInput = page
    .locator('input[type="email"], input[name="email"]')
    .first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitButton = page
    .locator('button[type="submit"], button:has-text("Se connecter")')
    .first();

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await submitButton.click();

  await page.waitForURL(/\/(mes-rdvs|login)/, { timeout: 10000 });

  const currentUrl = page.url();
  if (!currentUrl.includes('/mes-rdvs')) {
    throw new Error(
      `Login failed - expected redirect to /mes-rdvs, got ${currentUrl}`,
    );
  }
}

/**
 * Opens /poste-travail/ and the detail of the Marie fixture.
 * Returns the detail pane locator (right-hand split-view panel, ≥ lg).
 */
async function openAppointmentDetail(page: Page): Promise<Locator> {
  await page.goto('/poste-travail/');

  // The freshness indicator only renders after the first successful poll —
  // a reliable "island hydrated + initial snapshot applied" gate before
  // interacting with the React island.
  await expect(page.getByText(/Mis à jour à \d{2}[:h]\d{2}/)).toBeVisible();

  // Switch to the Rendez-vous section (sidebar, ≥ lg viewport).
  await page
    .locator('aside[aria-label="Poste de travail"]')
    .getByRole('button', { name: 'Rendez-vous', exact: true })
    .click();

  const row = page.getByRole('button', { name: /Détails : Marie Dupont/ });
  await expect(row).toBeVisible();
  await row.click();

  const detailPane = page.locator(
    'aside[aria-label="Fiche du rendez-vous sélectionné"]',
  );
  await expect(
    detailPane.getByRole('article', {
      name: /Détail du rendez-vous de Marie Dupont/,
    }),
  ).toBeVisible();
  return detailPane;
}

test.describe('Poste de travail — auto-refresh (issue #165, SC5 non-intrusion)', () => {
  test.beforeEach(async ({ page }) => {
    try {
      await loginAsAdmin(page);
    } catch {
      // No dev DB / admin seed available: the whole suite is meaningless —
      // skip with an explicit reason instead of a misleading failure.
      test.skip(
        true,
        'Prérequis e2e absents : serveur de dev + PostgreSQL + compte admin (scripts/seed-admin.ts)',
      );
    }
  });

  test('les notes non enregistrées survivent à un poll à données modifiées', async ({
    page,
  }) => {
    let payload: Appointment[] = [makeAppointment()];
    await mockAppointmentsEndpoint(page, () => ({
      appointments: payload,
      fetchedAt: new Date().toISOString(),
    }));

    const detailPane = await openAppointmentDetail(page);
    const notes = detailPane.getByLabel('Notes internes de consultation');

    const unsavedText = 'Recontacter Marie jeudi — piste sommeil à explorer.';
    await notes.fill(unsavedText);
    await expect(notes).toHaveValue(unsavedText);
    await expect(notes).toBeFocused();

    // Next poll returns MODIFIED data: status change on the OPEN appointment
    // plus a brand-new row — exactly the case where re-deriving local state
    // from props would wipe the typing (spec SC5, priced oracle).
    payload = [makeAppointment({ status: 'confirmed' }), makePaulAppointment()];

    await armNoReloadDetector(page);
    await triggerPoll(page);

    // Prove the MODIFIED payload was applied BEFORE asserting survival —
    // otherwise the test would pass vacuously (poll not yet landed).
    await expect(
      detailPane.getByText('Confirmé', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Détails : Paul Martin/ }),
    ).toBeVisible();

    // Oracle: the unsaved text AND the focus survived the in-place refresh.
    await expect(notes).toHaveValue(unsavedText);
    await expect(notes).toBeFocused();
    await expectNoReload(page);
  });

  test('le RDV ouvert qui disparaît du payload ferme le détail', async ({
    page,
  }) => {
    let payload: Appointment[] = [makeAppointment()];
    await mockAppointmentsEndpoint(page, () => ({
      appointments: payload,
      fetchedAt: new Date().toISOString(),
    }));

    const detailPane = await openAppointmentDetail(page);

    // Soft-delete elsewhere: the next payload no longer contains the open RDV.
    payload = [makePaulAppointment()];

    await armNoReloadDetector(page);
    await triggerPoll(page);

    // Poll applied: Marie's row is gone, Paul's arrived.
    await expect(
      page.getByRole('button', { name: /Détails : Paul Martin/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Détails : Marie Dupont/ }),
    ).toHaveCount(0);

    // Oracle: the detail is explicitly CLOSED — both the pane and the mobile
    // sheet instances are unmounted, back to the list placeholder, and not
    // via a silent full-page reload destroying the input.
    await expect(
      page.getByRole('article', {
        name: /Détail du rendez-vous de Marie Dupont/,
      }),
    ).toHaveCount(0);
    await expect(
      detailPane.getByText(
        'Sélectionnez un rendez-vous pour afficher sa fiche.',
      ),
    ).toBeVisible();
    await expectNoReload(page);
  });

  test('le détail reste ouvert sur le même RDV quand les données changent', async ({
    page,
  }) => {
    let payload: Appointment[] = [makeAppointment()];
    await mockAppointmentsEndpoint(page, () => ({
      appointments: payload,
      fetchedAt: new Date().toISOString(),
    }));

    const detailPane = await openAppointmentDetail(page);
    await expect(
      detailPane.getByText('En attente', { exact: true }),
    ).toBeVisible();

    // The poll returns changed data for the SAME appointment id (status
    // pending → confirmed): same React key, so the detail must survive.
    payload = [makeAppointment({ status: 'confirmed' })];

    await armNoReloadDetector(page);
    await triggerPoll(page);

    // Oracle: the detail is still open, now showing the updated field.
    await expect(
      detailPane.getByRole('article', {
        name: /Détail du rendez-vous de Marie Dupont/,
      }),
    ).toBeVisible();
    await expect(
      detailPane.getByText('Confirmé', { exact: true }),
    ).toBeVisible();
    await expect(
      detailPane.getByText('En attente', { exact: true }),
    ).toHaveCount(0);
    await expectNoReload(page);
  });
});
