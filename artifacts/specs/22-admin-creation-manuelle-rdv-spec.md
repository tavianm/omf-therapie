---
issue: 22
title: "Admin : création manuelle d'un rendez-vous (patient téléphone)"
tier: F-lite
status: implemented
---

## Goal

Permettre à l'admin de créer un rendez-vous directement depuis le dashboard sans
passer par le wizard patient, avec confirmation immédiate et envoi optionnel d'un
email de confirmation.

## Context

- `src/pages/mes-rdvs.astro` — dashboard admin, charge les RDV via Supabase
- `src/components/admin/AppointmentCard.tsx` — carte RDV (rendu island)
- `src/pages/api/appointments/index.ts` — POST public (rate-limited, validations strictes)
- `src/lib/pricing.ts` — `calculatePrice()`
- `src/lib/resend.ts` + `src/emails/` — envoi emails

L'endpoint public `POST /api/appointments/` impose : rate limit, validation
mercredi/horaires, `is_first_session` obligatoire. L'admin a besoin d'un endpoint
dédié bypassant ces contraintes.

## Acceptance Criteria

- [ ] AC1 — Bouton "Nouveau rendez-vous" visible dans le header du dashboard `/mes-rdvs/`
- [ ] AC2 — Clic → ouvre un formulaire modal avec : prénom+nom, email, téléphone, code postal, ville, type (individuel/couple/famille), mode (présentiel/téléconsultation), durée (60/90 min), date+heure, motif, "remise nouveau client" toggle
- [ ] AC3 — Endpoint `POST /api/admin/appointments/` : auth admin requise (session BetterAuth), pas de rate limit, pas de validation jour/horaire
- [ ] AC4 — Présentiel : RDV créé en statut `confirmed`, email de confirmation envoyé si toggle "Envoyer email au patient" activé (défaut: activé)
- [ ] AC5 — Téléconsultation : RDV créé en statut `payment_pending` + lien Stripe généré (mock ou réel), email de paiement envoyé si toggle activé (défaut: activé)
- [ ] AC6 — La nouvelle carte apparaît dans la liste des RDV sans rechargement de page (via state React ou rechargement ciblé)
- [ ] AC7 — Validation minimale dans le formulaire : nom (2-100 chars), email valide, téléphone français, date future
- [ ] AC8 — Prix calculé en temps réel dans le formulaire (champ read-only recalculé à chaque changement type/durée/remise)

## Breadboard

| Surface | Action | Handler | Data |
|---------|--------|---------|------|
| Dashboard header | Clic "Nouveau rendez-vous" | React state | `showCreateModal: true` |
| Modal `AdminCreateModal` | Saisie formulaire | React state | `CreateAppointmentForm` |
| Modal | Calcul prix live | `calculatePrice()` | type, duration, isFirstSession |
| Modal | Submit | `POST /api/admin/appointments/` | `AdminCreatePayload` |
| `POST /api/admin/appointments/` | Auth check | BetterAuth session | redirect 401 si non-admin |
| API | Création RDV | Supabase INSERT | champs complets |
| API (présentiel) | Email confirm | `sendEmail(AppointmentConfirmed)` | si `send_email: true` |
| API (vidéo) | Lien Stripe | `createAppointmentPaymentLink` | `final_price` |
| API (vidéo) | Email paiement | `sendEmail(AppointmentPaymentRequest)` | si `send_email: true` |
| Dashboard | Refresh liste | `window.location.reload()` ou re-fetch | — |

## Slices

**Slice 1 — Endpoint `POST /api/admin/appointments/`**
- Créer `src/pages/api/admin/appointments/index.ts`
- Auth guard : session BetterAuth requise → 401 sinon
- Validation légère : nom, email, téléphone, date ISO future, type, mode, durée
- `calculatePrice(type, duration, is_first_session)` pour `base_price`, `discount`, `final_price`
- INSERT dans `appointments` (status: `confirmed` présentiel / `payment_pending` vidéo)
- Branching email : sendEmail(AppointmentConfirmed) ou (lien Stripe + AppointmentPaymentRequest) selon mode + `send_email`
- Fichiers : `src/pages/api/admin/appointments/index.ts`

**Slice 2 — Composant `AdminCreateModal`**
- Nouveau composant React : `src/components/admin/AdminCreateModal.tsx`
- Formulaire contrôlé avec validation locale
- Affichage prix recalculé en temps réel
- Toggle "Envoyer un email au patient" (checked par défaut)
- Submit → `POST /api/admin/appointments/` → success callback

**Slice 3 — Intégration dans le dashboard**
- `src/pages/mes-rdvs.astro` : passer un prop `showCreateButton={true}` ou intégrer directement
- Ou ajouter le bouton + modal dans `AppointmentCard` container
- Option la plus simple : bouton dans `mes-rdvs.astro` + `AdminCreateModal` comme island React séparé
- Après succès : `window.location.reload()` (simple, cohérent avec le pattern existant)

## Out of Scope

- Intégration Google Calendar (création d'événement cal)
- Vérification de disponibilité
- Création de compte patient
- Modification/suppression depuis ce formulaire

## Open Questions

- Aucune
