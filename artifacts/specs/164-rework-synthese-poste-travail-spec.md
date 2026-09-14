---
title: "feat(admin): rework synthèse du poste de travail — prochains RDV en tête + KPIs orientés action"
description: "Réordonnance la synthèse (prochains RDV en tête), recentre « À traiter » sur les actions thérapeute (« Demandes de RDV », clic → filtre pré-rempli), remplace Remplissage par « Ma semaine », rend « Aujourd'hui » dynamique vers « Demain »"
type: spec
issue: 164
tier: F-lite
date: 2026-09-13
status: approved
---

## Context

Promu depuis `artifacts/frames/164-rework-synthese-poste-travail-frame.md` (F-lite, approuvé). Suite de #148 (livré par #149) : retour d'usage de la thérapeute sur la page synthèse (`/poste-travail/`, îlot `Workbench` → `SyntheseView`). Aujourd'hui : « À traiter » agrège `pending` + `payment_pending` + `rescheduled` (`TRIAGE_STATUSES` dans `src/utils/workbench.ts`), dont des paiements qui ne demandent aucune action d'elle ; le KPI « À traiter / urgences » est angoissant ; « Remplissage » est une carte désactivée (Prochainement #146) ; les prochains RDV passent après « À traiter ».

Fait établi par lecture du code (revue de spec adversariale + architecte) : un RDV `rescheduled` porte une **proposition de report en attente d'acceptation du patient** (`rdv/accepter-report`, nonce) ; le compteur du thérapeute côté API est `cancel_reschedule` (« remet en pending »). Une proposition **expirée** — au sens exact de la page patient (`accepter-report.astro:59`) : `!rescheduled_to || rescheduled_to ≤ now` — ne peut plus être acceptée par le patient et reste bloquée sans action de la thérapeute : c'est une action requise. `rescheduled_to` est présent sur le type `Appointment` (`appointment.ts:96`) et la liste SSR est non filtrée par date (`poste-travail.astro:46-50`), donc les retards et propositions expirées sont bien dans les données client.

## Intent

La synthèse doit répondre à « que vais-je faire aujourd'hui / à qui dois-je répondre » sans bruit : les paiements en attente ne demandent rien à la thérapeute (le lien de paiement travaille seul), les propositions de report non expirées attendent le patient — seules les demandes `pending` et les reports expirés nécessitent son action. Pourquoi maintenant : retour d'usage direct après quelques semaines en production.

## Goal

À l'ouverture de `/poste-travail/`, la thérapeute voit ses prochains rendez-vous en tête, un KPI honnête « Demandes de RDV » qui l'emmène en un clic sur l'onglet rendez-vous avec la file complète présélectionnée, « Ma semaine » à la place du remplissage, et un KPI « Aujourd'hui » qui bascule sur « Demain » quand sa journée est terminée.

## Users

- **Primaire :** la thérapeute — pilotage quotidien (iPad/desktop) depuis la synthèse.
- **Secondaire :** les patients — demandes traitées plus vite grâce au raccourci de tri.

## Expected Behavior

**Ordre des sections.** « Prochains rendez-vous » (section existante, inchangée fonctionnellement) précède « Demandes de RDV » (ex « À traiter ») dans la synthèse.

