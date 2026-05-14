---
issue: 25
title: "Google Meet auto-generation via Google Calendar API"
tier: F-lite
status: ready
---

## Goal

Générer automatiquement un lien Google Meet lors de la confirmation d'une séance
vidéo, le persister en base (`video_link`) et l'inclure dans l'email
`AppointmentConfirmed` envoyé au patient.

---

## Context

### Fichiers concernés

| Fichier | Rôle actuel |
|---------|-------------|
| `src/lib/google-calendar.ts` | Définit `createCalendarEvent` (retourne `Promise<string>`) — **jamais appelée** |
| `src/pages/api/stripe-webhook.ts` | `handlePaymentSucceeded` — update statut + envoi `AppointmentConfirmed` |
| `src/pages/api/appointments/[id].ts` | Actions admin : `confirm` path avec edge case `confirmed` direct |
| `src/emails/AppointmentConfirmed.tsx` | Prop `videoLink?: string` déjà câblée, bouton déjà rendu |
| `src/components/admin/AppointmentCard.tsx` | Saisie manuelle `video_link` (label : "Lien visio Google Meet (optionnel)") |
| `src/components/admin/AdminCreateButton.tsx` | Saisie manuelle `video_link` (label : "Lien de téléconsultation") |
| `src/types/appointment.ts` | `video_link: string \| null` — champ déjà présent |

### Observations clés du code existant

**`google-calendar.ts` :**
- `MOCK_MODE` : `import.meta.env.GOOGLE_CALENDAR_MOCK === 'true'`
- Scope JWT actuel : `calendar.events` — couvre la création d'événements avec
  `conferenceData` (Meet), aucun changement de scope requis
- `CreateEventParams` ne contient pas encore `withMeet` ni `appointmentId`
- Mock branch retourne `mock-event-${Date.now()}` (string) — doit changer en objet

**`stripe-webhook.ts` `handlePaymentSucceeded` :**
- L'UPDATE idempotent utilise `.eq('status', 'payment_pending').is('stripe_event_id', null)`
- `videoLink` est passé à `AppointmentConfirmed` via `updatedAppt.video_link ?? undefined`
- `createCalendarEvent` n'est pas importée — aucun appel actuel

**`[id].ts` action `confirm` :**
- Ligne 103 : `newStatus = stripe_payment_intent_id ? 'confirmed' : 'payment_pending'`
- Quand `newStatus === 'confirmed'`, `AppointmentConfirmed` est envoyé immédiatement
  (ligne 196–219) avec `updatedAppt.video_link ?? undefined`
- La validation du `video_link` manuel (lignes 127–138) alimente `updateData.video_link`
  **avant** l'UPDATE Supabase — le hook Meet doit s'insérer après cette validation

**`AppointmentConfirmed.tsx` :**
- Prop `videoLink?: string` définie ligne 30, bouton rendu conditionnel lignes 78–107
- Template prêt — aucune modification requise

**`admin/appointments/index.ts` :**
- Les vidéo créées par admin partent en `payment_pending` (ligne 118)
- Elles suivent ensuite le chemin Stripe webhook → `handlePaymentSucceeded` (Slice 2)
- Hors scope : pas de modification de cet endpoint

**DB :** `video_link TEXT` existe en migration `001_init.sql` (ligne 68). Aucune
migration requise.

---

## Acceptance Criteria

