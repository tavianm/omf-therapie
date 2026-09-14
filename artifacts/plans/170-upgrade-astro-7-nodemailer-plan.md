---
title: "Plan: chore(deps): upgrade astro 5→7 (amas CRITICAL npm audit) + nodemailer ^9.1.0"
issue: 170
spec: artifacts/specs/170-upgrade-astro-7-nodemailer-spec.md
complexity: 7/10
tier: F-full
generated: 2026-09-14
---

## Summary

Upgrade coordonné astro 5→7 + Tailwind 4 en une PR découpée en incréments verts : V1 content layer sous v5, V2 Tailwind 4 sous v5, V3 bump versionnel, V4 gates/audit. Chaque vague laisse l'arbre buildable et revertable isolément ; un baseline v5 (sitemap + HTML + a11y) capturé en T1 arbitre toutes les vérifications de non-régression.

## Architecture

**Data flow (build) :** `astro.config.mjs` (intégrations + `vite.plugins: [tailwindcss()]` + `compressHTML: true`) → Vite 8/Rolldown compile `.astro` + CSS (`src/index.css` → `@tailwindcss/vite` → feuille unique) → `@astrojs/netlify@8` émet pages statiques + fonctions SSR (`export const prerender = false` de `src/pages/api/**`) → `dist/`.

**Data flow (contenu) :** `src/content/blog/*.md` → `glob()` loader (`src/content.config.ts`, schéma zod `postId`) → `getCollection('blog')` → `src/utils/blogAdapter.ts` (`slug = entry.id`, `id = data.postId`) → `src/pages/blog/[slug].astro` (`render(entry)`, getStaticPaths sur `entry.id`) → HTML `/blog/<filename>/`.

**File × Function map :**

| Fichier | Fonction | Consommateurs |
|---|---|---|
| `src/content.config.ts` | `collections.blog` (glob loader + schema) | pages blog, adapter |
| `src/utils/blogAdapter.ts` | `collectionEntryToBlogPost()` | `[slug].astro`, `index.astro`, `BlogList.tsx` |
| `src/pages/blog/[slug].astro` | `getStaticPaths`, `render(entry)` | routes `/blog/<slug>/` |
| `src/index.css` | entry CSS : `@import "tailwindcss"`, `@theme`, `@plugin`, `.prose-sage` | tous les layouts |
| `astro.config.mjs` | `defineConfig` — intégrations + vite | build |
| `package.json` / lockfile | deps + scripts | npm ci (CI, Netlify) |
| `.nvmrc` / `netlify.toml` / `ci.yml` | runtime Node + gates | CI, Netlify |
| `scripts/diff-html-170.mjs` (T12, retiré avant merge ou conservé sous `scripts/`) | diff HTML sitemap-wide | gates V4 |

## Bootstrap Context

