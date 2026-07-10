# Architecture

> High-level system design for omf-therapie. For ADRs see `docs/architecture/adr/`. For deeper context, `memory-bank/architecture.md` is the canonical narrative.

## Overview

OMF Therapie is a **single-app Astro 5 website** (not a monorepo) for a one-person therapy practice. It is statically generated (SSG) by default, with **SSR API routes** (`src/pages/api/**`) hosted on Netlify for booking, auth, payments, and email. React is hydrated client-side only where interactivity is required (Astro Islands Architecture).

The system is **decomposed by domain, not by layer** (ADR-001): every business capability — appointment, payment, calendar, email, auth, patient/admin, blog, contact — lands as one slice composed of a `lib/*` module + `types/*` + `pages/api/*` endpoint + `components/*`. Cross-cutting concerns (auth, rate-limit, secure-links, analytics) live as infrastructure-shaped libs that domains import rather than re-implement.

## Layers (Astro strata, fixed by framework)

| Layer | Path | Role |
|-------|------|------|
| Pages (SSG) | `src/pages/**.astro` | One file = one URL. Server-rendered to static HTML at build. |
| Pages (SSR API) | `src/pages/api/**.ts` | Hybrid endpoints — patient booking, admin actions, webhooks. |
| Components | `src/components/{domain}/` | Astro components (static) + React islands (hydrated). |
| Islands | `src/components/islands/` | React components receiving `client:*` directives. |
| Server libs | `src/lib/**.ts` | **Server-only.** Domain primitives + infra concerns. Never imported from client. |
| Hooks | `src/hooks/` | React hooks — islands only. |
| Emails | `src/emails/` | React Email templates → Nodemailer (dev) / Resend (prod). |
| Types | `src/types/` | Domain-partitioned type definitions. |
| Content | `src/content/blog/` | Markdown posts via Content Collections (Zod-validated). |
| Config | `src/config/` | Site metadata, footer links. |
| Layouts | `src/layouts/` | `Layout.astro` (base), `ServiceLayout.astro`. |
| Utils | `src/utils/` | Helpers (schema.ts, date.ts, blogApi.ts). |

## Domains (the multiplying axis)

**Business domains** (grow over time — each new capability lands here):

| Domain | Lib(s) | API endpoint(s) | Notes |
|--------|--------|-----------------|-------|
| appointment/booking | `appointment-conflicts.ts`, `appointment-eligibility.ts`, `manual-slots.ts` | `api/appointments/`, `api/admin/appointments/`, `api/availability.ts` | Status flow: `pending → confirmed \| declined \| rescheduled → payment_pending → payment_received \| cancelled` |
| payment | `stripe.ts`, `pricing.ts`, `credits.ts` | `api/stripe-webhook.ts` | Stripe video-only; `payment_received` = paid (Stripe **or** avoir); no real refunds |
| calendar | `google-calendar.ts`, `calendar-cache.ts`, `ics.ts` | `api/admin/google-oauth/`, `api/calendar/invite/` | Google Calendar API + Meet; `GOOGLE_CALENDAR_MOCK=true` in dev |
| email | `resend.ts`, `emails/*` | (composed into other endpoints) | Resend (prod) / Mailpit (dev) |
| patient / admin | `authz.ts` | `api/admin/patients.ts` | Admin-only operations |
| blog | (Content Collections) | `blog/[slug].astro`, `blog/index.astro` | Static pre-rendered |
| contact | (EmailJS, client-side) | `api/contact.ts` | No backend persistence |
| services | (static) | `services/*.astro` | Marketing pages |

**Infrastructure domains** (must stay concern-shaped, free of business logic):

| Domain | Lib | Role |
|--------|-----|------|
| auth | `auth.server.ts`, `auth.ts`, `auth.client.ts`, `authz.ts` | BetterAuth (monocompte) + session checks |
| persistence | `supabase.ts` | PostgREST / Supabase client |
| rate-limit | `rate-limit.ts` | API rate limiting |
| secure-links | `secure-links.ts` | Signed tokens for patient actions |
| analytics | `analytics.ts` | GA4 (partytown) |

## Request lifecycle (booking example)

```
Patient → /rendez-vous/ (Astro SSG wizard)
       → POST /api/appointments/         (status=pending)
       → PostgreSQL + email (admin notif)
       → Admin acts at /mes-rdvs/        (BetterAuth session)
       → PATCH /api/appointments/[id]/   (confirm | decline | reschedule | cancel | reschedule_paid)
       → If video: Stripe Payment Link → patient pays → /api/stripe-webhook → status=payment_received
       → If avoir applied: consume_credits RPC (FIFO) → status=payment_received (no Stripe)
```

## Deployment

- **Platform:** Netlify (auto-deploy from `main`)
- **Build:** `npm run build` → `dist/`
- **CI gate** (`.github/workflows/ci.yml`): `lint → test → build` blocking; `typecheck` advisory (see #68)
- **Node:** 20 (`.nvmrc`, matches `netlify.toml`)
- **Branch protection:** require `CI / build` after first run on `main`

See `docs/guides/deployment.md` for prod setup and `docs/INFRA.md` for infra env vars.

## Key decisions

See `docs/architecture/adr/` and `memory-bank/decisions.md`. Highlights:

- **ADR-001:** Domain is the primary axis of decomposition (not layer, not adapter).
- **ADR-013:** `trailingSlash: 'always'` — every client-side URL ends with `/`.
- **ADR-014:** Stripe only for `appointment_mode = 'video'`.
- **ADR-015:** Internal avoirs (credits) instead of Stripe refunds.
- **ADR-016:** CI blocking (lint+test+build), typecheck advisory.
