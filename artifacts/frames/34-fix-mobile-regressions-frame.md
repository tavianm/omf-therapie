---
issue: 34
title: "fix: mobile regressions — transitions not triggered, text missing/misrendered"
status: approved
tier: F-lite
created: 2026-05-19
---

## Problem Statement

Since commit `1f8a792` ("fix(perf): désactive les animations sur mobile et réduit la charge GPU"), the production site is broken on mobile devices. Two distinct symptoms are reported:

1. **Transitions not triggered** — framer-motion animations are intentionally disabled on touch devices (`hover: none` + `pointer: coarse`). The `useMotionVariants` hook returns `staticProps = { initial: false }` for all mobile users.

2. **Text missing/invisible** — This is the critical bug. Framer-motion renders SSR HTML with `opacity: 0` inline styles (from `initial={{ opacity: 0, y: 20 }}`). On mobile hydration, `initial: false` tells framer-motion to inherit the DOM state (`opacity: 0`) rather than animate. Since no `animate` or `whileInView` target is provided in `staticProps`, elements **stay permanently invisible**.

## Root Cause

In `src/hooks/useMotionVariants.ts`:

```js
// SSR: window === undefined → returns false → SSR renders opacity:0
// Mobile client: touch device → returns true → staticProps = { initial: false }
function shouldDisableAnimations(): boolean {
  if (typeof window === "undefined") return false; // ← SSR gets animations ON
  ...
}

const staticProps: MotionProps = {
  initial: false, // ← inherits SSR opacity:0, no animate target → invisible
};
```

## Affected Components (11 files)

All components using `useMotionVariants`:
- `src/components/home/HeroSection.tsx` (hero title, subtitle — **above fold, visible immediately broken**)
- `src/components/home/IntroSection.tsx`
- `src/components/home/AboutSection.tsx`
- `src/components/home/ServicesSection.tsx`
- `src/components/home/ProcessSection.tsx`
- `src/components/home/QualificationsSection.tsx`
- `src/components/home/PricingSection.tsx`
- `src/components/pricing/CommitmentSection.tsx`
- `src/components/pricing/CTASection.tsx`
- `src/components/pricing/PaymentInfo.tsx`
- `src/components/blog/BlogHeader.tsx`

## Why This Matters

- All mobile users (majority of traffic for a therapy practice) see invisible text sections
- The hero title is blank on mobile — first impression is completely broken
- Content on `/blog`, `/tarifs`, `/` home page sections all affected

## Success Criteria

- All text content is visible on mobile (no invisible sections)
- Static pages (service pages, a-propos) unaffected (they use plain Astro, no React islands)
- Desktop animations continue to work correctly
- Accessibility: `prefers-reduced-motion` behavior preserved

## Proposed Fix

**Single-file fix** in `src/hooks/useMotionVariants.ts`:

Change `staticProps` from:
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

This immediately overrides SSR's `opacity: 0` with `opacity: 1` (instant, no animation). Elements become visible right on hydration.

**Scope**: 1 file change, zero architectural impact.

## Out of Scope

- Re-enabling animations on mobile (intentionally disabled for GPU performance — can be a separate task)
- Service pages / a-propos / static Astro pages (not affected — no React islands)
- Astro View Transitions (not used in this project)

## Constraints

- Must not break desktop animations
- Must not break `prefers-reduced-motion` behavior
- Minimal change surface — production fix, not a refactor

## Stakeholders

- Oriane Montabonnet (practice owner, all mobile visitors impacted)
- All mobile users of omf-therapie.fr

## Appetite

Tier: F-lite
Reasoning: Single-hook fix, clear scope, 1 domain (React animation layer). Validation via build + visual check.

## Open Questions

- Should mobile animations be re-enabled (with lighter variants) in a follow-up? The current approach of disabling all animations on mobile is aggressive.
