# API

## Style

- Astro server routes under `src/pages/api/` provide JSON APIs; they are not pre-rendered.
- Browser requests and redirects use trailing-slash URLs.

## Resources

- Appointment creation and patient actions are under `api/appointments`.
- Availability, contact, Stripe webhooks, and calendar invitations are dedicated endpoints.
- `api/admin` exposes protected appointments, patients, credits, slots, and Google OAuth operations.

## Contracts

- JSON validation errors use an `error` message and may identify a `field`.
- Admin endpoints require a Better Auth session; patient-facing responses exclude admin-only data.
