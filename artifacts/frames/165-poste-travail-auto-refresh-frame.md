---
title: "Poste de travail — rafraîchissement automatique des données admin"
issue: 165
status: approved
tier: F-lite
date: 2026-09-13
---

## Problem

La page poste de travail (`/mes-rdvs/`) charge ses données au montage (RDV, demandes à traiter, KPIs). En usage réel, la thérapeute garde la page ouverte en arrière-plan pendant la journée : sans rafraîchissement, elle voit des données périmées — nouvelles demandes de RDV, changements de statut, paiements reçus, annulations — et doit recharger manuellement la page pour être à jour. Impact observable : risque de réponse tardive aux patients et de décisions prises sur des données obsolètes.

## Who

- **Primary:** la thérapeute — page ouverte en continu, doit voir l'état à jour sans action manuelle.
- **Secondary:** l'opérateur (charge API/DB à contenir) ; les patients, bénéficiaires indirects de réponses plus rapides.

## Constraints

- Routes `/api/admin/**` : session vérifiée obligatoire ; le refresh ne doit pas multiplier d'appels incontrôlés ni court-circuiter les garde-fous existants (rate-limit).
- Sobre : pas de re-render disruptif en pleine interaction (action/formulaire ouverte), pas de spinner bloquant ; visibilité onglet et backoff pour éviter les appels inutiles quand la page est en arrière-plan.
- Compose avec #164 (rework synthèse, ouvert, backlog) — composants probablement communs ; l'ordre d'atterrissage doit rester coherent (l'un ne doit pas casser l'autre).
- Site statique Astro + îles React : pas de WebSocket serveur dédié dans la stack de déploiement actuelle — le mécanisme doit tenir dans le modèle existant (fetch des routes API admin ou Supabase Realtime côté client).

## Out of Scope

- Chemin patient (`/rendez-vous/`, wizard) inchangé.
- Changement des statuts ou de l'API métier.
- Refonte visuelle au-delà d'un indicateur éventuel de fraîcheur des données.
- Notifications hors navigateur (email/SMS) — déjà couvertes par les emails transactionnels.

## Premise Validity

**Success in 6 months:** La thérapeute garde la page ouverte toute la journée et voit les nouvelles demandes et changements de statut apparaître sans jamais recharger manuellement la page.

**Failure in 6 months:** Des demandes patient restent traitées en retard (plus de quelques heures) parce que les données affichées étaient périmées malgré le refresh — ou le refresh a dû être neutralisé (charge serveur, re-renders gênants en pleine action).

**Simplest alternative:** Un polling à intervalle fixe (ex. toutes les 30 s) qui refetch et remplace les données, sans tenir compte de la visibilité de l'onglet ni de l'activité en cours.
**Why not simplest:** Il génère des appels API/DB inutiles quand l'onglet est en arrière-plan (usage réel : ouvert en continu) et risque d'écraser des états d'UI en pleine interaction (formulaire ouvert, action en cours) — visibilité et garde d'interaction font partie du besoin, pas du polish.

## Complexity

**Tier: F-lite** — périmètre clair dans un seul domaine (dashboard admin) ; le choix du mécanisme (polling vs Supabase Realtime) est une décision de design à trancher au spec, pas une architecture multi-domaines.

Signals observés : ~4–6 fichiers (islands du poste de travail + hook partagé + tests), pas de nouveau pattern d'infrastructure, pas d'unknown bloquant.
