# Code Review

> Checklist and conventions for reviewing PRs to omf-therapie. Reviewers should block on the items below; authors should self-check before requesting review.

## Self-check before requesting review

- [ ] `npm run lint` passes
- [ ] `npm run test` passes (Vitest)
- [ ] `npm run build` passes
- [ ] `npm run typecheck` — note any new errors (advisory only; don't introduce new ones)
- [ ] **UI/visual change:** `npm run audit:a11y` passes (WCAG 2.1 AA)
- [ ] **E2E-relevant change:** relevant Playwright specs pass locally

## Review checklist

### Architecture (ADR-001)

- [ ] New code extends an **existing layer** (`lib/`, `types/`, `pages/api/`, `components/`) — no new top-level `src/` directory.
- [ ] A new domain is a **slice** (lib + types + api + component), not a layer proliferation.
- [ ] Cross-cutting concerns (`isAdminSession`, `checkRateLimit`, `createSecureLinkToken`) are **imported**, not re-implemented.
- [ ] No top-level `src/components/*.tsx` added (legacy pattern — use `src/components/{domain}/`).

### Server/client boundary

- [ ] `src/lib/**` is **not** imported from any client-shipped code (islands, client components).
- [ ] Secrets/server env vars are **not** prefixed `PUBLIC_`.

### Auth & security

- [ ] Every endpoint under `src/pages/api/admin/**` verifies the session via `auth.api.getSession()` + `isAdminSession()`.
- [ ] No real Stripe refund — internal avoir used instead (ADR-015).
- [ ] Money mutations are idempotent (unique constraint or RPC).
- [ ] User input validated (Zod or explicit checks) before use.

### Conventions

- [ ] **Trailing slash** on every client-side URL (fetch, `window.location.href`, `<a href>`) — ADR-013.
- [ ] **User-facing text in French**; code/types/comments in English.
- [ ] **Commit messages in French**, present tense ("Ajoute" not "Ajouté").
- [ ] Function declarations for exported React components (not arrow functions).
- [ ] Tailwind utility-first; no custom CSS outside `src/index.css`; no inline styles except dynamic values.
- [ ] `client:idle` preferred for below-fold islands; no `client:visible` + `useMotionVariants`.

### Data & state

- [ ] `payment_received` used for paid RDVs (not `confirmed`).
- [ ] Status transitions follow the state machine (see `architecture/patterns.md`).
- [ ] DB migrations applied manually if testing locally (`db:reset` only replays `001_init.sql`).
- [ ] Money stored ×100 (centimes); converted on read/write.

### Accessibility

- [ ] Semantic HTML (`<nav>`, `<main>`, `<article>`, `<section>`).
- [ ] ARIA labels on icon buttons; `aria-labelledby`/`describedby` where needed.
- [ ] Keyboard navigation works (tab order, focus indicators, skip-links).
- [ ] Alt text: descriptive for meaningful images, empty for decorative.

### Tests

- [ ] New `src/lib/**` business logic has unit tests (pure module preferred).
- [ ] Status/eligibility/credits changes covered by `tests/unit/`.
- [ ] No real network calls in unit tests (mocked at module boundary).

## Common blockers

| Issue | Why it blocks |
|-------|---------------|
| Missing trailing `/` on a fetch | Causes `Unexpected token '<'` in prod (HTML redirect returned instead of JSON) |
| `lib/` import in an island | Ships server code/secrets to browser |
| Missing session check in `api/admin/**` | Security hole — unauthenticated admin actions |
| Real Stripe refund code | Violates ADR-015; should be internal avoir |
| Re-implemented `isAdminSession` etc. | Layer-pollution anti-pattern (ADR-001) |
| New top-level `src/components/*.tsx` | Legacy pattern; should be `src/components/{domain}/` |
| `dark:` Tailwind variants | Dark mode not implemented |
| framer-motion for continuous animation | Use `animate-spin`; framer-motion continuous anims are heavy |
| Stale `confirmed` for paid video RDV | Should be `payment_received` |

## Artifact lifecycle (dev-core workflow)

If the PR follows the dev-core `/frame → /spec → /plan → /implement` flow:

- [ ] Frame, spec, plan artifacts exist in `artifacts/{frames,specs,plans}/` and are marked approved.
- [ ] PR description links the issue and lists verification results (lint/typecheck/test/build status).
- [ ] Issue closed via "Fixes #N" in the PR body.

## AI Quick Reference

- **ALWAYS** verify the trailing-slash rule on every modified/added `fetch()` or navigation.
- **ALWAYS** block on missing session checks in `src/pages/api/admin/**`.
- **ALWAYS** block on `lib/` imports inside client-shipped code.
- **NEVER** approve a real Stripe refund — redirect to internal avoir (ADR-015).
- **NEVER** approve re-implementation of `isAdminSession`/`checkRateLimit`/`createSecureLinkToken`.
- **ALWAYS** require `npm run audit:a11y` for UI/visual changes.
- **ALWAYS** confirm `payment_received` (not `confirmed`) is used for paid video RDVs.
- **ALWAYS** check that a new domain is a slice, not a new top-level directory.
