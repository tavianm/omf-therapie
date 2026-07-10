# Active Context

**Last Updated:** July 5, 2026

This document tracks current work in progress, recent changes, and immediate next steps. Update this regularly to maintain continuity between development sessions.

## Current Status

**Project State:** ✅ `main` — 3 PRs mergées cette semaine (#85, #66, #65)

**Recent Activity:** CI pipeline en place, système d'avoirs interne livré, refonte de l'espace admin `/mes-rdvs/`.

**Active Work:** Issue #68 — Stripe payment confirmation reconciliation + idempotency (frame ✅, spec ✅, plan ✅ — à implémenter). Dépendance : débloquer le typecheck bloquant (#68 trace aussi les ~20 erreurs de typage préexistantes).

**Next:**
- Appliquer `008_credits.sql` en production (tables `credits`/`credit_usages` + RPC + colonne `credit_applied`)
- Activer la branch protection sur `CI / build` après le 1er run sur `main` (suivi de #85)
- #68 — implémenter la réconciliation d'idempotencité Stripe

## Recent Changes

### Semaine du 29 juin – 5 juillet 2026

- ✅ **#85** (PR merged) — CI pipeline GitHub Actions : job `build` bloquant (`lint → test → build`) + job `typecheck-advisory` non bloquant. Ajoute `.nvmrc` (Node 20), script `typecheck`, devDep `@astrojs/check`. Nettoie 13 des 33 erreurs de typage (les 20 restantes tracées dans #68).
- ✅ **#66** (PR merged, ferme #63) — Annulation/report RDV + système d'avoir interne :
  - Nouveau statut `cancelled` (action `cancel` dans `PATCH /api/appointments/[id]`) + email `AppointmentCancelled`.
  - Avoir automatique sur annulation d'un RDV vidéo `payment_received` (cash réellement encaissé, idempotent via `UNIQUE(source_appointment_id)`). **Aucun Stripe refund.**
  - Restitution d'avoir sur re-annulation d'un RDV créé avec avoir (`restore_credits`).
  - Action `reschedule_paid` : report d'un RDV vidéo payé sans re-facturer (corrige la double-facturation du `reschedule` classique).
  - Création manuelle avec avoir (admin) : case « Utiliser l'avoir » dans `AdminCreateButton`, consommation FIFO atomique (`consume_credits`).
  - Migration `008_credits.sql` (tables `credits` + `credit_usages`, RPC FIFO, RLS service_role-only).
  - Statut unifié : `payment_received` = « réglé » (Stripe ou avoir).
- ✅ **#65** (PR merged, ferme #64) — Refonte `/mes-rdvs/` : îlot React `<AppointmentsManager>` (liste compacte ~56 px/ligne, recherche instantanée via `useDeferredValue`, partition À venir / Passés, regroupement par jour). Corrige `google_calendar_event_id` et `patient_city` absents de la projection SQL. Gain : scroll d'ouverture ~35 000 px → ~3 500 px.

### Migration à appliquer en prod

`008_credits.sql` (post-merge de #66) — créer les tables/RPC + colonne `appointments.credit_applied`. À exécuter manuellement en prod et en local (`npm run db:reset` ne rejoue que `001_init.sql`).

### Mai 2026 — Système de prise de rendez-vous complet (historique)

Issues implémentées et testées E2E (Playwright MCP) :

- ✅ **#15** — Wizard patient multi-étapes (`/rendez-vous/`)
- ✅ **#21** — Contrôle des tarifs admin : remise nouveau client & tarif solidaire
- ✅ **#22** — Création manuelle de RDV par l'admin
- ✅ **#24** — Remise nouveau client dans `AdminCreateButton`
- ✅ **#25** — Génération Google Meet via `src/lib/google-calendar.ts`
- ✅ **#26** — Flow acceptation report patient (page `/rdv/accepter-report/[id]/`)
- ✅ **#27** — Blocage des créneaux dès statuts actifs

## Infrastructure locale

- **Docker** : PostgreSQL 16, PostgREST, nginx (supabase-rest), Mailpit
- **Auth** : BetterAuth (monocompte thérapeute) — `admin@localhost.dev` / `DevPassword!LocalOnly123`
- **Emails** : Mailpit sur `http://localhost:8025`
- **Stripe** : mode mock local (pas de vraies clés nécessaires pour le dev)
- **Google Calendar** : `GOOGLE_CALENDAR_MOCK=true` — créneaux fictifs les mercredis uniquement

## Current Branch

**Branch:** `main` (clean) — dernières PRs : #85, #66, #65 toutes mergées.
