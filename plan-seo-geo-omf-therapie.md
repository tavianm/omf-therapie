# Plan SEO / GEO — omf-therapie.fr

> Site vitrine React SPA + React Router + Helmet, déployé sur Netlify.  
> Praticienne : Oriane Montabonnet, psychopraticienne à Montpellier.

---

## 1. Stratégie de contenu & ciblage SEO

### Une requête principale par page

- **Page d'accueil** : « psychopraticienne / thérapeute à Montpellier »
- **Pages services** (à créer) :
  - « thérapie individuelle Montpellier »
  - « thérapie conjugale Montpellier »
  - « thérapie familiale Montpellier »
  - « troubles alimentaires Montpellier » (optionnel)

### Optimisation des balises Title / Meta description

Chaque page doit avoir des balises uniques. Exemple pour la home :

```
Title       : Psychopraticienne à Montpellier – Thérapie individuelle, conjugale et familiale
Meta desc.  : Cabinet de psychothérapie à Montpellier : accompagnement bienveillant pour l'anxiété,
              les troubles alimentaires, les difficultés de couple et familiales.
              Séances en présentiel et en visio.
```

---

## 2. Architecture des pages services

Créer 3–4 routes dédiées, chacune ciblant une intention de recherche précise :

| Route | Requête cible | Contenu recommandé |
|---|---|---|
| `/therapie-individuelle-montpellier` | thérapie individuelle Montpellier | Pour qui, problématiques, méthode, FAQ, CTA |
| `/therapie-conjugale-montpellier` | thérapie de couple Montpellier | Idem |
| `/therapie-familiale-montpellier` | thérapie familiale Montpellier | Idem |
| `/troubles-alimentaires-montpellier` | troubles alimentaires psy Montpellier | Idem |

Chaque page : H1 avec la requête cible, 600–1 000 mots, FAQ, appel à l'action vers Contact / Hellocare.

---

## 3. SEO local (GEO)

### Google Business Profile (priorité haute)

- Créer ou compléter la fiche établissement : nom, adresse (Espace Pitot, Place Jacques Mirouze), téléphone, horaires, lien site, prise de RDV Hellocare.
- Catégories : « Psychothérapeute », « Conseiller conjugal et familial ».

### Cohérence NAP (Name / Address / Phone)

Même orthographe, même adresse, même téléphone sur : site, Hellocare, Mappy, PagesJaunes, annuaires santé/bien-être.

### Ancrage géographique dans le contenu

Intégrer naturellement dans la home, la page Contact et les pages services : « cabinet situé à Montpellier, Espace Pitot, Place Jacques Mirouze », accessibilité, quartier, etc.

---

## 4. Maillage interne

- Chaque article de blog → lien vers les pages services correspondantes (ancres descriptives : « thérapie de couple à Montpellier », etc.).
- Chaque page service → lien vers Contact / prise de RDV.
- Home → lien vers chaque page service + blog.

---

## 5. Blog : plan éditorial SEO

1 article par mois minimum, centré sur les problèmes clients :

- « Comment savoir si mon anxiété nécessite une thérapie ? »
- « Manger ses émotions : quand consulter un thérapeute ? »
- « 5 signes qu'une thérapie de couple peut vous aider »
- « Thérapie familiale : à partir de quand consulter ? »

Chaque article : lien en fin de page vers la page service correspondante + page Contact.

---

## 6. Technique React / Helmet / Netlify

### 6.1 React Helmet — 1 set de balises par route

Dans chaque composant de page, déclarer un `<Helmet>` complet :

```jsx
<Helmet>
  <title>Thérapie conjugale à Montpellier – Oriane Montabonnet</title>
  <meta name="description" content="Accompagnement de couple à Montpellier..." />
  <link rel="canonical" href="https://omf-therapie.fr/therapie-conjugale-montpellier" />
  <script type="application/ld+json">{JSON.stringify(schemaLocalBusiness)}</script>
</Helmet>
```

Éviter un `<Helmet>` global unique appliqué à toutes les routes.

### 6.2 Prerendering Netlify (priorité haute)

- Activer dans **Settings → Build & deploy → Prerendering**.
- Ajouter dans `public/index.html` : `<meta name="fragment" content="!">`.
- Vérifier via l'outil d'inspection d'URL Google que les bots reçoivent bien du HTML rendu (avec titre, metas, contenu texte).

### 6.3 React Router — URLs propres + fallback Netlify

- Utiliser des routes sans hash : `/therapie-conjugale-montpellier` ✅, pas `/#/therapie-conjugale-montpellier` ❌.
- Fichier `public/_redirects` :
  ```
  /*    /index.html   200
  ```
- Créer une route 404 dédiée avec son propre `<Helmet>`.

### 6.4 Sitemap.xml + robots.txt

Créer manuellement dans le dossier `public/` (ou générer au build) :

