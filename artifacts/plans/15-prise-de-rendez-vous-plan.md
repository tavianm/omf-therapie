---
issue: 15
tier: F-full
spec: artifacts/specs/15-prise-de-rendez-vous-spec.md
status: approved
---

## Overview

Implémentation du système de prise de rendez-vous en 8 slices. Architecture : Astro hybrid + BetterAuth + Supabase + Resend + Stripe + Google Calendar API.

## Tasks

| ID  | Description | Agent | Fichiers clés | Dépend de | Parallel? |
|-----|-------------|-------|---------------|-----------|-----------|
| T01 | Astro hybrid mode + MAJ CSP Netlify | devops | `astro.config.mjs`, `netlify.toml` | — | Y |
| T02 | Supabase schema SQL (appointments + BetterAuth tables) + client + types RDV | backend-dev | `src/lib/supabase.ts`, `src/types/appointment.ts`, `supabase/migrations/001_init.sql` | T01 | Y |
| T03 | BetterAuth config (credentials, compte unique) + handler `/api/auth/[...all].ts` + page `/login` | backend-dev | `src/lib/auth.ts`, `src/pages/api/auth/[...all].ts`, `src/pages/login.astro` | T02 | N |
| T04 | Resend client + helper d'envoi + template HTML de base (base layout brandé Omf-Thérapie) | backend-dev | `src/lib/resend.ts`, `src/emails/BaseLayout.tsx` | T01 | Y |
| T05 | Google Calendar API (service account) + endpoint `GET /api/availability` | backend-dev | `src/lib/google-calendar.ts`, `src/pages/api/availability.ts` | T01 | Y |
| T06 | Pricing lib (calcul tarif type×durée×première séance) + `src/lib/ics.ts` (génération ICS) | backend-dev | `src/lib/pricing.ts`, `src/lib/ics.ts` | — | Y |
| T07 | `POST /api/appointments` (persist Supabase + email Resend vers thérapeute) | backend-dev | `src/pages/api/appointments.ts` | T02, T04 | N |
| T08 | Islands BookingCalendar + BookingForm + page `/rendez-vous` (SSG+island) | frontend-dev | `src/pages/rendez-vous.astro`, `src/components/booking/BookingCalendar.tsx`, `src/components/booking/BookingForm.tsx`, `src/hooks/useBookingForm.ts` | T05, T06, T07 | N |
| T09 | 7 templates React Email (demande, confirmation présentiel, confirmation vidéo, refus, reschedule, rappel, avis) | frontend-dev | `src/emails/AppointmentRequest.tsx`, `src/emails/ConfirmationPresential.tsx`, `src/emails/ConfirmationVideo.tsx`, `src/emails/Refused.tsx`, `src/emails/Reschedule.tsx`, `src/emails/Reminder.tsx`, `src/emails/ReviewRequest.tsx` | T04 | Y |
| T10 | `PATCH /api/appointments/[id]` (accept/refuse/reschedule) + email Resend (présentiel) + ICS | backend-dev | `src/pages/api/appointments/[id].ts` | T02, T04, T06, T09 | N |
| T11 | Stripe lib + génération Payment Link + `POST /api/stripe-webhook` + update statut Supabase | backend-dev | `src/lib/stripe.ts`, `src/pages/api/stripe-webhook.ts` | T02, T04, T09 | N |
| T12 | Dashboard `/mes-rdvs` SSR + islands AppointmentList + AppointmentCard + ReviewEmailModal | frontend-dev | `src/pages/mes-rdvs.astro`, `src/components/admin/AppointmentList.tsx`, `src/components/admin/AppointmentCard.tsx`, `src/components/admin/ReviewEmailModal.tsx`, `src/hooks/useAppointments.ts` | T03, T10, T11 | N |
| T13 | Page `/rdv/merci` (SSR post-paiement Stripe) | frontend-dev | `src/pages/rdv/merci.astro` | T11 | Y |
| T14 | `POST /api/send-review-email` | backend-dev | `src/pages/api/send-review-email.ts` | T04, T09 | Y |
| T15 | Netlify Scheduled Function rappel J-1 | devops | `netlify/functions/reminder-cron.ts`, `netlify.toml` (scheduled config) | T04, T09 | Y |
| T16 | Navbar auth-aware (lien "Mes RDV" conditionnel) + `NavigationItem` type `adminOnly` | frontend-dev | `src/types/navigation.ts`, `src/components/navigation/NavigationItems.tsx`, `src/components/islands/Navbar.tsx` | T03 | Y |
| T17 | Remplacer lien Psychologue.net → `/rendez-vous` + migration EmailJS → Resend (`/api/contact` + `useContactForm.ts`) | frontend-dev | `src/components/navigation/NavigationItems.tsx`, `src/hooks/useContactForm.ts`, `src/pages/api/contact.ts`, `package.json` | T04 | N |
| T18 | Security audit : auth guard SSR, Stripe webhook signature, RLS Supabase, CSP headers | security-auditor | Tous les fichiers API + `netlify.toml` | T03, T10, T11, T12 | N |

## Agent Slices

**backend-dev:** T02, T03, T04, T05, T06, T07, T10, T11, T14
**frontend-dev:** T08, T09, T12, T13, T16, T17
**devops:** T01, T15
**security-auditor:** T18 (après T03, T10-T12)

## Séquence d'exécution recommandée

```
Vague 1 (parallèle) : T01, T04, T05, T06
Vague 2 (parallèle) : T02 (après T01), T09 (après T04)
Vague 3 (séquentiel) : T03 (après T02)
Vague 4 (parallèle) : T07, T10, T11 (après T02, T04, T09)
Vague 5 (parallèle) : T08, T12, T13, T14, T15, T16 (selon dépendances)
Vague 6 : T17 (finalisation + migration)
Vague 7 : T18 (audit sécurité avant PR)
```

## Variables d'environnement requises (Netlify)

```env
# Supabase
SUPABASE_DATABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# BetterAuth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://omf-therapie.fr

# Google Calendar
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_CALENDAR_ID=

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=contact@omf-therapie.fr

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=

# Admin
ADMIN_EMAIL=contact@omf-therapie.fr
```

## Quality Gate

```bash
npm run lint && npm run build
```

## Notes d'implémentation

- **Astro `output: 'hybrid'`** : les pages SSR doivent explicitement `export const prerender = false`. Les autres restent SSG par défaut.
- **BetterAuth compte unique** : créer le compte admin via script de seed (CLI BetterAuth) avant déploiement.
- **Google Calendar** : utiliser un service account (pas OAuth utilisateur) → partager l'agenda de la thérapeute avec l'email du service account.
- **Stripe webhook** : vérifier la signature avec `stripe.webhooks.constructEvent` (T18 vérifie).
- **ICS** : générer avec la lib `ical.js` ou manuellement (format RFC 5545) — lien `data:text/calendar` dans l'email.
- **Navbar auth** : l'état d'authentification est détecté côté serveur (SSR) dans les pages Astro, passé en prop au Navbar island.
- **CSP** : ajouter `https://js.stripe.com`, `https://api.stripe.com`, `https://resend.com`, `https://supabase.co` dans `netlify.toml`.
