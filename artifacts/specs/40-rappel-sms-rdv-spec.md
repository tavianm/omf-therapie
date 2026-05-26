---
issue: 40
title: "feat: rappel SMS la veille des rendez-vous"
tier: F-lite
status: approved
provider: sweego
---

## Goal

Envoyer automatiquement un SMS de rappel à chaque patient la veille de son rendez-vous à 18h, via Sweego, sans aucune action manuelle de la praticienne.

## Context

- **DB** : `patient_phone TEXT NOT NULL` et `reminder_sent_at TIMESTAMPTZ` existent déjà (`001_init.sql`). `reminder_sent_at` n'est pas encore utilisé.
- **Email J-1** : `src/emails/AppointmentReminder.tsx` existe mais aucun déclencheur ne l'appelle.
- **Infra** : Netlify Scheduled Functions disponibles (`netlify.toml` — aucune définie à ce jour).
- **RGPD** : SMS transactionnel — base légale Art. 6(1)(b) RGPD. Pas de checkbox. Mention informative à ajouter dans le wizard + mécanisme STOP dans le SMS.
- **Provider** : [Sweego](https://www.sweego.io/fr/sms-transactionnel) — 0,04€/SMS, hébergement 🇫🇷, API REST.

## Acceptance Criteria

- [ ] **AC1** — Un cron Netlify Scheduled Function se déclenche chaque jour à 18h (Europe/Paris).
- [ ] **AC2** — Le cron sélectionne tous les appointments dont `scheduled_at` est le lendemain (J+1), `status IN ('confirmed', 'payment_received')` et `reminder_sent_at IS NULL`.
- [ ] **AC3** — Pour chaque appointment éligible, un SMS est envoyé au `patient_phone` via l'API Sweego.
- [ ] **AC4** — Le SMS contient : prénom du patient, date et heure du RDV, nom de la praticienne, instruction STOP — le tout en ≤ 160 caractères.
- [ ] **AC5** — Après envoi réussi, `reminder_sent_at` est mis à jour avec l'horodatage UTC de l'envoi (idempotence : un rappel par appointment maximum).
- [ ] **AC6** — En cas d'erreur Sweego (timeout, 4xx, 5xx), l'erreur est loguée, `reminder_sent_at` n'est PAS mis à jour (retry possible au prochain déclenchement).
- [ ] **AC7** — La variable d'environnement `SWEEGO_API_KEY` est requise et documentée dans `netlify.toml` (commentaire) et `.env.local.example`.
- [ ] **AC8** — Le wizard de réservation affiche une mention informative inline sous le champ téléphone : *"Votre numéro sera utilisé uniquement pour vous envoyer un rappel SMS la veille de votre rendez-vous."*
- [ ] **AC9** — La politique de confidentialité (ou une page dédiée) mentionne le traitement SMS.
- [ ] **AC10** — En local avec `SWEEGO_API_KEY` absent ou vide, la scheduled function log un avertissement et s'arrête proprement (pas d'exception non gérée).

## Breadboard

| Surface | Action | Handler | Data |
|---------|--------|---------|------|
| Netlify Scheduled Function | Cron `0 16 * * *` (UTC = 18h Paris) | `netlify/functions/send-sms-reminders.ts` | Lit `appointments` via Supabase service role |
| Supabase (PostgreSQL) | SELECT appointments J+1 éligibles | Query dans la scheduled function | `scheduled_at`, `status`, `reminder_sent_at`, `patient_phone`, `patient_name` |
| API Sweego | POST `/v1/send` | `src/lib/sweego.ts` | `to`, `message`, `from` (nom expéditeur) |
| Supabase (PostgreSQL) | UPDATE `reminder_sent_at` | Après envoi réussi | `id`, `reminder_sent_at = NOW()` |
| BookingWizard | Affichage mention informative | `src/components/booking/BookingWizard.tsx` | Texte statique sous le champ `patient_phone` |

## Slices

**Slice 1 — Lib Sweego + env :** Créer `src/lib/sweego.ts` (wrapper API REST Sweego), ajouter `SWEEGO_API_KEY` dans `.env.local.example` et le commentaire dans `netlify.toml`.

**Slice 2 — Scheduled Function :** Créer `netlify/functions/send-sms-reminders.ts` — logique de sélection des appointments éligibles, appel Sweego, mise à jour `reminder_sent_at`. Configurer le cron dans `netlify.toml`.

**Slice 3 — Mention informative RGPD :** Ajouter la mention inline sous le champ téléphone dans `src/components/booking/BookingWizard.tsx`.

## Out of Scope

- Rappel par email (infrastructure à part, non connectée à ce ticket)
- Rappel à J-7 ou J-2
- Gestion des réponses STOP entrants (webhook Sweego)
- Interface admin pour visualiser les rappels envoyés
- Dashboard de statistiques no-show
- Suppression du badge psychologue.net dans le footer (ticket séparé)

## Decisions

- **Nom expéditeur Sweego** : `OMFTHERAPIE` (11 chars, alphanumérique — valide ARCEP).
- **Timezone** : cron fixe `0 16 * * *` UTC — 18h en heure d'hiver, 17h en heure d'été. Décalage d'1h en été jugé acceptable.
- **`patient_name`** : à vérifier dans le schéma DB lors de l'implémentation.
