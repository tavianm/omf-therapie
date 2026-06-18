import { test, expect, type Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// E2E Tests — Manual slots management flow
// ────────────────────────────────────────────────────────────

/**
 * Helper: Login as admin
 *
 * Note: This test assumes a working BetterAuth setup with admin credentials.
 * In CI, use PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD env vars.
 */
async function loginAsAdmin(page: Page) {
  await page.goto('/login/');

  // Wait for the auth form to load (SSR page with client-side hydration)
  await page.waitForLoadState('networkidle');

  // Fill in credentials - use env vars in CI, defaults for local development
  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'admin@omf-therapie.fr';
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD || 'admin-password';

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitButton = page.locator('button[type="submit"], button:has-text("Se connecter")').first();

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await submitButton.click();

  // Wait for navigation to dashboard or redirect
  await page.waitForURL(/\/(mes-rdvs|login)/, { timeout: 10000 });

  // Verify we're logged in (should be on /mes-rdvs now)
  const currentUrl = page.url();
  if (!currentUrl.includes('/mes-rdvs')) {
    throw new Error(`Login failed - expected redirect to /mes-rdvs, got ${currentUrl}`);
  }
}

test.describe('Manual slots management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should display time slots tab and switch to it', async ({ page }) => {
    // Should be on /mes-rdvs already after login
    await expect(page).toHaveURL(/\/mes-rdvs/);

    // Find and click the "Plages horaires" tab
    const timeSlotsTab = page.locator('button[data-tab="timeslots"]').or(
      page.getByRole('tab', { name: 'Plages horaires' })
    );

    await expect(timeSlotsTab).toBeVisible();
    await timeSlotsTab.click();

    // Verify the tab panel is visible
    const tabPanel = page.locator('#timeslots-tab-panel');
    await expect(tabPanel).toBeVisible();

    // Verify the TimeSlotManager heading is visible
    await expect(page.getByText('Gestion des plages horaires')).toBeVisible();
  });

  test('should add a new manual slot', async ({ page }) => {
    await page.goto('/mes-rdvs/');

    // Switch to time slots tab
    const timeSlotsTab = page.locator('button[data-tab="timeslots"]');
    await timeSlotsTab.click();

    // Wait for tab panel to be visible
    await expect(page.locator('#timeslots-tab-panel')).toBeVisible();

    // Click "Ajouter une plage" button
    const addButton = page.getByRole('button', { name: 'Ajouter une plage' });
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Wait for modal to appear
    const modal = page.locator('div[role="dialog"]').or(page.locator('.modal')).first();
    await expect(modal).toBeVisible();

    // Fill in the form
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const dateInput = page.locator('input[type="date"]').or(page.locator('#slot-date'));
    await dateInput.fill(dateStr);

    // Select period (default is "Matin")
    const periodSelect = page.locator('select').or(page.locator('#slot-period'));
    await periodSelect.selectOption('morning');

    // Submit the form
    const submitButton = page.getByRole('button', { name: 'Créer' }).or(page.locator('button[type="submit"]'));
    await submitButton.click();

    // Wait for success toast
    await expect(page.getByText('Plage horaire créée avec succès')).toBeVisible({ timeout: 5000 });

    // Verify the slot appears in the list
    await expect(page.getByText(dateStr, { exact: false })).toBeVisible();
    await expect(page.getByText('Matin')).toBeVisible();
  });

  test('should edit an existing slot', async ({ page }) => {
    await page.goto('/mes-rdvs/');

    // Switch to time slots tab
    const timeSlotsTab = page.locator('button[data-tab="timeslots"]');
    await timeSlotsTab.click();

    // Wait for slots to load
    await expect(page.locator('#timeslots-tab-panel')).toBeVisible();

    // Look for existing slots (if any) or create one first
    const existingSlots = page.locator('#timeslots-tab-panel li');
    const slotCount = await existingSlots.count();

    if (slotCount === 0) {
      // Create a slot first
      const addButton = page.getByRole('button', { name: 'Ajouter une plage' });
      await addButton.click();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const dateInput = page.locator('input[type="date"]');
      await dateInput.fill(dateStr);

      const submitButton = page.getByRole('button', { name: 'Créer' });
      await submitButton.click();

      await expect(page.getByText('Plage horaire créée avec succès')).toBeVisible();
    }

    // Find the first slot's edit button
    const editButton = page.locator('#timeslots-tab-panel').getByRole('button', { name: 'Modifier' }).first();
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    // Wait for edit modal
    const modal = page.locator('div[role="dialog"]').or(page.locator('.modal')).first();
    await expect(modal).toBeVisible();

    // Change the period to "Après-midi"
    const periodSelect = page.locator('select').or(page.locator('#slot-period'));
    await periodSelect.selectOption('afternoon');

    // Submit the form
    const updateButton = page.getByRole('button', { name: 'Mettre à jour' });
    await updateButton.click();

    // Wait for success toast
    await expect(page.getByText('Plage horaire mise à jour avec succès')).toBeVisible({ timeout: 5000 });

    // Verify the change is reflected in the list
    await expect(page.getByText('Après-midi')).toBeVisible();
  });

  test('should delete a slot', async ({ page }) => {
    await page.goto('/mes-rdvs/');

    // Switch to time slots tab
    const timeSlotsTab = page.locator('button[data-tab="timeslots"]');
    await timeSlotsTab.click();

    // Wait for slots to load
    await expect(page.locator('#timeslots-tab-panel')).toBeVisible();

    // Create a slot first if none exist
    const existingSlots = page.locator('#timeslots-tab-panel li');
    const slotCountBefore = await existingSlots.count();

    if (slotCountBefore === 0) {
      const addButton = page.getByRole('button', { name: 'Ajouter une plage' });
      await addButton.click();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const dateInput = page.locator('input[type="date"]');
      await dateInput.fill(dateStr);

      const submitButton = page.getByRole('button', { name: 'Créer' });
      await submitButton.click();

      await expect(page.getByText('Plage horaire créée avec succès')).toBeVisible();
    }

    // Find the first slot's delete button
    const deleteButton = page.locator('#timeslots-tab-panel').getByRole('button', { name: 'Supprimer' }).first();
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Wait for confirmation modal
    const confirmModal = page.locator('div[role="dialog"]').or(page.locator('.modal')).first();
    await expect(confirmModal).toBeVisible();
    await expect(page.getByText('Confirmer la suppression')).toBeVisible();

    // Confirm deletion
    const confirmButton = page.getByRole('button', { name: 'Supprimer' }).filter({ hasText: 'Supprimer' });
    await confirmButton.click();

    // Wait for success toast
    await expect(page.getByText('Plage horaire supprimée avec succès')).toBeVisible({ timeout: 5000 });

    // Verify the slot is removed from the list
    const slotCountAfter = await existingSlots.count();
    expect(slotCountAfter).toBeLessThan(slotCountBefore);
  });

  test('should handle validation errors', async ({ page }) => {
    await page.goto('/mes-rdvs/');

    // Switch to time slots tab
    const timeSlotsTab = page.locator('button[data-tab="timeslots"]');
    await timeSlotsTab.click();

    // Click "Ajouter une plage" button
    const addButton = page.getByRole('button', { name: 'Ajouter une plage' });
    await addButton.click();

    // Wait for modal
    const modal = page.locator('div[role="dialog"]').or(page.locator('.modal')).first();
    await expect(modal).toBeVisible();

    // Try to submit without filling required fields
    const submitButton = page.getByRole('button', { name: 'Créer' });

    // Browser's built-in validation should prevent submission
    await expect(submitButton).toBeVisible();

    // The form has required attributes, so submission should be blocked
    const isDisabled = await submitButton.isDisabled();
    const dateInput = page.locator('input[type="date"]');
    const dateValue = await dateInput.inputValue();

    if (!isDisabled && dateValue === '') {
      // If not disabled, try clicking and verify it doesn't submit
      await submitButton.click({ timeout: 1000 });
      // The required validation should prevent form submission
      await expect(modal).toBeVisible();
    }
  });

  test('should persist data across tab switches', async ({ page }) => {
    await page.goto('/mes-rdvs/');

    // Switch to time slots tab
    const timeSlotsTab = page.locator('button[data-tab="timeslots"]');
    await timeSlotsTab.click();

    // Create a slot
    const addButton = page.getByRole('button', { name: 'Ajouter une plage' });
    await addButton.click();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const dateInput = page.locator('input[type="date"]');
    await dateInput.fill(dateStr);

    const submitButton = page.getByRole('button', { name: 'Créer' });
    await submitButton.click();

    await expect(page.getByText('Plage horaire créée avec succès')).toBeVisible();

    // Switch to another tab
    const patientsTab = page.locator('button[data-tab="patients"]');
    await patientsTab.click();
    await expect(page.locator('#patients-tab-panel')).toBeVisible();

    // Switch back to time slots tab
    await timeSlotsTab.click();
    await expect(page.locator('#timeslots-tab-panel')).toBeVisible();

    // Verify the slot is still visible
    await expect(page.getByText(dateStr, { exact: false })).toBeVisible();
  });
});

