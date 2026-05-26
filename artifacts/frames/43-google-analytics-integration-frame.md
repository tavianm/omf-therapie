---
issue: 43
title: "Intégrer Google Analytics 4 (GA4) avec consentement RGPD"
status: approved
tier: F-lite
created: 2026-05-26
---

## Problem Statement

Le site omf-therapie.fr diffuse des campagnes Google Ads sans pouvoir mesurer les conversions réelles (formulaire de contact, prise de rendez-vous). Sans données de conversion remontées dans Google Ads via GA4, les enchères intelligentes (Target CPA) ne peuvent pas s'optimiser, le ROI des publicités reste opaque, et le budget ads est dépensé à l'aveugle.

## Why This Matters

- **Business :** Impossible d'identifier quelles campagnes génèrent des contacts. Le budget publicitaire est alloué sans signal de performance réel.
- **Optimisation :** Les stratégies d'enchères intelligentes Google Ads (Smart Bidding) nécessitent des données de conversion GA4 pour apprendre et réduire le coût par acquisition.
- **Audience :** Sans GA4, pas de listes de remarketing ni d'audiences similaires, ce qui réduit l'efficacité des campagnes de retargeting.

## Success Criteria

- Le coût par conversion Google Ads diminue de 30% grâce aux données de conversion GA4 remontées en 6 mois
- Les conversions (soumission du formulaire de contact, clic RDV) sont visibles dans Google Ads
- Le parcours utilisateur (source → page visitée → contact) est traçable dans GA4
- Conformité RGPD/CNIL : consentement explicite recueilli avant tout tracking

## Constraints

- **Légal :** CNIL/RGPD — consentement opt-in explicite obligatoire (site de thérapie = audience sensible)
- **Performance :** Zéro impact sur le Core Web Vitals — GA4 doit s'exécuter hors du thread principal (Partytown / Web Worker)
- **Dev :** Tracking ID stocké en variable d'environnement, non hardcodé. GA4 désactivé en développement (`import.meta.env.PROD`)
- **Accessibilité :** La bannière cookie ne doit pas créer de régression pa11y (WCAG 2.1 AA)
- **Astro static :** Site en `output: 'static'` — pas de runtime serveur, tout se passe côté client

## Out of Scope

- Tracking d'événements avancés (scroll depth, video plays, heatmaps)
- Configuration Google Tag Manager (GTM) — GA4 en direct uniquement
- Intégration avec d'autres outils analytics (Hotjar, Mixpanel, etc.)
- Tests A/B via GA4 Experiments
- Configuration des objectifs de conversion côté Google Ads (responsabilité client)

## Stakeholders

- **Oriane Montabonnet** — praticienne, bénéficiaire du ROI Google Ads
- **Développeur** — implémentation technique conforme RGPD
- **CNIL** — conformité réglementaire (France, EU)

## Appetite

Tier: F-lite
Reasoning: Scope clairement délimité (4 fichiers, 2 patterns nouveaux : Partytown + CookieConsent V3). Décisions RGPD documentées dans la spec. Pas d'impact architectural majeur sur le reste du site.

## Tracking Configuration

- **Tracking ID GA4 :** *(configuré dans Netlify env vars — `PUBLIC_GA4_ID`)*
- **Événement de conversion :** CTA de fin de parcours de demande de rendez-vous (page `/rdv/merci` ou confirmation d'insertion en base de données Supabase)

## Open Questions

- Langue de la bannière CookieConsent : français uniquement ? (probable, site FR only)

## Premise Validity

**Success in 6 months:** Le coût par conversion Google Ads diminue de 30% grâce aux données de conversion GA4 (mesurable dans le tableau de bord Google Ads).

**Failure in 6 months:** Le coût par clic reste au-dessus de 1€ sans amélioration après optimisation via GA4 (observable dans Google Ads après 3 mois de données).

**Simplest alternative:** Utiliser uniquement le pixel de conversion Google Ads (sans GA4)
**Why not simplest:** Le pixel seul ne permet pas l'analyse du parcours utilisateur, ni la création d'audiences remarketing, ni la compréhension des sources de trafic — GA4 est nécessaire pour optimiser l'ensemble du funnel, pas seulement le dernier clic.
