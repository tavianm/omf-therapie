---
issue: 25
title: "Video: génération automatique des liens Google Meet à la confirmation"
tier: F-lite
status: approved
---

# Frame — Issue #25 : Génération automatique des liens Google Meet

## Problem

Les séances vidéo nécessitent un lien Google Meet pour que le patient puisse
rejoindre la téléconsultation. Actuellement :

1. `createCalendarEvent` dans `src/lib/google-calendar.ts` est **définie mais
   jamais appelée** — aucune route API n'en fait usage.
2. La colonne `video_link` de la table `appointments` est renseignée uniquement
   si la thérapeute saisit manuellement un lien dans le modal de confirmation
   (`AppointmentCard`) ou dans le formulaire de création admin (`AdminCreateButton`).
3. Aucune demande de `conferenceData` n'est transmise à l'API Google Calendar,
   donc aucun lien Meet n'est jamais auto-généré.
4. `AppointmentConfirmed.tsx` possède déjà la prop `videoLink?: string` et
   affiche le bouton de connexion lorsqu'elle est renseignée — le template est
   prêt, il manque uniquement le câblage côté serveur.

---

## Constraints

1. **Retour de type de `createCalendarEvent`** — La signature actuelle retourne
   `Promise<string>` (eventId seul). Elle doit évoluer vers
   `Promise<{ eventId: string; meetLink?: string }>` sans casser les éventuels
   appelants futurs (aucun appelant actuel, mais la rétrocompatibilité
   structurelle reste un objectif).

2. **`google-calendar.ts` n'importe pas Supabase** — La séparation des
   responsabilités du module doit être préservée. L'appointmentId n'est jamais
   lu depuis la DB dans ce fichier ; il est passé en paramètre par l'appelant.

3. **Moment de génération du lien Meet (flow vidéo standard)** :
   - `confirm` → status `payment_pending` + `PaymentRequest` email (Stripe link)
   - Stripe webhook → status `payment_received` → `AppointmentConfirmed` email
   - Le lien Meet doit être généré **dans `handlePaymentSucceeded`** (Stripe
     webhook), juste avant l'envoi de `AppointmentConfirmed`. C'est à ce moment
     que le rendez-vous est définitivement confirmé et que le patient reçoit son
     accès à la séance.
   - **`PaymentRequest` n'inclut pas le lien Meet** : la séance n'est pas encore
     confirmée à ce stade (paiement non reçu). Le lien irait dans l'email de
     confirmation post-paiement uniquement.

4. **Edge case — confirmation directe avec paiement pré-existant** : Dans
   `[id].ts`, si l'admin confirme un rendez-vous vidéo avec un
   `stripe_payment_intent_id` déjà présent, le statut passe directement à
   `confirmed` (ligne 103) et `AppointmentConfirmed` est envoyé immédiatement.
   La génération du lien Meet doit aussi couvrir ce chemin.

5. **Override manuel prioritaire** : si la thérapeute saisit explicitement un
   `video_link` dans le modal de confirmation, ce lien manuel prend la priorité
   sur l'auto-génération. L'auto-génération ne se déclenche que si `video_link`
   est absent.

6. **Idempotence** : L'API Google Calendar exige un `requestId` unique par
   demande de conférence (champ `conferenceData.createRequest.requestId`).
   L'appointmentId (UUID) sert naturellement de clé d'idempotence, empêchant la
   création d'un second lien Meet si le webhook Stripe est rejoué.

7. **Mock mode** (`MOCK_CALENDAR=true`) : `createCalendarEvent` retourne déjà
   un eventId factice. Quand `withMeet: true`, elle doit aussi retourner un
   `meetLink` factice de la forme
   `https://meet.google.com/mock-{appointmentId.slice(0, 8)}`.

8. **Pas de nouvelle colonne DB** : `video_link TEXT` existe déjà dans la
   migration `001_init.sql` et dans l'interface `Appointment`. Aucune migration
   n'est nécessaire pour cette feature.

9. **`google_calendar_event_id` non stocké** : L'eventId Google Calendar n'est
   pas persisté en base (pas de colonne dédiée). Il est loggué mais non stocké
   — hors scope.

---

## Approach

### 1. Modifier `createCalendarEvent` — `google-calendar.ts`

Étendre `CreateEventParams` avec deux champs optionnels :

