# Project Brief

## What it is

- A French therapy-practice website for Oriane Montabonnet. It combines marketing content with an online appointment flow and a practitioner-only dashboard.

## Why it exists

- Help prospective patients understand services and request an appointment while giving the practitioner a secure, manageable workflow.

## Domain language

| Term | Meaning |
| --- | --- |
| Appointment | A patient request progressing from `pending` to an outcome. |
| Video appointment | A remote session that requires online payment before it is treated as paid. |
| Internal credit | An admin-managed credit issued when a paid video appointment is cancelled; it is not a Stripe refund. |
| `payment_received` | The unified paid state, whether payment came from Stripe or an internal credit. |
| `reschedule_paid` | An admin action that moves a paid video appointment without charging again. |

## Key features

- Static, French-language service and blog pages.
- Appointment booking, availability, notifications, payment, and patient action links.
- Protected, single-practitioner administration of appointments, manual slots, and credits.
