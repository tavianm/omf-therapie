---
issue: 43
title: "Intégrer Google Analytics 4 (GA4) avec consentement RGPD"
tier: F-lite
status: approved
---

## Goal

Intégrer GA4 (ID: `G-JFZBWJN781`) avec conformité RGPD/CNIL complète afin de remonter les conversions (demandes de RDV) dans Google Ads et permettre l'optimisation des campagnes.

## Context

Le site est un Astro 5 statique (`output: 'static'`) déployé sur Netlify. La mise en page centrale est `src/layouts/Layout.astro` qui contient le `<head>` partagé par toutes les pages.

La page de conversion principale est `src/pages/rdv/merci.astro` — elle est rendue en SSR (`prerender = false`) et reçoit un `variant` URL param (`request-submitted`, `payment-success`, etc.) permettant d'identifier une conversion réussie.

L'implémentation suit le guide https://daniel.es/blog/the-ultimate-astro-google-analytics-guide/ — approche avec Partytown + CookieConsent V3 + consent mode par défaut refusé.

## Acceptance Criteria

- [ ] AC1 — Le script GA4 ne se charge PAS en développement (`npm run dev`) — uniquement en production (`import.meta.env.PROD`)
- [ ] AC2 — Le Tracking ID est lu depuis la variable d'environnement `PUBLIC_GA4_ID` (jamais hardcodé dans le source)
- [ ] AC3 — Par défaut, le consentement analytics est refusé (`analytics_storage: 'denied'`) avant toute interaction utilisateur
- [ ] AC4 — Une bannière de consentement cookie RGPD s'affiche au premier chargement pour les nouveaux visiteurs
- [ ] AC5 — Après acceptation, `analytics_storage` passe à `'granted'` et GA4 collecte les données de session
- [ ] AC6 — Le script GA4 s'exécute via Partytown (Web Worker) — vérifiable par `type="text/partytown"` dans le DOM
- [ ] AC7 — Un événement `appointment_requested` est envoyé à GA4 lors du chargement de `/rdv/merci` avec un variant de succès (`request-submitted` ou `payment-success`)
- [ ] AC8 — La bannière cookie est accessible au clavier et ne crée aucune régression pa11y (audit `npm run audit:a11y` vert)
- [ ] AC9 — `.env.local.example` documente la variable `PUBLIC_GA4_ID`
- [ ] AC10 — La variable `PUBLIC_GA4_ID` est configurée dans les variables d'environnement Netlify (documentée dans le PR)

## Breadboard

| Surface | Action | Handler | Data |
|---------|--------|---------|------|
| `Layout.astro` head | Chargement page | Partytown + GA4 script (`type="text/partytown"`) | `PUBLIC_GA4_ID`, consent mode default denied |
| `Layout.astro` head | Chargement page | CookieConsent V3 script (main thread) | Config RGPD, catégorie analytics |
| Bannière CookieConsent | Utilisateur accepte | `gtag('consent', 'update', { analytics_storage: 'granted' })` | forwarded via `dataLayer.push` → Partytown |
| Bannière CookieConsent | Utilisateur refuse | Consent reste `denied`, aucun tracking | — |
| `/rdv/merci` | Page chargée (variant succès) | `<script>` inline → `gtag('event', 'appointment_requested')` | `variant`, `type`, `mode` params |

## Slices

**Slice 1 — Partytown setup:** Installer `@astrojs/partytown`, configurer dans `astro.config.mjs` avec `forward: ['dataLayer.push']` pour permettre à CookieConsent (main thread) de mettre à jour le consent dans le worker. (fichiers: `astro.config.mjs`, `package.json`)

**Slice 2 — GA4 dans Layout.astro:** Ajouter dans le `<head>` les deux scripts GA4 avec `type="text/partytown"`, protégés par `import.meta.env.PROD` et le consent mode par défaut refusé. Tracking ID lu depuis `Astro.env` ou `import.meta.env.PUBLIC_GA4_ID`. (fichiers: `src/layouts/Layout.astro`)

**Slice 3 — Bannière CookieConsent V3:** Ajouter le script CookieConsent V3 (CDN ou npm) dans `Layout.astro` avec une configuration française, catégorie `analytics` qui update le consent GA4 à l'acceptation/refus. CookieConsent s'exécute dans le **main thread** (pas Partytown). (fichiers: `src/layouts/Layout.astro`)

**Slice 4 — Événement de conversion sur `/rdv/merci`:** Ajouter un `<script is:inline>` conditionnel sur la page `/rdv/merci` qui fire `gtag('event', 'appointment_requested', { appointment_type, appointment_mode })` uniquement pour les variants `request-submitted` et `payment-success`. L'événement ne se déclenche que si le consent a été accordé (GA4 gère cela via le consent mode). (fichiers: `src/pages/rdv/merci.astro`)

**Slice 5 — Variables d'environnement:** Documenter `PUBLIC_GA4_ID=G-JFZBWJN781` dans `.env.local.example`. La valeur réelle est ajoutée dans Netlify env vars. (fichiers: `.env.local.example`)

## Technical Decisions

### Partytown vs. script async classique
Partytown est retenu pour ne pas bloquer le thread principal. Le site a un excellent score Lighthouse — on évite toute régression. Caveat: Partytown nécessite que les appels à `gtag()` depuis le main thread (CookieConsent) soient **forwardés** via `dataLayer.push`.

### CookieConsent V3 — main thread uniquement
CookieConsent affiche une UI et doit accéder au DOM — il ne peut PAS être exécuté dans un Web Worker. Il s'intègre avec GA4 Consent Mode v2 en appelant `gtag('consent', 'update', ...)` qui est forwardé à Partytown via `dataLayer.push`.

### Consent Mode v2 — default denied
Conformément aux directives CNIL 2024 : `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization` tous à `'denied'` par défaut. GA4 collecte uniquement des données anonymisées tant que le consentement n'est pas accordé.

### Variable d'environnement PUBLIC_
En Astro, les variables exposées côté client doivent avoir le préfixe `PUBLIC_`. `PUBLIC_GA4_ID` sera accessible via `import.meta.env.PUBLIC_GA4_ID` dans les fichiers `.astro`.

## Out of Scope

- Configuration de Google Tag Manager (GTM)
- Tracking d'événements avancés (scroll, video, heatmaps)
- Dashboard Analytics personnalisé
- Tests Playwright pour vérifier l'envoi des events GA4
- Configuration des objectifs dans Google Ads (côté client)

## Open Questions

- La bannière CookieConsent sera personnalisée aux couleurs du site (sage/mint), typographie Inter/Cormorant cohérente avec le design.
