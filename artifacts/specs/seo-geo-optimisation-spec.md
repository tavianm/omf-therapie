---
issue: null
title: "SEO & GEO Optimisation — Thérapeute Montpellier"
tier: F-full
status: approved
---

## Goal

Rank `omf-therapie.fr` for "Thérapeute Montpellier" in Google local results and AI-powered tools (ChatGPT, Perplexity) by adding JSON-LD structured data, enriching local content, and fixing technical SEO gaps.

## Context

The site uses `react-helmet-async` via a `SEO.tsx` component that handles title, description, OG, and Twitter Card. There is **zero JSON-LD structured data** anywhere. The codebase is a pure React + Vite SPA deployed on Netlify. NAP data lives in `src/config/global.config.ts`. Blog posts are static TypeScript modules in `src/utils/blogs/`.

Related artifacts:
- Frame: `artifacts/frames/seo-geo-optimisation-frame.md` (approved)
- Analysis: `artifacts/analyses/seo-geo-optimisation-analysis.md`

## Acceptance Criteria

- [ ] AC1 — `src/components/StructuredData.tsx` exists and renders a `<script type="application/ld+json">` tag via `react-helmet-async` with the `schema` prop serialised as JSON
- [ ] AC2 — `src/utils/schema.ts` exports `buildLocalBusinessSchema`, `buildPersonSchema`, `buildArticleSchema`, and `buildFAQSchema` as pure functions
- [ ] AC3 — `Home.tsx` renders `<StructuredData>` with `LocalBusiness` schema including: `@type`, `name`, `url`, `telephone`, `email`, `address` (streetAddress, addressLocality, postalCode, addressCountry), `openingHoursSpecification`, `image`, and `sameAs` array (Instagram + GBP URL)
- [ ] AC4 — `Home.tsx` renders `<StructuredData>` with `Person` schema including: `@type: Person`, `name`, `jobTitle: "Thérapeute"`, `url`, `worksFor` (LocalBusiness reference), `sameAs` (Instagram)
- [ ] AC5 — `Home.tsx` renders `<StructuredData>` with `FAQPage` schema containing ≥5 question-answer pairs mentioning Montpellier and/or Oriane Montabonnet
- [ ] AC6 — `src/pages/BlogPost.tsx` renders `<StructuredData>` with `Article` schema including: `headline`, `datePublished`, `author`, `image`, `url`, `publisher`
- [ ] AC7 — `Home.tsx` meta description is a natural sentence (≤160 chars, no comma-separated keyword list)
- [ ] AC8 — `Blog.tsx`, `Contact.tsx`, `BlogPost.tsx` meta descriptions are natural sentences
- [ ] AC9 — `public/robots.txt` Sitemap directive points to `https://omf-therapie.fr/sitemap.xml`
- [ ] AC10 — `generate-sitemap.js` includes section routes `/Tarifs`, `/Services`, `/About`, `/Process`, `/Formations` with `priority: 0.7` and `changefreq: monthly`
- [ ] AC11 — `index.html` contains `<meta property="og:locale" content="fr_FR">`, `<meta name="geo.region" content="FR-34">`, `<meta name="geo.placename" content="Montpellier">`, `<meta name="geo.position" content="43.610769;3.876716">`
- [ ] AC12 — `src/components/home/FAQSection.tsx` exists, renders a visible Q&A section with semantic HTML (`<details>/<summary>` or `<dl>`), proper ARIA labelling, and is inserted in `Home.tsx` before the pricing section
- [ ] AC13 — `src/components/home/LocalAreaSection.tsx` exists, renders a "Zone de couverture" section listing Montpellier + Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels, Clapiers, and is inserted in `Home.tsx` after the intro section
- [ ] AC14 — At least 2 existing blog posts have a paragraph added with an explicit Montpellier reference (city name appears in content body)
- [ ] AC15 — `npm run build` completes without TypeScript or ESLint errors

## Breadboard

| Surface | Action | Handler | Data |
|---------|--------|---------|------|
| `Home.tsx` | render JSON-LD ×3 | `<StructuredData>` | `buildLocalBusinessSchema()`, `buildPersonSchema()`, `buildFAQSchema(FAQ_ITEMS)` |
| `Home.tsx` | render content section | `<LocalAreaSection>` | static city list |
| `Home.tsx` | render FAQ section | `<FAQSection>` | `FAQ_ITEMS` constant |
| `BlogPost.tsx` | render JSON-LD | `<StructuredData>` | `buildArticleSchema(post)` |
| `Contact.tsx` | render JSON-LD | `<StructuredData>` | `buildLocalBusinessSchema()` |
| `StructuredData.tsx` | inject via Helmet | `<Helmet><script>` | `schema` prop |
| `schema.ts` | build schema objects | pure functions | imports `CONTACT_INFO`, `BUSINESS_HOURS` from `global.config.ts`; accepts `BlogPost` type |
| `FAQSection.tsx` | display accordion | JSX + Tailwind | `FAQItem[]` prop |
| `LocalAreaSection.tsx` | display city chips | JSX + Tailwind | static list |
| `index.html` | static meta | HTML | geo.region FR-34, og:locale fr_FR |
| `robots.txt` | static directive | text | Sitemap: sitemap.xml |
| `generate-sitemap.js` | build-time | Node.js | section routes array |

## Slices

**Slice 1 — Technical fixes:** Update `robots.txt` (1 line), `generate-sitemap.js` (add section routes array), `index.html` (add 4 meta tags). No TypeScript changes.
Files: `public/robots.txt`, `generate-sitemap.js`, `index.html`

