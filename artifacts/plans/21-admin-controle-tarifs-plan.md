---
issue: 21
tier: F-lite
spec: artifacts/specs/21-admin-controle-tarifs-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|-------------|----------|
| T1 | Ajouter `SOLIDARITY_DISCOUNT=10` et mettre à jour `calculatePrice(type, duration, isFirstSession, isSolidarity?)` — remises mutuellement exclusives | backend-dev | `src/lib/pricing.ts` | — | Y |
| T2 | API confirm : parser `override_first_session` + `is_solidarity`, recalculer `discount`/`final_price`, passer le nouveau montant à Stripe | backend-dev | `src/pages/api/appointments/[id].ts` | T1 | N |
| T3 | AppointmentCard : section "Tarification" dans la modale Confirmer — 2 toggles radio, prix recalculé live, payload enrichi | frontend-dev | `src/components/admin/AppointmentCard.tsx` | T1 | N |
| T4 | BookingWizard : message d'aide solidaire discret sous le champ Motif | frontend-dev | `src/components/booking/BookingWizard.tsx` | — | Y |

## Agent Slices

**backend-dev:** T1, T2
**frontend-dev:** T3, T4

## Sequence

1. **T1** — `pricing.ts` : base partagée par tous les autres
2. **T2** — API `[id].ts` : logique serveur (dépend T1)
3. **T3** — `AppointmentCard.tsx` : UI confirm modal (dépend T1)
4. **T4** — `BookingWizard.tsx` : hint patient (indépendant, parallèle avec T3)

## Notes d'implémentation

### T1 — pricing.ts
```typescript
export const SOLIDARITY_DISCOUNT = 10; // €

export function calculatePrice(
  type: AppointmentType,
  duration: AppointmentDuration,
  isFirstSession: boolean,
  isSolidarity = false,
): PricingResult {
  const basePrice = PRICE_GRID[type][duration];
  // Remises mutuellement exclusives : solidaire prioritaire sur nouveau client
  const discount = isSolidarity
    ? SOLIDARITY_DISCOUNT
    : isFirstSession ? FIRST_SESSION_DISCOUNT : 0;
  const finalPrice = basePrice - discount;
  const label = isSolidarity
    ? `${finalPrice}€ (–${discount}€ tarif solidaire)`
    : discount > 0 ? `${finalPrice}€ (–${discount}€ première séance)` : `${finalPrice}€`;
  return { basePrice, discount, finalPrice, label };
}
```

### T2 — API [id].ts confirm
- Extraire `override_first_session?: boolean`, `is_solidarity?: boolean` du body
- Si l'un ou l'autre est fourni : `const pricing = calculatePrice(type, duration, override_first_session ?? appt.is_first_session, is_solidarity ?? false)`
- `updateData.discount = pricing.discount * 100` (centimes)
- `updateData.final_price = pricing.finalPrice * 100` (centimes)
- Passer `amount: updateData.final_price ?? appointment.final_price` à `createAppointmentPaymentLink`

### T3 — AppointmentCard confirm modal
- Nouveaux états : `overrideFirstSession` (init: `appointment.is_first_session`), `isSolidarity` (init: false)
- `livePrice = calculatePrice(type, duration, overrideFirstSession, isSolidarity)`
- Affichage : "Tarif de base : Xé | Remise : -Xé | **À régler : Xé**"
- Toggles radio mutuellement exclusifs (click l'un → désactive l'autre)
- Payload handleConfirm : `{ ..., override_first_session: overrideFirstSession, is_solidarity: isSolidarity }`

### T4 — BookingWizard hint
Après le compteur de caractères du motif :
```tsx
<p className="mt-2 text-xs text-sage-400 leading-relaxed">
  💬 Si vous traversez une période financière difficile (RSA, études, chômage…),
  n'hésitez pas à le mentionner ici — un tarif adapté peut être proposé.
</p>
```

## Quality Gate

```bash
npm run lint && npm run build
```
