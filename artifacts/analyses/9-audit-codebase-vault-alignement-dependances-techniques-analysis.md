---
issue: 9
title: "Audit codebase, vault & fonctionnalités — alignement des dépendances techniques"
type: chore
complexity: L
tier: F-full
---

## Problem

Triple dette de synchronisation accumulée depuis janvier 2025 : le codebase contient du dead code et des packages fantômes, la documentation vault est désynchronisée (16 versions erronées), et 40 vulnérabilités de sécurité existent dont plusieurs à impact production.

---

## Current State

### Domaine 1 — Codebase Health (71 fichiers)

**Structure ✅ conforme aux conventions :**
- PascalCase composants, camelCase utils/hooks, préfixe `use` respecté
- Séparation par domaine : `blog/`, `common/`, `contact/`, `footer/`, `home/`, `navigation/`, `pricing/`
- TypeScript strict activé, pas de `any` détecté dans les types exposés
- ESLint flat config (v9) opérationnel, aucune erreur lint

**Dead code confirmé :**
| Élément | Fichier | Statut |
|---------|---------|--------|
| `BlogSyncButton` | `src/components/blog/BlogSyncButton.tsx` | `showSyncButton={false}` dans `Blog.tsx:96` → jamais visible |
| `syncLinkedInPosts()` | `src/utils/blogApi.ts` | Stub pur (retourne `true` après 1.5s) |
| `fetchLinkedInPosts()` | `src/utils/blogApi.ts` | Retourne `[]` — aucune implémentation |
| `BlogHeader.onSyncComplete` prop | `src/components/blog/BlogHeader.tsx` | Jamais appelée en pratique |

**Package fantôme :**
- `@tailwindcss/line-clamp` dans `package.json` mais **absent** de `tailwind.config.js` plugins
- Classes `line-clamp-3` / `line-clamp-2` utilisées dans `BlogPostCard.tsx` et `BlogPostDetail.tsx` — fonctionnent via Tailwind 3.3+ natif
- Suppression du package sûre à 100%

**Gap CLAUDE.md vs code :**
- `useMotionVariants` — CLAUDE.md stipule "respecter `prefers-reduced-motion`" mais le hook n'implémente pas `window.matchMedia('(prefers-reduced-motion: reduce)')`
- Router future flags `v7_startTransition` + `v7_relativeSplatPath` **déjà présents** dans `App.tsx` → migration React Router 7 facilitée

### Domaine 2 — Vault & Documentation

**Vault créé le 27/04/2026, contenu sourcé de `memory-bank/` (jan 2025) :**

| Entrée vault | État |
|-------------|------|
| #1 Project Overview | Probablement à jour (vérifier) |
| #2 Architecture | À vérifier vs code actuel |
| #3 Coding Conventions | Cohérent avec code observé |
| #4 ADRs | Manque ADR sur décisions de migration différées |
| #5 Technical Stack | **16 versions erronées** (voir tableau ci-dessous) |
| #6 Active Context | Daté 2 janvier 2026 — obsolète |
| #7 doc-sync migration | Méta-entrée sur la migration elle-même |