- Nodemailer déjà 9.1.1 au lockfile (bump #151) — **aucun changement** `src/lib/resend.ts` (verify-only).
- `@astrojs/tailwind@6.0.2` peers max astro ^5 → retrait forcé ; `@tailwindcss/vite@4.3.3` peers `vite ^5.2||^6||^7||^8` (vérifié) → V2 sous astro 5 valide.
- `postcss.config.js` (tailwindcss+autoprefixer+cssnano) devient inutile avec le plugin Vite v4 — suppression.
- Empreinte renames v4 : `shadow-sm`×53, bare `shadow`×1, bare `rounded`×40 ; `ring-2`×133 tous colorés explicitement ; zéro `*-opacity`/gradient/bloc `<style>`.
- `@astrojs/check` 0.9.10 : vérifier compat astro 7 au T8 (gate typecheck bloquant — ne PAS revenir en advisory, cf. spec Notes de revue).
- Baseline arbitre : T1 capture build v5-TW3 (sitemap, HTML des pages sitemap, sortie `audit:a11y`) sous `node_modules/.cache/170-baseline/` (jamais commitée).

## Agents

| Instance | Tâches | Fichiers | Sujet |
|---|---|---|---|
| R-tester-A | T1, T3, T7, T10 | baselines, scripts de diff | diff/baseline |
| R-frontend-dev-A | T2a, T2b, T2c | content.config, 12 posts, blogAdapter, [slug].astro | content |
| R-frontend-dev-B | T5, T6 | index.css, ~15 fichiers de classes | css |
| R-devops-A | T4, T8 | package.json, lockfile, astro.config.mjs | deps+build |
| R-devops-B | T9, T12 | .nvmrc, netlify.toml, ci.yml, scripts/ | runtime+tooling |
| R-tester-B | T11, T13, T14 | gates, audit, checklist smoke | gates |

## Micro-Tasks

### Slice V1 — Content layer sous astro 5

**T1 · R-tester-A · diff · phase GREEN · difficulté 2** — Capturer la baseline v5-TW3 : `npm run build` sur l'arbre intact ; copier `dist/sitemap*.xml` + le HTML rendu de chaque URL du sitemap + la sortie `npm run audit:a11y` (si dev server requis : servirc `dist/`) vers `node_modules/.cache/170-baseline/`.
Verify: `ls node_modules/.cache/170-baseline/ | wc -l` ≥ 3 ; `node_modules/.cache/170-baseline/audit-a11y.txt` ∃. Temps 8 min.

**T2a · R-frontend-dev-A · content · phase GREEN · difficulté 3** — `src/content.config.ts` : `import { glob } from 'astro/loaders'` ; `defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/blog' }), schema: z.object({ postId: z.string(), ... }) })` (frontmatter `id` renommé `postId` dans le schéma) ; `type: 'content'` supprimé ; `z` reste importé de `astro:content` (forme v5, le switch `astro/zod` arrive en T8).
```ts
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({ postId: z.string(), title: z.string(), /* ... inchangé */ }),
});
```
Verify: `grep -c "type: 'content'" src/content.config.ts` = 0 ; `npx astro build` exit 0. Temps 5 min.

**T2b · R-frontend-dev-A · content · phase GREEN · difficulté 1 · [P]¬ (dépend T2a pour le build, édition indépendante)** — Renommer `id:` → `postId:` dans les 12 frontmatters `src/content/blog/*.md` (sed sûr : première clé `id:` de chaque fichier).
Verify: `grep -rl "^id:" src/content/blog/ | wc -l` = 0 ; `grep -rl "^postId:" src/content/blog/ | wc -l` = 12. Temps 2 min.

**T2c · R-frontend-dev-A · content · phase GREEN · difficulté 3** — `src/utils/blogAdapter.ts` : `id: entry.data.postId` ; `src/pages/blog/[slug].astro` : `import { render } from 'astro:content'` + `const { Content } = await render(entry)` (remplace `entry.render()`) ; `getStaticPaths` inchangé (dérive déjà de `entry.id` via l'adapter).
Verify: `grep -rn "entry.render()\|entry.data.id\b" src/ | wc -l` = 0 ; `npm run build` exit 0. Temps 5 min.

**T3 · R-tester-A · diff · phase RED-GATE · difficulté 2** — Diff sitemap baseline vs arbre modifié (V1) : URLs `<loc>` strictement identiques.
Verify: `diff <(grep -o '<loc>[^<]*' baseline/sitemap.xml) <(grep -o '<loc>[^<]*' dist/sitemap*.xml)` vide. Temps 3 min.

### Slice V2 — Tailwind 4 sous astro 5

**T4 · R-devops-A · deps · phase GREEN · difficulté 2** — `npm install tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3` ; `npm uninstall @astrojs/tailwind` ; `astro.config.mjs` : retirer `import tailwind` + entrée `tailwind({...})`, ajouter `import tailwindcss from '@tailwindcss/vite'` + `vite: { plugins: [tailwindcss()], ... }` (fusionner avec le bloc vite existant).
Verify: `npm ls tailwindcss` → 4.x ; `grep -c "@astrojs/tailwind" astro.config.mjs package.json` = 0. Temps 5 min.

**T5 · R-frontend-dev-B · css · phase GREEN · difficulté 4** — `src/index.css` : remplacer les 3 directives `@tailwind` par `@import "tailwindcss";` + `@plugin "@tailwindcss/typography";` + bloc `@theme { --color-sage-50..900 ; --color-mint-50..900 ; --font-sans ; --font-serif }` (valeurs depuis `tailwind.config.js`) ; réécrire les `--tw-prose-*` du variant en CSS sous `.prose-sage { ... }` ; conserver les blocs `@layer base/components` tels quels. Supprimer `tailwind.config.js` + `postcss.config.js` ; `npm uninstall autoprefixer cssnano` (et retirer `@tailwindcss/typography` de devDeps seulement s'il passe en dep via @plugin — sinon le garder).
```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
@theme {
  --color-sage-50: #f4f7f4; /* … 50–900 */
  --color-mint-600: #477a6d;
  --font-sans: "Inter", sans-serif;
  --font-serif: "Cormorant Garamond", serif;
}
.prose-sage { --tw-prose-body: var(--color-sage-600); /* … */ }
```
Verify: `npm run build` exit 0 ; `ls tailwind.config.js postcss.config.js 2>&1` = introuvables. Temps 8 min.

**T6 · R-frontend-dev-B · css · phase GREEN · difficulté 3** — Renames de classes (~94 sites) : `shadow-sm`→`shadow-xs`, bare `shadow `→`shadow-sm`, bare `rounded`→`rounded-sm` (sed prudent avec word-boundaries + revue `git diff` ligne par ligne ; exclure `shadow-lg/xl/2xl` et `rounded-lg/xl/full`).
Verify: `grep -rEo '\bshadow-sm\b' src | wc -l` = 0 (tous passés à shadow-xs) ; `grep -rEo '"[^"]*\brounded[" ]' src | wc -l` = 0 ; build exit 0. Temps 6 min.

**T7 · R-tester-A · diff · phase RED-GATE · difficulté 3** — Diff HTML rendu (pages clés : accueil, `/rendez-vous/`, `/tarifs/`, 1 post) baseline vs V2 : seuls tokens autorisés = attributs astro internes ; classes `shadow/rounded` reflétées 1:1.
Verify: script de diff (T12 peut être avancé ici en version minimale) → 0 diff hors allowlist. Temps 5 min.

### Slice V3 — Bump astro 5→7

**T8 · R-devops-A · build · phase GREEN · difficulté 5** — Bumps : `astro@^7.3.2`, `@astrojs/react@^6.0.5`, `@astrojs/netlify@^8.2.5`, `@astrojs/sitemap@^3.7.4` (refresh), `@astrojs/check` (bump si peer l'exige) ; `npm install` (lockfile régénéré) ; `src/content.config.ts` : `z` importé de `astro/zod` ; `astro.config.mjs` : `compressHTML: true` ; corriger au fil du build ce que le compilateur Rust signale (balises non fermées) et ce que `astro check`/vitest cassent (APIs retirées). Si `manualChunks` est ignoré par Rolldown → fallback `output.advancedChunks` pour le chunk sentry.
Verify: `npm run build` exit 0 ; `npm ls astro` → 7.3.x ; `grep compressHTML astro.config.mjs`. Temps 10 min.

**T9 · R-devops-B · runtime · phase GREEN · difficulté 2 · [P] avec T8** — Pin Node source unique : `.nvmrc` = version 22.x exacte ≥22.12 (latest au moment du run) ; `netlify.toml` : retirer `NODE_VERSION` ; `ci.yml` : les 2 jobs → `node-version-file: .nvmrc` + nouvelle étape bloquante dans le job `build` juste après `npm ci` : `run: npm audit --omit=dev --audit-level=high`.
Verify: `grep -c NODE_VERSION netlify.toml` = 0 ; `grep -c "node-version-file" ci.yml` = 2 ; `grep -c "audit-level=high" ci.yml` = 1. Temps 4 min.

**T10 · R-tester-A · diff · phase RED-GATE · difficulté 2** — Diff sitemap baseline vs build v7 = 0 URL diff ; chunk sentry émis : `ls dist/_astro/ | grep -i sentry` (sinon fallback advancedChunks documenté dans la PR).
Verify: diff vide ; fichier chunk sentry ∃. Temps 4 min.

### Slice V4 — Gates + audit

**T11 · R-tester-B · gates · phase RED-GATE · difficulté 3** — Gates locaux séquentiels (lead) : `npm run test:low` → `npm run lint` → `npm run typecheck` → `npm run build` ; corriger ce qui casse (drift types astro 7 / @astrojs/react 6 ; typecheck reste BLOQUANT — cf. spec).
Verify: exit 0 ×4 consignés. Temps 10 min.

**T12 · R-devops-B · tooling · phase GREEN · difficulté 4 · [P] avec T11** — `scripts/diff-html-170.mjs` : pour chaque URL du sitemap, comparer HTML rendu baseline v5 vs build v7 ; allowlist mécanique de tokens astro internes (hashes scripts, noms d'assets) ; exit 1 sur toute autre diff ; **12 posts inclus** (changement de processeur markdown Sätteri) ; `/mes-rdvs/` exclu.
Verify: `node scripts/diff-html-170.mjs` exit 0 sur l'arbre final. Temps 8 min.

**T13 · R-tester-B · gates · phase RED-GATE · difficulté 2** — Re-audit : `npm audit --omit=dev --audit-level=high` exit 0 (local) ; `npm audit` complet consigné (moderates résiduels listés dans la PR) ; `npm run audit:a11y` final vs baseline T1 (même ensemble succès/échec) ; `npm ls nodemailer` = 9.1.x unique.
Verify: exit 0 ×2 ; sortie a11y comparée. Temps 6 min.

**T14 · R-tester-B · gates · phase RED-GATE · difficulté 1** — Préparer la checklist smoke SSR (exécutée par l'autrice de la PR sur le deploy preview, avant review) : dump noms de vars d'env du preview (exiger `sk_test`/mock — JAMAIS prod), puis `curl -sS -o /dev/null -w "%{http_code}" <preview>/api/availability/` = 200, puis POST de réservation test ; consigner sorties curl + noms d'env dans la description de PR.
Verify: checklist + commandes prêtes dans le corps de PR. Temps 3 min.

## Wave Structure

9 vagues, max 3 agents parallèles. Écoulement ~1 h en agent-time vs ~2 h séquentiel.

| Wave | Trigger | Agents | Tasks |
|------|---------|--------|-------|
| 1 | start | 1 | tester-A: T1 |
| 2 | T1 done | 3 ∥ | frontend-A: T2a→T2b→T2c · devops-A: T4 · devops-B: T9 |
| 3 | Wave 2 done | 2 ∥ | frontend-B: T5→T6 · tester-A: T3 |
| 4 | Wave 3 done | 1 | tester-A: T7 |
| 5 | Wave 4 done | 1 | devops-A: T8 |
| 6 | Wave 5 done | 1 | tester-A: T10 |
| 7 | Wave 6 done | 2 ∥ | devops-B: T12 · tester-B: T11 |
| 8 | Wave 7 done | 1 | tester-B: T13 |
| 9 | Wave 8 done | 1 | tester-B: T14 |

### Budget — per task

| Task | Items | Class | Est. ops | Split? |
|------|-------|-------|----------|--------|
| T1 baseline | 3 | bounded | 3 | — |
| T2a loader+schema | 1 | judgmental | 4 | — |
| T2b 12 posts | 12 | trivial | 3 | — |
| T2c adapter+render | 2 | judgmental | 4 | — |
| T3 diff sitemap | 1 | bounded | 3 | — |
| T4 deps TW4 + config | 3 | bounded | 3 | — |
| T5 index.css @theme | 3 | judgmental | 5 | — |
| T6 renames ~94 | 94 | trivial+judgmental | 5 | — |
| T7 diff HTML clé | 4 | judgmental | 4 | — |
| T8 bump 5→7 | 6 | exploratory | 8 | sous 50 — OK |
| T9 pins + audit CI | 4 | bounded | 3 | — |
| T10 diff sitemap + sentry | 2 | bounded | 3 | — |
| T11 gates ×4 | 4 | judgmental | 5 | — |
| T12 script diff | 1 | judgmental | 6 | — |
| T13 re-audit + a11y | 4 | bounded | 4 | — |
| T14 checklist smoke | 1 | trivial | 2 | — |

**Total estimated ops: 65**

### Budget — per agent instance

| Instance | Tasks | Σ ops | Subjects | Split? |
|----------|-------|-------|----------|--------|
| R-tester-A | T1, T3, T7, T10 | 13 | diff | — |
| R-frontend-dev-A | T2a, T2b, T2c | 11 | content | — |
| R-frontend-dev-B | T5, T6 | 10 | css | — |
| R-devops-A | T4, T8 | 11 | deps, build | — |
| R-devops-B | T9, T12 | 9 | runtime, tooling | — |
| R-tester-B | T11, T13, T14 | 11 | gates | — |

## Consistency Report

- Critères spec → tâches : 15/15 couverts (SC1←T8/T11 · SC2←T9+T13 · SC3←T3/T10 · SC4←T2a-c/T8 · SC5←T5/T7 · SC6←T14 · SC7←T11 · SC8←T1/T13 · SC9←T7/T12 · SC10←T10 · SC11←T8 · SC12←T9 · SC13←T9 · SC14←T4/T5 · SC15←T13).
- Tâches sans trace spec : 0. Critères sans tâche : 0.

## Task Seeding Blueprint

<!-- Used by /R-dev-implement to seed TaskCreate calls on session start.
     Format: T{n} | agent-instance | blockedBy | subject
     Seed in wave order; within a wave all rows are parallel (∥). -->

### Wave 1 — no deps, 1 agent

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T1 | R-tester-A | — | diff |

### Wave 2 — after T1, 3 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T2a | R-frontend-dev-A | T1 | content |
| T2b | R-frontend-dev-A | T2a | content |
| T2c | R-frontend-dev-A | T2b | content |
| T4 | R-devops-A | T1 | deps |
| T9 | R-devops-B | T1 | runtime |

### Wave 3 — after Wave 2, 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T5 | R-frontend-dev-B | T4 | css |
| T6 | R-frontend-dev-B | T5 | css |
| T3 | R-tester-A | T2c | diff |

### Wave 4 — after Wave 3, 1 agent

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T7 | R-tester-A | T3,T6 | diff |

### Wave 5 — after Wave 4, 1 agent

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T8 | R-devops-A | T7 | build |

### Wave 6 — after Wave 5, 1 agent

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T10 | R-tester-A | T8 | diff |

### Wave 7 — after Wave 6, 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T11 | R-tester-B | T10 | gates |
| T12 | R-devops-B | T10 | tooling |

### Wave 8 — after Wave 7, 1 agent

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T13 | R-tester-B | T11,T12 | gates |

### Wave 9 — after Wave 8, 1 agent

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T14 | R-tester-B | T13 | gates |

## Task IDs

<!-- Generated by /R-dev-plan. Used by /R-dev-implement to resume tasks on session restart.
     Host: portable todo list (todo_write) — pas d'IDs natifs ; /R-dev-implement re-attache
     via le blueprint ci-dessus (wave order, agent instances, blockedBy). -->
- T1: todo — diff
- T2a: todo — content
- T2b: todo — content
- T2c: todo — content
- T3: todo — diff
- T4: todo — deps
- T5: todo — css
- T6: todo — css
- T7: todo — diff
- T8: todo — build
- T9: todo — runtime
- T10: todo — diff
- T11: todo — gates
- T12: todo — tooling
- T13: todo — gates
- T14: todo — gates
