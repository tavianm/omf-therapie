---
issue: 46
tier: F-full
spec: artifacts/specs/46-ameliorer-seo-top3-therapeute-montpellier-spec.md
status: draft
---

## Tasks

| ID | Description | Agent | Fichiers | Dépendances | Parallèle? |
|----|-------------|-------|----------|-------------|-----------|
| T1 | Ajouter builders schema.ts (AggregateRating, BreadcrumbList, WebSite) + COMPANY_DESCRIPTION | frontend-dev-A | `src/utils/schema.ts`, `src/config/global.config.ts` | — | Y |
| T2 | Injecter nouveaux schemas dans toutes les pages existantes | frontend-dev-A | `src/pages/index.astro`, `src/pages/services/*.astro`, `src/pages/a-propos.astro`, `src/pages/contact.astro`, `src/pages/blog/[slug].astro` | T1 | N |
| T3 | Créer page `/services/anxiete-montpellier.astro` (IA draft ≥1200 mots + schema Service+FAQ) | frontend-dev-B | `src/pages/services/anxiete-montpellier.astro` | — | Y |
| T4 | Mettre à jour services index + ajouter liens internes blog → page anxiété | frontend-dev-B | `src/pages/services/index.astro`, 3 articles blog anxiété | T3 | N |
| T5 | Enrichir pages therapie-individuelle + therapie-de-couple (+400 mots chacune) | frontend-dev-C | `src/pages/services/therapie-individuelle.astro`, `src/pages/services/therapie-de-couple.astro` | — | Y |
| T6 | Ajouter liens internes service + CTA rendez-vous dans les 11 articles blog | frontend-dev-C | `src/content/blog/*.md` (11 articles) | — | Y |
| T7 | Rédiger guide off-page SEO (annuaires + checklist GBP) | inline | `docs/seo-offpage-guide.md` | — | Y |
| T8 | Valider : lint + schema JSON-LD + sitemap + AC checklist | tester | — | T1,T2,T3,T4,T5,T6 | N |

---

## Budget

### Par tâche

| Tâche | Sujet | Classe | Ops estimées | Split? |
|-------|-------|--------|-------------|--------|
| T1 | seo-schema | bounded | ~6 | — |
| T2 | page-schema-injection | judgmental | ~12 | — |
| T3 | new-page-content | exploratory | ~10 | — |
| T4 | internal-linking | bounded | ~6 | — |
| T5 | content-service | judgmental | ~8 | — |
| T6 | content-blog | exploratory | ~12 | — |
| T7 | documentation | bounded | ~4 | — |
| T8 | validation | bounded | ~5 | — |

### Par agent instance

| Instance | Tâches | Sujets | Ops | Action |
|----------|--------|--------|-----|--------|
| frontend-dev-A | T1, T2 | seo-schema, page-injection | ~18 | — |
| frontend-dev-B | T3, T4 | new-page, linking | ~16 | — |
| frontend-dev-C | T5, T6 | content-service, content-blog | ~20 | — |
| inline | T7 | documentation | ~4 | — |
| tester | T8 | validation | ~5 | — |

---

## Agent Slices

### frontend-dev-A — Schema.ts + injection (sujets : seo-schema, page-injection)

**T1 — Nouveaux builders dans schema.ts :**
- `buildWebSiteSchema()` → `@type: WebSite` avec `SearchAction` (sitelinks search box)
- `buildBreadcrumbSchema(items: {name: string, url: string}[])` → `@type: BreadcrumbList`
- Ajouter `aggregateRating` dans `buildLocalBusinessSchema()` :
  ```ts
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "⚠️ À RENSEIGNER — vérifier note exacte dans GBP",
    ratingCount: 14,
    reviewCount: 14,
    bestRating: "5",
    worstRating: "1",
  }
  ```
- `src/config/global.config.ts` : mettre à jour `COMPANY_DESCRIPTION` :
  ```ts
  export const COMPANY_DESCRIPTION =
    "Psychopraticienne TCCE à Montpellier, Oriane Montabonnet vous accompagne en thérapie individuelle, de couple, familiale et dans la gestion de l'anxiété et des troubles alimentaires.";
  ```

**T2 — Injection dans les pages existantes :**

Chaque page `.astro` qui a un breadcrumb HTML → passer `buildBreadcrumbSchema(items)` dans `jsonLd`.

