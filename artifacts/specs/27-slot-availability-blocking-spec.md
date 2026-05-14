---
issue: 27
title: "Bloquer les créneaux dès la réservation (statuts actifs)"
tier: F-lite
status: draft
frame: artifacts/frames/27-slot-availability-blocking-frame.md
---

## Goal

Empêcher que deux patients réservent le même créneau en incluant les
rendez-vous Supabase à statut actif dans le calcul des disponibilités, en
complément de Google Calendar Freebusy.

## Context

### Problème actuel

`GET /api/availability` interroge uniquement Google Calendar Freebusy. Or,
un événement Calendar n'est créé que lorsque la thérapeute **confirme** un
RDV. Entre la soumission (`pending`) et la confirmation, le créneau reste
visible comme libre → double-réservation possible.

### Fichiers impactés

| Fichier | Rôle actuel | Changement |
|---|---|---|
| `src/lib/google-calendar.ts` | Génère les candidats, interroge Freebusy | Ajout du param `dbBusyPeriods` |
| `src/pages/api/availability.ts` | Handler HTTP, appelle `getAvailableSlots` | Ajout de `fetchDbBusyPeriods` + orchestration parallèle |

### Contraintes architecturales

- **Séparation des responsabilités** : `google-calendar.ts` ne doit pas importer Supabase.
  La fusion des deux sources de busy-periods se fait dans la fonction elle-même,
  mais l'alimentation en données DB est la responsabilité exclusive de `availability.ts`.
- **`supabaseAdmin`** (service_role, contourne RLS) — seul client utilisable dans une route
  SSR server-side (`prerender = false`).
- **`scheduled_end`** est une colonne DB calculée automatiquement par un trigger
  (`scheduled_at + duration * interval '1 minute'`). On peut la sélectionner directement,
  sans arithmétique côté serveur.
- **Soft deletes** : `deleted_at IS NULL` est obligatoire dans la requête.
- **`Cache-Control: no-store`** est déjà positionné sur l'endpoint — aucun changement requis.

### Statuts bloquants

Définis par `AppointmentStatus` dans `src/types/appointment.ts` :

| Statut | Bloquant | Raison |
|---|---|---|
| `pending` | ✅ | RDV soumis, créneau réservé de facto |
| `confirmed` | ✅ | Confirmé, l'événement Calendar peut ne pas encore exister |
| `payment_pending` | ✅ | Lien Stripe envoyé, RDV actif |
| `payment_received` | ✅ | Paiement reçu, RDV actif |
| `rescheduled` | ✅ | `scheduled_at` = ancien créneau, bloquant jusqu'au report effectif |
| `declined` | ❌ | RDV refusé, créneau libéré |
| `cancelled` | ❌ | RDV annulé, créneau libéré |

---

## Acceptance Criteria

- [ ] **AC-1** — Un créneau dont le `scheduled_at` chevauche un RDV Supabase avec un statut
  bloquant (`pending`, `confirmed`, `payment_pending`, `payment_received`, `rescheduled`)
  **n'apparaît pas** dans la réponse de `GET /api/availability`.
- [ ] **AC-2** — Un créneau dont le `scheduled_at` chevauche un RDV avec statut `declined` ou
  `cancelled` **est toujours retourné** (pas de blocage).
