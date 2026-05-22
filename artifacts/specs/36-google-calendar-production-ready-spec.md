---
issue: 36
title: "feat: Google Calendar production-ready — OAuth token rotation, event lifecycle, Meet async, cache, error handling"
tier: F-full
status: approved
---

## Goal

Rendre l'intégration Google Calendar production-ready : token OAuth auto-renouvelé depuis
Supabase, événements Calendar synchronisés sur tout le lifecycle d'un rdv, génération Meet
non-bloquante, cache disponibilités via `@netlify/blobs`, et erreurs Google typées avec retry.

## Context

`src/lib/google-calendar.ts` est le module central (~650 lignes). Il est appelé par :
- `GET /api/availability` — Freebusy pour les créneaux disponibles
- `PATCH /api/appointments/[id]` — création d'événement à la confirmation (in-person + video)
- `POST /api/admin/appointments` — création manuelle (in-person uniquement)

Lacunes actuelles identifiées :
- `GOOGLE_OAUTH_REFRESH_TOKEN` statique en env var → expire sans alerte
- `google_calendar_event_id` jamais stocké → reschedule/decline/cancel orphelins
- `pollMeetLink()` = 10 × 1,5s = 15s → dépasse le timeout Netlify de 10s
- Aucun cache sur `/api/availability` → quota Google à risque
- `GoogleCalendarError` unique → impossible de distinguer 401 / 403 / 429

## Acceptance Criteria

### Auth — token rotation (AC-1 à AC-4)
- [ ] **AC-1** — Table `google_oauth_tokens` créée dans Supabase avec colonnes :
  `id`, `access_token TEXT NOT NULL`, `refresh_token TEXT NOT NULL`, `expiry_date BIGINT NOT NULL`,
  `created_at`, `updated_at`. Contrainte : une seule ligne active (`id = 'therapist'`).
- [ ] **AC-2** — `getPersistedOAuthClient()` dans `google-calendar.ts` lit le token depuis
  Supabase et appelle `oauth2Client.refreshAccessToken()` si `expiry_date < Date.now() + 5min`.
  Le nouveau token est persisté immédiatement après refresh.
- [ ] **AC-3** — Si Google retourne `invalid_grant`, un email d'alerte est envoyé  `ADMIN_EMAIL`
  et l'erreur est relancée en `CalendarAuthError`.
- [ ] **AC-4** — Les env vars `GOOGLE_OAUTH_*` restent utilises comme bootstrap initial
  (seeding de la table si elle est vide). La rotation est ensuite entièrement gérée par Supabase.

### Event lifecycle — stockage et synchronisation (AC-5 à AC-9)
- [ ] **AC-5** — Migration Supabase : colonne `google_calendar_event_id TEXT` ajoutée à
  `appointments` (nullable, index non-unique).
- [ ] **AC-6** — À chaque appel réussi de `createCalendarEvent()`, le `eventId` retourné est
  stocké dans `appointments.google_calendar_event_id`.
  Concerné : `PATCH action=confirm` (in-person et video), `POST /api/admin/appointments` (in-person).
- [ ] **AC-7** — `PATCH action=reschedule` : si `google_calendar_event_id` est non-nul, appelle
  `calendar.events.patch()` pour mettre à jour `start` et `end` avec `rescheduled_to`.
  Non-bloquant : échec Calendar ne bloque pas la réponse HTTP.
- [ ] **AC-8** — `PATCH action=accept_reschedule` (in-person) : au lieu de créer un nouvel
  événement, si `google_calendar_event_id` existe, appelle `calendar.events.patch()` pour
  confirmer la nouvelle date (`scheduled_at` post-update). Sinon, crée un nouvel événement
  (comportement actuel conservé comme fallback).
- [ ] **AC-9** — `PATCH action=decline` : si `google_calendar_event_id` est non-nul, appelle
  `calendar.events.delete()`. Non-bloquant.

