# Integration

## External services

- `src/lib/supabase.ts` serves appointment and credit persistence through Supabase/PostgREST.
- `src/lib/stripe.ts` creates payment links for video appointments; `api/stripe-webhook` records completed payment.
- `src/lib/google-calendar.ts` reads availability and creates calendar events; a local mock provides fictional Wednesday slots.
- `src/lib/resend.ts` sends production email; development routes mail through Mailpit using Nodemailer.
- Sentry records production errors when its DSN is configured.

## Calling conventions

- Keep service credentials in environment variables, never in client code.
- Placeholder Stripe credentials activate a local mock rather than making real API calls.
- Paid appointment changes must preserve credit and payment invariants; use the established appointment actions rather than direct status changes.
