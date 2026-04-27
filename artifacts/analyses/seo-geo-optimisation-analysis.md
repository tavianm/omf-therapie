---
issue: null
title: "SEO & GEO Optimisation — Thérapeute/Psychologue Montpellier"
type: feature
complexity: L
tier: F-full
---

## Problem

`omf-therapie.fr` has basic SEO (meta tags, OG, sitemap) but lacks structured data, local content depth, and AI-citation signals required to rank for "Thérapeute Montpellier" in both Google and generative AI tools (ChatGPT, Perplexity).

## Current State

### Technical SEO — What exists
| Asset | State | Details |
|-------|-------|---------|
| `SEO.tsx` | ⚠️ Partial | title, description, OG, Twitter Card — **no JSON-LD support** |
| `index.html` | ⚠️ Partial | Has keywords meta (deprecated), no `og:locale`, no `geo.*` tags |
| `sitemap.xml` | ⚠️ Incomplete | Missing section routes: /Tarifs, /Services, /About, /Process, /Formations |
| `robots.txt` | ❌ Wrong | Points to `sitemap.txt` — Google expects `sitemap.xml` |
| Structured data | ❌ None | Zero JSON-LD anywhere — critical gap for GEO |
| Hero H1 | ✅ Good | "Oriane Montabonnet: Thérapeute à Montpellier" |
| Home description | ❌ Keyword dump | `"psychologue, thérapeute, Montpellier, bien-être, développement personnel…"` |

### GEO (Generative Engine Optimization) — What exists
| Signal | State |
|--------|-------|
| Entity identity (Who is Oriane?) | ❌ No JSON-LD Person/LocalBusiness |
| Local business signals | ❌ No address/phone/hours in structured data |
| FAQ content for AI answer boxes | ❌ No FAQPage schema, no FAQ sections |
| Blog Article schema | ❌ No Article JSON-LD on blog posts |
| Local content (Montpellier mentions in blog) | ❌ Zero references in all 9 articles |
| `sameAs` GBP link | ❌ Not connected to Google Business Profile |

### Files affected
```
src/components/SEO.tsx              ← extend with JSON-LD
src/pages/Home.tsx                  ← fix description, add FAQ + local section
src/pages/BlogPost.tsx              ← inject Article schema
src/pages/Blog.tsx                  ← fix description
src/pages/Contact.tsx               ← fix description
src/utils/blogs/*.ts (×2 min)       ← add Montpellier local content
generate-sitemap.js                 ← add section routes
public/robots.txt                   ← fix sitemap.xml reference
index.html                          ← add og:locale, geo.* meta
```
New files:
```
src/components/StructuredData.tsx   ← JSON-LD injector component
src/components/home/FAQSection.tsx  ← FAQ section with schema
src/components/home/LocalAreaSection.tsx ← "Zone de couverture" section
```

## Impact

- **Users affected:** All potential patients searching "thérapeute Montpellier" or asking AI tools for therapist recommendations
- **Severity:** High — invisible to AI answer engines; sub-optimal Google local ranking
- **Revenue impact:** High — primary acquisition channel for the practice

## Approach Options

### Option A — Extend SEO component with optional `jsonLd` prop

Add a `jsonLd?: object | object[]` prop to `SEO.tsx`. Callers construct and pass the schema object directly.

```tsx
<SEO jsonLd={{ "@context": "https://schema.org", "@type": "LocalBusiness", ... }} />
```

Pros: Minimal files changed, co-located with SEO logic
Cons: SEO component becomes a dumping ground; schema objects are verbose inline; harder to reuse schema shapes across pages
Risk: **low**

### Option B — Dedicated `StructuredData.tsx` component (recommended)

Create `src/components/StructuredData.tsx` that accepts a `schema` prop and injects it as `<script type="application/ld+json">` via Helmet. Create helper functions in `src/utils/schema.ts` that construct typed schema objects.

```tsx
// src/utils/schema.ts
export function buildLocalBusinessSchema(): LocalBusiness { ... }
export function buildPersonSchema(): Person { ... }
export function buildArticleSchema(post: BlogPost): Article { ... }
export function buildFAQSchema(faqs: FAQ[]): FAQPage { ... }

// Usage in pages:
<StructuredData schema={buildLocalBusinessSchema()} />
<StructuredData schema={buildArticleSchema(post)} />
```

Pros: Clean separation of concerns; schema utilities are independently testable; follows existing component pattern; easy to add new schema types later
Cons: Two new files vs one
Risk: **low**

### Option C — Static JSON-LD in `index.html`

Embed `LocalBusiness` + `Person` schema as a static `<script type="application/ld+json">` block in `index.html`. Blog Article schema still needs Option A or B for dynamic data.

Pros: Zero-effort for entity/local data; no React overhead
Cons: Blog article schema still requires a dynamic solution; mixes static and dynamic approaches; harder to keep in sync with config data
Risk: **low** (hybrid approach)

## Recommendation

**Option B** — dedicated `StructuredData` component + `schema.ts` utilities.

Rationale:
- Blog `Article` schema is inherently dynamic (title, date, author, imageUrl per post) — static approach impossible
- `LocalBusiness` data already lives in `src/config/global.config.ts` (address, phone, hours) — schema utils can import directly, avoiding duplication
- Single pattern for all schema types makes future additions (e.g. BreadcrumbList, MedicalBusiness) trivial
- Follows existing utility-first architecture (similar to `blogApi.ts`)

## Implementation Breakdown

### Phase 1 — Technical fixes (robots, sitemap, meta) — 3 files
- `robots.txt`: change sitemap.txt → sitemap.xml  
- `generate-sitemap.js`: add section routes with `priority: 0.7`
- `index.html`: add `og:locale`, `geo.region`, `geo.placename`, `geo.position`

### Phase 2 — JSON-LD infrastructure — 2 new files
- `src/components/StructuredData.tsx`
- `src/utils/schema.ts` with `buildLocalBusinessSchema`, `buildPersonSchema`, `buildArticleSchema`, `buildFAQSchema`

### Phase 3 — Schema injection into pages — 4 files
- `Home.tsx`: inject `LocalBusiness` + `Person` + `FAQPage`
- `BlogPost.tsx`: inject `Article`
- `Contact.tsx`: inject `LocalBusiness` 
- Fix all meta descriptions (natural sentences, not keyword lists)

### Phase 4 — Content enrichment — 4 files
- `IntroSection.tsx` or new `LocalAreaSection.tsx`: add "zone de couverture" content (Montpellier + Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels, Clapiers)
- `Home.tsx` + new `FAQSection.tsx`: FAQ section with local Q&As ("Où consulter une thérapeute à Montpellier ?", etc.)
- Update/create ≥2 blog articles with local Montpellier context

## Appetite

Estimated tier: F-full
~12-15 files touched, 3-4 new files, content authoring required.
No schema.org spikes needed — well-established patterns for LocalBusiness/Person/Article/FAQPage.
