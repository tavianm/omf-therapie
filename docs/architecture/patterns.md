# Patterns

> Recurring code patterns in omf-therapie. Concrete rules agents must follow, derived from CLAUDE.md, ADR-001, and codebase inspection.

## Domain slice composition

Every business capability is a **slice**, not a layer. Adding a new domain means one row across the existing layers — never a new top-level directory.

```
New domain "intake-forms" →
  src/lib/intake-forms.ts          (server primitive)
  src/types/intake-form.ts         (types)
  src/pages/api/intake-forms/      (endpoints)
  src/components/intake-forms/     (UI)
  supabase/migrations/009_*.sql    (schema)
```

**Compose, don't duplicate.** A domain endpoint imports cross-cutting concerns from their canonical infra libs:

```ts
// ✅ Compose
import { isAdminSession } from "@/lib/authz";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSecureLinkToken } from "@/lib/secure-links";

// ❌ Never re-implement inside a business domain
function isAdminSession() { /* ... */ } // layer-pollution anti-pattern
```

## Astro Islands hydration

Pick the directive by interactivity timing:

| Directive | When | Example |
|-----------|------|---------|
| `client:load` | Above-fold, hydrate immediately | Navbar, contact form |
| `client:idle` | Below-fold, hydrate when idle (**preferred**) | Most islands |
| `client:visible` | Hydrate on viewport entry | Avoid with `useMotionVariants` (visible snap on mobile) |

**Rule:** only components in `src/components/islands/` (and React components reached via islands) get `client:*` directives. Everything else is server-rendered `.astro`.

## Trailing slash (ADR-013, hard rule)

Every client-side URL ends with `/`:

```ts
fetch("/api/appointments/", { ... })              // ✅
fetch(`/api/appointments/${id}/`, { ... })        // ✅
window.location.href = "/mes-rdvs/"               // ✅
```

Without it, Astro returns an HTML redirect page instead of JSON → `Unexpected token '<'`.

> **Note:** `astro.config.mjs` currently has `trailingSlash: 'ignore'`, but ADR-013, `memory-bank/decisions.md`, and every existing `fetch()` enforce `'always'`. Follow the convention.

## Server/client boundary

`src/lib/**` is **server-only**. The build will fail (or ship secrets) if a client island imports from it.

| From → To | Allowed? |
|-----------|----------|
| `.astro` page → `lib/` | ✅ (page runs on server) |
| `.astro` page → `components/` | ✅ |
| API route → `lib/` | ✅ |
| Island (React) → `lib/` | ❌ server-only |
| Island → `hooks/`, `types/`, `utils/` | ✅ (these are isomorphic) |

## Admin endpoint pattern

Every endpoint under `src/pages/api/admin/**` must verify the session:

```ts
import { auth } from "@/lib/auth.server";
import { isAdminSession } from "@/lib/authz";

export const POST: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!isAdminSession(session)) return new Response("Unauthorized", { status: 401 });
  // ...
};
```

No exceptions. The `beforeUserCreated` BetterAuth hook blocks all signups — auth is **monocompte** (one practitioner).

## Status state machine (appointments)

```
pending ──→ confirmed (présentiel)
        ├──→ declined
        ├──→ rescheduled ──→ (patient accepts at /rdv/accepter-report/[id]/)
        └──→ payment_pending ──→ payment_received (Stripe or avoir)
                              └──→ cancelled (emits avoir if payment_received)
```

- `payment_received` = "séance réglée" (unified — Stripe **or** internal credit). Do **not** use `confirmed` for paid video RDVs.
- `cancelled` is reachable from most active states; cancelling a `payment_received` video RDV emits an avoir (`credits`/`credit_usages` tables).
- `reschedule_paid` action: reschedules a paid video RDV without re-charging.

## Stripe / payment rules

- Stripe Payment Links **only** for `appointment_mode = 'video'` (ADR-014). In-person is paid on-site.
- **No real Stripe refunds** (ADR-015). Cancellation of a paid RDV → internal avoir (FIFO via `consume_credits` RPC).
- Mock mode: `STRIPE_SECRET_KEY=sk_test_placeholder` → fictional payment link, no real API call.
- Manual creation with avoir (admin): if balance due = 0 → `payment_received`/`confirmed` with no Stripe link; else Stripe link for the remainder only.

## Email rules

- Templates in `src/emails/` (React Email).
- Transport: Nodemailer → Mailpit (`localhost:1025`) in dev; Resend API in prod.
- **Cancellation email** (`AppointmentCancelled`) may mention "avoir" but **never** "remboursement".

## AI Quick Reference

- **ALWAYS** end client-side URLs (fetch, `window.location.href`) with a trailing `/`.
- **ALWAYS** verify the session in `src/pages/api/admin/**` endpoints via `auth.api.getSession()` + `isAdminSession()`.
- **NEVER** import from `src/lib/` inside a React island or any client-shipped code.
- **NEVER** issue a real Stripe refund — emit an internal avoir (`credits`/`credit_usages`) instead.
- **NEVER** re-implement `isAdminSession`, `checkRateLimit`, or `createSecureLinkToken` inside a business domain — import from their canonical `src/lib/*`.
- **ALWAYS** co-locate a new domain's files across `lib/` + `types/` + `pages/api/` + `components/` (slice, not layer).
- **PREFER** `client:idle` for below-fold islands; avoid `client:visible` with `useMotionVariants`.
- **NEVER** add a new top-level `src/` directory for a feature — extend an existing layer.
- **ALWAYS** write user-facing text, error messages, and emails in **French**; code/types/comments in English.
- **ALWAYS** run `npm run audit:a11y` before a UI/visual PR.
