---
issue: 26
title: "Reschedule: flow d'acceptation patient + nettoyage CTAs admin"
tier: F-lite
spec: artifacts/specs/26-reschedule-accept-flow-spec.md
status: ready
---

## Objectif

Fermer la boucle du flow de report : le patient reçoit un email avec un lien
`/rdv/accepter-report?id={uuid}`, accepte le créneau en un clic, et l'API
le confirme (présentiel) ou génère un lien de paiement Stripe (vidéo).
Côté back-office, les CTAs du statut `rescheduled` sont nettoyés : seul
"Annuler la proposition" subsiste, uniquement si le créneau proposé est futur.

---

## Analyse de la codebase existante

### `src/pages/api/appointments/[id].ts` — état actuel

| Ligne | Constat |
|-------|---------|
| 59–61 | Auth guard **inconditionnel** (`getSession` → 401 si pas de session) |
| 63–67 | UUID validation sur `params.id` |
| 70–75 | `request.json()` — parsing du body |
| 77 | Déstructuration de toutes les variables du body |
| 79–80 | Whitelist des actions : `confirm | decline | reschedule | save_notes` |
| 97–222 | Bloc `confirm` — accepte déjà `status === 'rescheduled'` (rétrocompat intentionnelle) |
| 316 | `bookingUrl: \`${baseUrl}/rendez-vous\`` — URL codée en dur à corriger |

**Problème critique :** l'auth guard (l. 59) est évalué _avant_ le parsing du
body. La nouvelle action `accept_reschedule` étant publique (patient sans
compte), tout appel non authentifié retourne 401 avant même d'atteindre la
logique métier.

### `src/components/admin/AppointmentCard.tsx` — état actuel (l. 395–421)

Bloc conditionnel unique `(status === "pending" || status === "rescheduled")` qui
affiche Confirmer + Refuser pour les deux statuts, et Reporter uniquement pour
`pending`. Pour `rescheduled`, les boutons Confirmer et Refuser n'ont pas de
sémantique correcte : il faut les remplacer par "Annuler la proposition".

### `src/emails/AppointmentRescheduled.tsx`

Prop `bookingUrl: string` déjà présent (l. 31). Le template n'est pas à modifier ;
seul l'appelant (`[id].ts` l. 316) passe la mauvaise valeur.

### `src/pages/rdv/merci.astro`

Page SSG existante, utilisée comme destination de redirection post-acceptation.
Accepte des query params optionnels (`type`, `mode`, `date`, `name`) — aucun
n'est requis pour ce flow.

### `callPatch` dans `AppointmentCard`

`callPatch(body: Record<string, unknown>): Promise<boolean>` — gère déjà
`actionLoading`, `actionError`, et le refresh de la liste. Directement
réutilisable pour le bouton "Annuler la proposition" sans nouvelle modale.

---

## Architecture de la solution

### Modèle de sécurité pour `accept_reschedule`

`accept_reschedule` est une action **publique** (pas de session). Le token
d'autorisation est l'UUID du RDV dans l'URL — non devinable (128 bits
d'entropie). L'API ajoute deux validations DB-side :

1. `status === 'rescheduled'` → sinon 409
2. `rescheduled_to > now()` → sinon 422

**Idempotence :** un second appel retourne 409 (le statut a déjà changé),
ce qui protège contre le double-submit même si le bouton est réactivé par
erreur JS.

### Restructuration de l'ordre d'exécution dans `[id].ts`

```
Avant  :  auth check → params/UUID → parse body → validate action → handlers
Après  :  params/UUID → parse body → validate action → auth check (sauf accept_reschedule) → handlers
```

L'UUID validation (`params.id`) reste en tête — elle ne dépend d'aucune
action ni body.

---

## Plan d'implémentation

### Slice 1 — API : restructuration auth + action `accept_reschedule`
**Fichier :** `src/pages/api/appointments/[id].ts`
**Priorité :** prérequis à toutes les autres slices

#### 1.1 Restructuration de l'ordre d'exécution

