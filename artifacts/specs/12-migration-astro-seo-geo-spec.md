---
issue: 12
title: "Migration vers Astro + refonte SEO/GEO complète"
tier: F-full
status: approved
created: 2026-04-27
---

## Goal

Migrer `omf-therapie.fr` de React SPA (Vite) vers Astro (output statique + islands), de façon
à ce que chaque page produise du HTML indexable sans JS, avec un schema.org correct, 4 pages
services dédiées, une page `/a-propos`, et un sitemap sans section-routes fantômes.

---

## Context

- **Stack actuelle :** React 18 + Vite + react-router-dom + react-helmet-async → SPA, Netlify fallback `/* → /index.html 200`
- **PR #10 mergé ✅** sur `main` — JSON-LD builders, FAQSection, LocalAreaSection, corrections meta
- **Section-routes fantômes :** `/Tarifs`, `/Services`, `/About`, `/Process`, `/Formations` ne sont que des scroll anchors sur Home, pas des pages réelles — mais présentes dans le sitemap à priority 0.7
- **Pages actuelles réelles :** `/` (Home), `/contact`, `/blog`, `/blog/:slug`, `/accessibilite`
- **Blog :** 9 posts TypeScript dans `src/utils/blogs/` — double enregistrement (index.ts + blog-list.ts)
- **Schema :** `@type: LocalBusiness` (manque GeoCoordinates, HealthAndBeautyBusiness plus précis)
- **Décisions utilisateur :** dev team rédige le contenu complet (SEO-optimisé)

---

## Acceptance Criteria

### Architecture

- [ ] **AC1** — Le build Astro produit du HTML statique pour chaque route (aucune route ne retourne le shell `index.html` pour un bot)
- [ ] **AC2** — `netlify.toml` n'a plus le redirect `/* → /index.html 200` (remplacé par build statique)
- [ ] **AC3** — `react-router-dom` et `react-helmet-async` sont absents des dépendances de production
- [ ] **AC4** — `generate-sitemap.js` est supprimé, le sitemap est généré par `@astrojs/sitemap`

### SEO technique

- [ ] **AC5** — `<title>`, `<meta name="description">`, `<link rel="canonical">` présents dans le HTML source (sans JS) de chaque page
- [ ] **AC6** — Le sitemap XML ne contient aucune des section-routes (`/Tarifs`, `/Services`, `/About`, `/Process`, `/Formations`)
- [ ] **AC7** — Chaque page a un `<link rel="canonical">` pointant vers son URL propre
- [ ] **AC8** — `/robots.txt` accessible et valide (Disallow pour les routes de section résiduelles si elles existent)
- [ ] **AC9** — `/llms.txt` accessible et listant les pages principales + autorisations IA crawlers

### Schema.org

- [ ] **AC10** — JSON-LD Home : `@type: HealthAndBeautyBusiness` avec `geo: { @type: GeoCoordinates, latitude: 43.610769, longitude: 3.876716 }`, `areaServed`, `openingHoursSpecification`
- [ ] **AC11** — JSON-LD Home : `@type: Person` avec `jobTitle: "Psychopraticienne"`, `hasCredential`, `knowsAbout`
- [ ] **AC12** — JSON-LD Blog post : `@type: Article` avec `datePublished`, `dateModified`, `wordCount`, `publisher.logo`
- [ ] **AC13** — Rich Results Test valide sur `/`, au moins une page service, et un `/blog/:slug`
- [ ] **AC14** — Aucune référence à `MedicalBusiness`, `Physician`, ou `MedicalOrganization` dans le code

### Pages

- [ ] **AC15** — 4 pages services existent comme routes Astro indépendantes : `/services/therapie-individuelle`, `/services/therapie-de-couple`, `/services/therapie-familiale`, `/services/troubles-alimentaires`
- [ ] **AC16** — Chaque page service contient : H1 ciblé, ≥ 800 mots, section FAQ (≥ 4 questions), JSON-LD `FAQPage` + `Service`, CTA contact
- [ ] **AC17** — `/a-propos` existe comme route Astro dédiée avec formations TCCE, statut légal transparent (psychopraticienne non-réglementée), photo professionnelle, JSON-LD `Person` enrichi
- [ ] **AC18** — La navigation principale pointe vers les nouvelles URLs de service (non les ancres `#services`)

### Content Collections

- [ ] **AC19** — Les 9 posts blog sont migrés en Content Collections Astro (fichiers `.md` avec frontmatter typé)
- [ ] **AC20** — Le double enregistrement (`index.ts` + `blog-list.ts`) est supprimé
- [ ] **AC21** — Chaque post MD a les champs frontmatter : `title`, `slug`, `excerpt`, `date`, `dateModified`, `categories`, `author`, `imageUrl`

### Performance & Accessibilité

