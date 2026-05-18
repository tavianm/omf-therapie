---
issue: 26
title: "Reschedule: flow d'acceptation patient + nettoyage CTAs admin"
tier: F-lite
status: approved
created: 2025-01-31
---

## Problem

Le flow de report de rendez-vous est incomplet : quand l'admin propose un nouveau créneau
(`action: 'reschedule'`), le patient reçoit un email avec un bouton "Accepter ce nouveau
créneau" qui pointe vers `/rendez-vous` — la page de réservation générique. Le patient doit
donc re-saisir toutes ses informations depuis zéro, sans garantie de retrouver le même créneau.

Côté admin, la carte `AppointmentCard` affiche en statut `rescheduled` les CTAs "Confirmer" et
"Refuser" — des actions destinées au statut `pending`. Ces boutons sont sémantiquement incorrects :
la décision appartient au patient, pas à la thérapeute, qui ne doit pouvoir qu'annuler sa
proposition.

Deux conséquences concrètes :

1. **Le patient ne peut pas accepter le report en un clic** — friction, risque d'abandon.
2. **L'admin peut "confirmer" un RDV reschedulé sans accord du patient** — incohérence de
   statut, contourne le consentement.

---

## Constraints

| Axe | Contrainte |
|-----|-----------|
| **Auth** | La page d'acceptation est **publique** (patient sans compte). L'accès se fait via l'`id` UUID dans l'URL — suffisant comme preuve d'intention. |
| **API** | Seul l'endpoint `PATCH /api/appointments/[id].ts` gère les mutations de RDV. La liste d'actions autorisées est validée ligne 79 — toute nouvelle action doit y être ajoutée. |
| **Date pivot** | En DB, `scheduled_at` contient le créneau original ; `rescheduled_to` contient la proposition admin. À l'acceptation, `scheduled_at` doit être promu à la valeur de `rescheduled_to` (et `rescheduled_to` remis à `null`) afin que tous les workflows downstream (ICS, Google Calendar, emails) utilisent le bon créneau. |
| **Stripe** | L'action `reschedule` efface déjà `stripe_payment_link_id/url` et expire l'ancien lien. `accept_reschedule` génère un nouveau Payment Link si mode `video`, identique au flow `confirm` existant. |
| **Email** | `AppointmentRescheduled.tsx` expose déjà un prop `bookingUrl: string` — il suffit de passer la bonne URL sans modifier le template. |
| **SSR** | La nouvelle page Astro doit avoir `export const prerender = false` (SSR Netlify Function). Le reste du site reste SSG/hybride. |
| **No React island** | Pour la page patient, la logique interactive se réduit à un seul `fetch` PATCH + redirect. Un `<script>` inline suffit — pas besoin d'un composant React. |
| **Admin decline auto** | "Annuler la proposition" doit appeler `action: 'decline'` **sans ouvrir la modale** (UX directe). Un message fixe est injecté comme `therapist_notes` pour contextualiser l'email `AppointmentDeclined` envoyé au patient. |

---

## Approach

### Vue d'ensemble du flux cible

```
[Email patient] "Accepter ce nouveau créneau"
        │
        ▼
GET /rdv/accepter-report?id={uuid}           ← nouvelle page SSR Astro
        │
        ├─ statut ≠ 'rescheduled' OU rescheduled_to passé
        │       └─ Affiche message "créneau expiré" + lien /rendez-vous
        │
        └─ OK: affiche récap du créneau proposé + bouton "Accepter"
                │
                ▼ (click → fetch PATCH)
        PATCH /api/appointments/{id}
          { action: 'accept_reschedule' }
                │
                ├─ mode in-person → status: 'confirmed'
                │       email AppointmentConfirmed + ICS
                │
                └─ mode video → status: 'payment_pending'
                        Stripe Payment Link (nouveau)
                        email PaymentRequest
                │
                ▼
        redirect → /rdv/merci
```

### Promotion de la date

Au moment de `accept_reschedule`, avant tout autre traitement :

```
scheduled_at   ← rescheduled_to   (nouveau créneau accepté)
rescheduled_to ← null
```

Tout le code downstream (`buildICSEvent`, emails, Google Calendar) lit `scheduled_at` —
aucune modification dans ces helpers.

### Nettoyage AppointmentCard

Condition actuelle (ligne 395) : `(status === "pending" || status === "rescheduled")` → bloc
"Confirmer" + "Refuser". Ce bloc est scindé :

- `status === "pending"` → comportement actuel inchangé
- `status === "rescheduled"` → nouveau bloc distinct avec un seul bouton
  "Annuler la proposition", visible uniquement si `new Date(rescheduled_to) >= Date.now()`

---

## Vertical Slices

### Slice 1 — API : action `accept_reschedule`
**Fichier :** `src/pages/api/appointments/[id].ts`

1. Ajouter `'accept_reschedule'` à la liste des actions valides (ligne 79).
2. Nouveau bloc `if (action === 'accept_reschedule')` après le bloc `reschedule` :
   - Valider `appointment.status === 'rescheduled'` (409 sinon).
   - Valider `rescheduled_to` présent en DB et dans le futur (422 sinon).
   - Construire `updateData` :
     ```ts
     {
       scheduled_at:     appointment.rescheduled_to,   // promotion
       rescheduled_to:   null,
       status:           newStatus,                    // 'confirmed' ou 'payment_pending'
     }
     ```
   - Générer Payment Link Stripe si `video` + `payment_pending` (copier le bloc des lignes 143–161).
   - Envoyer `PaymentRequest` ou `AppointmentConfirmed` selon `newStatus` (copier les blocs lignes 178–218).
