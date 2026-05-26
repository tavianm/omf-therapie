---
issue: 38
title: "feat: amélioration du flow d'invitation RDV par le thérapeute — durée/tarif flexibles + création immédiate du calendrier"
type: feature
complexity: L
tier: F-full
---

## Problem

3 limitations dans le flow d'invitation admin :

1. **Durées figées** : `AppointmentDuration = 60 | 90` (union TypeScript stricte), `VALID_DURATIONS = new Set([60, 90])` dans l'API admin. Pas de support de durées comme 45, 75, 120 min.
2. **Prix non-override** : `calculatePrice()` nécessite un type/durée valide et ne dispose pas de mécanisme d'override. Les configurations hors-grille produisent des tarifs incorrects ou bloquent la création.
3. **Calendrier bloqué sur le paiement** : les RDV vidéo admin sont insérés avec `status: 'payment_pending'`. L'événement Google Calendar est créé **uniquement** dans `stripe-webhook.ts → handlePaymentSucceeded()`. Si le patient ne paie pas via Stripe, l'événement n'est jamais créé. De plus, le webhook ne vérifie pas `google_calendar_event_id` — un doublon serait créé si on fixait l'admin sans corriger le webhook.

## Current State (technique)

### Chaîne de dépendances de type

```
src/lib/pricing.ts
  → AppointmentDuration = 60 | 90
  → calculatePrice(type, duration: AppointmentDuration, ...) 

src/types/appointment.ts
  → re-exporte AppointmentDuration
  → Appointment.duration: 60 | 90  (mais DB stocke un INTEGER sans contrainte)

src/pages/api/admin/appointments/index.ts
  → VALID_DURATIONS = new Set<number>([60, 90])
  → calculatePrice(... Number(duration) as AppointmentDuration ...)
  → crée événement calendrier pour in-person uniquement (lignes 184–211)
  → pas d'événement calendrier pour video (statut payment_pending → délégué au webhook)

src/pages/api/stripe-webhook.ts → handlePaymentSucceeded()
  → crée événement calendrier pour video APRÈS paiement (lignes 225–317)
  → idempotence basée sur stripe_event_id uniquement — google_calendar_event_id non vérifié
```

### Gaps identifiés

| Gap | Fichier(s) | Impact |
|-----|-----------|--------|
| Durée contrainte 60/90 | `pricing.ts`, `admin/appointments/index.ts` | Impossible créer RDV 45 min |
| Calcul prix sans override | `pricing.ts`, `AdminCreateButton.tsx` | Pas de tarif custom |
| Calendrier vidéo après paiement | `admin/appointments/index.ts` | RDV invisible si pas de Stripe |
| Pas de déduplication calendrier | `stripe-webhook.ts` | Doublons si on corrige l'admin |
| Type `Appointment.duration: 60 \| 90` | `types/appointment.ts` | TypeScript casse sur durée custom |

## Impact

- **Users affected:** Thérapeute (admin) — uniquement le flow d'invitation. Patients non affectés.
- **Severity:** medium (workaround manuel existant — Google Calendar ouvert séparément)
- **Files affected:**
  - `src/lib/pricing.ts`
  - `src/types/appointment.ts`
  - `src/components/admin/AdminCreateButton.tsx`
  - `src/pages/api/admin/appointments/index.ts`
  - `src/pages/api/stripe-webhook.ts`
  - `src/pages/api/appointments/index.ts` — **lecture seule, aucune modification** (flow patient, validation stricte maintenue)

## Approach Options

### Option A — Type étendu + override déclaratif (recommandée)

**Principe :** `AppointmentDuration` reste `60 | 90` pour le flow patient. On ajoute un type `AdminDuration = number` dans le scope admin + un paramètre `overridePrice?: number` à `calculatePrice`.

