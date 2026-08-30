# Review: PR #127 — Création RDV admin : post-INSERT + rattrapage invitations

- **Verdict**: changes-requested
- **Diff**: `3f327f5...abd7675`
- **Axes run**: code, functional, relevancy
- **Date**: 2026_08_28
- **Findings**: 0 critical, 4 warning, 0 minor

## Phases

### Phase V1 — Contrat L2 + migrations

- [x] Les migrations 012/013 sont idempotentes et le backfill 013 est non filtré — `supabase/migrations/012_credits_grants.sql:19`, `supabase/migrations/013_invitation_sent_at.sql:36`
- [x] `send_email=false` marque l’invitation, et également la confirmation pour un RDV réglé par avoir — `src/pages/api/admin/appointments/index.ts:203`

### Phase V2 — Découplage post-réponse

- [x] Le POST répond 201 après l’INSERT et diffère les appels externes via `waitUntil` ou le repli asynchrone — `src/pages/api/admin/appointments/index.ts:243`
- [x] Le chemin nominal exécute agenda, Stripe, email et écriture L2 dans cet ordre — `src/lib/notifications.ts:345`
- [ ] Tout échec post-réponse est rattrapable par le sweep — un échec d’API calendrier conserve `persistFailed=false`, l’email et le flag L2 sont alors validés, donc le sweep ne reverra jamais le RDV — `src/lib/notifications.ts:355`
- [x] L’erreur réseau/5xx de la modale est annoncée aux technologies d’assistance — `src/components/admin/AdminCreateButton.tsx:624`

### Phase V3 — Backstop sweep + refactors runtime

- [x] Le sweep est borné, filtre les RDV éligibles et délègue au pipeline avec le montant net d’avoir — `netlify/functions/reconcile-invitations.ts:232`
- [x] Le monitor Sentry, le schedule et les logs structurés par étape sont distincts — `netlify/functions/reconcile-invitations.ts:176`, `src/lib/notifications.ts:292`

## Findings

| Sev | Kind | Phase | Location | Issue | Fix |
| --- | ---- | ----- | -------- | ----- | --- |
| 🟡 | functional | V2 | `src/lib/notifications.ts:355` | Si `createCalendarEvent` échoue, `runStep` retourne `error` sans définir `persistFailed`; Stripe et l’email peuvent réussir, puis `invitation_sent_at` est écrit. Le sweep ne sélectionne ensuite plus ce RDV, qui reste sans événement Google/Meet. Le test encode ce comportement à `tests/unit/admin-appointment-side-effects.test.ts:335`. | Considérer tout échec S1/S2 comme non terminé pour L2 (laisser les flags NULL), ou stocker un état durable par étape et faire reprendre le sweep jusqu’à l’événement effectivement persisté. Ajouter le test de régression. |
| 🟡 | code | V3 | `src/lib/notifications.ts:352`, `netlify/functions/reconcile-invitations.ts:238` | `waitUntil` et le sweep peuvent lire simultanément un flag NULL et lancer chacun S1/S2 avant toute persistance; Google reçoit deux `events.insert` et Stripe peut créer deux Payment Links. La garde L2 finale ne déduplique que l’email/flag, trop tard pour ces effets externes. | Ajouter un claim atomique durable avant le pipeline, ou des gardes atomiques par effet, puis tester la course waitUntil↔sweep. |
| 🟡 | code | V3 | `src/lib/notifications.ts:522`, `netlify/functions/reconcile-invitations.ts:244` | Une livraison Resend réussie suivie d’un échec d’écriture de `invitation_sent_at` laisse la ligne sélectionnable pendant 48 h. La clé L1 Resend documentée est limitée à ~24 h, donc un passage tardif peut réexpédier l’invitation. | Garantir un marqueur durable d’envoi avant la fenêtre d’expiration L1, ou borner la fenêtre de sweep à la durée de déduplication; couvrir l’échec d’écriture L2 après succès Resend. |
| 🟡 | conform | V3 | `netlify/functions/reconcile-invitations.ts:140` | Le contrat T10 décrit `GOOGLE_CALENDAR_MOCK=true` comme un skip agenda, mais le no-op retourne un faux `eventId` qui est persisté par S1. Les exécutions ultérieures croient l’événement réel et le sautent. | Représenter explicitement le skip sans `eventId` persistant et faire journaliser S1 comme `skipped`; ajouter l’assertion de non-persistance. |

## Verification

| Metric | Value |
| --- | --- |
| Verified | 87.5% (7/8) |
| Files checked | 24 fichiers modifiés : plan/spec/frames/visuals, configuration Netlify, migrations, sources Astro/React/lib/cron et tests unitaires |
| Unchecked | SC3 — fix : la reprise doit compléter l’agenda après une erreur S1, sans désactiver le sweep |
| Unplanned | none |