### Meet generation — non-bloquant (AC-10 à AC-11)
- [ ] **AC-10** — `pollMeetLink()` réduit à `maxAttempts = 3` (max ~4,5s au lieu de 15s).
- [ ] **AC-11** — Si `pollMeetLink()` n'obtient pas de lien après 3 tentatives, retourne
  `undefined` immédiatement (fallback Jitsi via `buildFallbackVideoLink()` dans l'appelant).
  Aucun timeout Netlify ne peut être déclenché.

### Availability cache (AC-12 à AC-14)
- [ ] **AC-12** — Nouveau module `src/lib/calendar-cache.ts` exposant :
  `getCachedAvailability(key)`, `setCachedAvailability(key, slots, ttlSeconds)`,
  `invalidateAvailabilityCache()`.
  Implémenté via `@netlify/blobs` (store name : `calendar-availability`).
- [ ] **AC-13** — `GET /api/availability` consulte le cache avant d'appeler Google. Si présent
  et non-expiré, retourne immédiatement. Sinon, appelle Google et met en cache le résultat.
  Cache key : `{mode}-{duration}-{weeks}`.
- [ ] **AC-14** — `invalidateAvailabilityCache()` est appelé (fire-and-forget) depuis :
  `PATCH action=confirm`, `PATCH action=decline`, `PATCH action=reschedule`,
  `PATCH action=accept_reschedule`, `POST /api/admin/appointments`.

### Error handling (AC-15 à AC-17)
- [ ] **AC-15** — `GoogleCalendarError` remplacée par 4 classes distinctes :
  - `CalendarAuthError` — erreurs 401, `invalid_grant`, token expiré
  - `CalendarPermissionError` — erreurs 403, calendar non partagé
  - `CalendarQuotaError` — erreurs 429, quota dépassé
  - `CalendarNetworkError` — timeout, 5xx, erreurs réseau
- [ ] **AC-16** — Retry automatique avec backoff exponentiel (1s, 2s, 4s) sur `CalendarQuotaError`
  et `CalendarNetworkError`, max 3 tentatives.
- [ ] **AC-17** — `GET /api/availability` retourne :
  - 503 avec message français sur `CalendarAuthError` et `CalendarPermissionError`
  - 503 avec retry-after sur `CalendarQuotaError`
  - 503 générique sur `CalendarNetworkError` (comportement actuel conservé)

## Breadboard

| Surface | Action | Handler | Data in | Data out |
|---------|--------|---------|---------|----------|
| Supabase | READ token | `getPersistedOAuthClient()` | — | `{access_token, refresh_token, expiry_date}` |
| Google OAuth | REFRESH | `oauth2Client.refreshAccessToken()` | `refresh_token` | `{access_token, expiry_date}` |
| Supabase | UPSERT token | `getPersistedOAuthClient()` | new token | — |
| Supabase | SELECT | `google_oauth_tokens` | `id = 'therapist'` | token row |
| Google Calendar | Freebusy | `calendar.freebusy.query()` | `{timeMin, timeMax, items}` | `{busy[]}` |
| Netlify Blobs | GET | `getCachedAvailability(key)` | cache key | `TimeSlot[] \| null` |
| Netlify Blobs | SET | `setCachedAvailability(key, slots)` | slots + TTL | — |
| Netlify Blobs | DELETE | `invalidateAvailabilityCache()` | — | — |
| Google Calendar | INSERT | `calendar.events.insert()` | event body + conferenceData | `{id, hangoutLink}` |
| Google Calendar | PATCH | `calendar.events.patch()` | `eventId`, `{start, end}` | `{id}` |
| Google Calendar | DELETE | `calendar.events.delete()` | `eventId` | 204 |
| Supabase | UPDATE | `appointments` | `google_calendar_event_id` | — |
| Resend | SEND | `sendEmail()` | alert body | — |

## Slices

**Slice 1 — Migration SQL + types** *(~30 min)*
Fichiers : `supabase/migrations/004_google_calendar.sql`, `src/types/appointment.ts`
- `CREATE TABLE google_oauth_tokens (id TEXT PRIMARY KEY DEFAULT 'therapist', ...)`
- `ALTER TABLE appointments ADD COLUMN google_calendar_event_id TEXT`
- Ajouter `google_calendar_event_id?: string | null` au type `Appointment`

**Slice 2 — Auth : token rotation** *(~1h)*
Fichier : `src/lib/google-calendar.ts`
- Nouvelle fonction `getPersistedOAuthClient()` : lit Supabase → refresh si besoin → persiste → retourne `OAuth2Client`
- Bootstrap : si table vide, seed depuis env vars `GOOGLE_OAUTH_*`
- `resolveCalendarAuth()` utilise `getPersistedOAuthClient()` en priorité

**Slice 3 — Typed errors + retry** *(~45 min)*
Fichier : `src/lib/google-calendar.ts`
- Remplacer `GoogleCalendarError` par `CalendarAuthError`, `CalendarPermissionError`, `CalendarQuotaError`, `CalendarNetworkError`
- Fonction `withCalendarRetry<T>(fn, maxAttempts)` — backoff exponentiel
- Parser les codes d'erreur HTTP Google (`err.code` ou `err.response?.status`)
- Réexporter `GoogleCalendarError = CalendarNetworkError` pour ne pas casser les imports existants

**Slice 4 — Event lifecycle (store ID + patch/delete)** *(~1h)*
Fichiers : `src/lib/google-calendar.ts`, `src/pages/api/appointments/[id].ts`, `src/pages/api/admin/appointments/index.ts`
- Réduire `pollMeetLink` à `maxAttempts = 3`
- Nouvelles fonctions : `updateCalendarEvent(eventId, {start, end})`, `deleteCalendarEvent(eventId)`
- Tous les call sites de `createCalendarEvent()` : stocker le `eventId` retourné dans `appointments`
- `PATCH action=reschedule` → appeler `updateCalendarEvent()`
- `PATCH action=accept_reschedule` → `updateCalendarEvent()` si ID présent, sinon create
- `PATCH action=decline` → appeler `deleteCalendarEvent()`

**Slice 5 — Cache availability** *(~45 min)*
Fichiers : `src/lib/calendar-cache.ts` (nouveau), `src/pages/api/availability.ts`, `src/pages/api/appointments/[id].ts`, `src/pages/api/admin/appointments/index.ts`
- Module `calendar-cache.ts` : `getCachedAvailability`, `setCachedAvailability`, `invalidateAvailabilityCache` via `@netlify/blobs`
- Intégrer dans `GET /api/availability`
- Appeler `invalidateAvailabilityCache()` fire-and-forget dans les 5 mutation handlers

## Out of Scope

- Interface UI de re-auth OAuth (la re-auth reste manuelle : exécuter un script ou réinsérer les tokens)
- Google Workspace / multi-compte
- Suppression de l'événement sur `cancel` initié par le patient (action `cancel` non encore implémentée)
- Cache distribué Redis (Upstash ou autre)
- Notifications webhook push depuis Google Calendar
- Chiffrement des tokens au repos dans Supabase

## Open Questions

- `@netlify/blobs` en mode local dev (`npm run dev`) : nécessite `netlify dev` ou supporte `astro dev` ? → à vérifier, sinon cache désactivé en dev (GOOGLE_CALENDAR_MOCK=true de toute façon).
- L'email d'alerte `invalid_grant` utilise `ADMIN_EMAIL` (env var existant). Confirmé.
