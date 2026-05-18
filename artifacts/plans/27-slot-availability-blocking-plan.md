---
issue: 27
tier: F-lite
spec: artifacts/specs/27-slot-availability-blocking-spec.md
status: implemented
---

## Overview

Empêcher les doubles réservations en incluant les RDV Supabase à statut actif
dans le calcul des disponibilités, en complément de Google Calendar Freebusy.
2 fichiers modifiés, 0 migration, 0 nouvelle route.

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|--------------|-----------|
| T1 | Ajouter le param optionnel `dbBusyPeriods` à `getAvailableSlots` ; appliquer l'overlap filter en branche réelle et mock | backend-dev | `src/lib/google-calendar.ts` | — | Y |
| T2 | Ajouter `fetchDbBusyPeriods` + orchestration parallèle dans le handler GET | backend-dev | `src/pages/api/availability.ts` | T1 | N |

## Agent Slices

**backend-dev :** T1, T2

## Sequence

1. **T1** — modification de `google-calendar.ts` (rétrocompatible, paramètre optionnel)
2. **T2** — wiring Supabase dans `availability.ts` (dépend de la nouvelle signature T1)

---

## Notes d'implémentation

### T1 — `src/lib/google-calendar.ts`

**Règle absolue :** aucun import `@supabase/supabase-js` ni `src/lib/supabase` dans ce fichier (AC-7).

#### 1. Nouvelle signature (rétrocompatible)

```typescript
export async function getAvailableSlots(
  startDate: Date,
  endDate: Date,
  duration: AppointmentDuration,
  mode: AppointmentMode,
  dbBusyPeriods: Array<{ start: string; end: string }> = [],
): Promise<TimeSlot[]>
```

Le 5e paramètre est optionnel avec `[]` par défaut → AC-8, aucun appelant existant à modifier.

#### 2. Branche mode réel — fusionner après collecte Freebusy

Après la ligne existante :
```typescript
busyPeriods = (calendarData?.busy ?? []).filter(/* type guard existant */);
```

Ajouter :
```typescript
const allBusy = [...busyPeriods, ...dbBusyPeriods];
```

Dans le `.map()` de filtrage, remplacer `busyPeriods` par `allBusy` :
```typescript
return candidates
  .map((slot) => {
    const slotStart = new Date(slot.start).getTime();
    const slotEnd   = new Date(slot.end).getTime();

    const isBusy = allBusy.some((busy) => {        // ← allBusy (était busyPeriods)
      const busyStart = new Date(busy.start).getTime();
      const busyEnd   = new Date(busy.end).getTime();
      return slotStart < busyEnd && slotEnd > busyStart;
    });

    return { ...slot, available: !isBusy };
  })
  .filter((slot) => slot.available);
```

La logique d'overlap `slotStart < busyEnd && slotEnd > busyStart` est **inchangée**.

#### 3. Branche mock — appliquer le filtre sur `dbBusyPeriods`

Remplacer le `return mockSlots;` final par :
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

Court-circuit sur tableau vide : comportement identique à avant (AC-4).

---

### T2 — `src/pages/api/availability.ts`

#### 1. Import supplémentaire

```typescript
import { supabaseAdmin } from '../../lib/supabase';
```

#### 2. Constante + fonction niveau module (avant le handler)

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
    return []; // dégradation gracieuse — pas pire qu'avant ce fix (AC-5)
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

Points notables :
- `scheduled_end` est une colonne calculée par trigger (`scheduled_at + duration * interval '1 minute'`). Pas d'arithmétique JS.
- `.is('deleted_at', null)` exclut les soft-deletes (AC-3).
- `.in('status', BLOCKING_STATUSES)` exclut `declined` et `cancelled` (AC-2).
- L'erreur Supabase est absorbée dans la fonction, jamais propagée au handler (AC-5).

#### 3. Handler GET — orchestration parallèle

Remplacer :
```typescript
// AVANT
const slots = await getAvailableSlots(now, endDate, duration, mode);
```

par :
```typescript
// APRÈS — lancer fetchDbBusyPeriods immédiatement pour parallélisme réseau (AC-6)
const dbBusyPromise = fetchDbBusyPeriods(now, endDate);
const dbBusy = await dbBusyPromise;
// getAvailableSlots lance l'appel Freebusy en interne ; les deux I/O réseau
// se chevauchent car dbBusyPromise est créée avant l'await.
const slots = await getAvailableSlots(now, endDate, duration, mode, dbBusy);
```

Le bloc `try/catch` existant (`GoogleCalendarError` → 503) est **inchangé**.
`Cache-Control: no-store` est **inchangé**.

---

## Tests à compléter

### `src/lib/google-calendar.test.ts`

| Cas | Setup | Assertion |
|-----|-------|-----------|
| Rétrocompatibilité (sans 5e param) | Mode mock | Slots habituels retournés |
| `dbBusyPeriods` vide | `dbBusyPeriods = []`, mode mock | Tous les slots retournés |
| Overlap DB (mode mock) | `dbBusyPeriods` couvre un créneau mock | Créneau absent |
| Pas d'overlap DB (mode mock) | `dbBusyPeriods` hors plage | Tous les slots retournés |
| Overlap DB + Freebusy (mode réel) | `vi.mock('googleapis')` + `dbBusyPeriods` | Les deux créneaux absents |

### `src/pages/api/availability.test.ts`

Mock : `vi.mock('../../lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))`
Mock Google Calendar : `vi.mock('../../lib/google-calendar', ...)` ou via `googleapis`.

| Cas | Setup Supabase mock | Assertion HTTP |
|-----|---------------------|----------------|
| RDV `pending` dans plage | retourne 1 row pending | Créneau correspondant absent |
| RDV `confirmed` dans plage | retourne 1 row confirmed | Créneau absent |
| RDV `declined` dans plage | retourne 1 row declined — **mais** `BLOCKING_STATUSES` l'exclut côté query, row non retournée | Créneau présent |
| RDV `cancelled` dans plage | idem | Créneau présent |
| RDV soft-deleted | `deleted_at` non null — row filtrée par `.is('deleted_at', null)` | Créneau présent |
| Erreur Supabase | `{ data: null, error: { message: 'timeout' } }` | HTTP 200, slots non filtrés par DB, `console.error` appelé |

---

## File Impact Map

```
src/
├── lib/
│   └── google-calendar.ts          ← modifié  (T1)
└── pages/
    └── api/
        └── availability.ts         ← modifié  (T2)

[tests — à compléter]
src/lib/google-calendar.test.ts     ← nouveaux cas (T1)
src/pages/api/availability.test.ts  ← nouveaux cas (T2)
```

Aucune migration SQL. Aucune nouvelle route. Aucun changement de contrat API public.

---

## Risques & garde-fous

| Risque | Mitigation |
|--------|-----------|
| `scheduled_end` NULL (row antérieure au trigger) | Le type-guard `typeof row.scheduled_end === 'string'` écarte silencieusement ces rows |
| Race condition < 1 s entre deux soumissions simultanées | Acceptée (hors scope F-lite — verrou optimiste DB distinct) |
| Volume excessif de rows (> 8 semaines) | Impossible par design : `.lte('scheduled_at', endDate)` borne la requête à `MAX_WEEKS=8` |
| Régression sur appelants existants de `getAvailableSlots` | Paramètre optionnel `= []` → aucune modification requise ailleurs |