**Slice 2 — JSON-LD infrastructure:** Create `StructuredData.tsx` (thin wrapper over Helmet) and `schema.ts` (4 builder functions pulling from `global.config.ts`). Define `FAQ_ITEMS` constant in `schema.ts`.
Files: `src/components/StructuredData.tsx` (new), `src/utils/schema.ts` (new)

**Slice 3 — Schema injection + meta fix:** Add `<StructuredData>` calls to `Home.tsx`, `BlogPost.tsx`, `Contact.tsx`. Rewrite all 4 meta descriptions.
Files: `src/pages/Home.tsx`, `src/pages/BlogPost.tsx`, `src/pages/Contact.tsx`, `src/pages/Blog.tsx`

**Slice 4 — Content enrichment:** Create `FAQSection.tsx` and `LocalAreaSection.tsx` components; insert them in `Home.tsx`; add Montpellier paragraphs to 2 blog posts.
Files: `src/components/home/FAQSection.tsx` (new), `src/components/home/LocalAreaSection.tsx` (new), `src/pages/Home.tsx`, `src/utils/blogs/deconstruire-tabous-therapie.ts`, `src/utils/blogs/gerer-anxiete-quotidien-techniques-conseils.ts`

## Component API

### `StructuredData.tsx`
```tsx
interface StructuredDataProps {
  schema: Record<string, unknown> | Record<string, unknown>[];
}
```
Renders a single `<script type="application/ld+json">` tag via `Helmet`.

### `schema.ts` — key function signatures
```typescript
buildLocalBusinessSchema(): Record<string, unknown>
// Returns: LocalBusiness with NAP, hours, sameAs=[instagram, GBP_URL]

buildPersonSchema(): Record<string, unknown>
// Returns: Person (Oriane), jobTitle:"Thérapeute", worksFor LocalBusiness

buildArticleSchema(post: BlogPost): Record<string, unknown>
// Returns: Article with headline, datePublished, author, image, url, publisher

buildFAQSchema(faqs: FAQItem[]): Record<string, unknown>
// Returns: FAQPage with mainEntity array

export const FAQ_ITEMS: FAQItem[]
// Exported constant with ≥5 Montpellier-relevant Q&As
```

### `FAQItem` type
```typescript
interface FAQItem {
  question: string;
  answer: string;
}
```

### FAQ Content (≥5 Q&As)
1. **Q:** Où se situe le cabinet d'Oriane Montabonnet, thérapeute à Montpellier ?
   **A:** Le cabinet est situé au 1086 Avenue Albert Einstein, 34000 Montpellier, facilement accessible depuis Castelnau-le-Lez, Lattes, Pérols et les communes voisines.

2. **Q:** Comment prendre rendez-vous chez Oriane Montabonnet, thérapeute à Montpellier ?
   **A:** Vous pouvez contacter Oriane Montabonnet par téléphone au 06 50 33 18 53 ou via le formulaire de contact sur le site omf-therapie.fr.

3. **Q:** Quelles thérapies sont proposées à Montpellier par Oriane Montabonnet ?
   **A:** Oriane Montabonnet propose des accompagnements individuels, de couple et familiaux à Montpellier, incluant la gestion du stress, l'anxiété, le développement personnel et le bien-être émotionnel.

4. **Q:** Quels sont les tarifs d'une séance de thérapie à Montpellier ?
   **A:** Les tarifs varient selon le type de séance. Consultez la page Tarifs sur omf-therapie.fr pour connaître les honoraires en vigueur. Des facilités de paiement peuvent être discutées lors du premier contact.

5. **Q:** Oriane Montabonnet accompagne-t-elle les patients de Castelnau-le-Lez, Lattes, Pérols et des communes voisines ?
   **A:** Oui, le cabinet de Montpellier est facilement accessible depuis Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels et Clapiers.

6. **Q:** La thérapie individuelle à Montpellier est-elle remboursée par la sécurité sociale ?
   **A:** Les séances avec Oriane Montabonnet ne sont pas remboursées par la Sécurité sociale. Certaines mutuelles proposent cependant une prise en charge partielle — renseignez-vous auprès de la vôtre.

### `FAQSection.tsx`
```tsx
interface FAQSectionProps {
  faqs: FAQItem[];
}
```
Renders an accessible expandable FAQ list using `<details>/<summary>` semantics, styled with Tailwind, with `aria-label="Foire aux questions"` on the container.

### `LocalAreaSection.tsx`
No props — self-contained static component. Renders a section with an `<h2>` "Thérapeute à Montpellier et ses environs" and a grid/chip list of covered cities.

## Meta Descriptions

| Page | New description |
|------|----------------|
| Home | `"Oriane Montabonnet, thérapeute à Montpellier, vous accompagne en thérapie individuelle, de couple et familiale. Cabinet au 1086 Av. Albert Einstein, Montpellier. Prise de rendez-vous : 06 50 33 18 53."` |
| Blog | `"Conseils, réflexions et ressources sur le bien-être et la thérapie par Oriane Montabonnet, thérapeute à Montpellier."` |
| Contact | `"Contactez Oriane Montabonnet, thérapeute à Montpellier. Cabinet au 1086 Av. Albert Einstein, 34000 Montpellier. Lundi–Vendredi 8h–12h et 14h–19h."` |
| BlogPost | *(existing `post.excerpt` — already natural text, no change needed)* |

## Out of Scope

- Google Business Profile setup or review management (off-site)
- Backlink / citation campaigns (off-site)
- Analytics/tracking setup (separate concern)
- Multi-language support
- Server-side rendering or SSG
- New dedicated landing page for "Thérapeute Montpellier"

## Open Questions

- [RESOLVED: GBP URL = `https://share.google/mt9nTqAMN3F713joZ`]