```typescript
export interface CreateEventParams {
  title: string;
  start: string;
  end: string;
  description?: string;
  attendeeEmail?: string;
  withMeet?: boolean;        // demande un lien Google Meet
  appointmentId?: string;    // idempotence Google + URL mock
}

// Nouveau type de retour
export interface CreateEventResult {
  eventId: string;
  meetLink?: string;
}

export async function createCalendarEvent(
  params: CreateEventParams,
): Promise<CreateEventResult>
```

**Mode mock** :
```typescript
if (MOCK_MODE) {
  const mockEventId = `mock-event-${Date.now()}`;
  const mockMeetLink = params.withMeet && params.appointmentId
    ? `https://meet.google.com/mock-${params.appointmentId.slice(0, 8)}`
    : undefined;
  return { eventId: mockEventId, meetLink: mockMeetLink };
}
```

**Mode réel** — ajouter dans `calendar.events.insert` :
```typescript
// Paramètre de requête
conferenceDataVersion: params.withMeet ? 1 : 0,

// Dans requestBody
...(params.withMeet && params.appointmentId ? {
  conferenceData: {
    createRequest: {
      requestId: params.appointmentId,
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    },
  },
} : {}),
```

**Extraction du lien** :
```typescript
const eventId = response.data.id;
const meetLink = response.data.conferenceData?.entryPoints
  ?.find(ep => ep.entryPointType === 'video')?.uri
  ?? response.data.hangoutLink
  ?? undefined;

return { eventId, meetLink };
```

> `hangoutLink` est le champ de haut niveau exposé par l'API Calendar v3. Les
> deux chemins sont couverts par redondance.

---

### 2. Câblage dans `stripe-webhook.ts` — `handlePaymentSucceeded`

C'est le **point d'entrée principal** pour les séances vidéo.

Après la mise à jour du statut en `payment_received`, avant l'envoi de l'email :

```typescript
// Auto-génération du lien Meet si séance vidéo et pas de lien manuel
let videoLink = updatedAppt.video_link ?? undefined;

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
      // Persister le lien en base (non-bloquant sur erreur)
      await supabaseAdmin
        .from('appointments')
        .update({ video_link: meetLink })
        .eq('id', updatedAppt.id);
    }
  } catch (calErr) {
    console.error('[stripe-webhook] Erreur création événement Calendar / Meet:', calErr);
    // Non-fatal : l'email partira sans lien vidéo
  }
}
```

Puis passer `videoLink` à `AppointmentConfirmed` :
```typescript
react: createElement(AppointmentConfirmed, {
  // ...
  videoLink,   // ← remplace updatedAppt.video_link ?? undefined
}),
```

---

### 3. Edge case — confirm direct dans `[id].ts`

Dans le bloc `action === 'confirm'`, quand
`appointment.appointment_mode === 'video'` **et** `newStatus === 'confirmed'`
(cas avec `stripe_payment_intent_id` déjà présent) et qu'aucun `video_link`
manuel n'a été fourni :

```typescript
// Après la validation du video_link manuel et avant l'UPDATE Supabase
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

Le lien est ainsi inclus dans l'`UPDATE` Supabase unique déjà existant, et
`AppointmentConfirmed` le reçoit via `updatedAppt.video_link`.

---

### 4. Admin UI — champ `video_link` devient override optionnel

Les composants `AppointmentCard.tsx` et `AdminCreateButton.tsx` conservent
leur champ de saisie, mais le libellé et le placeholder sont mis à jour pour
indiquer qu'il s'agit d'un **remplacement manuel** :

- Libellé : `Lien vidéo (optionnel — généré automatiquement si vide)`
- Placeholder : `https://meet.google.com/...`
- Le champ reste vide par défaut ; l'admin ne remplit que s'il veut forcer
  un lien spécifique (Zoom, Teams, lien Meet personnalisé, etc.)

Pas de suppression du champ : le cas d'usage "override" est légitime.

---

## Vertical Slices

### Slice 1 — `createCalendarEvent` : withMeet + nouveau type de retour

**Fichier** : `src/lib/google-calendar.ts`

- Ajouter `withMeet?: boolean` et `appointmentId?: string` à `CreateEventParams`.
- Définir `CreateEventResult { eventId: string; meetLink?: string }`.
- Changer le type de retour de `Promise<string>` vers `Promise<CreateEventResult>`.
- Mock mode : retourner `{ eventId, meetLink }` selon `withMeet` + `appointmentId`.
- Mode réel : ajouter `conferenceDataVersion`, `conferenceData.createRequest`,
  extraire `hangoutLink` / `conferenceData.entryPoints`.

