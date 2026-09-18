---
title: "Corrige l'usage des avoirs au poste de travail et affiche le motif de consultation"
description: "RPC consume_credits (FOR UPDATE+agrégat), parsing balance du tiroir, affichage du motif"
type: spec
status: approved
---

## Context

Source : `artifacts/frames/177-corrige-avoirs-poste-travail-motif-frame.md` (promu — F-lite, analyze sauté).
Racines vérifiées sur `origin/main` (`7c9eb71`) :

1. `supabase/migrations/008_credits.sql:110-113` — `SELECT COALESCE(SUM(remaining),…) … FOR UPDATE` : PostgreSQL interdit `FOR UPDATE` avec un agrégat (erreur `0A000`, production 18/09). Aucune migration ultérieure (009–019) ne remplace `consume_credits` ; `019_cancel_credits_atomic.sql` ne concerne que l'annulation.
2. `src/components/admin/workbench/CreateAppointmentDrawer.tsx:163` — lit `body.available` alors que `GET /api/admin/credits` renvoie `{ balance, history }` (`src/pages/api/admin/credits.ts:38-41`). `availableCredit` reste `null` → case « Utiliser l'avoir » jamais rendue (ligne 716), `use_credit` jamais envoyé (ligne 280).
3. `patient_reason` saisi (tiroir + booking patient), stocké (`001_init.sql:21`), renvoyé par l'API, affiché dans l'ancienne `AppointmentCard.tsx:410` — mais absent de `workbench/rdv/AppointmentDetail.tsx` et de l'historique patient `workbench/patients/PatientsView.tsx`.

## Intent

