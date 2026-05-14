# Architectural Decision Records

**Last Updated:** May 14, 2026

This document tracks significant architectural and technical decisions made during the project. Each decision includes context, options considered, and rationale.

## Decision Log Format

Each decision entry should include:

- **Date:** When the decision was made
- **Context:** The situation requiring a decision
- **Decision:** What was decided
- **Rationale:** Why this option was chosen
- **Consequences:** Impact and trade-offs

---

## ADR-001: Static Blog System via Content Collections

**Date:** Early project phase (exact date unknown)

**Context:** Need to manage blog content for mental health articles

**Decision:** Implement blog posts as Markdown files in `src/content/blog/` via Astro Content Collections

**Rationale:**

- Simple deployment - no backend required
- Version controlled content
- Zod-validated frontmatter (type-safe)
- Fast page loads (static pre-render at build)
- Low maintenance overhead

**Consequences:**

- ✅ Zero runtime dependencies for blog
- ✅ Content changes tracked in Git
- ✅ Free hosting (static site)
- ❌ Non-technical users need dev knowledge to add posts
- ❌ Requires rebuild/redeploy for new content

**Note:** Initially implemented as TypeScript modules, migrated to Astro Content Collections (2025).

**Future Consideration:** May migrate to headless CMS if content volume grows

---

## ADR-002: Client-Side Email Service (EmailJS)

**Date:** Early project phase

**Context:** Need contact form functionality without backend server

**Decision:** Use EmailJS for client-side email sending

**Rationale:**

- No backend server needed
- Simple integration
- Free tier sufficient for expected volume
- HTTPS security via Netlify
- Reduces infrastructure complexity

**Consequences:**

- ✅ Zero server maintenance
- ✅ Quick implementation
- ✅ Cost-effective
- ❌ Email credentials exposed in client (mitigated by EmailJS API design)
- ❌ Limited to EmailJS service availability

---

## ADR-003: ~~React Router Future Flags~~ (OBSOLÈTE — React Router supprimé)

**Date:** Project setup → supprimé lors de la migration Astro (2025)

**Context:** Projet initialement en React SPA avec React Router v6. Migré vers Astro 5 file-based routing.

**Status:** ⚠️ OBSOLÈTE — React Router n'est plus utilisé dans le projet. Routing géré par Astro.

---

## ADR-004: Accessibility First Approach

**Date:** Project inception

**Context:** Need to ensure website accessible to all users

**Decision:** Implement WCAG 2.1 AA compliance with automated testing

**Rationale:**

- Legal and ethical responsibility
- Better UX for all users
- Therapy service should be inclusive
- Automated testing catches issues early
- Professional credibility

**Consequences:**

- ✅ pa11y and Lighthouse integrated
- ✅ Regular accessibility audits
- ✅ HTML reports for tracking
- ✅ Semantic HTML enforced
- ⏱️ Slight development overhead for ARIA attributes

---

## ADR-005: Tailwind CSS for Styling

**Date:** Project setup

**Context:** Choose CSS approach for rapid development

**Decision:** Tailwind CSS utility-first framework

**Rationale:**

- Rapid prototyping and development
- Consistent design system
- Responsive utilities built-in
- Excellent documentation
- Automatic CSS purging for production
- No CSS naming conflicts

**Consequences:**

- ✅ Fast development speed
- ✅ Small production CSS bundle
- ✅ Maintainable styling
- ❌ Utility class verbose in markup
- ❌ Learning curve for team members unfamiliar with utility-first

---

## ADR-006: TypeScript Strict Mode

**Date:** Project setup

**Context:** Choose type checking approach

**Decision:** Enable TypeScript strict mode

**Rationale:**

- Catch errors at compile time
- Better IDE support
- Self-documenting code through types
- Reduced runtime errors
- Industry best practice

**Consequences:**

- ✅ Fewer runtime bugs
- ✅ Better code quality
- ✅ Enhanced refactoring confidence
- ⏱️ Initial setup requires more time
- ⏱️ Slight learning curve

---

## ADR-007: ~~Vite Build Tool~~ (OBSOLÈTE — remplacé par Astro)