- [ ] **AC1** — `createCalendarEvent({ withMeet: true, appointmentId: 'abc...' })` en
  mode mock retourne `{ eventId: 'mock-event-<timestamp>', meetLink: 'https://meet.google.com/mock-abc123ab' }`
  (les 8 premiers caractères de l'appointmentId)
- [ ] **AC2** — `createCalendarEvent({ withMeet: false })` retourne `{ eventId, meetLink: undefined }`
  (inchangé fonctionnellement)
- [ ] **AC3** — `createCalendarEvent` en mode réel avec `withMeet: true` transmet
  `conferenceDataVersion: 1` et `conferenceData.createRequest.requestId` = appointmentId
  à l'API Google Calendar
- [ ] **AC4** — Suite au webhook Stripe `payment_intent.succeeded` / `checkout.session.completed`
  pour un RDV vidéo sans `video_link`, `video_link` est persisté en base avec le lien Meet
- [ ] **AC5** — L'email `AppointmentConfirmed` envoyé post-paiement contient le lien Meet
  dans la prop `videoLink`
- [ ] **AC6** — Si `video_link` est déjà renseigné manuellement en DB, le webhook Stripe
  ne rappelle pas `createCalendarEvent` — le lien manuel est conservé
- [ ] **AC7** — Rejouer le webhook Stripe avec le même `appointmentId` ne crée pas un
  second lien Meet (idempotence Google via `requestId`)
- [ ] **AC8** — Quand l'admin confirme un RDV vidéo avec `stripe_payment_intent_id`
  pré-existant (status → `confirmed` direct), `video_link` est généré et persisté
  **avant** l'envoi de `AppointmentConfirmed`
- [ ] **AC9** — Quand l'admin fournit un `video_link` manuel lors de la confirmation
  directe, le lien manuel est conservé (pas d'appel à `createCalendarEvent`)
- [ ] **AC10** — Une erreur de l'API Google Calendar est non-fatale : l'email de
  confirmation est envoyé quand même, sans lien vidéo
- [ ] **AC11** — `google-calendar.ts` n'importe pas `supabase` (séparation des
  responsabilités préservée)
- [ ] **AC12** — Labels des champs `video_link` mis à jour dans `AppointmentCard.tsx`
  et `AdminCreateButton.tsx` pour signaler l'override optionnel
- [ ] **AC13** — `tsc --noEmit` sans erreur après les changements

---

## Breadboard

### Flow principal — webhook Stripe

```
Stripe webhook POST /api/stripe-webhook
  → handlePaymentSucceeded(appointmentId, paymentIntentId, eventId)
      → UPDATE appointments SET status='payment_received', stripe_event_id=eventId
        WHERE id=appointmentId AND status='payment_pending' AND stripe_event_id IS NULL
      → [idempotent guard: si updateErr || !updated → return]
      → updatedAppt.appointment_mode === 'video' && !updatedAppt.video_link ?
          → createCalendarEvent({ withMeet: true, appointmentId, ... })
              → mock: return { eventId: 'mock-event-...', meetLink: 'https://meet.google.com/mock-{8chars}' }
              → réel: calendar.events.insert({ conferenceDataVersion: 1, conferenceData.createRequest })
                       → return { eventId, meetLink: hangoutLink ?? entryPoints.video.uri }
          → meetLink ? UPDATE appointments SET video_link=meetLink
          → videoLink = meetLink ?? undefined
        sinon videoLink = updatedAppt.video_link ?? undefined
      → sendEmail(AppointmentConfirmed, { videoLink })
```

### Edge case — confirm direct dans `[id].ts`

```
PATCH /api/appointments/:id  { action: 'confirm', stripe_payment_intent_id: '...' }
  → appointment.appointment_mode === 'video'
  → newStatus = stripe_payment_intent_id ? 'confirmed' : 'payment_pending'
  →   newStatus === 'confirmed'
  → Validation video_link manuel → updateData.video_link (si fourni)
  → !updateData.video_link && appointment_mode === 'video' && newStatus === 'confirmed' ?
      → createCalendarEvent({ withMeet: true, appointmentId: appointment.id, ... })
      → meetLink ? updateData.video_link = meetLink
  → UPDATE appointments SET ...updateData
  → sendEmail(AppointmentConfirmed, { videoLink: updatedAppt.video_link ?? undefined })
```

### Override priorité

```
video_link final = manuel (updateData.video_link) > auto-généré (meetLink) > null
```

---

## Slices

### Slice 1 — `google-calendar.ts` : interface + retour `CreateEventResult`

**Fichier :** `src/lib/google-calendar.ts`

**Changements :**

1. Ajouter `CreateEventResult` après `CreateEventParams` :
   ```typescript
   export interface CreateEventResult {
     eventId: string;
     meetLink?: string;
   }
   ```

2. Étendre `CreateEventParams` :
   ```typescript
   export interface CreateEventParams {
     title: string;
     start: string;   // ISO 8601
     end: string;     // ISO 8601
     description?: string;
     attendeeEmail?: string;
     withMeet?: boolean;       // demande un lien Google Meet
     appointmentId?: string;   // requestId idempotence + URL mock
   }
   ```

3. Changer la signature de `createCalendarEvent` :
   ```typescript
   export async function createCalendarEvent(
     params: CreateEventParams,
   ): Promise<CreateEventResult>
   ```

4. Branch mock (remplace `return \`mock-event-${Date.now()}\``) :
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

5. Mode réel — enrichir `calendar.events.insert` :
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

6. Extraction du lien et retour :
   ```typescript
   const eventId = response.data.id;
   if (!eventId) {
     throw new GoogleCalendarError(
       "L'événement a été créé mais aucun ID n'a été retourné par l'API.",
     );
   }

   const meetLink =
     response.data.conferenceData?.entryPoints
       ?.find(ep => ep.entryPointType === 'video')?.uri
     ?? response.data.hangoutLink
     ?? undefined;

   return { eventId, meetLink };
   ```
   > `hangoutLink` est le champ de haut niveau de l'API Calendar v3. Les deux
   > chemins sont couverts par redondance.

**Critères :**
- `withMeet: false` → `meetLink` absent (`undefined`)
- `withMeet: true` + mock + `appointmentId: 'abcd1234-...'` → `meetLink: 'https://meet.google.com/mock-abcd1234'`
- Aucun import Supabase ajouté
- TypeScript strict : `tsc --noEmit` sans erreur

---

### Slice 2 — `stripe-webhook.ts` : génération Meet + persistance

**Fichier :** `src/pages/api/stripe-webhook.ts`

**Changements :**

1. Ajouter l'import (ligne 10, après les imports existants) :
   ```typescript
   import { createCalendarEvent } from '../../lib/google-calendar';
   ```

2. Dans `handlePaymentSucceeded`, après `const updatedAppt = updated as Appointment;`
   et avant le bloc `try { const icsEvent = buildICSEvent(...) }` :
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
         // Persistance non-bloquante
         await supabaseAdmin
           .from('appointments')
           .update({ video_link: meetLink })
           .eq('id', updatedAppt.id);
       }
     } catch (calErr) {
       console.error('[stripe-webhook] Erreur création événement Calendar / Meet:', calErr);
       // Non-fatal : l'email part sans lien vidéo
     }
   }
   ```

3. Remplacer `videoLink: updatedAppt.video_link ?? undefined` par `videoLink` dans
   le `createElement(AppointmentConfirmed, { ... })` :
   ```typescript
   react: createElement(AppointmentConfirmed, {
     patientName:       updatedAppt.patient_name,
     appointmentType:   updatedAppt.appointment_type,
     appointmentMode:   updatedAppt.appointment_mode,
     scheduledAt:       updatedAppt.scheduled_at,
     duration:          updatedAppt.duration,
     finalPrice:        updatedAppt.final_price,
     videoLink,                                    // ← variable locale (auto ou DB)
     googleCalendarLink,
     icsDataUri,
     cabinetAddress: undefined,
   }),
   ```

**Critères :**
- Mock (`GOOGLE_CALENDAR_MOCK=true`) : `videoLink` vaut
  `'https://meet.google.com/mock-{8 premiers chars appointmentId}'`
- `video_link` déjà en DB : skip `createCalendarEvent` (guard `!videoLink`)
- Erreur API Calendar : email envoyé quand même, `videoLink` reste `undefined`
- `getTypeLabel` est déjà importé (ligne 11) — pas de nouvel import nécessaire

---

### Slice 3 — `[id].ts` : edge case confirm direct vidéo

**Fichier :** `src/pages/api/appointments/[id].ts`

**Changements :**

1. Ajouter l'import de `createCalendarEvent` (ligne 9, après les imports existants) :
   ```typescript
   import { createCalendarEvent } from '../../../lib/google-calendar';
   ```

2. Dans le bloc `action === 'confirm'`, **après** la validation du `video_link` manuel
   (bloc `if (video_link) { ... }`, lignes 127–138) et **avant** la gestion de
   `stripe_payment_intent_id` (ligne 140) :
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
       // Non-fatal
     }
   }
   ```
   > Le `meetLink` est injecté dans `updateData` avant l'UPDATE Supabase unique
   > (ligne 163). Il sera disponible dans `updatedAppt.video_link` et passé à
   > `AppointmentConfirmed` (ligne 213) sans modification supplémentaire.

