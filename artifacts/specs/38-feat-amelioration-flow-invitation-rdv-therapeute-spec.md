---
issue: 38
title: "feat: amélioration du flow d'invitation RDV par le thérapeute — durée/tarif flexibles + création immédiate du calendrier"
tier: F-full
status: draft
---

## Goal

Le thérapeute peut créer des rendez-vous admin avec une durée et un tarif libres, et l'événement Google Calendar est créé immédiatement à la soumission — indépendamment du paiement Stripe.

## Context

Le dashboard admin (`/mes-rdvs`) expose un bouton "Nouveau rendez-vous" (`AdminCreateButton.tsx`) qui poste vers `POST /api/admin/appointments/`. Actuellement :

- La durée est validée contre `VALID_DURATIONS = new Set([60, 90])` dans l'API admin
- Le prix est toujours calculé via `calculatePrice(type, duration, ...)` — pas d'override possible
- Pour les RDV vidéo, l'événement Google Calendar est créé dans `stripe-webhook.ts → handlePaymentSucceeded()` après réception du paiement — si le patient paie manuellement (virement), l'événement n'est jamais créé
- Pour les RDV présentiel, l'événement est créé immédiatement (comportement correct)
- `stripe-webhook.ts` ne vérifie pas `google_calendar_event_id` avant de créer — un doublon serait produit si le RDV a déjà un événement

Le flow patient (`POST /api/appointments/`) n'est pas modifié — la validation stricte 60/90 y est maintenue.

## Acceptance Criteria

### Durée personnalisée

- [ ] AC1 — Le formulaire admin propose les durées standards (60 min, 90 min) **et** une option "Personnalisée"
- [ ] AC2 — Quand "Personnalisée" est sélectionnée, un champ numérique apparaît (min: 15, max: 240, step: 1, unité: minutes)
- [ ] AC3 — La saisie d'une durée non entière ou hors [15, 240] bloque la soumission avec un message d'erreur
- [ ] AC4 — `POST /api/admin/appointments/` accepte toute durée entière entre 15 et 240 minutes
- [ ] AC5 — Le flow patient (`POST /api/appointments/`) continue de rejeter toute durée hors 60/90 (comportement inchangé)

### Tarif manuel

- [ ] AC6 — Le formulaire admin affiche une case à cocher "Tarif manuel"
- [ ] AC7 — Quand "Tarif manuel" est activé, un champ numérique de saisie du prix en euros apparaît (min: 0, step: 1)
- [ ] AC8 — Quand "Tarif manuel" est activé, les cases "Remise nouveau client" et "Tarif solidaire" sont désactivées et le calcul automatique est masqué
- [ ] AC9 — `POST /api/admin/appointments/` accepte un champ `override_price` (entier ≥ 0, en euros). Si présent, il remplace entièrement le calcul `calculatePrice` (base = override, discount = 0, final = override)
- [ ] AC10 — Si `override_price` est absent, le calcul automatique s'applique normalement (rétrocompatibilité)

### Création immédiate du calendrier (vidéo)

- [ ] AC11 — À la soumission du formulaire admin pour un RDV vidéo, l'événement Google Calendar est créé immédiatement dans `POST /api/admin/appointments/` (pas après paiement)
- [ ] AC12 — Si `video_link` est fourni dans le formulaire, l'événement calendrier utilise ce lien ; sinon un lien Google Meet est généré automatiquement
- [ ] AC13 — Le patient reçoit une invitation Google Calendar (champ `attendeeEmail`) en parallèle de l'envoi du lien Stripe (si `send_email: true`)
- [ ] AC14 — Si la création de l'événement calendrier échoue, la création du RDV réussit quand même (non-bloquant, erreur loggée)
- [ ] AC15 — `google_calendar_event_id` est persisté en base après la création de l'événement

### Idempotence webhook

