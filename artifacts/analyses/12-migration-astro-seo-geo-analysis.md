---
issue: 12
title: "feat(arch/seo): Migration vers Astro + refonte SEO/GEO complète"
type: feature
complexity: L
tier: F-full
created: 2025-07-14
---

## Problem

`omf-therapie.fr` est une React SPA servie via un fallback Netlify (`/* → /index.html 200`).
Sans prerender, Googlebot reçoit un HTML vide — `<title>`, `<meta>`, et les JSON-LD ne sont
générés qu'après exécution JavaScript. Les bots d'indexation IA (GPTBot, ClaudeBot, PerplexityBot)
n'exécutent pas JS. Le site est structurellement invisible pour le SEO/GEO natif.

---

## Current State

### Architecture réseau

| Couche | Implémentation actuelle | Problème |
|---|---|---|
| Serveur | Netlify SPA fallback `200` | Googlebot reçoit HTML vide |
| SEO head | `react-helmet-async` | Dépend de JS, invisible sans exécution |
| JSON-LD | `StructuredData` composant | Injecté après hydratation uniquement |
| Sitemap | `generate-sitemap.js` (script manuel) | Inclut section-routes → duplicate content |
| Robots | `public/robots.txt` (probablement absent) | Non vérifié |

### Routing (src/App.tsx)

**Routes réelles (pages indépendantes) :**
- `/` → `Home.tsx`
- `/contact` → `Contact.tsx`
- `/blog` → `Blog.tsx`
- `/blog/:slug` → `BlogPost.tsx`
- `/accessibilite` → `Accessibilite.tsx`

**Section-routes (scroll anchors sur Home, pas des pages) :**
- `/Tarifs` → `id="pricing"` sur Home
- `/Services` → `id="services"` sur Home
- `/About` → `id="about"` sur Home
- `/Process` → `id="process"` sur Home
- `/Formations` → `id="qualifications"` sur Home

Ces 5 routes figurent dans le sitemap XML à `priority 0.7` — risque de contenu dupliqué
(`/Services` et `/` ont le même HTML, zéro différenciation).

### Schema.org (post-PR#10)

| Builder | Type actuel | Problème |
|---|---|---|
| `buildLocalBusinessSchema()` | `LocalBusiness` | Acceptable mais `HealthAndBeautyBusiness` plus précis pour une psychopraticienne non-médicale |
| `buildPersonSchema()` | `Person` + `jobTitle: "Thérapeute"` | `jobTitle` inexact (`"Psychopraticienne"`), pas de `hasCredential`, `alumniOf`, `knowsAbout` |
| `buildArticleSchema()` | `Article` | Manque `dateModified`, `wordCount`, `publisher.logo`, `mainEntityOfPage` |
| — | Absent | Pas de `GeoCoordinates` dans LocalBusiness |
| — | Absent | Pas de `areaServed` (communes cibles) |

### Blog (9 posts)

Structure actuelle :
1. Chaque post = fichier TypeScript dans `src/utils/blogs/<slug>.ts`
2. Export barrel dans `src/utils/blogs/index.ts` (manual)
3. Enregistrement manuel dans `src/utils/blog-list.ts` → **double synchro obligatoire**
4. Contenu = template literal HTML string dans `content: \`...\``
5. Type `BlogPost` sans `dateModified`, `readingTime`, `wordCount`

Problème GEO : le contenu HTML est invisible au build statique, zéro extractabilité sans JS.

### Composants interactifs (islands candidates)

| Composant | Librairie | Island ? |
|---|---|---|
| `HeroSection` | framer-motion | ✅ React island |
| `IntroSection` | framer-motion | ✅ React island |
| `ContactForm` | @emailjs/browser + react-hot-toast | ✅ React island (critique) |
| `BlogSearch` + `BlogPagination` | état local | ✅ React island |
| `ShareButtons` | useClipboard | ✅ React island |
| `Navbar` (mobile menu) | useState | ✅ React island |
| `Footer` | statique | ❌ Astro natif |
| `FAQSection` | HTML statique + props | ❌ Astro natif |
| `LocalAreaSection` | statique | ❌ Astro natif |
| Pages services (sections) | statique | ❌ Astro natif |

### Gaps SEO/GEO critiques

1. **Pages services absentes** : `/therapie-individuelle`, `/therapie-de-couple`,
   `/therapie-familiale`, `/troubles-alimentaires` n'existent pas en tant que routes réelles.
   Ce sont des paragraphes dans `Services.tsx` montés en section Home. Zéro URL propre,
   zéro H1 ciblé, zéro JSON-LD `Service` par spécialité.

2. **Page `/a-propos` absente** : `About.tsx` est une section de Home (anchor `#about`).
   Pas de page dédiée avec formations TCCE, statut légal transparent, E-E-A-T structuré.

3. **`/llms.txt` absent** : standard émergent 2025-2026 pour guider les crawlers IA.

4. **Requêtes différenciantes non adressées** :
   - `psychopraticien Montpellier` (faible concurrence, conversion directe)
   - `différence psychologue psychothérapeute psychopraticien` (featured snippet + GEO)
   - `remboursement mutuelle psychothérapie Montpellier` (forte intentionnalité)

