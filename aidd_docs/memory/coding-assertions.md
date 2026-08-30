# Coding Assertions

## Before commit

| Order | Command | Checks |
| --- | --- | --- |
| 1 | `npm run lint` | ESLint rules |
| 2 | `npm run test` | Unit and integration behavior |

When running these assertions through WSL automation, use the sequential, mono-worker commands in `testing.md`; do not launch gates in parallel.

## Before push

| Order | Command | Checks |
| --- | --- | --- |
| 1 | `npm run typecheck` | Astro and TypeScript types |
| 2 | `npm run build` | Production static build |

## UI changes

- Run `npm run audit:a11y` with the development server running; WCAG 2.1 AA is required.