**16 dérives de version dans Technical Stack (vault #5) :**
| Package | Vault (jan 2025) | Actuel | Écart |
|---------|-----------------|--------|-------|
| React Router DOM | 6.22.3 | 6.30.2 | +8 patches |
| TypeScript | 5.5.3 | 5.9.3 | +4 minors |
| Vite | 5.4.2 | 5.4.21 | +19 patches |
| PostCSS | 8.4.35 | 8.5.1 | +1 minor |
| Tailwind CSS | 3.4.1 | 3.4.17 | +16 patches |
| ESLint | 9.9.1 | 9.39.2 | +30 patches |
| framer-motion | 11.0.8 | 11.18.2 | +10 patches |
| Terser | 5.38.1 | 5.44.1 | +6 patches |
| cssnano | 6.0.5 | 6.1.2 | +1 minor |
| @types/react | 18.3.5 | 18.3.18 | +13 patches |
| @types/react-dom | 18.3.0 | 18.3.5 | +5 patches |
| typescript-eslint | 8.3.0 | 8.51.0 | +48 patches |
| @tailwindcss/typography | 0.5.10 | 0.5.16 | +6 patches |
| @tailwindcss/line-clamp | 0.4.4 | — | **à supprimer** |
| lucide-react | 0.344.0 | 0.562.0 | +218 patches |
| globals | — | 15.15.0 | **absent du vault** |

**`memory-bank/` physique dans le repo :**
- 7 fichiers `.md` toujours committés dans `/memory-bank/`
- Aucun fichier `.gitignore` ou notice de déprécation
- Coexistence silencieuse avec le vault → confusion entre agents et contributeurs

### Domaine 3 — Sécurité & Dépendances

**40 vulnérabilités (1 critical, 22 high, 17 moderate)**

**Impact production direct (packages dans le bundle produit) :**
| Sévérité | Package | Vulnérabilité | Fix disponible |
|----------|---------|---------------|----------------|
| HIGH | `@remix-run/router` | XSS via open redirects (via `react-router-dom`) | Mettre à jour react-router-dom vers 7.x |
| MODERATE | `postcss` | XSS via `</style>` dans CSS stringify | `postcss ≥8.5.10` (actuel: 8.5.1) |
| MODERATE | `vite` | Path traversal dans optimized deps `.map` | Vite 6/7/8 ou patch |

**Impact dev-tools uniquement (pa11y, lighthouse, Chromium chain) :**
- CRITICAL: `basic-ftp` path traversal
- HIGH: `rollup` (build tool), `undici`, `lodash`, `minimatch`, `flatted`, `svgo`, `underscore`
- MODERATE: `ajv`, `brace-expansion`, `esbuild`, `jsonpath`, `yaml`

Ces vulnérabilités dev-tools n'exposent pas la production mais doivent être mitigées dans le CI.

---

## Impact

- **Utilisateurs** : Risque théorique XSS via `@remix-run/router` (production) et `postcss` (CSS build output) — non exploité connu, mais présent
- **Agents AI Copilot** : vault stale → 16 versions erronées peuvent générer des suggestions incorrectes sur les dépendances
- **Maintenabilité** : dead code augmente la surface de maintenance ; memory-bank vs vault = ambiguïté source de vérité
- **Sécurité CI** : 40 vulnérabilités masquent les nouvelles — impossible de distinguer les nouvelles alertes

---

## Approach Options

### Option A — Migration phasée (recommandée)

**Phase 0 — Livraison de cet issue (PR unique) :**
1. Supprimer dead code : `BlogSyncButton`, `syncLinkedInPosts`, `fetchLinkedInPosts`, `BlogHeader.onSyncComplete`
2. Supprimer `@tailwindcss/line-clamp` du `package.json`
3. Patcher `postcss` → `≥8.5.10` (safe, même major)
4. Appliquer les safe minor/patch updates listées ci-dessous
5. Mettre à jour vault #5 (Technical Stack) avec les versions réelles
6. Mettre à jour vault #6 (Active Context) — état avril 2026
7. Ajouter `DEPRECATED.md` dans `memory-bank/` ou le supprimer du repo
8. Créer ADRs manquants : décisions de non-migration React 19, Vite 8, Tailwind 4

**Safe updates (Phase 0, sans risque) :**
`postcss` `autoprefixer` `pa11y` `pa11y-ci` `terser` `typescript-eslint` `globals` `lighthouse` `@tailwindcss/typography` `eslint-plugin-react-refresh` `eslint-plugin-react-hooks`

**Phase 1 — Breaking changes (issues séparées) :**
| Priorité | Package | Effort | Raison |
|----------|---------|--------|--------|
| 1 | React Router 6→7 | M | Fix XSS, future flags déjà en place |
| 2 | React 18→19 | L | Stable, meilleur perf, prérequis framer-motion 12 |
| 3 | framer-motion 11→12 | S | Après React 19 |
| 4 | ESLint 9→10 | S | Config migration flat → flat v2 |
| 5 | Tailwind 3→4 | L | Config format change, plugins incompatibles |
| 6 | Vite 5→8 | M | Fix path traversal, après Tailwind 4 |
| 7 | TypeScript 5→6 | M | Dernière priorité, attendre ecosystème |

Pros: maîtrise du risque, PRs testables unitairement, rollback facile
Cons: plus long (plusieurs semaines/mois), `@remix-run/router` XSS non résolu avant Phase 1 PR1
Risque: **low**

---

### Option B — Big bang (tout à latest)

Mettre à jour toutes les dépendances majeures en une seule PR.
Pros: dépendances à jour immédiatement
Cons: multiple breaking changes simultanés, débogage impossible, risque élevé de régression prod
Risque: **high** — déconseillé

---

### Option C — Security-only + doc sync

Patcher uniquement les vulnérabilités patchables sans breaking change + mettre à jour vault.
Pros: rapide, risque minimal
Cons: ne résout pas `@remix-run/router` XSS (requiert major), ne supprime pas le dead code
Risque: **low** mais dette non résolue

---

## Recommendation

**Option A — Phase 0 uniquement pour cet issue.**

La Phase 0 est entièrement safe (aucun breaking change) et donne le maximum de valeur :
- Élimine le dead code et le package fantôme
- Corrige `postcss` XSS immédiatement (même major)
- Synchronise la documentation vault (améliore la qualité des suggestions AI)
- Clarifie le statut `memory-bank/`
- Crée les ADRs pour documenter les décisions de non-migration

Les breaking changes (Phase 1) sont documentés dans des ADRs et planifiés en issues séparées avec le scope et les risques clairs.

## Appetite

Estimated tier: F-full
Complexity: L (3 domaines, ~20 fichiers affectés, décisions architecturales à documenter)
Phase 0 seule: ~F-lite (1 domaine à la fois, actions clairement définies)