Déplacer le bloc `request.json()` (l. 70–75) et la validation de l'action
(l. 79–80) **avant** le bloc auth check (l. 59–61), et conditionner ce dernier
à l'action :

```ts
// ── Étape 1 : Params & UUID ─────────────────────────────────────────────
const { id } = params;
if (!id) return errorResponse(400, 'Identifiant manquant');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) return errorResponse(400, 'Identifiant de rendez-vous invalide');

// ── Étape 2 : Parse body ────────────────────────────────────────────────
let body: Record<string, unknown>;
try { body = await request.json(); }
catch { return errorResponse(400, 'Corps de requête JSON invalide'); }

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

// ── Étape 3 : Auth guard (actions admin uniquement) ─────────────────────
if (action !== 'accept_reschedule') {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(401, 'Non autorisé');
}

// ── Étape 4 : Récupérer le rendez-vous ─────────────────────────────────
// (inchangé)
```

Supprimer les blocs auth (l. 59–61), params/UUID (l. 63–67) et body parsing
(l. 70–80) de leurs positions actuelles.

#### 1.2 Nouveau handler `accept_reschedule`

Insérer après le bloc `reschedule` (après l. 321), avant `save_notes` :

```ts
// ---------------------------------------------------------------------------
// Action: accept_reschedule
// ---------------------------------------------------------------------------
if (action === 'accept_reschedule') {
  if (appointment.status !== 'rescheduled')
    return errorResponse(409, 'Ce rendez-vous ne peut être accepté que depuis le statut rescheduled');

  if (!appointment.rescheduled_to)
    return errorResponse(422, 'Aucun créneau de report disponible');

  const proposedDate = new Date(appointment.rescheduled_to);
  if (proposedDate.getTime() < Date.now())
    return errorResponse(422, 'Le créneau proposé est expiré');

  const newStatus: Appointment['status'] =
    appointment.appointment_mode === 'video' ? 'payment_pending' : 'confirmed';

  const updateData: Record<string, unknown> = {
    scheduled_at:   appointment.rescheduled_to,
    rescheduled_to: null,
    status:         newStatus,
  };

  // Stripe Payment Link (vidéo uniquement)
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
    sendEmail({ /* ... PaymentRequest identique au bloc confirm ... */ })
      .catch(err => console.error('[appointments/patch] accept_reschedule — Erreur email PaymentRequest:', err));
  }

  // Email AppointmentConfirmed (présentiel)
  if (newStatus === 'confirmed') {
    const icsEvent = buildICSEvent(updatedAppt);
    sendEmail({ /* ... AppointmentConfirmed identique au bloc confirm ... */ })
      .catch(err => console.error('[appointments/patch] accept_reschedule — Erreur email confirm:', err));
  }

  return jsonResponse({
    appointment: updatedAppt,
    message: newStatus === 'confirmed'
      ? 'Rendez-vous confirmé.'
      : 'Lien de paiement envoyé au patient.',
  });
}
```

> **Note :** réutiliser les blocs email `sendEmail(PaymentRequest)` et
> `sendEmail(AppointmentConfirmed)` tels quels depuis le bloc `confirm` —
> ne pas les factoriser pour éviter un refactor hors scope.

---

### Slice 2 — Fix `bookingUrl` dans l'action `reschedule`
**Fichier :** `src/pages/api/appointments/[id].ts` — l. ~316

```ts
// Avant
bookingUrl: `${baseUrl}/rendez-vous`,

// Après
bookingUrl: `${baseUrl}/rdv/accepter-report?id=${updatedAppt.id}`,
```

Modification chirurgicale, une ligne. Aucun changement dans
`AppointmentRescheduled.tsx` — le prop `bookingUrl` était déjà prévu pour
recevoir une URL dynamique.

---

### Slice 3 — Nouvelle page SSR `/rdv/accepter-report`
**Fichier :** `src/pages/rdv/accepter-report.astro` _(à créer)_

#### Structure générale

Calquée sur `merci.astro` : `Layout` + `Navbar client:load` + carte centrée
`max-w-lg` dans `min-h-screen bg-sage-50`.

`export const prerender = false;` obligatoire (SSR Netlify Function).

