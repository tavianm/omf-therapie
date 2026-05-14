---
issue: 26
title: "Reschedule: flow d'acceptation patient + nettoyage CTAs admin"
tier: F-lite
status: implemented
frame: artifacts/frames/26-reschedule-accept-flow-frame.md
---

## Goal

Fermer la boucle du flow de report : permettre au patient d'accepter le nouveau créneau en
un clic via un lien dédié, et corriger les CTAs admin sur les rendez-vous en statut
`rescheduled` (remplacer Confirmer/Refuser par un unique "Annuler la proposition").

---

## Context

| Fichier | Rôle |
|---------|------|
| `src/pages/api/appointments/[id].ts` | Endpoint PATCH unique pour toutes les mutations de RDV. Auth guard à la ligne 60. Whitelist des actions ligne 79. |
| `src/pages/rdv/merci.astro` | Page de succès existante — SSG, sert de destination de redirection post-acceptation. |
| `src/components/admin/AppointmentCard.tsx` | Island React du back-office. Bloc CTA mixte `pending \| rescheduled` aux lignes 395–421. |
| `src/emails/AppointmentRescheduled.tsx` | Template email patient. Prop `bookingUrl: string` existant (ligne 31), CTA "Accepter ce nouveau créneau" (ligne 179). URL codée en dur `/rendez-vous` à la ligne 316 de l'API. |
| `src/types/appointment.ts` | `Appointment.rescheduled_to: string \| null` (ligne 76). |
| `src/lib/supabase.ts` | `supabaseAdmin` (service_role) — utilisable en SSR Astro. |
| `src/lib/stripe.ts` | `createAppointmentPaymentLink()` — réutilisé tel quel. |

---

## ⚠️ Architectural Issue — Auth Guard & Action Publique

**Problème :** Le PATCH handler déclare un auth guard inconditionnel aux lignes 60–61,
_avant_ tout parsing du corps de la requête. La nouvelle action `accept_reschedule` est
appelée depuis une page publique (patient sans compte) via un `<script>` inline.

```
// [id].ts ligne 60
const session = await auth.api.getSession({ headers: request.headers });
if (!session) return errorResponse(401, 'Non autorisé');
```

**Conflit :** tel quel, tout appel non authentifié retourne 401, rendant la page patient
non fonctionnelle.

**Fix requis — restructurer l'ordre d'exécution :**

```
Avant :  auth check → parse body → validate action → handlers
Après :  parse body → validate action → auth check (sauf accept_reschedule) → handlers
```

Concrètement :
1. Déplacer le bloc `request.json()` (lignes 70–77) et la validation de l'action (ligne 79)
   **avant** l'auth check.
2. Conditionner l'auth check à l'action :

```ts
// Body parsing en premier
let body: Record<string, unknown>;
try { body = await request.json(); }
catch { return errorResponse(400, 'Corps de requête JSON invalide'); }

const { action, ... } = body;

if (!action || !['confirm', 'decline', 'reschedule', 'save_notes', 'accept_reschedule'].includes(action as string))
  return errorResponse(422, 'Action invalide');

// Auth : toutes les actions admin nécessitent une session, sauf accept_reschedule
if (action !== 'accept_reschedule') {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(401, 'Non autorisé');
}
```

**Modèle de sécurité pour `accept_reschedule` :** le token d'autorisation est l'UUID du
RDV dans l'URL (non devinable). L'API impose en plus deux validations DB-side :
`status === 'rescheduled'` **ET** `rescheduled_to > now()`. Si l'une échoue → 409/422.
Idempotent : un second appel retourne 409 car le statut aura déjà changé.

---

## Acceptance Criteria

- [ ] **AC1** — `PATCH /api/appointments/{id}` avec `{ action: 'accept_reschedule' }` sans
  session retourne 200 (pas 401) si le RDV est en statut `rescheduled` et `rescheduled_to`
  est dans le futur.
- [ ] **AC2** — Après `accept_reschedule` : `scheduled_at = rescheduled_to_initial`,
  `rescheduled_to = null` en base.
- [ ] **AC3** — Mode `in-person` : statut final `confirmed`, email `AppointmentConfirmed`
  envoyé avec le bon `scheduled_at` (créneau promu).
- [ ] **AC4** — Mode `video` : statut final `payment_pending`, nouveau Payment Link Stripe
  généré, email `PaymentRequest` envoyé.
