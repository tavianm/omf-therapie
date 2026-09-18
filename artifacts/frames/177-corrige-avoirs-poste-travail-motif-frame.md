---
title: "Corrige l'usage des avoirs au poste de travail et affiche le motif de consultation"
issue: 177
status: approved
tier: F-lite
date: 2026-09-18
---

## Problem

Trois défauts remontés par la praticienne le 18/09 après l'annulation d'un RDV payé :

1. **RPC cassée (bloquant production)** — `consume_credits` (`supabase/migrations/008_credits.sql:110-113`) fait un `SELECT COALESCE(SUM(remaining),…) … FOR UPDATE`. PostgreSQL interdit `FOR UPDATE` avec une fonction d'agrégat (erreur `0A000`). Toute création de RDV avec avoir échoue, depuis `/mes-rdvs` comme depuis le poste de travail. La praticienne a un avoir émis qu'elle ne peut pas consommer.
2. **Avoir invisible dans le tiroir de création** — `CreateAppointmentDrawer.tsx:174` lit `body.available` alors que `/api/admin/credits` renvoie `{ balance, history }` (l'ancien `AdminCreateButton.tsx:223` lit bien `balance`). `availableCredit` reste `null` → la case « Utiliser l'avoir » (et la déduction dans le tarif estimé) n'apparaît jamais pour un patient existant avec avoir.
3. **Motif absent du poste de travail** — `patient_reason` est saisi à la création, stocké (NOT NULL, défaut chaîne vide), renvoyé par l'API et affiché dans l'ancienne `AppointmentCard.tsx:410`, mais ni la fiche détail RDV (`workbench/rdv/AppointmentDetail.tsx`) ni la vue patients (`workbench/patients/PatientsView.tsx`) ne l'affichent.

## Who

- **Primary :** la praticienne (admin monocompte) — elle crée les RDV manuellement depuis le poste de travail (PR #167) et réutilise les avoirs après annulation.
- **Secondary :** les patients — le motif saisi au booking patient (`/rendez-vous`) doit rester visible à la praticienne pour la préparation des séances.

## Constraints

- La migration 008 est **déjà appliquée en production** → le correctif SQL passe par une nouvelle migration `009` avec `CREATE OR REPLACE FUNCTION consume_credits` ; on ne réécrit pas 008 (immuabilité des migrations appliquées).
- Sémantique de verrou à préserver (ADR-015) : verrouiller les lignes `credits` avant le contrôle de sufficiency, puis consommer en FIFO — le fix CTE (`WITH locked AS (SELECT … FOR UPDATE)`) conserve l'atomicité sans l'agrégat+FOR UPDATE illégal.
- Avoirs = admin uniquement (ADR-015) : pas d'UI patient self-service.
- `patient_reason` existe déjà partout en amont (type, API, création) — correctif purement affichage dans le workbench.
- WCAG 2.1 AA : `npm run audit:a11y` requis avant PR UI ; garde WSL (tests ciblés en sous-agent, suites complètes par le lead en séquentiel).

## Out of Scope

- Tout changement de l'émission des avoirs (`issueCreditForCancellation`) ou de `restore_credits` (non concernés par le bug).
- Refund Stripe réel (ADR-015 : jamais).
- UI patient pour les avoirs ; émission manuelle d'avoirs.
- Refonte du tiroir de création au-delà des trois correctifs ; affichage du motif dans les vues liste (les listes ont déjà la recherche par motif).

## Premise Validity

**Success in 6 months :** après annulation d'un RDV payé, la praticienne crée un nouveau RDV (téléconsultation) avec « Utiliser l'avoir » coché depuis le poste de travail ; la création aboutit, `credits.remaining` et `credit_usages` sont cohérents, le RDV passe en `payment_received` sans erreur serveur. Le motif de consultation est lisible sur la fiche détail RDV et l'historique patient.

**Failure in 6 months :** toute récurrence d'une erreur `consumeCredits` dans les logs Netlify (0A000 ou CREDIT_INSUFFICIENT injustifié), ou case « Utiliser l'avoir » absente pour un patient avec solde > 0 dans le tiroir du poste de travail.

**Simplest alternative :** retirer le contrôle préalable de suffisance (somme sans verrou) et ne compter que sur le `FOR UPDATE` de la boucle FIFO.
**Why not simplest :** ça laisse une fenêtre TOCTOU entre la somme et la consommation (deux créations concurrentes → double consommation partielle ou échec FIFO incohérent) ; le CTE verrouillant est aussi minimal et respecte le contrat d'atomicité d'ADR-015.

## Complexity

**Tier : F-lite** — trois correctifs de périmètre clair, une seule domaine fonctionnel (avoirs + affichage workbench), racines confirmées dans le code, pas d'architecture nouvelle.

Signals observés :
- Label `Size: M` → F-lite (label wins).
- ~5 fichiers touchés (1 migration, 1 drawer, 2 vues workbench, tests) — au-delà de S mais périmètre sans inconnue.
- Racines des trois défauts vérifiées par lecture de code (pas d'investigation restante).
