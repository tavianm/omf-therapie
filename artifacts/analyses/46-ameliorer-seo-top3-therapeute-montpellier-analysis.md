---
issue: 46
title: "Améliorer le SEO pour cibler le top 3 sur 'thérapeute Montpellier' et termes associés"
type: feature
complexity: L
tier: F-full
---

## Problem

Le site omf-therapie.fr est invisible sur les requêtes Google à fort intent commercial dans la zone Montpellier. Malgré un socle technique correct (meta, OG, JSON-LD, canonical, sitemap), plusieurs lacunes structurelles empêchent d'atteindre le top 3.

---

## Current State — Audit SEO Complet

### ✅ Points forts existants

| Élément | État |
|---------|------|
| Meta title/description | ✅ Présents et optimisés avec "Montpellier" |
| Canonical URLs | ✅ Définis sur toutes les pages |
| Open Graph | ✅ Complet |
| JSON-LD (LocalBusiness, Person, Service, FAQ) | ✅ Présent — avantage vs concurrents |
| Sitemap.xml | ✅ Auto-généré par @astrojs/sitemap |
| robots.txt | ✅ Présent, correctement configuré |
| HTTPS | ✅ Netlify |
| Mobile-first | ✅ Tailwind responsive |
| Blog | ✅ 12 articles, 2 ciblés Montpellier |
| Pages de service dédiées | ✅ 4 services (individuel, couple, famille, TCA) |
| Google Search Console | ✅ Configurée |
| Google Business Profile | ✅ Configuré |

### 🔴 Lacunes critiques identifiées

#### 1. Schema.org — Type à vérifier selon statut professionnel
```
Actuel  : "@type": "HealthAndBeautyBusiness"
```

> ⚠️ **Attention au statut :** Le type `Psychologist` serait inapproprié car Oriane est **psychopraticienne** (non réglementée), pas psychologue (titre réglementé). Utiliser `Psychologist` en schema.org pourrait créer une confusion et une incohérence avec le contenu.

Le type `HealthAndBeautyBusiness` est acceptable mais peut être enrichi avec :
- `additionalType` pointant vers `https://schema.org/LocalBusiness`
- Une `description` précise incluant "psychopraticienne TCCE"

**Schemas manquants (sans ambiguïté de statut) :**
- `AggregateRating` dans LocalBusiness (avis Google → rich snippet étoiles)
- `BreadcrumbList` sur toutes les pages (breadcrumbs HTML existent mais pas en schema)
- `WebSite` avec `SearchAction` (sitelinks search box)
- `serviceType` et `termsOfService` enrichis dans les schemas de service

#### 2. Page "Anxiété" inexistante
La requête "anxiété aide psy" / "thérapeute anxiété Montpellier" n'a **aucune landing page dédiée**. Il n'existe qu'un article de blog généraliste. Or :
- L'anxiété est la spécialité la plus recherchée en thérapie (60%+ des consultations)
- Une page `/services/anxiete-montpellier` avec 1500+ mots capterait cette requête
- Les concurrents n'ont pas non plus cette page → opportunité de first-mover

#### 3. Profondeur de contenu insuffisante sur les pages de service
| Page | Mots de contenu (hors HTML) |
|------|---------------------------|
| therapie-individuelle.astro | ~788 mots |
| therapie-de-couple.astro | ~856 mots |
| Concurrents top 3 | ~2 353–3 308 mots/page |

Google valorise la **profondeur sémantique**. Les pages de service doivent atteindre **1 200–1 500 mots** pour compétir sur les requêtes transactionnelles.

#### 4. COMPANY_DESCRIPTION générique (impact E-E-A-T)
```typescript
// src/config/global.config.ts — actuel
export const COMPANY_DESCRIPTION = "Thérapeute professionnelle dédiée à votre bien-être et à votre développement personnel."
```
Cette description ne mentionne ni "Montpellier", ni la spécialité TCCE, ni les services clés. Elle alimente le schema `Person.description` et affecte le Knowledge Graph Google.

