# Ubiquitous Language

> Domain glossary for omf-therapie. Terms used consistently across code, types, UI, emails, and docs. French terms are the canonical user-facing form; the English column is for code/types.

| Term (FR / user-facing) | Code term | Definition |
|------------------------|-----------|------------|
| Rendez-vous (RDV) | `Appointment` | A scheduled session between practitioner and patient. |
| Séance | `Appointment` (instance) | A therapy session (individual, couple, family, or TCA-focused). |
| Téléconsultation | `appointment_mode = 'video'` | Video session via Google Meet. Triggers Stripe prepayment. |
| Présentiel | `appointment_mode = 'in-person'` | On-site session. Paid on site (cash/card). |
| Patient | `Patient` | The person booking. Identified by email + phone. No patient account (admin-only management). |
| Thérapeute / Praticienne | `Admin` (session) | The single practitioner (Oriane Montabonnet). Auth is monocompte — one account. |
| Créneau | `Slot` / `scheduled_at` | A bookable time window. Sourced from Google Calendar or manual overrides. |
| Plage horaire | `ManualSlot` | A manually-defined available slot (`src/lib/manual-slots.ts`). |
| Statut | `AppointmentStatus` | Lifecycle state of an RDV (see state machine in `patterns.md`). |
| En attente | `pending` | Initial state after patient books; awaiting practitioner action. |
| Confirmé | `confirmed` | Practitioner confirmed (présentiel, or video after payment). |
| Refusé | `declined` | Practitioner declined the request. |
| Reporté | `rescheduled` | Practitioner proposed a new slot; patient must accept at `/rdv/accepter-report/[id]/`. |
| En attente de paiement | `payment_pending` | Video RDV awaiting Stripe payment (link sent). |
| Réglé | `payment_received` | **Unified status:** paid via Stripe **or** internal avoir. Replaces `confirmed` for paid video RDVs. |
| Annulé | `cancelled` | Practitioner cancelled. If the RDV was `payment_received`, an avoir is emitted. |
| Avoir | `Credit` | Internal credit issued on cancellation of a paid RDV. Stored in `credits` table, consumed FIFO via `consume_credits` RPC. **No real Stripe refund.** |
| Restitution d'avoir | `restore_credits` RPC | Re-credits an avoir when an RDV created with that avoir is itself cancelled. |
| Tarif de base | `basePrice` | Standard session price (e.g. 50€ for 60min individual). |
| Remise nouveau client | `override_first_session` | −15€ discount for first session. Mutually exclusive with solidarity. |
| Tarif solidaire | `is_solidarity` | −20€ reduced rate. Mutually exclusive with first-session discount. |
| Prix final | `finalPrice` | Price after discounts and avoir deduction. Stored ×100 (centimes) in DB. |
| Lien sécurisé | `SecureLink` / `secure-links.ts` | Signed token URL for patient actions (accept reschedule, view invite). |
| Lien de paiement | `Stripe Payment Link` | Stripe-hosted payment URL generated for video RDVs. |
| Wizard de prise de RDV | `/rendez-vous/` | Multi-step patient booking flow (type → mode → duration → slot → info → confirm). |
| Espace admin | `/mes-rdvs/` | Practitioner dashboard (BetterAuth-gated). Compact list via `<AppointmentsManager>` island. |
| Tableau de bord | `/mes-rdvs/` | Synonym for the admin dashboard. |
| Content Collection | `defineCollection` | Astro's typed content schema (blog posts in `src/content/blog/`). |
| Île (island) | `client:*` directive | A React component hydrated client-side within an Astro page. |

## Status flow (canonical)

```
pending → confirmed | declined | rescheduled
pending → payment_pending → payment_received
payment_received → cancelled (+ avoir)
confirmed → cancelled
rescheduled → (patient accepts) → confirmed | payment_pending
```

See `docs/architecture/patterns.md` § "Status state machine" for the full graph.
