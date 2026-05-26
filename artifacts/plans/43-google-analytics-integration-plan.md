---
issue: 43
tier: F-lite
spec: artifacts/specs/43-google-analytics-integration-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Installer `@astrojs/partytown` et configurer dans `astro.config.mjs` avec `forward: ['dataLayer.push']` | devops | `astro.config.mjs`, `package.json` | — | Y |
| T2 | Ajouter les scripts GA4 (Partytown) + consent mode default denied dans `Layout.astro` | frontend-dev | `src/layouts/Layout.astro` | T1 | N |
| T3 | Intégrer CookieConsent V3 (main thread) avec style sage/mint WCAG AAA et mise à jour du consent GA4 | frontend-dev | `src/layouts/Layout.astro`, `src/index.css` | T2 | N |
| T4 | Ajouter l'événement de conversion `appointment_requested` sur `/rdv/merci` | frontend-dev | `src/pages/rdv/merci.astro` | T2 | N |
| T5 | Documenter `PUBLIC_GA4_ID` dans `.env.local.example` | devops | `.env.local.example` | — | Y |

## Budget

### Per task

| Task | Subject | Class | Est. ops |
|------|---------|-------|----------|
| T1 | analytics-infra | bounded | ~3 |
| T2 | analytics-scripts | bounded | ~3 |
| T3 | consent-ui | judgmental | ~5 |
| T4 | conversion-tracking | bounded | ~2 |
| T5 | env-config | trivial | ~1 |

### Per agent instance

| Instance | Tasks | Subjects | Est. ops | Action |
|----------|-------|----------|----------|--------|
| devops | T1, T5 | analytics-infra, env-config | ~4 | — |
| frontend-dev | T2, T3, T4 | analytics-scripts, consent-ui, conversion-tracking | ~10 | — |

## Agent Slices

**devops:** T1 (Partytown install + astro.config.mjs), T5 (env vars doc)
**frontend-dev:** T2 (GA4 scripts in Layout.astro), T3 (CookieConsent V3 custom), T4 (conversion event on /rdv/merci)

## Quality Gate

```bash
npm run lint && npm run build
```

(Pa11y audit post-deploy: `npm run audit:a11y`)

## Sequence

1. **T1 + T5** (parallel) — Partytown install + env var doc
2. **T2** — GA4 scripts dans Layout.astro (dépend de T1 pour Partytown)
3. **T3** — CookieConsent V3 dans Layout.astro (dépend de T2 pour ordre des scripts)
4. **T4** — Événement conversion sur /rdv/merci (dépend de T2 pour gtag disponible)

## Implementation Notes

### T1 — Partytown
```bash
npx astro add partytown
# Ajouter dans astro.config.mjs :
# partytown({ config: { forward: ['dataLayer.push'] } })
```