**Critères :**
- Flow standard (`newStatus === 'payment_pending'`) : condition `newStatus === 'confirmed'`
  est fausse → pas d'appel à `createCalendarEvent`
- Flow direct (`stripe_payment_intent_id` présent) sans `video_link` manuel :
  `updateData.video_link` = meetLink, `AppointmentConfirmed` reçoit le lien
- Flow direct **avec** `video_link` manuel valide : `updateData.video_link` déjà défini →
  guard `!updateData.video_link` empêche l'appel — lien manuel conservé
- Erreur API : non-fatale, confirmation envoyée quand même

---

### Slice 4 — Admin UI : libellé override

**Fichiers :**
- `src/components/admin/AppointmentCard.tsx`
- `src/components/admin/AdminCreateButton.tsx`

**`AppointmentCard.tsx` — lignes 554–555 :**

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
Le `placeholder` existant (`https://meet.google.com/xxx-xxxx-xxx`) reste inchangé.

**`AdminCreateButton.tsx` — ligne 329 :**

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

**Critères :**
- Libellés mis à jour dans les deux composants
- Aucune logique fonctionnelle modifiée
- `tsc --noEmit` sans erreur, build sans erreur

---

## File Impact Map

| Fichier | Slice | Type de changement |
|---------|-------|--------------------|
| `src/lib/google-calendar.ts` | 1 | Interface + signature + mock + mode réel |
| `src/pages/api/stripe-webhook.ts` | 2 | Import + logique Meet + prop email |
| `src/pages/api/appointments/[id].ts` | 3 | Import + bloc Meet dans `confirm` |
| `src/components/admin/AppointmentCard.tsx` | 4 | Label/copy uniquement |
| `src/components/admin/AdminCreateButton.tsx` | 4 | Label/copy uniquement |