**`public/sitemap.xml`** (exemple minimal) :
```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://omf-therapie.fr/</loc></url>
  <url><loc>https://omf-therapie.fr/therapie-individuelle-montpellier</loc></url>
  <url><loc>https://omf-therapie.fr/therapie-conjugale-montpellier</loc></url>
  <url><loc>https://omf-therapie.fr/therapie-familiale-montpellier</loc></url>
  <url><loc>https://omf-therapie.fr/contact</loc></url>
  <url><loc>https://omf-therapie.fr/blog/gerer-anxiete-quotidien-techniques-conseils</loc></url>
</urlset>
```

**`public/robots.txt`** :
```
User-agent: *
Allow: /
Sitemap: https://omf-therapie.fr/sitemap.xml
```

Soumettre le sitemap dans Google Search Console.

### 6.5 Structured data JSON-LD via Helmet

**LocalBusiness / ProfessionalService** (à injecter sur la home et les pages services) :

```js
const schemaLocalBusiness = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "name": "OMF Thérapie – Oriane Montabonnet",
  "url": "https://omf-therapie.fr",
  "telephone": "<numéro>",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Place Jacques Mirouze – Espace Pitot",
    "addressLocality": "Montpellier",
    "postalCode": "34000",
    "addressCountry": "FR"
  },
  "sameAs": ["<URL Hellocare>", "<URL Mappy>"]
};
```

**BlogPosting** (à injecter dans chaque article de blog) :

```js
const schemaBlogPosting = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "<titre de l'article>",
  "author": { "@type": "Person", "name": "Oriane Montabonnet" },
  "datePublished": "<date ISO>",
  "url": "<url canonique de l'article>"
};
```

---

## 7. UX, accessibilité et E-E-A-T

- **Balises ALT** sur toutes les images (descriptives et contextuelles).
- **Hiérarchie Hn** logique par page : 1 seul H1 = requête principale, H2 = sous-thèmes, H3 = détails.
- **Bloc FAQ** sur les pages services (confidentialité, durée du suivi, annulation, remboursement mutuelle) — balisable en `FAQPage` schema.org.
- **Signaux E-E-A-T** : mettre bien en avant diplômes, certifications (TCCE, thérapie conjugale/familiale, nutrition & psyché), et conditions de remboursement mutuelles sur la page d'accueil et la page "À propos".

---

## 8. Performance & Core Web Vitals

- **Code splitting** : `React.lazy` + `Suspense` par route pour ne pas tout charger sur la home.
- **Images** : formats compressés (WebP de préférence), dimensions adaptées, `loading="lazy"` sur les visuels hors viewport initial.
- **Suivi** : Google Search Console (Core Web Vitals) + Lighthouse / PageSpeed Insights.

---

## 9. Plan d'action priorisé

| # | Action | Impact | Effort | Délai suggéré |
|---|--------|--------|--------|---------------|
| 1 | Activer le prerender Netlify + vérifier HTML dans Search Console | ⬆⬆⬆ Élevé | Faible | Immédiat |
| 2 | Optimiser fiche Google Business Profile | ⬆⬆⬆ Élevé | Faible | Immédiat |
| 3 | Optimiser Title / meta de la home | ⬆⬆ Élevé | Faible | Immédiat |
| 4 | Créer `sitemap.xml` + `robots.txt` + soumettre dans Search Console | ⬆⬆ Élevé | Faible | Semaine 1 |
| 5 | Créer les 3–4 pages services (routes + Helmet + contenu + JSON-LD) | ⬆⬆⬆ Élevé | Moyen | 1–2 mois |
| 6 | Renforcer le maillage interne (blog → services → contact) | ⬆⬆ Moyen | Faible | Semaine 2 |
| 7 | Ajouter JSON-LD LocalBusiness sur home & services | ⬆⬆ Moyen | Faible | Semaine 2 |
| 8 | Lancer plan éditorial (1 article / mois) | ⬆⬆ Moyen / Long terme | Récurrent | Mois 1 → |
| 9 | Améliorer accessibilité (ALT, contrastes, Hn) | ⬆ Moyen | Faible | Mois 1 |
| 10 | Code splitting + optimisation images | ⬆ Moyen | Moyen | Mois 2–3 |

---

## 10. Faut-il changer de framework ?

**Recommandation : non à court terme (6–12 mois).**

En appliquant les optimisations ci-dessus (prerender Netlify + Helmet + sitemap), la SPA React peut atteindre un niveau SEO satisfaisant pour un site vitrine de cette taille.

**Un changement vers Astro ou Next.js (SSG) devient pertinent si :**
- Le volume de contenu augmente significativement (>20 pages, blog riche).
- La simplification technique est souhaitée (plus de dépendance au prerender tiers).
- Une refonte graphique est de toute façon planifiée.

| Critère | React SPA (actuel) | Next.js SSG | Astro |
|---|---|---|---|
| SEO out-of-the-box | ⚠️ Nécessite prerender | ✅ Natif | ✅ Natif |
| Performance (CWV) | Moyen | Bon | Excellent |
| Courbe de migration | — | Faible (même syntaxe React) | Modérée |
| Idéal pour | App dynamique | Site + app | Site éditorial |
| Déploiement Netlify | ✅ | ✅ | ✅ |
