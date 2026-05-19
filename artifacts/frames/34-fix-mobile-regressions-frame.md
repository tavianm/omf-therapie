---
issue: 34
title: "fix: mobile regressions — transitions not triggered, text missing/misrendered"
tier: F-lite
status: implemented
pr: 35
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

**Final implementation** (evolved from initial single-file fix after UX testing):

### Phase 1 — Fix mobile text invisibility (`src/hooks/useMotionVariants.ts`)

Change `staticProps` to provide an animate target with a gentle fade:
```js
const staticProps: MotionProps = {
  initial: false,
  animate: { opacity: 1, x: 0, y: 0 },
  transition: {
    opacity: { duration: 0.35, ease: "easeOut" }, // smooth fade
    x: { duration: 0 }, // instant transform reset
    y: { duration: 0 }, // instant transform reset
  },
};
```
No IntersectionObserver, no `will-change`, no WAAPI stagger → safe in WKWebView.

### Phase 2 — Eliminate SSR/hydration race (`client:visible` → `client:idle`)

`client:visible` caused a race: user scrolls → sees `opacity:0` element → JS hydrates → 350ms fade starts. Elements were visibly invisible for ~100-200ms before the fade even began.

Fix: switch all below-fold sections to `client:idle` (hydrates during browser idle time, ~1-2s after page load, before the user scrolls):
- `index.astro`: `AboutSection`, `ServicesSection`, `ProcessSection`, `QualificationsSection`, `PricingSection`
- `contact.astro`: `ContactInfo`, `LocationMap`
- `services/index.astro`: `ServicesSection`

### Phase 3 — Uniformise animations site-wide

Additional regressions discovered during UX audit:
- `BlogPostCard.tsx` bypassed `useMotionVariants` with hardcoded animations → still animated on mobile
- `BlogList.tsx` loading spinner used framer-motion continuous `rotate + scale` → WKWebView unsafe
- Desktop animation duration was 0.8s → too slow (UX guideline: ≤500ms), no easing specified

Fixes:
- `BlogPostCard.tsx`: use `useMotionVariants` hook
- `BlogList.tsx`: replace framer-motion spinner with Tailwind `animate-spin`
- `useMotionVariants.ts` desktop variants: 0.8s → 0.5s + `ease: "easeOut"`

## Out of Scope

- Re-enabling animations on mobile (intentionally disabled for WKWebView/GPU performance — can be a separate task)
- Service pages / a-propos / static Astro pages (not affected — no React islands)
- Astro View Transitions (not used in this project)

## Constraints

- Must not break desktop animations
- Must not break `prefers-reduced-motion` behavior
- No framer-motion features that trigger WAAPI/IntersectionObserver on mobile (WKWebView crash risk)

## Resolution

✅ Implemented in PR #35 — branch `fix/34-mobile-regressions`

All original constraints met. The "brutal snap" UX issue (initial `duration:0`) was resolved by switching to `client:idle` (fade completes before user scrolls) + smooth 0.35s opacity transition as safety net.