**Fichiers non modifiés :**
- `src/emails/AppointmentConfirmed.tsx` — template déjà prêt
- `src/types/appointment.ts` — `video_link` déjà défini
- `src/pages/api/admin/appointments/index.ts` — vidéo → `payment_pending` → Slice 2 couvre
- `supabase/migrations/` — aucune migration requise

---

## Out of Scope

- **Création d'événement Calendar pour les séances en présentiel** — `createCalendarEvent`
  n'est pas câblée pour les RDV `in-person` (statut `confirmed` direct sans Meet) ; feature distincte
- **Stockage de `google_calendar_event_id`** — l'eventId est loggué, non persisté ; pas de colonne DB
- **Lien Meet dans `PaymentRequest`** — la séance n'est pas encore acquise à ce stade
- **Annulation / révocation du lien Meet** — les liens Google Meet ne s'invalident pas à l'annulation
- **Support Zoom / Teams en auto-génération** — uniquement Google Meet via l'API Calendar
- **Expiration du lien** — les liens Meet n'expirent pas, aucune gestion de TTL
- **Affichage admin du lien auto-généré** — `AppointmentCard.tsx` affiche déjà `video_link` (ligne 348)
  si renseigné ; aucun changement UI admin au-delà du Slice 4

---

## Open Questions

Aucune.
