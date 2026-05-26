---
issue: 23
title: "Admin : vue patients avec historique et proposition de nouveau RDV"
status: approved
tier: F-lite
created: 2026-05-26
---

## Problem Statement

La thérapeute doit actuellement scroller toute la liste des rendez-vous pour retrouver l'historique d'un patient ou créer un nouveau RDV pour un suivi. Il n'existe pas de vue centralisée par patient. Cela ralentit le workflow et augmente le risque d'erreur (ressaisie des infos patient).

## Why This Matters

Oriane gère seule son planning. Chaque seconde gagnée en back-office est du temps récupéré pour les patients. La capacité à proposer un nouveau RDV en quelques clics — sans ressaisir nom/email/téléphone/type de séance — réduit la friction et améliore la continuité de suivi.

## Success Criteria

- Oriane peut retrouver tous les rendez-vous d'un patient en moins de 30 secondes sans scroller la liste globale
- Oriane peut créer un nouveau rendez-vous pour un patient existant en moins de 30 secondes (pré-remplissage automatique des informations connues)
- L'historique des séances est visible en un coup d'œil (statuts, dates, types)

## Constraints

- Pas de table `patients` dédiée — les patients sont dérivés de la table `appointments` (agrégation par `patient_email`)
- Intégration dans la page existante `mes-rdvs` (pas de nouvelle URL, navigation par onglets)
- Aucune donnée PII supplémentaire ne doit être persistée — utiliser ce qui existe déjà dans `appointments`
- RGPD : les données patient déjà soumises à soft-delete restent exclues

## Out of Scope

- Création d'une table `patients` dédiée
- Messagerie patient (portail client)
- Import/export de données patient
- Recherche full-text avancée
- Statistiques / analytics globaux

## Stakeholders

- **Oriane Montabonnet** (thérapeute, seule utilisatrice admin)

## Appetite

Tier: F-lite
Reasoning: Scope clair sur 1 domaine (admin), ~5 fichiers touchés, pas d'architecture nouvelle — agrégation SQL + nouveaux composants React + extension de l'island existante.

## Technical Approach (proposé)

### Option A — Onglets dans `mes-rdvs` (recommandée)
- Ajouter une navigation par onglets « Rendez-vous » / « Patients » dans `mes-rdvs.astro`
- Onglet Patients : charge une liste agrégée depuis Supabase (`SELECT DISTINCT ON (patient_email) ...` triée par `MAX(scheduled_at)`)
- Clic sur un patient → panneau latéral (drawer) ou liste inline avec l'historique complet de ses RDV
- Bouton « Proposer un RDV » → ouvre `AdminCreateButton` avec props pré-remplis (nom, email, téléphone, type habituel)
- **Avantage :** intégration naturelle, pas de routing supplémentaire
- **Inconvénient :** island plus complexe à gérer

### Option B — Route API dédiée + island autonome
- Nouvelle route `GET /api/admin/patients` qui agrège les patients
- Island React `PatientList` indépendant de `AppointmentCard`
- **Avantage :** séparation des responsabilités plus claire
- **Inconvénient :** une route de plus à maintenir

### Option C — Page séparée `/mes-patients`
- Nouvelle page Astro dédiée
- **Avantage :** URL propre, navigation claire
- **Inconvénient :** contra-scope (user a demandé la fusion avec `mes-rdvs`)

**Recommandation :** Option A + Option B combinées — onglets dans `mes-rdvs` + route API dédiée pour proprement séparer la logique de chargement.

## Files Affected

| Fichier | Action |
|---------|--------|
| `src/pages/mes-rdvs.astro` | Modifier — ajouter onglets + charger les données patients |
| `src/pages/api/admin/patients.ts` | Créer — GET endpoint qui agrège les patients |
| `src/components/admin/PatientList.tsx` | Créer — island React liste patients + fiche |
| `src/components/admin/AdminCreateButton.tsx` | Modifier — accepter props de pré-remplissage |
| `src/types/patient.ts` | Créer — type `Patient` agrégé |

## Design Decisions (validées)

- **Patients archivés :** exclus par défaut ; filtre optionnel pour les afficher (RDV soft-deleted non visibles dans la liste principale)
- **Fiche patient :** section inline expandable (clic sur la ligne → expand, pas de drawer)
- **Onglet actif :** persisté en `sessionStorage` comme le filtre statut existant

## Open Questions

- *(aucune)*

## Premise Validity

**Success in 6 months:** Oriane peut retrouver tous les RDV d'un patient en < 30s sans scroller la liste globale, et créer un nouveau RDV pour un patient existant en < 30s grâce au pré-remplissage.

**Failure in 6 months:** La vue « Patients » n'est jamais ouverte — Oriane continue de chercher dans la liste des RDV (comportement inchangé malgré la feature).

**Simplest alternative:** Ajouter un filtre par nom/email dans la liste existante des RDV.
**Why not simplest:** Un filtre ne permet pas de créer un nouveau RDV pré-rempli en quelques secondes — il faudrait toujours ouvrir `AdminCreateButton` et ressaisir toutes les informations patient.
