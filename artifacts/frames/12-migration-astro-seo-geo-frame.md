---
issue: 12
title: "Migration vers Astro + refonte SEO/GEO complète"
status: approved
tier: F-full
created: 2026-04-27
---

## Problem Statement

`omf-therapie.fr` est une React SPA (Vite + react-helmet-async) dont le SEO dépend du
prerender Netlify — une couche fragile sujette au cache stale, au contenu dupliqué et
aux problèmes de configuration. Cette architecture empêche d'atteindre un score SEO/GEO
compétitif pour les requêtes « thérapeute Montpellier » et « psychopraticien Montpellier »
dans Google et les moteurs IA (ChatGPT, Perplexity, Gemini).

De plus, plusieurs décisions du plan SEO existant (`plan-seo-geo-omf-therapie.md`) sont
incorrectes ou obsolètes (meta fragment dépréciée, schema MedicalBusiness inadapté,
section-routes dupliquées dans le sitemap).

## Why This Matters

- **Visibilité locale** : sans HTML statique, les bots Google et IA ne garantissent pas
  l'indexation complète des pages services et du blog.
- **GEO (Generative Engine Optimization)** : les moteurs IA citent en priorité du
  contenu structuré, extractable et issu de sources tierces — aucun de ces signaux
  n'est correctement produit aujourd'hui.
- **Coût de migration** : le site compte ~10 pages. Migrer maintenant coûte 10× moins
  cher qu'après avoir créé 4 pages services + blog enrichi dans la SPA.
- **Statut professionnel sensible** : Oriane est psychopraticienne (sans ADELI/RPPS),
  profession non réglementée. Le schema.org doit refléter `HealthAndBeautyBusiness`,
  non `MedicalBusiness`. Une erreur ici nuit à la crédibilité légale du site.

## Success Criteria

- [ ] Toutes les pages génèrent du HTML statique (0 dépendance JS pour le contenu indexable)
- [ ] Lighthouse SEO ≥ 95 et Performance ≥ 90 sur Home, Contact, pages services
- [ ] INP < 200ms, LCP < 2.5s, CLS < 0.1 (Core Web Vitals 2024+)
- [ ] JSON-LD `HealthAndBeautyBusiness` + `Person` + `FAQPage` validés par Rich Results Test
- [ ] JSON-LD `Article` sur chaque blog post
- [ ] 4 pages services dédiées avec vraies routes (non des ancres de Home)
- [ ] Sitemap sans les section-routes fantômes (`/Tarifs`, `/Services`, etc.)
- [ ] `robots.txt` + `llms.txt` corrects et accessibles
- [ ] pa11y : 0 erreurs WCAG 2.1 AA (accessibilité maintenue)
- [ ] Fiche Hellocare et Médoucine complètes (hors code)

## Constraints

- **Framework** : Astro (static output) + adapter `@astrojs/netlify`
- **Styles** : Tailwind CSS uniquement, 0 CSS custom sauf `src/index.css` base styles
- **Composants React** : réutilisés via `@astrojs/react` (islands) — framer-motion,
  react-hot-toast, react-helmet-async → remplacé par `<head>` Astro natif
- **Déploiement** : Netlify (aucun changement de plateforme)
- **Langue** : contenu français, code/types anglais, commits français présent
- **Schema.org** : `HealthAndBeautyBusiness`, jamais `MedicalBusiness` ni `Physician`
- **Pas de Doctolib / Ameli** : inaccessibles sans ADELI/RPPS

## Out of Scope

- CMS headless (Strapi, Contentful, Sanity) — blog reste en Content Collections statiques
- Système de réservation en ligne intégré
- Multilingue / i18n
- Tests automatisés (Vitest, Playwright) — hors périmètre de ce ticket
- Backend / API / base de données
- Refonte graphique / redesign UI

## Stakeholders

- **Oriane Montabonnet** — propriétaire, bénéficiaire final (visibilité, RDV)
- **Développeurs** — mainteneurs du site après migration
- **Visiteurs** — patients potentiels cherchant un thérapeute à Montpellier

## Appetite

**Tier : F-full** — migration architecturale multi-domaine (arch + SEO + content + schema + perf).
Estimation : 3–5 jours de travail en sprints séquentiels (migration Astro → SEO technique → contenu).

Phases :
1. **Migration Astro** — structure, routing, Content Collections, composants islands
2. **SEO/GEO technique** — schema corrects, metadata par page, sitemap, llms.txt
3. **Contenu** — pages services, /a-propos, articles GEO-extractables
4. **Référencement externe** — Hellocare, Médoucine, GBP (hors code)

## Open Questions

- PR #10 (feat/seo-geo-optimisation) : merger avant ou parallèlement à cette migration ?
  → Recommandation : merger PR #10 d'abord pour nettoyer main, puis brancher migration Astro.
- Les 10 pages de la SPA qui sont des composants autonomes (`About.tsx`, `Services.tsx`,
  `Pricing.tsx`, `Process.tsx`, `Qualifications.tsx`) : certaines sont des sections de Home
  dans l'app router, d'autres sont de vraies pages ? À clarifier lors de l'analyse.
- Contenu des pages services (800+ mots chacune) : rédigé par Oriane ou par l'équipe dev
  avec validation ?
