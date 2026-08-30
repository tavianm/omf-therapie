# Auth

## Authentication

- Better Auth uses an email-and-password session backed by PostgreSQL; configuration is server-only in `src/lib/auth.server.ts`.

## Authorization

- The system is monocompte: only the practitioner account is permitted.
- `api/admin` routes verify the session through `auth.api.getSession()`.

## Sessions

- Sessions use secure, HTTP-only cookies in production and expire after seven days with daily refresh eligibility.