- [ ] **AC-3** — Les RDV soft-deleted (`deleted_at IS NOT NULL`) **ne bloquent pas** de créneau.
- [ ] **AC-4** — En mode mock (`GOOGLE_CALENDAR_MOCK=true`), les créneaux bloqués par des
  périodes DB sont **également filtrés** (les `dbBusyPeriods` s'appliquent même sans Freebusy).
- [ ] **AC-5** — Si la requête Supabase échoue (erreur réseau, config manquante), l'endpoint
  répond normalement **sans 503** : l'erreur est loguée, `dbBusyPeriods` est considéré vide
  (dégradation gracieuse, comportement identique à avant ce fix).
- [ ] **AC-6** — La requête Supabase et l'appel Freebusy s'exécutent **en parallèle** (via
  `Promise.all`), sans allonger le temps de réponse de l'endpoint.
- [ ] **AC-7** — `google-calendar.ts` ne contient **aucun import** de `@supabase/supabase-js`
  ni de `src/lib/supabase`.
- [ ] **AC-8** — L'appel existant `getAvailableSlots(now, endDate, duration, mode)` sans le
  5e paramètre continue de fonctionner (rétrocompatibilité, paramètre optionnel avec `[]` par
  défaut).

---

## Breadboard

```
GET /api/availability?mode=…&duration=…&weeks=…
  │
  ├─ [validation params]  (inchangé)
  │
  ├─ Promise.all([
  │     fetchDbBusyPeriods(now, endDate),    ← NEW — Supabase query
  │     freebusyCall(),                      ← existant, via getAvailableSlots interne
  │  ])
  │     │
  │     ├─ dbBusy : {start, end}[]  (ou [] si erreur Supabase)
  │     └─ gcalBusy : interne à getAvailableSlots
  │
  ├─ getAvailableSlots(now, endDate, duration, mode, dbBusy)
  │     │
  │     ├─ generateCandidateSlots()          (inchangé)
  │     ├─ [mode réel] Freebusy query        (inchangé)
  │     ├─ allBusy = [...gcalBusy, ...dbBusy]
  │     └─ filter candidates on allBusy      (logique overlap inchangée)
  │
  └─ jsonSuccess(slots)
```

**Séquence de parallélisme réel :**

```typescript
// availability.ts — handler GET
const [dbBusy, slots] = await Promise.all([
  fetchDbBusyPeriods(now, endDate),
  // getAvailableSlots sera appelé après avec dbBusy — voir note ci-dessous
]);
// Puis :
const slots = await getAvailableSlots(now, endDate, duration, mode, dbBusy);
```

> **Note** : `getAvailableSlots` fait l'appel Freebusy en interne. Le vrai parallélisme
> Freebusy ↔ DB nécessite de lancer `fetchDbBusyPeriods` *pendant* que `getAvailableSlots`
> génère ses candidats et appelle Freebusy. La forme la plus lisible — et correcte — est de
> lancer les deux en `Promise.all` en restructurant légèrement : soit en exposant la requête
> Freebusy séparément (hors scope), soit en acceptant que `fetchDbBusyPeriods` se termine
> avant ou pendant l'appel Freebusy (les deux sont des I/O réseau indépendants, `Promise.all`
> les lance bien en parallèle même si `getAvailableSlots` n'est appelé qu'après). L'agent
> d'implémentation choisit la forme la plus lisible qui garantit ce parallélisme.

---

## Slices

### Slice 1 — Paramètre `dbBusyPeriods` dans `google-calendar.ts`

**Fichier** : `src/lib/google-calendar.ts`

**Changements :**

1. Modifier la signature de `getAvailableSlots` :

```typescript
export async function getAvailableSlots(
  startDate: Date,
  endDate: Date,
  duration: AppointmentDuration,
  mode: AppointmentMode,
  dbBusyPeriods: Array<{ start: string; end: string }> = [],
): Promise<TimeSlot[]>
```

2. **Branche mode réel** — après la collecte de `busyPeriods` Freebusy, fusionner :

```typescript
const allBusy = [...busyPeriods, ...dbBusyPeriods];
```

Remplacer les références à `busyPeriods` dans le `.map()` de filtrage par `allBusy`.
La logique d'overlap `slotStart < busyEnd && slotEnd > busyStart` est **inchangée**.

3. **Branche mock** — après génération de `mockSlots`, appliquer le même filtre overlap
   sur `dbBusyPeriods` avant le `return` :

```typescript
if (dbBusyPeriods.length === 0) return mockSlots;

return mockSlots.filter((slot) => {
  const slotStart = new Date(slot.start).getTime();
  const slotEnd   = new Date(slot.end).getTime();
  return !dbBusyPeriods.some((busy) => {
    const busyStart = new Date(busy.start).getTime();
    const busyEnd   = new Date(busy.end).getTime();
    return slotStart < busyEnd && slotEnd > busyStart;
  });
});
```

**Aucun import Supabase dans ce fichier.**

---

### Slice 2 — `fetchDbBusyPeriods` + orchestration dans `availability.ts`

**Fichier** : `src/pages/api/availability.ts`

**Changements :**

1. Ajouter l'import :

```typescript
import { supabaseAdmin } from '@/lib/supabase';
```

2. Définir la constante et la fonction (niveau module, en dehors du handler) :

```typescript
const BLOCKING_STATUSES = [
  'pending',
  'confirmed',
  'payment_pending',
  'payment_received',
  'rescheduled',
] as const;

async function fetchDbBusyPeriods(
  from: Date,
  to: Date,
): Promise<Array<{ start: string; end: string }>> {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('scheduled_at, scheduled_end')
    .in('status', BLOCKING_STATUSES)
    .is('deleted_at', null)
    .gte('scheduled_at', from.toISOString())
    .lte('scheduled_at', to.toISOString());

  if (error) {
    console.error('[api/availability] Erreur DB busy periods :', error.message);
    return []; // dégradation gracieuse — pas pire qu'avant ce fix
  }

  return (data ?? [])
    .filter(
      (row): row is { scheduled_at: string; scheduled_end: string } =>
        typeof row.scheduled_at === 'string' &&
        typeof row.scheduled_end === 'string',
    )
    .map((row) => ({ start: row.scheduled_at, end: row.scheduled_end }));
}
```

