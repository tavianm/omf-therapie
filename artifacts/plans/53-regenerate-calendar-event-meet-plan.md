---
issue: 53
tier: F-lite
spec: artifacts/specs/53-regenerate-calendar-event-meet-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Créer l'endpoint `POST /api/admin/appointments/[id]/regenerate-calendar` | backend-dev | `src/pages/api/admin/appointments/[id]/regenerate-calendar.ts` (new) | — | N/A |
| T2 | Ajouter bouton + handler dans `AppointmentCard` | frontend-dev | `src/components/admin/AppointmentCard.tsx` | T1 | N |

## Budget

### Per task

| Task | Subject | Class | Est. ops |
|------|---------|-------|----------|
| T1 | calendar-api | bounded | ~4 |
| T2 | admin-ui | bounded | ~5 |

### Per agent instance

| Instance | Tasks | Subjects | Est. ops | Action |
|----------|-------|----------|----------|--------|
| backend-dev | T1 | calendar-api | ~4 | — |
| frontend-dev | T2 | admin-ui | ~5 | — |

## Agent Slices

**backend-dev — T1:**
Créer `src/pages/api/admin/appointments/[id]/regenerate-calendar.ts` avec :
- `export const prerender = false`
- Guard `isAdminSession` (pattern identique à `admin/appointments/index.ts`)
- `GET` du RDV par `id` via `supabaseAdmin` → 404 si absent
- Vérification `appointment_mode === 'video'` → 400 sinon
- Appel `createCalendarEvent({ title, start, end, description, location: 'Téléconsultation', attendeeEmail: appointment.patient_email, withMeet: true, appointmentId: \`${id}-regen\`, colorId: '11' })`
- `supabaseAdmin.from('appointments').update({ google_calendar_event_id, video_link }).eq('id', id)`
- Catch `CalendarAuthError` → 503 `{ error: 'oauth_required', message: '...' }`
- Catch autres erreurs → 500
- Réponse succès : `{ google_calendar_event_id, video_link }`

**frontend-dev — T2:**
Dans `src/components/admin/AppointmentCard.tsx` :
- Ajouter state `const [calendarRegenerating, setCalendarRegenerating] = useState(false)`
- Ajouter state local pour `calendarEventId` et `meetLink` (initialisés depuis `appointment`) pour masquer le bouton après succès sans rerender parent
- Condition d'affichage : `appointment.appointment_mode === 'video' && (!meetLink || !calendarEventId)`
- Handler `handleRegenerateCalendar` : POST `/api/admin/appointments/${appointment.id}/regenerate-calendar`, spinner, toast.success / toast.error
- En cas de succès : mettre à jour les states locaux `calendarEventId` et `meetLink`
- En cas d'erreur 503 (oauth_required) : toast.error avec message "Reconnectez Google Calendar via le tableau de bord"
- Bouton placé dans la section actions existantes (en bas de la carte), visible uniquement dans les statuts non-terminaux (pas `declined`/`cancelled`)
- Utiliser `react-hot-toast` (déjà importé via `AppointmentCard`)

## Quality Gate

```bash
npm run lint
```

## Sequence

1. T1 — endpoint backend (backend-dev)
2. T2 — UI frontend (frontend-dev, aprs T1)
