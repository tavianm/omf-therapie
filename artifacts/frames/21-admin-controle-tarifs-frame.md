---
issue: 21
title: "Admin : contrôle des tarifs (remise nouveau client + tarif solidaire) lors de la validation RDV"
status: implemented
tier: F-lite
created: 2026-05-13
---

## Problem Statement

Lors de la confirmation d'un rendez-vous, l'admin (thérapeute) ne peut pas
ajuster le tarif appliqué. La remise "nouveau client" (-15€) est figée par le
champ `is_first_session` saisi par le patient, et le tarif solidaire (-10€)
n'existe pas dans le parcours de validation. De plus, rien dans le formulaire
patient n'incite à mentionner une situation financière difficile.

## Why This Matters

La thérapeute doit pouvoir : (1) corriger la remise nouveau client si le patient
s'est trompé, (2) proposer le tarif solidaire au cas par cas selon la situation
réelle du patient. Sans ce contrôle, soit elle sur-facture des patients fragiles,
soit elle perd de la flexibilité sur sa propre grille tarifaire.

## Success Criteria

- [ ] La modale "Confirmer" affiche deux toggles : "Remise nouveau client" et "Tarif solidaire"
- [ ] "Remise nouveau client" est pré-coché selon `is_first_session` du patient (modifiable)
- [ ] "Tarif solidaire" est désactivé par défaut, activable à la discrétion de l'admin
- [ ] Les deux remises sont mutuellement exclusives (radio comportement)
- [ ] Le tarif final recalculé est affiché en temps réel dans la modale
- [ ] Le PATCH `/api/appointments/[id]` accepte `override_first_session` et `is_solidarity`
- [ ] La DB (`discount`, `final_price`) est mise à jour avec le tarif retenu
- [ ] L'email de demande de paiement reflète le `final_price` stocké en DB
- [ ] Le wizard patient (step "Motif") affiche un message d'aide discret invitant à mentionner une situation financière difficile

## Constraints

- Les remises sont mutuellement exclusives : max(remise_nouveau_client, tarif_solidaire)
- Montants définis dans `src/lib/pricing.ts` : FIRST_SESSION_DISCOUNT = 15€, SOLIDARITY_DISCOUNT = 10€
- DB : colonnes `discount` et `final_price` (centimes) déjà présentes, pas de migration nécessaire
- Pas de nouveau champ DB requis : `is_solidarity` est une décision admin stockée via `discount`
- L'email de paiement (`AppointmentPaymentRequest`) doit utiliser `final_price` de la DB (déjà le cas)

## Out of Scope

- Tarif personnalisé libre (montant arbitraire) — hors périmètre
- Justificatif RSA/ASS côté patient — processus manuel hors app
- Historique des modifications tarifaires

## Stakeholders

- Oriane Montabonnet (thérapeute, utilisatrice principale du dashboard admin)
- Patients en situation difficile (bénéficiaires indirects du tarif solidaire)

## Appetite

Tier: F-lite
Reasoning: Modifications ciblées sur 3 fichiers principaux (AppointmentCard, pricing.ts, [id].ts)
+ 1 ajout mineur dans BookingWizard. Pas de nouvelle page ni de migration DB.

## Open Questions

- Aucune — tarif solidaire déjà défini à -10€ dans PricingSection.tsx
