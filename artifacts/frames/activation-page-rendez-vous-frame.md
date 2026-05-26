---
issue: ~
title: "Activation page rendez-vous — navigation & CTAs"
status: approved
tier: F-lite
created: 2026-05-26
---

## Problem Statement

La page `/rendez-vous` existe et fonctionne (booking wizard complet), mais le site continue de router les utilisateurs vers `/contact` ou vers des liens externes `psychologue.net` quand ils veulent prendre rendez-vous. Le lien "Contact" reste dans la navbar alors que "Prendre rendez-vous" y est déjà — doublon confus. Les CTAs des pages de service, d'À propos, du blog et de la 404 pointent tous vers `/contact` avec le texte "Prendre rendez-vous".

## Why This Matters

- Les patients qui cliquent "Prendre rendez-vous" atterrissent sur un formulaire de contact générique au lieu du wizard de booking → friction inutile, perte de conversions.
- La navbar affiche deux liens à finalité similaire ("Prendre rendez-vous" + "Contact") → confusion UX.
- Les liens vers psychologue.net (page booking externe) en CTA de conversion font fuir les visiteurs hors du site.

## Success Criteria

- [ ] "Contact" retiré de la navbar desktop et mobile
- [ ] Tous les CTAs "Prendre rendez-vous" / "Prenez rendez-vous" pointent vers `/rendez-vous/`
- [ ] Le lien psychologue.net utilisé en CTA de conversion sur `/contact` pointe vers `/rendez-vous/` (les badges footer restent inchangés — certification légitime)
- [ ] La page `/rendez-vous` est toujours accessible et fonctionnelle après les changements
- [ ] Aucune erreur de lint, aucune régression de navigation

## Scope — Files to Change

| File | Change |
|------|--------|
| `src/components/navigation/NavigationItems.tsx` | Supprimer l'entrée "Contact" |
| `src/components/islands/Navbar.tsx` | Supprimer le cas spécial `isActive` pour `/contact` ; ajouter cas pour `/rendez-vous` |
| `src/pages/services/therapie-individuelle.astro` | 2 occurrences `/contact` → `/rendez-vous/` |
| `src/pages/services/therapie-de-couple.astro` | 2 occurrences `/contact` → `/rendez-vous/` |
| `src/pages/services/therapie-familiale.astro` | 2 occurrences `/contact` → `/rendez-vous/` |
| `src/pages/services/troubles-alimentaires.astro` | 2 occurrences `/contact` → `/rendez-vous/` |
| `src/pages/a-propos.astro` | 1 CTA `/contact` → `/rendez-vous/` |
| `src/pages/blog/[slug].astro` | 1 CTA `/contact` → `/rendez-vous/` |
| `src/pages/rendez-vous.astro` | 1 lien interne `/contact/` → `/rendez-vous/` |
| `src/pages/contact.astro` | Lien psychologue.net (CTA booking) → `/rendez-vous/` — psychologue.net sera entièrement supprimé dans une tâche suivante |
| `src/pages/404.astro` | CTA `/contact` → `/rendez-vous/` |

## Out of Scope

- La page `/contact` elle-même (elle reste accessible, juste dé-priorisée en nav)
- Le badge/widget psychologue.net dans le footer (`FooterHours.tsx`, `Footer.astro`) — sera supprimé dans une tâche dédiée dans les prochaines semaines (coût devenu inadapté)
- Les liens `mailto:contact@omf-therapie.fr` (emails transactionnels, non concernés)
- `accessibilite.astro` → lien `/contact` légitime dans ce contexte (contact pour problèmes d'accessibilité)
- `rdv/accepter-report.astro` → liens `/contact/` dans un contexte de report de RDV (hors scope de cette tâche)
- Footer config "Contact" — le footer reste avec le lien Contact (navigation secondaire)

## Constraints

- Pas de changement de comportement fonctionnel (pas de nouvelle feature)
- Tailwind uniquement, pas de CSS custom
- Lint doit passer (0 erreurs)

## Stakeholders

- Visiteurs patients : principale cible de conversion
- Praticienne (Oriane Montabonnet) : réduit les contacts informels non-structurés

## Appetite

Tier: F-lite
Reasoning: Modifications de navigation/liens sur ~11 fichiers, un seul domaine (routing UX). Pas de logique métier ni d'architecture.

## Open Questions

- Faut-il aussi mettre à jour `rdv/accepter-report.astro` (2 liens `/contact/`) ? Hors scope pour l'instant.
- **psychologue.net (footer badges)** — `FooterHours.tsx` et `Footer.astro` contiennent le widget/badge de certification. À supprimer dans une tâche dédiée prochainement (abandon du service pour raisons de coût).

## Premise Validity

**Success in 6 months:** 100% des CTAs "Prendre rendez-vous" du site pointent vers `/rendez-vous/`, la navbar ne comporte plus de lien "Contact", et aucune régression fonctionnelle signalée.

**Failure in 6 months:** Des liens `/contact` persistent dans les CTAs de conversion (vérifiable par grep), ou la navbar affiche encore "Contact" comme entrée principale.

**Simplest alternative:** Redirection 301 `/contact` → `/rendez-vous/` côté Netlify.
**Why not simplest:** La page contact a un usage légitime (formulaire de contact libre) ; une redirection casse ce cas d'usage. Il faut cibler chirurgicalement les CTAs de conversion, pas toute la page.
