---
issue: 36
title: "feat: Google Calendar production-ready — OAuth token rotation, event lifecycle, Meet async, cache, error handling"
status: approved
tier: F-full
created: 2026-05-22
---

## Problem Statement

L'intégration Google Calendar actuelle fonctionne pour le développement mais présente 5 défauts
structurels qui la rendent fragile en production :

1. **Token OAuth statique** — le `refresh_token` stocké en env var expire (7 jours en mode Test,
   6 mois sans usage). Quand il expire, toute génération de Meet et toute création d'événement
   échoue silencieusement (fallback Jitsi), sans alerte.

2. **Événements orphelins** — l'`eventId` Google Calendar n'est pas persisté. Quand un rdv est
   reporté ou annulé, l'événement reste dans l'agenda de la thérapeute, créant une désynchronisation
   permanente.

3. **Polling 15s dans le chemin critique** — `pollMeetLink()` tourne jusqu'à 10 × 1,5s = 15s dans
   le handler HTTP. Netlify Functions ont un timeout de 10s par défaut. Le polling peut tuer la
   requête en production.

4. **Aucun cache sur /api/availability** — chaque patient qui ouvre la page de prise de rdv déclenche
   un appel Google Calendar Freebusy. L'API Google impose un quota de 1 000 000 unités/jour
   (chaque requête Freebusy = 1 unité). Sur un pic de trafic ou un robot, ce quota est facilement
   épuisé.

5. **Gestion d'erreur monolithique** — toutes les erreurs Google tombent dans `GoogleCalendarError`.
   Impossible de distinguer un token expiré (→ re-auth) d'un quota dépassé (→ retry) d'une
   permission manquante (→ alerte) sans parser les messages d'erreur manuellement.

## Why This Matters

- **Fiabilité perçue** : une thérapeute dont les séances vidéo n'ont pas de lien Meet ou dont
  l'agenda est désynchronisé perd confiance dans l'outil et doit gérer manuellement.
- **Expérience patient** : recevoir un lien Jitsi de fallback au lieu d'un vrai Meet est sous-optimal
  et peut surprendre des patients attendant Google Meet.
- **Maintenance** : sans alertes, le token peut expirer silencieusement des semaines avant qu'on
  s'en aperçoive.

## Success Criteria

1. Le refresh token OAuth ne provoque plus jamais d'échec silencieux — rotation automatique,
   alerte email si `invalid_grant` (re-auth manuelle requise).
2. Chaque rdv confirmé a un `google_calendar_event_id` non-nul ; un report met à jour l'événement ;
   une annulation/déclinaison supprime l'événement.
3. La confirmation d'un rdv vidéo retourne une réponse HTTP < 5s — le polling Meet est réduit
   à 3 tentatives max dans le chemin critique ; le meetLink arrivera si disponible, sinon fallback
   immédiat.
4. `GET /api/availability` sert les réponses depuis le cache (`@netlify/blobs`) pendant 10 min ;
   le cache est invalidé à chaque mutation de rdv.
5. Les erreurs Google sont typées : `CalendarAuthError`, `CalendarPermissionError`,
   `CalendarQuotaError`, `CalendarNetworkError` — chacune avec stratégie de retry adaptée.

## Constraints

- **Plateforme** : Netlify SSG + serverless functions. Pas de Redis disponible nativement.
  → Cache via `@netlify/blobs` (KV natif Netlify, déjà inclus dans `@astrojs/netlify`).
- **DB** : Supabase (PostgreSQL). Toutes les données persistées passent par Supabase.
- **Async jobs** : Netlify Background Functions existent mais nécessitent une configuration
  spécifique. Pour éviter la complexité, le polling Meet est simplement réduit (3 tentatives max)
  plutôt que délégué à un job séparé.
- **OAuth** : compte Google personnel de la thérapeute (pas Workspace). Le Service Account reste
  en fallback pour les événements sans Meet (in-person).
- **Single user** : une seule thérapeute = un seul set de credentials Google. Pas de multi-tenant.
- **Pas de breaking change** : les API routes existantes (`PATCH /api/appointments/[id]`,
  `POST /api/admin/appointments`) conservent leur interface.

## Out of Scope

- Migration vers Google Workspace (implique changement d'abonnement)
- Notifications push temps-réel (webhook Google Calendar → Netlify)
- Support multi-thérapeute / multi-calendrier
- Interface UI de ré-autorisation OAuth (la re-auth reste manuelle via `scripts/`)
- Chiffrement at-rest des tokens OAuth dans Supabase (RLS + service_role = suffisant)

## Stakeholders

- **Oriane Montabonnet (thérapeute)** — utilisatrice directe : agenda synchronisé, liens Meet fiables
- **Patients** — reçoivent un vrai lien Meet dans l'email de confirmation
- **Développeur** — maintenance simplifiée grâce aux erreurs typées et aux alertes

## Appetite

Tier: **F-full**
Reasoning: 3 domaines touchés (auth, calendar API, cache infrastructure), migration Supabase
requise, nouveaux patterns (token rotation, error taxonomy, KV cache), 6 fichiers modifiés
dont 2 nouveaux modules (`calendar-cache.ts`, migration SQL). Estimation : 2-3 jours.

## Approach Options

### Option A — Supabase tokens + @netlify/blobs cache (recommandée)
- Token OAuth stocké en Supabase (`google_oauth_tokens`)
- Cache availability via `@netlify/blobs` (TTL 10 min, invalidation explicite)
- Polling Meet réduit à 3 tentatives (max ~4,5s) dans le chemin sync
- **Avantages** : pas de nouvelle infra, cohérent avec l'existant, `@netlify/blobs` déjà inclus
- **Inconvénients** : cache non partagé entre instances Netlify dans la même région lors de pics

### Option B — Upstash Redis
- Token + cache dans Redis (Upstash free tier, edge-compatible)
- **Avantages** : vrai cache distribué, adapté au rate limiting aussi
- **Inconvénients** : nouvelle dépendance externe, coût potentiel, over-engineered pour ce volume

 **Option A retenue** : volume trafic faible (cabinet 1 thérapeute), `@netlify/blobs` suffisant.

## Open Questions

- L'email d'alerte `invalid_grant` doit-il aller vers `ADMIN_EMAIL` (env var existant) ou une
  adresse dédiée ? → supposé `ADMIN_EMAIL` (cohérent avec les autres alertes).
- La suppression d'événement Calendar lors d'un `decline` doit-elle être best-effort (non-bloquant)
  ou bloquer la réponse ? → non-bloquant (même pattern que l'existant).
- Faut-il aussi synchroniser l'événement Calendar lors d'un `cancel` initié par le patient (via
  token signé) ? → oui, inclus dans le scope si `google_calendar_event_id` est présent.