- [ ] **AC5** — Appel avec RDV en statut ≠ `rescheduled` → 409.
- [ ] **AC6** — Appel avec `rescheduled_to` dans le passé → 422.
- [ ] **AC7** — L'email `AppointmentRescheduled` contient maintenant
  `https://{baseUrl}/rdv/accepter-report?id={appointmentId}` comme `bookingUrl`.
- [ ] **AC8** — `GET /rdv/accepter-report?id={uuid}` : RDV valide → affiche le récap du
  créneau proposé + bouton "Accepter ce créneau".
- [ ] **AC9** — `GET /rdv/accepter-report?id={uuid}` : statut ≠ `rescheduled` → message
  "Ce lien n'est plus valide" + lien `/rendez-vous`.
- [ ] **AC10** — `GET /rdv/accepter-report?id={uuid}` : `rescheduled_to` expiré → message
  "Créneau expiré" + lien `/rendez-vous`.
- [ ] **AC11** — `GET /rdv/accepter-report?id=invalide` → redirect `/rendez-vous`.
- [ ] **AC12** — Clic "Accepter ce créneau" → bouton désactivé pendant le fetch → redirect
  `/rdv/merci` si 2xx → message d'erreur inline si non-2xx.
- [ ] **AC13** — Dashboard admin : un RDV en statut `rescheduled` n'affiche plus les
  boutons "Confirmer" et "Refuser".
- [ ] **AC14** — Dashboard admin : un RDV en statut `rescheduled` avec `rescheduled_to`
  dans le futur affiche un bouton "Annuler la proposition" (rouge outline).
- [ ] **AC15** — "Annuler la proposition" → `PATCH { action: 'decline', therapist_notes:
  "La proposition de report a été annulée." }` sans ouvrir de modale → statut `declined`
  + email `AppointmentDeclined` au patient.
- [ ] **AC16** — Dashboard admin : bouton "Annuler la proposition" absent si
  `rescheduled_to < now()` (proposition expirée).
- [ ] **AC17** — Les CTAs du bloc `pending` (Confirmer / Refuser / Reporter) sont inchangés.

---

## Breadboard

```
[Email AppointmentRescheduled]
  bookingUrl = /rdv/accepter-report?id={id}   ← Slice 2 (fix)
        │
        ▼
GET /rdv/accepter-report?id={uuid}            ← Slice 3 (nouveau)
  Frontmatter SSR :
    1. UUID absent/invalide → redirect /rendez-vous
    2. supabaseAdmin SELECT * WHERE id = uuid
       → 0 rows → redirect /rendez-vous
    3. status ≠ 'rescheduled'
       → render "Ce lien n'est plus valide"
    4. rescheduled_to < now()
       → render "Créneau expiré"
    5. OK → render récap + bouton
        │
        ▼ (clic bouton → fetch depuis <script> inline)
PATCH /api/appointments/{id}
  body: { action: 'accept_reschedule' }        ← Slice 1 (nouveau)
  [pas de session requise]
        │
        ├─ guard: status ≠ 'rescheduled' → 409
        ├─ guard: rescheduled_to absent / passé → 422
        │
        ├─ UPDATE appointments SET
        │    scheduled_at   = rescheduled_to,
        │    rescheduled_to = null,
        │    status         = newStatus
        │
        ├─ in-person → newStatus = 'confirmed'
        │     sendEmail(AppointmentConfirmed)
        │
        └─ video → newStatus = 'payment_pending'
              createAppointmentPaymentLink()
              sendEmail(PaymentRequest)
        │
        ▼
  res.ok → window.location.href = '/rdv/merci'
  !res.ok → affiche message d'erreur inline


[Dashboard admin — AppointmentCard]           ← Slice 4 (modification)
  status = 'rescheduled'
    rescheduled_to dans le futur
      → bouton "Annuler la proposition"
          callPatch({ action: 'decline',
                      therapist_notes: "La proposition de report a été annulée." })
    rescheduled_to expiré / null
      → aucun CTA (lecture seule de fait)
```

---

## Slices

### Slice 1 — API : action `accept_reschedule`
**Fichier :** `src/pages/api/appointments/[id].ts`

**1.1 Restructuration de l'ordre d'exécution** (prérequis à toutes les autres slices)

Déplacer le bloc `request.json()` et la validation `action` _avant_ le bloc auth :

