---
issue: 22
tier: F-lite
spec: artifacts/specs/22-admin-creation-manuelle-rdv-spec.md
status: implemented
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Nouvel endpoint admin `POST /api/admin/appointments/` : auth, validation légère, INSERT, emails | backend-dev | `src/pages/api/admin/appointments/index.ts` | — | N |
| T2 | Composant `AdminCreateModal.tsx` : formulaire complet, prix live, toggle email, appel API | frontend-dev | `src/components/admin/AdminCreateModal.tsx` | T1 | N |
| T3 | Dashboard `mes-rdvs.astro` : bouton "Nouveau rendez-vous" + intégration island AdminCreateModal | frontend-dev | `src/pages/mes-rdvs.astro` | T2 | N |

## Agent Slices

**backend-dev:** T1
**frontend-dev:** T2, T3

## Sequence

1. **T1** — endpoint API admin (logique métier complète)
2. **T2** — composant modal React (dépend T1 pour le contrat d'API)
3. **T3** — intégration dans le dashboard (dépend T2)

## Notes d'implémentation

### T1 — `src/pages/api/admin/appointments/index.ts`
```typescript
export const prerender = false;
// Auth guard : BetterAuth session requise
// Pas de rate limit, pas de validation mercredi/horaires
// calculatePrice(type, duration, is_first_session)
// INSERT appointments : status = 'confirmed' (in-person) | 'payment_pending' (video)
// Si video + send_email : createAppointmentPaymentLink + sendEmail(PaymentRequest)
// Si in-person + send_email : générer ics + sendEmail(AppointmentConfirmed)
// Retour : { appointment: Appointment }
```

Champs requis dans le body :
```typescript
interface AdminCreatePayload {
  patient_name: string;       // 2-100 chars
  patient_email: string;      // email valide
  patient_phone: string;      // téléphone français
  patient_postal_code: string; // 5 chiffres
  patient_city: string;
  patient_reason: string;     // 10+ chars
  appointment_type: 'individual' | 'couple' | 'family';
  appointment_mode: 'in-person' | 'video';
  duration: 60 | 90;
  scheduled_at: string;       // ISO 8601, date future
  is_first_session: boolean;
  send_email: boolean;        // défaut: true
  video_link?: string;        // pour présentiel optionnel
}
```

### T2 — `AdminCreateModal.tsx`
- Props : `{ onClose: () => void; onSuccess: () => void }`
- État local : `CreateAppointmentForm` (tous les champs)
- Prix calculé live : `useMemo(() => calculatePrice(type, duration, isFirstSession), [...])`
- Validation côté client avant submit (mêmes règles que l'API)
- Toggle "Envoyer un email au patient" (checked par défaut)
- Loading state pendant submit
- Affichage erreurs API

### T3 — `mes-rdvs.astro`
- Ajouter `import AdminCreateModal from '../components/admin/AdminCreateModal';`
- Bouton dans le header existant du dashboard
- `<AdminCreateModal client:load onSuccess={() => window.location.reload()} />` (géré via state island)
- Pattern : état `showModal` géré dans l'island, bouton trigger via `data-modal="create"` ou composant wrapper

## Quality Gate

```bash
npm run lint && npm run build
```
