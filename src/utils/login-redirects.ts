/**
 * Single source of truth for the admin login redirects (SC7, issue #165).
 *
 * Consumed by BOTH the SSR guard (`src/pages/poste-travail.astro`) AND the
 * client-side polling hook (`src/hooks/useAppointmentsPolling.ts`) so the
 * two redirects can never drift apart — a mirror pinned by
 * tests/unit/login-redirects.test.ts.
 *
 * Client-safe by design: zero imports. Lives in src/utils/ (never src/lib/**,
 * which is server-only and forbidden in islands).
 */

/** Session missing/expired → login, then come back to the workbench. */
export const LOGIN_PATH_UNAUTHENTICATED = '/login/?redirect=/poste-travail/';

/** Authenticated but non-admin → login with the "access denied" error. */
export const LOGIN_PATH_FORBIDDEN = '/login/?error=acces-refuse';