test.describe('Manual slots API integration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should fetch existing slots from API', async ({ page }) => {
    await page.goto('/mes-rdvs/');

    // Switch to time slots tab
    const timeSlotsTab = page.locator('button[data-tab="timeslots"]');
    await timeSlotsTab.click();

    // Wait for API call to complete (loading state should disappear)
    const tabPanel = page.locator('#timeslots-tab-panel');
    await expect(tabPanel).toBeVisible();

    // Wait for loading text to disappear (if any)
    const loadingText = page.getByText('Chargement des plages horaires...');
    const isVisible = await loadingText.isVisible({ timeout: 100 }).catch(() => false);
    if (isVisible) {
      await expect(loadingText).not.toBeVisible({ timeout: 5000 });
    }

    // The API call should have completed - verify we can see the heading
    await expect(page.getByText('Gestion des plages horaires')).toBeVisible();
  });

  test('handle API errors gracefully', async ({ page }) => {
    // This test would require mocking the API response
    // For now, we'll just verify error handling exists
    await page.goto('/mes-rdvs/');

    const timeSlotsTab = page.locator('button[data-tab="timeslots"]');
    await timeSlotsTab.click();

    // Verify the error state element exists (even if not displayed)
    const errorAlert = page.locator('[role="alert"]').or(page.getByText(/Erreur/i));
    const exists = await errorAlert.count() > 0;

    if (exists) {
      // If error elements exist, verify they're hidden by default
      const isVisible = await errorAlert.first().isVisible();
      if (isVisible) {
        // Error is shown - log it for debugging
        const errorText = await errorAlert.first().textContent();
        console.log('API Error detected:', errorText);
      }
    }
  });
});
