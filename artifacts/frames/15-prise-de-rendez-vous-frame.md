---
issue: 15
title: "Système de prise de rendez-vous intégré (remplacement Psychologue.net)"
status: approved
tier: F-full
created: 2026-04-28
---

## Problem Statement

La thérapeute Oriane Montabonnet souhaite résilier son abonnement Psychologue.net et doit donc remplacer la fonctionnalité de prise de rendez-vous fournie par cette plateforme par une solution souveraine, directement intégrée sur **omf-therapie.fr**.

La nouvelle solution doit couvrir l'intégralité du cycle de vie d'un rendez-vous : demande → validation → paiement (visio) → confirmation → suivi (avis).

## Why This Matters

- **Coût** : Résiliation de l'abonnement Psychologue.net (dépendance externe éliminée)
- **Contrôle** : La thérapeute gère ses créneaux via Google Calendar (outil déjà en place)
- **Expérience patient** : Parcours unifié sur le site, sans redirection externe
- **Conformité RGPD** : Données hébergées dans un environnement maîtrisé

## Success Criteria

- [ ] Un patient peut consulter les créneaux disponibles via Google Calendar et en sélectionner un
- [ ] Le formulaire de réservation collecte : type (individuel/couple/familial), mode (présentiel mercredi uniquement / visio), durée, Nom, Email, Téléphone, CP/Ville, motif (max 1500 chars)
- [ ] La thérapeute reçoit un email Resend à chaque nouvelle demande
- [ ] /login fonctionne avec BetterAuth (compte unique, protégé)
- [ ] /mes-rdvs est accessible uniquement aux utilisateurs authentifiés
- [ ] La thérapeute peut Accepter / Refuser / Proposer un autre créneau
- [ ] Les RDV visio déclenchent l'envoi d'un lien de paiement Stripe par email (brandé Omf-Thérapie)
- [ ] Après paiement (visio) ou acceptation (présentiel) → email de confirmation brandé avec lien d'ajout au calendrier (ICS/Google Calendar)
- [ ] Bouton de sollicitation d'avis (Google Business, Pages Jaunes, Psychologue.net) depuis la liste
- [ ] Rappel automatique J-1 par email au patient
- [ ] Migration du formulaire de contact existant d'EmailJS vers Resend

## Constraints

- **Hébergement** : Netlify (déploiement actuel, pas de changement d'infra)
- **Astro** : Passage de `output: 'static'` à `output: 'hybrid'` nécessaire pour SSR admin
- **Auth** : BetterAuth — compte unique thérapeute, aucun système multi-utilisateurs
- **Paiement** : Stripe Payment Links (pas de checkout custom) — visio uniquement
- **Calendrier** : Google Calendar API (OAuth service account) — lecture des disponibilités + création d'événements à confirmation
- **RGPD** : Données patient hébergées sur Supabase (EU), PAS de données sensibles côté client
- **Design** : Tailwind CSS uniquement, cohérence avec la charte graphique actuelle (couleurs sage/mint)
- **Accessibilité** : WCAG 2.1 AA maintenu, pa11y doit passer

## Architecture Decision

### Stack ajoutée
| Composant | Solution retenue | Justification |
|-----------|-----------------|---------------|
| Base de données | **Supabase** (PostgreSQL, EU) | Intégration Netlify éprouvée, RLS natif, free tier |
| Auth | **BetterAuth** | Moderne, Astro-compatible, unique admin, OAuth-ready |
| Email transactionnel | **Resend** | Templates React, fiabilité, remplace EmailJS |
| Paiement | **Stripe** (Payment Links) | Le plus simple sans backend dédié |
| Google Calendar | **Google Calendar API** (service account) | Lecture dispo + création événements |

### Changement architectural clé
- `output: 'static'` → `output: 'hybrid'` dans `astro.config.mjs`
- Pages publiques : restent SSG (aucun impact perf)
- Pages admin (`/login`, `/mes-rdvs`) : SSR via Netlify Functions
- Routes API (`/api/*`) : Netlify Functions (serverless)

### Flux de données
```
Patient         →  /rendez-vous (SSG island)
                →  Google Calendar API (disponibilités)
                →  POST /api/appointments (Netlify Fn)
                →  Supabase (persist demande)
                →  Resend (email thérapeute)

Thérapeute      →  /login (SSR + BetterAuth)
                →  /mes-rdvs (SSR + Supabase)
                →  Action Accept/Refuse/Proposer
                →  Resend (email patient)
                →  Stripe (lien paiement si visio)

Stripe Webhook  →  /api/stripe-webhook
                →  Supabase (update statut)
                →  Resend (email confirmation patient + CC thérapeute)
                →  Google Calendar (création événement confirmé)

Rappel J-1      →  Netlify Scheduled Function (cron)
                →  Resend (email rappel patient)
```

## Out of Scope

- Système de réservation multi-thérapeutes
- Portail patient avec historique (pas de compte patient)
- Paiement en espèces/chèque via le site
- Intégration Doctolib ou autre plateforme santé
- Vidéo-conférence intégrée (lien Google Meet fourni dans le mail)
- Statistiques avancées (juste bouton export CSV basique)
- Support multilingue

## Stakeholders

- **Oriane Montabonnet** (thérapeute) — gestionnaire du backoffice, bénéficiaire principal
- **Patients** — utilisateurs du formulaire de prise de RDV
- **Stripe / Google / Supabase / Resend** — services tiers

## Appetite

**Tier: F-full**
Complexité architecturale élevée : 6 domaines (Auth, Calendar, Payments, Email, DB, Admin UI), changement du mode de rendu Astro, nouveaux services tiers. Estimé à >1 semaine de développement.

## Pricing Grid (from site)

| Type | 60 min | 90 min | 1ère séance |
|------|--------|--------|-------------|
| Individuel | 50€ | 65€ | -15€ |
| Couple (conjugale) | 75€ | 90€ | -15€ |
| Familial | 85€ | 100€ | -15€ |
| Tarifs solidaires (RSA/ASS/Étudiant) | -10€/séance | — | avec justificatif |

Prix calculé dynamiquement dans le formulaire selon type + durée sélectionnés.

## Pages supplémentaires

- `/rdv/merci` — page de confirmation publique après paiement Stripe réussi (SSR, récupère statut depuis Supabase via query param token)

## Open Questions résolues

- **Tarifs** : récupérés depuis la grille existante du site (cf. ci-dessus)
- **Google Meet** : lien créé manuellement par la thérapeute et inséré dans le mail de confirmation
- **Page post-paiement** : `/rdv/merci` souhaitée
