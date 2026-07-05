# Testing

> Test conventions for omf-therapie. Three layers: unit (Vitest), e2e (Playwright), accessibility audits (pa11y/Lighthouse).

## Current state

| Layer | Tool | Location | Status |
|-------|------|----------|--------|
| Unit / integration | Vitest | `tests/unit/**/*.test.ts` | Active (node env) |
| E2E | Playwright | `e2e/*.spec.ts` | Active |
| Accessibility | pa11y + Lighthouse | `npm run audit:a11y` | **Required before UI PRs** |

> **Note:** `memory-bank/conventions.md` says "no automated tests" — that's **stale** (Jan 2025). Unit + e2e tests now exist.

## Commands

```bash
npm run test              # Vitest run (tests/unit/**, node env)
npm run test:watch        # Vitest watch
npm run audit:a11y        # pa11y WCAG audit (needs dev server running)

# Playwright (manual, not in package.json scripts)
npx playwright test --project=chromium
npx playwright test --headed -g "charge la page du wizard"
```

## Unit tests (Vitest)

**Location:** `tests/unit/**/*.test.ts`  
**Config:** `vitest.config.ts` — `environment: 'node'`, `setupFiles: ['tests/unit/setup.ts']` (stubs `import.meta.env`).  
**Include pattern:** `tests/unit/**/*.test.ts`.

### Conventions

- **Describe/it naming:** describe the unit under test, `it` describes behavior.
- **Pure modules preferred:** `src/lib/appointment-eligibility.ts` is a pure module specifically so it's unit-testable without Supabase/Stripe. Follow this pattern for new business logic.
- **No network in unit tests:** stub `import.meta.env` in `setup.ts`; mock `supabase`/`stripe`/`google-calendar` at the module boundary.
- **Co-locate fixtures** in `tests/unit/` if shared.

### Example shape

```ts
// tests/unit/cancel-eligibility.test.ts
import { describe, it, expect } from "vitest";
import { isCancellableByTherapist } from "@/lib/appointment-eligibility";

describe("isCancellableByTherapist", () => {
  it("returns true for a confirmed RDV within the eligibility window", () => {
    // ...
  });
});
```

## E2E tests (Playwright)

**Location:** `e2e/*.spec.ts`  
**Config:** `playwright.config.ts`.

- **Selectors:** prefer data attributes (`[data-testid]`) over CSS/text selectors — they're stable across refactors. Existing tests use selectors like `[data-testid="tab-rendez-vous"]`.
- **Auth:** e2e tests that need admin state should seed via the dev DB (`scripts/seed-admin.ts`) and log in through the UI flow.
- **Headless by default** in CI; `--headed` for local debugging.

### Current specs

- `e2e/smoke.spec.ts` — page load smoke tests.
- `e2e/manual-slots.spec.ts` — manual slot management flow.

## Accessibility audits (mandatory)

`npm run audit:a11y` runs pa11y against running URLs (dev server must be active on `:4321`).

- **Reports:** `public/reports/latest/` — HTML index + per-URL JSON.
- **WCAG 2.1 AA** is the target. Failures block UI PRs.
- `npm run audit:lighthouse` — Lighthouse accessibility against production (`https://omf-therapie.fr`).

## CI integration

`.github/workflows/ci.yml` runs `npm run test` (Vitest) in the blocking `build` job. Playwright and pa11y are **not** in CI yet — run them locally before merging UI changes.

## What to test

| Change type | Required tests |
|-------------|----------------|
| `src/lib/**` business logic | Unit test (pure module if possible) |
| Appointment status / eligibility | `tests/unit/appointment-eligibility.test.ts` pattern |
| Credits / avoir math | `tests/unit/credits.test.ts` pattern |
| Booking flow / admin UI | Playwright e2e + `npm run audit:a11y` |
| Visual / a11y change | `npm run audit:a11y` (blocking) |
| API endpoint | Unit test the handler logic; e2e for the full flow |

## AI Quick Reference

- **ALWAYS** write a unit test when adding pure business logic to `src/lib/` (e.g. eligibility, pricing math).
- **ALWAYS** extract business rules into pure modules so they're unit-testable without network mocks.
- **ALWAYS** run `npm run audit:a11y` before merging UI/visual changes (WCAG 2.1 AA is mandatory).
- **PREFER** `[data-testid]` selectors in Playwright over CSS/text selectors.
- **NEVER** hit real Supabase/Stripe/Google in unit tests — mock at the module boundary.
- **NEVER** trust `memory-bank/conventions.md`'s "no automated tests" line — it's stale; tests exist.
- **ALWAYS** stub `import.meta.env` in `tests/unit/setup.ts` before importing modules under test.
