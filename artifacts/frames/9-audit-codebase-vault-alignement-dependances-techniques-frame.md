---
issue: 9
title: "Audit codebase, vault & fonctionnalités — alignement des dépendances techniques"
status: approved
tier: F-full
created: 2026-04-27
---

## Problem Statement

Le projet OMF Therapie accumule une dette de synchronisation sur trois fronts :

1. **Codebase drift** — 71 fichiers sources jamais auditées systématiquement depuis la mise en production (Jan 2025). Présence de composants suspects (`BlogSyncButton`), pas de revue des conventions ou de l'accessibilité depuis les dernières modifications.

2. **Documentation désynchronisée** — Les 7 entrées vault (`omf-therapie`) ont été créées le 27 avril 2026 mais reflètent des versions de janvier 2025 (TS 5.5.3, Vite 5.4.2 vs actuel 5.9.3 / 5.4.21). Le `memory-bank/` physique coexiste avec le vault sans statut clair.

3. **Dépendances obsolètes** — 4 dépendances majeures ont des breaking changes significatifs (React 18→19, Vite 5→8, Tailwind 3→4, React Router 6→7). Sans plan documenté, la prochaine mise à jour risque de casser la production.

## Why This Matters

- **Sécurité** : des vulnérabilités sont présentes (8 au total, dont 1 high) — le plan doit prioriser les remèdes
- **Maintenabilité** : sans audit, les nouvelles contributions créeront des incohérences non détectées
- **Documentation fiable** : les agents AI (Copilot) utilisent le vault comme source de vérité — des données obsolètes génèrent des suggestions incorrectes
- **Prévisibilité** : connaître le coût réel de chaque migration évite les surprises en production

## Success Criteria

- [ ] Rapport d'audit codebase : inventaire composants/hooks/pages, conformité conventions, composants à supprimer
- [ ] Rapport d'audit accessibilité : résultats pa11y actuels (baseline)
- [ ] Vault aligné avec le code réel (versions, patterns, ADRs à jour — Technical Stack, Active Context, Architecture)
- [ ] `memory-bank/` statut tranché : soit supprimé du repo, soit explicitement marqué `DEPRECATED — vault est la source de vérité`
- [ ] Roadmap de migration des dépendances en 3 phases :
  - **Phase 1 (safe)** : patch/minor sans breaking changes → appliquer immédiatement
  - **Phase 2 (moderate)** : TypeScript 6, framer-motion 12, eslint 10, lucide-react 1.x → analyse d'impact par package
  - **Phase 3 (breaking)** : React 19, Vite 8, Tailwind 4, React Router 7 → chacun dans une PR dédiée avec tests de régression

## Constraints

- Aucun changement en production dans le périmètre de cet issue — c'est un audit + plan, pas une migration
- Vault = source de vérité (pas le memory-bank)
- Les ADRs doivent documenter les décisions de mise à jour différée (ex : pourquoi pas Vite 8 aujourd'hui)
- Le site doit rester accessible WCAG 2.1 AA après toute modification

## Out of Scope

- Effectuer les mises à jour majeures (React 19, Vite 8, Tailwind 4, Router 7) — ce sont des issues séparées
- Intégration CMS headless
- Nouvelles fonctionnalités
- Support multilingue
- Migration de test framework (Vitest etc.)

## Stakeholders

- **Praticienne (client)** : aucun impact visible, mais bénéficie de la stabilité long-terme
- **Développeur maintainer** : principal bénéficiaire — guidance claire pour les prochaines contributions
- **Agents AI Copilot** : vault comme source de vérité, qualité des suggestions améliorée

## Appetite

Tier: F-full
Reasoning: 3 domaines distincts (codebase audit, vault sync, deps roadmap), analyse multi-fichiers, pas de code applicatif modifié mais des décisions architecturales à documenter via ADRs.

## Approach

```
1. Audit codebase
   └─ Lire tous les composants, hooks, pages (71 fichiers)
   └─ Vérifier conventions (nommage, structure, TypeScript strict)
   └─ Identifier dead code / composants suspects
   └─ Runner pa11y pour baseline accessibilité
   └─ Build + vérifier bundle size

2. Audit vault
   └─ Comparer chaque entrée vault avec le code actuel
   └─ Mettre à jour Technical Stack (versions réelles)
   └─ Mettre à jour Active Context (état avril 2026)
   └─ Ajouter/réviser ADRs manquants
   └─ Clarifier statut memory-bank/

3. Roadmap dépendances
   └─ Phase 1 : lister safe updates → PR
   └─ Phase 2 : analyser breaking changes modérés package par package
   └─ Phase 3 : documenter stratégie React 19 / Vite 8 / Tailwind 4 / Router 7
   └─ ADR pour chaque décision différée majeure
```

## Open Questions — Resolved

- **`BlogSyncButton`** : bouton de synchronisation LinkedIn → `syncLinkedInPosts()` dans `blogApi.ts`. Les articles étant des fichiers TypeScript statiques, cette feature est probablement non fonctionnelle (stub). À confirmer avant suppression.
- **`@tailwindcss/line-clamp`** : classes `line-clamp-N` utilisées dans `BlogPostCard.tsx` et `BlogPostDetail.tsx` mais le plugin est redondant depuis Tailwind 3.3 (intégré nativement). Peut être supprimé — les classes fonctionneront toujours.
- **Router future flags** : `v7_startTransition` et `v7_relativeSplatPath` déjà présents dans `src/App.tsx` ✅ — migration React Router 7 facilitée.
- **Vulnérabilités** : **40 vulnérabilités** (17 moderate, 22 high, 1 critical) — bien plus que les 8 initialement estimées. Incluent :
  - `postcss <8.5.10` : XSS via `</style>` dans CSS stringify → patchable immédiatement (8.5.10 disponible)
  - La majorité des high/critical vient probablement des outils de dev (pa11y, lighthouse, Chromium/puppeteer)
  - Priorité Phase 1 : postcss patch + audit complet de l'arbre de dépendances
