# Développement local

Ce guide vous permet de faire tourner l'intégralité du projet en local, sans aucun service externe payant.

## Prérequis

- **Docker + Docker Compose** — [docker.com](https://docs.docker.com/get-docker/)
- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **Stripe CLI** (pour tester les paiements) :
  ```bash
  # macOS
  brew install stripe/stripe-cli/stripe
  # Linux
  curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg
  echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee /etc/apt/sources.list.d/stripe.list
  sudo apt update && sudo apt install stripe
  ```

## Démarrage (5 commandes)

```bash
# 1. Configurer les variables d'environnement
cp .env.local.example .env

# 2. Démarrer PostgreSQL + Mailpit
docker compose up -d

# 3. Initialiser la base de données (première fois seulement)
npm run db:reset

# 4. Lancer le serveur de développement Astro
npm run dev

# 5. [Onglet séparé] Forwarder les webhooks Stripe (si test paiement)
stripe listen --forward-to localhost:4321/api/stripe-webhook
```

Le site est accessible sur **http://localhost:4321**

## Services locaux

| Service | URL | Description |
|---------|-----|-------------|
| Application | http://localhost:4321 | Site Astro en mode dev |
| Mailpit (emails) | http://localhost:8025 | Boîte de réception locale — tous les emails envoyés apparaissent ici |
| PostgreSQL | localhost:5432 | Base de données (`omf_therapie`, user: `postgres`, password: `postgres`) |

## Créer le compte thérapeute

Après le premier démarrage :

```bash
BETTER_AUTH_URL=http://localhost:4321 \
ADMIN_EMAIL=admin@localhost.dev \
ADMIN_PASSWORD=DevPassword!LocalOnly123 \
npx tsx scripts/seed-admin.ts
```

Accédez ensuite à **http://localhost:4321/login** avec ces identifiants.

## Tester les paiements Stripe

### Mode mock (par défaut)

Avec `STRIPE_SECRET_KEY=sk_test_placeholder` dans `.env`, le **mode Stripe mock** est actif :
- La confirmation admin d'une téléconsultation → statut `payment_pending`
- L'email de demande de paiement est envoyé dans Mailpit avec un lien fictif (`/rdv/merci?mock=1&...`)
- Aucun appel réseau vers Stripe — idéal pour tester le flux complet admin

### Mode réel (clés de test Stripe)

Pour tester le vrai tunnel de paiement :
1. Récupérer vos clés de test sur [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys)
2. Les renseigner dans `.env` : `STRIPE_SECRET_KEY=sk_test_...` et `STRIPE_PUBLISHABLE_KEY=pk_test_...`
3. Lancer le webhook forwarder :
   ```bash
   stripe listen --forward-to localhost:4321/api/stripe-webhook
   ```
4. Copier le `whsec_...` affiché → mettre à jour `STRIPE_WEBHOOK_SECRET` dans `.env`
5. Utiliser la carte test **4242 4242 4242 4242** (date future, CVC quelconque)

## Emails locaux (Mailpit)

Tous les emails transactionnels (confirmation, rappel, lien de paiement) sont capturés par **Mailpit** au lieu d'être envoyés réellement.

Ouvrir **http://localhost:8025** pour consulter la boîte de réception.

## Créneaux Google Calendar (mode mock)

Le fichier `.env.local.example` active `GOOGLE_CALENDAR_MOCK=true`. Dans ce mode :
- La page de prise de rendez-vous affiche des créneaux factices (prochains mercredis, 09h-12h et 14h-18h)
- La création d'événements est simulée (log console, ID factice)
- Aucun appel réseau vers l'API Google

Pour tester avec un vrai Google Calendar, désactiver le mock :
```bash
GOOGLE_CALENDAR_MOCK=false
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
GOOGLE_CALENDAR_ID=...
```

## Commandes utiles

```bash
npm run db:start    # Démarrer uniquement PostgreSQL + Mailpit
npm run db:stop     # Arrêter les conteneurs
npm run db:reset    # Réinitialiser la DB (rejoue 001_init.sql)
npm run dev         # Démarrer Astro dev server
npm run build       # Build de production
npm run lint        # Vérifier le code
```

## Structure des services Docker

```
docker-compose.yml
  ├── postgres:16-alpine      → port 5432 (BetterAuth + schéma appointments)
  │   └── init: supabase/migrations/001_init.sql
  ├── postgrest               → port 3000 (API REST directe, debug uniquement)
  ├── nginx (supabase-rest)   → port 3001 /rest/v1/ → PostgREST (simule Supabase)
  └── axllent/mailpit         → port 1025 (SMTP) + 8025 (UI emails)
```

> **Pourquoi nginx ?** Le SDK `@supabase/supabase-js` envoie ses requêtes à `SUPABASE_URL/rest/v1/` — nginx relaie vers PostgREST pour simuler l'API Supabase.

## Architecture locale vs production

| Composant | Local | Production |
|-----------|-------|-----------|
| Base de données | PostgreSQL Docker | Supabase (PostgreSQL) |
| API REST DB | PostgREST + nginx (port 3001) | Supabase REST API |
| Emails | Mailpit (SMTP local) | Resend (API) |
| Paiements | Stripe mock (lien fictif) | Stripe live |
| Calendrier | Mock (créneaux factices) | Google Calendar API |
| Hébergement | `astro dev` | Netlify |
| API routes | `astro dev` (natif) | Netlify Functions |
| Cron rappels J-1 | Manuel (`npx tsx netlify/functions/send-reminders.ts`) | Netlify Scheduled Functions |

> **Stripe mock** : avec `STRIPE_SECRET_KEY=sk_test_placeholder`, la confirmation d'une téléconsultation crée un lien de paiement fictif (pas d'appel Stripe réel). Utile pour tester le flux admin complet sans clé Stripe valide.

## Résolution de problèmes

**Port 5432 déjà utilisé :**
```bash
# Vérifier quel processus l'utilise
lsof -i :5432
# Ou changer le port dans docker-compose.yml : "5433:5432"
# Et adapter DATABASE_URL dans .env : ...@localhost:5433/...
```

**Erreur `BETTER_AUTH_SECRET` :**
```bash
openssl rand -base64 32   # Générer un nouveau secret
```

**DB vide après redémarrage :**
Les données persistent dans le volume Docker `postgres_data`. Pour tout réinitialiser :
```bash
docker compose down -v    # Supprime les volumes
docker compose up -d
npm run db:reset
```
