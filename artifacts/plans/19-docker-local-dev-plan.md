---
issue: 19
tier: F-lite
spec: artifacts/specs/19-docker-local-dev-spec.md
status: approved
---

## Tasks

| ID | Description | Agent | Fichiers | Dépendances | Parallèle ? |
|----|-------------|-------|----------|-------------|-------------|
| T1 | Créer `docker-compose.yml` avec services `postgres:16` et `mailpit` | devops | `docker-compose.yml` | — | Y |
| T2 | Ajouter fallback SMTP nodemailer dans `resend.ts` (quand `SMTP_HOST` défini) | backend-dev | `src/lib/resend.ts`, `package.json` (+nodemailer +@types/nodemailer) | — | Y |
| T3 | Ajouter mode mock Google Calendar (quand `GOOGLE_CALENDAR_MOCK=true`) | backend-dev | `src/lib/google-calendar.ts` | — | Y |
| T4 | Créer `.env.local.example` avec toutes les valeurs locales prêtes à copier | devops | `.env.local.example` | T1, T2, T3 | N |
| T5 | Créer `docs/DEV.md` (guide démarrage < 5 commandes + Stripe CLI) | devops | `docs/DEV.md` | T1, T4 | N |
| T6 | Ajouter script `db:reset` dans `package.json` | devops | `package.json` | T1 | N |

## Agent Slices

**backend-dev:** T2, T3
**devops:** T1, T4, T5, T6

## Détail des tâches

### T1 — docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: omf_therapie
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./supabase/migrations/001_init.sql:/docker-entrypoint-initdb.d/001_init.sql:ro

  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # Web UI
```

### T2 — Fallback SMTP dans resend.ts

Quand `SMTP_HOST` est présent dans l'env, instancier un transport `nodemailer` SMTP au lieu du client Resend. `renderAsync` de `@react-email/components` génère le HTML. Si `SMTP_HOST` absent → comportement Resend inchangé.

```typescript
import nodemailer from 'nodemailer';
import { render } from '@react-email/components';

const smtpHost = import.meta.env.SMTP_HOST;
if (smtpHost) {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(import.meta.env.SMTP_PORT ?? 1025),
    secure: false,
  });
  // utiliser transporter.sendMail(...)
}
```

### T3 — Mock Google Calendar

```typescript
const MOCK_MODE = import.meta.env.GOOGLE_CALENDAR_MOCK === 'true';

// getAvailableSlots() : si MOCK_MODE → générer les N prochains mercredis
//   avec créneaux 09:00-12:00 et 14:00-18:00 (slots de 1h)
// createCalendarEvent() : si MOCK_MODE → console.log + retourne un ID factice
```

### T4 — .env.local.example

Variables locales prêtes à copier (DB, SMTP, Stripe test keys, mock Calendar, BetterAuth local).

### T5 — docs/DEV.md

```markdown
# Développement local

## Prérequis
- Docker + Docker Compose
- Stripe CLI (brew install stripe/stripe-cli/stripe)

## Démarrage
1. cp .env.local.example .env
2. docker compose up -d
3. npm run db:reset
4. npm run dev
5. stripe listen --forward-to localhost:4321/api/stripe-webhook
```

### T6 — script db:reset

```json
"db:reset": "docker compose exec postgres psql -U postgres -d omf_therapie -f /docker-entrypoint-initdb.d/001_init.sql"
```

## Quality Gate

```bash
npm run lint && npm run build
```

## Séquence

1. T1 + T2 + T3 (parallèles — indépendants)
2. T4 (dépend de T1+T2+T3 pour lister toutes les vars)
3. T5 + T6 (finalisent la documentation et les scripts)