La praticienne ne peut pas réutiliser un avoir : toute création de RDV avec avoir échoue (RPC cassée), et dans le poste de travail l'avoir n'est même pas proposé (parsing erroné). Par ailleurs le motif de consultation — information de préparation des séances — est invisible dans toutes les vues du poste de travail. Pourquoi maintenant : avoir bloqué en production depuis le 18/09 + poste de travail (PR #167) devenu l'interface principale.

## Goal

Après annulation d'un RDV payé, la praticienne crée depuis `/poste-travail` un RDV avec « Utiliser l'avoir » coché : la création aboutit, les avoirs sont décomptés en FIFO, et le motif de consultation est lisible sur la fiche RDV et l'historique patient.

## Users

- **Primaire :** la praticienne (admin monocompte) — création manuelle de RDV, gestion des avoirs.
- **Secondaire :** patients — le motif saisi au booking reste visible à la praticienne.

## Expected Behavior

1. **RPC `consume_credits`** — le verrouillage passe par une CTE : `WITH locked AS (SELECT … WHERE patient_email = LOWER(p_email) AND remaining > 0 ORDER BY created_at ASC, id ASC FOR UPDATE)` puis `SELECT COALESCE(SUM(remaining),0) … FROM locked`. Le comportement observable est inchangé : verrouillage préalable des lignes, contrôle de suffisance (`CREDIT_INSUFFICIENT` si insuffisant), consommation FIFO, tranches dans `credit_usages`, retour `(credit_id, amount)`. Livré via `supabase/migrations/020_consume_credits_lock_fix.sql` (`CREATE OR REPLACE FUNCTION`, même signature) + re-grants idempotents (miroir de 008/012). La 008 n'est pas réécrite (immuabilité des migrations appliquées).
2. **Tiroir de création** — l'effet qui charge l'avoir parse `body.balance` (centimes) au lieu de `body.available`. Comportement inchangé par ailleurs : reset à `use_credit: false` à chaque changement d'email, case affichée si `availableCredit > 0`, tarif estimé déduit, payload `use_credit: true` uniquement si solde connu > 0.
3. **Motif** — `AppointmentDetail.tsx` : bloc « Motif » (rendu seulement si `patient_reason` non vide) avec le texte intégral, placé avec les cartes d'information. `PatientsView.tsx` : ligne motif sous la ligne méta de chaque entrée d'« Historique des séances », tronquée avec `title` complet (une ligne, `truncate`).

## Data Model & Consumers

Aucun changement de schéma : `credits.remaining`, `credit_usages`, `appointments.credit_applied`, `appointments.patient_reason` existent déjà. La migration 020 remplace uniquement le corps de la fonction `consume_credits` (même signature `consume_credits(TEXT, INTEGER, UUID)`).

| Consommateur | Champ | Quand | Statut |
|---|---|---|---|
| `POST /api/admin/appointments/` | `use_credit` → RPC `consume_credits` | création manuelle | corrige (1) |
| `CreateAppointmentDrawer` | `GET /api/admin/credits` → `balance` | saisie email patient | corrige (2) |
| `AppointmentDetail` / `PatientsView` | `appointments.patient_reason` | affichage | ajoute (3) |

## Breadboard

| ID | Affordance | Handler | Données |
|----|-----------|---------|---------|
| U1 | Case « Utiliser l'avoir disponible (X €) » (tiroir) | toggle `use_credit` | `GET /api/admin/credits/?email=` → `balance` |
| U2 | Tarif estimé « (après avoir de X €) » | rendu dérivé | `min(balance/100, livePrice)` |
| U3 | Bloc « Motif » fiche détail RDV | rendu conditionnel | `appointment.patient_reason` |
| U4 | Ligne motif historique patient | rendu conditionnel | `appointment.patient_reason` |
| N1 | RPC `consume_credits(email, amount, apptId)` | `consumeCredits()` (lib) | `credits` / `credit_usages` |
| S1 | Soumission tiroir | `POST /api/admin/appointments/` | payload incluant `use_credit` |

## Slices

| # | Slice | Démo |
|---|-------|------|
| V1 | Migration 020 + test d'intégration PostgreSQL (`tests/integration/scheduling-credits.postgres.test.ts`) : consommation simple, FIFO multi-avoirs, insuffisance, concurrence sans sur-consommation | suite d'intégration verte contre un Postgres réel (docker) |
| V2 | Drawer parse `balance` | patient avec avoir → la case apparaît, soumission OK (mock fetch) |
| V3 | Motif dans `AppointmentDetail` + historique `PatientsView` | rendu conditionnel, a11y propre |

## Success Criteria

- [ ] `consume_credits` s'exécute sans erreur `0A000` sur PostgreSQL réel (test d'intégration : insérer 2 avoirs, consommer un montant couvert par les deux, vérifier tranches FIFO + `remaining`). **Vérification locale avec Docker obligatoire avant la PR — la CI saute cette suite (skip sans PostgreSQL) ; coller la sortie dans le corps de la PR.** (Un service PostgreSQL en CI fait l'objet d'un follow-up.)
- [ ] La consommation FIFO respecte l'ordre `created_at ASC, id ASC` et écrit une ligne `credit_usages` par tranche (seeds avec `created_at` explicites — `now()` a une résolution insuffisante pour départager deux avoirs).

- [ ] Deux consommations concurrentes ne peuvent pas dépasser le solde disponible (pas de sur-consommation).

```yaml
priced:  "la somme des tranches consommées concurrentes ne dépasse jamais Σ remaining initial (atomicité du décompte)"
not:     "vérifier seulement que le SQL contient la chaîne 'FOR UPDATE' (test de forme, pas de comportement)"
oracles: ["2 transactions consommant chacune la totalité du solde → exactement une réussit, l'autre lève CREDIT_INSUFFICIENT",
          "2 transactions consommant chacune la moitié du solde → les deux réussissent, Σ consommé = solde"]
```

- [ ] Une demande supérieure au disponible échoue fermé : `CREDIT_INSUFFICIENT`, aucune ligne `credit_usages` écrite, `remaining` inchangés.

```yaml
priced:  "échec fermé atomique — aucun effet partiel ne survit à un refus"
not:     "compter les appels d'erreur côté JS (le rollback applicatif POST masque le défaut RPC)"
oracles: ["p_amount = solde + 1 → exception, SELECT remaining identique au départ, credit_usages vide"]
```

