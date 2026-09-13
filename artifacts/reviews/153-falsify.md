# Falsification evidence — issue #153 SC1–SC8 (runner v2)

Head under test: `54e90ca0bd43cca230a416ef6e379b34fd5f04cc` — the sources were clean (== HEAD) before and after every mutated run; per-source sha256 hashes in the JSON artifact pin the exact bytes.

Oracle contract (revue #154): each row applies a criterion-specific COMPILING mutation (exact-match, unique anchor enforced) and admits `proven` only when the mapped suite COMPLETES with an assertion failure matching `expect_test`. Module deletion / collection failures are structurally inadmissible.

## SC → Test Matrix

| SC | Mutation (anchor) | Test file(s) | Status | Assertion failure |
|----|-------------------|--------------|--------|-------------------|
| SC1 | `src/lib/google-calendar.ts: "if (error && error.code !== 'PGRST116') {` | google-calendar.ts | ✓ proven | tests/unit/google-calendar.test.ts > getPersistedOAuthClient — token-row read classification (SC1) > PostgREST 504 on the token select → CalendarNetworkError, ZERO writes |
| SC2 | `netlify/functions/calendar-keepwarm.ts: "if (remainingMs !== null && r` | calendar-keepwarm.ts | ✓ proven | tests/unit/calendar-keepwarm.test.ts > KeepwarmSession — 3 states + 6-min margin gate (SC2) > 6 min exactly of persisted margin → transient: warm-up skipped, no alert |
| SC3 | `src/lib/google-calendar.ts: "return { manualSlots: indexManualSlots(ma` | google-calendar.ts | ✓ proven | tests/unit/calendar-keepwarm.test.ts > warmAvailabilityCache — mono-snapshot (SC3/SC5/SC6) > SC3 healthy run: exactly 1 manual read + 1 Freebusy + 1 token select, then 4 confirmed writes |
| SC4 | `src/lib/google-calendar.ts: "const eligible = input.mode === 'in-perso` | google-calendar.ts | ✓ proven | tests/unit/availability-batch.test.ts > pure derivation vs golden fixtures (SC4 — snapshot → generate + filter) > scenario: manual-slots week > derives the 4 {mode}×{duration} games deep-equal to the golden fixture |
| SC5 | `netlify/functions/calendar-keepwarm.ts: "snapshot = await loadAvailabi` | calendar-keepwarm.ts | ✓ proven | tests/unit/calendar-keepwarm.test.ts > warmAvailabilityCache — mono-snapshot (SC3/SC5/SC6) > SC5 cron: Freebusy 200 with calendars[id].errors → 0 writes, existing entries INTACT, stage-named log |
| SC6 | `netlify/functions/calendar-keepwarm.ts: "failed += 1;…"` | calendar-keepwarm.ts | ✓ proven | tests/unit/calendar-keepwarm.test.ts > warmAvailabilityCache — mono-snapshot (SC3/SC5/SC6) > SC6 telemetry: one cache write failing → {computed: 4, written: 3, failed: 1} — never a silent success |
| SC7 | `src/pages/api/availability.ts: "if (cached) {…"` | availability.ts | ✓ proven | tests/unit/availability-api.test.ts > GET /api/availability — cache hit re-filtering (SC7) > serves cached slots re-filtered by live dbBusy and never hits Google nor writes the cache |
| SC8 | `netlify/functions/calendar-keepwarm.ts: ".eq('updated_at', tokens.upda` | calendar-keepwarm.ts, google-calendar.ts | ✓ proven | tests/unit/calendar-keepwarm.test.ts > CAS updated_at on the refresh persist (SC8) — cron writer > race: v2 lands after the read → UPDATE conditioned on updated_at=T1 matches 0 rows → v2 preserved, CAS-miss logged, run continues ok |

## Falsification Evidence

broke SC1 (src/lib/google-calendar.ts) → exit=1, 2 failed | 33 passed — failing: tests/unit/google-calendar.test.ts > getPersistedOAuthClient — token-row read classification (SC1) > PostgREST 504 on the token select → CalendarNetworkError, ZERO writes
broke SC2 (netlify/functions/calendar-keepwarm.ts) → exit=1, 2 failed | 44 passed — failing: tests/unit/calendar-keepwarm.test.ts > KeepwarmSession — 3 states + 6-min margin gate (SC2) > 6 min exactly of persisted margin → transient: warm-up skipped, no alert
broke SC3 (src/lib/google-calendar.ts) → exit=1, 4 failed | 42 passed — failing: tests/unit/calendar-keepwarm.test.ts > warmAvailabilityCache — mono-snapshot (SC3/SC5/SC6) > SC3 healthy run: exactly 1 manual read + 1 Freebusy + 1 token select, then 4 confirmed writes
broke SC4 (src/lib/google-calendar.ts) → exit=1, 8 failed | 6 passed — failing: tests/unit/availability-batch.test.ts > pure derivation vs golden fixtures (SC4 — snapshot → generate + filter) > scenario: manual-slots week > derives the 4 {mode}×{duration} games deep-equal to the golden fixture
broke SC5 (netlify/functions/calendar-keepwarm.ts) → exit=1, 2 failed | 44 passed — failing: tests/unit/calendar-keepwarm.test.ts > warmAvailabilityCache — mono-snapshot (SC3/SC5/SC6) > SC5 cron: Freebusy 200 with calendars[id].errors → 0 writes, existing entries INTACT, stage-named log
broke SC6 (netlify/functions/calendar-keepwarm.ts) → exit=1, 1 failed | 54 passed — failing: tests/unit/calendar-keepwarm.test.ts > warmAvailabilityCache — mono-snapshot (SC3/SC5/SC6) > SC6 telemetry: one cache write failing → {computed: 4, written: 3, failed: 1} — never a silent success
broke SC7 (src/pages/api/availability.ts) → exit=1, 1 failed | 13 passed — failing: tests/unit/availability-api.test.ts > GET /api/availability — cache hit re-filtering (SC7) > serves cached slots re-filtered by live dbBusy and never hits Google nor writes the cache
broke SC8 (netlify/functions/calendar-keepwarm.ts, src/lib/google-calendar.ts) → exit=1, 5 failed | 76 passed — failing: tests/unit/calendar-keepwarm.test.ts > CAS updated_at on the refresh persist (SC8) — cron writer > race: v2 lands after the read → UPDATE conditioned on updated_at=T1 matches 0 rows → v2 preserved, CAS-miss logged, run continues ok
