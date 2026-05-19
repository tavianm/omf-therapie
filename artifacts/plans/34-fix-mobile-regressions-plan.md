---
issue: 34
tier: F-lite
spec: artifacts/specs/34-fix-mobile-regressions-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Fix `staticProps` in `useMotionVariants` — add `animate` + `transition` to override SSR `opacity:0` on mobile | frontend-dev | `src/hooks/useMotionVariants.ts` | — | Y |
| T2 | Build validation — confirm TypeScript compiles, no type errors | tester | — | T1 | N |

## Agent Slices

**frontend-dev:** T1  
**tester:** T2 (build + lint gate)

## Quality Gate

```bash
npm run lint && npm run build
```

## Sequence

1. **T1** — Edit `src/hooks/useMotionVariants.ts`: change `staticProps` from `{ initial: false }` to `{ initial: false, animate: { opacity: 1, x: 0, y: 0 }, transition: { duration: 0 } }`
2. **T2** — Run `npm run lint && npm run build` to confirm no regressions

## Change Detail

**File:** `src/hooks/useMotionVariants.ts`

```diff
-const staticProps: MotionProps = {
-  initial: false,
-};
+const staticProps: MotionProps = {
+  initial: false,
+  animate: { opacity: 1, x: 0, y: 0 },
+  transition: { duration: 0 },
+};
```

**Why this works:**
- `initial: false` — skip initial animation (don't fight SSR)
- `animate: { opacity: 1, x: 0, y: 0 }` — immediately set visible final state
- `transition: { duration: 0 }` — instant, no visible animation (respects intent of disabling animations on mobile)
- Works for all motion variants: `fadeInUp` (y-axis), `fadeInLeft`/`fadeInRight` (x-axis), `fadeIn`/`staggerChildren` (opacity only)
