# Coding Conventions

**Last Updated:** January 14, 2025

## Language & Tooling

### TypeScript

- **Version:** 5.5.3
- **Mode:** Strict type checking enabled
- **Configuration:** `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`

### Linting

- **ESLint 9.9.1** with TypeScript support
- React Hooks rules enforced
- React Refresh validation
- Configuration: `eslint.config.js`

## File Naming Conventions

### Components

- **PascalCase** for component files: `Navbar.tsx`, `BlogPostCard.tsx`
- Match component name to filename
- Example: `export default function Navbar()` in `Navbar.tsx`

### Utilities & Hooks

- **camelCase** for utility files: `blogApi.ts`, `blog-list.ts`
- **Hooks:** `useBlogPost.ts`, `useContactForm.ts`
- Prefix custom hooks with `use`

### Types

- **camelCase** for type definition files: `blog.ts`, `contact.ts`, `navigation.ts`

### Configuration

- **kebab-case** or **camelCase**: `footer.config.ts`, `global.config.ts`

## Code Organization

### Component Structure

```typescript
// 1. Imports - React first, then third-party, then local
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BlogPost } from "../types/blog";

// 2. Type definitions (if needed)
interface ComponentProps {
  title: string;
  onSubmit: () => void;
}

// 3. Component definition
export default function Component({ title, onSubmit }: ComponentProps) {
  // 4. Hooks
  const [state, setState] = useState("");

  // 5. Handlers
  const handleClick = () => {
    // ...
  };

  // 6. Effects
  useEffect(() => {
    // ...
  }, []);

  // 7. Render
  return <div>{/* JSX */}</div>;
}
```

### Import Order

1. React core imports
2. Third-party libraries
3. Internal components
4. Internal hooks
5. Internal utils
6. Types
7. Config

## Component Guidelines

### Functional Components

- **Use function declarations** (not arrow functions for exports)
- **Default exports** for page and main components
- **Named exports** acceptable for utilities and helpers

### Props

- **Destructure props** in function parameters
- **Define TypeScript interfaces** for props
- **Explicit prop types** - no implicit any

### State Management

- **useState** for component state
- **Custom hooks** for reusable logic
- **Props drilling** acceptable for simple cases (no context needed yet)

### Event Handlers

- **Prefix with `handle`**: `handleSubmit`, `handleClick`
- **Define inline** for simple handlers
- **Extract to functions** for complex logic

## Styling Conventions

### Tailwind CSS

- **Utility-first approach**
- **Responsive prefixes**: `sm:`, `md:`, `lg:`, `xl:`, `2xl:`
- **Hover/focus states**: `hover:`, `focus:`
- **Dark mode**: Not currently implemented

### Class Organization

```tsx
<div
  className="
  // Layout
  flex flex-col
  
  // Spacing
  p-4 gap-2
  
  // Typography
  text-lg font-semibold
  
  // Colors
  bg-white text-gray-900
  
  // Responsive
  md:flex-row md:p-6
"
/>
```

### Component-Level Styles

- **Tailwind utilities preferred** over custom CSS
- **Global styles** in `src/index.css` only for base/reset
- **No inline styles** except for dynamic values

## TypeScript Conventions

### Type Definitions

- **Interfaces** for object shapes
- **Types** for unions, intersections, primitives
- **Export types** from `/src/types/` directory

### Type Safety

```typescript
// ✅ Good - Explicit types
interface BlogPost {
  id: string;
  title: string;
  slug: string;
}

// ✅ Good - Type inference
const posts = blogPosts.filter((p) => p.published);

// ❌ Avoid - any type
const data: any = fetchData();
```

### Null Handling

- **Optional chaining**: `user?.profile?.name`
- **Nullish coalescing**: `title ?? 'Default Title'`
- **Explicit undefined checks** when needed

## React Patterns

### Lazy Loading

```typescript
const Component = lazy(() => import("./pages/Component"));

// Wrap in Suspense
<Suspense fallback={<SuspenseFallback />}>
  <Component />
</Suspense>;
```

### Custom Hooks

```typescript
export function useCustomHook() {
  const [state, setState] = useState();

  // Logic here

  return { state, setState };
}
```

### Conditional Rendering

```tsx
// ✅ Preferred
{
  isVisible && <Component />;
}
{
  count > 0 ? <List /> : <EmptyState />;
}

// ❌ Avoid
{
  isVisible === true && <Component />;
}
```

## Accessibility Standards

### Semantic HTML

- **Use semantic elements**: `<nav>`, `<main>`, `<article>`, `<section>`
- **Avoid `<div>` soup** - use appropriate elements

### ARIA Attributes

- **aria-label** for icon buttons
- **aria-labelledby** for complex labels
- **aria-describedby** for additional context
- **role** attributes when semantic HTML isn't enough

### Keyboard Navigation

- **Logical tab order** - use tabIndex sparingly
- **Focus indicators** - visible focus styles
- **Skip links** for main content

### Alt Text

- **Descriptive alt text** for meaningful images
- **Empty alt=""** for decorative images

## Error Handling

### Try-Catch Blocks

```typescript
try {
  await riskyOperation();
} catch (error) {
  console.error("Operation failed:", error);
  toast.error("Something went wrong");
}
```

### Form Validation

- **Client-side validation** before submission
- **Clear error messages** for users
- **Prevent submission** on validation errors

## Comments

### When to Comment

- **Complex logic** that isn't self-explanatory
- **Workarounds** or temporary solutions
- **TODO items** for future improvements
- **French comments** acceptable for business logic

### What Not to Comment

- **Obvious code** that explains itself
- **Type information** (use TypeScript instead)
- **Outdated comments** - remove or update

### Format

```typescript
// Single-line comments for brief explanations

/**
 * Multi-line JSDoc comments for:
 * - Functions with complex parameters
 * - Exported utilities
 * - Type definitions
 */
```

## Git Conventions

### Commit Messages

- **French language** for commit messages (project convention)
- **Descriptive commits** explaining what and why
- **Present tense**: "Ajoute" not "Ajouté"

### Branch Strategy

- **main** branch for production
- Feature branches for development (if needed)

## Performance Best Practices

### Component Optimization

- **Lazy load routes** with React.lazy()
- **Code splitting** at route level
- **Avoid premature optimization** - measure first

### Asset Optimization

- **Responsive images** with multiple sizes
- **Modern formats**: WebP, AVIF
- **Lazy loading** for below-fold images

### Bundle Size

- **Monitor bundle size** during builds
- **Tree-shaking** via ES modules
- **Remove unused imports**

## Testing Conventions

### Current State

- **No automated tests** currently implemented
- **Manual testing** for features
- **Accessibility audits** via pa11y and Lighthouse

### Future Recommendations

- **Vitest** for unit tests
- **React Testing Library** for component tests
- **E2E tests** with Playwright/Cypress

## Documentation

### Code Documentation

- **Self-documenting code** preferred over extensive comments
- **README files** for major features or complex modules
- **Memory bank** for architectural decisions and conventions

### API Documentation

- **JSDoc comments** for exported functions/utilities
- **Type definitions** serve as inline documentation
- **Examples in comments** for complex functions
