# Architecture

**Last Updated:** May 14, 2026

## Project Structure

```
omf-therapie/
├── public/                    # Static assets
│   ├── assets/               # Images, icons, favicons
│   ├── reports/              # Accessibility and performance reports
│   ├── CNAME                 # Custom domain config
│   └── robots.txt            # Search engine directives
├── src/
│   ├── components/           # Astro + React components
│   │   ├── admin/           # Admin dashboard (AppointmentCard, AdminCreateButton)
│   │   ├── blog/            # Blog-specific components
│   │   ├── common/          # Shared components
│   │   ├── contact/         # Contact page components
│   │   ├── footer/          # Footer components
│   │   ├── home/            # Home page sections
│   │   ├── islands/         # React islands (Navbar, BlogClientWrapper) — hydrated client-side
│   │   ├── navigation/      # Navigation sub-components
│   │   └── pricing/         # Pricing components
│   ├── config/              # Global config (site metadata, contacts)
│   ├── content/             # Astro Content Collections
│   │   └── blog/           # Markdown blog posts
│   ├── emails/              # React Email templates (Resend/Nodemailer)
│   ├── hooks/               # Custom React hooks (used in islands only)
│   ├── layouts/             # Astro layouts (Layout.astro, ServiceLayout.astro)
│   ├── lib/                 # Server-side libraries
│   │   ├── auth.server.ts  # BetterAuth configuration
│   │   ├── google-calendar.ts  # Google Calendar / Meet link generation
│   │   ├── pricing.ts      # Pricing calculation (basePrice, discount, finalPrice)
│   │   ├── stripe.ts       # Stripe payment links
│   │   └── supabase.ts     # Supabase/PostgREST client
│   ├── pages/               # Astro file-based routes
│   │   ├── api/            # API endpoints (SSR)
│   │   │   ├── admin/      # Admin-only endpoints (auth required)
│   │   │   ├── appointments/ # Appointment CRUD + actions
│   │   │   ├── auth/       # BetterAuth handler
│   │   │   ├── availability.ts  # Available slots (Google Calendar mock)
│   │   │   └── stripe-webhook.ts  # Stripe payment webhooks
│   │   ├── rdv/            # Patient booking flow pages
│   │   │   ├── accepter-report.astro  # Patient accepts rescheduled slot
│   │   │   └── merci.astro # Post-booking confirmation
│   │   ├── rendez-vous.astro  # Booking wizard (multi-step)
│   │   ├── mes-rdvs.astro    # Admin dashboard (auth required)
│   │   ├── login.astro       # Admin login
│   │   └── ...               # Marketing pages (accueil, a-propos, services, blog, contact)
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions (blogApi.ts, schema.ts)
├── scripts/                  # Utility scripts (seed-admin.ts)
├── supabase/
│   └── migrations/          # PostgreSQL schema (001_init.sql)
├── docker-compose.yml        # Local dev infrastructure
├── memory-bank/             # Project knowledge repository
└── artifacts/               # Dev workflow artifacts (frames, specs, plans)
```

## Application Architecture

### Astro 5 — Islands Architecture

- **Static Site Generation (SSG)** by default — zero JS shipped unless needed
- **React islands** hydrated client-side only where interactivity required (`client:load`, `client:idle`, `client:visible`)
- **SSR API routes** (`output: 'static'` + Netlify adapter hybrid) for booking, auth, payments
- No client-side routing — Astro file-based routing, each `.astro` = one URL

### Booking System Architecture

```
Patient                     Admin (Thérapeute)
   │                              │
   ▼                              ▼
/rendez-vous/             /mes-rdvs/  (BetterAuth)
   │                        │
   └── POST /api/appointments/       ← créé avec status=pending
              │
              ▼
      PostgreSQL (omf_therapie)
              │
     ┌────────┴────────┐
     ▼                 ▼
  Mailpit (dev)     Resend (prod)
  Admin notif       Patient ack
              │
              ▼ Admin action (confirm/decline/reschedule)
     PATCH /api/appointments/[id]/
              │
    ┌─────────┼──────────┐
    ▼         ▼          ▼
 confirm   decline   reschedule
    │                    │
    │              Email patient
    │              (bouton "Accepter")
    │                    │
    │              /rdv/accepter-report/[id]/
    ▼                    ▼
Email confirm      payment_pending (télé)
(présentiel)       ou confirmed (présentiel)
    │                    │
    └────────────────────┘
              │
    payment_pending → Stripe link → stripe-webhook → confirmed
```