```ts
// ── Étape 1 : Parse body ────────────────────────────────────────────────
let body: Record<string, unknown>;
try {
  body = await request.json();
} catch {
  return errorResponse(400, 'Corps de requête JSON invalide');
}

const {
  action, video_link, stripe_payment_intent_id,
  therapist_notes, rescheduled_to, override_first_session, is_solidarity,
} = body;

if (
  !action ||
  !['confirm', 'decline', 'reschedule', 'save_notes', 'accept_reschedule']
    .includes(action as string)
)
  return errorResponse(422, 'Action invalide (confirm | decline | reschedule | save_notes | accept_reschedule)');

// ── Étape 2 : Auth guard (sauf action publique) ─────────────────────────
if (action !== 'accept_reschedule') {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(401, 'Non autorisé');
}

// ── Étape 3 : Récupérer le rendez-vous ─────────────────────────────────
// (existant inchangé)
```

Supprimer le bloc auth et le bloc `request.json()` de leurs positions actuelles (lignes
60–61 et 70–77).

**1.2 Nouveau bloc `accept_reschedule`**

Insérer après le bloc `reschedule` (après la ligne 321), avant `save_notes` :

```ts
// ---------------------------------------------------------------------------
// Action: accept_reschedule
// ---------------------------------------------------------------------------
if (action === 'accept_reschedule') {
  // Validations
  if (appointment.status !== 'rescheduled')
    return errorResponse(409, 'Ce rendez-vous ne peut être accepté que depuis le statut rescheduled');

  if (!appointment.rescheduled_to)
    return errorResponse(422, 'Aucun créneau de report disponible');

  const proposedDate = new Date(appointment.rescheduled_to);
  if (proposedDate.getTime() < Date.now())
    return errorResponse(422, 'Le créneau proposé est expiré');

  // Déterminer le statut cible
  const newStatus: Appointment['status'] =
    appointment.appointment_mode === 'video' ? 'payment_pending' : 'confirmed';

  const updateData: Record<string, unknown> = {
    scheduled_at:   appointment.rescheduled_to,  // promotion du créneau
    rescheduled_to: null,
    status:         newStatus,
  };

  // Générer un Payment Link Stripe si video + payment_pending
  if (appointment.appointment_mode === 'video' && newStatus === 'payment_pending') {
    try {
      const successUrl =
        import.meta.env.STRIPE_SUCCESS_URL ??
        ((import.meta.env.BETTER_AUTH_URL ?? 'https://omf-therapie.fr') + '/rdv/merci');
      const description = `Séance ${getTypeLabel(appointment.appointment_type)} — OMF Thérapie (${appointment.duration} min)`;
      const paymentLink = await createAppointmentPaymentLink({
        appointmentId: appointment.id,
        patientEmail:  appointment.patient_email,
        patientName:   appointment.patient_name,
        amount:        appointment.final_price,
        description,
        successUrl,
      });
      updateData.stripe_payment_link_id  = paymentLink.id;
      updateData.stripe_payment_link_url = paymentLink.url;
    } catch (stripeErr) {
      console.error('[appointments/patch] accept_reschedule — Erreur Stripe:', stripeErr);
      return errorResponse(500, 'Erreur lors de la génération du lien de paiement Stripe');
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('appointments')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (updateError || !updated) {
    console.error('[appointments/patch] accept_reschedule — Erreur update:', updateError);
    return errorResponse(500, 'Erreur lors de la mise à jour');
  }

  const updatedAppt = updated as Appointment;

  // Email PaymentRequest (vidéo)
  if (newStatus === 'payment_pending' && updatedAppt.stripe_payment_link_url) {
    sendEmail({
      to: updatedAppt.patient_email,
      subject: `Prépaiement de votre séance — ${new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
      }).format(new Date(updatedAppt.scheduled_at))}`,
      react: createElement(PaymentRequest, {
        patientName:       updatedAppt.patient_name,
        scheduledAt:       updatedAppt.scheduled_at,
        appointmentType:   updatedAppt.appointment_type,
        duration:          updatedAppt.duration,
        finalPrice:        updatedAppt.final_price,
        stripePaymentUrl:  updatedAppt.stripe_payment_link_url,
      }),
    }).catch(err => console.error('[appointments/patch] accept_reschedule — Erreur email PaymentRequest:', err));
  }

  // Email AppointmentConfirmed (présentiel)
  if (newStatus === 'confirmed') {
    const icsEvent = buildICSEvent(updatedAppt);
    const googleCalendarLink = generateGoogleCalendarLink(icsEvent);
    const icsDataUri = generateICSDataUri(icsEvent);

    sendEmail({
      to: updatedAppt.patient_email,
      subject: `Votre rendez-vous est confirmé — ${new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
      }).format(new Date(updatedAppt.scheduled_at))}`,
      react: createElement(AppointmentConfirmed, {
        patientName:       updatedAppt.patient_name,
        appointmentType:   updatedAppt.appointment_type,
        appointmentMode:   updatedAppt.appointment_mode,
        scheduledAt:       updatedAppt.scheduled_at,
        duration:          updatedAppt.duration,
        finalPrice:        updatedAppt.final_price,
        videoLink:         updatedAppt.video_link ?? undefined,
        googleCalendarLink,
        icsDataUri,
        cabinetAddress:    updatedAppt.appointment_mode === 'in-person' ? CABINET_ADDRESS : undefined,
      }),
    }).catch(err => console.error('[appointments/patch] accept_reschedule — Erreur email confirm:', err));
  }

  return jsonResponse({
    appointment: updatedAppt,
    message: newStatus === 'confirmed'
      ? 'Rendez-vous confirmé.'
      : 'Lien de paiement envoyé au patient.',
  });
}
```

