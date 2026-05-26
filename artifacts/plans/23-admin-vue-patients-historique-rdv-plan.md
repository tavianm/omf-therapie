---
issue: 23
tier: F-lite
spec: artifacts/specs/23-admin-vue-patients-historique-rdv-spec.md
status: draft
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Créer les types `Patient` et `AppointmentSummary` | backend-dev | `src/types/patient.ts` | — | Y |
| T2 | Créer `GET /api/admin/patients` — agrégation SQL + auth guard + `?includeArchived` | backend-dev | `src/pages/api/admin/patients.ts` | T1 | N |
| T3 | Modifier `AdminCreateButton` — prop `prefillData?` optionnelle + init FormState | frontend-dev | `src/components/admin/AdminCreateButton.tsx` | T1 | Y |
| T4 | Créer `PatientList` island — liste, toggle archivés, accordéon inline, bouton RDV | frontend-dev | `src/components/admin/PatientList.tsx` | T1, T2, T3 | N |
| T5 | Modifier `mes-rdvs.astro` — onglets Rendez-vous/Patients + sessionStorage + mount PatientList | frontend-dev | `src/pages/mes-rdvs.astro` | T4 | N |
| T6 | Tests — API patients (auth, aggregation) + PatientList (render, toggle, prefill) | tester | `src/pages/api/admin/patients.test.ts`, `src/components/admin/PatientList.test.tsx` | T1, T2, T3, T4, T5 | Y |

## Budget

### Per task

| Task | Subject | Class | Est. ops |
|------|---------|-------|----------|
| T1 | data-model | trivial | ~2 |
| T2 | patients-api | bounded | ~5 |
| T3 | prefill-ui | bounded | ~4 |
| T4 | admin-ui | judgmental | ~8 |
| T5 | admin-ui | bounded | ~4 |
| T6 | testing | bounded | ~5 |

### Per agent instance

| Instance | Tasks | Subjects | Est. ops | Action |
|----------|-------|----------|----------|--------|
| backend-dev | T1, T2 | data-model, patients-api | ~7 | — |
| frontend-dev | T3, T4, T5 | prefill-ui, admin-ui | ~16 | — |
| tester | T6 | testing | ~5 | — |

## Agent Slices

**backend-dev:** T1 (types), T2 (API)
**frontend-dev:** T3 (AdminCreateButton prefill), T4 (PatientList island), T5 (mes-rdvs onglets)
**tester:** T6 (tests API + composants)

## Key Patterns to Follow

- **Auth guard** : même pattern que `src/pages/api/admin/appointments/index.ts` — `auth.api.getSession()` + `isAdminSession()`
- **Island React** : `client:load` pour les composants admin (above-fold, toujours visible)
- **sessionStorage** : même pattern que le filtre statut dans `mes-rdvs.astro` (script vanilla en bas de page)
- **Types** : re-exporter `AppointmentType` / `AppointmentMode` / `AppointmentStatus` depuis `src/types/appointment.ts`

## Prefill Data Shape

```typescript
// À ajouter dans src/types/patient.ts ou src/components/admin/AdminCreateButton.tsx
interface PrefillData {
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  appointment_type: AppointmentType;
}
```

`AdminCreateButton` reçoit `prefillData?: PrefillData`. Si fourni, `useState<FormState>(prefillData ? { ...INITIAL_STATE, ...prefillData } : INITIAL_STATE)`.

## SQL Aggregation (T2)

```sql
SELECT
  patient_email,
  (array_agg(patient_name    ORDER BY scheduled_at DESC))[1] AS name,
  (array_agg(patient_phone   ORDER BY scheduled_at DESC))[1] AS phone,
  COUNT(*)::int                                               AS session_count,
  MAX(scheduled_at)                                          AS last_appointment_at,
  (array_agg(appointment_type ORDER BY scheduled_at DESC))[1] AS last_type,
  (array_agg(appointment_mode ORDER BY scheduled_at DESC))[1] AS last_mode,
  json_agg(
    json_build_object(
      'id', id,
      'scheduledAt', scheduled_at,
      'appointmentType', appointment_type,
      'appointmentMode', appointment_mode,
      'status', status,
      'finalPrice', final_price,
      'duration', duration
    ) ORDER BY scheduled_at DESC
  ) AS appointments
FROM appointments
WHERE deleted_at IS NULL
GROUP BY patient_email
ORDER BY name ASC
```

Filtre `?includeArchived=false` (défaut) : ajouter `HAVING MAX(scheduled_at) >= NOW() - INTERVAL '3 months'`

## Quality Gate

```bash
npm run lint
```

## Sequence

1. **T1** (types) + **T3** (AdminCreateButton prefill) en parallèle
2. **T2** (API) — dépend de T1
3. **T4** (PatientList island) — dépend de T1, T2, T3
4. **T5** (mes-rdvs onglets) — dépend de T4
5. **T6** (tests) — après tout le reste
