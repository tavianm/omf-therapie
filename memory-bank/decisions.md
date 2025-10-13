# Architectural Decision Records

**Last Updated:** January 14, 2025

This document tracks significant architectural and technical decisions made during the project. Each decision includes context, options considered, and rationale.

## Decision Log Format

Each decision entry should include:

- **Date:** When the decision was made
- **Context:** The situation requiring a decision
- **Decision:** What was decided
- **Rationale:** Why this option was chosen
- **Consequences:** Impact and trade-offs

---

## ADR-001: Static Blog System vs CMS

**Date:** Early project phase (exact date unknown)

**Context:** Need to manage blog content for mental health articles

**Decision:** Implement blog posts as TypeScript modules in `src/utils/blogs/`

**Rationale:**

- Simple deployment - no backend required
- Version controlled content
- Type-safe blog metadata
- Fast page loads (no API calls)
- Low maintenance overhead
- Sufficient for current content volume

**Consequences:**

- ✅ Zero runtime dependencies for blog
- ✅ Content changes tracked in Git
- ✅ Free hosting (static site)
- ❌ Non-technical users need dev knowledge to add posts
- ❌ Requires rebuild/redeploy for new content

**Future Consideration:** May migrate to headless CMS if content volume grows or non-technical contributors need access

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

## ADR-003: React Router Future Flags

**Date:** Project setup

**Context:** React Router v6 preparing for v7 migration

**Decision:** Enable v7 future flags (`v7_startTransition`, `v7_relativeSplatPath`)

**Rationale:**

- Prepare for future React Router version
- Smoother transitions with startTransition
- Improved path resolution
- Opt-in early to avoid breaking changes later

**Consequences:**

- ✅ Future-proof routing implementation
- ✅ Smoother UI transitions
- ✅ Easier v7 migration when available
- ⚠️ Requires understanding of new behaviors

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

## ADR-007: Vite Build Tool

**Date:** Project setup

**Context:** Choose build tool and development server

**Decision:** Use Vite over Create React App or webpack

**Rationale:**

- Extremely fast HMR
- Modern ESM-based approach
- Simple configuration
- Excellent React support via plugin
- Better performance than CRA
- Active development and community

**Consequences:**

- ✅ Sub-second dev server start
- ✅ Lightning-fast HMR
- ✅ Optimized production builds
- ✅ Modern tooling
- ⚠️ Different from CRA (less common in older tutorials)

---

## ADR-008: Route-Based Code Splitting

**Date:** Project setup

**Context:** Optimize initial bundle size

**Decision:** Implement lazy loading at route level

**Rationale:**

- Reduce initial JS bundle
- Faster first paint
- User only downloads code for visited routes
- React.lazy() built-in support
- Automatic with Vite

**Consequences:**

- ✅ Smaller initial bundle
- ✅ Faster page loads
- ✅ Better Core Web Vitals
- ⚠️ Small delay on route navigation (mitigated with Suspense)

---

## ADR-009: No State Management Library

**Date:** Project architecture phase

**Context:** Determine if external state management needed

**Decision:** Use React hooks and props only, no Redux/Zustand/etc.

**Rationale:**

- Application state is simple
- Most data is static (blog posts)
- Contact form state is local
- No complex state sharing needed
- Reduces bundle size
- Simpler architecture

**Consequences:**

- ✅ Simpler codebase
- ✅ Smaller bundle
- ✅ Less boilerplate
- ⚠️ May need to revisit if app grows complex

---

## ADR-010: Section-Based Navigation

**Date:** Early development

**Context:** Multiple menu items pointing to sections on home page

**Decision:** Map URL paths to home page sections with auto-scroll

**Rationale:**

- Better UX than anchor links
- Cleaner URLs
- SEO-friendly paths
- Allows direct linking to sections
- Maintains SPA feel

**Consequences:**

- ✅ Professional URL structure
- ✅ Shareable section links
- ✅ Smooth scroll behavior
- ⚠️ Custom AutoScrollHandler component needed

---

## Future Decisions to Document

- Multi-language support approach (if implemented)
- Analytics platform choice (if added)
- CMS migration strategy (if needed)
- Performance monitoring tools
- Error tracking service
- Newsletter system integration
