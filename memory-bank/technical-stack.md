# Technical Stack

**Last Updated:** July 5, 2026

> ⚠️ **Note de révision** — ce fichier décrivait la stack React SPA d'origine (React Router, Vite direct, React Helmet, `port 5173`). La migration vers **Astro 5 SSG + Islands** a remplacé toute cette stack. Voir aussi `CLAUDE.md`, `AGENTS.md`, et `docs/architecture/` pour la source de vérité actuelle.

## Core Framework

- **Astro 5.18+** — Static Site Generation (SSG) par défaut, SSR hybride pour les routes API via l'adaptateur Netlify. Une page `.astro` = une URL.
- **TypeScript 5.5+** — mode strict, pas de `any`.
- **Islands Architecture** — rendu serveur par défaut, React hydraté uniquement où l'interactivité est nécessaire (`client:load`, `client:idle`, `client:visible`).

> L'ancienne stack `Vite direct + React Router + React Helmet` est **supprimée**. Les alias `vite.config` (`astro.config.mjs`) neutralisent `react-router-dom` et `react-helmet-async` (legacy non installés) — ne pas les réintroduire.

## Frontend

- **React 18** — utilisé uniquement pour les îles hydratées (`src/components/islands/`).
- **Tailwind CSS 3.4** — utility-first uniquement ; pas de CSS personnalisé hors `src/index.css`. Pas de dark mode.
- **framer-motion 11** — animations via le hook `useMotionVariants` (désactivé sur touch/WKWebView). **Jamais** pour les animations continues (utiliser Tailwind `animate-spin`).
- **Lucide React** — icônes.
- **react-hot-toast** — notifications.
- **date-fns 4** — utilitaires de dates.

## Backend / Data

- **Pas d'ORM** (stack.yml: `orm: none`). SQL brut via `@supabase/supabase-js` (PostgREST) ou `pg`.
- **Supabase / PostgreSQL 16** — base de données principale. Migrations dans `supabase/migrations/` (`001_init.sql` → `008_credits.sql`).
- **BetterAuth 1.6** — authentification session-based, backend PostgreSQL. **Monocompte** (une seule praticienne ; le hook `beforeUserCreated` bloque toute inscription).
- **Stripe** — Payment Links uniquement pour `appointment_mode = 'video'` (ADR-014). Avoirs internes plutôt que refunds (ADR-015).
- **Google Calendar / Meet API** — créneaux + liens Meet (`googleapis`). `GOOGLE_CALENDAR_MOCK=true` en dev (créneaux fictifs le mercredi).
- **Resend** — transport email prod (templates React Email). **Nodemailer → Mailpit** en dev local.

## Build & Deploy

- **Build :** `npm run build` (`astro build` → `dist/`).
- **Dev server :** `npm run dev` — port **4321** (Astro), pas 5173 (Vite direct n'est plus utilisé).
- **Adaptateur :** `@astrojs/netlify` — génère `_redirects` + edge functions pour les routes SSR.
- **Plateforme :** Netlify (auto-déploiement depuis `main`).
- **CI gate** (`.github/workflows/ci.yml`, PR #85) : `lint → test → build` bloquant ; `typecheck` advisory (issue #68 trace les ~20 erreurs résiduelles).
- **Node :** 20 (`.nvmrc`, correspond à `netlify.toml`).

## Tooling

- **ESLint 9** — flat config (`eslint.config.js`).
- **Vitest** — tests unitaires / intégration (`tests/unit/**`, env `node`).
- **Playwright** — tests e2e (`e2e/*.spec.ts`).
- **pa11y + Lighthouse** — audits accessibilité WCAG 2.1 AA (`npm run audit:a11y`). **Requis avant tout PR UI.**
- **Astro Content Collections** — blog Markdown validé par Zod (`src/content.config.ts`).

## Env vars (Astro `import.meta.env.*`)

Voir `docs/INFRA.md` (prod) et `docs/LOCAL_DEV.md` (local). Variables critiques : `DATABASE_URL`, `SUPABASE_*`, `BETTER_AUTH_*`, `STRIPE_*`, `RESEND_*`, `SMTP_*`, `GOOGLE_CALENDAR_*` / `GOOGLE_OAUTH_*`, `SITE_URL`.

## Conventions clés

- **Trailing slash obligatoire** sur toute URL côté client (ADR-013) — `fetch("/api/foo/")`, `window.location.href = "/mes-rdvs/"`.
- **Langue :** code/types/commentaires en anglais ; texte utilisateur et emails en **français** ; commits en **français présent**.
- **Statuts RDV :** `pending → confirmed | declined | rescheduled → payment_pending → payment_received | cancelled`. `payment_received` = « réglé » (Stripe **ou** avoir).
- **Avoirs internes** (#63/#66) : pas de Stripe refund — émission via `credits`/`credit_usages`, RPC FIFO `consume_credits`/`restore_credits`. Admin-only.

## Références

- `CLAUDE.md` — instructions détaillées pour agents.
- `AGENTS.md` — couche quick-reference (domaines, conventions critiques, gotchas).
- `docs/architecture/index.md` — conception système + couches + domaines.
- `docs/architecture/patterns.md` — patterns de code + AI Quick Reference.
- `memory-bank/decisions.md` — ADRs (ADR-001 à ADR-016).
