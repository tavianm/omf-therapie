---
issue: null
tier: F-full
spec: artifacts/specs/seo-geo-optimisation-spec.md
status: draft
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|-----------|
| T1 | Fix `robots.txt` sitemap directive (`.txt` → `.xml`) | devops | `public/robots.txt` | — | Y |
| T2 | Add section routes + priorities to `generate-sitemap.js` | devops | `generate-sitemap.js` | — | Y |
| T3 | Add `og:locale`, `geo.*` meta tags to `index.html` | devops | `index.html` | — | Y |
| T4 | Create `StructuredData.tsx` — Helmet JSON-LD injector | frontend-dev | `src/components/StructuredData.tsx` | — | Y |
| T5 | Create `schema.ts` — 4 builder functions + `FAQ_ITEMS` | frontend-dev | `src/utils/schema.ts` | T4 | N |
| T6 | Inject `LocalBusiness`, `Person`, `FAQPage` schemas in `Home.tsx`; fix meta description | frontend-dev | `src/pages/Home.tsx` | T5 | N |
| T7 | Inject `Article` schema in `BlogPost.tsx`; fix meta description | frontend-dev | `src/pages/BlogPost.tsx` | T5 | N |
| T8 | Inject `LocalBusiness` schema in `Contact.tsx`; fix meta description | frontend-dev | `src/pages/Contact.tsx` | T5 | N |
| T9 | Fix `Blog.tsx` meta description | frontend-dev | `src/pages/Blog.tsx` | — | Y |
| T10 | Create `FAQSection.tsx` and insert in `Home.tsx` | frontend-dev | `src/components/home/FAQSection.tsx`, `src/pages/Home.tsx` | T5, T6 | N |
| T11 | Create `LocalAreaSection.tsx` and insert in `Home.tsx` | frontend-dev | `src/components/home/LocalAreaSection.tsx`, `src/pages/Home.tsx` | T6, T10 | N |
| T12 | Enrich blog post: `deconstruire-tabous-therapie.ts` — add Montpellier paragraph | frontend-dev | `src/utils/blogs/deconstruire-tabous-therapie.ts` | — | Y |
| T13 | Enrich blog post: `gerer-anxiete-quotidien-techniques-conseils.ts` — add Montpellier paragraph | frontend-dev | `src/utils/blogs/gerer-anxiete-quotidien-techniques-conseils.ts` | — | Y |
| T14 | Quality gate: `npm run lint && npm run build` — verify no errors | tester | — | T1–T13 | N |

## Agent Slices

**devops:** T1, T2, T3
> Fix robots.txt, expand sitemap with section routes, add geo/og:locale meta to index.html.

**frontend-dev:** T4, T5, T6, T7, T8, T9, T10, T11, T12, T13
> Build JSON-LD infrastructure (StructuredData + schema utils), inject schemas in all pages, fix meta descriptions, create FAQ + LocalArea content sections, enrich 2 blog posts.

**tester (validate):** T14
> Run `npm run lint && npm run build` and confirm all 15 ACs pass.

## Execution Order

```
Round 1 (parallel):  T1, T2, T3        — devops tech fixes (no TS, no deps)
                     T4                — StructuredData component (no deps)
                     T9, T12, T13      — meta fix + blog enrichment (no deps)

Round 2 (after T4):  T5                — schema.ts utilities (depends on T4 types)

Round 3 (after T5):  T6, T7, T8       — schema injection in pages (parallel)

Round 4 (after T6):  T10              — FAQSection (needs FAQ_ITEMS from T5, Home.tsx structure from T6)

Round 5 (after T10): T11              — LocalAreaSection (needs Home.tsx settled after T10)

Round 6 (all done):  T14             — quality gate
```

## Quality Gate

```bash
npm run lint && npm run build
```

TypeScript strict mode is ON (`tsconfig.app.json`). No `any` types. All schema builder functions must have explicit return type annotations.

## Key Implementation Notes

### `StructuredData.tsx`
```tsx
import { Helmet } from "react-helmet-async";

interface StructuredDataProps {
  schema: Record<string, unknown> | Record<string, unknown>[];
}

export default function StructuredData({ schema }: StructuredDataProps) {
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>
  );
}
```

### `schema.ts` — critical fields per builder

**`buildLocalBusinessSchema()`**
```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Oriane Montabonnet",
  "url": "https://omf-therapie.fr",
  "telephone": "06 50 33 18 53",
  "email": "contact@omf-therapie.fr",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "1086 Av. Albert Einstein",
    "addressLocality": "Montpellier",
    "postalCode": "34000",
    "addressCountry": "FR"
  },
  "openingHoursSpecification": [
    { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "08:00", "closes": "12:00" },
    { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "14:00", "closes": "19:00" }
  ],
  "image": "https://omf-therapie.fr/assets/about/oriane-montabonnet-1.webp",
  "sameAs": [
    "https://www.instagram.com/omf.therapie",
    "https://share.google/mt9nTqAMN3F713joZ"
  ]
}
```

**`buildArticleSchema(post: BlogPost)`** — map from BlogPost type:
- `headline` ← `post.title`
- `datePublished` ← `post.date` (convert French date string to ISO 8601)
- `author.name` ← `post.author.name`
- `image` ← `post.imageUrl || default image`
- `url` ← `https://omf-therapie.fr/blog/${post.slug}`
- `publisher` ← LocalBusiness object (inline)

### `generate-sitemap.js` — section routes to add
```js
const SECTION_ROUTES = ["/Tarifs", "/Services", "/About", "/Process", "/Formations"];
// changefreq: "monthly", priority: 0.7
```

### `index.html` meta tags to add (after existing meta block)
```html
<meta property="og:locale" content="fr_FR" />
<meta name="geo.region" content="FR-34" />
<meta name="geo.placename" content="Montpellier" />
<meta name="geo.position" content="43.610769;3.876716" />
```

### Home page description
```
Oriane Montabonnet, thérapeute à Montpellier, vous accompagne en thérapie individuelle, de couple et familiale. Cabinet au 1086 Av. Albert Einstein, Montpellier. Prise de rendez-vous : 06 50 33 18 53.
```

### Blog posts enrichment
Each gets a closing `<h2>` paragraph like:
> "Cabinet à Montpellier — Si vous souhaitez aborder [topic] en thérapie, Oriane Montabonnet vous reçoit au 1086 Avenue Albert Einstein, 34000 Montpellier, et accompagne les habitants de Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels et Clapiers."

### `LocalAreaSection.tsx`
- Heading `<h2>`: "Thérapeute à Montpellier et ses environs"
- Short paragraph + chip/badge grid for: Montpellier, Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels, Clapiers
- Tailwind utility classes, `sage`/`mint` palette

### `FAQSection.tsx`
- Receives `FAQ_ITEMS` prop
- Uses `<details>/<summary>` pattern for accessibility
- `aria-label="Foire aux questions"` on `<section>` wrapper
- Heading `<h2>`: "Questions fréquentes"
