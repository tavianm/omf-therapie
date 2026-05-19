---
issue: 34
title: "fix: mobile regressions — transitions not triggered, text missing/misrendered"
tier: F-lite
status: implemented
pr: 35
---

## Goal

Fix permanently-invisible text on mobile devices caused by a framer-motion SSR/hydration mismatch introduced in commit `1f8a792`.

## Context

`src/hooks/useMotionVariants.ts` is used by 11 React island components across the site. It returns framer-motion props for `motion.div` elements.

Commit `1f8a792` added `shouldDisableAnimations()` which returns `true` on touch devices (`hover: none` + `pointer: coarse`) and on `prefers-reduced-motion`. When disabled, it returns `staticProps = { initial: false }`.

**The bug**: During Astro SSR, `window` is undefined so `shouldDisableAnimations()` returns `false`, causing framer-motion to inline `opacity: 0; transform: translateY(20px)` into the HTML. On mobile hydration, `staticProps = { initial: false }` tells framer-motion to inherit the DOM state (`opacity: 0`) without providing an `animate` target. Elements stay permanently invisible.

Affected islands: `HeroSection`, `IntroSection`, `AboutSection`, `ServicesSection`, `ProcessSection`, `QualificationsSection`, `PricingSection`, `CommitmentSection`, `CTASection`, `PaymentInfo`, `BlogHeader`.

Static Astro pages (service pages, a-propos, legal pages) are **not** affected — they have no React islands.

## Acceptance Criteria

- [x] AC1 — On a mobile viewport (≤ 768px, touch device media query), all text content in animated sections is immediately visible after hydration
- [x] AC2 — On desktop, framer-motion scroll-triggered animations (`whileInView`) continue to fire correctly
- [x] AC3 — Users with `prefers-reduced-motion: reduce` still see all content (no invisible text)
- [x] AC4 — No layout shift or visual flash between SSR and hydration on mobile
- [x] AC5 — `npm run build` succeeds with no TypeScript errors

## Breadboard

| Surface | Action | Handler | Result |
|---------|--------|---------|--------|
| mobile `motion.div` on hydration | framer-motion initializes | `staticProps.animate = { opacity:1, x:0, y:0 }` | element immediately visible |
| desktop `motion.div` on scroll | enters viewport | `whileInView: { opacity:1, y:0 }` | fade-in animation fires |
| `prefers-reduced-motion` user | page loads | `shouldDisableAnimations()` → staticProps | content visible instantly |

## Slices

**Slice 1 — Fix staticProps in useMotionVariants**: Update `staticProps` to include a smooth fade-in animate target so elements always reach their visible final state, regardless of SSR-set initial styles. Opacity fades in gently (0.35s easeOut); x/y reset instantly (no positional jump). No WAAPI/IntersectionObserver features → WKWebView safe.

File: `src/hooks/useMotionVariants.ts`

```js
const staticProps: MotionProps = {
  initial: false,
  animate: { opacity: 1, x: 0, y: 0 },
  transition: {
    opacity: { duration: 0.35, ease: "easeOut" },
    x: { duration: 0 },
    y: { duration: 0 },
  },
};
```

**Slice 2 — Eliminate SSR/hydration race**: Switch all below-fold animated islands from `client:visible` to `client:idle`. Sections pre-hydrate during browser idle time before the user scrolls there; the fade completes invisibly, eliminating the "snap" artifact.

Files: `src/pages/index.astro`, `src/pages/contact.astro`, `src/pages/services/index.astro`

**Slice 3 — Uniformise BlogPostCard**: Replace hardcoded animation in `BlogPostCard.tsx` with `useMotionVariants` hook — consistent with all other animated components.

**Slice 4 — Fix BlogList spinner**: Replace framer-motion continuous rotate+scale in `BlogList.tsx` with Tailwind `animate-spin` CSS — WKWebView safe, no WAAPI.

**Slice 5 — Desktop duration + easing**: Reduce default duration from 0.8s → 0.5s and add `ease: "easeOut"` across all variants in `useMotionVariants.ts` — aligns with UX guidelines (complex entrances ≤500ms, ease-out for entering elements).

## Out of Scope

- Re-enabling animations on mobile (separate performance/UX decision)
- Service pages / static Astro pages (not affected)
- Astro View Transitions (not used in this project)
- Any changes to individual components (fix is entirely in the hook)

## Open Questions

None — scope is fully defined.