- [ ] AC16 — `handlePaymentSucceeded` dans `stripe-webhook.ts` vérifie `google_calendar_event_id` avant de créer un événement calendrier pour les RDV vidéo
- [ ] AC17 — Si `google_calendar_event_id` est déjà renseigné (événement créé par l'admin), le webhook ne crée pas de doublon
- [ ] AC18 — Si `google_calendar_event_id` est nul (RDV créé avant ce fix, ou sans événement calendrier), le webhook crée l'événement normalement

### Rétrocompatibilité

- [ ] AC19 — Les RDV admin existants avec durée 60 ou 90 min continuent de fonctionner normalement
- [ ] AC20 — Le flow de prise de RDV patient (`/rendez-vous.astro`, `POST /api/appointments/`) est inchangé

## Breadboard

| Surface | Action | Handler | Données |
|---------|--------|---------|---------|
| `AdminCreateButton.tsx` | Select "Personnalisée" dans durée | État local `customDuration: boolean` | `form.duration` → `'custom'` + `form.customDurationMinutes: number` |
| `AdminCreateButton.tsx` | Saisir durée custom (ex: 45) | `update('customDurationMinutes', v)` | validé en [15–240] avant soumission |
| `AdminCreateButton.tsx` | Cocher "Tarif manuel" | `update('useOverridePrice', true)` | désactive `override_first_session`, `is_solidarity` |
| `AdminCreateButton.tsx` | Saisir tarif manuel (ex: 55) | `update('override_price', v)` | passe `override_price` dans le payload |
| `AdminCreateButton.tsx` | Soumettre formulaire | `handleSubmit` → `POST /api/admin/appointments/` | payload avec `duration: number`, `override_price?: number` |
| `POST /api/admin/appointments/` | Valider durée | Guard: `Number.isInteger(d) && d >= 15 && d <= 240` | erreur 400 si hors plage |
| `POST /api/admin/appointments/` | Calculer prix | `override_price ?? calculatePrice(...)` | stocké en centimes en base |
| `POST /api/admin/appointments/` | Créer événement calendrier (vidéo) | `createCalendarEvent(...)` immédiat, même chemin que présentiel | `withMeet: !video_link` |
| `POST /api/admin/appointments/` | Persister `google_calendar_event_id` | `supabaseAdmin.update(...)` | après retour `createCalendarEvent` |
| `stripe-webhook.ts` | Paiement reçu → vérifier calendrier | Lire `google_calendar_event_id` de l'appt | si non nul → skip création |
| `stripe-webhook.ts` | Paiement reçu → créer calendrier | `createCalendarEvent(...)` si `google_calendar_event_id` nul | comportement actuel inchangé |

## Slices

**Slice 1 — Types & pricing (fondation) :**
Étendre `AppointmentDuration` côté admin, ajouter `overridePrice?` à `calculatePrice`, mettre `Appointment.duration: number` dans les types.
*Fichiers :* `src/lib/pricing.ts`, `src/types/appointment.ts`

**Slice 2 — Validation API admin :**
Remplacer `VALID_DURATIONS.has()` par la validation `[15–240]`, accepter `override_price` dans le body, appliquer l'override dans le calcul.
*Fichiers :* `src/pages/api/admin/appointments/index.ts`

**Slice 3 — Calendrier immédiat pour vidéo dans l'API admin :**
Refactoriser le bloc de création d'événement pour couvrir `video` (en plus de `in-person`). Générer Meet si pas de `video_link`. Persister `google_calendar_event_id`.
*Fichiers :* `src/pages/api/admin/appointments/index.ts`

**Slice 4 — Idempotence webhook :**
Avant la création d'événement calendrier dans `handlePaymentSucceeded`, lire `google_calendar_event_id`. Si déjà renseigné, marquer `calendarEventCreated = true` sans appeler `createCalendarEvent`.
*Fichiers :* `src/pages/api/stripe-webhook.ts`

**Slice 5 — UI admin (durée custom + prix override) :**
`FormState.duration: number | 'custom'` + `customDurationMinutes: number` + `useOverridePrice: boolean` + `override_price: number`. Afficher/masquer les champs conditionnels. Mise à jour `livePrice`.
*Fichiers :* `src/components/admin/AdminCreateButton.tsx`

## Out of Scope

- Flow patient (`/api/appointments/`, `/rendez-vous.astro`) — validation stricte maintenue
- Grille tarifaire `PRICE_GRID` — pas de modification
- Vérification de disponibilité côté patient pour durées custom
- Mise à jour des événements calendrier existants après création
- Gestion des durées décimales

## Open Questions

- _(aucune — frame et analyse ont couvert les ambiguïtés)_
