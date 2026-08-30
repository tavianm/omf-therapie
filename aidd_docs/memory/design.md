# Design

## System

- Tailwind utility classes are the styling system; custom CSS is limited to base styles in `src/index.css`.
- Order utilities by layout, spacing, typography, colors, then responsive variants.

## Components

- Astro renders static UI by default; React is reserved for interactive islands.
- Prefer `client:idle` below the fold and avoid `client:visible` with motion variants.

## Accessibility

- WCAG 2.1 AA is mandatory: semantic HTML, usable keyboard paths, visible focus, and meaningful image alternatives.
- Run Pa11y before UI pull requests.
