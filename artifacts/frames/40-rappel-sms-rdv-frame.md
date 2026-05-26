---
issue: 40
title: "feat: rappel SMS la veille des rendez-vous"
status: approved
tier: F-lite
created: 2025-05-14
provider: sweego
---

## Problem Statement

Les patients oublient parfois leur rendez-vous. Aujourd'hui, la praticienne envoie les rappels manuellement, ce qui est chronophage et non scalable. L'infrastructure de données existe (numéro de téléphone obligatoire à la réservation, colonne `reminder_sent_at` dans la table `appointments`), mais aucun mécanisme automatique ne l'exploite.

## Why This Matters

- **Zéro rappel manuel** : libère du temps à la praticienne
- **Réduction du taux de no-show** : un no-show = séance perdue non rémunérée
- **Meilleure expérience patient** : rappel proactif = signe de professionnalisme
- Le SMS est plus engageant qu'un email (taux de lecture ~98% vs ~20%) et incite davantage à prévenir en cas d'annulation

## Success Criteria

- Aucun rappel manuel nécessaire pour les rendez-vous du lendemain
- Taux de no-show ≤ 5% sur une période de 3 mois post-déploiement
- Déclenchement automatique chaque jour à J-1 (vers 10h ou 18h)
- 0 double envoi (idempotence via `reminder_sent_at`)

## Constraints

- **Coût** : solution quasi-gratuite obligatoire (< ~0,05€/SMS ou tier gratuit suffisant pour le volume ~80 séances/mois)
- **RGPD** : opt-in explicite pour l'envoi de SMS transactionnels requis en France (article L.34-5 LCEN + RGPD)
- **Infrastructure** : Netlify Scheduled Functions disponibles (cron) — pas de serveur dédié
- **Volume** : ~80 séances/mois → ~80 SMS/mois (faible volume, compatible tiers gratuits)
- **Provider email existant** : Resend déjà configuré — à ne pas remplacer

## Out of Scope

- Rappel par WhatsApp ou autre messagerie
- Rappel à J-7 ou à J-2 (seul J-1 est demandé)
- Confirmation de lecture (delivery receipt)
- Gestion des réponses SMS (STOP, confirmation)
- Envoi depuis numéro dédié personnalisé (alpha-sender)
- Interface admin pour consulter l'historique des rappels

## Stakeholders

- **Oriane Montabonnet (praticienne)** : bénéficiaire principale — plus de rappels manuels
- **Patients** : reçoivent le SMS, meilleure expérience
- **Développeur** : intégration provider SMS + scheduled function

## Appetite

Tier: **F-lite**
Reasoning: scope borné — 1 scheduled function Netlify, 1 provider SMS, 1 API endpoint, 1 table update. Pas de nouveau domaine métier. L'infrastructure de données est déjà en place (`patient_phone`, `reminder_sent_at`). Le gabarit email J-1 (`AppointmentReminder.tsx`) peut servir de référence pour le contenu.

## Open Questions

- **Provider SMS retenu : [Sweego](https://www.sweego.io/fr/sms-transactionnel)** — 0,04€/SMS, hébergement 🇫🇷, RGPD natif, API REST, gestion STOP automatique, ~3,20€/mois pour 80 séances.
- **Heure d'envoi** : 10h ou 18h ? À confirmer avec la praticienne.
- **RGPD — pas de checkbox** : SMS transactionnel = base légale Art. 6(1)(b) RGPD ("exécution du contrat"). Pas de consentement préalable requis. À remplacer par : (1) mention informative inline dans le wizard à côté du champ téléphone, (2) mécanisme STOP dans le SMS.
- **Contenu du SMS** : texte court, < 160 caractères (1 crédit). Ex: "Bonjour {prénom}, rappel de votre RDV demain {date} à {heure} avec Oriane Montabonnet. Annulation : [lien ou tél]"
- **Timezone** : Paris (Europe/Paris) pour calculer J-1

## Premise Validity

**Succès dans 6 mois :** 0 rappel manuel à effectuer ; taux de no-show ≤ 5%

**Échec dans 6 mois :** Aucune solution SMS quasi-gratuite disponible (< ~0,05€/SMS ou tier gratuit couvrant le volume) OU taux de no-show reste > 10% après 3 mois d'utilisation

**Alternative la plus simple :** Envoyer uniquement un email J-1 via `AppointmentReminder.tsx` (infra déjà partiellement en place)
**Pourquoi pas suffisante :** Le taux d'ouverture des emails est trop faible (~20%) ; l'email engage moins le patient à prévenir en cas d'annulation. Le SMS a un taux de lecture de ~98% et un caractère d'urgence perçue plus élevé.
