# Deployment Guide

> How omf-therapie ships to production. For local dev setup see `docs/LOCAL_DEV.md`; for infra/env vars see `docs/INFRA.md`.

## Platform

- **Netlify** — auto-deploys from `main` on push.
- **Build command:** `npm run build` (`astro build` → `dist/`)
- **Publish directory:** `dist/`
- **Node version:** 22.23.2 (root `.nvmrc`; Netlify resolves it natively — no `NODE_VERSION` in `netlify.toml`)
- **Custom domain:** omf-therapie.fr (CNAME in `public/`)
- **Adapter:** `@astrojs/netlify` — generates `_redirects` + edge functions for SSR API routes.

> **CI gate** (`.github/workflows/ci.yml`): the `build` job runs `lint → test → build → diff HTML` and the separate `typecheck` job also blocks merges. **Branch protection** (manual): require `CI / build` + enable "Dismiss stale pull request approvals" in Settings → Branches.

## Pre-deploy checklist

Before merging to `main`:

- [ ] `npm run lint` ✅
- [ ] `npm run test` ✅ (Vitest)
- [ ] `npm run build` ✅ (local build succeeds)
- [ ] **UI/visual change:** `npm run audit:a11y` ✅ (WCAG 2.1 AA)
- [ ] **E2E-relevant change:** Playwright specs pass locally
- [ ] New env vars documented in `docs/INFRA.md` + set in Netlify (prod scope)
- [ ] **DB migration:** new `.sql` in `supabase/migrations/` → **applied to prod BEFORE the merge** (Netlify auto-deploys `main` the moment the PR merges — see below)

## Database migrations (manual)

Netlify does **not** run migrations — they're applied manually to the prod Postgres. **Order matters** (revue #149): Netlify auto-deploys `main` on merge, so the migration MUST reach prod **before** the dependent code is published, otherwise the endpoints that read the new tables/columns answer 500 (mutation endpoints fail closed; availability displays wrong data) until the schema catches up:

1. New migration file lands in `supabase/migrations/` (e.g. `008_credits.sql`).
2. **Before merging the PR** (or in the seconds before the Netlify publish goes live), apply it to the prod Supabase/Postgres via SQL editor or `psql`. The migrations are written idempotently (`IF NOT EXISTS` / `CREATE OR REPLACE`), so applying pre-merge is safe even if the PR is amended later.
3. Verify: run the checklist queries below, then a smoke test on the affected flow **right after merge** (booking POST, `/api/availability`, admin settings GET/PATCH for the scheduling migrations).
4. Rollback plan: Netlify deploy rollback reverts the code; the schema additions are backward-tolerant, so a code rollback never requires a schema rollback.

> ⚠️ **`npm run db:reset`** (local) drops the schema and replays **only `001_init.sql`**. Migrations 002–008 must be applied manually after reset. Do not run `db:reset` against prod.

## Environment variables

Prod env vars are set in Netlify: **Site settings → Environment variables**. Variables that differ between deploy contexts (`deploy-preview` vs `production`) must be scoped per-context.

See `docs/INFRA.md` for the full list. Critical ones:

| Var | Prod value |
|-----|------------|
| `DATABASE_URL` / `SUPABASE_DATABASE_URL` | Prod Postgres connection string |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only, never `PUBLIC_`) |
| `BETTER_AUTH_SECRET` | Strong random secret |
| `BETTER_AUTH_URL` | `https://omf-therapie.fr` |
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (live) |
| `RESEND_API_KEY` | Prod Resend key |
| `GOOGLE_CALENDAR_*` / `GOOGLE_OAUTH_*` | Service account / OAuth creds |
| `GOOGLE_CALENDAR_MOCK` | `false` in prod |

## Stripe webhook (prod)

- **Endpoint:** `https://omf-therapie.fr/api/stripe-webhook`
- **Events:** payment confirmation → status `payment_received`.
- Configure in Stripe Dashboard → Webhooks → Add endpoint with the live URL + `STRIPE_WEBHOOK_SECRET`.

## DNS / redirects

- Legacy SPA paths (`/Tarifs`, `/Services`, `/About`, `/Process`, `/Formations`) redirected via `[[redirects]]` in `netlify.toml`.
- Sitemap (`@astrojs/sitemap`) auto-generated at build, filtered to exclude legacy paths.

## Post-deploy verification

After a deploy:

1. Visit `https://omf-therapie.fr/` — homepage loads, no console errors.
2. Test the booking wizard end-to-end (`/rendez-vous/`).
3. If auth-related: log in at `/login/` → `/mes-rdvs/` loads.
4. If Stripe-related: confirm webhook receives events (Stripe Dashboard → Webhooks → logs).
5. If migration applied: smoke-test the affected flow.

## Rollback

- Netlify keeps deploy history — **Deploys** tab → "Publish" a previous deploy to roll back instantly.
- For DB changes: have a down-migration or backup ready before applying prod migrations.

## AI Quick Reference

- **ALWAYS** apply new DB migrations manually to prod after merge (Netlify doesn't run them).
- **NEVER** run `npm run db:reset` against prod (drops schema, only replays `001_init.sql`).
- **ALWAYS** set new env vars in Netlify with the correct scope (`production` vs `deploy-preview`).
- **NEVER** prefix server-only env vars with `PUBLIC_` (they'd ship to the client).
- **ALWAYS** confirm `GOOGLE_CALENDAR_MOCK=false` in prod (otherwise fictional slots).
- **ALWAYS** require `CI / build` green before merge (after branch protection is enabled).