#### Frontmatter (logique serveur)

```ts
export const prerender = false;

import Layout from '../../layouts/Layout.astro';
import Navbar from '../../components/islands/Navbar';
import { supabaseAdmin } from '../../lib/supabase';
import { getModeLabel } from '../../lib/pricing';
import type { Appointment } from '../../types/appointment';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = Astro.url.searchParams.get('id');

// 1. UUID absent ou invalide → redirect
if (!idParam || !UUID_RE.test(idParam)) {
  return Astro.redirect('/rendez-vous');
}

// 2. Fetch appointment
const { data, error } = await supabaseAdmin
  .from('appointments')
  .select('*')
  .eq('id', idParam)
  .single();

if (error || !data) {
  return Astro.redirect('/rendez-vous');
}

const appointment = data as Appointment;

// 3. Branching
let expiredReason: 'invalid' | 'expired' | null = null;

if (appointment.status !== 'rescheduled') {
  expiredReason = 'invalid';
} else if (!appointment.rescheduled_to || new Date(appointment.rescheduled_to) < new Date()) {
  expiredReason = 'expired';
}

// Formatage de la date pour l'affichage (seulement si OK)
let formattedDate = '';
if (!expiredReason && appointment.rescheduled_to) {
  formattedDate = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  }).format(new Date(appointment.rescheduled_to));
}
```

#### Template HTML

**Branche expirée/invalide** (`expiredReason !== null`) :

```html
<!-- Icône ⚠️ -->
<div class="flex justify-center mb-8">
  <div class="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
    <svg ...> <!-- triangle ⚠ --> </svg>
  </div>
</div>
<div class="text-center mb-8">
  <h1 class="font-serif text-3xl font-semibold text-sage-900 mb-3">
    {expiredReason === 'expired' ? 'Créneau expiré' : 'Lien invalide'}
  </h1>
  <p class="text-sage-600 font-sans leading-relaxed">
    {expiredReason === 'expired'
      ? 'Le créneau proposé n'est plus disponible.'
      : 'Ce lien n'est plus valide ou a déjà été utilisé.'}
  </p>
</div>
<div class="text-center">
  <a href="/rendez-vous" class="...btn-mint...">Prendre un nouveau rendez-vous</a>
</div>
```

**Branche OK** :

```html
<!-- Titre -->
<h1 class="font-serif text-3xl font-semibold text-sage-900 mb-3 text-center">
  Votre nouveau créneau
</h1>
<p class="text-sage-600 text-center font-sans mb-8 leading-relaxed">
  Confirmez le créneau proposé ci-dessous pour finaliser votre rendez-vous.
</p>

<!-- Récapitulatif -->
<div class="bg-white rounded-2xl border border-sage-100 shadow-sm px-6 py-5 mb-6 font-sans">
  <h2 class="text-sm font-semibold text-sage-500 uppercase tracking-wide mb-4">
    Récapitulatif
  </h2>
  <dl class="space-y-3">
    <div class="flex justify-between gap-4">
      <dt class="text-sage-500 text-sm">Nouveau créneau</dt>
      <dd class="text-sage-900 text-sm font-medium text-right capitalize">{formattedDate}</dd>
    </div>
    <div class="flex justify-between gap-4">
      <dt class="text-sage-500 text-sm">Mode</dt>
      <dd class="text-sage-900 text-sm font-medium">{getModeLabel(appointment.appointment_mode)}</dd>
    </div>
    <div class="flex justify-between gap-4">
      <dt class="text-sage-500 text-sm">Durée</dt>
      <dd class="text-sage-900 text-sm font-medium">{appointment.duration} minutes</dd>
    </div>
    <div class="flex justify-between gap-4">
      <dt class="text-sage-500 text-sm">Tarif</dt>
      <dd class="text-sage-900 text-sm font-medium">
        {(appointment.final_price / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
      </dd>
    </div>
  </dl>
</div>

<!-- CTA -->
<div class="text-center mb-4">
  <button
    id="btn-accept"
    data-appt-id={appointment.id}
    class="inline-flex items-center justify-center px-6 py-3 rounded-xl
           bg-mint-600 text-white font-medium font-sans text-sm
           hover:bg-mint-700 active:bg-mint-800
           focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-2
           transition-colors min-h-[44px] w-full max-w-xs disabled:opacity-60 disabled:cursor-not-allowed"
  >
    Accepter ce créneau
  </button>
</div>

<!-- Message d'erreur inline -->
<p id="error-msg" hidden role="alert"
   class="text-center text-sm text-red-700 font-sans mt-2">
</p>

<!-- Lien alternatif -->
<p class="text-center text-sm text-sage-500 font-sans mt-4">
  Ce créneau ne vous convient pas ?{' '}
  <a href="/rendez-vous" class="text-mint-600 underline hover:text-mint-700">
    Choisir un autre créneau
  </a>
</p>
```

