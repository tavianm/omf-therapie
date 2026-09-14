---
title: "Plan: Poste de travail — rafraîchissement automatique des données admin"
issue: 165
spec: artifacts/specs/165-poste-travail-auto-refresh-spec.md
complexity: 4/10
tier: F-lite
generated: 2026-09-13T22:30:00+02:00
---

## Summary

Livrer les données vivantes du poste de travail en 3 slices : (V1) GET admin authentifié + poller pur visible-only avec backoff/single-flight/monotonic-`fetchedAt` + lift `appointments` en state Workbench ; (V2) actions sans `window.location.reload()` avec contrat de réconciliation ; (V3) indicateur de fraîcheur. Le chemin patient et `/mes-rdvs/` restent intacts ; les deux pages `.astro` convergent vers le helper serveur partagé (zéro delta).

## Architecture

**Data flow** — `src/lib/admin-appointments.ts` (`fetchActiveAppointments()`, requête SSR partagée) ← consommé par `poste-travail.astro` + `mes-rdvs.astro` (SSR, props initiales) et par le nouveau `GET` de `src/pages/api/admin/appointments/index.ts` (guard session/admin → `{ appointments, fetchedAt }`, `Cache-Control: no-store`). Le hook `src/hooks/useAppointmentsPolling.ts` monte le poller pur `src/utils/appointment-poller.ts` (timers injectés, single-flight, snapshots monotones) ; `Workbench.tsx` possède le state `appointments` (initialisé des props SSR) et diffuse `appointments`/`refresh()` aux vues (contrat de props inchangé) ; `AppointmentDetail`/`CreateAppointmentDrawer` remplacent `reload()` par `refresh()` + réconciliation locale.

**File × Function map**

| Fichier | Contenu | Consommateurs |
|---|---|---|
| `src/lib/admin-appointments.ts` (nouveau) | `APPOINTMENT_COLUMNS`, `fetchActiveAppointments(): { appointments, error }` | 2 pages .astro, route GET |
| `src/pages/api/admin/appointments/index.ts` | + `GET` (401/403, no-store, enveloppe) | poller client |
| `src/utils/appointment-poller.ts` (nouveau) | `createAppointmentPoller()` — machine à états `idle→polling→backing-off→stopped` | hook |
| `src/hooks/useAppointmentsPolling.ts` (nouveau) | `useAppointmentsPolling()` — visibilité, cleanup, `isPaused` tiroir | Workbench |
| `src/components/admin/workbench/Workbench.tsx` | state `appointments` + `refresh`/`lastUpdated`/`isStale`, indicateur | sections + tiroir |
| `workbench/rdv/AppointmentDetail.tsx` | `refresh()` ×2, réconciliation post-mutation | RendezVousView |
| `workbench/CreateAppointmentDrawer.tsx` | `refresh()` ×1 | Workbench |
| `tests/unit/appointment-poller.test.ts`, `tests/unit/admin-appointments-get.test.ts` (nouveaux) | oracles SC2/2a/3/4/5(tiroir)/7 et SC1 | — |
| `e2e/poste-travail-refresh.spec.ts` (nouveau) | oracles UI SC5 (hors CI, exécution locale) | — |

## Ref Patterns

- Guard + réponses d'erreur : `src/pages/api/admin/appointments/index.ts` (`errorResponse`, `getSession` + `isAdminSession`)
- Test de route admin : `tests/unit/admin-appointments-post.test.ts`
- Test de module pur utils : `tests/unit/workbench.test.ts` + `vi.useFakeTimers`
- Spec Playwright : `e2e/manual-slots.spec.ts`

## Agents

| Agent instance | Tasks | Fichiers |
|---|---|---|
| R-backend-dev-A | T1, T2 | `src/lib/admin-appointments.ts`, route GET, 2 pages .astro |
| R-frontend-dev-A | T3→T4→T5, T6 | `src/utils/`, `src/hooks/`, workbench (poller, dashboard) |
| R-tester-A | T7→T8 | `tests/unit/*` |
| R-tester-B | T9 | `e2e/poste-travail-refresh.spec.ts` |

