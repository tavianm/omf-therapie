---
title: "feat(admin): rework synthèse du poste de travail — prochains RDV en tête + KPIs orientés action"
issue: 164
status: approved
tier: F-lite
date: 2026-09-13
---

## Problem

La page synthèse du poste de travail (livrée par #148/#149) met en tête le bloc « A traiter » et un KPI « A traiter / urgences » : les paiements en attente — qui ne demandent aucune action de la thérapeute — y figurent, et le libellé « urgences » est angoissant. Les prochains rendez-vous, information la plus utile au quotidien, sont relégués dessous. Le KPI « Remplissage » n'est pas utilisé. Retour direct de la thérapeute après quelques semaines d'usage réel.

## Who

- **Primaire :** la thérapeute — ouvre la synthèse chaque jour pour piloter sa journée (RDV à venir, demandes à traiter).
- **Secondaire :** les patients — meilleure réactivité sur les demandes de RDV grâce à un tri plus clair côté thérapeute.

## Constraints

- Astro SSG + React islands, Tailwind utility-first ; a11y WCAG 2.1 AA — `npm run audit:a11y` requis avant la PR (règle AGENTS.md).
- Aucun changement de statuts ni d'API métier : réorganisation de l'existant (demandes = statut `pending` ; `payment_pending` sort de la liste d'actions).
- Logique « Ma semaine » et « Aujourd'hui → Demain » calculée côté client (fuseau Europe/Paris, à l'ouverture de la page).
- Le click-through « Demandes de RDV » pré-remplit le filtre de l'onglet rendez-vous (état/URL existant de l'onglet).

## Out of Scope

- Refonte visuelle au-delà de la page synthèse.
- Changements de statuts, d'API ou de modèle de données.
- #146 (indicateur de remplissage hebdomadaire du planning) : périmètre à re-vérifier séparément — ce rework retire le KPI Remplissage de la synthèse, ce qui recouvre probablement une partie de #146.

## Premise Validity

**Success in 6 months:** La synthèse est le point d'entrée quotidien de la thérapeute : prochains RDV en tête, demandes de RDV traitées directement depuis le KPI cliquable (vers l'onglet rendez-vous pré-filtré), et plus aucune mise en avant de paiement en attente dans « A traiter ».

**Failure in 6 months:** La thérapeute revient à l'onglet rendez-vous comme écran de tri principal — feedback explicite que la synthèse ne reflète pas sa charge réelle ou que le filtre pré-rempli n'est pas fiable.

**Simplest alternative:** Pur rewording + masquage des paiements en attente, sans réordonnancement ni click-through.
**Why not simplest:** La demande inclut explicitement la réorganisation (prochains RDV en tête, « Ma semaine » en 2e position) et la navigation (KPI → onglet RDV filtré, « Aujourd'hui » → « Demain ») — le rewording seul ne répond ni à l'ordre de lecture ni aux raccourcis.

## Complexity

**Tier: F-lite** — périmètre net, un seul domaine (UI admin : page synthèse + pré-remplissage du filtre de l'onglet rendez-vous), aucun schéma ni pattern nouveau ; ~4-7 fichiers (page synthèse .astro, îlot(s) KPI, onglet rendez-vous, constantes de statuts).

Signals: size label `M` → F-lite (label wins) ; scope clair d'un seul domaine ; pas d'API ni de modèle nouveau.
