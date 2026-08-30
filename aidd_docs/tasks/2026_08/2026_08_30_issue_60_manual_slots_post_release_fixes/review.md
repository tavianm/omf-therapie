# Review: Issue #60 — correctifs post-release des plages horaires manuelles

- **Verdict**: blocked
- **Diff**: `origin/main...HEAD`
- **Axes run**: code, functional, relevancy
- **Date**: 2026_08_30
- **Findings**: 1 critical, 2 warning, 0 minor

## Phases

### Phase 1 — Typed errors + lib contract

- [x] **B5** — la plage de requête utilise les dates calendaires de Paris — `src/lib/manual-slots.ts:19`, `src/lib/manual-slots.ts:45`, `tests/unit/manual-slots.test.ts:101`
- [x] **Non-blocking** — les échecs d'invalidation du cache utilisent `console.error` — `src/lib/manual-slots.ts:160`

### Phase 2 — API status mapping

- [ ] **B2** — l'identifiant inexistant produit bien `NotFoundError`, mais une ligne déjà soft-deleted est mise à jour une seconde fois et retourne encore 204, faute de filtre `deleted_at IS NULL` — `src/lib/manual-slots.ts:122`
- [x] **B3** — PATCH/DELETE mappent uniquement `NotFoundError` vers 404 et conservent les autres erreurs en 500 — `src/pages/api/admin/time-slots/[id].ts:72`, `src/pages/api/admin/time-slots/[id].ts:111`, `tests/unit/admin-time-slots-api.test.ts:103`
- [x] **B4** — PATCH rejette `deleted_at` avant l'appel lib et le type ne l'expose plus — `src/pages/api/admin/time-slots/[id].ts:39`, `src/types/manual-slots.ts:17`, `tests/unit/admin-time-slots-api.test.ts:93`
- [x] **B6** — le code préserve/mappe `23505` en 409 et la migration 015 contient snapshot, déduplication et index partiel; preuve SQL statique, migration non appliquée localement — `src/lib/manual-slots.ts:80`, `src/pages/api/admin/time-slots/index.ts:133`, `supabase/migrations/015_manual_slots_unique.sql:14`, `tests/unit/admin-time-slots-api.test.ts:158`
- [x] **Authz regression** — PATCH/DELETE gardent les réponses 401 et 403 — `src/pages/api/admin/time-slots/[id].ts:23`, `tests/unit/admin-time-slots-api.test.ts:55`

### Phase 3 — Frontend robustness

- [x] **B7** — la suppression est gardée par `isDeleting`, annule après 10 s et affiche le message prévu — `src/components/admin/TimeSlotManager.tsx:175`, `src/components/admin/TimeSlotManager.tsx:179`, `src/components/admin/TimeSlotManager.tsx:430`
- [x] **B8** — les quatre chemins d'erreur passent par `response.text()` et un parse JSON sûr — `src/components/admin/TimeSlotManager.tsx:25`, `src/components/admin/TimeSlotManager.tsx:91`, `src/components/admin/TimeSlotManager.tsx:129`, `src/components/admin/TimeSlotManager.tsx:156`, `src/components/admin/TimeSlotManager.tsx:190`

### Phase 4 — A11y tablist

- [x] **B9** — flèches, Home/End, focus, activation et roving tabindex sont implémentés et couverts par le parcours Playwright 1/1 — `src/pages/mes-rdvs.astro:266`, `src/pages/mes-rdvs.astro:305`, `e2e/manual-slots.spec.ts:67`
- [ ] **Audit a11y** — la commande sort avec 0 sans faire échouer le processus sur les violations et le rapport fourni contient 51 erreurs et 598 avertissements; le critère « audit:a11y passes » n'est donc pas satisfait — `scripts/run-a11y-audit.mjs:35`, `scripts/run-a11y-audit.mjs:73`

### Phase 5 — Regression test

- [x] **B1** — le fixture place la coupure à mercredi 10:00, vérifie les créneaux filtrés/restants et le test échoue lors de la mutation annoncée — `tests/unit/google-calendar.test.ts:248`
- [x] **Lint** — 0 erreur et 10 avertissements préexistants selon la preuve fournie — `eslint.config.js:1`
- [x] **Tests** — 253/253 selon la preuve fournie; contrôle indépendant ciblé: 27/27 — `tests/unit/google-calendar.test.ts:248`, `tests/unit/manual-slots.test.ts:49`, `tests/unit/admin-time-slots-api.test.ts:55`

## Findings

| Sev | Kind | Phase | Location | Issue | Fix |
| --- | ---- | ----- | -------- | ----- | --- |
| 🔴 critical | functional | 2 | `src/lib/manual-slots.ts:129` | B2 exige 404 pour un identifiant manquant **ou déjà supprimé**; la requête ne filtre que `id`, donc un second DELETE retrouve la ligne soft-deleted, la remet à jour et l'API répond 204. | Ajouter le prédicat actif `deleted_at IS NULL` avant `.select().maybeSingle()` et couvrir explicitement deux DELETE successifs / une ligne déjà supprimée par un test lib ou API. |
| 🟡 warning | functional | 4 | `scripts/run-a11y-audit.mjs:35` | La preuve ne valide pas le critère `npm run audit:a11y passes`: le script compte les violations mais ne sort non-zéro que sur exception; le rapport contient 51 erreurs et 598 avertissements. | Faire échouer le gate sur les erreurs et obtenir un résultat conforme, ou formaliser une baseline/waiver explicite et une vérification a11y authentifiée de `/mes-rdvs/`; ne pas présenter le code de sortie actuel comme un audit vert. |
| 🟡 warning | rot | 2 | `artifacts/specs/60-manual-slots-post-release-fixes-spec.mdx:121` | Le frame, la spec et le plan prescrivent encore `012_manual_slots_unique.sql` / `_audit_012`, alors que 012–014 existent déjà et le candidat livre correctement `015_manual_slots_unique.sql`; les artefacts marqués à jour ne correspondent pas au livrable. | Remplacer toutes les références 012 propres à cette fonctionnalité par 015, y compris le chemin de vérification et le nom de table d'audit attendus. |

## Verification

| Metric        | Value |
| ------------- | ----- |
| Verified      | 86% (12/14) |
| Files checked | `artifacts/frames/60-manual-slots-post-release-fixes-frame.mdx`, `artifacts/specs/60-manual-slots-post-release-fixes-spec.mdx`, `artifacts/plans/60-manual-slots-post-release-fixes-plan.mdx`, `src/lib/manual-slots.ts`, `src/types/manual-slots.ts`, `src/pages/api/admin/time-slots/index.ts`, `src/pages/api/admin/time-slots/[id].ts`, `src/components/admin/TimeSlotManager.tsx`, `src/pages/mes-rdvs.astro`, `supabase/migrations/015_manual_slots_unique.sql`, `tests/unit/manual-slots.test.ts`, `tests/unit/admin-time-slots-api.test.ts`, `tests/unit/google-calendar.test.ts`, `e2e/manual-slots.spec.ts` |
| Unchecked     | B2 already-deleted DELETE returns 204 — fix; audit:a11y reports violations despite exit 0 — fix |
| Unplanned     | none |