#### `<script>` inline (no framework)

```html
<script>
  const btn = document.getElementById('btn-accept');
  const apptId = btn.dataset.apptId;

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
        const errEl = document.getElementById('error-msg');
        errEl.textContent = data.error ?? 'Une erreur est survenue. Veuillez réessayer.';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Accepter ce créneau';
      }
    } catch {
      const errEl = document.getElementById('error-msg');
      errEl.textContent = 'Problème réseau. Veuillez vérifier votre connexion et réessayer.';
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Accepter ce créneau';
    }
  });
</script>
```

> **Décision :** pas de React island — un seul `fetch` + redirect ne justifie
> pas la surcharge. Script vanilla suffisant et cohérent avec l'approche de
> `merci.astro`.

---

### Slice 4 — Nettoyage CTAs `AppointmentCard`
**Fichier :** `src/components/admin/AppointmentCard.tsx` — l. 395–421

Scinder le bloc conditionnel unique en deux blocs indépendants.

**Remplacer** (l. 395–421) :

```tsx
{(status === "pending" || status === "rescheduled") && (
  <>
    <button onClick={() => { setModal("confirm"); setActionError(null); }} ...>Confirmer</button>
    <button onClick={() => { setModal("decline"); setActionError(null); }} ...>Refuser</button>
    {status === "pending" && (
      <button onClick={() => { setModal("reschedule"); setActionError(null); }} ...>Reporter</button>
    )}
  </>
)}
```

**Par :**

