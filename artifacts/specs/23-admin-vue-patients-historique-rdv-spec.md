---
issue: 23
title: "Admin : vue patients avec historique et proposition de nouveau RDV"
tier: F-lite
status: approved
---

## Goal

Permettre à la thérapeute de retrouver l'historique complet d'un patient et de créer un nouveau RDV pré-rempli en moins de 30 secondes depuis la page `mes-rdvs`.

## Context

- Page existante : `src/pages/mes-rdvs.astro` — liste des rendez-vous avec filtres par statut
- Composants admin existants : `AppointmentCard.tsx` (island RDV), `AdminCreateButton.tsx` (création manuelle)
- Pas de table `patients` — les patients sont dérivés de `appointments` (agrégation par `patient_email`, en excluant les RDV soft-deleted)
- **Patients actifs** : dernier RDV ≤ 3 mois | **Patients archivés** : dernier RDV > 3 mois

## Acceptance Criteria

- [ ] **AC1** — Un onglet « Patients » est visible dans `mes-rdvs` à côté de l'onglet « Rendez-vous »
- [ ] **AC2** — La liste patients est triée alphabétiquement par nom et affiche : nom, email, téléphone, nombre de séances (hors soft-deleted), date du dernier RDV
- [ ] **AC3** — Les patients actifs (dernier RDV ≤ 3 mois) sont affichés par défaut ; les patients archivés (> 3 mois) sont masqués mais accessibles via un toggle « Afficher les patients inactifs »
- [ ] **AC4** — Cliquer sur un patient expand une section inline montrant l'historique complet de ses RDV (date, type, mode, statut, montant) — un seul patient peut être ouvert à la fois
- [ ] **AC5** — Depuis la fiche patient, un bouton « Proposer un RDV » ouvre `AdminCreateButton` avec pré-remplissage : nom, email, téléphone, type de séance du dernier RDV
- [ ] **AC6** — L'onglet actif (Rendez-vous / Patients) est mémorisé en `sessionStorage` et restauré au rechargement
- [ ] **AC7** — `GET /api/admin/patients` retourne la liste agrégée des patients (exclut soft-deleted), protégée par auth admin
- [ ] **AC8** — L'endpoint supporte un query param `?includeArchived=true` pour inclure les patients inactifs
- [ ] **AC9** — La page reste accessible et fonctionnelle si l'endpoint retourne une liste vide

## Breadboard

| Surface | Action | Handler | Data |
|---------|--------|---------|------|
| `mes-rdvs.astro` | Afficher onglets | SSR + `<PatientList client:load>` | Onglet actif via `sessionStorage` |
| `PatientList` island | Mount | `fetch GET /api/admin/patients` | `Patient[]` |
| `PatientList` | Toggle "Inactifs" | Client state | Re-fetch avec `?includeArchived=true` |
| `PatientList` | Clic sur une ligne | Inline expand (accordéon) | `patient.appointments: Appointment[]` |
| `PatientDetail` inline | Clic "Proposer un RDV" | `setOpen(true)` + pré-remplir | `{ name, email, phone, lastType }` |
| `AdminCreateButton` | Reçoit `prefillData` prop | State init avec les valeurs | Formulaire pré-rempli |
| `GET /api/admin/patients` | Auth guard | `isAdminSession()` | 401/403 si non admin |

## Data Model

```typescript
// src/types/patient.ts
interface Patient {
  email: string;            // clé d'agrégation
  name: string;             // nom du dernier RDV connu
  phone: string;
  sessionCount: number;     // COUNT hors soft-deleted
  lastAppointmentAt: string; // ISO string du dernier scheduled_at
  lastAppointmentType: AppointmentType; // pour pré-remplissage
  lastAppointmentMode: AppointmentMode;
  isActive: boolean;        // lastAppointmentAt > now - 3 mois
  appointments: AppointmentSummary[]; // historique complet
}

interface AppointmentSummary {
  id: string;
  scheduledAt: string;
  appointmentType: AppointmentType;
  appointmentMode: AppointmentMode;
  status: AppointmentStatus;
  finalPrice: number;       // centimes
  duration: number;
}
```

**SQL côté API :**
```sql
SELECT
  patient_email,
  -- Prendre les données du RDV le plus récent
  (array_agg(patient_name ORDER BY scheduled_at DESC))[1]  AS name,
  (array_agg(patient_phone ORDER BY scheduled_at DESC))[1] AS phone,
  COUNT(*) AS session_count,
  MAX(scheduled_at)  AS last_appointment_at,
  (array_agg(appointment_type ORDER BY scheduled_at DESC))[1] AS last_type,
  (array_agg(appointment_mode ORDER BY scheduled_at DESC))[1] AS last_mode,
  -- Historique complet
  json_agg(json_build_object(
    'id', id, 'scheduledAt', scheduled_at,
    'appointmentType', appointment_type, 'appointmentMode', appointment_mode,
    'status', status, 'finalPrice', final_price, 'duration', duration
  ) ORDER BY scheduled_at DESC) AS appointments
FROM appointments
WHERE deleted_at IS NULL
GROUP BY patient_email
ORDER BY name ASC  -- alphabétique
```

## Slices

**Slice 1 — Types + API** : Créer `src/types/patient.ts` + `src/pages/api/admin/patients.ts` (GET endpoint avec agrégation SQL + auth guard + param `includeArchived`).

**Slice 2 — PatientList island** : Créer `src/components/admin/PatientList.tsx` — liste patients, toggle archivés, accordéon inline par patient. Island autonome, mount déclenche le fetch.

**Slice 3 — AdminCreateButton prefill** : Modifier `src/components/admin/AdminCreateButton.tsx` — ajouter prop optionnelle `prefillData?: PrefillData`, initialiser le FormState avec ces valeurs si fournies.

**Slice 4 — Intégration mes-rdvs** : Modifier `src/pages/mes-rdvs.astro` — ajouter navigation onglets (HTML statique + script sessionStorage), monter `<PatientList client:load>` dans l'onglet Patients.

## Out of Scope

- Table `patients` dédiée en base
- Modification du schéma SQL (pas de migration)
- Messagerie / notes patient
- Export CSV de la liste patients
- Pagination (volume < 200 patients, tout en mémoire)
- Recherche full-text dans la fiche patient

## Open Questions

- *(aucune)*
