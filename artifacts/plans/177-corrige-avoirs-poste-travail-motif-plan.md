---
title: "Plan: Corrige l'usage des avoirs au poste de travail et affiche le motif de consultation"
issue: 177
spec: artifacts/specs/177-corrige-avoirs-poste-travail-motif-spec.md
complexity: 3/10
tier: F-lite
generated: 2026-09-18
---

## Summary

Trois correctifs root-causés : migration 020 réparant la RPC `consume_credits` (CTE verrouillante), parsing `balance` du tiroir via un helper pur testé, affichage du motif dans la fiche RDV et l'historique patient, plus durcissement du delete compensatoire du POST.

## Architecture

**Data flow (existant, inchangé) :** tiroir → `GET /api/admin/credits/?email=` (`{balance, history}`) → case « Utiliser l'avoir » → `POST /api/admin/appointments/` (`use_credit`) → `getAvailableCredit()` → INSERT appointment → `consumeCredits()` → RPC `consume_credits` (FIFO, `credit_usages`). Le correctif ne touche que le corps de la RPC, le parsing de la réponse côté drawer, deux rendus, et la gestion d'erreur du delete compensatoire.

**File × Function map :**

| Fichier | Rôle | Changement |
|---|---|---|
| `supabase/migrations/020_consume_credits_lock_fix.sql` | nouveau — `CREATE OR REPLACE FUNCTION consume_credits` | CTE `locked` + `FOR UPDATE`, boucle FIFO inchangée, re-grants |
| `tests/integration/scheduling-credits.postgres.test.ts` | tests RPC sur PG réel | `seedAvailableCredit` + 5 cas dont concurrence |
| `src/utils/credits.ts` | nouveau — `parseCreditBalance(body): number \| null` | pur, client-safe |
| `tests/unit/parse-credit-balance.test.ts` | nouveau — contrat `{balance, history}` | oracle de la régression `available` |
| `src/components/admin/workbench/CreateAppointmentDrawer.tsx` | tiroir | utilise le helper (supprime `body.available`) |
| `src/components/admin/workbench/rdv/AppointmentDetail.tsx` | fiche RDV | bloc « Motif » conditionnel |
| `src/components/admin/workbench/patients/PatientsView.tsx` | fiche patient | ligne motif tronquée dans l'historique |
| `src/pages/api/admin/appointments/index.ts` | POST admin | delete compensatoire : vérifier erreur + logger |

**Refs conventions :** `019_cancel_credits_atomic.sql` (style migration), `AdminCreateButton.tsx:216-227` (parse `balance` historique), `AppointmentCard.tsx:410-416` (rendu motif existant), `PatientsView.tsx:516-545` (lignes historique).

## Agents

| Agent | Tâches | Fichiers |
|---|---|---|
| R-backend-dev-A | T1, T6 | migrations, POST handler |
| R-frontend-dev-A | T2, T4, T5 | utils, drawer, workbench views |
| R-tester-A | T3 | tests d'intégration |

## Wave Structure

3 waves, max 3 parallel agents.

| Wave | Trigger | Agents | Tasks |
|------|---------|--------|-------|
| 1 | start | 3 ∥ | R-backend-dev-A: T1 · R-frontend-dev-A: T2, T4 · R-tester-A: — |
| 2 | Wave 1 done | 2 ∥ | R-tester-A: T3 (dep T1) · R-backend-dev-A: T6 |
| 3 | lead | 1 | lead: gates complets séquentiels (test:low, lint, typecheck, build, integration Docker, audit:a11y) |

### Budget — per task

| Task | Items | Class | Est. ops | Split? |
|------|-------|-------|----------|--------|
| T1 migration 020 | 3 | bounded | 6 | — |
| T2 helper + tests unit | 4 | bounded | 8 | — |
| T3 tests d'intégration | 5 | judgmental | 10 | — |
| T4 drawer wiring | 2 | trivial | 3 | — |
| T5 motif detail + patient | 4 | bounded | 7 | — |
| T6 POST hardening | 2 | bounded | 4 | — |

**Total estimated ops: 38**

### Budget — per agent instance