**Durée :**
- `pricing.ts` : ajouter `type AdminDuration = number` (admin-only alias)
- `admin/appointments/index.ts` : remplacer `VALID_DURATIONS.has()` par `Number.isInteger(d) && d >= 15 && d <= 240`
- `AdminCreateButton.tsx` : `duration` dans `FormState` devient `number` ; UI = select avec option "Personnalisée" + champ `<input type="number">` conditionnel
- `types/appointment.ts` : `Appointment.duration: number` (reflète la réalité DB — `INTEGER` sans contrainte de valeur)

**Prix :**
- `pricing.ts` : `calculatePrice(..., overridePrice?: number)` — quand fourni, court-circuite le grid lookup et retourne directement `{ basePrice: overridePrice, discount: 0, finalPrice: overridePrice }`
- `AdminCreateButton.tsx` : checkbox "Tarif manuel" + `<input type="number">` conditionnel ; quand activé, passe `override_price` dans le payload
- `admin/appointments/index.ts` : si `override_price` présent dans le body, l'utiliser directement au lieu de `calculatePrice`

**Calendrier immédiat :**
- `admin/appointments/index.ts` : déplacer la création d'événement calendrier (actuellement in-person only) pour couvrir aussi `video`. Créer l'événement avec `withMeet: true` pour auto-générer le lien Google Meet ou utiliser `video_link` si fourni. Faire en parallèle de l'envoi Stripe.
- `stripe-webhook.ts` : avant de créer l'événement, lire `google_calendar_event_id` du RDV ; si non nul → skip la création (l'admin a déjà créé).

```
Pros: 
  - Séparation claire patient (strict 60/90) vs admin (flexible)
  - Pas de rupture du flow patient
  - Minimal : ~5 lignes dans pricing.ts, validation localisée dans admin API
  - DB déjà en INTEGER, pas de migration
Cons:
  - Deux types pour représenter "durée" (AppointmentDuration vs number) — légère incohérence documentaire
Risk: low
```

### Option B — Champs séparés `override_duration` + `override_price`

**Principe :** `duration` reste toujours 60 ou 90 dans le payload. On ajoute `override_duration` et `override_price` comme champs distincts.

```
Pros: AppointmentDuration inchangé dans tous les types
Cons: 
  - Deux champs pour une seule donnée sémantique
  - DB stocke `duration` = 60|90 même si réellement 45 min — incohérent
  - Logique de résolution ("use override_duration if present, else duration") plus complexe
  - Calendrier utilise la mauvaise durée sans précautions
Risk: medium (bugs de cohérence)
```

### Option C — Relâcher `AppointmentDuration` globalement à `number`

**Principe :** `AppointmentDuration = number` partout, supprimer `VALID_DURATIONS` dans les deux APIs.

```
Pros: Simple
Cons:
  - Supprime la validation stricte côté patient (risque sécurité : payload forgé)
  - Casse la grille tarifaire pour les durées non définies dans PRICE_GRID (KeyError)
  - Trop large
Risk: high
```

## Recommendation

**Option A** — type étendu + override déclaratif.

Justification : le flow patient garde sa validation stricte (sécurité), le flow admin gagne la flexibilité nécessaire via des modifications localisées. L'idempotence du webhook est corrigée comme effet de bord direct et obligatoire (évite un bug de doublon si on ne le fait pas).

**Séquence d'implémentation recommandée :**
1. `pricing.ts` — `AdminDuration`, `overridePrice` param dans `calculatePrice`
2. `types/appointment.ts` — `duration: number` (reflect DB)
3. `admin/appointments/index.ts` — validation flexible + calendrier immédiat pour video
4. `stripe-webhook.ts` — check `google_calendar_event_id` avant création
5. `AdminCreateButton.tsx` — UI durée custom + prix override

## Appetite

Estimated tier: F-full (~3 jours)
- 5 fichiers modifiés
- 3 domaines (UI React, API serverless, Google Calendar)
- Nouveau pattern : calendrier découplé du paiement avec idempotence
- Risque principal : webhook `handlePaymentSucceeded` doit être mis à jour atomiquement avec l'admin API pour éviter les doublons

Spike: non requis — approche claire, pas de dépendances externes nouvelles.