3. **Aucune autre action modifiée.** `confirm` garde `['pending', 'payment_received', 'rescheduled']`
   dans sa whitelist pour rester rétrocompatible en cas d'usage manuel.

### Slice 2 — Email : fix `bookingUrl`
**Fichier :** `src/pages/api/appointments/[id].ts` (ligne ~316)

```ts
// Avant
bookingUrl: `${baseUrl}/rendez-vous`,

// Après
bookingUrl: `${baseUrl}/rdv/accepter-report?id=${updatedAppt.id}`,
```

Pas de modification du template `AppointmentRescheduled.tsx` — le prop `bookingUrl` est déjà prévu.

### Slice 3 — Page patient `/rdv/accepter-report`
**Fichier :** `src/pages/rdv/accepter-report.astro` _(nouveau)_

Structure SSR :

```
export const prerender = false;

Frontmatter (serveur) :
  1. Lire ?id= — valider UUID (400 si absent/invalide → redirect /rendez-vous)
  2. supabaseAdmin.from('appointments').select('*').eq('id', id).single()
     → 404 → redirect /rendez-vous
  3. Branching :
     a. status !== 'rescheduled' → afficher "Ce lien n'est plus valide" + lien /rendez-vous
     b. new Date(rescheduled_to) < now → afficher "Créneau expiré" + lien /rendez-vous
     c. OK → passer les données au template

Template (HTML) :
  - Layout + Navbar (cohérent avec merci.astro)
  - Récap : nouveau créneau (date/heure, mode, durée, tarif)
  - Bouton "Accepter ce créneau" (id="btn-accept")
  - <script> inline :
      document.getElementById('btn-accept').addEventListener('click', async () => {
        btn.disabled = true;
        const res = await fetch(`/api/appointments/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accept_reschedule' }),
        });
        if (res.ok) {
          window.location.href = '/rdv/merci';
        } else {
          // Affiche message d'erreur inline
        }
      });
```

> **Sécurité :** L'endpoint PATCH `accept_reschedule` vérifie lui-même que le statut DB est
> `rescheduled` et que `rescheduled_to` est dans le futur. La page SSR effectue une pré-validation
> identique pour éviter d'afficher le bouton à un patient sur un lien périmé, mais la DB reste
> source de vérité.

### Slice 4 — Admin : nettoyage CTAs `AppointmentCard`
**Fichier :** `src/components/admin/AppointmentCard.tsx` (lignes 393–421)

Scinder la condition `(status === "pending" || status === "rescheduled")` en deux blocs
indépendants :

**Bloc `pending` (inchangé) :**
```tsx
{status === "pending" && (
  <>
    <button onClick={...}>Confirmer</button>
    <button onClick={...}>Refuser</button>
    <button onClick={...}>Reporter</button>
  </>
)}
```

**Bloc `rescheduled` (nouveau) :**
```tsx
{status === "rescheduled" &&
  appointment.rescheduled_to &&
  new Date(appointment.rescheduled_to) >= new Date() && (
  <button
    onClick={() => {
      // PATCH action: 'decline' sans modal
      // therapist_notes: "La proposition de report a été annulée."
    }}
    disabled={actionLoading}
    className="... border border-red-300 text-red-700 ..."
  >
    Annuler la proposition
  </button>
)}
```

Le handler `decline` existant envoie `AppointmentDeclined` avec `therapistNote` — le message
auto-injecté informe le patient que la proposition a été retirée.

---

## File Impact Map

| Fichier | Modification |
|---------|-------------|
| `src/pages/api/appointments/[id].ts` | + action `accept_reschedule` · fix `bookingUrl` |
| `src/pages/rdv/accepter-report.astro` | **nouveau** — page SSR patient |
| `src/components/admin/AppointmentCard.tsx` | scission du bloc CTA `rescheduled` |

Fichiers **non modifiés** : `AppointmentRescheduled.tsx`, `AppointmentConfirmed.tsx`,
`PaymentRequest.tsx`, `AppointmentDeclined.tsx`, `merci.astro`, helpers ICS/Stripe.

---

## Out of Scope

- **Contre-proposition patient** : le patient ne peut qu'accepter ou ignorer/re-réserver manuellement.
- **Expiration automatique** : aucun cron pour passer les RDV `rescheduled` expirés à `declined`.
  La page affiche un message d'expiration mais le statut DB reste `rescheduled` (traitement manuel).
- **Modification de la grille tarifaire à l'acceptation** : le tarif calculé lors de la demande
  initiale est conservé.
- **Envoi d'un email de rappel spécifique au report** : le rappel J-1 existant couvre déjà tous
  les RDV `confirmed`.
- **Support du mode `video` avec lien vidéo** : `video_link` n'est pas requis à l'étape
  `accept_reschedule` (il est saisi lors de `confirm` ou fourni après paiement — comportement
  inchangé).
