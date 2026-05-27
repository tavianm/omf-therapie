---
issue: 46
title: "Améliorer le SEO pour cibler le top 3 sur 'thérapeute Montpellier' et termes associés"
status: approved
tier: F-full
created: 2026-05-27
---

## Problem Statement

Le site omf-therapie.fr est invisible sur les recherches Google les plus importantes pour attirer des patients à Montpellier : "thérapeute à Montpellier", "thérapie de couple", "anxiété aide psy". Cette invisibilité organique prive la praticienne de nouveaux patients alors que la concurrence locale est présente et visible.

## Why This Matters

- **Impact praticienne :** Pas de visibilité = pas de nouveaux patients via Google, canal d'acquisition principal dans le secteur de la santé mentale.
- **Valeur business :** Un top 3 sur "thérapeute Montpellier" peut générer 10+ nouvelles demandes de contact/mois sans budget publicitaire récurrent.
- **Enjeu concurrentiel :** Les premiers résultats Google captent 65–75 % des clics organiques ; être hors top 5 équivaut à être invisible.

## Success Criteria

- Apparaître en position 1–3 sur "thérapeute Montpellier" dans Google.fr en moins de 6 mois
- Apparaître en top 5 sur "thérapie de couple Montpellier" et requêtes d'anxiété associées
- Recevoir ≥10 nouvelles demandes de contact/mois provenant du trafic organique Google
- Augmentation mesurable du trafic organique (Google Search Console)

## Constraints

- Site statique Astro 5 (SSG) — les modifications doivent rester compatibles avec le build static + Netlify
- Pas de CMS headless pour l'instant — contenu managé via fichiers Markdown
- Budget publicitaire limité (SEO organique uniquement, pas de Google Ads)
- Calendrier : 6 mois pour atteindre les positions cibles
- Praticienne = seule auteure du contenu — nécessite des templates/guidelines clairs

## Out of Scope

- Campagnes Google Ads / SEA
- Refonte complète de l'architecture du site
- Support multilingue
- Portail patient ou espace membre
- SEO hors France / hors Montpellier

## Stakeholders

- **Oriane Montabonnet** (praticienne) — bénéficiaire principale, source du contenu
- **Patients potentiels à Montpellier** — audience cible des recherches
- **Développeur** — responsable des optimisations techniques

## Appetite

Tier: F-full
Reasoning: SEO implique plusieurs domaines interdépendants — technique (schema.org, meta, Core Web Vitals, sitemap), contenu (pages de service, blog, mots-clés longue traîne), et off-page (Google Business Profile, backlinks locaux). Chaque domaine est un chantier à part entière.

## Open Questions

- ~~Le site est-il indexé par Google (Search Console configurée) ?~~ ✓ Oui, configurée
- ~~Existe-t-il déjà un profil Google Business Profile ?~~ ✓ Oui, configuré
- ~~Quels sont les concurrents directs déjà positionnés en top 3 ?~~ ✓ Identifiés :
  - https://therapie-montpellier.com/
  - https://therapeute-montpellier.fr/
  - https://www.gorana-psy-montpellier.com/
- Y a-t-il des backlinks existants vers le site ?
- Les Core Web Vitals actuels (LCP, CLS, FID/INP) sont-ils dans les seuils Google ?

## Premise Validity

**Success in 6 months:** Apparaître en position 1–3 sur 'thérapeute Montpellier' et recevoir 10 nouvelles demandes/mois via le site.

**Failure in 6 months:** Toujours hors top 5 sur les 3 requêtes cibles après 6 mois d'optimisations et 0 augmentation du trafic organique.

**Simplest alternative:** Publier une seule page optimisée 'Thérapeute Montpellier'.
**Why not simplest:** Google privilégie les sites avec autorité de domaine, contenu riche et thématique cohérente, et backlinks de qualité. Une seule page ne construit pas l'autorité nécessaire pour dépasser les annuaires (Doctolib, PagesJaunes) et les concurrents établis.