## Wave Structure

4 waves, jusqu'à 3 agents parallèles par wave (vitest toujours ciblé, --maxWorkers=1 — garde mémoire WSL). Étape parallèle ~4 waves vs ~9 tâches séquentielles.

| Wave | Trigger | Agents | Tasks |
|------|---------|--------|-------|
| 1 | start | 2 ∥ | R-backend-dev-A: T1 · R-frontend-dev-A: T3 |
| 2 | Wave 1 done | 3 ∥ | R-backend-dev-A: T2 · R-frontend-dev-A: T4 · R-tester-A: T7 |
| 3 | Wave 2 done | 3 ∥ | R-frontend-dev-A: T5→T6 · R-tester-A: T8 |
| 4 | Wave 3 done | 1 | R-tester-B: T9 |

### Budget — per task

| Task | Items | Class | Est. ops | Split? |
|------|-------|-------|----------|--------|
| T1 helper partagé | 3 fichiers | judgmental | 8 | — |
| T2 route GET | 1 fichier | judgmental | 5 | — |
| T3 poller pur | 1 fichier | judgmental | 6 | — |
| T4 hook + Workbench | 3 fichiers | exploratory | 12 | — |
| T5 reload→refresh + réconciliation | 2 fichiers | judgmental | 8 | — |
| T6 indicateur | 1 fichier | bounded | 4 | — |
| T7 tests poller | 1 fichier | judgmental | 8 | — |
| T8 tests route GET | 1 fichier | bounded | 5 | — |
| T9 e2e SC5 | 1 fichier | exploratory | 12 | — |

**Total estimated ops: 68**

### Budget — per agent instance

| Instance | Tasks | Σ ops | Subjects | Split? |
|----------|-------|-------|----------|--------|
| R-backend-dev-A | T1, T2 | 13 | api | — |
| R-frontend-dev-A | T3, T4, T5, T6 | 30 | poller, dashboard | — (4 tasks = cap, 2 subjects) |
| R-tester-A | T7, T8 | 13 | tests | — |
| R-tester-B | T9 | 12 | e2e | — |

## Consistency Report

**Couverture SC : 10/10** — SC1→T2,T8 · SC2/SC2a/SC3/SC4→T3,T4,T7 · SC5→T4,T5,T7(tiroir),T9(UI) · SC6→T5 · SC7→T3,T7 · SC8→T1. Tâches sans trace : aucune. χ : 0.

## Micro-Tasks

### Slice V1 — Données vivantes

**T1 [R-backend-dev-A] [api] [SC8] — Helper serveur partagé**
- Fichier : `src/lib/admin-appointments.ts` (nouveau) ; éditer `src/pages/poste-travail.astro`, `src/pages/mes-rdvs.astro`
- Extraire `APPOINTMENT_COLUMNS` + la requête dans `fetchActiveAppointments()` retournant `{ appointments, error }` (branche erreur sans cast, dégradation `[]` inchangée) ; réécrire les 2 pages pour consommer le helper (zéro delta).
- Vérifier : `grep -c "fetchActiveAppointments" src/pages/poste-travail.astro src/pages/mes-rdvs.astro` ≥ 1 chacun ; `npx vitest run tests/unit/workbench.test.ts --maxWorkers=1` vert.
- Difficulté 2 · ~10 min

**T2 [R-backend-dev-A] [api] [SC1] — GET /api/admin/appointments/ (bloqué par T1)**
- Fichier : `src/pages/api/admin/appointments/index.ts`
- `export const GET` : guard `getSession`/`isAdminSession` (401/403 via `errorResponse`) → `JSON.stringify({ appointments, fetchedAt: new Date().toISOString() })` avec `Cache-Control: no-store` sur succès ET erreurs. Réutiliser `fetchActiveAppointments()` ; erreur DB → 502 typé (jamais 200 vide).
- Vérifier : `npx vitest run tests/unit/admin-appointments-get.test.ts --maxWorkers=1` (après T8) ; en attendant `npm run lint`.
- Difficulté 2 · ~10 min

