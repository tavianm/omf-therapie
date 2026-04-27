---
issue: 9
tier: F-full
spec: artifacts/specs/9-audit-codebase-vault-alignement-dependances-techniques-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Fichiers | Dépendances | Parallèle? |
|----|-------------|-------|----------|-------------|-----------|
| T1 | Supprimer dead code LinkedIn : `BlogSyncButton.tsx` (git rm), retirer `syncLinkedInPosts` + `fetchLinkedInPosts` de `blogApi.ts`, simplifier `BlogHeader.tsx` (retirer prop `showSyncButton`), nettoyer `Blog.tsx` | frontend-dev | `src/components/blog/BlogSyncButton.tsx`, `src/utils/blogApi.ts`, `src/components/blog/BlogHeader.tsx`, `src/pages/Blog.tsx` | — | Y |
| T2 | Supprimer `@tailwindcss/line-clamp` de `package.json`, régénérer lockfile (`pnpm install`), vérifier que `line-clamp-3`/`line-clamp-2` fonctionnent toujours (Tailwind natif) | frontend-dev | `package.json`, `pnpm-lock.yaml` | — | Y |
| T3 | Patcher `postcss` vers `^8.5.10` et appliquer toutes les safe minor/patch updates : `autoprefixer`, `pa11y`, `pa11y-ci`, `terser`, `typescript-eslint`, `globals`, `lighthouse`, `@tailwindcss/typography`, `eslint-plugin-react-refresh`, `eslint-plugin-react-hooks` | devops | `package.json`, `pnpm-lock.yaml` | T2 | N |
| T4 | Implémenter `prefers-reduced-motion` dans `useMotionVariants` : détecter `window.matchMedia('(prefers-reduced-motion: reduce)')`, retourner variants neutres (durée 0, pas de transform) si actif — pour toutes les fonctions du hook | frontend-dev | `src/hooks/useMotionVariants.ts` | — | Y |
| T5 | Mettre à jour vault #5 (Technical Stack) : corriger les 16 versions erronées, supprimer `@tailwindcss/line-clamp`, ajouter `globals`. Mettre à jour vault #6 (Active Context) : réécrire avec l'état avril 2026 (résumé de cet audit + prochaines étapes) | inline | vault entries #5, #6 | T1, T2, T3 | N |
| T6 | Ajouter 4 ADRs dans vault #4 : (1) Deferral React Router 6→7, (2) Deferral React 18→19, (3) Deferral Tailwind 3→4 + Vite 5→8, (4) Dead code LinkedIn supprimé. Créer `memory-bank/DEPRECATED.md` + mettre à jour `memory-bank/README.md` | inline | vault entry #4, `memory-bank/README.md`, `memory-bank/DEPRECATED.md` | T5 | N |
| T7 | Quality gate : `pnpm run lint` + `pnpm run build` — aucune erreur, bundle produit valide | tester | — | T1, T2, T3, T4 | N |

## Agent Slices

**frontend-dev:** T1 (dead code), T2 (package fantôme), T4 (prefers-reduced-motion)

**devops:** T3 (safe deps update + postcss patch)

**inline (doc):** T5 (vault sync), T6 (ADRs + memory-bank)

**tester:** T7 (quality gate)

## Quality Gate

```bash
pnpm run lint && pnpm run build
```

Indicateur de succès : build sans erreur (`vite build` ✓) + lint sans erreur (`eslint .` ✓)

## Séquence d'exécution

```
Phase A (parallèle) :  T1 + T4           (code changes indépendants)
Phase B (parallèle) :  T2                (package.json cleanup)
Phase C (séquentiel):  T3                (deps update, après T2 pour lockfile propre)
Phase D (séquentiel):  T7                (quality gate, tous les changements appliqués)
Phase E (parallèle) :  T5 + T6           (vault/docs, après validation build)
```

## Notes

- **T1** : `git rm src/components/blog/BlogSyncButton.tsx` puis nettoyer les imports dans `BlogHeader.tsx` et `Blog.tsx`. Ne pas oublier de retirer aussi le `Toaster` import de `Blog.tsx` s'il n'est plus utilisé.
- **T2 + T3** : coordonner l'ordre — T2 en premier pour un lockfile propre, puis T3 fait `pnpm update` ciblé avec les packages listés.
- **T4** : `useMotionVariants` est un hook partagé — vérifier qu'aucun composant ne bypass les variants retournés.
- **T5** : utiliser `vault update <id>` avec le contenu mis à jour. Vérifier les 16 packages un par un contre `package.json` actuel.
- **T6** : les ADRs doivent documenter la date de décision (27 avril 2026), le contexte (cette analyse), et les critères pour revisiter la décision.
- **Hors scope confirmé** : React 19, Vite 8, Tailwind 4, Router 7 → issus séparées. Ne pas faire glisser le scope.
