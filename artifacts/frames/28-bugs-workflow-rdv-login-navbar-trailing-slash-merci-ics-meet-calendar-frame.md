---
issue: 28
title: "Bugs workflow RDV: login/navbar, trailing slash, merci, ICS, Meet, Calendar"
status: approved
tier: F-full
created: 2026-05-14
---

## Problem Statement
Le workflow de prise de rendez-vous présente plusieurs régressions critiques de navigation, d'UX post-action, et d'intégration calendrier/visioconférence qui dégradent le parcours patient et admin.

## Why This Matters
Ces bugs cassent des parcours clés: accès dashboard après login, cohérence des URLs, confirmation post-action, fiabilité des invitations calendrier, et accès à la visio. L'impact est direct sur la conversion et la capacité opérationnelle.

## Success Criteria
- Le bouton "Mes RDVs" reste cohérent avec l'état de session, y compris après retour sur l'accueil.
- Les redirections/navigation fonctionnent avec ou sans trailing slash sans casser les appels API/pages.
- Les pages de confirmation affichent un contenu adapté au contexte (demande vs prépaiement).
- Les emails de confirmation proposent des actions calendrier fiables (Google/Apple/Outlook) sans lien ICS cassé.
- Un lien visio est effectivement généré pour les séances vidéo et envoyé au patient.
- Les événements Google Calendar incluent les infos patient, le mode, et un marquage visuel.

## Constraints
- Respecter l'architecture Astro avec `trailingSlash: 'always'`.
- Préserver les règles métier existantes du workflow RDV/paiement.
- Garder les messages utilisateur en français.
- Reproduire les bugs via Playwright MCP.

## Out of Scope
- Refonte complète du booking flow.
- Changement de provider email/calendrier.
- Refonte UI globale hors écrans concernés.

## Stakeholders
- Patients (booking, paiement, confirmation, visio)
- Thérapeute/admin (dashboard RDV, planning)
- Équipe produit/tech (stabilité et fiabilité des parcours)

## Appetite
Tier: F-full
Reasoning: 7 bugs transverses impliquant frontend, routing Astro, API booking/stripe/webhook, intégration Google Calendar/Meet, templates email, et vérification E2E.

## Open Questions
- Aucune bloquante au cadrage; comportement attendu déjà explicité par l'issue.
