# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verify-pr39.spec.ts >> PR #39 — Durée/Tarif flexibles + Agenda vidéo immédiat >> Test 2 · API: create in-person appointment with duration=45 and override_price=35
- Location: e2e/verify-pr39.spec.ts:180:8

# Error details

```
Error: Expected 201 — DB migration needed: DROP CONSTRAINT appointments_duration_check + ADD CHECK (duration >= 15 AND duration <= 240)

expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 500
```

# Test source

```ts
  107 |   // TEST 1 — Admin UI: duration options and manual-price checkbox
  108 |   // ──────────────────────────────────────────────────────────────────────────
  109 |   test('Test 1 · UI: modal shows correct duration options and manual-price checkbox', async ({ page }) => {
  110 |     await page.goto('/mes-rdvs/');
  111 |     await page.waitForLoadState('networkidle');
  112 | 
  113 |     const createBtn = page.locator('button[aria-label="Créer un rendez-vous manuellement"]');
  114 |     await expect(createBtn).toBeVisible({ timeout: 10_000 });
  115 | 
  116 |     await createBtn.click();
  117 |     const dialog = page.locator('[role="dialog"]');
  118 |     await expect(dialog).toBeVisible({ timeout: 8_000 });
  119 | 
  120 |     await expect(dialog.locator('#create-modal-title')).toHaveText('Nouveau rendez-vous');
  121 | 
  122 |     const durationSelect = page.locator('#cm-duration');
  123 |     await expect(durationSelect).toBeVisible();
  124 |     const durationOptions = await durationSelect.locator('option').allTextContents();
  125 |     console.log('[Test 1] Duration options:', durationOptions);
  126 | 
  127 |     // Standard options must exist
  128 |     expect(durationOptions).toContain('60 min');
  129 |     expect(durationOptions).toContain('90 min');
  130 |     expect(durationOptions).toContain('Personnalisée…');
  131 | 
  132 |     // ⚠️ DISCREPANCY: PR claims 30/45/60/75/90 presets — only 60/90/custom exist
  133 |     const missingPresets = ['30 min', '45 min', '75 min'].filter(v => !durationOptions.includes(v));
  134 |     if (missingPresets.length) {
  135 |       console.warn(
  136 |         `[Test 1] ⚠️  DISCREPANCY — PR spec says 30/45/75 presets; ` +
  137 |         `ABSENT from dropdown: [${missingPresets.join(', ')}]. ` +
  138 |         `AdminCreateButton.tsx DURATIONS only has 60/90/Personnalisée….`,
  139 |       );
  140 |     }
  141 | 
  142 |     // "Personnalisée…" must reveal a custom-minutes input with min=15, max=240
  143 |     await durationSelect.selectOption('custom');
  144 |     const customInput = page.locator('input[type="number"][min="15"][max="240"]');
  145 |     await expect(customInput).toBeVisible({ timeout: 3_000 });
  146 |     expect(await customInput.getAttribute('min')).toBe('15');
  147 |     expect(await customInput.getAttribute('max')).toBe('240');
  148 | 
  149 |     // Selecting custom must auto-check "Tarif manuel"
  150 |     const manualPriceLabel = page.locator('label').filter({ hasText: /Tarif manuel/i });
  151 |     await expect(manualPriceLabel).toBeVisible();
  152 |     const manualPriceCheckbox = manualPriceLabel.locator('input[type="checkbox"]');
  153 |     await expect(manualPriceCheckbox).toBeChecked({ timeout: 2_000 });
  154 | 
  155 |     // Manual price input must be visible
  156 |     await expect(page.locator('input[placeholder*="Tarif en €"]')).toBeVisible();
  157 | 
  158 |     // Close modal
  159 |     page.once('dialog', d => d.accept());
  160 |     await page.keyboard.press('Escape');
  161 | 
  162 |     console.log('[Test 1] All UI assertions passed ✓');
  163 |   });
  164 | 
  165 |   // ──────────────────────────────────────────────────────────────────────────
  166 |   // TEST 2 — Create in-person appointment: custom duration=45 min, price=35 €
  167 |   //
  168 |   // ⚠️  KNOWN BUG IN PR #39: The DB constraint `CHECK (duration IN (60, 90))`
  169 |   // was never dropped. Any INSERT with duration≠60/90 fails with a PG CHECK
  170 |   // violation → the API returns 500 "Erreur lors de la création du rendez-vous".
  171 |   // The TypeScript type was widened and the API validation was updated, but
  172 |   // the corresponding migration file was NEVER created.
  173 |   //
  174 |   // This test uses test.fail() to document the current broken state (expected to fail).
  175 |   // Remove the annotation once migration 005_flexible_duration.sql is applied:
  176 |   //   ALTER TABLE appointments DROP CONSTRAINT appointments_duration_check;
  177 |   //   ALTER TABLE appointments ADD CONSTRAINT appointments_duration_check
  178 |   //     CHECK (duration >= 15 AND duration <= 240);
  179 |   // ──────────────────────────────────────────────────────────────────────────
  180 |   test.fail('Test 2 · API: create in-person appointment with duration=45 and override_price=35', async ({ page }) => {
  181 |     const scheduledAt = nextWednesdayAt(10, new Date().getSeconds() % 30);
  182 |     console.log('[Test 2] Scheduling in-person at:', scheduledAt);
  183 | 
  184 |     const response = await page.request.post('/api/admin/appointments/', {
  185 |       data: {
  186 |         patient_name: 'Test PR39 Custom Duration',
  187 |         patient_email: `test-pr39-dur-${Date.now()}@example-test.invalid`,
  188 |         appointment_type: 'individual',
  189 |         appointment_mode: 'in-person',
  190 |         duration: 45,
  191 |         override_price: 35,
  192 |         scheduled_at: scheduledAt,
  193 |         patient_reason: 'E2E test — PR39 custom duration',
  194 |         send_email: false,
  195 |       },
  196 |       headers: { 'Content-Type': 'application/json' },
  197 |     });
  198 | 
  199 |     const body = await response.json();
  200 |     console.log('[Test 2]', response.status(), JSON.stringify(body, null, 2));
  201 | 
  202 |     // Document what SHOULD work (201) vs what happens today (500 due to DB constraint)
  203 |     expect(
  204 |       response.status(),
  205 |       'Expected 201 — DB migration needed: DROP CONSTRAINT appointments_duration_check ' +
  206 |       '+ ADD CHECK (duration >= 15 AND duration <= 240)',
> 207 |     ).toBe(201);
      |       ^ Error: Expected 201 — DB migration needed: DROP CONSTRAINT appointments_duration_check + ADD CHECK (duration >= 15 AND duration <= 240)
  208 | 
  209 |     const appt = body.appointment;
  210 |     expect(appt.duration).toBe(45);
  211 |     expect(appt.final_price).toBe(3500);   // 35€ in centimes
  212 |     expect(appt.base_price).toBe(3500);
  213 |     expect(appt.discount).toBe(0);          // manual price bypasses discounts
  214 |     expect(appt.appointment_mode).toBe('in-person');
  215 |     expect(appt.status).toBe('confirmed');
  216 |   });
  217 | 
  218 |   // ──────────────────────────────────────────────────────────────────────────
  219 |   // TEST 3 — Video appointment: google_calendar_event_id populated immediately
  220 |   // ──────────────────────────────────────────────────────────────────────────
  221 |   test('Test 3 · API: video appointment gets google_calendar_event_id immediately on POST', async ({ page }) => {
  222 |     const scheduledAt = nextThursdayAt(15, new Date().getSeconds() % 30);
  223 |     console.log('[Test 3] Scheduling video at:', scheduledAt);
  224 | 
  225 |     const response = await page.request.post('/api/admin/appointments/', {
  226 |       data: {
  227 |         patient_name: 'Test PR39 Video',
  228 |         patient_email: `test-pr39-video-${Date.now()}@example-test.invalid`,
  229 |         appointment_type: 'individual',
  230 |         appointment_mode: 'video',
  231 |         duration: 60,  // duration=60 is allowed by the DB constraint → no 500
  232 |         scheduled_at: scheduledAt,
  233 |         patient_reason: 'E2E test — PR39 Google Calendar immediate creation',
  234 |         send_email: false,
  235 |       },
  236 |       headers: { 'Content-Type': 'application/json' },
  237 |     });
  238 | 
  239 |     const body = await response.json();
  240 |     console.log('[Test 3]', response.status(), JSON.stringify(body, null, 2));
  241 | 
  242 |     expect(response.status(), `Expected 201. Body: ${JSON.stringify(body)}`).toBe(201);
  243 |     const appt = body.appointment;
  244 |     expect(appt.appointment_mode).toBe('video');
  245 | 
  246 |     // Core PR #39 feature: google_calendar_event_id set on POST (not on Stripe webhook)
  247 |     if (appt.google_calendar_event_id) {
  248 |       console.log('[Test 3] ✅ google_calendar_event_id set immediately:', appt.google_calendar_event_id);
  249 |       expect(typeof appt.google_calendar_event_id).toBe('string');
  250 |       expect(appt.google_calendar_event_id.length).toBeGreaterThan(0);
  251 |       if (appt.video_link) {
  252 |         console.log('[Test 3] ✅ Google Meet link set immediately:', appt.video_link);
  253 |         expect(appt.video_link).toMatch(/^https:\/\//);
  254 |       }
  255 |     } else {
  256 |       console.warn(
  257 |         '[Test 3] ⚠️  google_calendar_event_id is NULL — Google Calendar creation ' +
  258 |         'failed silently (see server logs). GOOGLE_CALENDAR_MOCK=false; ' +
  259 |         'check credentials / quota.',
  260 |       );
  261 |       // The appointment still exists (non-blocking failure is by design)
  262 |       expect(appt.id).toBeDefined();
  263 |       expect(appt.status).toBe('payment_pending');
  264 |     }
  265 |   });
  266 | 
  267 |   // ──────────────────────────────────────────────────────────────────────────
  268 |   // TEST 4a — API validation: duration below minimum
  269 |   // ──────────────────────────────────────────────────────────────────────────
  270 |   test('Test 4a · API validation: duration=5 (below 15 min) returns 400', async ({ page }) => {
  271 |     const response = await page.request.post('/api/admin/appointments/', {
  272 |       data: {
  273 |         patient_name: 'Test Val Min',
  274 |         patient_email: `test-val-min-${Date.now()}@example-test.invalid`,
  275 |         appointment_type: 'individual',
  276 |         appointment_mode: 'in-person',
  277 |         duration: 5,
  278 |         scheduled_at: nextWednesdayAt(10, 0),
  279 |         send_email: false,
  280 |       },
  281 |       headers: { 'Content-Type': 'application/json' },
  282 |     });
  283 | 
  284 |     const body = await response.json();
  285 |     console.log('[Test 4a] duration=5 →', response.status(), body);
  286 | 
  287 |     expect(response.status()).toBe(400);
  288 |     expect(body.error).toMatch(/Durée invalide/i);
  289 |     expect(body.field).toBe('duration');
  290 |     console.log('[Test 4a] duration=5 rejected with 400 ✓');
  291 |   });
  292 | 
  293 |   // ──────────────────────────────────────────────────────────────────────────
  294 |   // TEST 4b — API validation: duration above maximum
  295 |   // ──────────────────────────────────────────────────────────────────────────
  296 |   test('Test 4b · API validation: duration=250 (above 240 min) returns 400', async ({ page }) => {
  297 |     const response = await page.request.post('/api/admin/appointments/', {
  298 |       data: {
  299 |         patient_name: 'Test Val Max',
  300 |         patient_email: `test-val-max-${Date.now()}@example-test.invalid`,
  301 |         appointment_type: 'individual',
  302 |         appointment_mode: 'in-person',
  303 |         duration: 250,
  304 |         scheduled_at: nextWednesdayAt(10, 0),
  305 |         send_email: false,
  306 |       },
  307 |       headers: { 'Content-Type': 'application/json' },
```