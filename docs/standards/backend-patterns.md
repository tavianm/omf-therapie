# Backend Patterns

> Conventions for `src/pages/api/**` endpoints and `src/lib/**` server modules. Astro SSR via Netlify adapter (hybrid: `output: 'static'` + SSR API routes).

## API route structure

API routes live in `src/pages/api/` and export HTTP-method named functions:

```ts
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request, params }) => { /* ... */ };
export const POST: APIRoute = async ({ request }) => { /* ... */ };
export const PATCH: APIRoute = async ({ request, params }) => { /* ... */ };
```

**Routing:** Astro file-based. `src/pages/api/appointments/[id].ts` → `PATCH /api/appointments/:id/`. Dynamic segments use `[param]` syntax.

## Database access

- **No ORM** (stack.yml: `orm: none`). Raw SQL via `@supabase/supabase-js` (PostgREST) or `pg`.
- Client: `src/lib/supabase.ts` — exports the singleton; import it, don't instantiate per-request.
- Migrations: `supabase/migrations/*.sql`, sequenced (`001_init.sql` → `008_credits.sql`).
- **`db:reset` only replays `001_init.sql`** — migrations 002–008 must be applied manually after.
- Money: stored ×100 (centimes) as integers. Convert on read/write.

## Auth & authorization

- **BetterAuth** (`src/lib/auth.server.ts`) — session-based, PostgreSQL backend. Monocompte (one practitioner; `beforeUserCreated` blocks signups).
- Session check pattern:
  ```ts
  const session = await auth.api.getSession({ headers: request.headers });
  if (!isAdminSession(session)) return new Response("Unauthorized", { status: 401 });
  ```
- `src/pages/api/admin/**` — **always** verify session. No exceptions.
- `src/pages/api/auth/[...all].ts` — BetterAuth handler (login, logout, session refresh).
- Trusted origins declared in `auth.server.ts` (`trustedOrigins`): `localhost:4321` + `127.0.0.1:4321` for dev.

## Cross-cutting concerns (import, never re-implement)

| Concern | Lib | Symbol |
|---------|-----|--------|
| Admin session check | `src/lib/authz.ts` | `isAdminSession(session)` |
| Rate limiting | `src/lib/rate-limit.ts` | `checkRateLimit(...)` |
| Signed links | `src/lib/secure-links.ts` | `createSecureLinkToken(...)` |
| Stripe | `src/lib/stripe.ts` | (domain-specific) |
| Email transport | `src/lib/resend.ts` | (domain-specific) |
| Google Calendar | `src/lib/google-calendar.ts` | (domain-specific) |

Re-implementing any of these inside a business domain is the **layer-pollution anti-pattern** (ADR-001).

## Idempotency & money

- Stripe webhook: dedupe by event ID; treat `payment_received` as the idempotent "paid" state.
- Avoir emission: idempotent via `UNIQUE(source_appointment_id)` constraint on `credits`.
- Credit consumption: FIFO via `consume_credits` RPC (`SECURITY DEFINER`, `REVOKE EXECUTE FROM PUBLIC`) — atomic, no race.
- Credit restoration: `restore_credits` RPC when an RDV created with an avoir is itself cancelled.

## Error handling

- Return `Response` with explicit status codes (`401`, `404`, `409`, `500`).
- Never leak stack traces to the client — log server-side, return generic French message.
- Validation: Zod for inbound payloads; reject early with `400` + French message.
- Money/state errors: log + `409 Conflict` (don't silently succeed on inconsistent state).

## Environment

- All env access via `import.meta.env.*` (Astro convention), typed in `src/types/env.d.ts` if present.
- Server-only vars (Supabase service role, Stripe secret, Resend key) must **never** be prefixed `PUBLIC_` — they'd ship to the client.
- Mocks: `STRIPE_SECRET_KEY=sk_test_placeholder` → Stripe mock; `GOOGLE_CALENDAR_MOCK=true` → fictional Wednesday slots.

## AI Quick Reference

- **ALWAYS** verify the session in `src/pages/api/admin/**` via `auth.api.getSession()` + `isAdminSession()`.
- **ALWAYS** use the singleton `supabase` client from `src/lib/supabase.ts` — never instantiate per-request.
- **ALWAYS** apply migrations manually after `npm run db:reset` (only `001_init.sql` is replayed).
- **NEVER** re-implement `isAdminSession`, `checkRateLimit`, `createSecureLinkToken` — import from canonical libs.
- **NEVER** ship secrets: server-only env vars must not be prefixed `PUBLIC_`.
- **NEVER** issue a real Stripe refund — emit an internal avoir instead.
- **ALWAYS** make money/state mutations idempotent (unique constraint or RPC).
- **ALWAYS** return explicit HTTP status codes with French user-facing messages on errors.
