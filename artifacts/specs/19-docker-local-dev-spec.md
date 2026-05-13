---
issue: 19
title: "Infrastructure Docker locale pour développement"
tier: F-lite
status: approved
---

## Goal

Un `docker compose up` lance tous les services locaux (PostgreSQL + Mailpit), et `npm run dev` fait tourner l'intégralité du projet sans dépendre d'aucun service externe payant.

## Context

En production, le projet dépend de 4 services externes : Supabase (PostgreSQL), Resend (emails), Stripe (paiements), Google Calendar (disponibilités). Sans équivalents locaux, les développeurs doivent consommer de vrais quotas et ne peuvent pas tester les flows complets hors ligne.

L'architecture Astro + Netlify Functions tourne déjà via `astro dev`. Il faut uniquement :
1. Remplacer la DB distante par un PostgreSQL local
2. Remplacer Resend par un serveur SMTP local (Mailpit)
3. Remplacer les webhooks Stripe par le Stripe CLI
4. Remplacer Google Calendar par un mode mock (flag env)

## Acceptance Criteria

- [ ] AC1 — `docker compose up -d` démarre PostgreSQL 16 et Mailpit sans erreur
- [ ] AC2 — `npm run db:reset` rejoue `supabase/migrations/001_init.sql` sur le PostgreSQL local
- [ ] AC3 — `npm run dev` démarre avec les variables `.env.local` sans erreur ni warning bloquant
- [ ] AC4 — Soumettre le formulaire de prise de rendez-vous crée un enregistrement en DB locale
- [ ] AC5 — L'email de notification envoyé lors d'une réservation apparaît dans Mailpit (http://localhost:8025)
- [ ] AC6 — Le mode mock Google Calendar retourne des créneaux factices sans appel réseau
- [ ] AC7 — Le Stripe CLI forwardant les webhooks met à jour le statut du rdv en DB locale
- [ ] AC8 — `npx tsx scripts/seed-admin.ts` crée le compte thérapeute sur la DB locale
- [ ] AC9 — `.env.local.example` documente toutes les variables locales avec valeurs prêtes à l'emploi
- [ ] AC10 — `docs/DEV.md` décrit le démarrage en < 5 commandes

## Breadboard

| Surface | Action | Handler | Données |
|---------|--------|---------|---------|
| docker-compose.yml | `postgres` service | image postgres:16 | init via `001_init.sql` au démarrage |
| docker-compose.yml | `mailpit` service | axllent/mailpit | SMTP :1025, Web :8025 |
| src/lib/resend.ts | sendEmail() | Détecte `SMTP_HOST` → nodemailer | Fallback vers Resend SDK si absent |
| src/lib/google-calendar.ts | getAvailableSlots() | Détecte `GOOGLE_CALENDAR_MOCK=true` | Retourne créneaux factices |
| scripts/db-reset.sh | npm run db:reset | psql sur le conteneur | Rejoue `001_init.sql` |
| Stripe CLI (binaire) | stripe listen | Forward vers /api/stripe-webhook | whsec_local_... dans .env.local |

## Slices

**Slice 1 — Services Docker (docker-compose.yml)**
Fichier `docker-compose.yml` à la racine avec services `postgres` (port 5432) et `mailpit` (ports 1025 / 8025). Le volume `postgres_data` persiste les données. L'init automatique de la DB via `/docker-entrypoint-initdb.d/001_init.sql`.

Fichiers : `docker-compose.yml`

**Slice 2 — Fallback SMTP dans resend.ts**
Quand `SMTP_HOST` est défini dans l'env, `sendEmail()` utilise `nodemailer` + transport SMTP (Mailpit) au lieu du SDK Resend. Si `SMTP_HOST` est absent, comportement inchangé (Resend SDK).

Fichiers : `src/lib/resend.ts`, `package.json` (+nodemailer)

**Slice 3 — Mock Google Calendar**
Quand `GOOGLE_CALENDAR_MOCK=true`, `getAvailableSlots()` retourne des créneaux hardcodés (prochains mercredis + plages horaires standard) sans appel à l'API Google. `createCalendarEvent()` log en console et retourne un event ID factice.

Fichiers : `src/lib/google-calendar.ts`

**Slice 4 — Scripts utilitaires**
- `npm run db:reset` : exécute `psql` dans le conteneur pour rejouer la migration
- `.env.local.example` : toutes les variables avec valeurs locales prêtes à copier

Fichiers : `package.json`, `.env.local.example`, `docs/DEV.md`

## Out of Scope

- Remplacement de Stripe par un mock (le Stripe CLI en mode `--forward-to` est suffisant)
- pgAdmin dans le compose (optionnel, non livré par défaut)
- Conteneurisation de l'app Astro elle-même
- Tests automatisés de l'infra Docker

## Open Questions

- Aucune — tous les choix techniques sont arrêtés (voir ci-dessous)

## Décisions techniques

| Choix | Raison |
|-------|--------|
| PostgreSQL 16 (pas Supabase local) | Supabase local est lourd (2 Go RAM). On n'utilise pas les features Supabase Auth — juste le Postgres. |
| Mailpit (pas Mailhog) | Mailhog est abandonné. Mailpit = successeur actif, même image légère. |
| Stripe CLI (pas de mock) | Stripe CLI est officiel, gratuit, et teste les vrais événements webhook. |
| Mock Google Calendar via flag env | Zéro dépendance réseau. Les vrais créneaux ne sont pas critiques pour le dev local. |
| nodemailer pour SMTP local | Resend SDK n'a pas de transport SMTP. nodemailer est le standard Node.js pour SMTP. |