---

### Slice 2 — Fix `bookingUrl` dans l'action `reschedule`
**Fichier :** `src/pages/api/appointments/[id].ts` — ligne ~316

```ts
// Avant
bookingUrl: `${baseUrl}/rendez-vous`,

// Après
bookingUrl: `${baseUrl}/rdv/accepter-report?id=${updatedAppt.id}`,
```

Aucune modification dans `AppointmentRescheduled.tsx` — le prop `bookingUrl` est déjà
conçu pour recevoir cette valeur.

---

### Slice 3 — Nouvelle page SSR `/rdv/accepter-report`
**Fichier :** `src/pages/rdv/accepter-report.astro` _(nouveau)_

```
export const prerender = false;   ← SSR obligatoire (Netlify Function)
```

**Frontmatter (serveur) :**

```
1. UUID_RE validation sur Astro.url.searchParams.get('id')
   → absent ou invalide → return Astro.redirect('/rendez-vous')

2. supabaseAdmin.from('appointments').select('*').eq('id', id).single()
   → error ou !data → return Astro.redirect('/rendez-vous')

3. Branching :
   a. data.status !== 'rescheduled'
      → expiredReason = 'invalid'  (rendu "Ce lien n'est plus valide")
   b. new Date(data.rescheduled_to) < new Date()
      → expiredReason = 'expired'  (rendu "Créneau expiré")
   c. OK → expiredReason = null, passer data au template
```

**Template (HTML statique) :**

Structure calquée sur `merci.astro` — `Layout` + `Navbar` + carte centrée max-w-lg.

- Branche expirée/invalide : icône ⚠️, message contextuel, lien `/rendez-vous`.
- Branche OK :
  - Titre : "Votre nouveau créneau"
  - Récapitulatif (`<dl>`) : date du créneau (`rescheduled_to` formaté fr-FR), mode,
    durée, tarif.
  - Bouton `id="btn-accept"` : "Accepter ce créneau" (classes mint-600, min-h-[44px]).
  - `<p>` texte alternatif avec lien `/rendez-vous`.

**`<script>` inline :**

