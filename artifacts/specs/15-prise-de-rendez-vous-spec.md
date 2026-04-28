---
issue: 15
title: "Système de prise de rendez-vous intégré (remplacement Psychologue.net)"
tier: F-full
status: approved
---

## Goal

Remplacer le lien Psychologue.net par une solution souveraine de prise de rendez-vous sur omf-therapie.fr : formulaire public relié à Google Calendar, backoffice thérapeute authentifié, prépaiement Stripe pour les RDV visio, emails transactionnels brandés Omf-Thérapie via Resend.

## Context

- Actuellement : bouton "RDV en ligne" → `https://www.psychologue.net/cabinets/oriane-montabonnet` (à supprimer)
- Formulaire de contact existant sur `/contact` utilise EmailJS → migré vers Resend dans cette feature
- Architecture : Astro `output: 'static'` → passage à `output: 'hybrid'` pour SSR admin + API routes
- Nouvelles dépendances : BetterAuth, Supabase, Resend, Stripe, googleapis
- Thérapeute unique → auth single-admin via BetterAuth (OAuth ou credentials)
- Hébergement Netlify inchangé ; les routes `/api/*` compilent en Netlify Functions via `@astrojs/netlify`

## Acceptance Criteria

### Formulaire de réservation public (`/rendez-vous`)
- [ ] AC-01 — La page `/rendez-vous` est publiquement accessible et se charge en mode SSG
- [ ] AC-02 — Le patient sélectionne un type de RDV (individuel / couple / familial)
- [ ] AC-03 — Le patient sélectionne un mode (présentiel mercredi uniquement / visio)
- [ ] AC-04 — Le patient sélectionne une durée (60 min / 90 min) et le tarif s'affiche dynamiquement
- [ ] AC-05 — La case "Première séance (-15€)" est disponible et ajuste le tarif affiché (déclaratif)
- [ ] AC-06 — Les créneaux disponibles proviennent de l'API Google Calendar (agenda de la thérapeute)
- [ ] AC-07 — Un créneau présentiel n'est proposé que le mercredi
- [ ] AC-08 — Le formulaire collecte : Nom, Email, Téléphone, Code postal, Ville, Motif (max 1500 chars)
- [ ] AC-09 — Si un créneau est indisponible au moment de la soumission, un message d'erreur s'affiche et les créneaux disponibles sont rafraîchis
- [ ] AC-10 — La demande est persistée en base Supabase avec le statut `pending`
- [ ] AC-11 — La thérapeute reçoit un email Resend récapitulant la demande (tous champs du formulaire)
- [ ] AC-12 — Le formulaire de contact existant (`/contact`) envoie via Resend (plus via EmailJS)

### Authentification (`/login`)
- [ ] AC-13 — La page `/login` permet à la thérapeute de se connecter (BetterAuth, credentials ou OAuth)
- [ ] AC-14 — Un seul compte admin peut exister ; toute tentative de création d'un second compte est bloquée
- [ ] AC-15 — Après connexion, la thérapeute est redirigée vers `/mes-rdvs`
- [ ] AC-16 — Un lien "Mes RDV" apparaît dans la navbar uniquement lorsque la thérapeute est connectée
- [ ] AC-17 — Toute tentative d'accès à `/mes-rdvs` sans session valide redirige vers `/login`

### Backoffice RDV (`/mes-rdvs`)
- [ ] AC-18 — La page `/mes-rdvs` liste toutes les demandes de RDV avec leur statut
- [ ] AC-19 — La thérapeute peut **accepter** un RDV présentiel → email de confirmation envoyé au patient (CC thérapeute) avec lien ICS/Google Calendar
- [ ] AC-20 — La thérapeute peut **refuser** un RDV → email de refus envoyé au patient
- [ ] AC-21 — La thérapeute peut **proposer un autre créneau** → sélection d'un nouveau créneau depuis le calendrier → email de nouvelle proposition envoyé au patient
- [ ] AC-22 — Accepter ou proposer un autre créneau pour un RDV **visio** → envoi automatique d'un lien de paiement Stripe par email (brandé Omf-Thérapie, explication prépaiement incluse)
- [ ] AC-23 — La thérapeute peut envoyer un email de sollicitation d'avis (Google Business / Pages Jaunes / Psychologue.net) depuis un RDV confirmé

