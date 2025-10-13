# Instructions pour les agents AI Copilot

**Dernière mise à jour :** 14 octobre 2025

## 🎯 Aperçu du Projet

OMF Therapie est un site web professionnel pour une praticienne en thérapie, construit avec React et TypeScript. Le site met l'accent sur :

- L'accessibilité (conformité WCAG)
- Les performances (optimisations Vite)
- Le contenu éducatif (système de blog)
- Le contact et la prise de rendez-vous
- L'expérience utilisateur responsive

## 📚 Documentation Essentielle

Avant toute nouvelle conversation ou modification, consultez impérativement les fichiers suivants dans `/memory-bank/` :

- `project-overview.md` - Vue d'ensemble et objectifs
- `architecture.md` - Structure et patterns techniques
- `conventions.md` - Standards de code et bonnes pratiques
- `decisions.md` - Historique des choix techniques

## 🏗 Architecture du Projet

```
omf-therapie/
├── src/
│   ├── components/     # Composants React organisés par domaine
│   ├── config/         # Configuration globale
│   ├── hooks/          # Hooks React personnalisés
│   ├── pages/         # Composants de pages/routes
│   ├── types/         # Définitions TypeScript
│   └── utils/         # Utilitaires et contenu blog
├── public/            # Assets statiques et rapports
└── memory-bank/       # Documentation technique
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

- React Router avec scroll automatique aux sections
- Routes lazy-loadées
- Navigation basée sur les ancres pour les sections

### Performance

- Code splitting au niveau des routes
- Images responsives (multiple tailles + WebP/AVIF)
- Bundle optimisé via Vite

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

- Posts stockés dans `src/utils/blogs/`
- Interfaces dans `src/types/blog.ts`
- Markdown parsé via `html-react-parser`
- SEO optimisé pour chaque article

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
- Documentation du `memory-bank` à jour
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