- [ ] La case « Utiliser l'avoir disponible (X €) » s'affiche dans le tiroir si et seulement si `balance > 0` pour l'email saisi (parse du champ `balance`).
- [ ] Le parsing de la réponse `GET /api/admin/credits` est extrait dans un helper pur `parseCreditBalance(body: unknown): number | null` (typé `{ balance?: number }`), utilisé par le tiroir, couvert par un test unitaire node contre la forme réelle `{ balance, history }` — c'est la régression qui a livré le bug, elle doit avoir un oracle exécutable (revue : vitest node-env ne rend pas le DOM).
- [ ] Soumission avec avoir coché → `credit_applied = min(balance, final_price)`, statut `payment_received` si couverture totale (téléconsultation), montant dû `max(0, prix − avoir)`.
- [ ] Le delete compensatoire du POST (échec RPC après INSERT) vérifie son erreur et la journalise (Sentry/console) — plus de suppression best-effort silencieuse (revue : fenêtre partielle insert→RPC).
- [ ] `AppointmentDetail` affiche le motif intégral quand `patient_reason` ≠ '' (aucun bloc vide sinon).
- [ ] Chaque entrée d'« Historique des séances » affiche le motif tronqué (une ligne) quand `patient_reason` ≠ ''.
- [ ] `npm run audit:a11y` passe sur `/poste-travail` (WCAG 2.1 AA).

## Notes de mise en œuvre

- Migration 020 : signature et RETOUR inchangés (`RETURNS TABLE(credit_id UUID, amount INTEGER)`), `SECURITY DEFINER` conservé, `REVOKE/GRANT` service_role ré-affirmés (les privilèges survivent à un CREATE OR REPLACE, mais le bloc garantit les DB fraîches). Pas de `SET search_path` — cohérent avec les migrations sœurs (008/018/019), écart délibéré noté en PR.
- Tests d'intégration (`scheduling-credits.postgres.test.ts`) : nouveau helper `seedAvailableCredit` (remaining > 0, `created_at` explicite) ; matcher d'erreur sur le **texte du message** (`/CREDIT_INSUFFICIENT/`), pas l'errcode (008 lève avec `ERRCODE = 'check_violation'`) ; rafraîchir le commentaire d'en-tête « 000-local→019 » → 020.
- `tests/unit/credits.test.ts` n'assert que la forme d'appel RPC (mock supabase) — rien à adapter côté 008.
- Le test d'intégration saute sans PostgreSQL (`npm run db:start`) — en CI il reste vert par skip ; le lead le lance localement avec Docker avant la PR et colle la sortie dans la PR.
- Revue adversariale — follow-ups hors périmètre de ce hotfix (à créer en issues) : (a) service PostgreSQL en CI pour exécuter l'oracle d'intégration au merge ; (b) invariant de réconciliation `credit_applied > 0 ∧ ∄ credit_usages` (sweep existant #126/#98) pour couvrir la fenêtre insert→RPC (crash process entre les deux transactions).
- WSL : suites ciblées en sous-agent (`--maxWorkers=1`), suites complètes en séquentiel par le lead.

## Revue experte

- **R-architect : good** — causes racines vérifiées, CTE légal en plpgsql ( matérialisation forcée par FOR UPDATE, pas d'inlining), ordre de verrou identique au boucle FIFO (pas de deadlock consume-consume), EPQ fail-closed sous READ COMMITTED, immuabilité 008 + 020 conforme à la convention append-only du repo (018/019), file de tests d'intégration correcte (readdirSync trié capte 020 automatiquement).
- **R-adversarial : needs improvement → intégré** — (1) oracle d'intégration jamais exécuté en CI : AC1 reformulé (preuve locale obligatoire + sortie collée en PR, follow-up service PG en CI) ; (2) helper pur `parseCreditBalance` + test unitaire (SC ajouté) ; (3) delete compensatoire silencieux : SC ajouté (vérification d'erreur + log), invariant de réconciliation en follow-up. Vérifié par la même passe : `consume_credits` a un seul appelant, aucune autre flow ne consomme d'avoirs, `use_credit` inatteignable hors admin (RPC REVOKE PUBLIC + RLS service_role).

