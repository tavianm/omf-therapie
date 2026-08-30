# Review: Issue #60 — correctifs post-release des plages horaires manuelles

- **Verdict**: approve
- **Diff**: `origin/main...HEAD`
- **Axes run**: code, functional, relevancy
- **Date**: 2026_08_30
- **Findings**: 0 critical, 0 warning, 0 minor

## Phases

### Phase 1 — Typed errors + lib contract

- [x] B5 — la fenêtre de requête utilise les dates calendaires de Paris — `src/lib/manual-slots.ts:19`, `src/lib/manual-slots.ts:45`, `tests/unit/manual-slots.test.ts:126`
- [x] Non-blocking — les échecs d’invalidation du cache utilisent `console.error` — `src/lib/manual-slots.ts:157`

### Phase 2 — API status mapping

- [x] B2 — un identifiant inexistant ou déjà soft-deleted lève `NotFoundError` et l’API renvoie 404 — `src/lib/manual-slots.ts:112`, `src/lib/manual-slots.ts:139`, `src/pages/api/admin/time-slots/[id].ts:111`, `tests/unit/admin-time-slots-api.test.ts:131`
- [x] B3 — PATCH/DELETE mappent seulement `NotFoundError` vers 404 et gardent les autres erreurs en 500 — `src/pages/api/admin/time-slots/[id].ts:71`, `src/pages/api/admin/time-slots/[id].ts:110`, `tests/unit/admin-time-slots-api.test.ts:103`, `tests/unit/admin-time-slots-api.test.ts:164`
- [x] B4 — PATCH rejette `deleted_at` avant l’appel lib et le type ne l’expose plus — `src/pages/api/admin/time-slots/[id].ts:39`, `src/types/manual-slots.ts:17`, `tests/unit/admin-time-slots-api.test.ts:92`
- [x] B6 — les doublons sont mappés en 409 et la migration 015 déduplique puis pose l’index partiel — `src/lib/manual-slots.ts:74`, `src/pages/api/admin/time-slots/index.ts:132`, `supabase/migrations/015_manual_slots_unique.sql:14`, `tests/unit/manual-slots.test.ts:112`, `tests/unit/admin-time-slots-api.test.ts:178`
- [x] Authz regression — PATCH/DELETE gardent les réponses 401 et 403 — `src/pages/api/admin/time-slots/[id].ts:23`, `tests/unit/admin-time-slots-api.test.ts:56`

### Phase 3 — Frontend robustness

- [x] B7 — la suppression est protégée par `isDeleting`, annulée après 10 s et affiche le message prévu — `src/components/admin/TimeSlotManager.tsx:58`, `src/components/admin/TimeSlotManager.tsx:175`, `src/components/admin/TimeSlotManager.tsx:419`
- [x] B8 — les quatre chemins d’erreur utilisent `response.text()` et un parse JSON sûr — `src/components/admin/TimeSlotManager.tsx:25`, `src/components/admin/TimeSlotManager.tsx:90`, `src/components/admin/TimeSlotManager.tsx:128`, `src/components/admin/TimeSlotManager.tsx:155`, `src/components/admin/TimeSlotManager.tsx:189`

### Phase 4 — A11y tablist

- [x] B9 — flèches, Home/End, focus, activation et roving tabindex sont implémentés; preuve fournie: Playwright Edge réel 1/1 — `src/pages/mes-rdvs.astro:266`, `src/pages/mes-rdvs.astro:305`, `e2e/manual-slots.spec.ts:67`
- [x] Audit a11y — exécuté à titre informatif; la baseline publique de 51 erreurs de contraste et 598 avertissements est explicitement conservée, sans être présentée comme verte — `artifacts/specs/60-manual-slots-post-release-fixes-spec.mdx:217`

### Phase 5 — Regression test

- [x] B1 — le fixture coupe à mercredi 10:00 et vérifie la disparition des créneaux matinaux — `tests/unit/google-calendar.test.ts:248`
- [x] Lint et tests — preuves fournies: lint, typecheck et build verts; suite complète 255/255; recheck ciblé 29/29 — `tests/unit/google-calendar.test.ts:248`, `tests/unit/manual-slots.test.ts:1`, `tests/unit/admin-time-slots-api.test.ts:1`
- [x] Parcours Playwright clavier ciblé — preuve fournie: 1 test passé en navigateur réel — `e2e/manual-slots.spec.ts:67`

## Findings

| Sev | Kind | Phase | Location | Issue | Fix |
| --- | ---- | ----- | -------- | ----- | --- |
| - | - | - | - | None. | - |

## Verification

| Metric        | Value |
| ------------- | ----- |
| Verified      | 100% (14/14) |
| Files checked | `artifacts/frames/60-manual-slots-post-release-fixes-frame.mdx`, `artifacts/specs/60-manual-slots-post-release-fixes-spec.mdx`, `artifacts/plans/60-manual-slots-post-release-fixes-plan.mdx`, `aidd_docs/memory/orchestration.md`, `src/lib/manual-slots.ts`, `src/types/manual-slots.ts`, `src/pages/api/admin/time-slots/index.ts`, `src/pages/api/admin/time-slots/[id].ts`, `src/components/admin/TimeSlotManager.tsx`, `src/pages/mes-rdvs.astro`, `supabase/migrations/015_manual_slots_unique.sql`, `tests/unit/manual-slots.test.ts`, `tests/unit/admin-time-slots-api.test.ts`, `tests/unit/google-calendar.test.ts`, `e2e/manual-slots.spec.ts` |
| Unchecked     | none |
| Unplanned     | `aidd_docs/memory/orchestration.md` — change `d9f7925` conforme au pattern adaptatif approuvé: modèle/effort explicites, Luna pour tâches mécaniques, Terra pour jugement nuancé, effort ajusté au risque, sans déclassement systématique |
