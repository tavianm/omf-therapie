# Forms

## Approach

- React islands manage interactive form state with hooks; the booking wizard delegates server validation to the appointment API.
- The contact form uses EmailJS; booking uses server-side integrations.

## Conventions

- User-facing validation and error messages are French.
- Validate on the server for patient data and return structured JSON errors.
- Never expose server libraries or secret-bearing configuration to client islands.
