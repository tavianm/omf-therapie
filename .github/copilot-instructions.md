# Instructions pour les agents AI Copilot

**Dernière mise à jour :** 14 octobre 2025

## 🎯 Aperçu du Projet

OMF Therapie est un site web professionnel pour une praticienne en thérapie, construit avec **Astro 5** et TypeScript. Le site met l'accent sur :

- L'accessibilité (conformité WCAG)
- Les performances (Islands Architecture — zéro JS par défaut)
- Le contenu éducatif (système de blog via Content Collections)
- Le contact et la prise de rendez-vous
- L'expérience utilisateur responsive

## 📚 Documentation Essentielle

La documentation du projet est stockée dans le **vault** (namespace : `omf-therapie`). Consultez-le avant toute modification :

```bash
vault list --namespace omf-therapie    # Lister toutes les entrées
vault search "architecture"            # Architecture et patterns
vault search "conventions"             # Standards de code
vault search "ADR"                     # Décisions techniques
vault search "project overview"        # Vue d'ensemble du projet
```

Entrées disponibles : Project Overview · Architecture · Coding Conventions · Architectural Decision Records · Technical Stack · Active Context · Astro

> **Standards Astro :** Consulter `memory-bank/astro.md` pour les patterns Islands Architecture, Content Collections et directives client.

## 🏗 Architecture du Projet

```
omf-therapie/
├── src/
│   ├── components/     # Composants React (islands/) et Astro
│   │   └── islands/    # React islands hydratés côté client (Navbar, BlogClientWrapper)
│   ├── config/         # Configuration globale
│   ├── content/        # Contenu blog (Markdown, Content Collections)
│   │   └── blog/       # Articles au format Markdown avec frontmatter
│   ├── hooks/          # Hooks React personnalisés (utilisés dans les islands)
│   ├── layouts/        # Layouts Astro (Layout.astro, ServiceLayout.astro)
│   ├── pages/          # Routes Astro (fichiers .astro → URLs)
│   ├── types/          # Définitions TypeScript
│   └── utils/          # Utilitaires (schema.ts, blogApi.ts, etc.)
├── memory-bank/        # Standards de développement (astro.md, conventions.md, etc.)
└── public/             # Assets statiques et rapports
```

## 💻 Standards de Code

### Conventions Générales

- **Composants :** PascalCase (`BlogPost.tsx`)
- **Utilitaires :** camelCase (`blogApi.ts`)
- **Styles :** Tailwind CSS exclusivement
- **Types :** Interfaces pour les objets, Types pour les unions
- **Hooks :** Préfixe "use" obligatoire
- **Commits :** Messages en français, temps présent

### Pattern de Composant

```typescript
// 1. Imports (React → externes → locaux)
import { useState } from "react";
import { motion } from "framer-motion";
import { useBlogPost } from "../hooks/useBlogPost";

// 2. Types
interface Props {
  // ...
}

// 3. Composant
export default function Component({ prop }: Props) {
  // Hooks, state, handlers
  return <div />;
}
```

## 🛠 Patterns Techniques

### Gestion d'État

- État local avec `useState`
- Hooks personnalisés pour la logique réutilisable
- Pas de gestionnaire d'état global

### Routing

- Astro file-based routing : chaque fichier `src/pages/*.astro` = une URL
- Pages de service dédiées (`/services/therapie-individuelle`, etc.)
- Blog pré-rendu statiquement via `[slug].astro` + Content Collections
- Anciens paths SPA (`/Tarifs`, `/About`, etc.) redirigés via `netlify.toml`

### Performance

- **Zéro JS par défaut** — rendu serveur statique (SSG) via Astro
- **Islands Architecture** — React hydraté uniquement sur les composants interactifs (`client:load`, `client:idle`, `client:visible`)
- Images responsives (multiple tailles + WebP/AVIF)
- Sitemap auto-généré par `@astrojs/sitemap`

## ♿️ Accessibilité

Points critiques à respecter :

- HTML sémantique (`<nav>`, `<main>`, `<article>`)
- Attributs ARIA appropriés
- Navigation au clavier
- Contraste des couleurs
- Tests pa11y réguliers

## 🎨 Style et UI

### Tailwind CSS

- Approche utility-first stricte
- Organisation des classes par catégorie
- Préfixes responsive (`sm:`, `md:`, `lg:`)
- Palette de couleurs spécifique (sage, mint)

### Animations

- Utiliser `framer-motion` via `useMotionVariants`
- Animations légères et performantes
- Respecter `prefers-reduced-motion`

## 📝 Gestion du Blog

- Posts stockés dans `src/content/blog/` (fichiers Markdown avec frontmatter YAML)
- Schéma validé par Zod dans `src/content.config.ts`
- Rendu statique via `src/pages/blog/[slug].astro` + `entry.render()` + `<Content />`
- Island de filtrage/recherche : `src/components/islands/BlogClientWrapper.tsx`
- SEO optimisé pour chaque article (JSON-LD Article dans le head)

## 🚀 Workflow de Développement

1. Lire la documentation existante
2. Vérifier les conventions applicables
3. Développer avec TypeScript strict
4. Tester l'accessibilité
5. Optimiser les performances
6. Valider le rendu responsive

## ⚠️ Points d'Attention

- Messages d'erreur en français
- Commentaires techniques en anglais
- Vault (`omf-therapie`) à jour après changements majeurs
- Pas de CSS personnalisé (Tailwind uniquement)
- Tests pa11y avant chaque PR

## 🔄 Tests et Validation

Actuellement :
- Audits d'accessibilité automatisés
- Tests manuels des fonctionnalités
- Rapports Lighthouse

## 🌍 Internationalisation

- Site en français uniquement
- Messages utilisateur en français
- Documentation technique en anglais
- Commits en français

## 🔒 Sécurité

- Pas de données sensibles côté client
- HTTPS obligatoire
- Validation des formulaires côté client
- EmailJS pour les contacts

## 📈 Future Évolution

Domaines d'amélioration potentiels :
- Intégration CMS headless
- Support multilingue
- Système de newsletter
- Réservation en ligne
- Portail client
- Tests automatisés