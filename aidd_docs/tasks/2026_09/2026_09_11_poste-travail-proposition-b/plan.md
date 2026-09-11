# Plan — Poste de travail, proposition B (#148)

**Figma** : [Refonte admin](https://www.figma.com/design/sWgtkuIWsLouuIDbiiZPQR/Refonte-admin?node-id=0-1) — écrans « Poste de travail » (iPad 1280×720 + iPhone 390×844), spec d'interactions node 1001:3952.

**Objectif** : livrer la proposition B du tableau de bord admin sur une route dédiée `/poste-travail/` sans modifier `/mes-rdvs/` (proposition A, fusionnée via #65), afin que la thérapeute choisisse entre les deux. Réutilisation stricte du backend existant ; les fonctionnalités projetées du Figma qui n'existent pas sont tracées dans #142–#147.

## Décisions

| Décision | Rationale |
|----------|-----------|
| Route dédiée `/poste-travail/` | Comparaison A/B sur un même déploiement ; zéro risque pour la proposition A |
| Island unique `Workbench` reçoit les appointments (SSR) | Même pattern que `/mes-rdvs` (colonnes explicites, PII minimale) ; la Synthèse est calculée client-side sans nouvel endpoint |
| Sections Rendez-vous/Patients/Disponibilités = réutilisation des islands existants | Éviter de dupliquer ~1 500 lignes testées ; la différenciation porte sur la coquille + la Synthèse |
| Sections montées en permanence, masquées en CSS | Préserve l'état des islands entre changements d'onglet (pattern actuel de `mes-rdvs.astro`) |
| Triage « À traiter » dérivé, sans mutation | Règle simple et testable : `pending`, `payment_pending`, `rescheduled` ; badge EN RETARD si `scheduled_at < now`. Les actions restent dans `AppointmentCard` (focus + scroll) |
| Pas de nouveau `lib/` | `src/lib/**` est server-only ; helpers purs dans `src/utils/workbench.ts` |

## Fichiers

| Fichier | Action | Contenu |
|---------|--------|---------|
| `src/utils/workbench.ts` | créer | Helpers purs : `isTriageCandidate`, `isLateAppointment`, `getTriageItems`, `getTodaySessions`, `getNextSessions`, `getMonthlyVolume`, `getMinutesUntil` — tous paramétrés par `nowMs` (testabilité) |
| `tests/unit/workbench.test.ts` | créer | Vitest : triage, EN RETARD, KPIs, frontières jour Paris |
| `src/components/admin/workbench/Workbench.tsx` | créer | Coquille : sidebar ≥lg (profil, CTA, nav, liens), header mobile, nav basse + FAB, état section (sessionStorage), état focus `{id, nonce}` |
| `src/components/admin/workbench/SyntheseView.tsx` | créer | KPI cards, file « À traiter », « Prochains rendez-vous » ; callbacks `onFocusAppointment` |
| `src/pages/poste-travail.astro` | créer | Garde auth (identique mes-rdvs), fetch appointments (mêmes colonnes), `prerender = false`, `noindex` |
| `src/components/admin/AppointmentsManager.tsx` | modifier | Prop optionnelle `focusAppointmentId` : déplie la ligne, ouvre « Passés » si nécessaire, `scrollIntoView` ; `id` sur les `<li>` |
| `src/components/admin/AdminCreateButton.tsx` | modifier | Props optionnelles `className` (remplace les classes du trigger) et `label` — pour la sidebar et le FAB |
| `src/pages/mes-rdvs.astro` | modifier | Lien discret « proposition B (bêta) » vers `/poste-travail/` |

## Règles métier (Synthèse)

- **Séance « active »** : statut ∉ {`cancelled`, `declined`}.
- **À traiter** : statut ∈ {`pending`, `payment_pending`, `rescheduled`} — décomposition : retards = date passée, paiements = `payment_pending`, reports = `rescheduled` (chevauchement possible, informationnel).
- **EN RETARD** : candidat au triage avec `scheduled_at < now`.
- **Aujourd'hui** : `toParisDateString(appt) == toParisDateString(now)` ∧ active ; prochaine = première ≥ now.
- **Volume mensuel** : même mois Paris ∧ active ; sous-libellé = % d'actifs sur le mois complet (annulés/refusés inclus au dénominateur).
- **Prochains rendez-vous** : actifs ∧ `scheduled_at ≥ now`, tri ascendant, 3 premiers ; « Rejoindre la visio » si `appointment_mode === 'video'` ∧ `video_link`.

## Vérifications

1. `npx vitest run tests/unit/workbench.test.ts --maxWorkers=1` (garde mémoire WSL)
2. `npm run lint` → `npm run typecheck` (advisory) → `npm run build` séquentiels
3. `npm run audit:a11y` avant PR UI (nécessite dev server + env locaux)
4. Trailing slash `/` sur tout `fetch()`/lien client (ADR-013)

## Hors périmètre (renvoyé aux issues)

Dossier patient (#142), création/export patient (#143), facturation & documents (#144), demi-journées/blocages/marge (#145), KPI remplissage (#146), Doctolib (#147). Restyle complet des islands réutilisés si la proposition B est retenue.
