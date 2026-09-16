---
title: "chore(deps): upgrade astro 5→7 (amas CRITICAL npm audit) + nodemailer ^9.1.0"
issue: 170
status: approved
tier: F-full
date: 2026-09-14
---

## Problem

`npm audit` sur `main` remonte un amas critique centré sur `astro ^5.18.x` : XSS via `define:vars` (surface vivante actuelle), SSRF par Host-header sur les error-pages prérendues, RCE AVIF au build — les fixes n'existent qu'en **majeur 7** (astro 7.3.2). S'y ajoutent `@astrojs/netlify` (CVE allowlist Image CDN — latente, aucune `remotePatterns` configurée) et `@netlify/blobs` transitif (HIGH, fixé par l'upgrade de l'adapter), ainsi que `nodemailer ^9.0.3` (bypass IDN/punycode, DoS addressparser — fix non-breaking `^9.1.0`, chemin prod inutilisé : Resend est utilisé, SMTP_HOST seulement en dev). Origine : revue sécurité de la PR #166 (R-security-auditor, C85) — dette préexistante sur `main`, hors diff. État relevé à la frame : 48 vulnérabilités (1 critical / 24 high / 19 moderate / 4 low).

## Who

- **Primaire :** la mainteneuse — posture sécurité du site vitrine + poste de travail, gates CI fiables, déploiement Netlify sans surprise.
- **Secondaire :** les visiteurs et patientes — surface d'exposition XSS/SSRF réduite ; le parcours de prise de RDV (booking, paiement, emails) ne doit pas régresser.

## Constraints

- Gates complets avant PR : `test:low`, `lint`, `typecheck` (bloquant depuis #86 — AGENTS.md en drift sur ce point), `build`, `audit:a11y` — puis re-audit `npm audit` après upgrade.
- Upgrade **coordonné** : astro 7.x + `@astrojs/react` + `@astrojs/netlify` + `@astrojs/sitemap` + `@astrojs/tailwind` doivent rester peer-compatibles ; `@netlify/blobs` est fixé transitivement.
- Deux majeurs franchis (5→6→7) : breaking changes à inventorier (engines Node, config, Content Collections, APIs retirées, Vite) — travail de l'étape `/R-analyze`.
- Site monocompte en production : aucun changement métier attendu ; l'adapter Netlify touche le déploiement.
- Garde mémoire locale (AGENTS.md) : gates complets lancés une fois, séquentiellement, par le lead (`test:low`) ; agents sur fichiers ciblés uniquement.

## Out of Scope

- Workarounds page-code (l'issue les exclut explicitement — risque documenté en interim seulement).
- Adoption de nouveautés astro 7 (server islands, `basePath`, `remotePatterns`/Image CDN) : décisions séparées, même si la CVE allowlist reste latente tant que rien n'est configuré.
- Rework du transport email : Resend reste le chemin prod, nodemailer reste dev-only (Mailpit) — bump de version seulement.
- Majors satellites (React 19, Tailwind 4) sauf si imposés par les peer-deps du set coordonné — auquel cas flag explicite dans l'analyse.

## Premise Validity

**Success in 6 months:** `main` et la prod tournent sous astro 7.x ; `npm audit` ne remonte plus aucun critical ni high sur le cluster astro/@astrojs/@netlify/blobs/nodemailer ; tous les gates passent (test:low, lint, build, audit:a11y) et le parcours de RDV n'a pas régressé.

**Failure in 6 months:** au 2026-12-14, `main` est toujours (ou redevenu) astro 5.x avec le critical `npm audit` toujours présent — upgrade non atterri ou revert ; ou l'upgrade a atterri mais une régression booking/paiement a forcé un revert dans le cycle de release suivant.

**Simplest alternative:** `npm audit fix` non-breaking seul (nodemailer ^9.1.1 + bumps mineurs) et acceptation du risque documentée sur les criticals astro 5.
**Why not simplest:** les fixes astro (XSS `define:vars` sur surface vivante, SSRF Host-header sur error-pages prérendues) n'existent qu'en majeur 7 — l'audit resterait rouge sur le critical et la posture sécurité reste inacceptable au regard de la revue #166 à l'origine de l'issue.

## Complexity

**Tier: F-full** — double majeur 5→7 avec set d'intégrations coordonné et dépendance transitive (`@netlify/blobs`) ; rayon d'action sur la config de build, les îlots React, l'adapter Netlify et le transport email dev ; inconnues réelles (breaking changes 6/7, peer-deps React/Tailwind, engines Node).

Signaux observés : multi-domaines (build + islands + adapter + email), inconnues (breaking changes, compat peer-deps), pas de size label — tier confirmé F-full par l'utilisatrice à l'entrée du pipeline.
