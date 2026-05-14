# Active Context

**Last Updated:** May 14, 2026

This document tracks current work in progress, recent changes, and immediate next steps. Update this regularly to maintain continuity between development sessions.

## Current Status

**Project State:** 🚀 Feature branch `feat/15-prise-de-rendez-vous` — PR #18 ouverte vers `main`

**Recent Activity:** Système complet de prise de rendez-vous (issues #15, #21, #22, #24–#27) — tests E2E validés

**Active Work:** PR #18 en attente de review

## Recent Changes

### Mai 2026 — Système de prise de rendez-vous complet

Issues implémentées et testées E2E (Playwright MCP) :

- ✅ **#15** — Wizard patient multi-étapes (`/rendez-vous/`) : type, mode, durée, créneau, infos, confirmation
- ✅ **#21** — Contrôle des tarifs admin : remise nouveau client & tarif solidaire (cases à cocher mutuellement exclusives dans modal de confirmation)
- ✅ **#22** — Création manuelle de RDV par l'admin (`/mes-rdvs/` → bouton "Nouveau rendez-vous")
- ✅ **#24** — Remise nouveau client disponible aussi dans AdminCreateButton
- ✅ **#25** — Génération automatique Google Meet via `src/lib/google-calendar.ts` (mock local, Google Calendar API en prod)
- ✅ **#26** — Flow acceptation report patient : page `/rdv/accepter-report/[id]/`, email prépaiement (télé) ou confirmation directe (présentiel), action `cancel_reschedule` pour l'admin
- ✅ **#27** — Blocage des créneaux dès statuts actifs (`confirmed`, `payment_pending`) — pas pour `pending`

### Bugs corrigés durant les tests

- Trailing slashes manquants dans `accepter-report.astro` et `AdminCreateButton.tsx`
- `cancel_reschedule` absent de la whitelist dans `appointments/[id].ts`
- AdminCreate 500 : colonnes NOT NULL manquantes dans l'insert (`patient_postal_code`, `patient_city`, `base_price`)
- `.playwright-mcp/` et `test-booking.cjs` exclus du tracking git

## Infrastructure locale

- **Docker** : PostgreSQL 16, PostgREST, nginx (supabase-rest), Mailpit
- **Auth** : BetterAuth (monocompte thérapeute) — `admin@localhost.dev` / `DevPassword!LocalOnly123`
- **Emails** : Mailpit sur `http://localhost:8025`
- **Stripe** : mode mock local (pas de vraies clés nécessaires pour le dev)
- **Google Calendar** : `GOOGLE_CALENDAR_MOCK=true` — créneaux fictifs les mercredis uniquement

## Current Branch

**Branch:** feat/15-prise-de-rendez-vous → PR #18 → main
