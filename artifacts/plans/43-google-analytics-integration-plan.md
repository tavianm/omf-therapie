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
| T3 | Intégrer CookieConsent V3 (main thread) avec style sage/mint et mise à jour du consent GA4 | frontend-dev | `src/layouts/Layout.astro` | T2 | N |
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

### T3 — CookieConsent V3 (Layout.astro)
- Import via CDN dans le `<head>` (main thread, PAS type="text/partytown")
- Config : langue `fr`, catégorie `analytics`, couleurs CSS vars sage/mint
- On accept analytics : `gtag('consent', 'update', { analytics_storage: 'granted' })`
- On reject analytics : consent reste `denied`
- Style CSS custom overrides dans `src/index.css` (variables CSS de CookieConsent)

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