**T3 [R-frontend-dev-A] [poller] [SC2, SC2a, SC3, SC4, SC7] — Poller pur**
- Fichier : `src/utils/appointment-poller.ts` (nouveau, client-safe — jamais dans `src/lib/`)
- `createAppointmentPoller({ fetchAppointments, isVisible: () => boolean, isPaused: () => boolean, onSuccess, onError, onAuthError, intervalMs?, maxBackoffMs?, setTimeout?, clearTimeout? })` → `{ start(), stop(), triggerRefresh() }`. Intervalle 30 s (constante), backoff ×2 cap 5 min, reset au succès ; fetchs single-flighted ; snapshot ignoré si `fetchedAt` ≤ dernier appliqué ; visibilité évaluée par appel à chaque tick/trigger ; 401/403 → `stop()` irrévocable + `onAuthError(status)` ; refetch de visibilité tombant sur un poll en cours → rejoué en fin de poll ; aucune donnée remplacée sur échec.
- Vérifier : `npx vitest run tests/unit/appointment-poller.test.ts --maxWorkers=1` (après T7) ; en attendant `npx tsc --noEmit -p tsconfig.json` (advisory).
- Difficulté 3 · ~15 min

**T4 [R-frontend-dev-A] [poller, dashboard] [SC2, SC3, SC5, SC7] — Hook + Workbench (bloqué par T2, T3)**
- Fichiers : `src/hooks/useAppointmentsPolling.ts` (nouveau), `src/components/admin/workbench/Workbench.tsx`
- Hook : adapte le poller (visibilitychange, cleanup, `isPaused = () => drawerOpen`) ; expose `{ appointments, refresh, lastUpdated, isStale }`. Deep-égal → conserver l'identité du tableau (zéro setState). 401 → `window.location.href = '/login/?redirect=/poste-travail/'` ; 403 → `'/login/?error=acces-refuse'` (miroir guard SSR). Workbench : `useState(appointments)` depuis les props SSR, `refresh` descendu aux vues + tiroir, indicateur branché (T6), aucune propagation cassée des props existantes.
- Vérifier : `npx vitest run tests/unit/workbench.test.ts --maxWorkers=1` ; `npm run lint`.
- Difficulté 4 · ~20 min

### Slice V2 — Actions sans reload

**T5 [R-frontend-dev-A] [dashboard] [SC5, SC6] — reload → refresh + réconciliation (bloqué par T4)**
- Fichiers : `src/components/admin/workbench/rdv/AppointmentDetail.tsx`, `src/components/admin/workbench/CreateAppointmentDrawer.tsx`
- Remplacer les 3 `window.location.reload()` par `refresh()` (via props depuis RendezVousView). Réconciliation : après succès, reset `actionLoading`/panneau/`actionMessage` ; notes ré-alignées serveur uniquement si aucune édition locale en cours ; état local jamais re-dérivé des props après montage ; RDV ouvert absent du payload → fermeture explicite du détail.
- Vérifier : `! grep -r "window.location.reload" src/components/admin/workbench/` (contrat inversé : succès = 0 occurrence) ; `npm run lint`.
- Difficulté 3 · ~15 min

### Slice V3 — Indicateur

**T6 [R-frontend-dev-A] [dashboard] [SC5] — Indicateur de fraîcheur (bloqué par T4)**
- Fichier : `src/components/admin/workbench/Workbench.tsx` (+ `ui.tsx` si besoin)
- Texte discret caché avant le 1er poll réussi ; « Mis à jour à HH:MM » (Europe/Paris) ; échec persistant → « Données du HH:MM — hors ligne ». Tailwind uniquement, `aria-live="polite"`.
- Vérifier : `npm run lint` ; revue visuelle locale.
- Difficulté 1 · ~5 min

### Tests

