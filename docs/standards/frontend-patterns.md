# Frontend Patterns

> Conventions for `src/components/`, `src/hooks/`, `src/layouts/`, and `src/pages/**.astro`. Astro Islands Architecture with React hydration.

## File organization

| Type | Location | Naming | Example |
|------|----------|--------|---------|
| Astro page | `src/pages/` | kebab-case `.astro` | `rendez-vous.astro` |
| Astro component | `src/components/{domain}/` | PascalCase `.astro` | `home/HeroSection.astro` |
| React island | `src/components/islands/` | PascalCase `.tsx` | `Navbar.tsx` |
| React component | `src/components/{domain}/` | PascalCase `.tsx` | `admin/AppointmentCard.tsx` |
| Hook | `src/hooks/` | camelCase, `use` prefix | `useContactForm.ts` |
| Layout | `src/layouts/` | PascalCase `.astro` | `ServiceLayout.astro` |
| Type | `src/types/` | camelCase `.ts` | `appointment.ts` |
| Util | `src/utils/` | camelCase `.ts` | `date.ts` |

**Co-locate by domain** (ADR-001): a feature's components live in `src/components/{domain}/`, not scattered. Top-level `src/components/*.{astro,tsx}` is legacy (`Footer.tsx`, `SEO.tsx`) — don't add new ones.

## Component structure (React)

```tsx
// 1. Imports: React → third-party → local
import { useState } from "react";
import { motion } from "framer-motion";
import { BlogPost } from "../types/blog";

// 2. Props interface
interface ComponentProps {
  title: string;
  onSubmit: () => void;
}

// 3. Function declaration (not arrow for exports)
export default function Component({ title, onSubmit }: ComponentProps) {
  // 4. Hooks
  const [state, setState] = useState("");
  // 5. Handlers (handle prefix)
  const handleClick = () => { /* ... */ };
  // 6. Effects
  useEffect(() => { /* ... */ }, []);
  // 7. Return JSX
  return <div>{/* ... */}</div>;
}
```

- **Function declarations** for exported components (not arrow functions).
- **Destructure props** in parameters; define `Props` interface.
- **Handler prefix:** `handle*` (`handleSubmit`, `handleClick`).

## Hydration directives

| Directive | Use when |
|-----------|----------|
| `client:load` | Above-fold, hydrate immediately (Navbar, contact form) |
| `client:idle` | Below-fold — **preferred default** |
| `client:visible` | Lazy on viewport entry — **avoid with `useMotionVariants`** (visible snap on mobile) |

Only `src/components/islands/*` (and React components reached through them) receive `client:*`.

## Styling (Tailwind)

- **Utility-first only.** No custom CSS except base styles in `src/index.css`.
- **No inline styles** except for dynamic values.
- **Class organization** (order matters for readability):
  ```tsx
  <div className="
    flex flex-col           // Layout
    p-4 gap-2              // Spacing
    text-lg font-semibold  // Typography
    bg-white text-gray-900 // Colors
    md:flex-row md:p-6     // Responsive
  " />
  ```
- **Dark mode:** not implemented. Don't add `dark:` variants.

## Animation (`framer-motion`)

- Use `useMotionVariants` hook (respects `prefers-reduced-motion`).
- **Touch / WKWebView** (iOS Messages): animations auto-disabled — hook returns `staticProps` (no IntersectionObserver, no WAAPI).
- **Continuous animations** (spinners): use Tailwind `animate-spin` — **never** framer-motion.
- Disable on `hover: none` + `pointer: coarse` devices.

## Routing & links

- Astro file-based: each `.astro` in `src/pages/` = one URL.
- **Trailing slash required** on every client-side URL (ADR-013): `<a href="/services/">`, `fetch("/api/foo/")`, `window.location.href = "/mes-rdvs/"`.
- Legacy SPA paths (`/Tarifs`, `/Services`, `/About`, `/Process`, `/Formations`) are redirected in `netlify.toml` — don't recreate them.
- Sitemap filter in `astro.config.mjs` excludes those legacy paths.

## State management

- **No global state library.** `useState` + custom hooks + props drilling (sufficient at current scale).
- Persistence: `sessionStorage['mes-rdvs-filter']` for admin filter state. Match this pattern for ephemeral UI state.

## Accessibility (WCAG 2.1 AA — mandatory)

- **Semantic HTML:** `<nav>`, `<main>`, `<article>`, `<section>` — not `<div>` soup.
- **ARIA:** `aria-label` on icon buttons, `aria-labelledby`/`aria-describedby` for complex labels.
- **Keyboard:** logical tab order, visible focus indicators, skip-links for main content.
- **Alt text:** descriptive for meaningful images, empty `alt=""` for decorative.
- **Test before PR:** `npm run audit:a11y` (pa11y, needs dev server running).

## AI Quick Reference

- **ALWAYS** co-locate components in `src/components/{domain}/` — never top-level `src/components/`.
- **ALWAYS** use function declarations for exported React components (not arrow).
- **ALWAYS** end internal links/fetches with a trailing `/` (ADR-013).
- **PREFER** `client:idle` for below-fold islands; avoid `client:visible` with `useMotionVariants`.
- **NEVER** add `dark:` Tailwind variants (dark mode not implemented).
- **NEVER** use framer-motion for continuous animations — use Tailwind `animate-spin`.
- **NEVER** use inline styles except for dynamic values; no custom CSS outside `src/index.css`.
- **ALWAYS** use semantic HTML + ARIA + keyboard nav + alt text; run `npm run audit:a11y` before UI PRs.
- **ALWAYS** write user-facing text in **French**; code/types/comments in English.
- **ORGANIZE** Tailwind classes: layout → spacing → typography → colors → responsive.