#### 5. E-E-A-T insuffisant pour le secteur YMYL (santé)
Google applique les critères E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) avec la plus grande rigueur dans le secteur santé (contenu YMYL — "Your Money or Your Life").

**Manque sur le site :**
- Numéro ADELI ou équivalent non mentionné (signal de légitimité professionnelle en France)
- Associations/syndicats professionnels non mentionnés
- Aucun témoignage patient (même anonymisé avec consentement)
- Author bio insuffisante dans les articles de blog (pas de lien vers la page À propos)
- `Person.hasCredential` en schema.ts présent mais trop vague (pas d'institution précise)

#### 6. Absence de citations locales (off-page local SEO)
Google Map Pack (3-pack local) requiert une présence dans les annuaires de confiance.

> ⚠️ **Note importante — statut professionnel :** Oriane est **psychopraticienne** (profession non réglementée) et non psychothérapeute ni psychologue (titres réglementés en France). **Doctolib est donc exclu** (réservé aux professions réglementées et secteur médical). Les annuaires cibles sont ceux du bien-être / paramédicaux.

| Annuaire | Présence actuelle | Impact |
|----------|-------------------|--------|
| therapeutes.com | ❓ Inconnu | 🔴 Élevé — spécifique psychopraticiens |
| annuaire-therapeutes.com | ❓ Inconnu | 🔴 Élevé |
| resalib.fr | ❓ Inconnu | 🟠 Élevé — agenda en ligne + annuaire |
| medoucine.com | ❓ Inconnu | 🟠 Élevé — médecines douces / bien-être |
| PagesJaunes.fr | ❓ Inconnu | 🟠 Élevé — fort signal local Google |
| psychologue.net | ❓ Inconnu | 🟠 Moyen — ouvert aux psychopraticiens |
| Instagram omf.therapie | ✅ Présent | 🟡 Moyen — signal sameAs |
| LinkedIn professionnel | ❓ Inconnu | 🟡 Moyen |

La cohérence NAP (Nom, Adresse, Téléphone) entre ces sources et le site est un facteur de ranking local majeur.

#### 7. Liaison interne (internal linking) incomplète
- Un seul article de blog (`therapie-couple-montpellier-guide.md`) pointe vers `/services/`
- Les 11 autres articles ne créent aucun lien entrant vers les pages de service
- Les pages de service ne se lient pas entre elles (ex : thérapie individuelle ne propose pas la thérapie de couple)
- Pas de lien depuis le blog vers `/contact` ou `/rendez-vous`

#### 8. Google Business Profile — optimisation partielle probable
Le GBP est configuré mais potentiellement sous-optimisé :
- Catégorie principale : devrait être "Psychothérapeute" ou "Psychologue" (pas "Thérapeute")
- Photos du cabinet (intérieur, extérieur) → signal de confiance
- Posts GBP mensuels → signal d'activité
- Gestion des avis → critical ranking factor pour le Local Pack

---

## Analyse concurrentielle

| Site | Title | Schema | Mots | Avantage clé |
|------|-------|--------|------|-------------|
| therapie-montpellier.com | Psychothérapie intégrative à Montpellier | ❌ | ~2 353 | Contenu riche, domaine ancré |
| therapeute-montpellier.fr | **Thérapeute Montpellier** - Hicham Hassa | ❌ | ~3 194 | **Exact keyword domain** (EMD) |
| gorana-psy-montpellier.com | Psychothérapeute à Montpellier | ❌ | ~3 308 | Domaine ancré, autorité |
| **omf-therapie.fr** | Oriane Montabonnet — Psychopraticienne | ✅ | ~800 | **JSON-LD complet, SSG, UX** |

**Constat :** Aucun concurrent n'utilise schema.org → avantage technique unique à consolider. Leur force réside dans l'ancienneté du domaine, les backlinks accumulés, et la profondeur de contenu.

---

## Impact

- **Utilisateurs affectés :** Patients potentiels à Montpellier ne trouvant pas le site
- **Sévérité :** high
- **Revenus affectés :** Directement (prise de RDV = CA)
- **Fichiers affectés :**
  - `src/utils/schema.ts` (schema.org)
  - `src/config/global.config.ts` (COMPANY_DESCRIPTION)
  - `src/pages/services/` (nouvelles pages + enrichissement)
  - `src/content/blog/` (liaison interne + nouveaux articles)
  - `src/pages/index.astro` (schema WebSite)
  - Toutes les pages `.astro` (BreadcrumbList schema)

---

## Approach Options

### Option A — Quick wins techniques (2–3 semaines)
**Périmètre :** Uniquement les modifications de code.
1. Fix schema.org : `Psychologist` + `AggregateRating` + `BreadcrumbList` + `WebSite`
2. COMPANY_DESCRIPTION optimisée
3. Nouvelle page `/services/anxiete-montpellier`
4. Enrichissement des meta titles (ajouter "thérapeute" sur la home)
5. Liens internes blog → services

**Pros :** Rapide, impact mesurable en 4–8 semaines, ne dépend que du développeur.
**Cons :** N'adresse pas l'autorité de domaine ni le gap de contenu.
**Risk :** medium — améliore le classement mais insuffisant seul pour le top 3.

### Option B — SEO Stack complet (2–6 mois) ⭐ RECOMMANDÉ
**Périmètre :** Option A + contenu + off-page.

**Phase 1 (semaines 1–2) — Technique :** Option A en intégralité
**Phase 2 (semaines 3–6) — Contenu :**
- Enrichissement pages de service → 1 500 mots
- Plan de blog : 1 article/mois ciblé requête locale (ex : "thérapie de couple Montpellier", "anxiété traitement Montpellier")
- Amélioration page À propos : ADELI, certifications précises, photo récente

**Phase 3 (mois 2–3) — Off-page :**
- Inscription therapeutes.com, resalib.fr, medoucine.com, PagesJaunes (NAP cohérent)
- Optimisation GBP : catégorie précise "psychopraticienne", photos, posts mensuels, demande d'avis aux patients consentants

**Phase 4 (mois 3–6) — Autorité :**
- Partenariats avec médecins généralistes locaux pour backlinks
- Articles invités sur blogs santé/bien-être Montpellier
- Associations professionnelles (FF2P, SNPPsy)

**Pros :** Stratégie complète pour le top 3. Traite les 3 piliers SEO (technique, contenu, autorité).
**Cons :** Nécessite implication de la praticienne (contenu). Timeline 6 mois.
**Risk :** low — best practice industry pour YMYL.

### Option C — Content-first (3–4 mois)
**Périmètre :** Expansion massive du contenu sans toucher au technique.
- 20+ articles de blog longue traîne
- Pages de service 2 000+ mots
- Vidéos de présentation intégrées

**Pros :** Autorité thématique forte long terme.
**Cons :** Impact plus lent, ne corrige pas les défauts techniques schema.
**Risk :** medium — Google peut ne pas valoriser le contenu sans fixes techniques.

---

## Recommendation

**Option B — SEO Stack complet**, avec priorité absolue sur la Phase 1 (technique) car elle génère un impact immédiat sans dépendances externes.

La clé du top 3 requiert les 3 leviers simultanément :
- **Technique :** schema `Psychologist` + page anxiété (différenciateur technique unique vs concurrents)
- **Contenu :** profondeur sémantique ≥ 1 500 mots (niveau des top 3 actuels)
- **Off-page :** Doctolib + annuaires (autorité locale, Map Pack)

---

## Analyse des mots-clés longue traîne

### Requêtes cibles principales (head terms)

| Requête | Intention | Concurrence estimée |
|---------|-----------|---------------------|
| thérapeute Montpellier | Transactionnelle | 🔴 Élevée |
| thérapie de couple Montpellier | Transactionnelle | 🟠 Moyenne |
| psychopraticienne Montpellier | Transactionnelle | 🟢 Faible (niche) |

### Longue traîne — opportunités faible concurrence

**Anxiété & stress (page à créer) :**
- "aide anxiété Montpellier" — intent fort, peu de landing pages dédiées
- "thérapie anxiété sociale adulte Montpellier"
- "thérapeute pour panique Montpellier"
- "accompagnement anxiété TCCE Montpellier"
- "comment gérer anxiété Montpellier"

**Couple :**
- "thérapie de couple Montpellier prix séance"
- "psychopraticien couple Montpellier"
- "thérapie conjugale après infidélité Montpellier"
- "communication couple thérapeute Montpellier"

**Famille & adolescents :**
- "thérapie familiale adolescent Montpellier"
- "thérapeute adolescent difficile Montpellier"
- "médiation familiale Montpellier séparation"

**Troubles alimentaires :**
- "aide troubles alimentaires Montpellier"
- "psychopraticien TCA Montpellier"
- "alimentation émotionnelle thérapeute Montpellier"
- "accompagnement boulimie Montpellier"

**Informationnel (blog) — capturer les "People Also Ask" :**
- "différence psychopraticien psychologue psychothérapeute"
- "comment choisir son thérapeute Montpellier"
- "thérapie TCCE c'est quoi"
- "thérapeute remboursé mutuelle Montpellier"
- "séance thérapie individuelle combien de temps"
- "thérapie couple sauver relation"

**Géographique (longue traîne locale) :**
- "thérapeute Castelnau-le-Lez"
- "psychopraticien Lattes"
- "thérapeute Pérols Hérault"
- "cabinet thérapie quartier Albert Einstein Montpellier"

### Stratégie de contenu par requête

| Type | Action | Requêtes ciblées |
|------|--------|-----------------|
| Page service | Créer `/services/anxiete-montpellier` | anxiété + Montpellier (head + longue traîne) |
| Page service | Enrichir `/services/therapie-de-couple` | couple Montpellier longue traîne |
| Blog article | "Psychopraticien vs psychologue : quelle différence ?" | différenciation + crédibilité |
| Blog article | "Thérapie de couple à Montpellier : tout ce qu'il faut savoir" | longue traîne couple |
| Blog article | "Aide pour l'anxiété à Montpellier : comprendre et trouver un soutien" | longue traîne anxiété locale |
| Blog article | "Thérapeute remboursé mutuelle : ce qu'il faut savoir" | requête informationnelle forte |

---

## Priorité des tâches (ordre d'impact)

| Priorité | Action | Impact | Effort | Délai effet |
|----------|--------|--------|--------|-------------|
| P0 | AggregateRating schema (avis → rich snippets) | 🔴 Élevé | Faible | 4–8 sem |
| P1 | Page `/services/anxiete-montpellier` (1500 mots) | 🔴 Élevé | Moyen | 4–8 sem |
| P2 | `BreadcrumbList` + `WebSite` schema | 🟠 Élevé | Faible | 4–8 sem |
| P3 | Enrichissement pages service → 1500 mots | 🟠 Élevé | Fort | 6–12 sem |
| P4 | COMPANY_DESCRIPTION + E-E-A-T about page | 🟠 Moyen | Faible | 4–8 sem |
| P5 | Liaison interne blog → services | 🟡 Moyen | Faible | 4–8 sem |
| P6 | GBP : photos + posts mensuels + catégorie | 🟠 Élevé | Moyen | 2–6 sem |
| P7 | Annuaires (therapeutes.com, resalib, PagesJaunes) | 🟠 Élevé | Moyen | 4–12 sem |
| P8 | Blog : 4 articles longue traîne locale/trimestre | 🟡 Moyen | Fort | 8–16 sem |

---

## Appetite

Estimated tier: F-full
Spike findings: Analyse concurrentielle directe réalisée (web scraping headers + schema audit). Aucun concurrent n'utilise JSON-LD — avantage à exploiter. Doctolib est LE premier résultat sur "thérapeute Montpellier" — présence indispensable.