- `src/pages/index.astro` : ajouter `buildWebSiteSchema()` dans le tableau `jsonLd` (en plus des 3 schemas existants). Le `buildLocalBusinessSchema()` inclut désormais `aggregateRating` automatiquement.
- `src/pages/services/therapie-individuelle.astro` : ajouter BreadcrumbList `[{Accueil, /}, {Services, /services}, {Thérapie individuelle, /services/therapie-individuelle}]`
- `src/pages/services/therapie-de-couple.astro` : idem structure couple
- `src/pages/services/therapie-familiale.astro` : idem structure famille
- `src/pages/services/troubles-alimentaires.astro` : idem structure TCA
- `src/pages/a-propos.astro` : BreadcrumbList `[{Accueil, /}, {À propos, /a-propos}]`
- `src/pages/contact.astro` : BreadcrumbList `[{Accueil, /}, {Contact, /contact}]`
- `src/pages/blog/[slug].astro` : BreadcrumbList dynamique `[{Accueil, /}, {Blog, /blog}, {post.title, /blog/slug}]` — s'insérer dans le `jsonLd` existant (buildArticleSchema est déjà là, passer un array)

---

### frontend-dev-B — Nouvelle page anxiété + linking (sujets : new-page, internal-linking)

**T3 — Page `/services/anxiete-montpellier.astro` :**

Créer la page complète en suivant exactement la structure des autres pages de service (therapie-de-couple.astro comme référence).

**Meta SEO :**
```
title: "Anxiété à Montpellier — Aide & Accompagnement | Oriane Montabonnet"
description: "Souffrez-vous d'anxiété à Montpellier ? Oriane Montabonnet, psychopraticienne TCCE, vous accompagne pour reprendre confiance et réduire vos angoisses. Cabinet au 1086 Av. Albert Einstein."
canonical: "https://omf-therapie.fr/services/anxiete-montpellier"
```

**Schemas :**
```ts
const jsonLd = [
  buildFAQSchema(faqs),         // 4+ FAQs
  buildBreadcrumbSchema([...]), // Accueil > Services > Anxiété
  buildServiceSchema(
    "Accompagnement de l'anxiété à Montpellier",
    "Thérapie TCCE pour l'anxiété généralisée, la phobie sociale, les attaques de panique à Montpellier.",
    "https://omf-therapie.fr/services/anxiete-montpellier"
  ),
];
```

**Structure de contenu (IA draft, ≥1200 mots) :**
```
H1: Aide pour l'anxiété à Montpellier
Intro: 150 mots — présentation générale
H2: Qu'est-ce que l'anxiété ? (200 mots)
H2: Les formes d'anxiété que j'accompagne (200 mots + liste)
  - Anxiété généralisée
  - Phobies sociales
  - Attaques de panique / agoraphobie
  - Anxiété de performance
  - Anxiété liée au travail (burn-out précoce)
H2: Comment la thérapie TCCE traite-t-elle l'anxiété ? (200 mots)
H2: Comment se déroule un suivi pour l'anxiété à Montpellier ? (150 mots)
H2: Tarifs et prise en charge (100 mots → lien /rendez-vous)
FAQ (4 questions) :
  - L'anxiété se traite-t-elle en thérapie ?
  - Combien de séances pour traiter l'anxiété ?
  - Mon anxiété est sévère, puis-je quand même consulter ?
  - La thérapie TCCE pour l'anxiété est-elle remboursée ?
CTA: Prendre rendez-vous
```

**T4 — Services index + liens blog → anxiété :**

- `src/pages/services/index.astro` : Ajouter section card "Anxiété & Bien-être" **avant** le composant `ServicesSection` (ou en dessous en HTML statique) pointant vers `/services/anxiete-montpellier`. Style à calquer sur les cards existantes.
- `src/content/blog/gerer-anxiete-quotidien-techniques-conseils.md` : Ajouter en fin d'article un paragraphe avec lien interne vers `/services/anxiete-montpellier`
- `src/content/blog/gestion-stress-anxiete-montpellier.md` : idem
- `src/content/blog/deconstruire-tabous-therapie.md` : idem (mentionne anxiété → lien contextuel)

---

### frontend-dev-C — Enrichissement contenu (sujets : content-service, content-blog)

**T5 — Pages de service :**

- `src/pages/services/therapie-individuelle.astro` : ajouter 2 nouvelles sections HTML après le contenu existant :
  - H2: "Pour qui la thérapie individuelle à Montpellier ?" (~200 mots, liste de situations)
  - H2: "Comment trouver le bon thérapeute à Montpellier ?" (~200 mots, CTA)
  - Objectif final : ≥1 200 mots prose

