# AGENTS.md

Workspace instructions for ZCode agents working on **omf-therapie** — a therapy practice website (Astro 5 SSG + React islands + Tailwind). French-language site for a single practitioner (Oriane Montabonnet), deployed at omf-therapie.fr.

> **Read first for sensitive areas:** `CLAUDE.md` (conventions, commands), `memory-bank/architecture.md` (system design + data flow), `memory-bank/decisions.md` (ADRs), `.claude/stack.yml` (declared stack & commands). This file is a quick-reference layer on top of those.

## Commands

```bash
npm run dev              # Astro dev server (port 4321)
npm run build            # Production build (SSG → dist/)
npm run preview          # Preview built site
npm run lint             # ESLint (eslint.config.js, flat config)
npm run typecheck        # `astro check` — advisory in CI (see #68 for ~20 residual errors)
npm run test             # Vitest (tests/unit/**, node env)
npm run test:watch       # Vitest watch mode
npm run audit:a11y       # Pa11y WCAG audit (needs dev server running) — REQUIRED before UI PRs
npm run db:start         # Start Postgres + Mailpit via docker compose
npm run db:reset         # ⚠️ Drops & re-creates schema, replays ONLY 001_init.sql
```

**Run `npm run audit:a11y` before any UI/visual PR** — accessibility (WCAG 2.1 AA) is a hard requirement, not a nice-to-have.

**CI (`.github/workflows/ci.yml`, on `origin/main`):** `lint → test → build` is the blocking gate; `typecheck` runs as advisory (`continue-on-error: true`) until issue #68 clears residual type errors. Node 20 pinned via `.nvmrc` (matches `netlify.toml`). After the first workflow run on `main`, branch protection should require `CI / build`.

> **Drift note:** local `main` may lag `origin/main`. If `.nvmrc` or `.github/workflows/` are missing from your working tree, run `git pull` / rebase before assuming CI config.

## Architecture boundaries

**Astro SSG + Islands** — server-rendered `.astro` pages by default, React hydrated only where interactivity is needed.

```
src/
├── pages/              # Astro file-based routes — each .astro = one URL
│   ├── api/            # SSR API endpoints (NOT pre-rendered)
│   │   ├── admin/      # Admin-only (auth required): appointments, patients, time-slots, google-oauth
│   │   ├── appointments/  # Patient-facing booking CRUD + actions
│   │   ├── auth/[...all].ts     # BetterAuth handler
│   │   ├── availability.ts      # Slots (Google Calendar mock or real)
│   │   └── stripe-webhook.ts    # Stripe → status updates
│   ├── rendez-vous.astro  # Patient booking wizard (multi-step)
│   ├── mes-rdvs.astro     # Admin dashboard (BetterAuth-gated) — <AppointmentsManager> island
│   ├── rdv/               # Post-booking patient pages (accepter-report, merci)
│   └── blog/, services/   # Marketing/content
├── components/
│   ├── islands/        # React components receiving client:* directives (Navbar, BlogClientWrapper, AppointmentsManager)
│   ├── admin/          # Admin UI (auth-required context only)
│   └── ...             # home/, blog/, contact/, footer/, navigation/, pricing/
├── lib/                # SERVER-side only — never import from client islands
│   ├── auth.server.ts        # BetterAuth config (monocompte — single practitioner)
│   ├── supabase.ts, stripe.ts, google-calendar.ts, resend.ts
│   ├── credits.ts            # Internal credit (avoir) system — FIFO via Postgres RPC
│   ├── appointment-eligibility.ts  # Pure module — cancel/reschedule rules (unit-tested)
│   └── secure-links.ts, rate-limit.ts, authz.ts
├── emails/             # React Email templates → Nodemailer (dev/Mailpit) / Resend (prod)
├── hooks/              # React hooks — islands only
├── content/blog/       # Markdown posts via Content Collections (Zod-validated)
├── types/, utils/, config/, layouts/
supabase/migrations/    # Postgres schema (001_init.sql → 008_credits.sql)
tests/unit/             # Vitest
e2e/                    # Playwright specs
```

**Layer rules:**
- `src/lib/**` is **server-only**. Never import from `src/components/islands/` or anything shipped to the browser.
- `.astro` pages can import from both `lib/` (server) and `components/` (client). They mediate.
- API routes under `pages/api/admin/**` must verify the session via `auth.api.getSession()` — no exceptions.
- Auth is **monocompte**: one practitioner account. The `beforeUserCreated` hook blocks signup.

## Critical conventions

**Trailing slash on every client-side URL** (ADR-013). Every `fetch()` and `window.location.href` MUST end with `/`:

```ts
fetch("/api/appointments/", ...)                      // ✅ trailing /
fetch(`/api/appointments/${id}/`, ...)                // ✅ template + trailing /
window.location.href = "/mes-rdvs/"                   // ✅
```

