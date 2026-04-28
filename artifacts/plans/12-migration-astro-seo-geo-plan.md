---
issue: 12
tier: F-full
spec: artifacts/specs/12-migration-astro-seo-geo-spec.md
status: approved
created: 2026-04-27
---

## Tasks

| ID  | Description | Agent | Files | Dépendances | Parallel? |
|-----|-------------|-------|-------|-------------|-----------|
| T1  | Init projet Astro dans worktree `feat/12-astro-migration` : `npm create astro@latest`, installer `@astrojs/react`, `@astrojs/tailwind`, `@astrojs/sitemap`, `@astrojs/netlify`. Configurer `astro.config.mjs` (output: static). Porter `tailwind.config.js`, `postcss.config.js`. Supprimer redirect SPA dans `netlify.toml`. Mettre à jour `package.json` scripts. | devops | `astro.config.mjs`, `netlify.toml`, `package.json`, `tailwind.config.js`, `postcss.config.js`, `tsconfig.json` | — | N |
| T2  | Créer `src/layouts/Layout.astro` avec `<head>` SEO natif complet (title, description, canonical, OG, Twitter Card, JSON-LD slot via `<Fragment>`). Créer `src/layouts/ServiceLayout.astro` pour les pages services (H1 structuré, FAQ slot, CTA). Corriger `src/utils/schema.ts` : `HealthAndBeautyBusiness` + `GeoCoordinates`, `Person.jobTitle: "Psychopraticienne"` + `hasCredential` + `alumniOf` + `knowsAbout`, nouveau `buildServiceSchema()`, `buildArticleSchema()` avec `dateModified`/`wordCount`/`publisher.logo`. Ajouter `GEO_COORDINATES` dans `src/config/global.config.ts`. | frontend-dev | `src/layouts/Layout.astro`, `src/layouts/ServiceLayout.astro`, `src/utils/schema.ts`, `src/config/global.config.ts` | T1 | N |
| T3  | Migrer `Navbar.tsx` → island React `client:load` : remplacer `Link` (react-router-dom) par `<a>` Astro, adapter `useScrollToSection` pour navigation interne Home. Créer `src/components/layout/Footer.astro` statique (port de `Footer.tsx`). Mettre à jour `tailwind.config.js` content globs pour inclure `.astro` et `.md`. | frontend-dev | `src/components/islands/Navbar.tsx`, `src/components/layout/Footer.astro`, `src/hooks/useScrollToSection.ts`, `tailwind.config.js` | T1 | N |
| T4  | Créer `src/content/config.ts` (defineCollection avec zod schema complet : title, slug, excerpt, date, dateModified?, categories, author, imageUrl?, disabled?). Migrer les 9 posts `.ts` → `.md` dans `src/content/blog/` (frontmatter typé + contenu HTML → Markdown). ⚠️ Ne pas supprimer les anciens fichiers TS avant la validation de T7 (blog parity). | frontend-dev | `src/content/config.ts`, `src/content/blog/*.md` (9 fichiers) | T1 | Y (avec T2) |
| T4b | Après validation blog parity (T7 vert) : supprimer `src/utils/blogs/`, `src/utils/blog-list.ts`, `src/utils/blogApi.ts`. Ajouter redirects legacy section-routes dans `netlify.toml` : `/Tarifs` → `/#pricing` (301), `/Services` → `/services/therapie-individuelle` (301), `/About` → `/a-propos` (301), `/Process` → `/#process` (301), `/Formations` → `/#qualifications` (301). Créer `src/pages/404.astro`. | frontend-dev | `src/utils/blogs/` (supprimé), `src/utils/blog-list.ts` (supprimé), `src/utils/blogApi.ts` (supprimé), `netlify.toml` (redirects 301), `src/pages/404.astro` | T7 | N |
| T5  | Créer `src/pages/index.astro` (Home) : **toutes les sections actuelles** migrées en statique Astro (HeroSection island, IntroSection island, About, Services summary, Process, Qualifications, Pricing, LocalArea, FAQ). JSON-LD HealthAndBeautyBusiness + Person + FAQPage dans `<head>`. Navigation interne par ancres (`#about`, `#services`, `#pricing`, `#process`, `#qualifications`) préservée. Supprimer `src/pages/Home.tsx`. | frontend-dev | `src/pages/index.astro`, `src/components/islands/HeroSection.tsx`, `src/components/islands/IntroSection.tsx`, sections statiques `src/components/home/*.astro` | T2, T3 | Y (avec T6, T7, T8, T9, T10) |
| T6  | Créer `src/pages/contact.astro` : layout statique + island `ContactForm` (`client:load`). Porter `useContactForm.ts` (garder EmailJS + react-hot-toast). Supprimer `src/pages/Contact.tsx`. | frontend-dev | `src/pages/contact.astro`, `src/components/islands/ContactForm.tsx`, `src/hooks/useContactForm.ts` | T2, T3 | Y (avec T5) |
| T7  | Créer `src/pages/blog/index.astro` : BlogList statique depuis Content Collections + islands BlogSearch + BlogPagination + filtrage par catégorie (`client:load`, parity avec `BlogSidebar`, `BlogSearch`, `BlogPagination` actuels). Créer `src/pages/blog/[slug].astro` : `getStaticPaths()` depuis Content Collections, JSON-LD Article dans `<head>`, island ShareButtons (`client:visible`), `BlogPostDetail`. Supprimer `src/pages/Blog.tsx`, `src/pages/BlogPost.tsx`. | frontend-dev | `src/pages/blog/index.astro`, `src/pages/blog/[slug].astro`, `src/components/islands/BlogSearch.tsx`, `src/components/islands/BlogPagination.tsx`, `src/components/islands/ShareButtons.tsx`, `src/components/islands/BlogPostDetail.tsx` | T2, T3, T4 | Y (avec T5) |
| T8  | Créer `src/pages/accessibilite.astro` : port statique de `Accessibilite.tsx`, aucun island. Supprimer `src/pages/Accessibilite.tsx`. | frontend-dev | `src/pages/accessibilite.astro` | T2, T3 | Y (avec T5) |
| T9  | Créer les 4 pages services dédiées avec `ServiceLayout.astro` : `src/pages/services/therapie-individuelle.astro`, `therapie-de-couple.astro`, `therapie-familiale.astro`, `troubles-alimentaires.astro`. Structure : H1 ciblé, intro extractable (200 premiers mots = réponse directe), corps H2 structuré, section FAQ (≥ 4 questions), JSON-LD `FAQPage` + `Service` dans `<head>`, CTA vers `/contact`. | frontend-dev | `src/pages/services/*.astro` (4 fichiers) | T2, T3 | Y (avec T5) |
| T10 | Créer `src/pages/a-propos.astro` : formations TCCE, parcours professionnel, statut légal transparent (psychopraticienne non-réglementée), photo professionnelle. JSON-LD `Person` enrichi avec `hasCredential`, `alumniOf`, `knowsAbout` dans `<head>`. | frontend-dev | `src/pages/a-propos.astro` | T2, T3 | Y (avec T5) |
| T11 | Créer `public/llms.txt` (pages listées, crawlers IA autorisés). Créer/mettre à jour `public/robots.txt` (Allow all, `Sitemap:` pointant vers sitemap.xml). Configurer `@astrojs/sitemap` dans `astro.config.mjs` pour exclure les sections-routes résiduelles. Mettre à jour la navigation principale : remplacer les liens `href="#services"` → `/services/therapie-individuelle`, etc. Mettre à jour `src/config/footer.config.ts` avec les nouvelles URLs. | frontend-dev | `public/llms.txt`, `public/robots.txt`, `astro.config.mjs`, `src/components/islands/Navbar.tsx`, `src/config/footer.config.ts` | T9, T10 | N |
| T12 | Rédiger le contenu long-form SEO (≥ 800 mots) pour chaque page service : symptômes/situations ciblées, déroulement des séances, tarifs, FAQ (≥ 4 Q&A géo-extractables), CTA. Format GEO : réponse directe dans les 200 premiers mots, structure Q&A, données locales Montpellier. | frontend-dev | `src/pages/services/*.astro` (contenu) | T9 | Y (avec T13) |
| T13 | Créer 3 nouveaux articles blog GEO dans Content Collections : `qu-est-ce-qu-un-psychopraticien.md`, `difference-psychologue-psychotherapeute-psychopraticien.md`, `remboursement-mutuelle-psychotherapie-montpellier.md`. Format : réponse directe 200 premiers mots, structure H2/Q&A, données Montpellier, 600-800 mots. | frontend-dev | `src/content/blog/*.md` (3 nouveaux fichiers) | T4 | Y (avec T12) |
| T14 | Quality gate : `npm run build` (0 erreurs), `npm run lint`, `npm run audit:a11y` (0 erreurs WCAG 2.1 AA sur toutes les pages du **preview Netlify**, pas la prod), `npm run audit:lighthouse` (SEO ≥ 95, Perf ≥ 90 sur preview URL). Valider `dist/sitemap.xml` (0 section-routes `/Tarifs`, `/Services`, etc.). Tester Rich Results Test sur Home + 1 service + 1 blog post. | tester | CI / audit scripts | T11, T12, T13 | N |

