# Plan — Poste de travail, proposition B (#148)

> **V2 — 11/09/2026 : reconstruction complète.** Après première livraison (coquille nouvelle + îlots réutilisés), décision de refaire **toutes les pages** fidèlement aux 12 écrans Figma : layouts différents, composants nouveaux ou évolués, textes et comportements propres à la proposition B. Les îlots de la proposition A (AppointmentsManager, PatientList, TimeSlotManager, AdminCreateButton) restent employés par `/mes-rdvs/` uniquement. Le périmètre V2 est décrit dans `## Découpage V2` ci-dessous ; la première version du plan est conservée en bas de document.

**Figma** : [Refonte admin](https://www.figma.com/design/sWgtkuIWsLouuIDbiiZPQR/Refonte-admin?node-id=0-1) — écrans « Poste de travail » (iPad 1280×720 + iPhone 390×844), spec d'interactions node 1001:3952. Rendus de référence : `figma/*.png` (ce dossier).

## Découpage V2

| Élément Figma | Implémentation | Backend |
|---------------|----------------|---------|
| Coquille (sidebar claire, nav, FAB, nav basse) | `Workbench.tsx` restylé | — |
| Synthèse (4 KPI, file « À traiter » avec expander, prochains RDV) | `SyntheseView.tsx` reconstruit | dérivé de `appointments` |
| Rendez-vous (toggle À venir/Historique, pills fusionnées, recherche, groupes par jour, pagination, split-view iPad + fiche détail) | `rdv/RendezVousView.tsx` + `rdv/AppointmentDetail.tsx` (nouveaux) | PATCH actions existantes (confirm/decline/cancel/reschedule/reschedule_paid/accept_reschedule/cancel_reschedule/save_notes), regenerate-calendar |
| Patients (annuaire, alpha-jump, dossier, métriques, historique, planifier pré-rempli) | `patients/PatientsView.tsx` (nouveau) | dérivé de `appointments` (`aggregatePatients`) + drawer pré-rempli |
| Disponibilités (calendrier mois, plages du jour, sur-mesure) | `disponibilites/DisponibilitesView.tsx` (nouveau) | GET/POST/DELETE `/api/admin/time-slots/` + GET/PATCH `/api/admin/scheduling-settings/` (marge, port #133) + GoogleCalendarStatus |
| Tiroir Nouveau RDV (recherche patient, créneaux suggérés, options & honoraires) | `CreateAppointmentDrawer.tsx` (nouveau ; drawer ≥sm / bottom sheet mobile) | POST `/api/admin/appointments/` + GET `/api/admin/credits/?email=` + GET `/api/availability/?mode=&duration=` (créneaux autoritaires) |
| Blocages & demi-journées (fermer/bloquer) | carte désactivée + badge « Prochainement · #145 » visible | #145 |
| Rappel SMS / Mail (fiche RDV) | bouton désactivé (grisé, infobulle) — pas de badge visible, signal faible volontaire | à tracer |
| Note clinique (dossier patient) | bandeau désactivé + badge « Prochainement · #142 » | #142 |
| Exporter / Nouveau patient | boutons désactivés, référence #143 en `title` (infobulle) | #143 |
| REMPLISSAGE (KPI) | carte avec « — » + badge « Prochainement · #146 » | #146 |
| Doctolib | absent du texte d'interface (affichage mensonger) | #147 |

Helpers purs ajoutés à `src/utils/workbench.ts` : `aggregatePatients` (miroir client de l'agrégation `/api/admin/patients/` — cutoff 3 mois civils identique) et `describeSlot` (libellés des créneaux renvoyés par `/api/availability/`). Les créneaux suggérés du tiroir viennent de l'endpoint autoritaire (Google Agenda, plages cabinet, marge, reports réservés), pas d'un recalcul local. Tests : `tests/unit/workbench.test.ts`.

Comportements conservés : `window.location.reload()` après action (pattern `AppointmentCard`, garantit des données SSR fraîches) ; save_notes sans reload ; trailing slash ADR-013 ; cibles tactiles 44px ; overlays (tiroir + 2 sheets) avec focus initial, piège Tab, Escape et restauration du focus (`ModalOverlay`).

---

# Plan V1 (historique)


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
