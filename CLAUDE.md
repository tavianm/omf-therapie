# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OMF Therapie is a professional therapy practice website built with React and TypeScript. The site emphasizes accessibility (WCAG 2.1 AA compliance), performance optimization, and educational content through a blog system.

**Tech Stack:** React 18 + TypeScript + Vite + React Router + Tailwind CSS

## Essential Documentation

Project knowledge is stored in the **vault** (namespace: `omf-therapie`). Query it before making changes:

```bash
vault search "architecture"        # System architecture and data flow
vault search "conventions"         # Code style and patterns
vault search "ADR decisions"       # Architectural decision records
vault search "project overview"    # Business context and goals
vault list --namespace omf-therapie  # All entries
```

Entries: Project Overview · Architecture · Coding Conventions · Architectural Decision Records · Technical Stack · Active Context

## Common Commands

### Development
```bash
npm run dev              # Start dev server (Vite)
npm run build            # Production build
npm run preview          # Preview production build locally
npm run lint             # Run ESLint
```

### Accessibility Audits
```bash
npm run audit:a11y       # Run pa11y accessibility audit (generates reports in public/reports/latest/)
npm run audit:lighthouse # Run Lighthouse accessibility audit
```

### Deployment
```bash
npm run predeploy        # Runs build before deploy
npm run generate-sitemap # Generate sitemap.xml
```

## Architecture & Patterns

### Routing System

The app uses a **section-based navigation** pattern where multiple URL paths map to sections on the Home page:

```typescript
// In App.tsx - pathToSectionMap
"/Tarifs" → scrolls to #pricing section
"/Services" → scrolls to #services section
"/About" → scrolls to #about section
"/Process" → scrolls to #process section
"/Formations" → scrolls to #qualifications section
```

This is handled by `AutoScrollHandler` component which:
1. Listens to route changes
2. Maps URL path to section ID
3. Smoothly scrolls to the target section

**Dedicated routes:**
- `/contact` - Contact page
- `/blog` - Blog listing with pagination/search
- `/blog/:slug` - Individual blog post
- `/accessibilite` - Accessibility statement

### Blog System

Blog posts are **static TypeScript modules** (not CMS-based):

1. **Post Storage:** Each blog post is a TypeScript file in `src/utils/blogs/`
2. **Central Registry:** `src/utils/blogs/index.ts` exports all blog posts
3. **Data Layer:** `src/utils/blogApi.ts` provides simulated API functions (filtering, pagination, search)
4. **Custom Hooks:**
   - `useBlogPosts` - Fetches, filters, paginates blog posts
   - `useBlogPost` - Fetches single post by slug
5. **Type Definitions:** `src/types/blog.ts` defines BlogPost interface

**Adding a new blog post:**
1. Create new file in `src/utils/blogs/your-post-slug.ts`
2. Export BlogPost object with required fields
3. Add to the exports in `src/utils/blogs/index.ts`
4. Update `BLOG_POSTS` array in `src/utils/blog-list.ts`

### Component Organization

```
src/components/
├── blog/           # Blog-specific components (BlogPostCard, BlogList, etc.)
├── common/         # Shared components (ContactItem, SuspenseFallback)
├── contact/        # Contact page components (ContactForm, ContactInfo)
├── footer/         # Footer sub-components (FooterBrand, FooterLinks)
├── home/           # Home page sections (HeroSection, IntroSection)
├── navigation/     # Navigation components (Navbar, DesktopNav, MobileNav)
└── pricing/        # Pricing page components (PriceCard, PaymentInfo)
```

### Custom Hooks

- `useBlogPosts` - Blog listing with search/pagination/filtering
- `useBlogPost` - Single blog post retrieval by slug
- `useContactForm` - Contact form state and EmailJS submission
- `useScrollToSection` - Smooth scroll to page sections
- `useMotionVariants` - Framer Motion animation variants (respects prefers-reduced-motion)
- `useClipboard` - Copy to clipboard functionality

### State Management

**No global state library** (Redux, Zustand, etc.) - using React hooks only:
- Component state: `useState`
- Reusable logic: Custom hooks
- Data flow: Props drilling (sufficient for current complexity)

### Configuration

- **Global config:** `src/config/global.config.ts` (site metadata, EmailJS keys)
- **Footer links:** `src/config/footer.config.ts` (footer navigation structure)

## Code Conventions

### Language
- **Code & Types:** English
- **User-facing text:** French
- **Commit messages:** French (present tense: "Ajoute" not "Ajouté")
- **Comments:** English for technical, French acceptable for business logic

### File Naming
- **Components:** PascalCase (`BlogPostCard.tsx`)
- **Utilities:** camelCase (`blogApi.ts`)
- **Hooks:** camelCase with "use" prefix (`useBlogPost.ts`)
- **Types:** camelCase (`blog.ts`, `navigation.ts`)

