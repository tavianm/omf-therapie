---
issue: 46
title: "Améliorer le SEO pour cibler le top 3 sur 'thérapeute Montpellier' et termes associés"
tier: F-full
status: approved
---

## Goal

Atteindre le top 3 Google sur "thérapeute Montpellier" et les requêtes associées (anxiété, thérapie de couple) en 6 mois, via 4 leviers : technique schema.org, nouvelles pages de service, enrichissement du contenu existant, et off-page (annuaires + GBP).

## Context

Le site omf-therapie.fr est construit avec Astro 5 (SSG), TypeScript, Tailwind. La gestion du SEO est centralisée dans :
- `src/layouts/Layout.astro` — meta head, JSON-LD injection
- `src/utils/schema.ts` — builders de schemas structurés
- `src/config/global.config.ts` — métadonnées globales
- `src/pages/services/*.astro` — pages de service (4 existantes)
- `src/content/blog/*.md` — articles blog (12 existants)

Les 3 concurrents top 3 n'utilisent **aucun schema.org** — avantage à consolider.
Les avis clients existent déjà sur **Google Business Profile**, **psychologue.net** et **PagesJaunes** → AggregateRating activable immédiatement.
La praticienne rédige le contenu ; le développeur intègre et optimise.

---

## Acceptance Criteria

### Pilier 1 — Schema.org enrichi
- [ ] **AC-S1** — Le schema `LocalBusiness` sur la homepage inclut un bloc `AggregateRating` avec `ratingValue`, `ratingCount` et `reviewCount` correspondant aux avis réels GBP
- [ ] **AC-S2** — Chaque page avec breadcrumb HTML (services, blog, a-propos, contact) génère aussi un schema `BreadcrumbList` valide et vérifié dans le Rich Results Test de Google
- [ ] **AC-S3** — La homepage expose un schema `WebSite` avec `SearchAction` (sitelinks search box)
- [ ] **AC-S4** — Le schema `LocalBusiness` inclut un champ `description` enrichi ("psychopraticienne TCCE à Montpellier, spécialisée en thérapie individuelle, de couple, familiale et troubles alimentaires")
- [ ] **AC-S5** — `COMPANY_DESCRIPTION` dans `global.config.ts` est mis à jour pour refléter la spécialité + localité

### Pilier 2 — Nouvelle page "Anxiété"
- [ ] **AC-P1** — La page `/services/anxiete-montpellier` existe et est accessible
- [ ] **AC-P2** — La page contient ≥ 1 200 mots de contenu textuel (hors balises HTML)
- [ ] **AC-P3** — La page a un `<title>` incluant "anxiété" et "Montpellier", une meta-description ≤ 160 caractères, et une URL canonique
- [ ] **AC-P4** — La page expose un schema `Service` + `FAQPage` (≥ 4 questions)
- [ ] **AC-P5** — La page est listée dans le sitemap généré par Astro
- [ ] **AC-P6** — La page apparaît dans la navigation de `/services/index.astro`
- [ ] **AC-P7** — Au moins 3 articles de blog existants traitant de l'anxiété pointent vers cette nouvelle page (lien interne)

### Pilier 3 — Enrichissement contenu existant
- [ ] **AC-C1** — La page `therapie-individuelle.astro` atteint ≥ 1 200 mots de contenu textuel (actuel : ~788)
- [ ] **AC-C2** — La page `therapie-de-couple.astro` atteint ≥ 1 200 mots de contenu textuel (actuel : ~856)
- [ ] **AC-C3** — La page `a-propos.astro` mentionne explicitement la spécialité TCCE, la ville Montpellier dans le H1 ou premier paragraphe, et l'approche intégrative
- [ ] **AC-C4** — Les articles de blog qui mentionnent des services spécifiques contiennent au moins 1 lien interne vers la page de service correspondante
- [ ] **AC-C5** — Chaque article de blog expose un lien vers `/contact` ou `/rendez-vous` en fin d'article (CTA)

### Pilier 4 — Off-page (checklist / guide — non automatisable)
- [ ] **AC-O1** — Un guide de référencement dans les annuaires est fourni (therapeutes.com, resalib.fr, medoucine.com, PagesJaunes) avec les informations NAP exactes à utiliser
- [ ] **AC-O2** — La description du Google Business Profile est alignée avec la meta description de la homepage (cohérence NAP + wording)
- [ ] **AC-O3** — Une checklist d'optimisation GBP est fournie (catégorie, photos, posts, réponse aux avis)

---

## Breadboard

### Slice 1 — Schema enrichissements (technique)

