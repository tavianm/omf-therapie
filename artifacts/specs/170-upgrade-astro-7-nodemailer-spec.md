---
title: "chore(deps): upgrade astro 5→7 (amas CRITICAL npm audit) + nodemailer ^9.1.0"
description: "Spécification de l'upgrade coordonné astro 5→7 + Tailwind 4 : migrations préalables sous v5, bump versionnel, gates et vérifications binaires."
type: spec
status: approved
---

## Context

- Source : issue [#170](https://github.com/tavianm/omf-therapie/issues/170) — « `npm audit` sur main : 1 critical / 31 high / 25 moderate » à la création ; analyse du 2026-09-14 : 1 critical / 24 high / 19 moderate après les bumps #151/#152.
- Promu depuis : `artifacts/analyses/170-upgrade-astro-7-nodemailer-analysis.md` (approuvée, Shape 3 — astro 7 + Tailwind 4 coordonné) et `artifacts/frames/170-upgrade-astro-7-nodemailer-frame.md` (F-full).
- Décision de revue (2026-09-14) : l'out-of-scope « majors satellites » de la frame est levé — Tailwind 4 entre dans le périmètre.
- Nodemailer : déjà 9.1.1 au lockfile (bump #151), absent de l'audit HEAD → **verify-only** dans cette spec.

## Intent

Le site de production tourne sous astro 5.18 avec un amas de vulnérabilités npm audit dont les correctifs n'existent qu'en majeur 7 — la dette sécurité ne peut pas être soldée sans un upgrade coordonné (astro + adapter Netlify + intégrations). Le retrait forcé de `@astrojs/tailwind` (peers max astro ^5) rend la question du pipeline CSS inévitable : l'analyse a validé que basculer directement sur Tailwind 4 coûte ~une demi-journée de plus que reconstruire un état transitoire TW3-PostCSS destiné à être remplacé. Aucune fonctionnalité métier n'est touchée : c'est une PR de plateforme.

## Goal

`main` (puis la prod) compile et se déploie sous astro ^7.3.2 + Tailwind ^4.3 avec `npm audit` sans critical/high sur le cluster astro, un rendu et des URLs inchangés, et tous les gates CI au vert.

## Users

- **Primaire :** la mainteneuse — dépendances supportées, audit propre, pipeline de build moderne, rollback simple.
- **Secondaire :** visiteuses et patientes — zéro changement perceptible attendu (rendu, parcours RDV, blog, a11y).

## Expected Behavior

Après la PR : `npm install && npm run build` produit un site astro 7 identique visuellement à l'actuel (mêmes URLs, mêmes styles rendus, a11y inchangée). Le blog passe par le content layer (glob loader) avec les URLs `/blog/<filename>/` préservées ; les posts gardent leur identifiant métier sous `data.postId`. Le CSS compile via `@tailwindcss/vite` (config CSS-first dans `src/index.css`) ; `postcss.config.js`, `tailwind.config.js`, `autoprefixer` et `cssnano` sont supprimés. `compressHTML: true` est épinglé explicitement. Les pins Node (`.nvmrc`, `netlify.toml`, CI) sont alignés sur une même version ≥22.12.0. Le parcours de réservation SSR reste fonctionnel (smoke sur deploy preview). En interne, les incréments V1–V2 sont réalisés **sous astro 5** (compatibles v5) afin que le bump V3 ne porte que la casse de version — chaque incrément laisse l'arbre vert et reste isolément revertable.

## Data Model & Consumers

**Collection blog (`src/content.config.ts`)** — migration legacy → content layer :
- `loader: glob({ pattern: '**/*.md', base: './src/content/blog' })` ; `type: 'content'` supprimé.
- `entry.id` (généré) = nom de fichier sans extension = ancien slug → URLs préservées.
- Champ frontmatter `id` (identifiant métier numérique, présent dans les 12 posts) **renommé `postId`** : `id` est une clé réservée du content layer (`entry.id`). Consommateurs : schéma zod (source `astro/zod`), les 12 fichiers markdown, `src/utils/blogAdapter.ts` (`entry.data.id` → `entry.data.postId`), type `BlogPost` (`src/types/blog.ts`).

| Consommateur | Champ | Usage | Statut |
|---|---|---|---|
| `src/utils/blogAdapter.ts` | `entry.id`, `entry.data.postId` | `slug` (URLs), identifiant métier | cette PR |
| `src/pages/blog/[slug].astro` | `entry`, `render(entry)` | getStaticPaths, rendu, canonical, JSON-LD | cette PR |
| `src/pages/blog/index.astro` | `getCollection('blog')` | listes, champs data | inchangé (vérif) |
| JSON-LD / sitemap | slugs dérivés de `entry.id` | SEO | inchangé (gate diff) |

## Breadboard

Pas de nouvelle affordance UI/API — table de câblage plateforme :

| Surface | Changement | Vérification |
|---|---|---|
| `package.json` / lockfile | astro ^7.3.2, @astrojs/react ^6.0.5, @astrojs/netlify ^8.2.5, @astrojs/sitemap ^3.7.4 (refresh), retrait @astrojs/tailwind + autoprefixer + cssnano, tailwindcss ^4.3.3 + @tailwindcss/vite ^4.3.3, nodemailer 9.1.x (inchangé) | `npm ls` cohérent, lockfile régénéré |
| `astro.config.mjs` | retrait intégration tailwind, `compressHTML: true`, `vite.plugins: [tailwindcss()]`, reste inchangé | build + config review |
| `src/content.config.ts` + 12 posts + blogAdapter | glob loader, `z` depuis `astro/zod`, `id`→`postId` | blog rendu + grep résidus |
| `src/index.css` + ~15 fichiers de classes | `@import "tailwindcss"`, `@theme`, `@plugin` typography ; renames `shadow`/`rounded` (~94 sites, codemod) | diff HTML rendu + audit:a11y |
| `tailwind.config.js`, `postcss.config.js` | supprimés | `ls` + build |
| `.nvmrc` / `netlify.toml` / `ci.yml` | `.nvmrc` exacte ≥22.12.0 (source unique), `NODE_VERSION` retiré de netlify.toml, `node-version-file: .nvmrc` en CI ; étape audit CI | grep + run CI |
| `@astrojs/check` (devDep) | bump/vérif compat avec astro 7 pour `astro check` (gate bloquant) | `npm ls @astrojs/check` + run typecheck |
| `src/pages/api/**` (prerender=false) | aucun changement attendu | smoke SSR preview |

## Slices

| # | Slice | Contenu | Démo (vérification isolée) |
|---|---|---|---|
| V1 | Content layer sous astro 5 | glob loader (l'API content layer existe déjà en v5) + renommage `postId` + blogAdapter + `[slug].astro` (`render(entry)`) ; l'import `z` reste sur la forme v5 (le switch vers `astro/zod` suit le bump en V3) | blog rendu sous v5, URLs identiques (diff sitemap local) |
| V2 | Tailwind 4 sous astro 5 | `@tailwindcss/vite` 4.3.3 (**peers vérifiés : `vite ^5.2||^6||^7||^8`** — compatible le Vite 6 d'astro 5.18), `index.css` CSS-first, suppression postcss/tailwind configs + autoprefixer/cssnano, codemod renames ; capture de la baseline `audit:a11y` v5 | pages clés : diff HTML vs référence v5-TW3 = 1:1 ; baseline a11y archivée |
| V3 | Bump astro 5→7 | bumps astro/@astrojs/react/@astrojs/netlify/sitemap (+ @astrojs/check si besoin), `compressHTML: true`, import `z` → `astro/zod`, pin `.nvmrc` + retrait `NODE_VERSION` + `node-version-file` CI, correctifs compilateur Rust éventuels | build vert v7, diff sitemap = 0, chunk sentry émis |
| V4 | Gates + audit | test:low, lint, typecheck, build, audit:a11y complets ; re-audit npm audit ; smoke SSR deploy preview ; étape audit CI ; relecture diff codemod | tous les critères ci-dessous cochés |

## Success Criteria

- [ ] `npm run build` sort 0 sous astro ^7.3.2 + @astrojs/netlify ^8 + @astrojs/react ^6 (compilateur Rust : aucune balise non fermée résiduelle).
- [ ] Garde anti-amas (toute la surface prod) : `npm audit --omit=dev --audit-level=high` sort 0 — portée **globale prod** (astro, @astrojs/*, @netlify/*, nodemailer inclus, mais aussi ws/pg/supabase transitifs) ; les moderates hors périmètre (ex. undici dev-transitif) n'échouent pas le gate.

  ```yaml
  priced:  "aucune vulnérabilité connue critical/high dans les dépendances de production"
  not:     "code de sortie global de npm audit à 0 (les moderates prod peuvent subsister sans faire échouer le gate à --audit-level=high)"
  oracles: ["astro@5.18.2 dans l'arbre → le gate échoue", "nodemailer@9.0.3 dans l'arbre → le gate échoue", "un high uniquement atteint via devDependencies → le gate passe"]
  ```
  Placement : étape bloquante dans le job `build` de `ci.yml`, juste après `npm ci` (échec rapide, ~5 s, lockfile only).

- [ ] Diff sitemap entre le build de référence v5 et le build v7 : **zéro différence d'URL** (préservation `/blog/<filename>/`).
- [ ] Plus aucun résidu legacy : `grep -rn "type: 'content'\|entry.data.id\b\|entry.render()" src/` retourne 0 ligne ; `zod` importé depuis `astro/zod` dans `src/content.config.ts`.
- [ ] Le variant `prose-sage` rend le blog avec les mêmes couleurs (`--tw-prose-*` re-déclarés sous `.prose-sage` dans `src/index.css`).
- [ ] Garde packaging SSR : sur le deploy preview Netlify de la PR, après **vérification d'environnement préalable** (le preview doit tourner sur clés de test/mock : `STRIPE_SECRET_KEY=sk_test_*`, calendrier mock ou agenda de test, SMTP Mailpit — jamais les vars prod), `GET /api/availability/` répond 200 et le POST de réservation confirme un RDV — le node-file-trace Rolldown inclut `nodemailer`/`googleapis` (externals SSR). **Propriétaire : l'autrice de la PR**, avant demande de review ; les sorties curl + le dump des vars d'env pertinentes (noms/seuils, pas les secrets) sont consignés dans la description de la PR.

  ```yaml
  priced:  "les routes SSR restent exécutables côté serveur après l'upgrade (prerender=false honoré, externals tracés), sur un environnement non-productif"
  not:     "build exit 0 (le build CI n'exerce jamais le packaging des fonctions Netlify)"
  oracles: ["fonction Netlify levant 'Cannot find module nodemailer' au cold start → échec", "route API prérendue en statique sous output:'static' → échec", "preview branché sur les vars prod (clé Stripe live, agenda réel) → le smoke ne doit PAS être exécuté tant que l'env n'est pas corrigée"]
  ```

- [ ] `npm run test:low`, `npm run lint`, `npm run typecheck` (bloquant) sortent 0.
- [ ] `npm run audit:a11y` : la baseline pré-upgrade est **capturée dans la PR** (run sur la référence v5 avant les bumps, sortie archivée), puis le run v7+TW4 présente le même ensemble de pages en succès/échec (0 nouvelle violation WCAG AA).
- [ ] **Diff HTML rendu scripté, tout le sitemap** : un script compare le HTML rendu du build de référence v5 et du build v7+TW4 pour chaque URL du sitemap (y compris les **12 posts**, exposés au changement de processeur markdown) ; les seules différences tolérées sont une allowlist mécanique de tokens internes astro (hashes de scripts, attributs d'assets) — toute autre diff (classe manquante/span déplacé, renames `shadow`/`rounded` non reflétés, espaces inter inline) fait échouer le critère. `/mes-rdvs/` est exclu du diff (état prérendu déconnecté non représentatif) mais reste couvert par l'audit:a11y et le smoke.
- [ ] Le chunk `sentry` est émis au build (grep `dist/`) — sinon fallback `output.advancedChunks` appliqué et documenté dans la PR.
- [ ] `astro.config.mjs` contient `compressHTML: true` explicite — la propriété réelle (espaces inter inline préservés) est arbitrée par le diff HTML sitemap-wide ci-dessus, pas par le grep.
- [ ] Pin Node en **source unique** : `.nvmrc` contient une version exacte ≥22.12.0 ; `NODE_VERSION` est **retiré** de `netlify.toml` (Netlify résout `.nvmrc` nativement) ; `ci.yml` utilise `node-version-file: .nvmrc` — les trois environnements résolvent la même version.
- [ ] CI contient une étape étroite `npm audit --omit=dev --audit-level=high` (bloquante) — anti re-formation de l'amas.
- [ ] `tailwindcss@^4`, `@tailwindcss/vite@^4` présents ; `@astrojs/tailwind`, `autoprefixer`, `cssnano`, `postcss.config.js`, `tailwind.config.js` absents de l'arbre.
- [ ] `npm ls nodemailer` → 9.1.x unique (verify-only, aucun changement de code dans `src/lib/resend.ts`).

## Rollback

Ordre de précédence : **`git revert` de la PR d'abord** (vérité trunk, propre tant qu'aucun commit `package.json`/lockfile ne suit) ; rollback Netlify atomique en mitigation immédiate (statique + fonctions ensemble), annulé par le prochain build. Les incréments V1–V2 (compatibles v5) restent revertables isolément ; seul V3 change le runtime.

## Notes de revue (pliage des experts)

- **Typecheck bloquant — ne pas revenir en advisory** : `ci.yml` à HEAD exécute 4 jobs bloquants depuis #86 ; AGENTS.md est en drift sur ce point. Toute « correction » vers `continue-on-error` pendant l'implémentation est une régression.
- **e2e** : vérifié — aucun sélecteur `rounded`/`shadow` dans `e2e/` ; les renames de classes ne cassent pas les specs Playwright existantes.
- **V2 peers** : `@tailwindcss/vite@4.3.3` déclare `vite: ^5.2.0 || ^6 || ^7 || ^8` (npm, vérifié) — le slicing V2 sous astro 5 est factuel, pas supposé ; repli si régression imprévue : fusionner V2 dans V3.
- **`/mes-rdvs/`** exclu du diff HTML (prerender déconnecté non représentatif) — couverture conservée via audit:a11y + smoke SSR.

## χ

Aucun — les inconnues de l'analyse (Rolldown/manualChunks, Sätteri/GFM, compat `@tailwindcss/vite`×vite 8) sont portées par les critères binaires ci-dessus et leur repli documenté (fallback `advancedChunks`, fallback `markdown.processor: unified()`, repli Shape 1 TW3-PostCSS).
