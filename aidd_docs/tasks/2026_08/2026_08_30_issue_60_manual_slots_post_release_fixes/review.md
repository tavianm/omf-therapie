# Review: Issue #60 — correctifs post-release des plages horaires manuelles

- **Verdict**: approve
- **Diff**: `origin/main...HEAD`
- **Axes run**: code, functional, relevancy
- **Date**: 2026_08_30
- **Findings**: 0 critical, 0 warning, 0 minor

## Phases

### Phase 1 — Typed errors + lib contract

- [x] B5 — la fenêtre de requête utilise les dates calendaires de Paris — `src/lib/manual-slots.ts:20`, `src/lib/manual-slots.ts:46`, `tests/unit/manual-slots.test.ts:128`
- [x] Non-blocking — les échecs d’invalidation du cache utilisent `console.error` — `src/lib/manual-slots.ts:160`

### Phase 2 — API status mapping

- [x] B2 — un identifiant inexistant ou déjà soft-deleted lève `NotFoundError` et l’API renvoie 404 — `src/lib/manual-slots.ts:101`, `src/lib/manual-slots.ts:130`, `tests/unit/manual-slots.test.ts:58`, `tests/unit/admin-time-slots-api.test.ts:131`
- [x] B3 — PATCH/DELETE mappent seulement `NotFoundError` vers 404 et gardent les autres erreurs en 500 — `src/pages/api/admin/time-slots/[id].ts:72`, `src/pages/api/admin/time-slots/[id].ts:111`, `tests/unit/admin-time-slots-api.test.ts:103`
- [x] B4 — PATCH rejette `deleted_at` avant l’appel lib et le type ne l’expose plus — `src/pages/api/admin/time-slots/[id].ts:39`, `src/types/manual-slots.ts:17`, `tests/unit/admin-time-slots-api.test.ts:93`
- [x] B6 — les doublons sont mappés en 409 et la migration 015 déduplique puis pose l’index partiel — `src/lib/manual-slots.ts:80`, `src/pages/api/admin/time-slots/index.ts:133`, `supabase/migrations/015_manual_slots_unique.sql:14`, `tests/unit/admin-time-slots-api.test.ts:158`
- [x] Authz regression — PATCH/DELETE gardent les réponses 401 et 403 — `src/pages/api/admin/time-slots/[id].ts:23`, `tests/unit/admin-time-slots-api.test.ts:55`

### Phase 3 — Frontend robustness

- [x] B7 — la suppression est protégée par `isDeleting`, annulée après 10 s et affiche le message prévu — `src/components/admin/TimeSlotManager.tsx:52`, `src/components/admin/TimeSlotManager.tsx:175`, `src/components/admin/TimeSlotManager.tsx:430`
- [x] B8 — les quatre chemins d’erreur utilisent `response.text()` et un parse JSON sûr — `src/components/admin/TimeSlotManager.tsx:25`, `src/components/admin/TimeSlotManager.tsx:91`, `src/components/admin/TimeSlotManager.tsx:129`, `src/components/admin/TimeSlotManager.tsx:156`, `src/components/admin/TimeSlotManager.tsx:190`

### Phase 4 — A11y tablist

- [x] B9 — flèches, Home/End, focus, activation et roving tabindex sont implémentés et le parcours Playwright réel passe 1/1 — `src/pages/mes-rdvs.astro:266`, `src/pages/mes-rdvs.astro:305`, `e2e/manual-slots.spec.ts:67`
- [x] Audit a11y — exécuté à titre informatif; la baseline publique de 51 erreurs de contraste et 598 avertissements est explicitement conservée, sans être présentée comme verte — `artifacts/specs/60-manual-slots-post-release-fixes-spec.mdx:300`

### Phase 5 — Regression test

- [x] B1 — le fixture coupe à mercredi 10:00 et vérifie la disparition des créneaux matinaux — `tests/unit/google-calendar.test.ts:248`
- [x] Lint — 0 erreur, 10 avertissements préexistants — `eslint.config.js:1`
- [x] Tests — suite complète 255/255 et suites ciblées 29/29 — `tests/unit/google-calendar.test.ts:248`, `tests/unit/manual-slots.test.ts:1`, `tests/unit/admin-time-slots-api.test.ts:1`
- [x] Parcours Playwright clavier ciblé — 1 test passé en navigateur réel — `e2e/manual-slots.spec.ts:67`

## Findings

| Sev | Kind | Phase | Location | Issue | Fix |
| --- | ---- | ----- | -------- | ----- | --- |
| - | - | - | - | None. | - |

## Verification

| Metric        | Value |
| ------------- | ----- |
| Verified      | 100% (14/14) |
| Files checked | `artifacts/frames/60-manual-slots-post-release-fixes-frame.mdx`, `artifacts/specs/60-manual-slots-post-release-fixes-spec.mdx`, `artifacts/plans/60-manual-slots-post-release-fixes-plan.mdx`, `src/lib/manual-slots.ts`, `src/types/manual-slots.ts`, `src/pages/api/admin/time-slots/index.ts`, `src/pages/api/admin/time-slots/[id].ts`, `src/components/admin/TimeSlotManager.tsx`, `src/pages/mes-rdvs.astro`, `supabase/migrations/015_manual_slots_unique.sql`, `tests/unit/manual-slots.test.ts`, `tests/unit/admin-time-slots-api.test.ts`, `tests/unit/google-calendar.test.ts`, `e2e/manual-slots.spec.ts` |
| Unchecked     | none |
| Unplanned     | none |