| Instance | Tasks | Σ ops | Subjects | Split? |
|----------|-------|-------|----------|--------|
| R-backend-dev-A | T1, T6 | 10 | migrations, api-handler | — |
| R-frontend-dev-A | T2, T4, T5 | 18 | credits-parse, motif-display | — |
| R-tester-A | T3 | 10 | rpc-integration | — |

## Consistency Report

- SC couverts : 10/10 (SC1-2→T1+T3, SC3(concurrence)→T3, SC4(fail-closed)→T3, SC5(case avoir)→T2+T4, SC6(helper testé)→T2, SC7(submit/applied)→T2+T4+existant, SC8(delete compensatoire)→T6, SC9(motif détail)→T5, SC10(motif historique)→T5, SC11(a11y)→gates lead wave 3).
- Non couverts par micro-tâches : aucun. Untraced : aucun. Exemptions : SC7 (submit end-to-end) vérifié par tests existants `admin-appointments-post.test.ts` + démo manuelle.

## Micro-Tasks

### T1 — Migration 020 : RPC consume_credits (SC1, SC2) · R-backend-dev-A · slice V1 · GREEN

Créer `supabase/migrations/020_consume_credits_lock_fix.sql` :

```sql
-- Remplace le corps de consume_credits (008) : le SELECT SUM(... FOR UPDATE)
-- d'origine est illégal (0A000, incident 18/09). Le verrou passe par une CTE
-- matérialisée ; ordre created_at ASC, id ASC identique à la boucle FIFO
-- (pas de deadlock consume-consume). Signature inchangée.
CREATE OR REPLACE FUNCTION consume_credits(
  p_email TEXT, p_amount INTEGER, p_appointment_id UUID
) RETURNS TABLE(credit_id UUID, amount INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_available INTEGER;
  v_remaining_to_take INTEGER;
  v_credit_rec RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'CREDIT_NO_OP';
  END IF;

  WITH locked AS (
    SELECT remaining FROM credits
    WHERE patient_email = LOWER(p_email) AND remaining > 0
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  )
  SELECT COALESCE(SUM(remaining), 0) INTO v_total_available FROM locked;

  IF v_total_available < p_amount THEN
    RAISE EXCEPTION 'CREDIT_INSUFFICIENT: disponible %, demandé %', v_total_available, p_amount
    USING ERRCODE = 'check_violation';
  END IF;
  -- (boucle FIFO inchangée par rapport à 008)
```

+ boucle FIFO verbatim de 008 (lignes 120-143) + `REVOKE ALL ... FROM PUBLIC` / `GRANT EXECUTE ... TO service_role` (miroir 008:147-148).
Verify: `grep -c 'WITH locked' supabase/migrations/020_consume_credits_lock_fix.sql` → 1 · `npx vitest run tests/unit/credits.test.ts --maxWorkers=1` vert (appel RPC mocké inchangé). 10 min.

### T2 — Helper pur parseCreditBalance + test unit (SC5, SC6) · R-frontend-dev-A · slice V2 · RED→GREEN

Créer `src/utils/credits.ts` :

```ts
/** Parse la réponse de GET /api/admin/credits — { balance, history } (centimes). */
export function parseCreditBalance(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const balance = (body as { balance?: unknown }).balance;
  return typeof balance === 'number' && Number.isFinite(balance) ? balance : null;
}
```

Créer `tests/unit/parse-credit-balance.test.ts` : forme réelle `{ balance: 5000, history: [...] }` → 5000 ; `{ history: [] }` → null ; `{ available: 5000 }` (régression du bug) → null ; `null`/texte → null.
Verify: `npx vitest run tests/unit/parse-credit-balance.test.ts --maxWorkers=1` vert. 10 min.

### T3 — Tests d'intégration RPC (SC1-4) · R-tester-A · slice V1 · GREEN (dep T1)