### Component Structure
```typescript
// 1. Imports (React → third-party → local)
import { useState } from "react";
import { motion } from "framer-motion";
import { BlogPost } from "../types/blog";

// 2. Type definitions
interface Props {
  title: string;
}

// 3. Component (function declaration, not arrow)
export default function Component({ title }: Props) {
  // 4. Hooks
  const [state, setState] = useState();

  // 5. Handlers (prefix with "handle")
  const handleClick = () => {};

  // 6. Effects
  useEffect(() => {}, []);

  // 7. Return JSX
  return <div />;
}
```

### TypeScript
- **Strict mode enabled** - no `any` types
- **Interfaces** for object shapes
- **Types** for unions/primitives
- Optional chaining: `user?.profile?.name`
- Nullish coalescing: `title ?? 'Default'`

### Styling (Tailwind CSS)
- **Utility-first only** - no custom CSS except in `src/index.css` for base styles
- **No inline styles** except for dynamic values
- **Organize classes** by category: layout → spacing → typography → colors → responsive

```tsx
<div className="
  flex flex-col           // Layout
  p-4 gap-2              // Spacing
  text-lg font-semibold  // Typography
  bg-white text-gray-900 // Colors
  md:flex-row md:p-6     // Responsive
" />
```

### Accessibility Requirements
- **Semantic HTML:** Use `<nav>`, `<main>`, `<article>`, `<section>` (not `<div>` soup)
- **ARIA attributes:** Label icon buttons, use role/aria-describedby appropriately
- **Keyboard navigation:** Logical tab order, visible focus indicators
- **Alt text:** Descriptive for meaningful images, empty `alt=""` for decorative
- **Test before PR:** Run `npm run audit:a11y` to verify compliance

## Performance Optimizations

### Code Splitting
- **Route-level lazy loading** with `React.lazy()`:
  ```typescript
  const Home = lazy(() => import("./pages/Home"));
  ```
- **Suspense boundaries** with `<SuspenseFallback />` component

### Build Configuration (vite.config.ts)
- **Manual chunks:** Splits vendor libraries (react, framer-motion, etc.)
- **Terser minification:** Drops console logs in production
- **CSS code splitting:** Enabled for better caching
- **Asset inlining:** Files <4KB inlined as base64

### Images
- Use responsive images with multiple sizes
- Prefer modern formats (WebP, AVIF)
- Lazy load below-fold images

## Contact Form

Uses **EmailJS** for client-side email sending (no backend):
- Configuration in `src/config/global.config.ts`
- Form logic in `src/hooks/useContactForm.ts`
- Email template configured in EmailJS dashboard
- Toast notifications for user feedback (react-hot-toast)

## Accessibility Testing

### Automated Audits
```bash
npm run audit:a11y      # Pa11y audit (WCAG 2.1 AA)
npm run audit:lighthouse # Lighthouse accessibility score
```

Reports saved to `public/reports/latest/` with:
- HTML index with summary table
- JSON files per URL with detailed issues

### Manual Testing
- Keyboard navigation (Tab, Enter, Escape)
- Screen reader testing (recommended)
- Color contrast verification

## Common Tasks

### Adding a Blog Post
1. Create `src/utils/blogs/your-slug.ts`:
   ```typescript
   import { BlogPost } from "../../types/blog";

   export const yourPost: BlogPost = {
     id: "unique-id",
     title: "Post Title",
     slug: "your-slug",
     excerpt: "Brief summary...",
     content: `<p>HTML content...</p>`,
     date: "14 janvier 2025",
     categories: ["Category"],
     author: { name: "...", title: "..." }
   };
   ```
2. Export from `src/utils/blogs/index.ts`
3. Add to `BLOG_POSTS` array in `src/utils/blog-list.ts`

### Modifying Navigation
- Desktop nav: `src/components/navigation/DesktopNav.tsx`
- Mobile nav: `src/components/navigation/MobileNav.tsx`
- Nav items: `src/components/navigation/NavigationItems.tsx`
- Section mapping: Update `pathToSectionMap` in `src/App.tsx`

### Updating Footer
- Links structure: `src/config/footer.config.ts`
- Footer sections: Individual components in `src/components/footer/`

## Important Notes

### French Language Project
- User-facing content in French (error messages, labels, etc.)
- Commit messages in French present tense
- Code/documentation in English

### Accessibility First
- WCAG 2.1 AA compliance mandatory
- Test before committing changes
- Semantic HTML enforced
- pa11y audits must pass

### No Over-Engineering
- Keep solutions simple and focused
- Don't add features beyond requirements
- Don't create abstractions for one-time use
- Don't add error handling for impossible scenarios

### Deployment
- **Platform:** Netlify (automatic deployment from main branch)
- **Build command:** `npm run build`
- **Publish directory:** `dist/`
- **Custom domain:** Configured via CNAME in public/

### Git Workflow
- **Main branch:** Production-ready code
- **Commit format:** French, descriptive, present tense
- **Co-authored commits:** Standard practice for AI pair programming

## Future Considerations

Potential enhancements (not currently implemented):
- Headless CMS for blog (e.g., Strapi, Contentful)
- Multi-language support (i18n)
- Automated testing (Vitest + React Testing Library)
- Newsletter subscription system
- Online appointment booking integration
