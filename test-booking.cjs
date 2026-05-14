const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium-browser' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => {
    if (!r.ok() && r.url().includes('/api/')) {
      console.log(`  [API ${r.status()}] ${r.url().replace('http://localhost:4321', '')}`);
    }
  });

  const pass = (msg) => console.log(`  ✅ ${msg}`);
  const fail = (msg) => console.log(`  ❌ ${msg}`);
  const info = (msg) => console.log(`  ℹ  ${msg}`);

  try {
    // ── ÉTAPE 1 : Type & Mode 
    console.log('\n══ ÉTAPE 1 : Type & Mode ══');
    await page.goto('http://localhost:4321/rendez-vous/');
    await page.waitForSelector('button[aria-pressed]', { timeout: 10000 });
    pass('Page chargée: ' + await page.title());

    await page.locator('button[aria-pressed]').filter({ hasText: /individuelle/i }).first().click();
    pass('Type: Individuelle');

    await page.locator('button[aria-pressed]').filter({ hasText: /présentiel/i }).first().click();
    pass('Mode: Présentiel');

    await page.locator('input[name="duration"][value="60"]').check();
    pass('Durée: 60 min');

    const nextBtn1 = page.locator('button', { hasText: /choisir un créneau/i });
    await nextBtn1.waitFor({ state: 'visible' });
    if (await nextBtn1.isDisabled()) { fail('Bouton étape 1 désactivé'); } else {
      await nextBtn1.click();
      pass('→ Étape 2');
    }

    // ── ÉTAPE 2 : Date & Heure ────────────────────────────────────────────────
    console.log('\n══ ÉTAPE 2 : Date & Heure ══');
    // Attendre que les créneaux soient chargés
    await page.waitForSelector('button', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Créneaux = boutons avec texte "HH:MM"
    const slotBtn = page.locator('button').filter({ hasText: /^\d{1,2}:\d{2}$/ }).first();
    await slotBtn.waitFor({ state: 'visible', timeout: 8000 });
    const slotText = await slotBtn.textContent();
    await slotBtn.click();
    pass(`Créneau sélectionné: ${slotText?.trim()}`);

    const nextBtn2 = page.locator('button', { hasText: /continuer/i });
    await nextBtn2.waitFor({ state: 'visible' });
    if (await nextBtn2.isDisabled()) { fail('Bouton Continuer désactivé'); } else {
      await nextBtn2.click();
      pass('→ Étape 3');
    }

    // ── ÉTAPE 3 : Informations patient ────────────────────────────────────────
    console.log('\n══ ÉTAPE 3 : Informations patient ══');
    // Attendre que le formulaire soit hydraté
    await page.waitForSelector('#patient_name', { timeout: 8000 });

    await page.fill('#patient_name', 'Jean Dupont');
    await page.fill('#patient_email', 'jean.dupont@test.fr');
    await page.fill('#patient_phone', '0612345678');
    await page.fill('#patient_postal_code', '75001');
    await page.fill('#patient_city', 'Paris');
    await page.fill('#patient_reason', 'Je souhaite débuter une thérapie individuelle pour travailler sur mon anxiété et améliorer ma qualité de vie au quotidien.');
    pass('Formulaire patient rempli');

    // Attendre que React ait mis à jour l'état
    await page.waitForTimeout(300);

    const nextBtn3 = page.locator('button', { hasText: /vérifier/i });
    await nextBtn3.waitFor({ state: 'visible' });
    if (await nextBtn3.isDisabled()) {
      fail('Bouton Vérifier désactivé');
      // Debug : valeurs des champs
      for (const id of ['patient_name','patient_email','patient_phone','patient_postal_code','patient_city']) {
        const val = await page.inputValue(`#${id}`);
        info(`#${id} = "${val}"`);
      }
      const reason = await page.inputValue('#patient_reason');
      info(`#patient_reason (${reason.length} chars)`);
    } else {
      await nextBtn3.click();
      pass('→ Étape 4 (récapitulatif)');
    }

    // ── ÉTAPE 4 : Soumission & Récapitulatif ───────
    console.log('\n══ ÉTAPE 4 : Récapitulatif ══');
    await page.waitForTimeout(500);

    const submitBtn = page.locator('button', { hasText: /envoyer ma demande/i });
    await submitBtn.waitFor({ state: 'visible', timeout: 8000 });
    pass('Bouton "Envoyer ma demande" visible');

    const summaryText = await page.locator('main').textContent();
    info('Récap: ' + summaryText?.replace(/\s+/g, ' ').trim().slice(0, 200));

    if (await submitBtn.isDisabled()) {
      fail('Bouton Envoyer désactivé');
    } else {
      await submitBtn.click();
      pass('Formulaire soumis !');

      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(2000);

      const finalUrl = page.url();
      const finalTitle = await page.title();
      info(`URL finale: ${finalUrl}`);
      info(`Titre: ${finalTitle}`);

      if (finalUrl.includes('rdv/merci') || finalUrl.includes('merci')) {
        pass('🎉 Prise de rendez-vous complète ! Page de confirmation atteinte.');
      } else if (finalUrl.includes('submitted') || finalTitle.includes('merci') || finalTitle.includes('confirmé')) {
        pass('🎉 Prise de rendez-vous confirmée !');
      } else {
        const content = await page.locator('main').textContent();
        info('Contenu: ' + content?.replace(/\s+/g, ' ').trim().slice(0, 300));
      }
    }

  } catch (e) {
    console.log(`\n  ❌ EXCEPTION: ${e.message}`);
  }

  if (consoleErrors.length) {
    console.log('\n⚠  Erreurs console JS:');
    consoleErrors.slice(0, 5).forEach(e => console.log('  -', e));
  }

  await browser.close();
  console.log('\n══ FIN DU TEST ══\n');
})();