> `scheduled_end` est calculé par le trigger DB (`scheduled_at + duration * interval '1 minute'`).
> On le lit directement — pas d'arithmétique JS.

3. Dans le handler `GET`, remplacer :

```typescript
// AVANT
const slots = await getAvailableSlots(now, endDate, duration, mode);
```

par :

```typescript
// APRÈS
const [dbBusy, slots] = await Promise.all([
  fetchDbBusyPeriods(now, endDate),
  // Note: getAvailableSlots doit recevoir dbBusy — voir ci-dessous
  Promise.resolve(null), // placeholder pour lancer fetchDbBusyPeriods en parallèle
]);
// On appelle getAvailableSlots après avoir récupéré dbBusy :
const slots = await getAvailableSlots(now, endDate, duration, mode, dbBusy);
```

**Forme recommandée (plus idiomatique) :**

```typescript
const dbBusyPromise = fetchDbBusyPeriods(now, endDate);
const dbBusy = await dbBusyPromise; // fetchDbBusyPeriods démarre immédiatement

// Puis on passe dbBusy à getAvailableSlots qui lance Freebusy en interne.
// Les deux requêtes réseau se chevauchent si dbBusy se résout avant la fin de Freebusy.
const slots = await getAvailableSlots(now, endDate, duration, mode, dbBusy);
```

> **Alternative propre si le vrai parallélisme est critique** : exposer `fetchFreebusy` comme
> fonction séparée dans `google-calendar.ts` et faire un `Promise.all([fetchFreebusy(), fetchDbBusyPeriods()])`.
> Considéré hors scope pour ce fix F-lite — la forme ci-dessus est suffisante.

La gestion d'erreur `try/catch` existante (`GoogleCalendarError` → 503) reste inchangée.
L'erreur Supabase est capturée dans `fetchDbBusyPeriods` elle-même et ne propage pas
d'exception vers le handler.

---

## Tests

Les tests sont unitaires (vitest) et ne requièrent pas de serveur Supabase réel.

### `google-calendar.test.ts` — nouvelles assertions

| Cas | Description | Résultat attendu |
|---|---|---|
| `dbBusyPeriods` absent | Appel sans 5e paramètre | Aucune régression, slots habituels retournés |
| Overlap DB seul (mode mock) | `dbBusyPeriods` couvre un créneau mock | Créneau absent du résultat |
| Pas d'overlap DB (mode mock) | `dbBusyPeriods` hors plage des candidats | Tous les créneaux retournés |
| Overlap DB + Freebusy (mode réel) | `dbBusyPeriods` couvre un créneau, Freebusy en couvre un autre | Les deux créneaux absents |

**Mock Freebusy** : utiliser `vi.mock('googleapis', ...)` pour stubber `calendar.freebusy.query`.

### `availability.test.ts` — nouvelles assertions

| Cas | Description | Résultat attendu |
|---|---|---|
| RDV `pending` dans la plage | `supabaseAdmin.from()` retourne 1 row pending | Créneau correspondant absent de la réponse |
| RDV `confirmed` dans la plage | idem, status `confirmed` | Créneau absent |
| RDV `declined` dans la plage | idem, status `declined` | Créneau **présent** |
| RDV `cancelled` dans la plage | idem, status `cancelled` | Créneau **présent** |
| RDV soft-deleted | `deleted_at` non null | Créneau **présent** (non bloqué) |
| Erreur Supabase | `supabaseAdmin.from()` retourne `{ error: { message: '...' } }` | HTTP 200, slots non filtrés par DB, erreur loguée |

**Mock Supabase** : stubber `supabaseAdmin` via `vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))`.
**Mock Google Calendar** : stubber `getAvailableSlots` ou `googleapis` selon le niveau de test.

---

## File Impact Map

```
src/
├── lib/
│   └── google-calendar.ts          ← modifié  (Slice 1)
└── pages/
    └── api/
        └── availability.ts         ← modifié  (Slice 2)

[tests — à créer ou compléter]
src/lib/google-calendar.test.ts     ← nouveaux cas (Slice 1)
src/pages/api/availability.test.ts  ← nouveaux cas (Slice 2)
```

---

## Out of Scope

- **Nettoyage des `pending` expirés** — cron job de purge, feature distincte.
- **Verrouillage optimiste** — race condition résiduelle sur soumissions simultanées, acceptée.
- **Exposition du motif d'indisponibilité** dans `TimeSlot` — non requis.
- **`rescheduled_to`** — le nouveau créneau est couvert par un RDV `confirmed` ou un event
  Calendar existant ; aucun traitement supplémentaire ici.
- **Refactoring `getAvailableSlots`** pour exposer Freebusy séparément — améliorerait le
  parallélisme pur mais dépasse le scope F-lite.
- **Pagination** de `fetchDbBusyPeriods` — la plage max est 8 semaines, volume négligeable.