### T2 — GA4 scripts (Layout.astro)
Insérer avant `</head>`, protégé par `import.meta.env.PROD` :
```astro
{import.meta.env.PROD && (
  <>
    <script is:inline type="text/partytown"
      src={`https://www.googletagmanager.com/gtag/js?id=${import.meta.env.PUBLIC_GA4_ID}`}
    />
    <script is:inline type="text/partytown">
      window.dataLayer = window.dataLayer || [];
      function gtag(){ dataLayer.push(arguments); }
      gtag('js', new Date());
      gtag('consent', 'default', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
      gtag('config', '{GA4_ID}');
    </script>
  </>
)}
```

### T3 — CookieConsent V3 — Design Specs (UI/UX Pro Max)

> Style validé avec UI/UX Pro Max — recommandation "Accessible & Ethical" (WCAG AAA, healthcare/wellness).
> Adapté à la palette sage/mint existante du site (pas les couleurs cyan génériques recommandées).

#### Chargement
- Import CDN dans `<head>` (main thread, **PAS** `type="text/partytown"`)
- On accept analytics : `gtag('consent', 'update', { analytics_storage: 'granted' })`
- On reject analytics : consent reste `denied`

#### Layout & Position
- **Barre fixe en bas** (`position: fixed; bottom: 0`) — pas de modal bloquant
- `padding-bottom: env(safe-area-inset-bottom)` pour iOS safe area
- `max-width` aligné sur le contenu du site (`max-w-5xl`, centré)
- Ne jamais superposer avec la navbar (qui est fixe en haut)
- Fond : `bg-white` avec `border-t border-sage-100 shadow-lg`

#### Typographie & Texte
- Font : **Inter** (corps du site) — 14px (body), 15px (titre)
- Couleur texte : `text-sage-900` (principal), `text-sage-500` (secondaire)
- Line-height : 1.6 minimum
- Message : concis (≤2 lignes) — pas de mur de texte légal

#### Boutons (44×44px minimum — touch target)
| Bouton | Style Tailwind | Rôle ARIA |
|--------|---------------|-----------|
| **Accepter** | `bg-mint-600 hover:bg-mint-700 text-white px-5 py-2.5 rounded-lg font-medium` | Primary CTA |
| **Refuser** | `bg-white hover:bg-sage-50 text-sage-700 border border-sage-200 px-5 py-2.5 rounded-lg` | Secondary |
| **Personnaliser** | `text-sage-500 hover:text-sage-700 underline text-sm` | Tertiary (optionnel) |

#### Focus & Keyboard (WCAG AA requis)
- Focus ring visible : `focus:ring-2 focus:ring-mint-400 focus:ring-offset-2` sur tous les boutons
- `role="dialog"` + `aria-label="Consentement aux cookies"` sur le conteneur
- Focus initial sur le bouton "Accepter" à l'apparition de la bannière
- Touche `Escape` = refus + fermeture
- Tab cycle entre les boutons uniquement (pas de keyboard trap sur le reste de la page)
- `aria-live="polite"` sur le conteneur pour annonce screen reader

#### Animation (prefers-reduced-motion respecté)
- **Entrée** : `translateY(100%) → translateY(0)`, 200ms ease-out
- **Sortie** : `translateY(0) → translateY(100%)`, 150ms ease-in (plus rapide que l'entrée)
- **Si `prefers-reduced-motion: reduce`** : apparition/disparition instantanée (`transition: none`)
- 1 seul élément animé (la bannière elle-même) — pas d'animations supplémentaires

#### Variables CSS CookieConsent V3 (overrides dans `src/index.css`)
```css
/* CookieConsent V3 — custom theme OMF Therapie */
:root {
  --cc-bg: #ffffff;
  --cc-primary-color: #4a7c6f;        /* mint-600 approx */
  --cc-btn-primary-bg: #4a7c6f;
  --cc-btn-primary-hover-bg: #3d6b5f;
  --cc-btn-primary-text: #ffffff;
  --cc-btn-secondary-bg: #ffffff;
  --cc-btn-secondary-hover-bg: #f7f5f2;
  --cc-btn-secondary-text: #3d4f47;
  --cc-btn-secondary-border-color: #d1cdc8;
  --cc-text: #1a2e25;
  --cc-secondary-text: #6b7f74;
  --cc-border-radius: 0.75rem;        /* rounded-xl */
  --cc-font-family: 'Inter', sans-serif;
  --cc-link-color: #4a7c6f;
}
```

### T4 — Conversion event (/rdv/merci.astro)
Ajouter un `<script is:inline>` à la fin du `<Layout>` sur la page merci :
- Déclenche uniquement si `variant` est `request-submitted` ou `payment-success`
- Passe `variant` comme variable Astro inline dans le script
- Utilise `window.gtag?.()` (guard si GA4 non chargé en dev)
```astro
<script is:inline define:vars={{ variant, paramType, paramMode }}>
  if (typeof gtag !== 'undefined' &&
      (variant === 'request-submitted' || variant === 'payment-success')) {
    gtag('event', 'appointment_requested', {
      appointment_type: paramType,
      appointment_mode: paramMode,
      variant: variant,
    });
  }
</script>
```