**Cartes KPI (nouvel ordre : 1. Aujourd'hui/Demain, 2. Ma semaine, 3. Demandes de RDV, 4. Volume mensuel).**

- **Aujourd'hui → Demain.** Au montage (`nowMs` figé, arbitrage existant) : s'il reste aujourd'hui (Paris) au moins une séance active **non terminée** — séance à venir, ou séance débutée dont la fin prévue (durée dérivée du type) est postérieure au montage — → carte « Aujourd'hui » inchangée. Sinon → carte « Demain » : nombre de séances actives du **jour Paris suivant** (clé calendaire, jamais `nowMs + 24 h` — jour de 25 h en fin de DST) + « Prochaine consultation à HH:MM » (première séance de demain) ou « Aucune séance ». Libellé et données basculent ensemble.
- **Ma semaine** (remplace « Remplissage », 2ᵉ position). Lundi→vendredi (Paris, `getParisISOWeekday` ≤ 5) : « Ma semaine » = séances actives de la semaine civile **en cours** (lundi→dimanche, y compris les jours passés). Samedi **ou** dimanche (`getParisISOWeekday` ∈ {6, 7}) : « Ma semaine à venir » = séances actives de la semaine suivante. Ligne de détail : intervalle de la semaine comptée, ex. « 15–21 sept. » (clés de jour Paris `YYYY-MM-DD`, pas d'instants).
- **Demandes de RDV** (remplace « À traiter / urgences »). Valeur = taille de la file d'actions thérapeute (SC2) ; suffixe « à traiter » ; détail = « X en retard » quand applicable, sinon « Aucune demande en attente ». La carte est un **bouton** : activation → bascule sur l'onglet Rendez-vous avec le filtre « Demandes de RDV » présélectionné (voir R1) ; opérable au clavier, nom accessible explicite, focus visible.
- **Volume mensuel** : inchangé.

**Carte Remplissage supprimée** (plus de carte désactivée ni de puce Prochainement #146 dans la synthèse ; #146 reste ouvert, à re-scoper séparément).

**Liste « Demandes de RDV »** (ex « À traiter », même carte section). Contient exactement la file SC2, lignes `AppointmentRow` existantes (focus RDV inchangé). Le bouton d'extension est rewordé : « Voir les N autres demandes » / « Réduire ». En-tête : « Demandes de RDV · N », badge « Actions requises » conservé quand N > 0 ; vide → « Aucune demande en attente — tout est à jour. »

## Data Model & Consumers

Aucun changement de données ni d'API. Helpers **purs** (convention `nowMs` injecté, identifiants anglais, libellés français retournés — précédent `describeSlot.dayLabel`) :

- `src/utils/workbench.ts` : **`getDemandItems(appointments, nowMs)`** → file d'actions thérapeute (SC2) ; remplace `getTriageItems`/`getTriageBreakdown` dans la synthèse (supprimés — leurs seuls appelants sont `SyntheseView` + tests, vérifié par grep). **`getTriageReasons` et `TRIAGE_STATUSES` ne sont PAS modifiés** : ils alimentent le badge « EN RETARD » de `AppointmentRow` (`ui.tsx:221`) rendu dans toute la section Rendez-vous — changer le set changerait le badge partout, hors périmètre. `getDemandItems` porte sa propre logique de statuts.
- **`getWeekSessions(appointments, nowMs)`** → `{ count, weekStartKey, weekEndKey, label: 'Ma semaine' | 'Ma semaine à venir' }` — clés de jour Paris `YYYY-MM-DD` (comptage = test d'intervalle de clés, pas d'instants).
- **`getTomorrowSessions(appointments, nowMs)`** → séances actives du jour Paris suivant (clé de jour +1, gestion 25 h) + première heure.
- **`src/utils/date.ts`** peut exporter une primitive de décalage de jour Paris (le pattern `shiftParisDay` existe déjà en privé) — `workbench.ts` ne duplique pas de logique TZ.

**Plomberie — canal unique.** `FocusRequest` devient une union discriminée sur la prop existante : `{ kind: 'focus'; id: string; nonce: number } | { kind: 'filter'; filter: 'demandes'; nonce: number }`. **Un seul compteur de nonce monotone côté `Workbench`** (incrémenté à chaque demande, quel que soit le kind), **un seul ref de garde** côté `RendezVousView` (l'effet branche sur `kind`) : un filtre ne peut pas avaler un focus (et inversement) par collision de nonce.

| Consommateur | Champs | Quand | Statut |
|---|---|---|---|
| `SyntheseView` | helpers ci-dessus | chaque rendu | ce ticket |
| `RendezVousView` | requête `{kind:'filter', filter:'demandes'}` | KPI cliqué | ce ticket |
| `tests/unit/workbench.test.ts` | oracles SC2/SC4/SC5 | suite unitaire | ce ticket |

## Breadboard

| ID | Élément | Handler | Données |
|---|---|---|---|
| K1 | KPI « Aujourd'hui » / « Demain » | (statique) | `getTodaySessions` / `getTomorrowSessions` |
| K2 | KPI « Ma semaine » / « Ma semaine à venir » | (statique) | `getWeekSessions` |
| K3 | KPI bouton « Demandes de RDV » | `onOpenDemandes()` → requête `{kind:'filter'}` | `getDemandItems` |
| K4 | KPI « Volume mensuel » | (inchangé) | `getMonthlyVolume` |
| L1 | Liste « Demandes de RDV » | lignes → focus existant (`{kind:'focus'}`) | `getDemandItems` |
| L2 | Section « Prochains rendez-vous » | inchangée, repositionnée 1ʳᵉ | `getNextSessions` |
| R1 | `RendezVousView` — filtre « Demandes de RDV » | nouveau `FilterKey 'demandes'` : prédicat = appartenance à `getDemandItems` **composé avec la partition courante** (retour de test PR #167 : la bascule À venir/Historique reste visible et délimite le périmètre ; le filtre ne fusionne plus les deux partitions) + pilule dédiée dans `FILTERS` ; effet requête : `setFilter('demandes')`, `setPartition('upcoming')`, `setQuery('')`, `setPage(1)` (garde nonce unique) | `getDemandItems`, requête union |

Le prédicat `matchesFilter('demandes')` est l'appartenance à la file (et non `status === 'pending'`), évaluée dans la partition affichée. Révision (retour de test PR #167) : la version initiale « partition-agnostique » (bascule masquée, partitions fusionnées) est abandonnée — le filtre se compose avec À venir / Historique ; les demandes en retard restent visibles via la partition Historique et la file fusionnée reste affichée sur la Synthèse.

## Slices

| # | Slice | Démo |
|---|-------|------|
| V1 (K1, K2, K4, L1, L2) | Structure + KPIs honnêtes | prochains RDV en tête ; « Demandes de RDV » = pending + reports expirés, paiements exclus ; « Ma semaine » 2ᵉ position (samedi/dimanche → semaine suivante) ; « Aujourd'hui » → « Demain » ; helpers purs + tests d'abord |
| V2 (K3, R1) | Click-through + a11y | KPI bouton → onglet RDV, filtre « Demandes de RDV » présélectionné (canal union, garde nonce unique) ; pa11y authentifié vert sur `/poste-travail/` |

## Success Criteria

- [ ] **SC1 — Ordre de lecture** : dans le DOM rendu de la synthèse, la section « Prochains rendez-vous » précède la section « Demandes de RDV ».

```yaml
priced:  "l'ordre des sections reflète la priorité de lecture du praticien"
not:     "vérifier seulement que les deux sections existent / un ordre CSS visuel (order/flex)"
oracles: ["compareDocumentPosition ou ordre des children : section prochains RDV avant section demandes"]
claim:   fail-closed
```

- [ ] **SC2 — Périmètre de la file « Demandes de RDV »** : la file contient exactement les RDV `pending` plus les RDV `rescheduled` dont la proposition est expirée au sens patient (`!rescheduled_to || rescheduled_to ≤ nowMs`) ; un `payment_pending` n'y figure jamais ; un `rescheduled` à proposition valide non plus. `TRIAGE_STATUSES`/`getTriageReasons` restent intacts (badge EN RETARD inchangé sur toute la section Rendez-vous).

```yaml
priced:  "la liste ne présente que des RDV nécessitant une action de la thérapeute — jamais un état qui attend le patient ou le paiement"
not:     "masquer les paiements en CSS dans un computed qui les compte encore / dériver la file d'un simple filtrage de l'ancienne file de triage / muter TRIAGE_STATUSES"
oracles: ["fixture payment_pending seule → liste vide + KPI 0", "fixture rescheduled avec rescheduled_to future → absente", "fixture rescheduled avec rescheduled_to passée → présente", "fixture rescheduled avec rescheduled_to null → présente (même règle que la page patient)", "fixture pending avec scheduled_at passée → présente et en tête"]
claim:   fail-closed
```

- [ ] **SC3 — Click-through « Demandes de RDV »** : la carte KPI est un `<button>` ; à l'activation, la section Rendez-vous affiche le filtre « Demandes de RDV » (pilule active) **dans la partition À venir** — révisé (retour de test PR #167) : le filtre se compose avec la bascule, les demandes en retard restent atteignables via Historique et la file fusionnée reste sur la Synthèse — recherche vidée, pagination à 1. Canal unique : requête union `{kind:'filter'}`, un compteur de nonce côté Workbench, un ref de garde côté RendezVousView — un clic KPI n'avale pas un focus de ligne et inversement ; opérable au clavier, nom accessible explicite.

- [ ] **SC4 — KPI « Ma semaine »** : la carte occupe la 2ᵉ position de la grille ; `getParisISOWeekday(now)` ≤ 5 → libellé « Ma semaine », compte = séances actives de la semaine civile Paris en cours (lundi→dimanche, jours passés inclus) ; weekday ∈ {6, 7} → libellé « Ma semaine à venir », compte = semaine suivante ; détail = intervalle « D–D month » des clés de jour comptées ; aucune carte « Remplissage » dans le DOM.

- [ ] **SC5 — Bascule « Aujourd'hui » → « Demain »** : si aucune séance active du jour n'est **non terminée** au montage (à venir, ou débutée avec fin prévue > now) → carte libellée « Demain », valeur = séances actives du jour Paris suivant (clé de jour +1, jamais +24 h), détail = « Prochaine consultation à HH:MM » (première de demain) ou « Aucune séance » ; sinon la carte « Aujourd'hui » garde le comportement actuel.

- [ ] **SC6 — Contrats testés** : `tests/unit/workbench.test.ts` couvre les 5 oracles SC2 et les bornes SC4 (lundi vs samedi **et dimanche**, comptage semaine courante vs suivante) et SC5 (bascule + dérive DST du « demain » par clé de jour) ; suites `workbench` existantes mises à jour sans perte de couverture (les tests des helpers supprimés sont retirés avec eux).

- [ ] **SC7 — Accessibilité** : (a) `npm run audit:a11y` (portée publique, gate AGENTS.md) reste vert ; (b) preuve d'accessibilité de la page authentifiée : pa11y exécuté **avec session admin de dev** (cookie injecté via `--headers`, ou login scripté via `actions` sur `/login/` avec les identifiants du `.env` local — jamais de credentials prod), 0 erreur WCAG sur la section synthèse, run documenté dans la PR.

## Hors périmètre

Refonte visuelle au-delà de la synthèse ; changement de statuts, d'API ou de modèle de données ; re-scopage de #146 (ouvert, à traiter séparément — la carte Remplissage disparaît simplement de la synthèse) ; pagination/compteurs de l'onglet Rendez-vous hors application du filtre pré-rempli ; tout mécanisme de relance automatique des paiements ; sémantique du badge « EN RETARD » hors synthèse (gérée par `getTriageReasons`, inchangée).