- [ ] **AC22** — Lighthouse SEO ≥ 95 sur Home et au moins une page service
- [ ] **AC23** — Lighthouse Performance ≥ 90 sur Home (LCP < 2.5s, CLS < 0.1)
- [ ] **AC24** — INP < 200ms mesuré via DevTools sur Home (framer-motion + formulaire)
- [ ] **AC25** — pa11y : 0 erreurs WCAG 2.1 AA sur toutes les pages (accessibilité non dégradée vs. baseline)

---

## Breadboard

### Routing Astro (file-based, statique)

| Surface | Route | Composant Astro | Islands React |
|---|---|---|---|
| Home | `src/pages/index.astro` | Layout + sections statiques | HeroSection, IntroSection (framer-motion) |
| Contact | `src/pages/contact.astro` | Layout | ContactForm (EmailJS + toast) |
| Blog listing | `src/pages/blog/index.astro` | Layout + BlogList statique | BlogSearch, BlogPagination |
| Blog post | `src/pages/blog/[slug].astro` | Layout + contenu MD | ShareButtons |
| Accessibilité | `src/pages/accessibilite.astro` | Layout | aucun |
| Thér. individuelle | `src/pages/services/therapie-individuelle.astro` | ServiceLayout | aucun |
| Thér. couple | `src/pages/services/therapie-de-couple.astro` | ServiceLayout | aucun |
| Thér. familiale | `src/pages/services/therapie-familiale.astro` | ServiceLayout | aucun |
| Troubles alim. | `src/pages/services/troubles-alimentaires.astro` | ServiceLayout | aucun |
| À propos | `src/pages/a-propos.astro` | Layout | aucun |

### SEO Head (Astro natif)

| Entrée | Propriété | Source |
|---|---|---|
| `<title>` | `title` prop sur Layout | Par page |
| `<meta description>` | `description` prop | Par page |
| `<link canonical>` | `canonicalUrl` prop | URL de la page |
| JSON-LD | `<script type="application/ld+json">` | `src/utils/schema.ts` (réutilisé) |
| OG tags | `og:title`, `og:description`, `og:image` | Props Layout |

### Islands (client:load)

| Island | Trigger | Données |
|---|---|---|
| `Navbar.tsx` | `client:load` | `navigationItems` (config) |
| `HeroSection.tsx` | `client:load` | aucun (framer-motion interne) |
| `ContactForm.tsx` | `client:load` | EmailJS keys depuis env |
| `BlogSearch.tsx` + `BlogPagination.tsx` | `client:load` | liste des posts (props) |
| `ShareButtons.tsx` | `client:visible` | `title`, `url` (props) |

### Content Collections

```
src/content/
  blog/
    gerer-anxiete-quotidien.md
    therapie-couple-communication.md
    ...
  config.ts   ← defineCollection avec zod schema
```

---

## Slices

**Slice 1 — Fondations Astro** *(dépendances + layout + navigation)*

Initialiser le projet Astro dans un worktree `feat/12-astro-migration`.
Configurer `astro.config.mjs` (output: static, @astrojs/react, @astrojs/tailwind, @astrojs/sitemap, @astrojs/netlify).
Créer `Layout.astro` avec `<head>` SEO natif (title, description, canonical, OG, JSON-LD slot).
Migrer `Navbar.tsx` comme island React (`client:load`).
Créer `Footer.astro` statique (contenu de `Footer.tsx`).
Reconfigurer `tailwind.config.js`, `postcss.config.js`.
Mettre à jour `netlify.toml` (supprimer redirect SPA, `output: static`).

*Fichiers affectés :* `astro.config.mjs`, `src/layouts/Layout.astro`, `src/layouts/ServiceLayout.astro`,
`src/components/layout/Navbar.tsx` (island), `src/components/layout/Footer.astro`,
`tailwind.config.js`, `postcss.config.js`, `netlify.toml`, `package.json`

---

**Slice 2 — Migration pages core** *(Home, Contact, Blog, Accessibilite)*

Migrer `Home.tsx` → `src/pages/index.astro` :
- sections statiques en Astro (About, Services, Pricing, Process, Qualifications, LocalArea, FAQ)
- islands : `HeroSection` (`client:load`), `IntroSection` (`client:load`)
- JSON-LD via slot Layout

Migrer `Contact.tsx` → `src/pages/contact.astro` + island `ContactForm` (`client:load`).

Migrer `Blog.tsx` → `src/pages/blog/index.astro` + Content Collections :
- Créer `src/content/config.ts` (zod schema pour blog)
- Migrer les 9 posts `.ts` → `.md` dans `src/content/blog/`
- Supprimer `src/utils/blogs/`, `src/utils/blog-list.ts`, `src/utils/blogApi.ts`
- Islands : `BlogSearch` + `BlogPagination` (`client:load`)

Migrer `BlogPost.tsx` → `src/pages/blog/[slug].astro` :
- `getStaticPaths()` depuis Content Collections
- Island `ShareButtons` (`client:visible`)
- JSON-LD Article dans le head

Migrer `Accessibilite.tsx` → `src/pages/accessibilite.astro` (statique pur).