```tsx
{/* Bloc pending — inchangé sémantiquement */}
{status === "pending" && (
  <>
    <button
      onClick={() => { setModal("confirm"); setActionError(null); }}
      disabled={actionLoading}
      className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 active:bg-mint-800 focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
    >
      Confirmer
    </button>
    <button
      onClick={() => { setModal("decline"); setActionError(null); }}
      disabled={actionLoading}
      className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
    >
      Refuser
    </button>
    <button
      onClick={() => { setModal("reschedule"); setActionError(null); }}
      disabled={actionLoading}
      className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
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

**Pas de nouvelle modale.** `callPatch` appelle directement `decline` avec
`therapist_notes` injecté. L'email `AppointmentDeclined` existant informe le
patient.

Mettre à jour le commentaire JSDoc en tête du fichier (l. 4) :
```ts
// Avant : pending / rescheduled → Confirmer | Refuser | Reporter
// Après : pending               → Confirmer | Refuser | Reporter
//         rescheduled           → Annuler la proposition (si rescheduled_to futur)
```

---

## Ordre d'exécution recommandé

```
Slice 1.1  →  Slice 1.2  →  Slice 2  →  Slice 3  →  Slice 4
```

Slice 1.1 (restructuration auth) est le prérequis strict de 1.2.
Slices 2, 3 et 4 peuvent être développées en parallèle une fois 1.x validé.

---

## File Impact Map

| Fichier | Opération | Slices |
|---------|-----------|--------|
| `src/pages/api/appointments/[id].ts` | **Modifier** — restructuration auth guard, + action `accept_reschedule`, fix `bookingUrl` | 1.1, 1.2, 2 |
| `src/pages/rdv/accepter-report.astro` | **Créer** — page SSR patient | 3 |
| `src/components/admin/AppointmentCard.tsx` | **Modifier** — scission bloc CTA, + bouton "Annuler la proposition" | 4 |

**Fichiers non modifiés :** `AppointmentRescheduled.tsx`, `AppointmentConfirmed.tsx`,
`PaymentRequest.tsx`, `AppointmentDeclined.tsx`, `merci.astro`, `ics.ts`,
`stripe.ts`, `supabase.ts`, `pricing.ts`, `types/appointment.ts`.

---

## Edge Cases & Guards

| Cas | Comportement attendu |
|-----|---------------------|
| Double-submit patient (clic rapide) | Bouton désactivé dès le 1er clic ; API retourne 409 → message inline |
| `rescheduled_to` expire entre chargement page et clic | API retourne 422 → message inline (pas de redirect) |
| UUID valide mais RDV absent en base | `supabaseAdmin.single()` → error → `Astro.redirect('/rendez-vous')` |
| UUID absent ou mal formé dans l'URL | UUID_RE → `Astro.redirect('/rendez-vous')` |
| Erreur Stripe avant UPDATE Supabase | `createAppointmentPaymentLink` throw → 500, aucun UPDATE — atomicité locale |
| Admin confirme manuellement un RDV `rescheduled` | Flow `confirm` existant accepte toujours `rescheduled` dans sa whitelist (l. 98) — rétrocompatibilité préservée intentionnellement |
| `rescheduled_to` expiré côté admin | Condition `>= new Date()` masque le bouton — RDV en lecture de fait |
| Admin décline depuis la modale (l. 619) | Toujours possible — la modale `decline` existante reste accessible via `setModal("decline")` pour `pending` |

---

## Acceptance Criteria — checklist

- [ ] **AC1** `PATCH /api/appointments/{id}` `{ action: 'accept_reschedule' }` sans session → 200 si statut `rescheduled` + `rescheduled_to` futur
- [ ] **AC2** Après `accept_reschedule` : `scheduled_at = rescheduled_to_initial`, `rescheduled_to = null`
- [ ] **AC3** Mode `in-person` → statut `confirmed`, email `AppointmentConfirmed` envoyé
- [ ] **AC4** Mode `video` → statut `payment_pending`, Payment Link Stripe généré, email `PaymentRequest` envoyé
- [ ] **AC5** Statut ≠ `rescheduled` → 409
- [ ] **AC6** `rescheduled_to` dans le passé → 422
- [ ] **AC7** Email `AppointmentRescheduled` contient `https://{baseUrl}/rdv/accepter-report?id={appointmentId}`
- [ ] **AC8** `GET /rdv/accepter-report?id={uuid}` valide → récap + bouton "Accepter ce créneau"
- [ ] **AC9** `GET /rdv/accepter-report?id={uuid}` statut ≠ `rescheduled` → "Ce lien n'est plus valide"
- [ ] **AC10** `GET /rdv/accepter-report?id={uuid}` `rescheduled_to` expiré → "Créneau expiré"
- [ ] **AC11** `GET /rdv/accepter-report?id=invalide` → redirect `/rendez-vous`
- [ ] **AC12** Clic "Accepter" → bouton désactivé → redirect `/rdv/merci` si 2xx → erreur inline si non-2xx
- [ ] **AC13** Dashboard admin : RDV `rescheduled` n'affiche plus Confirmer/Refuser
- [ ] **AC14** Dashboard admin : RDV `rescheduled` + `rescheduled_to` futur → "Annuler la proposition"
- [ ] **AC15** "Annuler la proposition" → `PATCH { action: 'decline', therapist_notes: '...' }` → statut `declined` + email patient
- [ ] **AC16** Bouton "Annuler la proposition" absent si `rescheduled_to < now()`
- [ ] **AC17** CTAs bloc `pending` (Confirmer/Refuser/Reporter) inchangés

---

## Out of Scope

- Expiration automatique (cron) des RDV `rescheduled` périmés
- Contre-proposition patient
- Modification tarifaire à l'acceptation
- Email de rappel spécifique au report
- Lien vidéo saisi lors de `accept_reschedule`
