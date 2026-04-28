---
issue: 15
title: "Système de prise de rendez-vous intégré (remplacement Psychologue.net)"
type: feature
complexity: XL
tier: F-full
---

## Problem

Le site omf-therapie.fr délègue actuellement la prise de rendez-vous à Psychologue.net (lien externe dans la navbar). La résiliation de cet abonnement impose de construire une solution complète et souveraine directement sur le site.

## Current State

### Ce qui existe
- **Navbar** → `NavigationItems.tsx` : lien "RDV en ligne" → `https://www.psychologue.net/cabinets/oriane-montabonnet` (à remplacer)
- **Email** → `useContactForm.ts` + `@emailjs/browser` : formulaire de contact client-side (à migrer vers Resend)
- **Layout** → `Layout.astro` : aucune gestion d'authentification
- **Astro** → `output: 'static'` : tout est SSG, aucune route serveur n'existe
- **Netlify Functions** : aucune (`netlify/functions/` n'existe pas)
- **Base de données** : aucune (site entièrement statique)

### Ce qui manque (gap analysis)
| Besoin | Existant | Gap |
|--------|----------|-----|
| Disponibilités (Google Calendar) | ❌ | API route + Google Calendar API |
| Formulaire de réservation | ❌ | Page `/rendez-vous` + island React |
| Stockage des demandes | ❌ | Supabase PostgreSQL |
| Auth backoffice | ❌ | BetterAuth (compte unique) |
| Dashboard `/mes-rdvs` | ❌ | Page SSR + Supabase query |
| Emails transactionnels | Partiel (EmailJS contact) | Migration Resend + templates |
| Paiement Stripe | ❌ | Stripe Payment Links + webhook |
| Confirmation ICS/Calendrier | ❌ | ICS generation + lien Google Calendar |
| Rappel J-1 | ❌ | Netlify Scheduled Function |
| Sollicitation avis | ❌ | Bouton + email template Resend |

## Impact

- **Patients** : plus de prise de RDV possible si Psychologue.net résiliée sans alternative
- **Thérapeute** : perte du flux de travail actuel (notifications, gestion agenda)
- **Sévérité** : High — fonctionnalité cœur de métier

## Files Affected (estimation)

```
astro.config.mjs                          # output: hybrid
netlify.toml                              # CSP update (Stripe, Resend, Google APIs)
src/
  pages/
    rendez-vous.astro                     # NEW: formulaire réservation (SSG + island)
    login.astro                           # NEW: page login (SSR)
    mes-rdvs.astro                        # NEW: dashboard thérapeute (SSR)
    rdv/
      merci.astro                         # NEW: page post-paiement (SSR)
    api/
      appointments.ts                     # NEW: POST/GET appointments
      appointments/[id].ts                # NEW: PATCH (accept/refuse/reschedule)
      auth/[...all].ts                    # NEW: BetterAuth handler
      availability.ts                     # NEW: GET Google Calendar slots
      stripe-webhook.ts                   # NEW: Stripe webhook handler
      send-review-email.ts                # NEW: POST sollicitation avis
      contact.ts                          # NEW: migration EmailJS → Resend
  components/
    booking/
      BookingForm.tsx                     # NEW: island formulaire RDV
      BookingCalendar.tsx                 # NEW: sélection créneaux
      BookingConfirmation.tsx             # NEW: récap avant validation
    admin/
      AppointmentList.tsx                 # NEW: liste RDV thérapeute
      AppointmentCard.tsx                 # NEW: carte RDV + actions
      ReviewEmailModal.tsx                # NEW: modal envoi avis
    navigation/
      NavigationItems.tsx                 # MODIFIED: remplacer lien Psychologue.net
  hooks/
    useBookingForm.ts                     # NEW
    useAppointments.ts                    # NEW
    useContactForm.ts                     # MODIFIED: EmailJS → Resend API route
  lib/
    supabase.ts                           # NEW: client Supabase
    google-calendar.ts                    # NEW: Google Calendar API wrapper
    resend.ts                             # NEW: Resend client + templates
    stripe.ts                             # NEW: Stripe client + helpers
    auth.ts                               # NEW: BetterAuth config
    ics.ts                                # NEW: ICS file generation
    pricing.ts                            # NEW: tarif calculator
  types/
    appointment.ts                        # NEW: types RDV
  config/
    global.config.ts                      # MODIFIED: suppr EmailJS keys, add pricing config
```

**Total : ~28 fichiers nouveaux ou modifiés**

## Approach Options

### Option A — Astro Hybrid + BetterAuth + Supabase ✅ RECOMMENDED

**Architecture :**
- `output: 'hybrid'` → pages publiques restent SSG, pages admin + API routes = SSR via Netlify Functions
- API routes = `src/pages/api/*.ts` → compilées automatiquement en Netlify Functions par `@astrojs/netlify`
- BetterAuth avec adaptateur Supabase → session stockée en DB, cookies HttpOnly
- Supabase PostgreSQL (EU) → données RDV + sessions auth
- Resend → tous les emails transactionnels (migration formulaire contact incluse)
- Google Calendar API → service account (lecture disponibilités + création événements)
- Stripe Payment Links → générés via API Stripe, envoyés par email

**Flux de données :**
```
[Public]   /rendez-vous → BookingCalendar (island) → GET /api/availability → Google Calendar
                        → BookingForm (island) → POST /api/appointments → Supabase + Resend

[Auth]     /login → BetterAuth (/api/auth/*) → cookie HttpOnly → redirect /mes-rdvs

[Admin]    /mes-rdvs (SSR) → GET /api/appointments → Supabase
                           → PATCH /api/appointments/[id] (accept/refuse/reschedule)
                             → si visio : Stripe Payment Link → Resend
                             → si présentiel : Resend (confirmation + ICS)

[Webhook]  POST /api/stripe-webhook → Supabase (statut paid) → Resend (confirmation) → Google Calendar

[Cron]     Netlify Scheduled Function → Supabase (rdv J-1 non rappelés) → Resend (rappel)
```

**Pros :**
- Reste dans l'écosystème Astro existant (pas de nouveau framework)
- `@astrojs/netlify` gère la compilation SSR → Functions automatiquement
- BetterAuth v1.6.9 : moderne, Astro-compatible, cookie-based, adaptateur Supabase natif
- Supabase free tier suffisant (quota généreux pour un cabinet solo)
- Séparation nette : SSG (pages publiques) | SSR (admin) | API (serverless)

**Cons :**
- Migration `output: 'hybrid'` requiert test de non-régression sur toutes les pages statiques
- Google Calendar API (service account OAuth) : setup initial complexe
- BetterAuth : library moins mature que NextAuth mais adaptée Astro

**Risk : Medium**

---

### Option B — Astro Static + Netlify Identity + Netlify Functions

**Architecture :**
- Garder `output: 'static'`
- Netlify Identity pour l'auth (service natif Netlify)
- Netlify Functions séparées (`netlify/functions/*.ts`)
- Admin = React SPA island

**Pros :**
- Auth hébergée par Netlify (zéro config)
- Pas de changement du mode Astro

**Cons :**
- Netlify Identity : plan gratuit limité à 1000 users/mois, UI datée
- Admin comme SPA island = architecture fragile, hydration complexe
- Functions séparées = organisation code dispersée vs API routes Astro co-localisées

**Risk : High**

---

### Option C — Service tiers tout-en-un (Calendly + Stripe)

**Architecture :**
- Intégrer Calendly (embed widget) pour la sélection de créneaux
- Stripe Checkout pour les paiements
- Pas de backoffice custom → Calendly dashboard

**Pros :**
- Développement minimal
- Calendly gère l'intégration Google Calendar nativement

**Cons :**
- Coût mensuel Calendly (plan Stripe = ~$16/mois)
- Pas de backoffice custom (actions accept/refuse/sollicitation avis = impossible)
- Dépendance externe (même problème qu'avec Psychologue.net)
- Branding limité (UI Calendly, pas Omf-Thérapie)

**Risk : Low (technique) / High (business — ne répond pas au besoin)**

## Recommendation

**Option A — Astro Hybrid + BetterAuth + Supabase**

C'est la seule option qui répond à l'ensemble du cahier des charges :
- Contrôle total du backoffice (`/mes-rdvs`)
- Branding complet (emails Resend, pages sur mesure)
- Pas de nouvelle dépendance externe payante
- Cohérence avec l'architecture Astro existante

## Data Model (Supabase)

```sql
-- Demandes de rendez-vous
CREATE TABLE appointments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT NOT NULL DEFAULT 'pending',
  -- pending | confirmed | refused | rescheduled | cancelled | paid
  type         TEXT NOT NULL, -- individual | couple | family
  mode         TEXT NOT NULL, -- in-person | video
  duration     INT  NOT NULL, -- 60 | 90
  price        NUMERIC(6,2) NOT NULL,
  first_session BOOLEAN DEFAULT false,
  solidarity   BOOLEAN DEFAULT false,
  slot_start   TIMESTAMPTZ,
  slot_end     TIMESTAMPTZ,
  -- Patient
  patient_name       TEXT NOT NULL,
  patient_email      TEXT NOT NULL,
  patient_phone      TEXT NOT NULL,
  patient_postal     TEXT,
  patient_city       TEXT,
  reason             TEXT CHECK (char_length(reason) <= 1500),
  -- Integrations
  stripe_payment_link   TEXT,
  stripe_payment_status TEXT, -- null | pending | paid
  stripe_session_id     TEXT,
  google_event_id       TEXT,
  meet_link             TEXT,
  -- Tracking
  reminder_sent_at      TIMESTAMPTZ,
  review_email_sent_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions BetterAuth (géré automatiquement)
-- tables : user, session, account, verification (créées par BetterAuth CLI)
```

## Appetite

**Tier F-full confirmé.** Estimation : 6–8 jours de développement en tranches verticales :
1. Infrastructure (Supabase + BetterAuth + Resend + Astro hybrid)
2. Formulaire de réservation public
3. Disponibilités Google Calendar
4. Backoffice `/mes-rdvs` + actions
5. Stripe (visio) + Webhook
6. Emails transactionnels (templates brandés)
7. Rappel J-1 (Scheduled Function) + ICS
8. Sollicitation d'avis + migration EmailJS → Resend
