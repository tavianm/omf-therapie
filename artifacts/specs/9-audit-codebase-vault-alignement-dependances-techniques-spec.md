---
issue: 9
title: "Audit codebase, vault & fonctionnalités — alignement des dépendances techniques"
tier: F-full
status: approved
---

## Goal

Supprimer le dead code LinkedIn, nettoyer les packages fantômes, patcher les vulnérabilités de sécurité traitables sans breaking change, synchroniser le vault avec l'état réel du code, et produire une roadmap ADR pour les migrations majeures.

## Context

Le projet `omf-therapie` (React 18 + TypeScript + Vite + Tailwind 3) est stable en production depuis janvier 2025. Depuis, des patches et minor updates ont été appliqués sans mise à jour de la documentation. Un audit complet révèle :

- **Dead code** : `BlogSyncButton` / `syncLinkedInPosts` / `fetchLinkedInPosts` = stubs LinkedIn jamais implémentés, non visibles en prod (`showSyncButton={false}` hardcodé)
- **Package fantôme** : `@tailwindcss/line-clamp` dans `package.json` mais absent de `tailwind.config.js`, fonctionnalité native Tailwind 3.3+
- **Vulnérabilité patchable** : `postcss <8.5.10` XSS (actuel: 8.5.1) — même major, safe
- **Vault stale** : 16 versions erronées dans Technical Stack (vault #5), Active Context (vault #6) daté janvier 2026
- **memory-bank/ ambigu** : fichiers physiques dans le repo sans statut clarifié vs vault
- **ADRs manquants** : aucune décision documentée pour les migrations majeures différées (React 19, Vite 8, Tailwind 4, Router 7)
- **`prefers-reduced-motion`** non implémenté dans `useMotionVariants` malgré la convention CLAUDE.md
- **`@remix-run/router` XSS** (HIGH) : requiert React Router 7 — hors scope de cette PR, traité par ADR

Fichiers principaux : `src/components/blog/BlogSyncButton.tsx`, `src/components/blog/BlogHeader.tsx`, `src/pages/Blog.tsx`, `src/utils/blogApi.ts`, `package.json`, vault entries #5 #6, `memory-bank/`

## Acceptance Criteria

### Slice 1 — Dead code supprimé
- [ ] AC1 : `src/components/blog/BlogSyncButton.tsx` n'existe plus
- [ ] AC2 : `syncLinkedInPosts` et `fetchLinkedInPosts` sont supprimés de `src/utils/blogApi.ts`
- [ ] AC3 : `BlogHeader` ne référence plus `BlogSyncButton` et la prop `showSyncButton` est supprimée
- [ ] AC4 : `src/pages/Blog.tsx` ne passe plus `showSyncButton={false}` ni `onSyncComplete`
- [ ] AC5 : `pnpm run build` passe sans erreur après suppression
- [ ] AC6 : `pnpm run lint` passe sans erreur après suppression

### Slice 2 — Package fantôme supprimé
- [ ] AC7 : `@tailwindcss/line-clamp` absent de `package.json` (dependencies et devDependencies)
- [ ] AC8 : Les classes `line-clamp-3` et `line-clamp-2` fonctionnent toujours (Tailwind natif, build réussi)
- [ ] AC9 : `pnpm-lock.yaml` régénéré sans le package

### Slice 3 — Sécurité patchée (safe)
- [ ] AC10 : `postcss ≥8.5.10` dans `package.json` et `pnpm-lock.yaml`
- [ ] AC11 : Toutes les safe minor/patch updates appliquées : `autoprefixer`, `pa11y`, `pa11y-ci`, `terser`, `typescript-eslint`, `globals`, `lighthouse`, `@tailwindcss/typography`, `eslint-plugin-react-refresh`, `eslint-plugin-react-hooks`
- [ ] AC12 : Aucune régression — `pnpm run build` et `pnpm run lint` passent
- [ ] AC13 : `pnpm audit` ne montre plus la vulnérabilité `postcss <8.5.10`

### Slice 4 — `useMotionVariants` — prefers-reduced-motion
- [ ] AC14 : `useMotionVariants` détecte `prefers-reduced-motion: reduce` via `window.matchMedia`
- [ ] AC15 : Quand `prefers-reduced-motion: reduce` est actif, les animations sont désactivées (durée 0, pas de translate)
- [ ] AC16 : Comportement inchangé quand la préférence système n'est pas active

### Slice 5 — Vault synchronisé
- [ ] AC17 : Vault #5 (Technical Stack) reflète les 16 versions corrigées (React Router 6.30.2, TS 5.9.3, Vite 5.4.21, etc.)
- [ ] AC18 : `@tailwindcss/line-clamp` supprimé du vault #5
- [ ] AC19 : `globals` ajouté au vault #5
- [ ] AC20 : Vault #6 (Active Context) mis à jour avec état avril 2026 (résumé de cet audit)
- [ ] AC21 : Vault #4 (ADRs) contient les 4 nouveaux ADRs (voir Slice 6)

### Slice 6 — ADRs & memory-bank
- [ ] AC22 : ADR créé : "Deferral — React Router 6→7" (raison : évaluation, future flags en place)
- [ ] AC23 : ADR créé : "Deferral — React 18→19" (raison : attente stabilité écosystème)
- [ ] AC24 : ADR créé : "Deferral — Tailwind 3→4 + Vite 5→8" (raison : breaking config, trop de risque production)
- [ ] AC25 : ADR créé : "Dead code LinkedIn" (raison : feature non implémentée, supprimée)
- [ ] AC26 : `memory-bank/README.md` mis à jour avec notice `DEPRECATED — vault omf-therapie est la source de vérité`
- [ ] AC27 : Un fichier `memory-bank/DEPRECATED.md` existe avec les instructions de migration

## Breadboard

| Surface | Action | Handler | Résultat |
|---------|--------|---------|----------|
| `BlogSyncButton.tsx` | Suppression fichier | git rm | Composant absent |
| `blogApi.ts` | Suppression fonctions `syncLinkedInPosts` + `fetchLinkedInPosts` | edit | API réduite à 4 fonctions |
| `BlogHeader.tsx` | Suppression import + prop `showSyncButton` | edit | Composant simplifié |
| `Blog.tsx` | Suppression prop `showSyncButton={false}` | edit | Appel BlogHeader sans param sync |
| `package.json` | Suppression `@tailwindcss/line-clamp`, patch `postcss`, bump minors | pnpm update | Lockfile régénéré |
| `useMotionVariants.ts` | Ajout détection `prefers-reduced-motion` | edit | Animations désactivées si réduction demandée |
| Vault #5 | Mise à jour 16 versions + suppression line-clamp + ajout globals | vault update | Technical Stack aligné |
| Vault #6 | Réécriture Active Context avril 2026 | vault update | Contexte actuel |
| Vault #4 | Ajout 4 ADRs dans entry ADRs | vault update | Décisions documentées |
| `memory-bank/README.md` + `DEPRECATED.md` | Ajout notice déprécation | edit + create | Statut clarifié |

## Slices

**Slice 1 — Dead code LinkedIn :** Supprimer `BlogSyncButton.tsx`, les stubs `syncLinkedInPosts`/`fetchLinkedInPosts` dans `blogApi.ts`, simplifier `BlogHeader` (retirer la prop `showSyncButton`), nettoyer `Blog.tsx`.
→ Fichiers: `BlogSyncButton.tsx` (suppression), `blogApi.ts`, `BlogHeader.tsx`, `Blog.tsx`

**Slice 2 — Package fantôme :** Retirer `@tailwindcss/line-clamp` de `package.json`, régénérer le lockfile, vérifier que le build passe.
→ Fichiers: `package.json`, `pnpm-lock.yaml`

**Slice 3 — Safe deps update :** Patcher `postcss` vers `≥8.5.10` et appliquer toutes les minor/patch updates sans breaking change.
→ Fichiers: `package.json`, `pnpm-lock.yaml`

**Slice 4 — prefers-reduced-motion :** Implémenter la détection media query dans `useMotionVariants` — retourner des variants neutres (durée 0, pas de transformation) quand la préférence est active.
→ Fichiers: `src/hooks/useMotionVariants.ts`

**Slice 5 — Vault sync :** Mettre à jour les entrées vault #5 (Technical Stack) et #6 (Active Context) via `vault update`.
→ Vault entries: #5, #6

**Slice 6 — ADRs + memory-bank déprécation :** Ajouter 4 ADRs dans vault #4. Ajouter notice de déprécation dans `memory-bank/`.
→ Vault entry: #4, fichiers: `memory-bank/README.md`, `memory-bank/DEPRECATED.md`

## Out of Scope

- Mise à jour de React 19, Vite 8, Tailwind 4, React Router 7 — issues séparées avec PRs dédiées
- Suppression physique du répertoire `memory-bank/` du repo (requiert consensus équipe)
- Implémentation réelle de l'intégration LinkedIn
- Ajout de tests automatisés (Vitest)
- Migration ESLint 9→10
- Audit Lighthouse / pa11y (baseline séparée)

## Open Questions

- `useMotionVariants` : faut-il aussi respecter `prefers-reduced-motion` pour `staggerChildren` ou seulement les transitions directes ? → Supposé : oui pour toutes les animations
- `memory-bank/` : faut-il le supprimer du repo dans cette PR ou seulement le marquer déprécié ? → Conservatif : dépréciation uniquement, suppression en issue séparée
