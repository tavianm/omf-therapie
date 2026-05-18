---
issue: 25
tier: F-lite
spec: artifacts/specs/25-google-meet-auto-generation-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|--------------|-----------|
| T1 | Ajouter `CreateEventResult`, étendre `CreateEventParams` (`withMeet?`, `appointmentId?`), changer la signature de `createCalendarEvent` → `Promise<CreateEventResult>`, mettre à jour le mock et le mode réel (`conferenceData` + extraction `meetLink`) | backend-dev | `src/lib/google-calendar.ts` | — | Y |
| T2 | Importer `createCalendarEvent`, insérer le bloc de génération Meet dans `handlePaymentSucceeded` (après fetch DB, avant le try ICS), remplacer `updatedAppt.video_link ?? undefined` par `videoLink` dans `createElement(AppointmentConfirmed, …)` | backend-dev | `src/pages/api/stripe-webhook.ts` | T1 | N |
| T3 | Importer `createCalendarEvent`, insérer le bloc de génération Meet dans `action === 'confirm'` (après validation `video_link` manuel, avant le `supabaseAdmin.update()`) — `meetLink` injecté dans `updateData.video_link` | backend-dev | `src/pages/api/appointments/[id].ts` | T1 | N |
| T4 | Mettre à jour les libellés `video_link` dans les deux composants admin | frontend-dev | `src/components/admin/AppointmentCard.tsx`, `src/components/admin/AdminCreateButton.tsx` | — | Y |

## Agent Slices

**backend-dev:** T1, T2, T3  
**frontend-dev:** T4

## Sequence

1. **T1** — `google-calendar.ts` : interface + signature commune (base de T2 et T3)
2. **T2** — `stripe-webhook.ts` : flux principal paiement Stripe (dépend T1)
3. **T3** — `[id].ts` : edge case confirm direct (dépend T1)
4. **T4** — labels UI admin (indépendant, parallèle avec T1→T3)

## Notes d'implémentation

### T1 — `src/lib/google-calendar.ts`

**Nouveaux types** (après `CreateEventParams` existant) :
```typescript
export interface CreateEventResult {
  eventId: string;
  meetLink?: string;
}
```

**Extension `CreateEventParams`** :
```typescript
export interface CreateEventParams {
  title: string;
  start: string;        // ISO 8601
  end: string;          // ISO 8601
  description?: string;
  attendeeEmail?: string;
  withMeet?: boolean;       // demande un lien Google Meet
  appointmentId?: string;   // requestId idempotence Google + suffixe URL mock
}
```

**Signature** :
```typescript
export async function createCalendarEvent(
  params: CreateEventParams,
): Promise<CreateEventResult>
```

