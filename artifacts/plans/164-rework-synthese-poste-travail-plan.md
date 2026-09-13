---
title: "Plan: rework synthèse du poste de travail — prochains RDV en tête + KPIs orientés action"
issue: 164
spec: artifacts/specs/164-rework-synthese-poste-travail-spec.md
complexity: 3/10
tier: F-lite
generated: 2026-09-13T21:30:00Z
---

## Summary

Réorganisation de `SyntheseView` (prochains RDV en tête, KPIs honnêtes), 3 helpers purs test-first dans `workbench.ts` + export d'une primitive Paris dans `date.ts`, canal de requête union à nonce unique entre Synthèse → Workbench → RendezVousView avec un filtre dédié « Demandes de RDV » partition-agnostique. Aucun changement d'API ni de données.

## Architecture

**Data flow (rendu client, zéro I/O nouvelle) :**

1. `poste-travail.astro` (SSR) → liste complète des RDV → îlot `Workbench` (inchangé).
2. `src/utils/date.ts` — primitives Paris : `getParisISOWeekday`, `toParisDateString`, `isSameParisDay`, `isUpcoming` existants ; `shiftParisDay` (privé, :149) devient exporté.
3. `src/utils/workbench.ts` — 3 nouveaux helpers purs (`nowMs` injecté) : `getDemandItems` (pending + reports expirés, règle patient `!rescheduled_to || rescheduled_to ≤ nowMs`), `getWeekSessions` (clés de jour Paris, semaine suivante si weekday ∈ {6,7}), `getTomorrowSessions` (jour Paris +1). `getTriageItems`/`getTriageBreakdown` supprimés en fin de vague ; `getTriageReasons`/`TRIAGE_STATUSES` **intacts** (badge EN RETARD, `ui.tsx:221`).
4. `SyntheseView.tsx` — composition : ordre L2 (prochains RDV) → L1 (Demandes de RDV) ; KPIs K1 (Aujourd'hui/Demain), K2 (Ma semaine), K3 (bouton → `onOpenDemandes()`), K4 (inchangé) ; carte Remplissage supprimée.
5. `Workbench.tsx` — `FocusRequest` devient l'union discriminée `WorkbenchRequest = { kind: 'focus'; id; nonce } | { kind: 'filter'; filter: 'demandes'; nonce }` ; **un seul compteur de nonce** ; handler `onOpenDemandes` → section 'rdv'.
6. `RendezVousView.tsx` — `FilterKey 'demandes'` (pilule dédiée) : prédicat = appartenance à `getDemandItems`, partition-agnostique (bascule À venir/Historique masquée pendant ce filtre) ; l'effet de requête branche sur `kind` derrière le ref de garde unique (extension de `handledFocusNonceRef`).

**File × Function map :**

| Fichier | Fonctions |
|---|---|
| `src/utils/date.ts` | `shiftParisDay` (export ajouté) |
| `src/utils/workbench.ts` | +`getDemandItems`, +`getWeekSessions`, +`getTomorrowSessions` ; −`getTriageItems`, −`getTriageBreakdown` ; intacts : `getTriageReasons`, `getTodaySessions`, `getNextSessions`, `getMonthlyVolume` |
| `src/components/admin/workbench/SyntheseView.tsx` | `KpiCard` (évolue : variante bouton), `SyntheseView` (ordre + cartes + props `onOpenDemandes`) |
| `src/components/admin/workbench/Workbench.tsx` | `WorkbenchRequest` (union), `handleRequest` (nonce monotone), threading props |
| `src/components/admin/workbench/rdv/RendezVousView.tsx` | `matchesFilter` (branche 'demandes'), `FILTERS` (+pilule), effet requête union |
| `tests/unit/workbench.test.ts` | consumers des helpers (contrats SC2×5, SC4 bornes, SC5 bascule/DST) |

## Ref Patterns

- Helpers purs + `nowMs` injecté : `src/utils/workbench.ts` (tout le fichier) — convention à reproduire.
- Libellés français retournés par un helper : `describeSlot` (`workbench.ts:306`).
- KPI card + bouton clavier-accessible : `KpiCard` (`SyntheseView.tsx:62`) et bouton mint (`SyntheseView.tsx:231-250`).
- Garde nonce : `handledFocusNonceRef` (`RendezVousView.tsx:106-134`) — extension, pas duplication.
- Tests helpers : `tests/unit/workbench.test.ts` (fixtures minimales, `nowMs` figés).

## Agents

| Agent instance | Tâches | Fichiers | Subjects |
|---|---|---|---|
| R-frontend-dev-A | T1, T3, T7 | date.ts, workbench.ts, workbench.test.ts | date-utils, workbench-helpers |
| R-frontend-dev-B1 | T4 | SyntheseView.tsx | synthese-ui |
| R-frontend-dev-B2 | T5, T6 | Workbench.tsx, RendezVousView.tsx | workbench-plumbing, rdv-filter |
| R-tester-A | T2, T8 | workbench.test.ts | workbench-helpers (contrats), verification |

## Micro-Tasks

### Slice V1 — Structure + KPIs honnêtes

- **T1** [P] — Exporter la primitive de décalage de jour Paris : ajouter `export` sur `shiftParisDay` (`date.ts:149`), sans changement de comportement.
  - File: `src/utils/date.ts` · Agent: R-frontend-dev-A · Subject: date-utils · Phase: GREEN · Trace: SC4/SC5 (primitive) · Diff: 1 · [P]
  - Verify: `grep -n "export function shiftParisDay" src/utils/date.ts` ET `npx vitest run tests/unit/workbench.test.ts --maxWorkers=1` vert.
  - Est: 2 min (trivial).
- **T2** [P] — Écrire les contrats test-first dans `tests/unit/workbench.test.ts` (nouveau describe par helper, fixtures minimales, `nowMs` figés) : `getDemandItems` — 5 oracles SC2 (payment_pending seule → vide ; rescheduled future → absente ; rescheduled passée → présente ; rescheduled_to null → présente ; pending passée → présente en tête) ; `getWeekSessions` — lundi (semaine courante, jours passés inclus), samedi → semaine suivante + libellé « Ma semaine à venir », dimanche → idem ; `getTomorrowSessions` — bascule, jour+1 par clé (cas 25 h DST), première heure. Suppression des tests `getTriageItems`/`getTriageBreakdown` REPORTÉE à T7 (les helpers existent encore à ce stade).
  - File: `tests/unit/workbench.test.ts` · Agent: R-tester-A · Subject: workbench-helpers · Phase: RED · Trace: SC2, SC4, SC5, SC6 · Diff: 3 · [P]
  - Verify: `npx vitest run tests/unit/workbench.test.ts --maxWorkers=1` → ÉCHOUE (helpers inexistants) — sentinelle RED.
  - Est: 5 min (judgmental).
- **T3** — Implémenter `getDemandItems`, `getWeekSessions`, `getTomorrowSessions` dans `src/utils/workbench.ts` (anciens helpers conservés jusqu'à T7 ; identifiants anglais, libellés français retournés).
  - File: `src/utils/workbench.ts` · Agent: R-frontend-dev-A · Subject: workbench-helpers · Phase: GREEN · Trace: SC2, SC4, SC5 · Depends: T1, T2 · Diff: 3
  - Verify: `npx vitest run tests/unit/workbench.test.ts --maxWorkers=1` → vert (nouveaux describes + anciens).
  - Est: 6 min (judgmental).

### Slice V2 — Click-through + a11y

- **T4** [P] — `SyntheseView` : déplacer la section « Prochains rendez-vous » en tête ; grille KPI = Aujourd'hui/Demain (K1), Ma semaine (K2), Demandes de RDV (K3, bouton), Volume mensuel (K4) ; supprimer la carte Remplissage ; reworder en-tête/badge/bouton d'extension de la liste ; nouvelle prop `onOpenDemandes: () => void` ; breakdown sans paiements.
  - File: `src/components/admin/workbench/SyntheseView.tsx` · Agent: R-frontend-dev-B1 · Subject: synthese-ui · Phase: GREEN · Trace: SC1, SC2 (rendu), SC4, SC5 · Depends: T3 · Diff: 3 · [P]
  - Verify: `grep -c "Remplissage" src/components/admin/workbench/SyntheseView.tsx` = 0 ET `grep -n "onOpenDemandes" src/components/admin/workbench/SyntheseView.tsx` non vide ; (compil. complète vérifiée en T8).
  - Est: 6 min (judgmental).
- **T5** [P] — `Workbench` : union `WorkbenchRequest` (focus \| filter), compteur de nonce unique (`handleRequest`), handler `onOpenDemandes` (section 'rdv' + requête filter), threading vers `SyntheseView` et `RendezVousView`.
  - File: `src/components/admin/workbench/Workbench.tsx` · Agent: R-frontend-dev-B2 · Subject: workbench-plumbing · Phase: GREEN · Trace: SC3 · Depends: T3 · Diff: 3 · [P]
  - Verify: `grep -n "kind: 'filter'" src/components/admin/workbench/Workbench.tsx` non vide ; (compil. vérifiée en T8).
  - Est: 5 min (judgmental).
- **T6** — `RendezVousView` : `FilterKey 'demandes'` + pilule « Demandes de RDV » dans `FILTERS` ; `matchesFilter` → appartenance à `getDemandItems` ; partition-agnostique (bascule masquée quand ce filtre actif) ; effet union branché sur `kind` derrière le ref de garde unique.
  - File: `src/components/admin/workbench/rdv/RendezVousView.tsx` · Agent: R-frontend-dev-B2 · Subject: rdv-filter · Phase: GREEN · Trace: SC3 · Depends: T5 · Diff: 3
  - Verify: `grep -n "'demandes'" src/components/admin/workbench/rdv/RendezVousView.tsx` ≥ 3 occurrences (type, pilule, prédicat) ; (compil. vérifiée en T8).
  - Est: 6 min (judgmental).
- **T7** — Retirer `getTriageItems`/`getTriageBreakdown` de `workbench.ts` et leurs tests obsolètes (plus aucun appelant après T4).
  - File: `src/utils/workbench.ts`, `tests/unit/workbench.test.ts` · Agent: R-frontend-dev-A · Subject: workbench-helpers · Phase: REFACTOR · Trace: SC2 (not-clause), SC6 · Depends: T4 · Diff: 2
  - Verify: `grep -rn "getTriageItems\|getTriageBreakdown" src/ tests/` = 0 ET `npx vitest run tests/unit/workbench.test.ts --maxWorkers=1` vert.
  - Est: 3 min (bounded).
- **T8** — Gate verte ciblée : suites touchées + lint des fichiers modifiés (les gates complètes — test:low, lint, typecheck, build, audit:a11y authentifié — restent côté lead aux phases validate/pr).
  - Files: repo (read-only verification) · Agent: R-tester-A · Subject: verification · Phase: RED-GATE (vert attendu) · Trace: SC6, SC7(a) · Depends: T6, T7 · Diff: 0
  - Verify: `npx vitest run tests/unit/workbench.test.ts tests/unit/availability-api.test.ts --maxWorkers=1` vert ET `npx eslint src/utils/workbench.ts src/utils/date.ts src/components/admin/workbench/ src/components/admin/workbench/rdv/` 0 erreur.
  - Est: 5 min (judgmental).

## Wave Structure

5 vagues, max 2 agents parallèles. Écoulement ~5 vagues vs ~8 séquentiel.

| Wave | Trigger | Agents | Tasks |
|------|---------|--------|-------|
| 1 | start | 2 ∥ | R-frontend-dev-A: T1 · R-tester-A: T2 |
| 2 | Wave 1 done | 1 | R-frontend-dev-A: T3 |
| 3 | Wave 2 done | 2 ∥ | R-frontend-dev-B1: T4 · R-frontend-dev-B2: T5 |
| 4 | Wave 3 done | 1 | R-frontend-dev-B2: T6 |
| 5 | Wave 4 done | 2 ∥ | R-frontend-dev-A: T7 → R-tester-A: T8 (chaînés) |

### Budget — per task

| Task | Items | Class | Est. ops | Split? |
|------|-------|-------|----------|--------|
| T1 export primitive | 1 | trivial | 2 | — |
| T2 contrats RED | 3 helpers × oracles | judgmental | 5 | — |
| T3 helpers GREEN | 3 helpers | judgmental | 6 | — |
| T4 SyntheseView | 1 fichier, 4 KPIs + ordre | judgmental | 6 | — |
| T5 Workbench union | 1 fichier | judgmental | 5 | — |
| T6 RendezVousView filtre | 1 fichier | judgmental | 6 | — |
| T7 cleanup helpers | 2 fichiers | bounded | 3 | — |
| T8 gate ciblée | suites + eslint | judgmental | 5 | — |

**Total estimated ops: 38**

### Budget — per agent instance

| Instance | Tasks | Σ ops | Subjects | Split? |
|----------|-------|-------|----------|--------|
| R-frontend-dev-A | T1, T3, T7 | 11 | date-utils, workbench-helpers | — |
| R-frontend-dev-B1 | T4 | 6 | synthese-ui | — |
| R-frontend-dev-B2 | T5, T6 | 11 | workbench-plumbing, rdv-filter | — |
| R-tester-A | T2, T8 | 10 | workbench-helpers, verification | — |

## Consistency Report

- **SC couverts :** 7/7 (SC1→T4 ; SC2→T2,T3,T7 ; SC3→T5,T6 ; SC4→T2,T3,T4 ; SC5→T2,T3,T4 ; SC6→T2,T8 ; SC7→T8 + gates lead en validate/pr).
- **Breadboard couvert :** K1-K4, L1, L2 (T4), R1 (T6) — 7/7.
- **Non tracé :** rien. **Exemptions :** K4 inchangé (aucune tâche dédiée).
- **χ spec :** 0.

## Task Seeding Blueprint

<!-- Used by /R-dev-implement to seed TaskCreate calls on session start.
     Format: T{n} | agent-instance | blockedBy | subject
     Seed in wave order; within a wave all rows are parallel (∥). -->

### Wave 1 — no deps, 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T1 | R-frontend-dev-A | — | date-utils |
| T2 | R-tester-A | — | workbench-helpers |

### Wave 2 — after Wave 1 (T1+T2)

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T3 | R-frontend-dev-A | T1, T2 | workbench-helpers |

### Wave 3 — after Wave 2 (T3), 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T4 | R-frontend-dev-B1 | T3 | synthese-ui |
| T5 | R-frontend-dev-B2 | T3 | workbench-plumbing |

### Wave 4 — after Wave 3 (T5)

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T6 | R-frontend-dev-B2 | T5 | rdv-filter |

### Wave 5 — after Wave 4 (T6+T4), chaîné sur 2 instances

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T7 | R-frontend-dev-A | T4 | workbench-helpers |
| T8 | R-tester-A | T6, T7 | verification |

## Task IDs

<!-- Generated by /R-dev-plan. Used by /R-dev-implement to resume tasks on session restart.
     Host: portable todo_write — les tâches sont seeded dans la task list hôte sous leurs
     numéros T{n} (pas d'IDs natifs retournés) ; le re-attach se fait par titre "T{n} [". -->
- T1: host-todo T1 — date-utils
- T2: host-todo T2 — workbench-helpers (contrats RED)
- T3: host-todo T3 — workbench-helpers (GREEN)
- T4: host-todo T4 — synthese-ui
- T5: host-todo T5 — workbench-plumbing
- T6: host-todo T6 — rdv-filter
- T7: host-todo T7 — workbench-helpers (cleanup)
- T8: host-todo T8 — verification
