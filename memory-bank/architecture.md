# Architecture

**Last Updated:** July 5, 2026

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
│   │   ├── admin/           # Admin dashboard (AppointmentCard, AdminCreateButton, AppointmentsManager)
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
│   │   ├── appointment-conflicts.ts  # Slot-conflict detection
│   │   ├── appointment-eligibility.ts  # Cancel/reschedule eligibility (pure module)
│   │   ├── auth.server.ts  # BetterAuth configuration
│   │   ├── authz.ts        # Authorization checks
│   │   ├── calendar-cache.ts  # Google Calendar caching
│   │   ├── credits.ts      # Internal credit (avoir) system — FIFO consumption
│   │   ├── google-calendar.ts  # Google Calendar / Meet link generation
│   │   ├── ics.ts          # .ics calendar file generation
│   │   ├── manual-slots.ts # Manual slot overrides
│   │   ├── pricing.ts      # Pricing calculation (basePrice, discount, finalPrice)
│   │   ├── rate-limit.ts   # API rate limiting
│   │   ├── resend.ts       # Resend (prod) email transport
│   │   ├── secure-links.ts # Signed-link generation for patient actions
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
│   └── migrations/          # PostgreSQL schema (001_init.sql → 008_credits.sql)
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
/rendez-vous/             /mes-rdvs/  (BetterAuth) — liste compacte gérée par <AppointmentsManager>
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
              ▼ Admin action (confirm/decline/reschedule/cancel/reschedule_paid)
     PATCH /api/appointments/[id]/
              │
    ┌─────────┬──────────┬───────────────┐
    ▼         ▼          ▼               ▼
 confirm   decline   reschedule       cancel / reschedule_paid
    │                    │               │
    │              Email patient         │ Annulation → email AppointmentCancelled
    │              (bouton "Accepter")   │ Si RDV vidéo déjà payé → émission d'un avoir interne
    │                    │               │ (statut `payment_received` + crédit final_price − credit_applied)
    │              /rdv/accepter-report/[id]/   │ Report d'un RDV vidéo payé → action `reschedule_paid`
    ▼                    ▼                       (paiement conservé, pas de nouveau lien Stripe)
Email confirm      payment_pending (télé)
(présentiel)       ou confirmed (présentiel)
    │                    │
    └────────────────────┘
              │
    payment_pending → Stripe link → stripe-webhook → payment_received (= "réglé", Stripe ou avoir)
```

**Statuts unifiés (depuis #63/#66)** : `payment_received` = « séance réglée » (Stripe **ou** avoir) — remplace `confirmed` comme statut de paiement pour les RDV vidéo. `confirmed` reste pour le présentiel.

### Authentication

- **BetterAuth** — session-based, PostgreSQL backend
- Monocompte : un seul compte thérapeute (hook `beforeUserCreated` bloque toute inscription)
- Login : `/login/` → `/mes-rdvs/` (redirect protégée)
- API routes admin : vérifient `session.user` via `auth.api.getSession()`

### CI / Quality Gates

- **Workflow** `.github/workflows/ci.yml` (#85) : job `build` bloquant = `lint → test → build`. Job `typecheck-advisory` non bloquant (`continue-on-error: true`) qui surfacera les erreurs résiduelles (#68 suit les ~20 erreurs de typage préexistantes — googleapis, better-auth, stripe, react-email).
- **Node** : `.nvmrc` pinne Node 20 (parité avec `netlify.toml`).
- **Branch protection** (manuel) : après le 1er run sur `main`, exiger `CI / build` + « Dismiss stale pull request approvals ».

### Database (PostgreSQL 16)

Schema défini dans `supabase/migrations/` (`001_init.sql` → `008_credits.sql`). Table principale `appointments` :
- Colonnes critiques NOT NULL : `patient_name`, `patient_email`, `patient_phone`, `patient_postal_code`, `patient_city`, `patient_reason`, `appointment_type`, `appointment_mode`, `duration`, `base_price`, `final_price`, `scheduled_at`, `credit_applied` (depuis `008_credits.sql`)
- Statuts : `pending → confirmed | declined | rescheduled → payment_pending → payment_received | cancelled`
- Créneaux bloqués : statuts `confirmed`, `payment_pending` et `payment_received` (pas `pending`)
- **Système d'avoirs** (`008_credits.sql`, #63/#66) : tables `credits` + `credit_usages`, RPC `consume_credits` (FIFO atomique, `SECURITY DEFINER`) et `restore_credits` (restitution sur re-annulation). RLS service_role-only — l'émission et la consommation d'avoirs sont **admin-only** (aucune UI patient).

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
- `AppointmentCancelled` — annulation par l'admin (mentionne l'avoir éventuel, **jamais** le mot « remboursement »)
- `AppointmentRequestNotification` / `AppointmentRequestReceived` — notification admin / accusé patient
- `AppointmentReminder` — rappel avant séance
- `PaymentRequest` / `PaymentReminder` — demande / relance de prépaiement (télé)
- `PaymentReceivedNotification` — confirmation d'encaissement
- `ReviewRequest` — demande d'avis post-séance
- `CalendarAuthAlert` — alerte technique (auth Google expirée)

**Local** : Nodemailer → Mailpit (SMTP `localhost:1025`)  
**Production** : Resend API

### Stripe Integration

- Paiement uniquement pour les téléconsultations (`appointment_mode = 'video'`)
- Flow : admin confirme → création Payment Link Stripe → email patient → patient paie → webhook → `status = payment_received`
- **Statut unifié `payment_received`** (#63/#66) : « séance réglée » via Stripe **ou** avoir interne. L'action `reschedule_paid` reporte un RDV vidéo déjà payé sans régénérer de lien Stripe (corrige la double-facturation). L'action `cancel` sur un RDV `payment_received` émet un avoir interne — **aucun remboursement Stripe réel**.
- **Création manuelle avec avoir** (admin) : déduction FIFO via `consume_credits` ; si le solde dû = 0 → `payment_received`/`confirmed` sans lien Stripe, sinon lien Stripe pour le reliquat uniquement.
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
- **Avoirs internes plutôt que remboursements Stripe** (#63/#66) : annulation d'un RDV vidéo payé → avoir interne réutilisable (cash conservé). Aucun Stripe refund — `payment_received` = statut unifié « réglé ».
- **CI bloquant, typecheck advisory** (#85) : lint+test+build ferment le merge ; typecheck reste advisory jusqu'à résolution de #68.
