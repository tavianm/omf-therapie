# Développement local — OMF Thérapie

Guide complet pour démarrer, développer et tester le projet en local avec Docker.

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | 20+ |
| Docker + Docker Compose | 24+ |
| Git | 2.x |

---

## Vue d'ensemble de la stack locale

```
┌─────────────────────────────────────────────────────────────────┐
│  Navigateur / Playwright                                         │
│       │  http://localhost:4321                                   │
├───────▼──────────────────────────────────────────────────────── │
│  Astro dev server  (npm run dev -- --port 4321)                  │
│  · SSG / SSR (Netlify adapter)                                   │
│  · API routes  /api/**                                           │
│  · BetterAuth  /api/auth/**  ──────────────────┐                │
├───────────────────────────────────────────────▼──────────────── │
│  PostgreSQL 16         postgresql://localhost:5432/omf_therapie  │
│  PostgREST             http://localhost:3000  (API REST directe) │
│  nginx (supabase-rest) http://localhost:3001  /rest/v1/ → PGRST  │
│  Mailpit               http://localhost:8025  (web UI emails)    │
│                        smtp://localhost:1025                     │
└─────────────────────────────────────────────────────────────────┘
```

### Pourquoi ce setup ?

- **PostgREST + nginx** simule l'API Supabase : le SDK `@supabase/supabase-js` envoie ses requêtes à `SUPABASE_DATABASE_URL/rest/v1/` — nginx relaie vers PostgREST.
- **Mailpit** capture tous les emails sortants (Resend remplacé par nodemailer/SMTP local) — aucun mail n'est envoyé à de vrais destinataires.
- **Google Calendar mock** : `GOOGLE_CALENDAR_MOCK=true` génère des créneaux fictifs les mercredis, sans appel à l'API Google.

---

## 1. Démarrer l'infrastructure Docker

Le `docker-compose.yml` est à la **racine du projet**.

```bash
# Depuis la racine du projet
docker compose up -d

# Vérifier que tout est healthy
docker compose ps
```

Résultat attendu :

```
NAME                                      STATUS
15-prise-de-rendez-vous-postgres-1        Up (healthy)
15-prise-de-rendez-vous-postgrest-1       Up
15-prise-de-rendez-vous-supabase-rest-1   Up
15-prise-de-rendez-vous-mailpit-1         Up (healthy)
```

### Ports exposés

| Service | Port | Usage |
|---------|------|-------|
| PostgreSQL | `5432` | Connexion directe BetterAuth / scripts |
| PostgREST | `3000` | API REST directe (debug) |
| nginx / Supabase REST | `3001` | `SUPABASE_DATABASE_URL` dans `.env` |
| Mailpit SMTP | `1025` | Envoi d'emails depuis l'app |
| Mailpit Web UI | `8025` | Lire les emails capturés |

### Commandes utiles

```bash
# Arrêter sans supprimer les données
docker compose stop

# Tout supprimer (volumes inclus — repart de zéro)
docker compose down -v

# Voir les logs d'un service
docker compose logs -f postgres
docker compose logs -f postgrest

# Accéder à la base de données directement
docker exec -it 15-prise-de-rendez-vous-postgres-1 psql -U postgres -d omf_therapie

# Réinitialiser le schéma (drop + re-apply migrations)
npm run db:reset
```

---

## 2. Configurer les variables d'environnement

Créer le fichier `.env` à la racine du projet :

```bash
cp .env.local.example .env   # ou copier le bloc ci-dessous
```

Contenu `.env` pour le développement local :

```dotenv
# ── VITE (front-end public) ──────────────────────────────────────
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjEsImV4cCI6OTk5OTk5OTk5OX0.ZIhKF4RmxuCeSKIjpZ40QRuixVpXjHKMbZp3YwjtRx0
VITE_SUPABASE_DATABASE_URL=http://localhost:3001

# ── Supabase (simulé par PostgREST + nginx) ──────────────────────
SUPABASE_DATABASE_URL=http://localhost:3001
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjEsImV4cCI6OTk5OTk5OTk5OX0.ZIhKF4RmxuCeSKIjpZ40QRuixVpXjHKMbZp3YwjtRx0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MSwiZXhwIjo5OTk5OTk5OTk5fQ.D3HiiB3Lagr6nnA9by_mJZaAxhG60f-ELgK28tDTpR0

# ── BetterAuth ───────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/omf_therapie
BETTER_AUTH_SECRET=dev-secret-change-me-in-production-32chars
BETTER_AUTH_URL=http://localhost:4321

# ── Compte admin (seed) ──────────────────────────────────────────
ADMIN_EMAIL=admin@localhost.dev
ADMIN_PASSWORD=DevPassword!LocalOnly123
ADMIN_NAME=Oriane Montabonnet

# ── SMTP local (Mailpit) ─────────────────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=1025
RESEND_FROM_EMAIL=OMF Thérapie <contact@omf-therapie.fr>

# ── Stripe (clés de TEST — à remplacer) ─────────────────────────
# Obtenir depuis : https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_PUBLISHABLE_KEY=pk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
STRIPE_SUCCESS_URL=http://localhost:4321/rdv/merci

# ── Google Calendar (mode mock) ──────────────────────────────────
# true = créneaux fictifs les mercredis, aucun appel API Google
GOOGLE_CALENDAR_MOCK=true
GOOGLE_SERVICE_ACCOUNT_EMAIL=mock@example.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----"
GOOGLE_CALENDAR_ID=primary

# ── URLs avis patients (optionnel) ───────────────────────────────
GOOGLE_BUSINESS_URL=https://g.page/r/votre-fiche
PAGES_JAUNES_URL=https://www.pagesjaunes.fr/votre-fiche
PSYCHOLOGUE_NET_URL=https://www.psychologue.net/votre-profil
```

