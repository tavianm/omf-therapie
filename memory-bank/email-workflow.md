# Email Workflow — Système de Prise de Rendez-vous

## Overview

All transactional emails use **Resend** in production and **Nodemailer → Mailpit** locally (set `SMTP_HOST=localhost`).
The unified `sendEmail()` function in `src/lib/resend.ts` auto-selects the transport.

Email threading (RFC 2822 `In-Reply-To` / `References`) groups all emails for a given appointment into a single conversation thread in the patient's email client. Thread state is persisted in the `email_threads` Supabase table.

---

## 8 Email Templates

| # | Template | Trigger | Recipient(s) | Thread key |
|---|----------|---------|--------------|------------|
| 1 | `AppointmentRequestReceived` | Patient submits booking wizard | Patient | `appointment:{id}:patient` |
| 2 | `AppointmentRequestNotification` | Patient submits booking wizard | Admin (no thread) | — |
| 3 | `AppointmentConfirmed` | Admin confirms (in-person or video post-payment) | Patient | `appointment:{id}:patient` |
| 4 | `AppointmentDeclined` | Admin declines | Patient | `appointment:{id}:patient` |
| 5 | `AppointmentRescheduled` | Admin proposes new slot | Patient | `appointment:{id}:patient` |
| 6 | `PaymentRequest` | Admin confirms a video appointment (→ payment_pending) | Patient | `appointment:{id}:patient` |
| 7 | `ReviewRequest` | Admin clicks "Envoyer avis" in dashboard | Patient | — |
| 8 | `AppointmentReminder` | Netlify cron J-1 (daily 08:00 UTC) | Patient (no thread) | — |

Template files: `src/emails/*.tsx`

---

## Flow Diagrams

### Patient booking flow

```
Patient fills /rendez-vous wizard
        │
        ▼
POST /api/appointments                      ← validation + anti-doublon
        │
        ├─ Insert into DB (status: pending)
        │
        └─ await Promise.allSettled([
              sendEmail → [1] AppointmentRequestReceived   → patient
              sendEmail → [2] AppointmentRequestNotification → admin
           ])
        │
        ▼
201 Created → Patient sees /rdv/merci page
```

### Admin confirm flow

```
Admin clicks "Confirmer" in /mes-rdvs
        │
        ▼
PATCH /api/appointments/:id  { action: 'confirm' }
        │
        ├─ Recalculate price if override
        ├─ [video] Generate Stripe Payment Link → status: payment_pending
        ├─ [video, already paid] Generate Google Meet link → status: confirmed
        ├─ [in-person] status: confirmed
        ├─ [in-person] Create Google Calendar event
        │
        ├─ if status == payment_pending:
        │      await sendEmail → [6] PaymentRequest → patient
        │
        └─ if status == confirmed:
               await sendEmail → [3] AppointmentConfirmed → patient (+ ICS links)
        │
        ▼
200 OK → Admin dashboard refreshes
```

### Admin decline flow

```
PATCH /api/appointments/:id  { action: 'decline' }
        │
        ├─ Update status: declined
        └─ await sendEmail → [4] AppointmentDeclined → patient
        │
        ▼
200 OK
```

### Admin reschedule flow

```
PATCH /api/appointments/:id  { action: 'reschedule', rescheduled_to: ISO }
        │
        ├─ Expire existing Stripe Payment Link
        ├─ Update status: rescheduled, rescheduled_to: new date
        └─ await sendEmail → [5] AppointmentRescheduled → patient (with signed acceptUrl)
        │
        ▼
200 OK
```

### Patient accept-reschedule flow

```
Patient clicks acceptUrl in email → /rdv/accepter-report?id=...&token=...
        │
        ▼
PATCH /api/appointments/:id  { action: 'accept_reschedule', token }
        │
        ├─ Verify signed token (createSecureLinkToken / verifySecureLinkToken)
        ├─ scheduled_at ← rescheduled_to
        ├─ [video] Generate new Stripe Payment Link → status: payment_pending
        ├─ [in-person] → status: confirmed
        ├─ [in-person] Create Google Calendar event
        │
        ├─ if payment_pending:
        │      await sendEmail → [6] PaymentRequest → patient
        └─ if confirmed:
               await sendEmail → [3] AppointmentConfirmed → patient
        │
        ▼
200 OK → Page shows confirmation
```

### Stripe webhook flow (video payment received)

```
Stripe → POST /api/stripe-webhook  (checkout.session.completed)
        │
        ├─ Verify webhook signature
        ├─ Update status: payment_received, stripe_payment_intent_id
        ├─ Generate Google Meet link
        └─ await Promise.allSettled([
              sendEmail → [3] AppointmentConfirmed → patient
              sendEmail → [2] AppointmentRequestNotification → admin (payment received)
           ])
        │
        ▼
200 OK
```

### Reminder cron (J-1)

```
Netlify cron: 0 8 * * *  (08:00 UTC daily)
        │
        ▼
netlify/functions/send-reminders.ts
        │
        ├─ Query appointments: scheduled_at in [tomorrow Paris start, tomorrow Paris end]
        │                       status IN (confirmed, payment_received)
        │                       reminder_sent_at IS NULL
        │
        └─ for each appointment:
               resend.emails.send → [8] AppointmentReminder → patient
               if ok: update reminder_sent_at = now()
```

### Review request (admin-triggered)

```
Admin clicks "Envoyer avis" in /mes-rdvs
        │
        ▼
POST /api/send-review-email  { appointmentId }
        │
        └─ await sendEmail → [7] ReviewRequest → patient
        │
        ▼
200 OK
```

---

## Email Threading

All patient emails for a given appointment share the same `threadKey: 'appointment:{id}:patient'`.

The `sendEmail()` function:
1. Loads thread state from `email_threads` table (`thread_key`, `root_message_id`, `last_message_id`, `thread_references`)
2. Adds `In-Reply-To` and `References` headers if thread exists
3. After successful send: upserts thread state with the new `message_id` from Resend

**Database table:** `email_threads` (migration `002_email_threads.sql`, column renamed in `003_email_threads_references_column.sql`)

**Subject prefix:** `[RDV XXXX] ` where XXXX = first segment of appointment UUID (uppercase). Applied via `buildAppointmentConversationSubject()`.

---

## Key Implementation Notes

### Serverless compatibility
All `sendEmail()` calls **must be awaited** before returning the HTTP response. Fire-and-forget emails in Netlify serverless functions cause `SocketError: other side closed (UND_ERR_SOCKET)` because the function terminates while Supabase thread persistence is still in-flight.

- Use `await Promise.allSettled([...])` for parallel sends (booking creation, Stripe webhook)
- Use `await sendEmail(...)` for single sends (confirm, decline, reschedule)

### Local development
1. Start Mailpit: `docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`
2. Set `SMTP_HOST=localhost` (and optionally `SMTP_PORT=1025`) in `.env`
3. All emails are intercepted at `http://localhost:8025`
4. Supabase thread persistence still works locally if `SUPABASE_DATABASE_URL` is configured

### Admin BCC
Every outgoing email automatically adds the `ADMIN_EMAIL` as BCC, unless admin is already in To or explicit BCC. Implemented in `sendEmail()` in `src/lib/resend.ts`.

### Error handling
`sendEmail()` never throws — all errors are caught internally and returned as `{ success: false, error: string }`. The Resend path retries up to 3× on 5xx / network errors with exponential backoff (300ms × attempt).
