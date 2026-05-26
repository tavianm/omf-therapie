---
issue: 38
tier: F-full
spec: artifacts/specs/38-feat-amelioration-flow-invitation-rdv-therapeute-spec.md
status: draft
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Étendre types pricing + `Appointment.duration: number` + `overridePrice?` dans `calculatePrice` | backend-dev | `src/lib/pricing.ts`, `src/types/appointment.ts` | — | Y |
| T2 | API admin : validation durée [15–240], `override_price`, calendrier vidéo immédiat, persist `google_calendar_event_id` | backend-dev | `src/pages/api/admin/appointments/index.ts` | T1 | N |
| T3 | Webhook : idempotence `google_calendar_event_id` avant création calendrier | backend-dev | `src/pages/api/stripe-webhook.ts` | — | Y |
| T4 | UI admin : durée custom (select + champ numérique conditionnel) + prix override | frontend-dev | `src/components/admin/AdminCreateButton.tsx` | T1 | Y |
| T5 | Validation : vérifier lint + typecheck post-implémentation | tester | — | T1,T2,T3,T4 | N |

## Budget

### Per task

| Task | Subject | Class | Est. ops | Split? |
|------|---------|-------|----------|--------|
| T1 | pricing | bounded | ~4 | — |
| T2 | appointments | exploratory | ~12 | — |
| T3 | payments | bounded | ~4 | — |
| T4 | admin-ui | judgmental | ~8 | — |
| T5 | quality | trivial | ~2 | — |

### Per agent instance

| Instance | Tasks | Subjects | Est. ops | Action |
|----------|-------|----------|----------|--------|
| backend-dev-A | T1, T2 | pricing, appointments | ~16 | — |
| backend-dev-B | T3 | payments | ~4 | — |
| frontend-dev | T4 | admin-ui | ~8 | — |
| tester | T5 | quality | ~2 | — |

## Agent Slices

**backend-dev-A:** T1, T2
**backend-dev-B:** T3
**frontend-dev:** T4
**tester:** T5

## Quality Gate

```bash
npm run lint
```

(build requires env vars — non-disponible en local sans `.env.local` complet ; lint + typecheck suffisent pour valider)

## Sequence

1. **T1** — types fondation (pricing + appointment) ; T3 en parallèle (indépendant)
2. **T2** — API admin (dépend T1) ; **T4** — UI admin (dépend T1) — peuvent partir en parallèle après T1
3. **T5** — quality gate finale

## Notes d'implémentation

### T1 — pricing.ts
- Ajouter `export type AdminDuration = number` (alias sémantique admin-only)
- `calculatePrice` : ajouter param optionnel `overridePrice?: number` — si présent, retourner `{ basePrice: overridePrice, discount: 0, finalPrice: overridePrice, label: \`${overridePrice}€\` }`
- `Appointment.duration` dans `types/appointment.ts` : `60 | 90` → `number` (reflète DB INTEGER sans contrainte)
- `AppointmentDuration = 60 | 90` **reste inchangé** — utilisé par le flow patient

### T2 — admin/appointments/index.ts
- Remplacer `VALID_DURATIONS.has(Number(duration))` par `Number.isInteger(Number(duration)) && Number(duration) >= 15 && Number(duration) <= 240`
- Message d'erreur : `'Durée invalide (entre 15 et 240 minutes)'`
- Extraire `override_price` du body ; valider `typeof override_price === 'undefined' || (Number.isInteger(Number(override_price)) && Number(override_price) >= 0)`
- Calcul prix : `override_price !== undefined ? { basePrice: Number(override_price), discount: 0, finalPrice: Number(override_price) } : calculatePrice(...)`
- **Refactoriser le bloc calendrier** : extraire une fonction `createAdminCalendarEvent(appointment)` couvrant `in-person` ET `video` :
  - in-person : `withMeet: false`, location = cabinet
  - video : `withMeet: !video_link`, location = 'Téléconsultation'
  - Exécuter juste après `invalidateAvailabilityCache()`, avant les emails
  - Persister `google_calendar_event_id` via `supabaseAdmin.update`
  - Non-bloquant : `try/catch` avec `console.error`

### T3 — stripe-webhook.ts
- Dans `handlePaymentSucceeded`, après `supabaseAdmin.update` (lignes 201–212) :
  - Re-lire `google_calendar_event_id` du RDV mis à jour (`updated.google_calendar_event_id`)
  - Si non nul → `calendarEventCreated = true` ; skip tout le bloc de création calendrier
  - Si nul → comportement actuel inchangé

### T4 — AdminCreateButton.tsx
- `FormState.duration`: `AppointmentDuration` → `number | 'custom'`
- Ajouter `customDurationMinutes: number` (défaut: 45), `useOverridePrice: boolean` (défaut: false), `override_price: number` (défaut: 0)
- DURATIONS : ajouter `{ value: 'custom', label: 'Personnalisée…' }`
- Quand `duration === 'custom'` : afficher `<input type="number" min="15" max="240" step="1">` sous le select
- `livePrice` : dépend de `form.useOverridePrice` — si true, afficher `override_price` sans calcul
- Quand `useOverridePrice` : désactiver + décocher `override_first_session` et `is_solidarity`
- `handleSubmit` : payload `duration = form.duration === 'custom' ? form.customDurationMinutes : form.duration` ; ajouter `override_price` si `useOverridePrice`