Without it, Astro returns an HTML redirect page instead of JSON → `Unexpected token '<'`. (Note: `astro.config.mjs` currently has `trailingSlash: 'ignore'`, but the codebase + ADR-013 enforce `'always'` as the de-facto rule — follow the convention regardless.)

**Language:**
- Code, types, comments → English
- User-facing text (UI labels, error messages, emails) → **French**
- Commit messages → **French, present tense** ("Ajoute" not "Ajouté")

**Styling:** Tailwind utility-first only. No custom CSS except base styles in `src/index.css`. No inline styles except dynamic values. Organize classes: layout → spacing → typography → colors → responsive.

**Imports:** path alias `@/*` → `./src/*` (configured in `tsconfig.json`). Both `@/lib/foo` and relative `../lib/foo` are used; relative imports are more prevalent — match the surrounding file.

**TypeScript:** strict mode, no `any`. Interfaces for objects, types for unions/primitives. Optional chaining + nullish coalescing preferred.

**Astro islands:** `client:load` (above-fold), `client:idle` (below-fold, preferred), `client:visible` (avoid with `useMotionVariants` — visible snap on mobile).

## Domain concepts agents must know

- **Appointment statuses:** `pending → confirmed | declined | rescheduled → payment_pending → payment_received | cancelled`
- **`payment_received`** = "séance réglée" (paid via Stripe **or** internal credit/avoir) — unified status, NOT `confirmed`.
- **Avoirs internes** (#63/#66): cancelling a paid video RDV emits an internal credit (`credits`/`credit_usages` tables, FIFO via `consume_credits` RPC) — **no real Stripe refund**. Admin-only; no patient self-service UI.
- **`reschedule_paid`** action: reschedules a paid video RDV without re-charging (avoids double-billing).
- Stripe only for `appointment_mode = 'video'`; in-person is paid on-site.
- Migration `008_credits.sql` must be applied manually — `npm run db:reset` only replays `001_init.sql`.

## Env vars (Astro `import.meta.env.*`)

Required for full functionality: `DATABASE_URL`, `SUPABASE_*` (database/anon/service-role), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `STRIPE_*` (secret/publishable/webhook-secret/success-url), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SMTP_HOST`/`SMTP_PORT` (dev: Mailpit), `GOOGLE_CALENDAR_*` / `GOOGLE_OAUTH_*`, `SITE_URL`. See `docs/LOCAL_DEV.md` for local setup and `docs/INFRA.md` for prod.

**Mocks when placeholders:** `STRIPE_SECRET_KEY=sk_test_placeholder` → Stripe mock (no real API calls). `GOOGLE_CALENDAR_MOCK=true` → fictional Wednesday slots.

## Gotchas

- **Local `main` drifts from `origin/main`.** Check `git log origin/main` before assuming what's merged. Recent merges (#85 CI, #66 avoirs, #65 /mes-rdvs redesign) may not be in your working tree.
- **`npm run db:reset` is destructive AND incomplete** — drops the schema and only replays `001_init.sql`. Migrations `002`–`008` must be applied manually after.
- **Astro static output** with Netlify adapter — API routes (`pages/api/**`) are SSR/hybrid despite `output: 'static'`.
- **Legacy SPA aliases** (`/Tarifs`, `/Services`, `/About`, `/Process`, `/Formations`) are filtered from the sitemap and redirected in `netlify.toml`. Don't recreate them.
- **`framer-motion`** animations are disabled on touch/WKWebView via `useMotionVariants` (returns `staticProps`). Use Tailwind `animate-spin` for continuous animations, never framer-motion.
- **`vite.config` aliases** null out `react-router-dom` and `react-helmet-async` (legacy deps no longer installed). Don't reintroduce them.

## Before editing sensitive areas

| Area | Read first |
|------|-----------|
| Appointment lifecycle, statuses, cancel/reschedule | `memory-bank/architecture.md` (Booking System), `src/lib/appointment-eligibility.ts`, `tests/unit/appointment-eligibility.test.ts` |
| Stripe / payments / avoirs | `memory-bank/decisions.md` ADR-014 (Stripe video-only), ADR-015 (avoirs); `src/lib/credits.ts`, `src/lib/stripe.ts` |
| Auth / admin routes | `src/lib/auth.server.ts`, `src/lib/authz.ts` — verify session pattern |
| DB schema / migrations | `supabase/migrations/` (apply in order; `008_credits.sql` is the latest) |
| SEO / structured data | `src/utils/schema.ts`, sitemap filter in `astro.config.mjs` |
| CI / deploy | `.github/workflows/ci.yml`, `netlify.toml` (after `git pull` if missing locally) |
