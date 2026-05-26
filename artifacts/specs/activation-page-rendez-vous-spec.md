---
issue: ~
title: "Activation page rendez-vous — navigation & CTAs"
tier: F-lite
status: approved
---

## Goal

Tous les CTAs de conversion "Prendre rendez-vous" du site pointent vers `/rendez-vous/`, le lien "Contact" est retiré de la navbar, et le lien psychologue.net de conversion est remplacé.

## Context

La page `/rendez-vous` (booking wizard complet) est déjà live et fonctionnelle sur `feat/36-google-calendar-production-ready`. Le site comporte cependant ~14 liens qui envoient les visiteurs vers `/contact` ou `psychologue.net` au lieu du wizard. La navbar affiche encore "Contact" comme entrée séparée alors que "Prendre rendez-vous" y figure déjà.

Navigation source : `NavigationItems.tsx` → consommé par `Navbar.tsx` (island) → `DesktopNav` + `MobileNav`.

## Acceptance Criteria

- [ ] AC1 — L'entrée "Contact" est absente de la navbar desktop et mobile
- [ ] AC2 — La logique `isActive` dans `Navbar.tsx` gère `/rendez-vous` et ne référence plus `/contact` comme cas spécial
- [ ] AC3 — Les 4 pages de service (`therapie-individuelle`, `therapie-de-couple`, `therapie-familiale`, `troubles-alimentaires`) ont leurs 2 CTAs chacune pointant vers `/rendez-vous/`
- [ ] AC4 — Le CTA "Prendre rendez-vous" de `a-propos.astro` pointe vers `/rendez-vous/`
- [ ] AC5 — Le CTA de fin d'article dans `blog/[slug].astro` pointe vers `/rendez-vous/`
- [ ] AC6 — Le lien interne `/contact/` dans `rendez-vous.astro` pointe vers `/rendez-vous/`
- [ ] AC7 — Le lien `psychologue.net` (CTA booking) dans `contact.astro` pointe vers `/rendez-vous/`
- [ ] AC8 — Le CTA de `404.astro` pointe vers `/rendez-vous/`
- [ ] AC9 — `npm run lint` passe sans nouvelles erreurs
- [ ] AC10 — La page `/contact` reste accessible directement (aucune suppression de page)

## Breadboard

| Surface | Action | Handler | Résultat |
|---------|--------|---------|----------|
| Navbar desktop | Clic sur un lien de nav | `NavigationItems` → `DesktopNav` | "Contact" absent, "Prendre rendez-vous" présent |
| Navbar mobile | Ouverture menu | `NavigationItems` → `MobileNav` | "Contact" absent |
| Page service (×4) | Clic CTA principal | `<a href>` statique Astro | → `/rendez-vous/` |
| Page À propos | Clic CTA | `<a href>` statique Astro | → `/rendez-vous/` |
| Blog article | Clic lien de fin | `<a href>` statique Astro | → `/rendez-vous/` |
| Page Contact | Clic lien psychologue.net | `<a href>` statique Astro | → `/rendez-vous/` |
| Page 404 | Clic CTA | `<a href>` statique Astro | → `/rendez-vous/` |
| Page Rendez-vous | Lien interne `/contact/` | `<a href>` statique Astro | → `/rendez-vous/` |

## Slices

**Slice 1 — Navbar :** Retirer "Contact" de `NavigationItems.tsx`. Mettre à jour `isActive` dans `Navbar.tsx` : supprimer le cas spécial `/contact`, ajouter `/rendez-vous` si absent.
→ `src/components/navigation/NavigationItems.tsx`, `src/components/islands/Navbar.tsx`

**Slice 2 — Pages de service :** Remplacer `href="/contact"` → `href="/rendez-vous/"` dans les 2 occurrences de chaque page (btn-primary + lien inline).
→ `src/pages/services/therapie-individuelle.astro`, `therapie-de-couple.astro`, `therapie-familiale.astro`, `troubles-alimentaires.astro`

**Slice 3 — Pages éditoriales :** Remplacer les CTAs dans `a-propos.astro`, `blog/[slug].astro`, `rendez-vous.astro`, `contact.astro`, `404.astro`.
→ 5 fichiers Astro

## Out of Scope

- Suppression de la page `/contact` (reste accessible)
- Badges psychologue.net dans le footer (`FooterHours.tsx`, `Footer.astro`) — tâche dédiée prévue prochainement
- `rdv/accepter-report.astro` — liens `/contact/` dans un contexte spécifique de report RDV
- `accessibilite.astro` — lien `/contact` légitime pour signalement d'accessibilité
- Liens `mailto:contact@omf-therapie.fr` dans les emails transactionnels
- `footer.config.ts` — "Contact" en navigation secondaire du footer, conservé

## Open Questions

- Aucune — périmètre validé via frame approuvé.