> **Note Stripe** : sans clés valides, le tunnel de paiement reste inactif. Obtenir des clés de test sur [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys).

---

## 3. Créer le compte admin (une seule fois)

BetterAuth gère l'authentification via PostgreSQL. Après le premier `docker compose up`, la base est vide — créer le compte thérapeute avec le script de seed :

```bash
npx tsx scripts/seed-admin.ts
```

Résultat attendu :
```
🔑 Création du compte admin : admin@localhost.dev
✅ Compte admin créé avec succès
```

> Ce script crée **un seul** compte. Le hook BetterAuth bloque toute inscription ultérieure (protection monocompte). Si la base est réinitialisée (`docker compose down -v`), relancer le seed.

---

## 4. Démarrer le serveur de développement

```bash
npm install          # si premier démarrage
npm run dev -- --port 4321
```

Le site est disponible sur **http://localhost:4321**.

### Pages clés

| URL | Description |
|-----|-------------|
| `http://localhost:4321/` | Accueil |
| `http://localhost:4321/rendez-vous/` | Wizard de prise de RDV |
| `http://localhost:4321/login/` | Connexion thérapeute |
| `http://localhost:4321/mes-rdvs/` | Tableau de bord admin (auth requise) |
| `http://localhost:8025` | Mailpit — boîte de réception locale |

---

## 5. Build de production

```bash
npm run build      # génère dist/ (SSG Astro)
npm run preview    # prévisualise le build sur http://localhost:4321
```

> Le build génère le sitemap automatiquement via `@astrojs/sitemap`.

---

## 6. Tests Playwright (e2e)

Le fichier de config `playwright.config.ts` pointe sur `http://localhost:4321` et utilise `chromium-browser` système.

```bash
# Avec le dev server déjà lancé (recommandé)
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
npx playwright test --project=chromium

# Sans dev server — Playwright le démarre automatiquement
npx playwright test

# Un seul test en mode headed (voir le navigateur)
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
npx playwright test --headed --project=chromium -g "charge la page du wizard"

# Rapport HTML
npx playwright show-report public/reports/playwright
```

### Résultat attendu

```
16 passed (≈22s)
```

---

## 7. Linting et vérifications

```bash
npm run lint              # ESLint
npm run audit:a11y        # Audit pa11y (nécessite le dev server actif)
```

---

## Récapitulatif — démarrage rapide

```bash
# 1. Infrastructure (depuis la racine du projet)
docker compose up -d

# 2. Variables d'env
cp .env.local.example .env

# 3. Dépendances + seed admin
npm install && npx tsx scripts/seed-admin.ts

# 4. Dev server
npm run dev -- --port 4321

# 5. Tests (dans un autre terminal)
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
npx playwright test --project=chromium
```

---

## Dépannage

### La base de données ne démarre pas

```bash
docker compose logs postgres
# Si erreur SQL au démarrage : supprimer le volume et recréer
docker compose down -v && docker compose up -d
```

### `auth.handler()` retourne 500

Vérifier que `DATABASE_URL` dans `.env` pointe sur `localhost:5432` et que Docker est lancé :
```bash
docker compose ps   # postgres doit être "healthy"
```

### Les emails n'arrivent pas

Ouvrir Mailpit : **http://localhost:8025**. Vérifier que `SMTP_HOST=localhost` et `SMTP_PORT=1025` dans `.env`.

### Les créneaux de RDV sont vides

Vérifier `GOOGLE_CALENDAR_MOCK=true` dans `.env`. En mode mock, seuls les **mercredis** ont des créneaux disponibles.

### Stripe — paiements non fonctionnels

Avec `STRIPE_SECRET_KEY=sk_test_placeholder` (valeur par défaut), le mode **Stripe mock** est actif :
- La confirmation d'une téléconsultation passe en statut `payment_pending` et envoie un email de demande de paiement avec un **lien fictif** (pas de vrai appel Stripe).
- Aucune erreur 500 — le bypass est intentionnel pour le développement local.

Pour tester le vrai tunnel de paiement, remplacer par de vraies clés de test [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys).

### BetterAuth — erreur `INVALID_ORIGIN` à la connexion

Si la page de connexion retourne `{"message":"Invalid origin","code":"INVALID_ORIGIN"}` :
- Cause : le navigateur se connecte via `http://localhost:4321` mais `BETTER_AUTH_URL=http://127.0.0.1:4321` (origines différentes malgré même serveur).
- Solution : les deux origines sont désormais déclarées dans `trustedOrigins` (`src/lib/auth.server.ts`). S'assurer que `BETTER_AUTH_URL=http://localhost:4321` dans `.env` (valeur par défaut correcte).

### Créneaux de RDV décalés (mauvaise heure)

Si les créneaux affichés sont décalés de ±4h par rapport à l'heure prévue :
- Cause historique : bug dans `parisLocalToUTC` (corrigé — `hour + diffHours`).
- Si le bug réapparaît, vérifier `src/lib/google-calendar.ts` fonction `parisLocalToUTC`.