### Paiement Stripe (RDV visio)
- [ ] AC-24 — Un lien de paiement Stripe est généré via l'API Stripe (Payment Link) avec le montant exact du RDV
- [ ] AC-25 — À réception du paiement (webhook Stripe `checkout.session.completed`), le statut du RDV passe à `paid`
- [ ] AC-26 — Après paiement, un email de confirmation brandé est envoyé au patient (CC thérapeute) avec le lien Google Meet et le lien d'ajout au calendrier (ICS)
- [ ] AC-27 — La page `/rdv/merci` s'affiche après paiement Stripe réussi (Stripe success_url)

### Confirmation présentiel
- [ ] AC-28 — Après acceptation d'un RDV présentiel, l'email de confirmation contient l'adresse du cabinet, la date/heure, et un lien ICS/Google Calendar

### Rappel automatique
- [ ] AC-29 — Un rappel par email est envoyé au patient J-1 (via Netlify Scheduled Function)
- [ ] AC-30 — Le rappel n'est envoyé qu'une seule fois par RDV (colonne `reminder_sent_at`)

### Emails brandés Omf-Thérapie
- [ ] AC-31 — Tous les emails transactionnels utilisent un template HTML brandé Omf-Thérapie (logo, couleurs sage/mint, signature)
- [ ] AC-32 — L'email de sollicitation d'avis contient des liens cliquables vers Google Business, Pages Jaunes, et Psychologue.net

### Accessibilité & performance
- [ ] AC-33 — La page `/rendez-vous` passe l'audit pa11y sans erreur WCAG 2.1 AA
- [ ] AC-34 — Les pages publiques restent pré-rendues statiquement (pas de régression SSG)

## Breadboard

| Surface | Action | Handler | Données |
|---------|--------|---------|---------|
| `/rendez-vous` (island) | Charger les créneaux | `GET /api/availability?date=&mode=` | Google Calendar API → créneaux libres |
| `/rendez-vous` (island) | Soumettre demande | `POST /api/appointments` | → Supabase `appointments` + Resend (thérapeute) |
| `/login` (SSR) | Connexion thérapeute | `POST /api/auth/sign-in` | BetterAuth → cookie session |
| `/mes-rdvs` (SSR) | Lister RDV | `GET /api/appointments` | Supabase query (auth guard) |
| `/mes-rdvs` (island) | Accepter RDV présentiel | `PATCH /api/appointments/[id]` `{ action: 'confirm' }` | Supabase update + Resend (patient) + ICS |
| `/mes-rdvs` (island) | Accepter/Proposer RDV visio | `PATCH /api/appointments/[id]` `{ action: 'confirm' | 'reschedule' }` | Supabase + Stripe Payment Link + Resend |
| `/mes-rdvs` (island) | Refuser RDV | `PATCH /api/appointments/[id]` `{ action: 'refuse' }` | Supabase update + Resend (patient) |
| `/mes-rdvs` (island) | Proposer autre créneau | `PATCH /api/appointments/[id]` `{ action: 'reschedule', slot }` | Supabase + Resend |
| `/mes-rdvs` (island) | Solliciter avis | `POST /api/send-review-email` | Resend (patient) |
| `/api/stripe-webhook` | Paiement reçu | Stripe webhook `checkout.session.completed` | Supabase (→ `paid`) + Resend (confirmation) + Google Calendar (créer événement) |
| Netlify Scheduled Fn | Rappel J-1 | Cron `0 9 * * *` | Supabase (RDV demain, reminder null) → Resend |
| `/rdv/merci` (SSR) | Post-paiement | Stripe success_url `?session_id=` | Supabase lookup → page de confirmation |
| `/contact` | Envoyer message | `POST /api/contact` | Resend (migration EmailJS) |

## Slices