**T7 [R-tester-A] [tests] [SC2, SC2a, SC3, SC4, SC5, SC7] — Tests poller (bloqué par T3)**
- Fichier : `tests/unit/appointment-poller.test.ts` — `vi.useFakeTimers` : tick → 1 fetch (SC2) ; single-flight + snapshot `fetchedAt` antérieur ignoré (SC2a) ; masqué → 0 fetch, visible → refetch immédiat, refetch avalé rejoué en fin de poll (SC3) ; backoff ×2 cap 5 min, reset succès (SC4) ; `isPaused` tiroir → 0 fetch (SC5-oracle-poller) ; 401 → 0 requête ultérieure malgré événements de visibilité + `stop` irrévocable (SC7).
- Vérifier : `npx vitest run tests/unit/appointment-poller.test.ts --maxWorkers=1`.
- Difficulté 3 · ~15 min

**T8 [R-tester-A] [tests] [SC1] — Tests route GET (bloqué par T2, après T7)**
- Fichier : `tests/unit/admin-appointments-get.test.ts` — pattern `admin-appointments-post.test.ts` : 401 sans session (corps sans donnée), 403 non-admin, 200 admin avec clés == colonnes SSR littérales (+`id`), `Cache-Control: no-store` sur succès et erreur, enveloppe `fetchedAt`.
- Vérifier : `npx vitest run tests/unit/admin-appointments-get.test.ts --maxWorkers=1`.
- Difficulté 2 · ~10 min

**T9 [R-tester-B] [e2e] [SC5] — Spec Playwright UI (bloqué par T4, T5)**
- Fichier : `e2e/poste-travail-refresh.spec.ts` — oracles UI SC5 : notes non enregistrées survivent à un poll à données **modifiées** ; RDV ouvert disparaissant du payload → fermeture explicite ; détail reste ouvert sur le même RDV. Hors CI (gates = lint→test→build) : exécution locale `npx playwright test e2e/poste-travail-refresh.spec.ts` quand dev server + DB disponibles ; sinon revue manuelle documentée dans la PR.
- Vérifier : revue de spec + exécution locale si environnement dispo.
- Difficulté 3 · ~15 min

## Task Seeding Blueprint

<!-- Used by /R-dev-implement to seed TaskCreate calls on session start.
     Format: T{n} | agent-instance | blockedBy | subject
     Seed in wave order; within a wave all rows are parallel (∥).
     ⚠ WSL guard: all vitest verify commands use targeted files + --maxWorkers=1. -->

### Wave 1 — no deps, 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T1 | R-backend-dev-A | — | api |
| T3 | R-frontend-dev-A | — | poller |

### Wave 2 — after Wave 1, 3 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T2 | R-backend-dev-A | T1 | api |
| T4 | R-frontend-dev-A | T2,T3 | dashboard |
| T7 | R-tester-A | T3 | tests |

### Wave 3 — after Wave 2, 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T5 | R-frontend-dev-A | T4 | dashboard |
| T6 | R-frontend-dev-A | T4 | dashboard |
| T8 | R-tester-A | T2 | tests |

### Wave 4 — after Wave 3, 1 agent

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T9 | R-tester-B | T4,T5 | e2e |

## Task IDs

<!-- Generated by /R-dev-plan. Used by /R-dev-implement to resume tasks on session restart. -->
- T1: todo "T1 [R-backend-dev-A] helper serveur partagé (api)" — api
- T2: todo "T2 [R-backend-dev-A] route GET admin (api)" — api
- T3: todo "T3 [R-frontend-dev-A] poller pur utils (poller)" — poller
- T4: todo "T4 [R-frontend-dev-A] hook + Workbench (dashboard)" — dashboard
- T5: todo "T5 [R-frontend-dev-A] reload→refresh + réconciliation (dashboard)" — dashboard
- T6: todo "T6 [R-frontend-dev-A] indicateur fraîcheur (dashboard)" — dashboard
- T7: todo "T7 [R-tester-A] tests poller (tests)" — tests
- T8: todo "T8 [R-tester-A] tests route GET (tests)" — tests
- T9: todo "T9 [R-tester-B] e2e SC5 (e2e)" — e2e