---

## Agent Slices

**devops :** T1

**frontend-dev :** T2, T3, T4, T4b, T5, T6, T7, T8, T9, T10, T11, T12, T13

**tester :** T14

---

## Séquence d'exécution

```
T1 (init Astro)
  ↓
T2 (layout + schema)    ←→   T4 (content collections)   [parallèle]
  ↓
T3 (navbar + footer + tailwind globs)
  ↓
T5 (Home)  T6 (Contact)  T7 (Blog)  T8 (Accessibilite)  T9 (Services)  T10 (A-propos)   [parallèle]
  ↓
T4b (cleanup TS blogs + redirects 301 + 404.astro)   ← dépend T7 validé
  ↓
T11 (SEO files + nav update)
  ↓
T12 (contenu services)  T13 (articles GEO)   [parallèle]
  ↓
T14 (quality gate — sur preview Netlify)
```

**Règle de parallélisme :** T5–T10 peuvent être déléguées à plusieurs instances `frontend-dev` simultanément après T3. T12 et T13 idem après T11.

---

## Worktree

```bash
git worktree add .claude/worktrees/12-astro-migration feat/12-astro-migration
cd .claude/worktrees/12-astro-migration
```

Branche : `feat/12-astro-migration` (depuis `main` post-PR#10)

---

## Quality Gate

```bash
npm run build        # 0 erreurs TypeScript + build Astro statique
npm run lint         # ESLint 0 erreurs
npm run audit:a11y   # pa11y WCAG 2.1 AA — 0 erreurs
npm run audit:lighthouse  # SEO ≥ 95, Perf ≥ 90
```

Validation manuelle :
- `cat dist/sitemap.xml | grep -E "/Tarifs|/Services|/About"` → 0 résultat
- Rich Results Test : `https://search.google.com/test/rich-results`

---

## Fichiers supprimés (nettoyage SPA)

| Fichier supprimé | Remplacé par |
|---|---|
| `src/App.tsx` | `astro.config.mjs` routing |
| `src/main.tsx` | `src/pages/*.astro` entry points |
| `src/pages/Home.tsx` | `src/pages/index.astro` |
| `src/pages/Contact.tsx` | `src/pages/contact.astro` |
| `src/pages/Blog.tsx` | `src/pages/blog/index.astro` |
| `src/pages/BlogPost.tsx` | `src/pages/blog/[slug].astro` |
| `src/pages/Accessibilite.tsx` | `src/pages/accessibilite.astro` |
| `src/pages/About.tsx` | Section dans `index.astro` |
| `src/pages/Services.tsx` | Section dans `index.astro` |
| `src/pages/Pricing.tsx` | Section dans `index.astro` |
| `src/pages/Process.tsx` | Section dans `index.astro` |
| `src/pages/Qualifications.tsx` | Section dans `index.astro` |
| `src/utils/blogs/*.ts` (9 fichiers) | `src/content/blog/*.md` |
| `src/utils/blog-list.ts` | Content Collections auto-discovery |
| `src/utils/blogApi.ts` | `Astro.glob()` + `getCollection()` |
| `src/components/SEO.tsx` | `<head>` natif dans `Layout.astro` |
| `src/components/StructuredData.tsx` | `<Fragment set:html>` dans Layout |
| `generate-sitemap.js` | `@astrojs/sitemap` |
