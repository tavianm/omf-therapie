---
issue: 27
title: "Disponibilité: bloquer les créneaux avec RDV en attente de confirmation"
tier: F-lite
status: approved
---

# Frame — Issue #27 : Bloquer les créneaux avec RDV en attente de confirmation

## Problem

`GET /api/availability` ne consulte que Google Calendar Freebusy pour déterminer les créneaux libres. Or, un événement Calendar n'est créé qu'au moment où la thérapeute **confirme** un rendez-vous. Entre la soumission du patient (status `pending`) et la confirmation, la plage horaire reste visible comme disponible dans le formulaire de prise de rendez-vous.

Conséquence : deux patients peuvent réserver le même créneau simultanément, ce qui force la thérapeute à gérer manuellement les conflits (refus d'un des deux, proposition de report).

Statuts actifs dans `appointments` (table Supabase) après analyse de `src/types/appointment.ts` :

| Statut | Bloquant ? | Raison |
|---|---|---|
| `pending` | ✅ Oui | RDV soumis, créneau réservé de facto |
| `confirmed` | ✅ Oui | Confirmé mais l'événement Calendar peut ne pas encore exister |
| `payment_pending` | ✅ Oui | Lien Stripe envoyé, RDV actif |
| `payment_received` | ✅ Oui | Paiement reçu, RDV actif |
| `rescheduled` | ✅ Oui | `scheduled_at` est l'ancien créneau, toujours bloquant jusqu'à report effectif |
| `declined` | ❌ Non | RDV refusé, créneau libéré |
| `cancelled` | ❌ Non | RDV annulé, créneau libéré |

---

## Constraints

1. **Séparation des responsabilités** — `src/lib/google-calendar.ts` n'importe pas Supabase. Cette contrainte doit être préservée : le module Google Calendar reste pur de toute dépendance infrastructure Supabase.

2. **Logique d'overlap existante** — La fonction `getAvailableSlots` filtre déjà selon `slotStart < busyEnd && slotEnd > busyStart`. La même logique doit s'appliquer aux périodes DB sans duplication.

3. **Performance** — La requête Freebusy (réseau externe) et la requête Supabase (réseau interne) sont indépendantes et doivent s'exécuter en parallèle via `Promise.all`.

4. **Soft deletes** — La table `appointments` utilise `deleted_at` (nullable). La requête DB doit filtrer `deleted_at IS NULL` pour exclure les enregistrements supprimés.

5. **Client Supabase** — Utiliser `supabaseAdmin` (service_role, contourne RLS) depuis `src/lib/supabase.ts`, car `availability.ts` est une route SSR server-side (`prerender = false`).

6. **Mock mode** — En mode mock (`GOOGLE_CALENDAR_MOCK=true`), `getAvailableSlots` retourne des créneaux sans appeler Freebusy. Les `dbBusyPeriods` passés en paramètre **doivent quand même être appliqués** pour que le comportement de blocage soit cohérent en dev/test.

7. **Pas de `completed` dans le type** — `AppointmentStatus` ne définit pas de statut `completed`. Seuls `declined` et `cancelled` sont non-bloquants ; tous les autres statuts bloquent.

---

## Approach

### Principe : paramètre optionnel `dbBusyPeriods` dans `getAvailableSlots`

`getAvailableSlots` accepte un nouveau paramètre optionnel `dbBusyPeriods`. `availability.ts` devient responsable de la collecte des périodes occupées côté DB et les transmet à la fonction. La logique de filtrage des créneaux fusionne les deux sources.

```
availability.ts
  ├── validation des query params  (inchangé)
  ├── Promise.all([
  │     getAvailableSlots(now, endDate, duration, mode, dbBusyPeriods),
  │                                                     ^-- résultat ci-dessous
  │     fetchDbBusyPeriods(now, endDate)  ← nouvelle fonction locale
  │   ])                                    (supabaseAdmin query)
  └── retourne les slots filtrés

google-calendar.ts  ::  getAvailableSlots(start, end, duration, mode, dbBusyPeriods?)
  ├── génère les candidats  (inchangé)
  ├── [mode réel] appelle Freebusy  (inchangé)
  ├── fusionne : allBusy = [...gcalBusy, ...(dbBusyPeriods ?? [])]
  └── filtre les candidats sur allBusy  (logique overlap inchangée)
```

### Signature modifiée de `getAvailableSlots`

```typescript
export async function getAvailableSlots(
  startDate: Date,
  endDate: Date,
  duration: AppointmentDuration,
  mode: AppointmentMode,
  dbBusyPeriods: Array<{ start: string; end: string }> = [],
): Promise<TimeSlot[]>
```

Le paramètre est en dernière position avec une valeur par défaut `[]` pour garantir la rétrocompatibilité (aucun appelant existant à modifier hors `availability.ts`).

### Requête DB dans `availability.ts`

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
    .select('scheduled_at, duration')
    .in('status', BLOCKING_STATUSES)
    .is('deleted_at', null)
    .gte('scheduled_at', from.toISOString())
    .lte('scheduled_at', to.toISOString());

  if (error) {
    console.error('[api/availability] Erreur DB busy periods :', error.message);
    // Dégradation gracieuse : on ne bloque pas l'endpoint,
    // les périodes DB manquantes sont ignorées (pas pire qu'avant ce fix)
    return [];
  }

  return (data ?? []).map((row) => ({
    start: row.scheduled_at,
    end: new Date(
      new Date(row.scheduled_at).getTime() + row.duration * 60 * 1000,
    ).toISOString(),
  }));
}
```

### Orchestration dans le handler `GET`

```typescript
const [slots] = await Promise.all([
  (async () => {
    const dbBusy = await fetchDbBusyPeriods(now, endDate);
    return getAvailableSlots(now, endDate, duration, mode, dbBusy);
  })(),
]);
```

> **Note d'implémentation** : `fetchDbBusyPeriods` et `getAvailableSlots` (qui appelle Freebusy) sont de nature séquentielle dans la version naïve. Pour le vrai parallélisme, `fetchDbBusyPeriods` doit être lancé **avant** l'appel `getAvailableSlots`, puis les résultats fusionnés :
>
> ```typescript
> const [dbBusy, gcalSlots] = await Promise.all([
>   fetchDbBusyPeriods(now, endDate),
>   // On a besoin que getAvailableSlots expose aussi le Freebusy séparément,
>   // OU on restructure légèrement.
> ]);
> ```
>
> La solution propre : `availability.ts` lance `fetchDbBusyPeriods` en parallèle du calcul des candidats, puis appelle `getAvailableSlots` avec les deux résultats. Comme `getAvailableSlots` est `async` (appel Freebusy interne), l'agent d'implémentation choisira la forme la plus lisible tout en garantissant le parallélisme réel (Promise.all sur Freebusy + DB).

---

## Vertical Slices

### Slice 1 — Paramètre `dbBusyPeriods` dans `google-calendar.ts`

**Fichier** : `src/lib/google-calendar.ts`

- Ajouter `dbBusyPeriods: Array<{ start: string; end: string }> = []` comme 5e paramètre de `getAvailableSlots`.
- En mode **réel** : fusionner `busyPeriods` (Freebusy) et `dbBusyPeriods` dans `allBusy` avant le `.map()` de filtrage.
- En mode **mock** : appliquer le même filtrage `dbBusyPeriods` sur `mockSlots` (actuellement aucun filtre n'est appliqué en mock, ce qui est cohérent avec l'absence de Freebusy, mais les DB busy periods doivent tout de même bloquer).
- Aucun import Supabase dans ce fichier.

**Tests** : cas d'overlap DB seul, cas Freebusy seul, cas sans paramètre (rétrocompat).

---

### Slice 2 — `fetchDbBusyPeriods` + orchestration parallèle dans `availability.ts`

**Fichier** : `src/pages/api/availability.ts`

- Importer `supabaseAdmin` depuis `@/lib/supabase`.
- Définir la constante `BLOCKING_STATUSES` et la fonction `fetchDbBusyPeriods`.
- Dans le handler `GET`, remplacer l'appel simple à `getAvailableSlots` par une exécution parallèle : Freebusy (via `getAvailableSlots`) + DB query (via `fetchDbBusyPeriods`), puis transmission des `dbBusy` en paramètre.
- Dégradation gracieuse : si `fetchDbBusyPeriods` échoue (erreur Supabase), loguer l'erreur et continuer avec `dbBusyPeriods = []` (comportement identique à avant le fix, pas de 503).

**Tests** : mock `supabaseAdmin`, vérifier que les slots `pending`/`confirmed` sont absents de la réponse, que `declined`/`cancelled` ne bloquent pas.

---

## Out of Scope

- **Nettoyage automatique** des RDV `pending` expirés : un cron job / edge function de purge pourrait libérer les créneaux dont le `pending` est trop ancien, mais c'est une feature distincte.
- **Verrouillage optimiste** (pessimistic locking) : empêcher deux patients de soumettre simultanément le même créneau via une transaction DB atomique — hors scope, la fenêtre de race condition résiduelle est acceptée.
- **Pagination** de la requête `fetchDbBusyPeriods` : la plage max est 8 semaines × quelques RDV/semaine, pas de risque de dépassement mémoire justifiant une pagination.
- **Invalidation de cache** : `Cache-Control: no-store` est déjà présent sur l'endpoint, aucun changement requis.
- **Exposition du statut** dans la réponse API : `TimeSlot` ne retourne pas pourquoi un créneau est indisponible (Freebusy vs DB), et ça reste ainsi.
- **Rescheduled + `rescheduled_to`** : quand `status = 'rescheduled'`, `scheduled_at` est l'ancien créneau. Le nouveau créneau (`rescheduled_to`) sera géré soit par un nouveau RDV en `confirmed`, soit par un event Calendar — les deux cas sont déjà couverts par les mécanismes existants.
