---
issue: 34
title: "fix: mobile regressions — transitions not triggered, text missing/misrendered"
tier: F-lite
status: approved
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

- [ ] AC1 — On a mobile viewport (≤ 768px, touch device media query), all text content in animated sections is immediately visible after hydration
- [ ] AC2 — On desktop, framer-motion scroll-triggered animations (`whileInView`) continue to fire correctly
- [ ] AC3 — Users with `prefers-reduced-motion: reduce` still see all content (no invisible text)
- [ ] AC4 — No layout shift or visual flash between SSR and hydration on mobile
- [ ] AC5 — `npm run build` succeeds with no TypeScript errors

## Breadboard

| Surface | Action | Handler | Result |
|---------|--------|---------|--------|
| mobile `motion.div` on hydration | framer-motion initializes | `staticProps.animate = { opacity:1, x:0, y:0 }` | element immediately visible |
| desktop `motion.div` on scroll | enters viewport | `whileInView: { opacity:1, y:0 }` | fade-in animation fires |
| `prefers-reduced-motion` user | page loads | `shouldDisableAnimations()` → staticProps | content visible instantly |

## Slices

**Slice 1 — Fix staticProps in useMotionVariants**: Update `staticProps` to include an immediate `animate` target so elements always reach their visible final state, regardless of SSR-set initial styles.

File: `src/hooks/useMotionVariants.ts`

Change:
```js
const staticProps: MotionProps = {
  initial: false,
};
```
To:
```js
const staticProps: MotionProps = {
  initial: false,
  animate: { opacity: 1, x: 0, y: 0 },
  transition: { duration: 0 },
};
```

## Out of Scope

- Re-enabling animations on mobile (separate performance/UX decision)
- Service pages / static Astro pages (not affected)
- Astro View Transitions (not used in this project)
- Any changes to individual components (fix is entirely in the hook)

## Open Questions

None — scope is fully defined.
