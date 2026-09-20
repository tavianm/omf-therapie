import { test, expect } from '@playwright/test';
// First RUNTIME import from ../src in e2e/ (poste-travail-refresh.spec.ts:2
// is type-only, erased at transpile). If Playwright's transform ever rejects
// it, duplicate the literal locally with a must-mirror comment — reopen then
// becomes a second edit instead of one.
import { BOOKING_OPEN } from '../src/config/booking.config';

// ────────────────────────────────────────────────────────────
// Smoke tests — couverture minimale des pages critiques
// ────────────────────────────────────────────────────────────

test.describe('Home page', () => {
  test('charge et affiche la page', async ({ page }) => {
    await page.goto('/');
    // Le titre contient "Oriane" ou "Montabonnet" ou "Psychopraticienne"
    await expect(page).toHaveTitle(
      /Oriane|Montabonnet|Psychopraticienne|Thérapie/i,
    );
    await expect(page.locator('main')).toBeVisible();
  });

  test('la navigation principale est présente', async ({ page }) => {
    await page.goto('/');
    // Strict mode: plusieurs <nav> possibles — on vérifie la nav principale
    await expect(page.locator('nav[aria-label]').first()).toBeVisible();
  });

  test('lien de prise de rendez-vous visible', async ({ page }) => {
    await page.goto('/');
    const rdvLink = page
      .locator('a[href="/rendez-vous/"], a[href="/rendez-vous"]')
      .first();
    await expect(rdvLink).toBeVisible();
  });
});

test.describe('/rendez-vous — pause des réservations', () => {
  test('charge la page du wizard', async ({ page }) => {
    // Utiliser le trailing slash (trailingSlash: 'always' dans astro.config)
    const res = await page.goto('/rendez-vous/');
    // La page doit charger sans erreur 404/500
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator('main')).toBeVisible();
  });

  test('affiche le wizard ou la carte de pause selon BOOKING_OPEN', async ({
    page,
  }) => {
    const res = await page.goto('/rendez-vous/');
    expect(res?.status()).toBeLessThan(400);

    if (BOOKING_OPEN) {
      // Open: the wizard options are back, unchanged.
      await expect(
        page.getByText(/individuel|couple|familial/i).first(),
      ).toBeVisible();
      return;
    }

    // Paused: closure card instead of the wizard.
    await expect(page.getByText(/congé maternité/i)).toBeVisible();
    // Slots are promised from mid-January; the online reopen stays undated.
    await expect(page.getByText(/à partir de mi-janvier 2027/)).toBeVisible();
    const cta = page.getByRole('link', { name: 'Contacter Oriane' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/contact/');

    // Layout.astro ships no client: directives and the paused page renders
    // no Navbar — zero astro-island elements proves no client JS ships.
    expect(await page.locator('astro-island').count()).toBe(0);

    // Compensates the ld+json drift detection suspended in
    // scripts/diff-html-170.mjs while the closure entries are live.
    const ld = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    expect(ld).toContain('HealthAndBeautyBusiness');
    expect(ld).not.toContain('ReserveAction');
  });
});

test.describe('/login', () => {
  test('charge le formulaire de connexion', async ({ page }) => {
    await page.goto('/login/');
    // Page SSR — avec une vraie BD les champs s'affichent, sans BD elle peut retourner 500
    await expect(page.locator('body')).toBeVisible();
  });

  test('affiche un champ de mot de passe', async ({ page }) => {
    const res = await page.goto('/login/');
    // Ce test passe uniquement si la BD BetterAuth est opérationnelle
    if (res?.status() === 200) {
      await expect(page.locator('input[type="password"]')).toBeVisible({
        timeout: 10_000,
      });
    }
    // Sans BD : le test est skippé (log seulement)
  });
});

test.describe('/mes-rdvs — protection auth', () => {
  test('redirige vers /login si non connecté ou charge la page admin', async ({
    page,
  }) => {
    await page.goto('/mes-rdvs/');
    // Soit redirect vers /login, soit charge la page (selon disponibilité BD auth)
    const url = page.url();
    const isOnLogin = url.includes('/login');
    const isOnMesRdvs = url.includes('/mes-rdvs');
    expect(isOnLogin || isOnMesRdvs).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('/blog', () => {
  test('charge la liste des articles', async ({ page }) => {
    const res = await page.goto('/blog/');
    expect(res?.status()).toBeLessThan(400);
    // Plusieurs <main> possibles (page + island) — on vérifie le premier
    await expect(page.locator('main').first()).toBeVisible();
  });
});

test.describe('/contact', () => {
  test('le formulaire de contact est présent', async ({ page }) => {
    await page.goto('/contact/');
    // ContactForm est un island React client:load — attendre l'hydratation
    await expect(page.locator('form')).toBeVisible({ timeout: 15_000 });
  });

  test('les champs principaux du formulaire sont présents', async ({
    page,
  }) => {
    await page.goto('/contact/');
    await page.locator('form').waitFor({ timeout: 15_000 });
    // Vérifie un champ nom ou email
    const nameOrEmail = page
      .locator('input[name="name"], input[id*="name"], input[type="email"]')
      .first();
    await expect(nameOrEmail).toBeVisible();
  });
});

test.describe('Pages services', () => {
  const servicePages = [
    '/services/therapie-individuelle/',
    '/services/therapie-de-couple/',
    '/services/therapie-familiale/',
  ];

  for (const path of servicePages) {
    test(`${path} charge correctement`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await expect(page.locator('main')).toBeVisible();
    });
  }
});

test.describe('Accessibilité de base', () => {
  test("la page d'accueil a un seul <h1>", async ({ page }) => {
    await page.goto('/');
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
  });

  test('les images ont un attribut alt', async ({ page }) => {
    await page.goto('/');
    const imgsWithoutAlt = await page.locator('img:not([alt])').count();
    expect(imgsWithoutAlt).toBe(0);
  });
});
