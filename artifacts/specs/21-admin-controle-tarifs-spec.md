---
issue: 21
title: "Admin : contrôle des tarifs (remise nouveau client + tarif solidaire)"
tier: F-lite
status: implemented
---

## Goal

Permettre à l'admin de contrôler, au moment de la confirmation, la remise
appliquée (nouveau client ou solidaire) et afficher un message d'aide discret
dans le formulaire patient pour inciter à mentionner une situation financière
difficile.

## Context

- `src/lib/pricing.ts` — grille tarifaire, `calculatePrice()`, FIRST_SESSION_DISCOUNT=15€
- `src/components/admin/AppointmentCard.tsx` — modal "Confirmer" (lignes ~490-531)
- `src/pages/api/appointments/[id].ts` — action `confirm` (lignes ~97-180) : utilise `appointment.final_price` pour le lien Stripe
- `src/components/booking/BookingWizard.tsx` — champ `patient_reason` (step 2)
- DB : colonnes `discount INTEGER`, `final_price INTEGER` (centimes) déjà présentes

La remise est actuellement figée lors de la soumission patient. L'API `confirm`
ne recalcule pas le prix — elle utilise le `final_price` stocké pour le lien
Stripe. En surchargeant `discount` + `final_price` au moment du confirm, le prix
correct se propage automatiquement au lien Stripe.

## Acceptance Criteria

- [ ] AC1 — La modale "Confirmer" affiche une section "Tarification" avec le tarif de base, le tarif actuel calculé et deux toggles radio
- [ ] AC2 — Toggle "Remise nouveau client (−15€)" pré-coché si `appointment.is_first_session === true`
- [ ] AC3 — Toggle "Tarif solidaire (−10€)" désactivé par défaut, activable par l'admin
- [ ] AC4 — Les deux toggles sont mutuellement exclusifs (sélectionner l'un désactive l'autre)
- [ ] AC5 — Le prix final recalculé s'affiche en temps réel dans la modale
- [ ] AC6 — Le PATCH `/api/appointments/[id]/` accepte `override_first_session: boolean` et `is_solidarity: boolean` dans l'action `confirm`
- [ ] AC7 — L'API recalcule `discount` et `final_price` selon les overrides avant toute opération Stripe ou DB
- [ ] AC8 — La DB est mise à jour avec les nouveaux `discount` et `final_price` (centimes)
- [ ] AC9 — Le lien Stripe (email de paiement) reflète le `final_price` overridé
- [ ] AC10 — Dans le wizard patient (step "Informations"), sous le champ "Motif de consultation", un message d'aide discret : "Si vous traversez une période financière difficile (RSA, études, chômage…), n'hésitez pas à le mentionner dans votre motif — un tarif adapté peut être proposé."

## Breadboard

| Surface | Action | Handler | Data |
|---------|--------|---------|------|
| Modal "Confirmer" (AppointmentCard) | Toggle remise/solidaire | React state | `overrideFirstSession`, `isSolidarity` |
| Modal "Confirmer" | Affichage prix recalculé | Calcul local (calculatePrice) | basePrice, discount, finalPrice |
| PATCH `/api/appointments/[id]/` | confirm + tarifs | `[id].ts` action confirm | `override_first_session`, `is_solidarity` |
| API confirm | Recalcul prix | `calculatePrice()` | type, duration, is_first_session overridé |
| API confirm | Création lien Stripe | `createAppointmentPaymentLink` | `amount = new final_price` |
| BookingWizard step 2 | Affichage hint solidaire | JSX | statique |

## Slices

**Slice 1 — pricing.ts : ajout SOLIDARITY_DISCOUNT**
- Ajouter `export const SOLIDARITY_DISCOUNT = 10` (€)
- Ajouter surcharge `calculatePrice(..., isSolidarity?: boolean)` : `discount = isSolidarity ? SOLIDARITY_DISCOUNT : isFirstSession ? FIRST_SESSION_DISCOUNT : 0`
- Fichiers : `src/lib/pricing.ts`

**Slice 2 — API confirm : accept overrides + recalcul**
- Parser `override_first_session?: boolean`, `is_solidarity?: boolean` depuis le body PATCH
- Recalculer prix si l'un ou l'autre est fourni : `calculatePrice(type, duration, override_first_session ?? is_first_session, is_solidarity)`
- Mettre à jour `updateData.discount` et `updateData.final_price` (centimes)
- Utiliser le nouveau `final_price` pour `createAppointmentPaymentLink`
- Fichiers : `src/pages/api/appointments/[id].ts`

**Slice 3 — AppointmentCard : toggles dans la modale Confirmer**
- États React : `overrideFirstSession` (init: `appointment.is_first_session`), `isSolidarity` (init: false)
- Section "Tarification" dans la modale : affichage prix de base + toggles radio + prix final live
- Passer `override_first_session` et `is_solidarity` dans le payload `handleConfirm`
- Fichiers : `src/components/admin/AppointmentCard.tsx`

**Slice 4 — BookingWizard : message d'aide solidaire**
- Après le champ `patient_reason`, ajouter un `<p>` discret (text-xs, sage-400) avec le message d'aide
- Fichiers : `src/components/booking/BookingWizard.tsx`

## Out of Scope

- Tarif libre (montant arbitraire) saisi par l'admin
- Validation/justificatif RSA côté app
- Historique des modifications tarifaires
- Affichage du tarif sur le récapitulatif côté patient (wizard step recap)

## Open Questions

- Aucune
