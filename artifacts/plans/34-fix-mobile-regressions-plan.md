---
issue: 34
tier: F-lite
spec: artifacts/specs/34-fix-mobile-regressions-spec.md
status: implemented
pr: 35
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Status |
|----|-------------|-------|-------|-------------|--------|
| T1 | Fix `staticProps` — smooth opacity fade instead of instant snap | frontend-dev | `src/hooks/useMotionVariants.ts` | — | ✅ done |
| T2 | `client:visible` → `client:idle` for all below-fold animated sections | frontend-dev | `src/pages/index.astro`, `contact.astro`, `services/index.astro` | T1 | ✅ done |
| T3 | Fix `BlogPostCard` — use `useMotionVariants` instead of hardcoded animation | frontend-dev | `src/components/blog/BlogPostCard.tsx` | T1 | ✅ done |
| T4 | Fix `BlogList` loading spinner — Tailwind `animate-spin` instead of framer-motion | frontend-dev | `src/components/blog/BlogList.tsx` | — | ✅ done |
| T5 | Desktop durations 0.8s → 0.5s + `ease: "easeOut"` on all variants | frontend-dev | `src/hooks/useMotionVariants.ts` | — | ✅ done |
| T6 | Build validation | tester | — | T1-T5 | ✅ done |

## Quality Gate

```bash
npm run build
```
✅ Passed — no TypeScript errors, build complete.

## Change Detail

### T1 — `src/hooks/useMotionVariants.ts` staticProps

```diff
 const staticProps: MotionProps = {
   initial: false,
   animate: { opacity: 1, x: 0, y: 0 },
-  transition: { duration: 0 },
+  transition: {
+    opacity: { duration: 0.35, ease: "easeOut" },
+    x: { duration: 0 },
+    y: { duration: 0 },
+  },
 };
```

### T2 — `client:visible` → `client:idle`

```diff
-  <AboutSection client:visible />
+  <AboutSection client:idle />
-  <ServicesSection client:visible />
+  <ServicesSection client:idle />
   ... (5 sections in index.astro, 2 in contact.astro, 1 in services/index.astro)
```

### T5 — Desktop durations + easing

```diff
-  duration: options.duration ?? 0.8,
+  duration: options.duration ?? 0.5,
+  ease: "easeOut",
```

**Why this works:**
- `client:idle` → islands hydrate during browser idle (~1-2s after load), before user scrolls → fade completes invisibly
- `transition.opacity: 0.35s easeOut` → smooth fallback for slow devices or sections near top
- `ease: "easeOut"` on desktop → natural deceleration on enter (UX guideline §7)
- No framer-motion in loading spinners → no continuous WAAPI on mobile (WKWebView safe)