### Authentication

- **BetterAuth** — session-based, PostgreSQL backend
- Monocompte : un seul compte thérapeute (hook `beforeUserCreated` bloque toute inscription)
- Login : `/login/` → `/mes-rdvs/` (redirect protégée)
- API routes admin : vérifient `session.user` via `auth.api.getSession()`

### Database (PostgreSQL 16)

Schema défini dans `supabase/migrations/001_init.sql`. Table principale `appointments` :
- Colonnes critiques NOT NULL : `patient_name`, `patient_email`, `patient_phone`, `patient_postal_code`, `patient_city`, `patient_reason`, `appointment_type`, `appointment_mode`, `duration`, `base_price`, `final_price`, `scheduled_at`
- Statuts : `pending → confirmed | declined | rescheduled → payment_pending → confirmed | cancelled`
- Créneaux bloqués : statuts `confirmed` et `payment_pending` uniquement (pas `pending`)

### Pricing

Logique dans `src/lib/pricing.ts` — retourne `{ basePrice, discount, finalPrice }` en euros :
- Thérapie individuelle 60min : 50€ base
- Remise nouveau client (`override_first_session`) : −15€
- Tarif solidaire (`is_solidarity`) : −20€ (mutuellement exclusif avec remise nouveau client)
- API stocke les prix ×100 (centimes) en base

### Google Calendar / Meet

`src/lib/google-calendar.ts` :
- **Local (`GOOGLE_CALENDAR_MOCK=true`)** : créneaux fictifs les mercredis, lien Meet fictif `https://meet.google.com/mock-xxx`
- **Production** : Google Calendar API (service account) pour lire les créneaux et créer des événements avec lien Meet automatique

### Email System

Templates React Email dans `src/emails/` :
- `AppointmentAcknowledgement` — accusé réception patient
- `AppointmentConfirmed` — confirmation (présentiel ou télé après paiement)
- `AppointmentDeclined` — refus
- `AppointmentRescheduled` — proposition nouveau créneau
- `AdminNewAppointment` — notification admin
- `PaymentRequest` — demande de prépaiement (télé)
- `ReviewRequest` — demande d'avis post-séance

**Local** : Nodemailer → Mailpit (SMTP `localhost:1025`)  
**Production** : Resend API

### Stripe Integration

- Paiement uniquement pour les téléconsultations (`appointment_mode = 'video'`)
- Flow : admin confirme → création Payment Link Stripe → email patient → patient paie → webhook → `status = confirmed`
- **Local mock** : si `STRIPE_SECRET_KEY` est un placeholder, lien fictif généré (pas d'erreur)

## Data Flow

### Blog System

1. Posts Markdown dans `src/content/blog/` avec frontmatter YAML (validé Zod)
2. Content Collections API (`getCollection('blog')`) — pas d'API externe
3. `src/pages/blog/[slug].astro` — pré-rendu statique à la build
4. `BlogClientWrapper` island — filtrage/recherche client-side

### Contact Form

1. EmailJS (client-side) via `useContactForm` hook
2. Toast notifications (react-hot-toast)
3. Pas de backend pour le formulaire de contact

## Key ADRs

- **Astro 5 SSG** : migration depuis React SPA (2025) pour performances et SEO
- **BetterAuth** : choisi pour session PostgreSQL native, pas de dépendance Supabase Auth
- **PostgREST** : simule Supabase en local pour compatibilité SDK `@supabase/supabase-js`
- **trailingSlash: 'always'** : tous les fetch() et redirects côté client DOIVENT inclure le slash final
