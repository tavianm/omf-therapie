---
issue: 38
title: "feat: amélioration du flow d'invitation RDV par le thérapeute — durée/tarif flexibles + création immédiate du calendrier"
status: approved
tier: F-full
created: 2026-05-26
---

## Problem Statement

Le flow d'invitation de rendez-vous par le thérapeute est trop rigide pour couvrir la totalité des cas réels de sa pratique :

1. **Durée contrainte** : seules 60 min et 90 min sont proposées. Certaines séances (ex: 45 min, 75 min) ne rentrent pas dans ces standards.
2. **Tarif non modifiable** : le tarif est calculé automatiquement selon type × durée, sans possibilité de saisie manuelle pour des configurations hors-grille.
3. **Événement calendrier bloqué sur le paiement** : pour les RDV en téléconsultation créés par l'admin, l'événement Google Calendar n'est créé qu'après réception du paiement Stripe (`stripe-webhook.ts`). Si le patient ne paie pas via Stripe (paiement manuel, virement, etc.), le RDV n'apparaît jamais dans l'agenda du thérapeute.

## Current State (analyse codebase)

- `AppointmentDuration = 60 | 90` — type union strict dans `src/lib/pricing.ts`
- `VALID_DURATIONS = new Set<number>([60, 90])` — validation stricte dans `src/pages/api/admin/appointments/index.ts`
- `calculatePrice()` requiert une `AppointmentDuration` valide (60|90) — pas d'entrée pour durées arbitraires
- Pour les RDV en présentiel créés par l'admin : événement calendrier créé immédiatement ✓
- Pour les RDV en téléconsultation créés par l'admin : événement calendrier créé **uniquement** dans `stripe-webhook.ts` après paiement ✗

## Why This Matters

La thérapeute gère des cas réels où :
- Des séances non-standards (45 min de suivi, 75 min première séance couple) doivent être planifiées
- Certains patients ne peuvent pas payer via Stripe ; la thérapeute leur envoie manuellement un lien de paiement bancaire
- Sans événement calendrier immédiat, elle doit dupliquer la création manuellement dans Google Calendar — friction inutile et risque d'oubli

## Success Criteria

- [ ] La thérapeute peut créer un RDV admin avec une durée personnalisée saisie en minutes (min: 15, max: 240)
- [ ] La durée personnalisée est proposée en complément des choix standards (60 min, 90 min)
- [ ] La thérapeute peut saisir un tarif manuel en euros quand la configuration est hors-grille
- [ ] Quand un tarif manuel est saisi, le calcul automatique est désactivé (overrides `calculatePrice`)
- [ ] L'événement Google Calendar est créé immédiatement lors de la soumission du formulaire admin, pour les RDV téléconsultation comme présentiel
- [ ] Le patient est invité comme participant Google Calendar en parallèle de l'envoi du lien Stripe
- [ ] Si Stripe échoue ou `send_email=false`, l'événement calendrier est quand même créé
- [ ] Le webhook Stripe ne recrée pas un doublon si l'événement existe déjà (`google_calendar_event_id` non nul)
- [ ] Les cas standards (durée 60/90, tarif calculé auto) continuent de fonctionner à l'identique
- [ ] Le flow patient (`/api/appointments`) reste inchangé (validation stricte maintenue)

## Constraints

- **TypeScript strict** : le type `AppointmentDuration` utilisé partout doit être étendu sans casser les consommateurs existants
- **Idempotence webhook** : `handlePaymentSucceeded` doit vérifier `google_calendar_event_id` avant de créer l'événement pour éviter les doublons
- **Pas de migration DB** : `duration` est stocké en `integer` dans Supabase — les durées arbitraires sont déjà supportées
- **Rétrocompatibilité** : le flow patient (`/api/appointments`) n'est pas modifié ; la flexibilité est strictement côté admin
- **Validation** : les durées personnalisées doivent être des entiers positifs entre 15 et 240 minutes

## Out of Scope

- Modification du flow de prise de RDV par le patient (`/rendez-vous.astro`, `/api/appointments`)
- Mise à jour de la grille tarifaire `PRICE_GRID` (les tarifs standards ne changent pas)
- Gestion des durées personnalisées dans la vérification de disponibilité patient (toujours basée sur 60/90)
- Support de durées décimales (ex: 1h30 = 90 min, pas 1.5h)

## Stakeholders

- **Thérapeute (Oriane)** — utilisatrice principale du dashboard admin
- **Patients** — reçoivent l'invitation calendrier et le lien de paiement

## Appetite

Tier: F-full
Reasoning: 3 domaines touchés (UI React admin, API Node/Astro, Google Calendar), nouveau pattern (découplage calendrier/paiement), ~8 fichiers, ~3 jours de travail

## Open Questions

- La durée personnalisée doit-elle être proposée via un champ séparé (texte) ou via une option "Autre…" dans le `<select>` qui révèle un champ numérique ? → Choix UX : option "Personnalisée" + champ numérique conditionnel (meilleure accessibilité)
- Le tarif manuel doit-il remplacer complètement l'affichage du prix calculé, ou coexister ? → Remplacement total quand override activé, avec indication visuelle claire

## Premise Validity

**Success in 6 months:** La thérapeute peut créer 100% de ses RDV directement depuis le dashboard sans jamais ouvrir Google Calendar manuellement. Zéro RDV en téléconsultation absent de l'agenda pour cause de paiement Stripe non reçu.

**Failure in 6 months:** La thérapeute doit encore créer manuellement >1 événement/semaine dans Google Calendar car le tool ne couvre pas ses configurations non-standard (durée hors 60/90, patient sans Stripe). Condition observable : elle mentionne encore ces workarounds lors d'un retour utilisateur.

**Simplest alternative:** Autoriser la thérapeute à saisir une note dans le champ "motif" avec la durée réelle, et créer l'événement via le webhook. Pourquoi insuffisant : (1) n'automatise pas la création calendrier pour les patients sans Stripe — le RDV reste invisible jusqu'au paiement, (2) ne permet pas de facturer un tarif non-standard via le système, (3) crée une incohérence entre la durée de l'événement calendrier et la durée réelle de la séance.