- `src/pages/services/therapie-de-couple.astro` : ajouter 2 nouvelles sections :
  - H2: "Signes qu'il est temps de consulter un thérapeute de couple à Montpellier" (~180 mots)
  - H2: "La thérapie de couple selon l'approche TCCE : comment ça fonctionne" (~180 mots)
  - Objectif final : ≥1 200 mots prose

**T6 — Maillage interne blog :**

Pour chaque article blog (11 fichiers), ajouter en fin d'article un bloc HTML standardisé :

```html
<div class="mt-8 p-6 bg-sage-50 rounded-lg">
  <p class="text-sage-700 font-medium mb-2">Envie d'aller plus loin ?</p>
  <p class="text-sage-600 mb-4">Je vous accompagne en cabinet à Montpellier — <a href="/rendez-vous/" class="text-mint-600 hover:underline">prenez rendez-vous en ligne</a> ou <a href="/contact" class="text-mint-600 hover:underline">contactez-moi</a>.</p>
</div>
```

**Plus :** ajouter 1 lien contextuel dans le corps de chaque article vers la page de service la plus pertinente :
- Articles couple → `/services/therapie-de-couple`
- Articles anxiété/stress → `/services/anxiete-montpellier`
- Articles alimentation → `/services/troubles-alimentaires`
- Articles famille → `/services/therapie-familiale`
- Articles généraux → `/services/therapie-individuelle`

---

### Inline — Guide off-page SEO

**T7 — `docs/seo-offpage-guide.md` :**

Créer un guide complet comprenant :
1. **NAP exact** à utiliser sur tous les annuaires :
   - Nom : Oriane Montabonnet — Psychopraticienne
   - Adresse : 1086 Avenue Albert Einstein, 34000 Montpellier
   - Téléphone : 06 50 33 18 53 (format variable selon annuaire : 06 50 33 18 53 / +33650331853)
   - Site : https://omf-therapie.fr
   - Email : contact@omf-therapie.fr
2. **Liste d'annuaires à rejoindre** (avec URLs et priorité) :
   - therapeutes.com — inscription gratuite
   - resalib.fr — avec prise de RDV intégrée
   - medoucine.com — sur dossier
   - PagesJaunes.fr — gratuit, fort signal Google local
   - psychologue.net — ouvert aux psychopraticiens
3. **Checklist Google Business Profile** :
   - Catégorie principale : "Psychothérapeute" ou "Thérapeute"
   - Description alignée avec meta description homepage
   - ≥10 photos (cabinet, extérieur, portrait pro)
   - Poster 1 update/mois minimum
   - Répondre à TOUS les avis dans les 48h
   - Vérifier que l'adresse est exactement : 1086 Avenue Albert Einstein, 34000 Montpellier
4. **Cohérence NAP** : vérifier que GBP, psychologue.net et PagesJaunes (déjà présents) utilisent le même format

---

### Tester — Validation

**T8 — Checks post-implémentation :**
```bash
npm run lint                     # Vérifie absence d'erreurs TypeScript/ESLint
```

Vérifications manuelles / instructions à fournir en sortie :
- [ ] Rich Results Test Google : tester `https://omf-therapie.fr` (vérifier LocalBusiness + WebSite + FAQ)
- [ ] Rich Results Test : tester `/services/anxiete-montpellier` (Service + FAQ + Breadcrumb)
- [ ] Inspecter `sitemap-index.xml` après build : confirmer `/services/anxiete-montpellier` présent
- [ ] Valider que `ratingValue` dans AggregateRating est correct (à confirmer avec GBP)
- [ ] Vérifier les 15 ACs de la spec un par un

---

## Quality Gate

```bash
npm run lint
```

> ⚠️ `npm run build` requiert les variables d'env GOOGLE_*, SUPABASE_*, STRIPE_* — exécuter uniquement en CI ou avec `.env.local` complet. Pour validation locale : `npm run lint` suffit pour vérifier TypeScript.

---

## Séquence d'exécution

```
Phase 1 (en parallèle) :
  frontend-dev-A → T1 (schema builders)
  frontend-dev-B → T3 (page anxiété)
  frontend-dev-C → T5 (contenu service)
  frontend-dev-C → T6 (blog linking)
  inline         → T7 (guide off-page)

Phase 2 (après T1) :
  frontend-dev-A → T2 (schema injection pages)

Phase 3 (après T3) :
  frontend-dev-B → T4 (services index + blog links anxiété)

Phase 4 (tout terminé) :
  tester         → T8 (validation)
```
