---
issue: ~
tier: F-lite
spec: artifacts/specs/activation-page-rendez-vous-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Retirer "Contact" de NavigationItems ; mettre à jour isActive dans Navbar.tsx (supprimer cas `/contact`, ajouter `/rendez-vous`) | frontend-dev | `src/components/navigation/NavigationItems.tsx`, `src/components/islands/Navbar.tsx` | — | Y |
| T2 | Remplacer les 2 CTAs `/contact` → `/rendez-vous/` dans les 4 pages de service | frontend-dev | `src/pages/services/therapie-individuelle.astro`, `therapie-de-couple.astro`, `therapie-familiale.astro`, `troubles-alimentaires.astro` | — | Y |
| T3 | Remplacer CTAs `/contact` → `/rendez-vous/` dans les pages éditoriales + lien psychologue.net sur contact.astro | frontend-dev | `src/pages/a-propos.astro`, `src/pages/blog/[slug].astro`, `src/pages/rendez-vous.astro`, `src/pages/contact.astro`, `src/pages/404.astro` | — | Y |
| T4 | Valider : `npm run lint` — 0 nouvelles erreurs | tester | — | T1, T2, T3 | N |

## Budget

### Per task

| Task | Subject | Class | Est. ops |
|------|---------|-------|----------|
| T1 | navigation | bounded | ~3 |
| T2 | routing/cta | trivial | ~2 |
| T3 | routing/cta | bounded | ~3 |
| T4 | lint | trivial | ~1 |

### Per agent instance

| Instance | Tasks | Subjects | Est. ops | Action |
|----------|-------|----------|----------|--------|
| frontend-dev | T1, T2, T3 | navigation | ~8 | — |
| tester | T4 | lint | ~1 | — |

## Agent Slices

**frontend-dev:** T1, T2, T3 — navigation island + pages Astro (même sujet : routing/liens)
**tester:** T4 — quality gate lint

## Quality Gate

```bash
npm run lint
```

## Sequence

1. **T1, T2, T3** (parallèles) — modifications indépendantes dans leurs fichiers respectifs
2. **T4** — lint après toutes les modifications