**Branch mock** (remplace `return \`mock-event-${Date.now()}\``) :
```typescript
if (MOCK_MODE) {
  console.log(`[calendar-mock] Creating event: ${params.title} at ${params.start}`);
  const eventId = `mock-event-${Date.now()}`;
  const meetLink = params.withMeet && params.appointmentId
    ? `https://meet.google.com/mock-${params.appointmentId.slice(0, 8)}`
    : undefined;
  return { eventId, meetLink };
}
```

**Mode réel** — enrichir `calendar.events.insert` :
```typescript
const response = await calendar.events.insert({
  calendarId,
  sendUpdates: params.attendeeEmail ? 'all' : 'none',
  conferenceDataVersion: params.withMeet ? 1 : 0,   // ← nouveau
  requestBody: {
    summary: params.title,
    description: params.description,
    start: { dateTime: params.start, timeZone: TIMEZONE },
    end:   { dateTime: params.end,   timeZone: TIMEZONE },
    attendees,
    ...(params.withMeet && params.appointmentId ? {
      conferenceData: {
        createRequest: {
          requestId: params.appointmentId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    } : {}),
  },
});
```

**Extraction du lien et retour** (remplace `return eventId`) :
```typescript
const meetLink =
  response.data.conferenceData?.entryPoints
    ?.find(ep => ep.entryPointType === 'video')?.uri
  ?? response.data.hangoutLink
  ?? undefined;

return { eventId, meetLink };
```
> `hangoutLink` est le champ de haut niveau de l'API Calendar v3 — couverture redondante.  
> Aucun import Supabase ajouté (AC11).

---

### T2 — `src/pages/api/stripe-webhook.ts`

**Import** à ajouter après la ligne `import type { Appointment }` :
```typescript
import { createCalendarEvent } from '../../lib/google-calendar';
```

**Bloc Meet** à insérer dans `handlePaymentSucceeded`, après `const updatedAppt = updated as Appointment;` et **avant** le `try { const icsEvent = buildICSEvent(…) }` :
```typescript
// Auto-génération Meet — séance vidéo sans lien existant
let videoLink: string | undefined = updatedAppt.video_link ?? undefined;

if (updatedAppt.appointment_mode === 'video' && !videoLink) {
  try {
    const { meetLink } = await createCalendarEvent({
      title: `Séance ${getTypeLabel(updatedAppt.appointment_type)} — ${updatedAppt.patient_name}`,
      start: updatedAppt.scheduled_at,
      end: new Date(
        new Date(updatedAppt.scheduled_at).getTime() + updatedAppt.duration * 60_000,
      ).toISOString(),
      attendeeEmail: updatedAppt.patient_email,
      withMeet: true,
      appointmentId: updatedAppt.id,
    });

    if (meetLink) {
      videoLink = meetLink;
      // Persistance — second UPDATE non bloquant (l'idempotence principale est déjà validée)
      await supabaseAdmin
        .from('appointments')
        .update({ video_link: meetLink })
        .eq('id', updatedAppt.id);
    }
  } catch (calErr) {
    console.error('[stripe-webhook] Erreur création événement Calendar / Meet:', calErr);
    // Non-fatal : l'email part quand même sans lien vidéo (AC10)
  }
}
```

**Dans `createElement(AppointmentConfirmed, …)`** remplacer :
```typescript
videoLink: updatedAppt.video_link ?? undefined,
```
par :
```typescript
videoLink,  // variable locale — prend la valeur auto-générée ou DB
```

> `getTypeLabel` est déjà importé (ligne 11) — pas de nouvel import.  
> Le guard `!videoLink` (initialisé depuis `updatedAppt.video_link`) assure qu'un lien manuel existant n'est jamais écrasé (AC6).  
> L'idempotence Google est garantie par `requestId = appointmentId` (AC7).

---

### T3 — `src/pages/api/appointments/[id].ts`

**Import** à ajouter après la ligne `import type { Appointment }` :
```typescript
import { createCalendarEvent } from '../../../lib/google-calendar';
```

**Bloc Meet** à insérer dans `action === 'confirm'`, **après** la validation `video_link` manuel (fin du bloc `if (video_link) { … }`, ligne ~138) et **avant** le bloc `if (stripe_payment_intent_id)` (ligne ~140) :
```typescript
// Auto-génération Meet — vidéo confirmée directement, sans lien manuel
if (
  appointment.appointment_mode === 'video'
  && newStatus === 'confirmed'
  && !updateData.video_link
) {
  try {
    const { meetLink } = await createCalendarEvent({
      title: `Séance ${getTypeLabel(appointment.appointment_type)} — ${appointment.patient_name}`,
      start: appointment.scheduled_at,
      end: new Date(
        new Date(appointment.scheduled_at).getTime() + appointment.duration * 60_000,
      ).toISOString(),
      attendeeEmail: appointment.patient_email,
      withMeet: true,
      appointmentId: appointment.id,
    });
    if (meetLink) updateData.video_link = meetLink;
  } catch (calErr) {
    console.error('[appointments/patch] Erreur création Meet:', calErr);
    // Non-fatal (AC10)
  }
}
```

> Le `meetLink` est injecté dans `updateData` **avant** le `supabaseAdmin.update()` unique (ligne ~163), donc persisté en un seul UPDATE avec le reste des champs.  
> `updatedAppt.video_link` dans `createElement(AppointmentConfirmed, …)` reflète automatiquement la valeur persistée — aucune modification du bloc email requis.  
> Guard `!updateData.video_link` : si l'admin a fourni un lien manuel valide, il est déjà dans `updateData.video_link` → pas d'appel à `createCalendarEvent` (AC9).  
> Condition `newStatus === 'confirmed'` : les séances vidéo partant en `payment_pending` (flux standard) ne déclenchent pas le bloc (AC8 contraposé).

---

### T4 — Admin UI labels

**`src/components/admin/AppointmentCard.tsx`** (lignes 554–556) :

Remplacer :
```tsx
Lien visio Google Meet{" "}
<span className="text-sage-400 font-normal">(optionnel)</span>
```
Par :
```tsx
Lien visio{" "}
<span className="text-sage-400 font-normal">
  (optionnel — généré automatiquement si vide)
</span>
```

**`src/components/admin/AdminCreateButton.tsx`** (ligne ~329) :

Remplacer :
```tsx
<Label htmlFor="cm-video">Lien de téléconsultation</Label>
```
Par :
```tsx
<Label htmlFor="cm-video">
  Lien vidéo{" "}
  <span className="text-sage-400 font-normal text-xs">
    (optionnel — généré automatiquement si vide)
  </span>
</Label>
```

> Aucune logique fonctionnelle modifiée. Le `placeholder` existant reste inchangé.

---

## File Impact Map

| Fichier | Task | Type de changement |
|---------|------|--------------------|
| `src/lib/google-calendar.ts` | T1 | Interface + signature + mock + mode réel |
| `src/pages/api/stripe-webhook.ts` | T2 | Import + bloc Meet + prop email |
| `src/pages/api/appointments/[id].ts` | T3 | Import + bloc Meet dans `confirm` |
| `src/components/admin/AppointmentCard.tsx` | T4 | Label/copy uniquement |
| `src/components/admin/AdminCreateButton.tsx` | T4 | Label/copy uniquement |

**Fichiers non modifiés :**
- `src/emails/AppointmentConfirmed.tsx` — prop `videoLink?` déjà câblée
- `src/types/appointment.ts` — `video_link: string | null` déjà défini
- `src/pages/api/admin/appointments/index.ts` — vidéo → `payment_pending` → T2 couvre
- `supabase/migrations/` — aucune migration requise

## Quality Gate

```bash
npm run lint && npx tsc --noEmit && npm run build
```
