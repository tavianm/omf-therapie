---
issue: 22
title: "Admin : création manuelle d'un rendez-vous (patient téléphone)"
status: approved
tier: F-lite
created: 2026-05-13
---

## Problem Statement

L'admin ne peut créer un rendez-vous que via le parcours patient (wizard public).
Pour un patient ayant pris contact par téléphone, il faut soit lui envoyer le lien
du wizard (friction), soit saisir manuellement depuis la DB (impossible en prod).
Il n'existe pas de formulaire de création rapide dans le dashboard admin.

## Why This Matters

La thérapeute reçoit régulièrement des appels. Sans cette fonctionnalité, elle
doit utiliser un workaround (renvoyer le lien de réservation) ou passer par la
base de données directement — inacceptable en production.

## Success Criteria

- [ ] Bouton "Nouveau rendez-vous" visible dans le header du dashboard `/mes-rdvs/`
- [ ] Formulaire modal avec tous les champs nécessaires : nom, email, téléphone, code postal, ville, type, mode, durée, date/heure, motif, remise
- [ ] Création directe en statut `confirmed` (présentiel) ou `payment_pending` (téléconsultation) — pas d'étape de validation
- [ ] Pour téléconsultation : lien Stripe mock (ou réel) créé automatiquement, email de paiement envoyé si toggle activé
- [ ] Pour présentiel : email de confirmation envoyé si toggle activé
- [ ] Endpoint dédié `POST /api/admin/appointments/` : bypass rate-limit, bypass validation jour/horaire, auth requise
- [ ] La carte du nouveau RDV apparaît immédiatement dans la liste sans rechargement

## Constraints

- Authentification admin obligatoire sur le nouvel endpoint
- Pas de validation des créneaux (l'admin connaît son agenda)
- Les champs email et téléphone peuvent être vides si le patient n'a pas fourni (nullable côté formulaire admin, mais la DB a des contraintes NOT NULL — utiliser des valeurs placeholder explicites si absent)
- Réutiliser la logique `calculatePrice` existante

## Out of Scope

- Intégration Google Calendar (ajout d'un événement cal) — peut être ajouté ultérieurement
- Vérification de disponibilité via l'API calendar
- Création de compte patient

## Stakeholders

- Oriane Montabonnet (thérapeute)

## Appetite

Tier: F-lite
Reasoning: Nouveau composant React (modal formulaire) + 1 nouvel endpoint API admin.
Réutilise la logique existante (calculatePrice, sendEmail, createAppointmentPaymentLink).
Pas de migration DB.

## Open Questions

- Si email absent (patient a juste appelé) : utiliser "" ou null ? → contrainte DB NOT NULL sur patient_email → l'admin doit saisir un email ou utiliser un placeholder. Décision : email requis dans le formulaire (sinon pas d'email de confirmation possible de toute façon).
