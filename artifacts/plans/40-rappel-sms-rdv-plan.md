---
issue: 40
tier: F-lite
spec: artifacts/specs/40-rappel-sms-rdv-spec.md
status: approved
---

## Context

La fonction `netlify/functions/send-reminders.ts` (email J-1 via Resend, 8h UTC) existe déjà
et utilise `reminder_sent_at` pour l'idempotence. La nouvelle fonction SMS utilise une colonne
dédiée `sms_reminder_sent_at` pour éviter tout conflit.

## Tasks

| ID | Description | Agent | Files | Deps | Parallel? |
|----|-------------|-------|-------|------|-----------|
| T1 | Migration DB + lib Sweego | backend-dev-A | `supabase/migrations/006_sms_reminder.sql`, `src/lib/sweego.ts`, `.env.local.example` | — | Y |
| T2 | Scheduled Function SMS | backend-dev-B | `netlify/functions/send-sms-reminders.ts`, `netlify.toml` | T1 | N |
| T3 | Mention RGPD wizard | frontend-dev | `src/components/booking/BookingWizard.tsx` | — | Y |
| T4 | Tests unitaires | tester | `src/lib/sweego.test.ts` | T1, T2 | N |

## Budget

### Par tâche

| Task | Subject | Class | Est. ops |
|------|---------|-------|----------|
| T1 | sms-lib + migration | bounded | ~6 |
| T2 | scheduled-function | judgmental | ~8 |
| T3 | rgpd-ui | trivial | ~2 |
| T4 | testing | bounded | ~5 |

### Par instance agent

| Instance | Tasks | Subjects | Est. ops | Action |
|----------|-------|----------|----------|--------|
| backend-dev-A | T1 | sms-lib, migration | ~6 | — |
| backend-dev-B | T2 | scheduled-function, config | ~8 | — |
| frontend-dev | T3 | rgpd-ui | ~2 | — |
| tester | T4 | testing | ~5 | — |

## Agent Slices

**backend-dev-A (T1) :**
- `supabase/migrations/006_sms_reminder.sql` — ajouter colonne `sms_reminder_sent_at TIMESTAMPTZ`
- `src/lib/sweego.ts` — wrapper REST Sweego :
  - `sendSms(to: string, message: string): Promise<void>`
  - Header `Authorization: Bearer $SWEEGO_API_KEY`
  - Expéditeur alphanumérique : `OMFTHERAPIE`
  - Gestion erreurs : throw avec message lisible
  - Graceful no-op si `SWEEGO_API_KEY` absent (log warning)
- `.env.local.example` — ajouter `SWEEGO_API_KEY=`

**backend-dev-B (T2) :**
- `netlify/functions/send-sms-reminders.ts` — Netlify Scheduled Function :
  - Cron : `0 16 * * *` (UTC = 18h Paris hiver / 17h été — décalage accepté)
  - Sélection : `scheduled_at` dans la fenêtre J+1 Paris + `status IN ('confirmed', 'payment_received')` + `sms_reminder_sent_at IS NULL` + `deleted_at IS NULL`
  - SMS ≤ 160 chars : *"Bonjour {patient_name}, rappel de votre RDV demain {date} à {heure} avec Oriane Montabonnet. Pour annuler, répondez STOP."*
  - Mise à jour `sms_reminder_sent_at` après envoi réussi
  - En cas d'erreur Sweego : log, pas de mise à jour, continue le suivant
  - Note : utilise `process.env` (runtime Node Netlify, pas `import.meta.env`)
  - S'inspirer de `netlify/functions/send-reminders.ts` pour le pattern timezone + supabase init
- `netlify.toml` — ajouter commentaire `SWEEGO_API_KEY` dans la section variables d'environnement

**frontend-dev (T3) :**
- `src/components/booking/BookingWizard.tsx` — ajouter sous le champ `patient_phone` :
  ```
  <p className="mt-1 text-xs text-sage-500">
    Votre numéro sera utilisé uniquement pour vous envoyer un rappel SMS la veille de votre rendez-vous.
  </p>
  ```

**tester (T4) :**
- `src/lib/sweego.test.ts` — tests unitaires `sendSms` :
  - Succès (mock fetch 200)
  - Erreur provider (mock fetch 4xx / 5xx) → throw
  - Clé absente → log warning, no-op (pas de throw)

## Quality Gate

```bash
npm run lint
```

(Build complet requiert les env vars Google/Supabase/Stripe — non disponibles en local sans .env.local)

## Sequence

1. **T1** (migration + lib) + **T3** (UI RGPD) — parallèles
2. **T2** (scheduled function) — après T1
3. **T4** (tests) — après T1 + T2