**Critères** :
- `withMeet: false` → `meetLink` absent du résultat.
- `withMeet: true` + mock → URL `meet.google.com/mock-{8 chars}`.
- `withMeet: true` + réel → `meetLink` présent si l'API retourne `hangoutLink`.
- Aucun import Supabase ajouté.

---

### Slice 2 — `handlePaymentSucceeded` : génération Meet + persistance

**Fichier** : `src/pages/api/stripe-webhook.ts`

- Importer `createCalendarEvent` depuis `@/lib/google-calendar`.
- Après l'UPDATE idempotent, appeler `createCalendarEvent` si
  `appointment_mode === 'video'` et `video_link` null.
- Persister `video_link` via Supabase si `meetLink` retourné.
- Passer `videoLink` (auto ou DB) à `AppointmentConfirmed`.
- Erreur non-fatale : l'email part quand même, sans lien vidéo.

**Critères** :
- En mock : l'email de confirmation reçoit
  `videoLink = 'https://meet.google.com/mock-{8 chars}'`.
- Si `video_link` est déjà renseigné en DB (override manuel) : pas d'appel
  à `createCalendarEvent`.
- Idempotence : rejouer le webhook avec le même `appointmentId` ne crée pas
  de second Meet (Google déduplique via `requestId`).

---

### Slice 3 — `[id].ts` confirm : edge case video confirmed

**Fichier** : `src/pages/api/appointments/[id].ts`

- Dans le bloc `action === 'confirm'`, si `appointment_mode === 'video'`,
  `newStatus === 'confirmed'` et pas de `video_link` manuel : appeler
  `createCalendarEvent` avec `withMeet: true`.
- Intégrer `meetLink` dans `updateData.video_link` avant l'UPDATE Supabase.
- Erreur non-fatale.

**Critères** :
- Flow standard (`payment_pending`) : pas d'appel à `createCalendarEvent`
  (le lien sera généré au Slice 2).
- Flow direct (`confirmed`) sans `video_link` manuel : `video_link` renseigné
  en DB, `AppointmentConfirmed` contient le lien.
- Flow direct avec `video_link` manuel : lien manuel conservé, pas d'appel.

---

### Slice 4 — Admin UI : libellé override

**Fichiers** : `src/components/admin/AppointmentCard.tsx`,
`src/components/admin/AdminCreateButton.tsx`

- Mettre à jour label + placeholder du champ `video_link` pour signaler
  qu'il s'agit d'un override optionnel.
- Aucune logique fonctionnelle modifiée.

**Critères** : Label mis à jour, placeholder présent, build sans erreur TS.

---

## Out of Scope

- **Création d'événement Calendar pour les séances en présentiel** — `createCalendarEvent` n'est appelée nulle part actuellement. Le câblage pour les rendez-vous `in-person` (qui passent directement en `confirmed`) est une feature distincte non couverte par cette issue.
- **Stockage de `google_calendar_event_id`** — L'eventId retourné est loggué mais non persisté. Pas de nouvelle colonne DB, pas de migration.
- **Lien Meet dans `PaymentRequest`** — L'email de demande de paiement est envoyé quand le RDV est en `payment_pending` (avant paiement confirmé). Envoyer un lien Meet à ce stade serait prématuré : la séance n'est pas encore acquise. Le lien est uniquement dans `AppointmentConfirmed` (post-paiement).
- **Annulation du lien Meet** — Si un RDV vidéo est annulé après la génération du Meet, le lien Google reste actif (Google ne le révoque pas automatiquement). La gestion de la révocation des liens est hors scope.
- **Support Zoom / Teams en auto-génération** — L'auto-génération ne cible que Google Meet via l'API Google Calendar. Les autres services restent accessibles via l'override manuel.
- **Expiration du `video_link`** — Les liens Google Meet n'expirent pas. Aucune gestion de TTL nécessaire.
- **Affichage du lien Meet dans le back-office admin** — Le lien est déjà affiché dans `AppointmentCard.tsx` (ligne 348) si `video_link` est renseigné. Aucun changement UI admin requis au-delà du Slice 4.