Étendre `tests/integration/scheduling-credits.postgres.test.ts` : helper `seedAvailableCredit(email, amount, remaining, createdAtISO)` (created_at explicites), header 019→020, puis :
1. consommation simple (1 avoir) → tranche unique, remaining décrémenté ;
2. FIFO multi-avoirs (2 avoirs, created_at distincts) → ordre + tranches corrects ;
3. insuffisant (`p_amount = solde + 1`) → erreur message `/CREDIT_INSUFFICIENT/`, remaining inchangés, `credit_usages` vide (fail-closed) ;
4. concurrence : 2 clients consommant chacun le solde total → exactement 1 gagne ;
5. concurrence : 2 × moitié du solde → les 2 réussissent, Σ = solde.
Matcher sur le texte du message (ERRCODE check_violation, pattern `cancel_status_conflict` existant).
Verify: `npm run db:start` puis `npm run test:integration` — sortie collée dans la PR (la CI saute). 20 min.

### T4 — Drawer : utiliser le helper (SC5) · R-frontend-dev-A · slice V2 · GREEN (dep T2)

`CreateAppointmentDrawer.tsx` effet ligne 162-180 : remplacer le parse inline par `parseCreditBalance(body)`. Import `../../../../utils/credits`. Aucun autre changement (reset use_credit, gating, payload inchangés).
Verify: `grep -c 'body.available' src/components/admin/workbench/CreateAppointmentDrawer.tsx` → 0 · typecheck ciblé. 5 min.

### T5 — Motif : fiche détail + historique patient (SC9, SC10) · R-frontend-dev-A · slice V3 · GREEN

`AppointmentDetail.tsx` : bloc conditionnel après les cartes d'info —

```tsx
{appointment.patient_reason.trim() !== '' && (
  <div className="rounded-xl bg-mint-50 px-4 py-3">
    <p className="text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-500">Motif</p>
    <p className="mt-1 text-sm font-sans text-sage-900">{appointment.patient_reason}</p>
  </div>
)}
```

`PatientsView.tsx` historique (lignes ~527-533) : sous la ligne méta, `<span className="block text-xs text-sage-400 font-sans truncate" title={appointment.patient_reason}>{appointment.patient_reason}</span>` — conditionnel non-vide.
Verify: typecheck + démo manuelle poste-travail. 15 min.

### T6 — POST : delete compensatoire vérifié (SC8) · R-backend-dev-A · slice V2 · GREEN

`src/pages/api/admin/appointments/index.ts` lignes 324-327 : capturer le résultat du `.delete()` ; si erreur → `console.error('[admin/appointments] Échec du delete compensatoire (RDV orphelin à vérifier):', deleteError)` (Sentry capte via le middleware existant). Message 409 inchangé.
Verify: `npx vitest run tests/unit/admin-appointments-post.test.ts --maxWorkers=1` vert. 10 min.

## Task Seeding Blueprint

<!-- Used by /R-dev-implement to seed TaskCreate calls on session start.
     Format: T{n} | agent-instance | blockedBy | subject -->

### Wave 1 — no deps, 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T1 | R-backend-dev-A | — | migrations |
| T2 | R-frontend-dev-A | — | credits-parse |
| T4 | R-frontend-dev-A | T2 | credits-parse |
| T5 | R-frontend-dev-A | — | motif-display |

### Wave 2 — after Wave 1, 2 agents ∥

| Task | Agent instance | blockedBy | Subject |
|------|---------------|-----------|---------|
| T3 | R-tester-A | T1 | rpc-integration |
| T6 | R-backend-dev-A | — | api-handler |

### Wave 3 — lead gates (séquentiel, garde WSL)

`npm run test:low` → `lint` → `typecheck` → `build` → `db:start + test:integration` → `audit:a11y` (dev server). Sortie intégration + a11y collée dans la PR.

## Task IDs

<!-- Generated by /R-dev-plan. Host: ZCode TodoWrite (no persistent ids) —
     resume via todo titles below, prefixed T{n}. -->
- T1: migration 020 consume_credits (CTE verrouillante) — migrations
- T2: helper parseCreditBalance + tests unit — credits-parse
- T3: tests d'intégration RPC (FIFO, fail-closed, concurrence) — rpc-integration
- T4: drawer utilise parseCreditBalance — credits-parse
- T5: motif dans AppointmentDetail + PatientsView — motif-display
- T6: delete compensatoire vérifié au POST — api-handler
