# Troubleshooting

> Common issues and fixes. For local dev setup see `docs/LOCAL_DEV.md`; for prod infra see `docs/INFRA.md`.

## Local dev

### `Unexpected token '<'` in a fetch response

**Cause:** missing trailing slash on the URL (ADR-013). Astro returns an HTML redirect page instead of JSON.

**Fix:** ensure every `fetch()` and `window.location.href` ends with `/`:
```ts
fetch("/api/appointments/", { ... })              // ✅
fetch(`/api/appointments/${id}/`, { ... })        // ✅
```

> Note: `astro.config.mjs` has `trailingSlash: 'ignore'` but ADR-013 + the codebase enforce `'always'`. Follow the convention.

### BetterAuth `INVALID_ORIGIN` at login

**Symptom:** `{"message":"Invalid origin","code":"INVALID_ORIGIN"}`.

**Cause:** browser connects via `http://localhost:4321` but `BETTER_AUTH_URL=http://127.0.0.1:4321` (different origins).

**Fix:** both origins are in `trustedOrigins` (`src/lib/auth.server.ts`). Set `BETTER_AUTH_URL=http://localhost:4321` in `.env`.

### Database won't start

```bash
docker compose logs postgres
# If SQL error on startup: drop volume and recreate
docker compose down -v && docker compose up -d
```

### `auth.handler()` returns 500

Verify `DATABASE_URL` in `.env` points to `localhost:5432` and Docker is running:
```bash
docker compose ps   # postgres must be "healthy"
```

### Emails not arriving

Open **Mailpit** at `http://localhost:8025`. Verify `SMTP_HOST=localhost` and `SMTP_PORT=1025` in `.env`.

### RDV slots empty

Verify `GOOGLE_CALENDAR_MOCK=true` in `.env`. In mock mode, only **Wednesdays** have available slots.

### Stripe payments not working

With `STRIPE_SECRET_KEY=sk_test_placeholder`, **Stripe mock mode** is active — payment links are fictional, no real API calls. To test the real flow, get test keys at [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys).

### `db:reset` didn't apply later migrations

`npm run db:reset` only replays `001_init.sql`. Migrations `002`–`008` (including `008_credits.sql` for the avoir system) must be applied manually:
```bash
docker compose exec postgres psql -U postgres -d omf_therapie -f /path/to/migrations/008_credits.sql
```
Or apply each in order after reset.

### Avoirs / credits flow broken locally

The credits system (`008_credits.sql`) must be applied. After `db:reset`, manually apply `002` through `008`. Symptoms: `consume_credits` RPC not found, `credits` table missing, `credit_applied` column absent.

## CI

### Typecheck fails with ~20 errors but CI is green

This is expected (PR #85). Typecheck runs as `typecheck-advisory` with `continue-on-error: true`. The 20 residual errors are library-typing mismatches (googleapis, better-auth, stripe version drift, react-email) tracked in issue #68. Don't add **new** type errors; fixing existing ones is appreciated but out of scope for most PRs.

### `.nvmrc` or `.github/workflows/ci.yml` missing locally

Your local `main` is behind `origin/main`. Run `git pull` / rebase. These files exist on `origin/main` (merged in PR #85).

### CI build job fails on `npm install`

Likely `package-lock.json` desync. Reconcile with `npm install` (don't delete the lockfile). PR #66 reconciled a prior desync.

## Build

### `astro build` fails on `react-router-dom` / `react-helmet-async`

These legacy deps are no longer installed but referenced by old components. `astro.config.mjs` aliases them to `/dev/null` to suppress errors. Don't reintroduce them — if you hit this, you've likely imported a legacy component that should be migrated.

### `framer-motion` SSR/hydration race (opacity:0 content stuck invisible)

Use `client:idle` instead of `client:load` for below-fold motion sections. The race: `opacity:0` initial state becomes visible before JS hydrates. `client:idle` avoids this.

## Production

### Deploy succeeded but page 404s

Check `netlify.toml` redirects — legacy SPA paths (`/Tarifs`, `/Services`, etc.) are redirected. If you created a new page at one of these paths, the redirect wins. Use a different URL.

### Stripe webhook not updating status

1. Stripe Dashboard → Webhooks → check if events are being delivered (200 response).
2. Verify `STRIPE_WEBHOOK_SECRET` matches the live endpoint's signing secret.
3. Check Netlify function logs for `/api/stripe-webhook` errors.

### Google Calendar sync broken (prod)

Likely OAuth token expired. The `CalendarAuthAlert` email notifies when auth fails. Re-authorize via `/mes-rdvs/` → Google Calendar reconnect flow (`api/admin/google-oauth/`).

## AI Quick Reference

- **ALWAYS** check for missing trailing `/` first when debugging `Unexpected token '<'` errors.
- **ALWAYS** apply migrations 002–008 manually after `npm run db:reset` (only `001_init.sql` is replayed).
- **NEVER** delete `package-lock.json` to fix install errors — run `npm install` to reconcile.
- **ALWAYS** check `GOOGLE_CALENDAR_MOCK` value when slots behave unexpectedly (mock = Wednesdays only).
- **ALWAYS** suspect local `main` drift when CI/nvmrc files are missing locally (run `git pull`).
- **NEVER** reintroduce `react-router-dom` or `react-helmet-async` — they're legacy, aliased to `/dev/null`.
- **PREFER** `client:idle` over `client:load` for below-fold framer-motion sections (avoids hydration race).
