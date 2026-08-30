# Navigation

## Routing

- Astro file-based routes define public and API URLs; there is no client-side router.
- The practitioner dashboard is protected by Better Auth; public patient pages remain server-rendered.

## Structure

```mermaid
flowchart LR
    Home[Home and services] --> Booking[Appointment booking]
    Home --> Blog[Blog]
    Home --> Contact[Contact]
    Login[Practitioner login] --> Admin[Appointments dashboard]
```