**Status:** ⚠️ OBSOLÈTE — Vite est toujours utilisé en interne par Astro, mais la configuration `vite.config.ts` directe est supprimée. Tout passe par `astro.config.mjs`.

---

## ADR-008: ~~Route-Based Code Splitting~~ (OBSOLÈTE — remplacé par Islands Architecture)

**Status:** ⚠️ OBSOLÈTE — Astro gère le code splitting automatiquement. React lazy() n'est plus utilisé pour le routing (remplacé par Astro pages + `client:*` directives pour les islands).

---

## ADR-010: ~~Section-Based Navigation~~ (OBSOLÈTE — remplacé par Astro routing)

**Status:** ⚠️ OBSOLÈTE — La navigation par sections + AutoScrollHandler SPA est remplacée par des pages Astro dédiées. Les liens de navigation pointent vers des URLs distinctes (`/services/therapie-individuelle/`, etc.). Les anciennes URLs SPA (`/Tarifs`, `/Services`) sont gérées par des redirects dans `netlify.toml`.

---

## ADR-011: Migration vers Astro 5 (Islands Architecture)

**Date:** 2025

**Context:** Le site React SPA avait des performances et un SEO sous-optimaux.

**Decision:** Migrer vers Astro 5 avec `output: 'static'` (SSG)

**Rationale:**

- Zéro JS livré par défaut (performances maximales)
- SEO optimal (HTML statique)
- Islands Architecture : React hydraté uniquement pour les composants interactifs
- Content Collections pour le blog (remplacement des modules TS)
- Compatible Netlify sans backend

**Consequences:**

- ✅ Lighthouse score proche de 100
- ✅ Pages statiques indexables
- ✅ Réduction drastique du bundle JS
- ⚠️ Migration des composants React → Astro + islands

---

## ADR-012: Booking System avec Supabase/PostgREST + BetterAuth

**Date:** 2025-2026

**Context:** Besoin d'un système de prise de rendez-vous avec authentication admin

**Decision:** PostgreSQL (via Supabase SDK) + BetterAuth pour les sessions

**Rationale:**

- `@supabase/supabase-js` compatible avec PostgREST en local (pas de Supabase cloud requis)
- BetterAuth offre des sessions PostgreSQL natives sans dépendance Supabase Auth
- Docker Compose regroupe Postgres + PostgREST pour le développement local
- Mailpit remplace les emails réels en développement

**Consequences:**

- ✅ Développement local 100% offline
- ✅ Pas de coût Supabase pour les envois d'emails
- ✅ Même SDK entre local et production
- ⚠️ Monocompte admin (hook `beforeUserCreated` bloque les inscriptions)

---

## ADR-013: trailingSlash: 'always' (Astro config)

**Date:** 2025-2026

**Context:** Astro configuré avec `trailingSlash: 'always'` pour compatibilité Netlify

**Decision:** Toutes les URLs se terminent par `/`

**Consequences:**

- ✅ URLs canoniques cohérentes
- ✅ Pas de redirects inutiles Netlify
- ⚠️ **CRITIQUE** : tout `fetch()` côté client ET tout `window.location.href` DOIVENT inclure le slash final — sinon Astro retourne une page HTML de redirection au lieu de JSON, causant des erreurs `Unexpected token '<'`

---

## ADR-014: Stripe uniquement pour les téléconsultations

**Date:** 2025-2026

**Context:** Choix du déclenchement du paiement en ligne

**Decision:** Stripe Payment Links uniquement pour `appointment_mode = 'video'`

**Rationale:**

- Séances en présentiel : paiement sur place (espèces/CB)
- Téléconsultations : prépaiement obligatoire pour confirmer le créneau
- Pas de terminal de paiement virtuel nécessaire

**Consequences:**

- ✅ Flux simplifié pour le présentiel
- ✅ Sécurité du créneau téléconsultation
- ⚠️ `STRIPE_SECRET_KEY` doit être configuré en production

---

## Future Decisions to Document

- Multi-language support approach (if implemented)
- Analytics platform choice (if added)
- CMS migration strategy (if needed)
- Performance monitoring tools
- Error tracking service
- Newsletter system integration