*Fichiers affectés :* `src/pages/index.astro`, `src/pages/contact.astro`,
`src/pages/blog/index.astro`, `src/pages/blog/[slug].astro`, `src/pages/accessibilite.astro`,
`src/content/config.ts`, `src/content/blog/*.md` (9 fichiers),
`src/components/islands/HeroSection.tsx`, `src/components/islands/ContactForm.tsx`,
`src/components/islands/BlogSearch.tsx`, `src/components/islands/ShareButtons.tsx`,
`src/utils/schema.ts` (réutilisé, corrections schema.org)

---

**Slice 3 — SEO/GEO technique** *(schema, pages services, a-propos, sitemap, llms.txt)*

Créer 4 pages services dédiées :
```
src/pages/services/
  therapie-individuelle.astro
  therapie-de-couple.astro
  therapie-familiale.astro
  troubles-alimentaires.astro
```
Chacune utilise `ServiceLayout.astro` avec : H1 ciblé, intro GEO-extractable (réponse dans les 200 premiers mots), corps 800+ mots, FAQ (≥ 4 questions) avec JSON-LD `FAQPage`, JSON-LD `Service`, CTA, lien interne vers `/contact`.

Créer `src/pages/a-propos.astro` :
- Formations TCCE, statut légal transparent, photo professionnelle
- JSON-LD `Person` enrichi : `jobTitle: "Psychopraticienne"`, `hasCredential`, `alumniOf`, `knowsAbout`

Corriger `src/utils/schema.ts` :
- `buildLocalBusinessSchema()` : `@type: HealthAndBeautyBusiness`, `geo: GeoCoordinates`, `areaServed`
- `buildPersonSchema()` : `jobTitle: "Psychopraticienne"`, `hasCredential`, `alumniOf`, `knowsAbout`
- Nouveau `buildServiceSchema(service)` pour les pages services

Créer `public/llms.txt` (pages autorisées, crawlers IA bienvenus).
Créer `public/robots.txt` si absent (autoriser tout, `Sitemap:` pointer vers sitemap.xml).
Configurer `@astrojs/sitemap` pour exclure les routes section (`/Tarifs`, etc.) qui n'existeront plus.

Mettre à jour la navigation : remplacer `href="#services"` → `/services/therapie-individuelle`, etc.

*Fichiers affectés :* `src/pages/services/*.astro` (4 fichiers), `src/pages/a-propos.astro`,
`src/utils/schema.ts`, `src/config/global.config.ts` (ajout GeoCoordinates),
`public/llms.txt`, `public/robots.txt`, `astro.config.mjs` (sitemap config),
`src/components/layout/Navbar.tsx` (liens nav mis à jour), `src/config/footer.config.ts`

---

**Slice 4 — Contenu SEO/GEO** *(800+ mots par service, 3 nouveaux articles GEO)*

Rédiger le contenu long-form pour chaque page service (dev team, SEO-optimisé) :
- **Thérapie individuelle** : H1 + intro extractable + sections H2 (symptômes, déroulement, tarifs) + FAQ + CTA
- **Thérapie de couple** : H1 + intro extractable + sections H2 + FAQ + CTA
- **Thérapie familiale** : H1 + intro extractable + sections H2 + FAQ + CTA
- **Troubles alimentaires** : H1 + intro extractable + sections H2 + FAQ + CTA

Créer 3 nouveaux articles blog GEO-extractables :
1. `qu-est-ce-qu-un-psychopraticien.md` — featured snippet + citation IA
2. `difference-psychologue-psychotherapeute-psychopraticien.md` — requête informationnelle forte
3. `remboursement-mutuelle-psychotherapie-montpellier.md` — intentionnalité de conversion

Format GEO : réponse directe dans les 200 premiers mots, structure Q&A, données locales (Montpellier).

*Fichiers affectés :* `src/pages/services/*.astro` (contenu long-form injecté), `src/content/blog/*.md` (3 nouveaux fichiers)

---

## Out of Scope

- CMS headless (Strapi, Contentful, Sanity)
- Tests automatisés Vitest / Playwright
- Refonte graphique / changement de palette de couleurs
- Multilingue / i18n
- Système de réservation en ligne
- Backend / API / base de données
- Inscription manuelle aux annuaires (Hellocare, Médoucine) — hors code, suivi séparé
- Google Business Profile posts — hors code

---

## Open Questions

- `src/pages/About.tsx`, `Services.tsx`, `Pricing.tsx`, `Process.tsx`, `Qualifications.tsx` sont des composants section dans Home → ils seront portés comme composants Astro statiques intégrés dans `index.astro`, non comme pages autonomes. ✅ Décision prise.
- PR #10 mergé sur main ✅ — pas de conflit de départ.
- Contenu 800+ mots des pages services : rédigé par l'équipe dev (dev_full). ✅ Décision prise.
- GeoCoordinates à ajouter dans `global.config.ts` : `latitude: 43.610769, longitude: 3.876716` (à valider sur Google Maps).
