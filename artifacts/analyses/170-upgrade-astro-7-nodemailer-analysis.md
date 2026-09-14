---
title: "chore(deps): upgrade astro 5→7 (amas CRITICAL npm audit) + nodemailer ^9.1.0"
description: "Analyse de l'upgrade coordonné astro 5→7 : breaking changes v6/v7 audités contre le repo, migrations requises, stratégies et gates."
type: analysis
status: approved
---

## Source

> Issue #170 — « `npm audit` sur main : 1 critical / 31 high / 25 moderate. astro ^5.18.1 — amas CRITICAL (XSS define:vars, Host-header SSRF sur error-pages prérendues, AVIF RCE build-time). Fix = majeur 5→7 (astro 7.3.2), donc upgrade coordonné : astro + @astrojs/react + @astrojs/netlify + @astrojs/sitemap/tailwind. nodemailer ^9.0.3 — HIGH ; fix non-breaking ^9.1.0. @netlify/blobs 10.7.9 — HIGH, fixé via l'upgrade @astrojs/netlify. Action : PR dédiée d'upgrade coordonné avec gates complets (test:low, lint, typecheck, build, audit:a11y) + re-audit. »

## Problem

Le site tourne sous astro 5.18 avec un amas de vulnérabilités npm audit (1 critical / 24 high / 19 moderate / 4 low à la date de l'analyse — l'issue citait 31 high / 25 moderate à sa création ; les bumps #151/#152 ont déjà réduit l'amas) centré sur le cœur astro et l'adapter Netlify. Les correctifs astro n'existent qu'en **majeur 7** — l'upgrade traverse donc deux majeurs (5→6→7) avec un set d'intégrations à coordonner. Point dur découvert à l'analyse : **`@astrojs/tailwind@6.0.2` (dernière version) déclare `astro: ^3||^4||^5`** — l'intégration est incompatible avec astro 7 et doit sortir du set. **Nodemailer est déjà résolu à HEAD** : le lockfile est passé à 9.1.1 (bump #151) et `npm audit` ne le cite plus — la moitié nodemailer de l'issue est un verify-only, pas une migration.

## Outcome

`main` et la prod tournent sous astro 7.x ; `npm audit` ne remonte plus aucun critical/high sur le cluster astro/@astrojs/@netlify/blobs/nodemailer ; tous les gates passent (`test:low`, `lint`, `typecheck` advisory, `build`, `audit:a11y`) ; le site rendu est visuellement identique (booking, blog, emails de dev) et les URLs du blog sont préservées.

## Appetite

1 PR dédiée + un cycle complet de gates (~1–2 jours). Pas de découpage en plusieurs PR sauf décision contraire.

## État des lieux — breaking changes v6/v7 audités contre le repo

### Astro 6 (Node 22, Vite 7, content layer obligatoire)

| Breaking change v6 | Impact repo | Action |
|---|---|---|
| Node 18/20 abandonné, ≥22.12 requis | local v24.12, CI `node-version: 22`, Netlify `NODE_VERSION=22` | aucun (résolu) |
| **Legacy content collections supprimées** (`type: 'content'` sans loader, « no backwards compatibility ») | `src/content.config.ts` déclare `type: 'content'` | **migrer vers glob loader** |
| `z` déprécié depuis `astro:content` ; Zod 4 embarqué | `import { defineCollection, z } from 'astro:content'` | importer `z` depuis `astro/zod` ; schéma compatible Zod 4 (pas de `.email()`, `.default(false)` type-conforme) |
| `Astro.glob()` supprimé | non utilisé | aucun |
| Endpoints avec extension + trailing slash interdits | aucun endpoint `.xml.*` ; sitemap généré par l'intégration | aucun |
| `import.meta.env` toujours inliné (plus de substitution `process.env`) | `process.env` utilisé uniquement dans `src/lib/*` server-side (runtime SSR) | aucun |
| Ordre `<script>`/`<style>` = ordre de définition (fin de l'ordre inversé) | plusieurs scripts par page possibles | gate visuel/CI |
| Markdown : IDs d'ancre avec tirets finaux conservés | ancres internes rares dans les posts | gate visuel blog |

### Astro 7 (compilateur Rust, Vite 8/Rolldown, markdown Sätteri)

| Breaking change v7 | Impact repo | Action |
|---|---|---|
| `compressHTML` : `true` → `'jsx'` (peut supprimer des espaces entre éléments inline) | prose française sur tout le site | **forcer `compressHTML: true`** dans la config pour conserver le comportement actuel |
| Compilateur Rust : plus de correction silencieuse du HTML (balises non fermées = erreur) | ~50 fichiers `.astro` | gate `build` — corriger les balises signalées le cas échéant |
| Markdown : Sätteri remplace remark/rehype par défaut ; `@astrojs/markdown-remark` n'est plus installé par défaut | blog markdown, possibles tableaux GFM | gate visuel blog ; fallback : installer `@astrojs/markdown-remark` + `markdown: { processor: unified() }` |
| `src/fetch.ts` réservé (advanced routing) | fichier absent | aucun |
| `@astrojs/db` supprimé ; internals `astro:transitions` supprimés ; `getContainerRenderer()` déprécié | non utilisés | aucun |
| Vite 8 (Rolldown) ; `manualChunks`/`ssr.external`/`optimizeDeps` non couverts par le guide v7 | `manualChunks` function-form (split `@sentry/browser`), `ssr.external: [nodemailer, googleapis]`, `optimizeDeps.include` | gate build : vérifier l'émission du chunk `sentry` ; fallback `output.advancedChunks` ; χ Rolldown |
| Engines astro 7 : `node >=22.12.0`, `npm >=9.6.5` | local node 24.12/npm 11.6 ; CI et Netlify sur « 22 » (latest 22.x ≥ 22.12) | aucun |

## Cibles de dépendances (npm, vérifié à la date de l'analyse)

| Package | Actuel | Cible | Notes |
|---|---|---|---|
| `astro` | ^5.18.1 (5.18.2) | **^7.3.2** | engines node ≥22.12 ✓ |
| `@astrojs/react` | ^5.0.4 (5.0.7) | **^6.0.5** | peers react ^17\|\|^18\|\|^19 → **React 18 conservé**, pas de major satellite |
| `@astrojs/netlify` | ^6.6.5 (6.6.5) | **^8.2.5** | peers `astro ^7` ; embarque `@netlify/blobs ^10.7.4` (dép directe repo : 10.7.13 ✓) — HIGH blobs fixé |
| `@astrojs/sitemap` | ^3.7.4 (3.7.3) | ^3.7.4 (refresh lockfile) | pas de major |
| `@astrojs/tailwind` | ^6.0.2 | **RETIRÉ** | peers max `astro ^5` ; remplacé par `@tailwindcss/vite` ^4.3.3 (Shape 3, recommandé) ou par le pipeline PostCSS existant (Shape 1, repli) |
| `tailwindcss` | ^3.4.17 | **^4.3.3** (Shape 3) / inchangé (Shape 1) | v4 : config CSS-first `@theme`, renames mécaniques ~94 classes, `postcss.config.js` supprimé, `@tailwindcss/typography` 0.5.20 compatible |
| `autoprefixer` / `cssnano` | ^10.5.6 / ^6.1.2 | **RETIRÉS** (Shape 3) | préfixes Lightning CSS + minification Vite en v4 — chaîne PostCSS supprimée |
| react / react-dom | 18.3.1 | **inchangés** | peer-compatible avec @astrojs/react 6 ; pas de major satellite |
| `nodemailer` | ^9.1.1 (**9.1.1 au lockfile**) | inchangé — verify-only | HIGH IDN/addressparser déjà corrigé par le bump #151 ; `npm audit` ne le cite plus à HEAD |
| `@types/nodemailer` | ^8.0.1 | **inchangé (^8.0.1)** | pas de v9 publiée à ce jour ; le code documente déjà la rupture d'export par défaut |
| `react / react-dom / vite` | 18.3.1 / (vite transitif) | **inchangés** | majors satellites hors périmètre |

`@astrojs/partytown` ^2.1.7 est dans `package.json` mais n'est chargé ni dans `astro.config.mjs` ni utilisé dans `src/` — dépendance morte ; retrait possible dans la même PR (une ligne, zéro impact runtime) ou dans un passage de nettoyage séparé.

## Migrations de code requises

1. **`src/content.config.ts`** — collection blog : `loader: glob({ pattern: '**/*.md', base: './src/content/blog' })`, suppression de `type: 'content'`, `z` importé depuis `astro/zod`. **Champ frontmatter `id` en conflit** : les 12 posts portent un `id: "2"`… `"12"` requis par le schéma actuel, mais `id` est la clé générée par le content layer (`entry.id` = nom de fichier) — le renommer (ex. `postId`) dans le schéma, les 12 posts et `src/utils/blogAdapter.ts` (`entry.data.id` → `entry.data.postId`) est le chemin le plus sûr. URLs préservées : pas de frontmatter `slug`, dossier plat de 12 fichiers ASCII-kebab → slug legacy = `id` du glob loader (l'adaptateur `entry.id.replace(/\.md$/, '')` devient un no-op inoffensif) → `/blog/<filename>/` inchangé. Vérifier au build par diff du sitemap avant/après.
2. **`src/pages/blog/[slug].astro`** — `entry.render()` → `render(entry)` importé de `astro:content`. Les `post.slug` (liens « articles liés », canonical, JSON-LD) transitent déjà par `src/utils/blogAdapter.ts` : aucune édition nécessaire si l'adaptateur est conservé tel quel.
3. **`astro.config.mjs`** — retirer l'intégration tailwind (import + entrée) ; ajouter `compressHTML: true` explicite ; (Shape 3) brancher `@tailwindcss/vite` dans `vite.plugins` ; le reste (site, trailingSlash, output static + adapter, vite optimizeDeps/ssr.external/manualChunks) inchangé.
4. **CSS (Shape 3 — recommandé)** — `src/index.css` : `@import "tailwindcss";` + `@plugin "@tailwindcss/typography";` + `@theme` (palettes sage/mint, fonts Inter/Cormorant) ; les blocs `@layer base/components` existants sont conservés tels quels ; les variables `--tw-prose-*` du variant `prose-sage` réécrites en CSS sous `.prose-sage`. `tailwind.config.js` et `postcss.config.js` **supprimés** (auto-détection du contenu, préfixes Lightning CSS, minification Vite). Renames de classes (~94 occurrences : `shadow-sm`→`shadow-xs`, `shadow`→`shadow-sm`, `rounded`→`rounded-sm`) via le codemod `@tailwindcss/upgrade` puis revue manuelle du diff.
   **Variante conservatrice (Shape 1, repli)** — `src/index.css`, `postcss.config.js`, `tailwind.config.js` inchangés : Tailwind 3 continue via PostCSS (`applyBaseStyles: false` était déjà posé, le plugin typography charge depuis `tailwind.config.js` — retrait de l'intégration behavior-preserving).
5. **Fallback markdown** — opérationnalisé : lister avant l'upgrade les posts contenant des tableaux/syntaxe GFM (grep `^\|` sur `src/content/blog/`), générer le HTML rendu v5 de référence, puis diff après upgrade. Si diff non cosmétique → installer `@astrojs/markdown-remark` + `markdown: { processor: unified() }` (comportement v6 exact). Décision binaire, pas au cas par cas.
6. **Durcissement Node (ops)** — astro 7 exige `node >=22.12.0` et npm n'applique pas `engines` : pinner une version explicite ≥22.12 dans `.nvmrc` et `netlify.toml` (`NODE_VERSION`), et faire pointer CI sur `node-version-file: .nvmrc` (dé-duplique le triple « 22 » flottant) — ou ajouter `engine-strict=true` en `.npmrc`.
7. **`typecheck` est bloquant** — `ci.yml` exécute 4 jobs bloquants (lint, test, build, typecheck ; #86 a purgé les erreurs résiduelles — AGENTS.md est en drift sur ce point). Le drift de types astro 7 / @astrojs/react 6 / @types/nodemailer@8 doit donc passer un gate bloquant, pas advisory.

## Shapes

> Décision de revue (2026-09-14) : l'utilisatrice lève l'out-of-scope « majors satellites » de la frame — Tailwind 4 entre dans le périmètre et la Shape 3 est re-chiffrée sur mesure réelle au lieu d'être rejetée a priori.

### Shape 1 — Big-bang coordonné vers astro 7 (1 PR, Tailwind 3 conservé)

Un seul set de changements : bump des 4 packages + retrait `@astrojs/tailwind` + migrations content-layer/blog + `compressHTML: true` + refresh lockfile (nodemailer inclus), gates complets, re-audit.

**Trade-offs:**
- Pro : conforme à l'issue (« PR dédiée d'upgrade coordonné ») ; une seule revue, un seul déploiement, re-audit validé une fois ; le volume de migrations (content layer, tailwind, config) est identique quel que soit le découpage.
- Con : diff large (~6 fichiers code + lockfile) ; bisect plus pénible si une régression n'apparaît qu'en prod.

**Rough scope:** M

### Shape 2 — Étagé : astro 6 d'abord (PR 1), puis astro 7 (PR 2)

Deux cycles complets de gates et de déploiement.

**Trade-offs:**
- Pro : bisect plus fin entre « ce que v6 casse » et « ce que v7 casse ».
- Con : double revue/déploiement/gates pour un gain faible — les migrations structurantes (content layer obligatoire dès v6, retrait tailwind, config) sont **identiques** aux deux étapes ; l'étape v6 seule ne corrige l'audit que partiellement (surface critique toujours exposée entre les deux déploiements).

**Rough scope:** L (coût process ; risque code identique)

### Shape 3 — astro 7 + Tailwind 4 coordonné (`@tailwindcss/vite`)

Le retrait forcé de `@astrojs/tailwind` ouvre la question du remplacement : au lieu de reconstruire un état transitoire Tailwind 3 (PostCSS), basculer directement sur **Tailwind 4.3.3** via le plugin Vite officiel. Empreinte mesurée dans ce repo :

- Renames mécaniques limités : `shadow-sm` ×53 + bare `shadow` ×1 (→ `shadow-xs`/`shadow-sm`), bare `rounded` ×40 (→ `rounded-sm`), `rounded-sm` ×0 ; `*-opacity-*`, `gradient-to-*` et bare `ring` ×0 ; les 133 `ring-2` portent tous une couleur explicite → le changement de couleur par défaut du ring en v4 est neutralisé ; `space-x/y` ×116 passent sans édition (sélecteur v4 visuellement équivalent).
- **Aucun bloc `<style>`** dans les composants `.astro` et aucun `@apply` hors `src/index.css` → pas de `@reference` à traiter.
- Thème : 2 palettes (sage/mint) + 2 fonts + variant `prose-sage` → bloc `@theme` CSS + `@plugin "@tailwindcss/typography"` (0.5.20, compatible v4) ; `content: [...]` devient auto-détection.
- `postcss.config.js` (tailwindcss + autoprefixer + cssnano) **supprimé** : v4 gère les préfixes (Lightning CSS) et la minification passe par Vite — simplification nette de la chaîne.
- Codemod officiel `@tailwindcss/upgrade` pour config + renames, diff relu à la main (~94 sites de classes).

**Trade-offs:**
- Pro : un seul cycle de revue/déploiement/re-audit pour les **deux** migrations dont une est de toute façon forcée (astro 7 + retrait intégration) ; supprime l'état transitoire TW3-PostCSS qui serait créé puis détruit peu après ; élimine autoprefixer/cssnano ; Tailwind 3 est en fin de vie en 2026.
- Con : rayon de test élargi aux classes utilitaires (audit:a11y complet + diff HTML rendu sur pages clés) ; le bisect astro-vs-tailwind est perdu à l'intérieur du PR — mitigé par le rollback unitaire (revert git + rollback Netlify atomique) et le diff HTML de référence v5.
- χ compat : `@tailwindcss/vite` 4.3.3 sous Vite 8/Rolldown (astro 7) — stack dominante en 2026, support attendu, à confirmer au premier build.

**Rough scope:** M+ (surcoût vs Shape 1 ≈ une demi-journée : codemod + revue diff + gates visuels)

## Fit Check

**Shape 3** est retenue : le retrait de `@astrojs/tailwind` rend la question du pipeline CSS inévitable, et l'empreinte v4 mesurée est petite (renames mécaniques ~94 sites, zéro `<style>` block, thème réduit, tous les `ring-2` colorés explicitement). Faire astro 7 seul (Shape 1) reconstruirait un état transitoire TW3-PostCSS pour le remplacer peu après — deux cycles de gates pour le même résultat final. Shape 2 (étagé 6→7) reste éliminée par le rapport coût process / réduction de risque : migrations identiques aux deux étapes et fenêtre d'exposition intermédiaire.

**Repli** : si `@tailwindcss/vite` 4.3.3 se révèle incompatible avec Vite 8/Rolldown au premier build (χ), retomber sur Shape 1 (TW3 via PostCSS) et traiter TW4 dans un chantier séparé — le reste du travail est strictement identique.

## Files impacted

| Fichier | Changement |
|---|---|
| `package.json` | bumps astro/@astrojs/react/@astrojs/netlify ; retrait `@astrojs/tailwind` (+ `@astrojs/partytown` si mort confirmée) ; `@types/nodemailer` aligné |
| `package-lock.json` | régénéré (nodemailer 9.1.1, @netlify/blobs ≥ fix, vite 8 transitif) |
| `astro.config.mjs` | retrait intégration tailwind ; `compressHTML: true` |
| `src/content.config.ts` | glob loader + `z` depuis `astro/zod` |
| `src/pages/blog/[slug].astro` | `render(entry)`, `post.id` (URLs inchangées) |
| `src/pages/blog/index.astro` | vérif `getCollection` (champs data seulement — a priori inchangé) |
| `src/index.css` | (Shape 3) `@import "tailwindcss"` + `@theme` + `@plugin` typography ; `@layer` conservés |
| `tailwind.config.js`, `postcss.config.js` | (Shape 3) supprimés |
| ~15 fichiers de classes (`src/pages/**`, `src/components/**`) | (Shape 3) renames `shadow`/`rounded` (~94 occurrences, codemod + revue) |
| `.nvmrc` / `netlify.toml` | pin explicite ≥22.12 (migration #6) |

## Risques & gates

- **Rendu blog** (Sätteri + compilateur Rust) : revue visuelle des posts + `audit:a11y` ; fallback markdown-remark déclenché par le diff HTML binarisé (migration #5).
- **Packaging Netlify sous Rolldown** : le `build` CI n'exerce jamais le packaging des fonctions — le node-file-trace du bundle SSR (`ssr.external: [nodemailer, googleapis]`) est le chemin fragile ; un trace manquant ne se révèle qu'en « Cannot find module » sur la fonction déployée. Gate requis : **smoke SSR sur le deploy preview Netlify avant merge** (au minimum `GET /api/availability/` + le POST de réservation), previews déjà alignés sur l'env de staging.
- **Prerender exceptions** : les `export const prerender = false` de `src/pages/api/**` (vérifiés présents) doivent rester honorés sous `output: 'static'` + adapter v8 en v7 — vérifié au smoke du deploy preview.
- **Chunk sentry sous Rolldown** : vérifier l'émission au build ; fallback `advancedChunks`.
- **URLs blog** : diff sitemap build v5 vs v7 (attendu : identique).
- **Audit résiduel** : `undici` moderate (fixable `npm audit fix`, hors cluster critique) — cible : 0 critical / 0 high sur le cluster astro ; recommandé en plus de l'issue : ajouter un gate CI étroit `npm audit --omit=dev --audit-level=high` pour empêcher la re-formation de l'amas (décision à la spec).
- **Renames Tailwind (Shape 3)** : diff HTML rendu des pages clés (accueil, rendez-vous, blog, mes-rdvs) entre un build v5 de référence et le build v7+TW4 — les renames codemod (`shadow`/`rounded`) doivent se refléter 1:1 ; `audit:a11y` complet sur le site v7+TW4. Les defaults v4 à risque sont déjà neutralisés par l'empreinte mesurée (ring colorés explicitement, zéro `*-opacity`/gradient).
- **Compat `@tailwindcss/vite` × Vite 8/Rolldown** : premier build décisif — si échec, repli Shape 1 documenté au Fit Check.
- **Espaces inter inline** : `compressHTML: true` neutralise le changement de default ; gate visuel global (audit:a11y + smoke des pages clés : accueil, rendez-vous, blog, mes-rdvs).

## Rollback

Aucune migration DB dans le périmètre → `git revert` restaure proprement le lockfile astro 5. Le rollback Netlify est atomique (statique + fonctions ensemble) pour une mitigation prod immédiate ; le deploy preview sert de kill switch pré-merge. La fenêtre de risque est concentrée sur le packaging SSR (gate ci-dessus).