**Slice 1 — Infrastructure & Auth**
Passage `output: 'hybrid'`, mise en place Supabase (schema SQL), BetterAuth (config + tables), première route `/login` + `/mes-rdvs` (vide, protégée). Resend client. Mise à jour CSP dans `netlify.toml`.
_Fichiers :_ `astro.config.mjs`, `netlify.toml`, `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/resend.ts`, `src/pages/api/auth/[...all].ts`, `src/pages/login.astro`, `src/pages/mes-rdvs.astro`

**Slice 2 — Formulaire de réservation public**
Page `/rendez-vous` (SSG + island), sélection type/mode/durée/créneaux, calcul tarif dynamique, soumission vers `/api/appointments`, persistance Supabase, notification email thérapeute.
_Fichiers :_ `src/pages/rendez-vous.astro`, `src/components/booking/BookingForm.tsx`, `src/components/booking/BookingCalendar.tsx`, `src/lib/pricing.ts`, `src/types/appointment.ts`, `src/pages/api/appointments.ts`

**Slice 3 — Google Calendar (disponibilités)**
Service account Google, lecture des créneaux libres, filtre mercredi présentiel, endpoint `GET /api/availability`.
_Fichiers :_ `src/lib/google-calendar.ts`, `src/pages/api/availability.ts`

**Slice 4 — Backoffice `/mes-rdvs` (actions)**
Liste des RDV (SSR Supabase), actions Accept/Refus/Reschedule, `AppointmentCard`, emails Resend (confirmation présentiel avec ICS).
_Fichiers :_ `src/pages/mes-rdvs.astro` (complet), `src/components/admin/AppointmentList.tsx`, `src/components/admin/AppointmentCard.tsx`, `src/pages/api/appointments/[id].ts`, `src/lib/ics.ts`

**Slice 5 — Stripe Payment Links (visio)**
Génération du lien Stripe à l'acceptation d'un RDV visio, email de pré-paiement brandé, webhook Stripe (`/api/stripe-webhook`), confirmation post-paiement, page `/rdv/merci`.
_Fichiers :_ `src/lib/stripe.ts`, `src/pages/api/stripe-webhook.ts`, `src/pages/rdv/merci.astro`

**Slice 6 — Templates emails brandés**
Création des templates Resend (React Email) pour : notification thérapeute, confirmation patient présentiel, confirmation patient visio (post-paiement), refus, nouvelle proposition, rappel J-1, sollicitation avis.
_Fichiers :_ `src/emails/AppointmentRequest.tsx`, `src/emails/ConfirmationPresential.tsx`, `src/emails/ConfirmationVideo.tsx`, `src/emails/Refused.tsx`, `src/emails/Reschedule.tsx`, `src/emails/Reminder.tsx`, `src/emails/ReviewRequest.tsx`

**Slice 7 — Rappel J-1 + sollicitation avis**
Netlify Scheduled Function pour rappel J-1, bouton + modal sollicitation avis dans `/mes-rdvs`, `POST /api/send-review-email`.
_Fichiers :_ `netlify/functions/reminder-cron.ts`, `src/components/admin/ReviewEmailModal.tsx`, `src/pages/api/send-review-email.ts`

**Slice 8 — Migration EmailJS → Resend + navbar**
Remplacement du lien Psychologue.net par `/rendez-vous`, migration formulaire de contact vers `POST /api/contact`, suppression `@emailjs/browser`.
_Fichiers :_ `src/components/navigation/NavigationItems.tsx`, `src/hooks/useContactForm.ts`, `src/pages/api/contact.ts`, `package.json`

## Out of Scope

- Multi-thérapeutes / comptes patients
- Vidéo-conférence intégrée (lien Meet fourni par la thérapeute)
- Tarifs solidaires dans le formulaire (gérés manuellement)
- Export CSV (non retenu)
- Paiement en espèces/chèque via le site
- Intégration Doctolib

## Open Questions résolues

- Rappels J-1 : uniquement au patient (pas de CC thérapeute)
- Rétention RGPD : 1 an (purge automatique à prévoir)