5. **INP non mesuré** : framer-motion + formulaire contact = principaux candidats INP.
   Metric Core Web Vitals depuis mars 2024, remplace FID.

---

## Impact

- **Utilisateurs affectés :** visibilité organique (Googlebot, IA crawlers) — 100% trafic acquisition
- **Sévérité :** high — le site n'est indexé correctement que si les bots exécutent JS (cas rare)
- **Fichiers affectés :** 70+ (migration complète Vite → Astro)

---

## Approach Options

### Option A — Migration in-place : Vite → Astro dans le même dossier

Convertir `vite.config.ts` → `astro.config.mjs`, renommer `src/pages/*.tsx` → `src/pages/*.astro`,
adapter les layouts.

**Pros :**
- Un seul repository, pas de copie de fichiers
- Historique git préservé directement

**Cons :**
- Conflits tooling très probables (Vite plugins, tsconfig, tailwind.config)
- Rollback difficile si le build échoue en mi-chemin
- React Router + AutoScrollHandler incompatibles avec Astro routing → refactor complet requis
- Risque élevé de régression accessibilité / style pendant la transition

**Risk : high**

---

### Option B — Nouveau projet Astro dans une branche dédiée (recommandé ✅)

Créer un worktree `feat/12-astro-migration`, initialiser un projet Astro fresh,
migrer page par page, réutiliser les composants React comme islands via `@astrojs/react`.

**Structure cible :**
```
src/
  components/         # Composants Astro (.astro) + React islands (.tsx)
    islands/          # Composants React interactifs (framer-motion, forms, search)
    layout/           # Layout.astro, Navbar.astro, Footer.astro
    seo/              # SEO.astro avec <head> natif Astro
  content/
    blog/             # Content Collections Astro (remplace src/utils/blogs/)
      *.md ou *.mdx   # Format Markdown avec frontmatter
  pages/              # Routes Astro (HTML statique par défaut)
    index.astro       # Home
    contact.astro     # Contact
    blog/
      index.astro     # Blog listing
      [slug].astro    # Blog post dynamique
    services/
      therapie-individuelle.astro
      therapie-de-couple.astro
      therapie-familiale.astro
      troubles-alimentaires.astro
    a-propos.astro    # NOUVELLE PAGE
    accessibilite.astro
  config/
    global.config.ts  # NAP data (réutilisé tel quel)
    site.ts           # Config Astro (collections schema)
```

**Pros :**
- HTML statique natif par page (zéro prerender)
- Content Collections : frontmatter typé, pas de double enregistrement
- `@astrojs/sitemap` : sitemap auto sans section-routes
- Build Netlify standard sans redirect fallback SPA
- Tous les composants React existants réutilisables as-is via `client:load`
- Isolation parfaite : branche dédiée, main inchangé jusqu'au PR

**Cons :**
- Réinitialisation config (tailwind, postcss, eslint) dans le nouveau projet Astro
- `react-router-dom` à retirer (routing Astro natif)
- `react-helmet-async` à remplacer (`<head>` Astro natif)
- `generate-sitemap.js` à supprimer (remplacé par `@astrojs/sitemap`)

**Risk : medium** (bien balisé, reversal facile)

---

### Option C — Wrapper @astrojs/react full-page (non recommandé)

Garder toutes les pages comme full React, wrapper dans un layout Astro.

**Cons :**
- Hydratation complète du bundle React → perd l'avantage 0 JS d'Astro
- Équivalent à un SSG Vite amélioré, pas un vrai gain Astro

**Risk : low but low value**

---

## Recommendation

**Option B** — Nouveau projet Astro en branche `feat/12-astro-migration`.

Séquence d'implémentation en 4 slices :

| Slice | Contenu | Clé de succès |
|---|---|---|
| **S1 — Fondations Astro** | Init Astro + tailwind + Netlify adapter, Layout.astro, Navbar island, Footer static | Build vert, deploy preview Netlify |
| **S2 — Migration pages core** | Home, Contact, Blog (listing + post), Accessibilite | HTML statique par page, SEO head natif, island React |
| **S3 — SEO/GEO technique** | 4 pages services + a-propos, schema HealthAndBeautyBusiness + GeoCoordinates, FAQ JSON-LD par service, llms.txt, sitemap propre | Rich Results Test vert, 0 section-routes en sitemap |
| **S4 — Contenu SEO** | Contenu 800+ mots par service page, articles blog GEO, Content Collections migration | Extractabilité GEO, Lighthouse ≥ 95 |

**Pré-requis :** PR #10 mergé sur `main` ✅ (déjà fait).

---

## Appetite

Estimated tier: F-full
Spike: non requis — migration Astro documentée, pattern islands connu.

Dépendances clés :
- `astro` + `@astrojs/react` + `@astrojs/tailwind` + `@astrojs/sitemap` + `@astrojs/netlify`
- `framer-motion`, `@emailjs/browser`, `react-hot-toast`, `lucide-react` → réutilisés
- `react-helmet-async`, `react-router-dom` → supprimés
- `vite`, `@vitejs/plugin-react` → remplacés par Astro build
