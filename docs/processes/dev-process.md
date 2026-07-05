# Development Process

> How work flows through omf-therapie. For issue/PR conventions see `issue-management.md`; for review checklist see `../standards/code-review.md`.

## Branching

- **`main`** — production. Auto-deploys to omf-therapie.fr via Netlify on merge.
- **Feature branches** — `feat/<issue#>-<slug>` (e.g. `feat/63-admin-annulation-avoir-credit-rdv`). Branch from `main`, merge via PR.
- **Bugfix branches** — `fix/<issue#>-<slug>` or `fix/<slug>`.
- **Doc branches** — `docs/<slug>`.

> **Always branch from `main`** — don't commit directly. CI gate (`CI / build`) must pass before merge.

## Dev-core workflow (frame → spec → plan → implement)

Larger features follow the dev-core artifact lifecycle. Each phase produces an artifact in `artifacts/`:

| Phase | Tool | Artifact location | Output |
|-------|------|-------------------|--------|
| 1. Intent | GitHub issue | (issue body) | Problem statement + acceptance criteria |
| 2. Frame | `/frame` | `artifacts/frames/<N>-*.mdx` | Scope, options, decision |
| 3. Spec | `/spec` | `artifacts/specs/<N>-*.mdx` | Approved requirements |
| 4. Plan | `/plan` | `artifacts/plans/<N>-*.mdx` | Sliced implementation plan |
| 5. Implement | `/implement` | (feature branch) | Code + commits |
| 6. PR | `/pr` | GitHub PR | Review + merge |

Artifacts are committed to the repo (in the feature branch) so context travels with the code.

### When to use the full workflow

- **Full lifecycle:** medium-large features (multiple slices, architectural decisions, new domain). Recent examples: #63 (avoirs), #67 (CI), #68 (Stripe idempotency).
- **Lightweight (`/dev` or direct):** trivial fixes, typos, one-line config changes. Recent example: cookieYes/GA4 fixes.

If unsure, default to at least a `/frame` — it surfaces scope before code is written.

## Commit conventions

- **French, present tense:** "Ajoute" not "Ajouté".
- **Conventional prefix** (lowercase): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
- **Scope optional but encouraged:** `feat(admin):`, `fix(#63):`, `docs(plan):`.
- **Reference issue** in the subject or body: `fix(#63): report thérapeute sans contrainte d'horaires`.
- **Co-authored commits** are standard practice for AI pair programming.

Examples from `git log`:
```
fix(ci): add lint+test+build pipeline with typecheck advisory (#67)
feat(#63): annulation/report RDV + système d'avoir interne (#66)
feat(admin): refonte /mes-rdvs — liste compacte, recherche et groupes par date (#65)
docs: synchronisation doc PRs #85, #66, #65
```

## PR conventions

- **Branch → `main`** via GitHub PR.
- **Title:** conventional-commit format, French.
- **Body:** Résumé (what + why), Changements (file-by-file table), Vérifications (lint/typecheck/test/build results), Test Plan (checklist), Lifecycle table (if dev-core flow).
- **Close the issue** in the body: `Fixes #N` or `Closes #N`.
- **Verification line required:** `✅ npm run lint`, `✅ npm run test`, `✅ npm run build`, and (for UI) `✅ npm run audit:a11y`.

## Local dev loop

```bash
git pull origin main                           # avoid drift
git checkout -b feat/<issue#>-<slug>
npm install                                    # if deps changed
npm run db:start                               # Postgres + Mailpit
npm run dev -- --port 4321                     # Astro dev server

# In another terminal:
npm run test:watch                             # Vitest
npm run audit:a11y                             # before UI PRs
npx playwright test --project=chromium         # for e2e changes
```

## Before merging

- [ ] `npm run lint` ✅
- [ ] `npm run test` ✅
- [ ] `npm run build` ✅
- [ ] `npm run audit:a11y` ✅ (UI changes)
- [ ] PR description complete + `Fixes #N`
- [ ] DB migration (if any) ready to apply to prod post-merge
- [ ] New env vars (if any) documented + ready to set in Netlify

## Post-merge

- [ ] **DB migration applied to prod** (Netlify doesn't run them).
- [ ] New env vars set in Netlify (production scope).
- [ ] Smoke-test the deployed flow on omf-therapie.fr.
- [ ] Close any tracking issue if not auto-closed.

## AI Quick Reference

- **ALWAYS** branch from `main` — never commit directly to `main`.
- **ALWAYS** write commit messages in **French, present tense** with a conventional prefix.
- **ALWAYS** reference the issue (`Fixes #N`) in the PR body.
- **ALWAYS** apply DB migrations manually to prod after merge.
- **ALWAYS** report verification results (`lint`/`test`/`build`/`audit:a11y`) in the PR body.
- **PREFER** the dev-core `/frame → /spec → /plan → /implement` flow for medium-large features.
- **ALWAYS** run `git pull` before branching (local `main` drifts from `origin/main`).
- **NEVER** assume CI/nvmrc files are present locally — verify after `git pull`.