```js
const btn = document.getElementById('btn-accept');
const apptId = btn.dataset.apptId;   // data-appt-id={id} sur le bouton

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Confirmation en cours…';

  try {
    const res = await fetch(`/api/appointments/${apptId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'accept_reschedule' }),
    });

    if (res.ok) {
      window.location.href = '/rdv/merci';
    } else {
      const data = await res.json().catch(() => ({}));
      document.getElementById('error-msg').textContent =
        data.error ?? 'Une erreur est survenue. Veuillez réessayer.';
      document.getElementById('error-msg').hidden = false;
      btn.disabled = false;
      btn.textContent = 'Accepter ce créneau';
    }
  } catch {
    document.getElementById('error-msg').textContent =
      'Problème réseau. Veuillez vérifier votre connexion et réessayer.';
    document.getElementById('error-msg').hidden = false;
    btn.disabled = false;
    btn.textContent = 'Accepter ce créneau';
  }
});
```

`<p id="error-msg" hidden role="alert" class="...text-red-700...">` placé sous le bouton.

> **Pas de React island.** Un seul fetch → redirect ne justifie pas la surcharge.

---

### Slice 4 — Nettoyage CTAs `AppointmentCard`
**Fichier :** `src/components/admin/AppointmentCard.tsx` — lignes 395–421

**Scinder le bloc conditionnel unique en deux blocs indépendants :**

**Remplacer :**
```tsx
{(status === "pending" || status === "rescheduled") && (
  <>
    <button onClick={() => { setModal("confirm"); ... }}>Confirmer</button>
    <button onClick={() => { setModal("decline"); ... }}>Refuser</button>
    {status === "pending" && (
      <button onClick={() => { setModal("reschedule"); ... }}>Reporter</button>
    )}
  </>
)}
```

**Par deux blocs séparés :**

```tsx
{/* Bloc pending — inchangé sémantiquement */}
{status === "pending" && (
  <>
    <button
      onClick={() => { setModal("confirm"); setActionError(null); }}
      disabled={actionLoading}
      className="... bg-mint-600 text-white ..."
    >
      Confirmer
    </button>
    <button
      onClick={() => { setModal("decline"); setActionError(null); }}
      disabled={actionLoading}
      className="... border-red-300 text-red-700 ..."
    >
      Refuser
    </button>
    <button
      onClick={() => { setModal("reschedule"); setActionError(null); }}
      disabled={actionLoading}
      className="... border-sage-300 text-sage-700 ..."
    >
      Reporter
    </button>
  </>
)}

{/* Bloc rescheduled — nouveau */}
{status === "rescheduled" &&
  appointment.rescheduled_to &&
  new Date(appointment.rescheduled_to) >= new Date() && (
  <button
    onClick={() =>
      callPatch({
        action: "decline",
        therapist_notes: "La proposition de report a été annulée.",
      })
    }
    disabled={actionLoading}
    className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
  >
    {actionLoading ? "En cours…" : "Annuler la proposition"}
  </button>
)}
```

**Pas de nouvelle modale.** L'action `decline` avec `therapist_notes` injecté envoie
l'email `AppointmentDeclined` existant — le patient est informé par ce canal.

---

## File Impact Map

| Fichier | Type | Modification |
|---------|------|-------------|
| `src/pages/api/appointments/[id].ts` | Modifier | Restructuration auth guard · + action `accept_reschedule` · fix `bookingUrl` |
| `src/pages/rdv/accepter-report.astro` | **Créer** | Page SSR patient — récap + acceptation |
| `src/components/admin/AppointmentCard.tsx` | Modifier | Scission bloc CTA `pending \| rescheduled` |

**Fichiers non modifiés :** `AppointmentRescheduled.tsx`, `AppointmentConfirmed.tsx`,
`PaymentRequest.tsx`, `AppointmentDeclined.tsx`, `merci.astro`, `ics.ts`, `stripe.ts`,
`supabase.ts`, `pricing.ts`, `types/appointment.ts`.

---

## Edge Cases & Guards

| Cas | Comportement |
|-----|-------------|
| Second clic sur "Accepter" (double-submit) | Bouton désactivé dès le premier clic ; l'API retourne 409 (status ≠ 'rescheduled') → message d'erreur inline |
| `rescheduled_to` expire entre affichage et clic | API retourne 422 → message d'erreur inline sur la page |
| RDV inexistant (UUID valide mais absent) | `supabaseAdmin.single()` → error → redirect `/rendez-vous` (frontmatter SSR) |
| UUID absent ou mal formé dans l'URL | UUID_RE non validé → redirect `/rendez-vous` (frontmatter SSR) |
| Erreur Stripe Payment Link | `createAppointmentPaymentLink` throw → 500 retourné, pas d'UPDATE Supabase (atomicité locale) |
| Admin tente de "Confirmer" un RDV `rescheduled` | Flow `confirm` existant accepte encore `rescheduled` dans sa whitelist (ligne 98) — rétrocompatibilité préservée intentionnellement |
| `rescheduled_to` expiré côté admin | Bouton "Annuler la proposition" masqué (condition `>= new Date()`) — RDV en lecture de fait |

---

## Out of Scope (rappel)

- Expiration automatique (cron) des RDV `rescheduled` périmés
- Contre-proposition patient
- Modification tarifaire à l'acceptation
- Envoi d'email de rappel spécifique au report
- Lien vidéo saisi lors de `accept_reschedule`
