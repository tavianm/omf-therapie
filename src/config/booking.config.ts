/**
 * Booking availability switch — maternity-leave closure.
 *
 * BOOKING_OPEN is the single switch behind EVERY paused surface of
 * /rendez-vous: the header subtitle, the meta/og/twitter descriptions (one
 * prop ternary), the BookingWizard island (vs the closure card), the JSON-LD
 * ReserveAction and the error-banner link. It also gates the public booking
 * endpoint (POST /api/appointments/ → 503, see BOOKING_PAUSED_MESSAGE) —
 * hiding the wizard is not enforcement. Flipping it back is the whole reopen
 * procedure.
 *
 * Reopen procedure (January 2027) — fully mechanical, in order:
 *  1. Flip BOOKING_OPEN to true below — nothing else. Every paused surface is
 *     behind this switch and the true branches emit the exact pre-pause
 *     markup, so the reopened page diffs clean against the baseline.
 *  2. Run the gates: npm run test:low, then npm run lint, npm run typecheck,
 *     npm run build.
 *  3. npm run audit:a11y against a running dev server (npm run dev) — the
 *     flip returns the BookingWizard UI to a production page, so it is a UI
 *     PR and the WCAG audit is a hard requirement (AGENTS.md).
 *  4. node scripts/diff-html-170.mjs — expected, VERIFY: "OK: 0
 *     non-allowlisted diffs" with NO allowlist edit, because the
 *     /rendez-vous/ closure entries stop matching once their hunks vanish
 *     (only the universal WS </body> entry still applies, as on every page).
 *     If any residual hunk appears it is real drift — investigate, do not
 *     allowlist blindly. Optionally delete the now-dead /rendez-vous/
 *     entries in the same commit to keep the audit trail short.
 *  5. npx playwright test e2e/smoke.spec.ts — the branched test resumes
 *     asserting the wizard automatically (it imports this same const); the
 *     branched unit test tests/unit/appointments-pause.test.ts likewise
 *     resumes asserting the open path (422 on an empty body).
 *  6. French present-tense commit, merge to main → Netlify auto-deploys.
 *
 * Known open question, verified only by the first post-flip build:
 * conditional island rendering ({BOOKING_OPEN ? <BookingWizard client:load />
 * : …}) is unconfirmed on this repo's Astro setup — if the island still ships
 * while paused, treat it as a build-behaviour question, not a reason to
 * restructure the page.
 *
 * This module must stay import-free: e2e/smoke.spec.ts loads it as a RUNTIME
 * module through Playwright's transform, not just through Astro.
 */

/** false while the practice is on maternity leave; flip to true to reopen. */
export const BOOKING_OPEN = false;

/**
 * Resume wording (#184 update): the ONLINE-booking reopen date is
 * deliberately not promised anywhere. Slots are announced from
 * mid-January, under-promising on purpose (opening earlier than announced
 * is fine; later is not); the reservation reopen stays undated until the
 * therapist decides.
 */
export const BOOKING_SLOTS_RESUME_HINT = 'à partir de mi-janvier 2027';

/**
 * 503 body sent by POST /api/appointments/ while paused. Composed from the
 * hint so the reopen date lives in exactly one place. The admin journey
 * (/api/admin/appointments/) and the availability endpoint deliberately
 * ignore the pause (the workbench keeps booking manually).
 */
export const BOOKING_PAUSED_MESSAGE = `Les nouvelles demandes de rendez-vous sont en pause (congé maternité). Les créneaux reprendront ${BOOKING_SLOTS_RESUME_HINT} ; la date de réouverture des réservations en ligne n'est pas encore fixée. Oriane reste joignable via la page contact.`;