| Surface | Action | Handler | Données |
|---------|--------|---------|---------|
| `src/utils/schema.ts` | Ajouter `buildAggregateRatingSchema()` | `buildLocalBusinessSchema()` l'intègre | ratingValue, ratingCount, reviewCount |
| `src/utils/schema.ts` | Ajouter `buildBreadcrumbSchema(items)` | Appelé dans chaque page `.astro` | `[{name, url}]` |
| `src/utils/schema.ts` | Ajouter `buildWebSiteSchema()` | Appelé dans `index.astro` | SITE_URL, SearchAction |
| `src/config/global.config.ts` | Mettre à jour `COMPANY_DESCRIPTION` | Utilisé dans schema Person | string |
| `src/pages/index.astro` | Passer `buildWebSiteSchema()` dans `jsonLd` | Layout.astro injection | — |
| `src/pages/services/*.astro` | Passer `buildBreadcrumbSchema()` dans `jsonLd` | Layout.astro injection | items breadcrumb |
| `src/pages/a-propos.astro` | Passer `buildBreadcrumbSchema()` | Layout.astro injection | — |
| `src/pages/contact.astro` | Passer `buildBreadcrumbSchema()` | Layout.astro injection | — |
| `src/pages/blog/[slug].astro` | Passer `buildBreadcrumbSchema()` | Layout.astro injection | slug, title |

### Slice 2 — Nouvelle page anxiété

| Surface | Action | Handler | Données |
|---------|--------|---------|---------|
| `src/pages/services/anxiete-montpellier.astro` | Créer page complète | Layout.astro | meta, schema Service+FAQ, contenu ≥1200 mots |
| `src/pages/services/index.astro` | Ajouter card "Anxiété" | ServicesSection component | lien /services/anxiete-montpellier |
| `src/content/blog/gerer-anxiete-quotidien-*` | Ajouter lien interne | Markdown | lien vers /services/anxiete-montpellier |
| `src/content/blog/gestion-stress-anxiete-*` | Ajouter lien interne | Markdown | lien vers /services/anxiete-montpellier |

### Slice 3 — Enrichissement pages existantes

| Surface | Action | Handler | Données |
|---------|--------|---------|---------|
| `src/pages/services/therapie-individuelle.astro` | Ajouter sections contenu | HTML inline | ~400 mots supplémentaires |
| `src/pages/services/therapie-de-couple.astro` | Ajouter sections contenu | HTML inline | ~350 mots supplémentaires |
| `src/pages/a-propos.astro` | Enrichir bio + TCCE mention | HTML inline | Montpellier dans H1 check |
| `src/content/blog/*.md` | Ajouter liens internes + CTA | Markdown | 1 lien service + 1 CTA/article |

### Slice 4 — Off-page guide

| Surface | Action | Handler | Données |
|---------|--------|---------|---------|
| `docs/seo-offpage-guide.md` | Créer guide annuaires | — | NAP cohérent, checklist GBP |

---

## Slices (ordre d'exécution)

**Slice 1 — Schema enrichissements** *(impact immédiat, 0 dépendances)*
Fichiers : `src/utils/schema.ts`, `src/config/global.config.ts`, `src/pages/index.astro`, toutes les pages `.astro` existantes.
Durée estimée : 2–3h. Peut être déployé indépendamment.

**Slice 2 — Nouvelle page anxiété** *(dépend du contenu praticienne)*
Fichiers : `src/pages/services/anxiete-montpellier.astro`, `src/pages/services/index.astro`, 2 articles blog.
Durée estimée : 2–4h (dev) + rédaction praticienne.

**Slice 3 — Enrichissement contenu existant** *(dépend du contenu praticienne)*
Fichiers : 2 pages service, `a-propos.astro`, ~8 articles blog.
Durée estimée : 1–2h (dev intégration) + rédaction praticienne.

**Slice 4 — Off-page guide** *(autonome — ne bloque pas les autres)*
Fichiers : `docs/seo-offpage-guide.md`.
Durée estimée : 1h (rédaction guide).

---

## Out of Scope

- Intégration Doctolib (profession non réglementée — non éligible)
- Support multilingue
- Refonte de l'architecture du site
- Google Ads / SEA
- Implémentation d'un CMS headless
- Automated ranking tracking (outil tiers, hors code)
- Modification du type schema `HealthAndBeautyBusiness` → `Psychologist` (titre réglementé en France)

---

## Open Questions

- ~~[NEEDS CLARIFICATION: Combien d'avis existent sur GBP / note moyenne ?]~~ → **14 avis** — ratingValue à vérifier dans GBP avant déploiement (viser la valeur exacte pour AggregateRating)
- ~~[NEEDS CLARIFICATION: La page `/services/index.astro` utilise `ServicesSection` — modifier le component ou la page ?]~~ → **Modifier la page Astro directement**
- ~~[NEEDS CLARIFICATION: Contenu anxiété — praticienne d'abord ou IA draft ?]~~ → **IA génère un premier jet, praticienne valide avant déploiement**
