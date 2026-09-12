# Contributing

> How to work on omf-therapie: local setup, branch flow, commit conventions, and the gates a PR must pass before merge.

## Local setup

1. Install Node 20 (see `.nvmrc`) and run `npm install`.
2. Copy `.env.example` / `.env.local.example` and fill in values — see `docs/LOCAL_DEV.md` and `docs/standards/configuration.md`.
3. Start local services: `npm run db:start` (Postgres + Mailpit).
4. Run the dev server: `npm run dev` (http://localhost:4321).

## Branch & PR flow

1. Branch from `main`: `feat/<issue>-<slug>` (e.g. `feat/63-admin-annulation-avoir-credit-rdv`).
2. Open a PR against `main` linking the issue.
3. CI (`.github/workflows/ci.yml`) runs **lint → test → build** — all three are blocking. `typecheck` is advisory until the residual `astro check` errors clear (issue #68).
4. Merge to `main` deploys to Netlify automatically.

Worktrees for parallel work live under `.claude/worktrees/` (gitignored, never committed); bootstrap one with `tools/worktree-setup.sh`, clean up with `tools/worktree-teardown.sh`.

## Gates before opening a PR

```bash
npm run lint         # eslint
npm run test         # vitest run — add/adjust unit tests for behaviour changes
npm run build        # production build must pass
npm run typecheck    # advisory, but keep it from getting worse
```

**UI/visual changes additionally require `npm run audit:a11y`** (Pa11y, WCAG 2.1 AA) with the dev server running — accessibility is a hard requirement, not a nice-to-have. Manual keyboard/screen-reader spot-checks for new interactive components: see `docs/standards/frontend-patterns.md`.

## Commit conventions

- **Language: French, present tense** — « Ajoute » not « Ajouté », « Corrige » not « Correction de ».
- Conventional-commit style prefixes as used in history: `feat`, `fix`, `refactor`, `docs`, `chore`, with optional scope — e.g. `fix(email): conditionner message paiement sur mode vidéo`.
- One logical change per commit; the subject line finishes the sentence "this commit…".

## Language conventions

| What | Language |
|------|----------|
| Code, types, comments, docs | English |
| User-facing text (UI labels, error messages, emails) | **French** |
| Commit messages | French, present tense |

## Code standards

Read before touching an area — the map lives in `AGENTS.md` ("Before editing sensitive areas"):

- `docs/standards/backend-patterns.md` — API routes and server modules
- `docs/standards/frontend-patterns.md` — Astro/React components, islands hydration
- `docs/standards/testing.md` — Vitest unit tests, Playwright e2e
- `docs/standards/code-review.md` — what reviewers look for
- `docs/standards/configuration.md` — env vars, secrets, migrations

Formatting is Prettier (`npm run format`), linting is ESLint (`npm run lint`). Don't reintroduce `react-router-dom` / `react-helmet-async` (aliased out) or framer-motion animations on touch devices (see `AGENTS.md` gotchas).

## Release & deploy

There is no versioned release train: every merge to `main` deploys to production via Netlify. `release:` in `.dev/stack.yml` reflects this (`model: trunk`, `class: NONE`). Rollbacks are done through the Netlify UI (previous deploy).
