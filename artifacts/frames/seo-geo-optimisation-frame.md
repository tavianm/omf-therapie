---
issue: null
title: "SEO & GEO Optimisation — Thérapeute/Psychologue Montpellier"
status: approved
tier: F-full
created: 2026-04-27
---

## Problem Statement

The site `omf-therapie.fr` has basic SEO in place (meta tags, Open Graph, sitemap) but lacks the structured data, local content depth, and AI-citation signals needed to rank for "Thérapeute Montpellier" / "Psychologue Montpellier" — both in traditional search engines (Google Maps 3-Pack) and in generative AI tools (ChatGPT, Perplexity).

## Current State Audit

### ✅ What exists
- `react-helmet-async` with title + description on all pages
- Open Graph + Twitter Card on all pages
- Sitemap XML + TXT generated from blog slugs
- robots.txt (allow all)
- Basic `keywords` meta in `index.html`
- HTTPS + Netlify CDN

### ❌ Critical gaps
| Gap | Impact |
|-----|--------|
| **No JSON-LD structured data** (LocalBusiness / Person / MedicalBusiness) | Low GEO visibility — AI tools can't identify the entity |
| **No FAQ schema** on service/home pages | Misses featured snippets + AI answer boxes |
| **No Article schema** on blog posts | Blog content invisible to AI citation engines |
| **Home meta description is a keyword dump** (`"psychologue, thérapeute, Montpellier, bien-être…"`) | Penalised by modern ranking; unnatural for AI |
| **robots.txt points to `sitemap.txt`** not `sitemap.xml` | Crawlers may miss the canonical XML sitemap |
| **Section pages (/Tarifs, /Services, /About…) absent from sitemap** | Key pages not indexed |
| **No `og:locale` meta tag** | Lower confidence for French-language signals |
| **Blog articles have zero Montpellier/local references** | No local authority signals from content |
| **No dedicated "Thérapeute Montpellier" landing copy** | Exact-match keyword not anchored in headings |
| **No `geo.*` meta tags** | Old but still read by some local crawlers |

## Why This Matters

- "Thérapeute Montpellier" and "Psychologue Montpellier" are high-intent local queries with strong conversion potential.
- AI tools (ChatGPT, Perplexity) answer "qui est un bon thérapeute à Montpellier?" using **entity-rich structured data** + **cited authoritative content**. Without JSON-LD and factual FAQs, the site is invisible to these sources.
- Google's Local 3-Pack requires consistent NAP (Name/Address/Phone) structured data + review signals.
- Blog content is a major GEO asset — articles that reference Montpellier and answer local questions become citations for AI engines.

## Success Criteria

- [ ] JSON-LD `LocalBusiness` + `Person` schema on every page
- [ ] `FAQPage` schema on Home and Services pages with ≥5 local Q&As
- [ ] `Article` schema on every blog post
- [ ] Meta descriptions rewritten to be natural sentences (no keyword stuffing)
- [ ] `robots.txt` references `sitemap.xml`
- [ ] Section pages added to sitemap with correct priorities
- [ ] `og:locale: fr_FR` added globally
- [ ] At least 2 blog articles updated or created referencing Montpellier explicitly
- [ ] `geo.region`, `geo.placename` meta tags added to `index.html`
- [ ] A dedicated "Thérapeute à Montpellier" H1/H2 visible on the home page hero

## Constraints

- No backend — all structured data must be injected via `react-helmet-async` or static `index.html`
- Tailwind CSS only, no design changes needed
- Must not break existing accessibility (pa11y) compliance
- Cannot claim "Psychologue" title if Oriane is not registered as psychologue (legal constraint in France — verify with client)
- Blog posts are static TypeScript modules; GEO-enriched articles must follow existing patterns

## Out of Scope

- Google Business Profile setup / management (off-site)
- Backlink / citation building campaigns (off-site)
- Review acquisition strategy (off-site)
- Analytics / tracking setup (separate concern)
- Multi-language support

## Stakeholders

- **Oriane Montabonnet** — practice owner, needs more local patient enquiries
- **Patients** — looking for a therapist in Montpellier via Google or AI tools
- **Developers** — must maintain clean, type-safe code

## Appetite

Tier: F-full
Reasoning: Touches 6+ files across SEO component, all pages, blog posts, sitemap generator, robots.txt, and index.html. Requires content authoring (FAQs, local copy) + structural changes (new schema component).

## Open Questions — Resolved

1. **Title:** "Thérapeute" only — do NOT use "Psychologue" (protected title in France, legally risky).
2. **Target area:** All of Montpellier + nearby cities: Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels, Clapiers.
3. **Landing strategy:** Enrich the existing home page (no new page needed).
4. **Google Business Profile:** Oriane already has one — add `sameAs` GBP URL to JSON-LD.
