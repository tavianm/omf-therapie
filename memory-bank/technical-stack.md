# Technical Stack

**Last Updated:** January 14, 2025

## Core Technologies

### Frontend Framework

- **React 18.3.1** - Modern UI library with hooks and concurrent features
- **TypeScript 5.5.3** - Type-safe JavaScript with enhanced IDE support
- **Vite 5.4.2** - Fast build tool and dev server with HMR

### Routing

- **React Router DOM 6.22.3** - Client-side routing with future flags enabled
  - `v7_startTransition` - Smooth transitions
  - `v7_relativeSplatPath` - Improved path resolution

### Styling

- **Tailwind CSS 3.4.1** - Utility-first CSS framework
- **PostCSS 8.4.35** - CSS transformations
- **Autoprefixer 10.4.18** - Vendor prefix automation
- **@tailwindcss/typography 0.5.10** - Beautiful typographic defaults
- **@tailwindcss/line-clamp 0.4.4** - Multi-line text truncation

### UI Components & Icons

- **Lucide React 0.344.0** - Beautiful open-source icon library
- **Framer Motion 11.0.8** - Production-ready animation library

### Forms & Communication

- **@emailjs/browser 4.3.3** - Client-side email sending service
- **React Hot Toast 2.4.1** - Notification/toast system

### SEO & Meta

- **React Helmet Async 2.0.4** - Dynamic head management for SEO

### Utilities

- **date-fns 4.1.0** - Modern date utility library
- **html-react-parser 5.2.2** - HTML string to React component parser

## Development Tools

### Code Quality

- **ESLint 9.9.1** - JavaScript/TypeScript linting
- **@eslint/js** - ESLint JavaScript configs
- **eslint-plugin-react-hooks** - React Hooks linting rules
- **eslint-plugin-react-refresh** - React Fast Refresh validation
- **TypeScript ESLint 8.3.0** - TypeScript-specific linting

### Build Optimization

- **Terser 5.38.1** - JavaScript minification
- **cssnano 6.0.5** - CSS minification and optimization

### Accessibility Auditing

- **pa11y 9.0.1** - Automated accessibility testing
- **pa11y-ci 4.0.1** - CI/CD accessibility testing
- **pa11y-reporter-html 2.0.0** - HTML report generation
- **Lighthouse 12.8.2** - Performance and accessibility auditing

### Type Definitions

- **@types/react 18.3.5** - React TypeScript definitions
- **@types/react-dom 18.3.0** - React DOM TypeScript definitions

## Architecture Patterns

### Component Organization

- **Lazy Loading** - Routes loaded on demand for better performance
- **Code Splitting** - Automatic via Vite and React.lazy()
- **Suspense Boundaries** - Graceful loading states

### State Management

- **React Hooks** - useState, useEffect, custom hooks
- **No external state library** - Props and context for simple state needs

### Styling Approach

- **Utility-First** - Tailwind CSS for rapid development
- **Component-Scoped** - Styles defined per component
- **Responsive-First** - Mobile-first breakpoint system

### Type Safety

- **Strict TypeScript** - Full type coverage across codebase
- **Interface Definitions** - Clear type contracts in /src/types/

## Build & Deployment

### Build Process

- **Bundler:** Vite with React plugin (@vitejs/plugin-react 4.3.1)
- **Output:** Static files to `dist/` directory
- **Optimization:** Tree-shaking, minification, code splitting

### Development

- **Dev Server:** Vite dev server with HMR
- **Port:** Default (5173) or configured
- **Preview:** `npm run preview` for production build testing

### Scripts Available

```json
{
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "generate-sitemap": "node generate-sitemap.js",
  "audit:a11y": "node scripts/run-a11y-audit.mjs",
  "audit:lighthouse": "lighthouse https://omf-therapie.fr ..."
}
```

## Browser Support

- Modern browsers with ES6+ support
- Based on Vite's default targets
- No legacy browser support needed

## Performance Considerations

- Route-based code splitting
- Lazy loaded components
- Optimized images and assets
- CSS purging via Tailwind
- Minified production builds

## Accessibility Standards

- WCAG 2.1 AA compliance target
- Automated testing with pa11y
- Lighthouse accessibility audits
- Semantic HTML structure
- ARIA attributes where needed
