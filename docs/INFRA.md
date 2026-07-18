# Infrastructure — OMF Thérapie

Ce document décrit les services externes à configurer pour que la fonctionnalité de prise de rendez-vous fonctionne en production.

---

## Stratégie staging / production

Le plan free Supabase ne propose pas le branching de base de données. Pour éviter toute **contamination des données de production par les previews Netlify**, deux projets Supabase distincts sont utilisés :

| Contexte | Projet Supabase | Netlify deploy context |
|----------|----------------|------------------------|
| **Production** | `omf-therapie` (EU West) | `production` |
| **Staging / Previews** | `omf-therapie-staging` (EU West) | `deploy-preview` + `branch-deploy` |

Les variables qui diffèrent entre les deux contextes (`SUPABASE_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `BETTER_AUTH_URL`, `STRIPE_*`, `STRIPE_SUCCESS_URL`) doivent être configurées **séparément** dans Netlify : *Site settings → Environment variables → chaque variable → Edit → Add a new scope*.

---

## Ordre de mise en place recommandé

```
1. Supabase prod    → créer projet + exécuter migration SQL
2. Supabase staging → créer projet + exécuter migration SQL
3. Resend           → vérifier domaine DNS (peut prendre 24-48h)
4. Google           → compte de service + partage calendrier
5. Stripe           → activer compte prod + configurer webhook prod
                      activer compte test + configurer webhook staging
6. Netlify          → ajouter toutes les env vars par contexte + déployer
7. seed-admin       → créer le compte thérapeute sur prod ET staging
```

---

## 1. Supabase (base de données)

Créer un projet Supabase (région **EU West** pour conformité RGPD) puis exécuter la migration dans l'éditeur SQL :

```sql
-- Exécuter dans Supabase → SQL Editor
supabase/migrations/001_init.sql
```

Cela crée :
- Table `appointments` avec trigger `updated_at` et contrainte `scheduled_end` calculée
- Tables BetterAuth : `user`, `session`, `account`, `verification`
- Politiques RLS

**Variables à récupérer** dans *Settings → API* (ou *Settings → API Keys*) — à faire **pour chaque projet** (prod + staging) :

| Variable | Où trouver |
|----------|-----------|
| `SUPABASE_DATABASE_URL` | Settings → API → **Project URL** |
| `SUPABASE_ANON_KEY` | Settings → API → **anon / public** (anciens projets) ou **Publishable key** `sb_publishable_…` (nouveaux projets post-juillet 2025) |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → **service_role** (anciens projets) ou **Secret key** `sb_secret_…` (nouveaux projets) — ⚠️ confidentielle |
| `DATABASE_URL` | Settings → **Database** → Connection string → URI (mode `Transaction` ou `Session`) |

Format `DATABASE_URL` (pooler Supavisor, recommandé en serverless) : `postgres://postgres.[ref]:[password]@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`

### Vérification TLS (`SUPABASE_CA_CERT`)

Pour vérifier le certificat TLS du serveur Supabase (et ne PAS accepter aveuglément tout certificat), le `pg.Pool` de BetterAuth est configuré avec `ssl: { ca, rejectUnauthorized: true }`. Le certificat racine doit être fourni via la variable `SUPABASE_CA_CERT`.

- **Récupération** : Supabase Dashboard → *Database* → *Connection string* → *SSL* / « Root certificate » → fichier `prod-ca-2021.crt` (certificat racine public Supabase — ce n'est **pas** un secret).
  > ⚠️ **Pooler vs direct** : `prod-ca-2021.crt` est le certificat racine de la connexion **directe** (`db.<ref>.supabase.co:5432`). Le pooler Supavisor (`aws-0-…pooler.supabase.com:6543`) est une terminaison TLS distincte qui peut présenter une chaîne **différente** (souvent signée par une CA publique). L'étape 4 du runbook ci-dessous est donc une **porte obligatoire** : si le login échoue en TLS avec `prod-ca-2021.crt` sur le pooler, télécharger le certificat racine du pooler depuis le Dashboard (onglet Connection pooling → SSL) OU retirer le `ca` épinglé et s'appuyer sur le trust store système + `rejectUnauthorized: true` (le certificat pooler est signé par une CA publique, donc vérifié par les racines Mozilla).
- **Format** : coller le **PEM multiline littéral** tel quel (vraies nouvelles lignes, pas de `\n` échappés), ex. :
  ```
  -----BEGIN CERTIFICATE-----
  MIID...ligne 1...
  ...lignes suivantes...
  -----END CERTIFICATE-----
  ```
- **Configuration Netlify** : `Site settings → Environment variables → Add variable → SUPABASE_CA_CERT`, avec un scope **par contexte** (production **et** deploy-preview), car les projets Supabase prod et staging partagent le même certificat racine mais la variable doit exister dans les deux scopes.
- **Mode transactionnel sécurisé** : le pooler Supavisor (`:6543`, mode transaction) désactive les prepared statements nommés. BetterAuth/Kysely utilise des statements **non nommés** → aucune collision Supavisor. Safe.

#### Runbook de déploiement (ordre obligatoire)

⚠️ `SUPABASE_CA_CERT` doit être défini **avant** le merge du code, sinon le pool échoue en fail-closed (AC7 — erreur au chargement du module) et toutes les connexions auth renvoient 5xx.

1. Télécharger `prod-ca-2021.crt` (Supabase Dashboard → Database → Connection string → SSL → Root certificate).
2. Coller le contenu PEM dans la variable Netlify `SUPABASE_CA_CERT`, scope **production**.
3. Répéter pour le scope **deploy-preview** (projet Supabase staging — même certificat racine).
4. **PORTE OBLIGATOIRE** : lancer un déploiement de preview et vérifier qu'un login réussit (Function logs sans erreur TLS). Si échec TLS, le pooler présente une chaîne différente — voir la note « Pooler vs direct » ci-dessus et adapter le certificat avant de continuer.
5. Merger le code de la PR #73.
6. Surveiller pendant 24 h : logs Netlify Functions (erreurs `SUPABASE_CA_CERT` / TLS) + Supabase → Database → Connection metrics (pas d'erreurs de limite de connexion directe).

---

## 2. BetterAuth (authentification thérapeute)

Générer un secret robuste :

```bash
openssl rand -base64 32   # → BETTER_AUTH_SECRET
```

**Créer le compte admin** (une seule fois par environnement, après le déploiement) :

```bash
# Production
BETTER_AUTH_URL=https://omf-therapie.fr \
DATABASE_URL=<DATABASE_URL_PROD> \
ADMIN_EMAIL=contact@omf-therapie.fr \
ADMIN_PASSWORD=<MotDePasse16chars!> \
ADMIN_NAME="Oriane Montabonnet" \
npx tsx scripts/seed-admin.ts

# Staging
BETTER_AUTH_URL=https://staging--omf-therapie.netlify.app \
DATABASE_URL=<DATABASE_URL_STAGING> \
ADMIN_EMAIL=contact@omf-therapie.fr \
ADMIN_PASSWORD=<MotDePasse16chars!> \
ADMIN_NAME="Oriane Montabonnet" \
npx tsx scripts/seed-admin.ts
```

> ⚠️ Un hook anti-inscription bloque toute création de compte supplémentaire après le premier.  
> Le mot de passe doit faire **16 caractères minimum** (majuscules + minuscules + chiffres + symboles).  
> Remplacer `staging--omf-therapie.netlify.app` par l'URL réelle du branch deploy Netlify.

---

## 3. Stripe (paiement en ligne)

1. Créer / activer un compte Stripe (mode live en production)
2. Récupérer les clés dans *Developers → API keys*
3. Dans *Developers → Webhooks*, ajouter un endpoint :

   ```
   URL      : https://omf-therapie.fr/api/stripe-webhook
   Événements : checkout.session.completed
                payment_intent.succeeded
   ```

4. Copier le **Signing secret** affiché après création du webhook

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | `sk_live_…` (confidentielle) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `STRIPE_SUCCESS_URL` | `https://omf-therapie.fr/rdv/merci` |

---

## 4. Resend (emails transactionnels)

1. Créer un compte sur [resend.com](https://resend.com)
2. Aller dans *Domains → Add Domain* et saisir `omf-therapie.fr`
3. Ajouter les **3 entrées DNS** indiquées (SPF, DKIM, DMARC) — vérification en 24-48h
4. Créer une clé API dans *API Keys*

| Variable | Exemple |
|----------|---------|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` |
| `RESEND_FROM_EMAIL` | `OMF Thérapie <contact@omf-therapie.fr>` |

---

## 5. Google Calendar (disponibilités)

### Créer le compte de service

1. Ouvrir [Google Cloud Console](https://console.cloud.google.com) → créer un projet
2. Activer l'API **Google Calendar**
3. *IAM & Admin → Service Accounts → Create Service Account*
4. Télécharger la clé JSON du compte de service

Extraire depuis le JSON :

| Variable | Champ JSON |
|----------|-----------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` |
| `GOOGLE_PRIVATE_KEY` | `private_key` (clé PEM complète, conserver les `\n` littéraux) |

### Partager le calendrier

1. Ouvrir Google Calendar → *Paramètres du calendrier* de la thérapeute
2. *Partager avec des personnes* → saisir l'email du compte de service
3. Attribuer le droit **"Apporter des modifications aux événements"**
4. Copier l'**ID du calendrier** (format `xxx@group.calendar.google.com` ou `primary`)

| Variable | Description |
|----------|-------------|
| `GOOGLE_CALENDAR_ID` | ID du calendrier partagé |

---

## 6. Netlify (hébergement + cron)

### Variables d'environnement

Ajouter dans *Site settings → Environment variables*. Pour les variables qui diffèrent entre prod et staging, utiliser **"Add a new scope"** sur chaque variable.

| Variable | Prod | Staging | Scope |
|----------|------|---------|-------|
| `SUPABASE_DATABASE_URL` | URL projet prod | URL projet staging | Par contexte |
| `SUPABASE_ANON_KEY` | Clé publishable prod | Clé publishable staging | Par contexte |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé secrète prod | Clé secrète staging | Par contexte |
| `DATABASE_URL` | Connection string prod | Connection string staging | Par contexte |
| `BETTER_AUTH_URL` | `https://omf-therapie.fr` | URL branch deploy Netlify | Par contexte |
| `BETTER_AUTH_SECRET` | Secret 32 chars | (même valeur possible) | Tous contextes |
| `ADMIN_EMAIL` | Email thérapeute | Email thérapeute | Tous contextes |
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` | Par contexte |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` | Par contexte |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (live) | `whsec_…` (test) | Par contexte |
| `STRIPE_SUCCESS_URL` | `https://omf-therapie.fr/rdv/merci` | URL staging `/rdv/merci` | Par contexte |
| `RESEND_API_KEY` | `re_…` | `re_…` (même clé possible) | Tous contextes |
| `RESEND_FROM_EMAIL` | `OMF Thérapie <contact@omf-therapie.fr>` | idem | Tous contextes |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email compte de service | idem | Tous contextes |
| `GOOGLE_PRIVATE_KEY` | Clé privée PEM | idem | Tous contextes |
| `GOOGLE_CALENDAR_ID` | ID calendrier prod | ID calendrier staging (optionnel) | Par contexte |

### Variables optionnelles (invitations à noter)

| Variable | Description |
|----------|-------------|
| `GOOGLE_BUSINESS_URL` | Lien Google Business Profile |
| `PAGES_JAUNES_URL` | Lien Pages Jaunes |
| `PSYCHOLOGUE_NET_URL` | Lien profil Psychologue.net |

### Cron de rappels J-1

La fonction `netlify/functions/send-reminders.ts` se déclenche **automatiquement à 18h00 UTC** (19h00 / 20h00 heure de Paris selon DST) — aucune configuration manuelle requise, Netlify lit le `schedule: '0 18 * * *'` déclaré dans le code (const partagée avec le monitor Sentry — voir §7).

### Build settings

```
Build command  : npm run build
Publish dir    : dist
Node version   : 20
```

---

## 7. Observabilité (Sentry + uptime monitoring)

Cette section couvre l'instrumentation error tracking + structured logging
ajoutée dans l'issue #75. Shape 2 : `@sentry/node` (server) + `@sentry/browser`
(client) câblés manuellement (pas `@sentry/astro` — risque de compatibilité
avec l'adaptateur Netlify).

> **Ordre impératif :** projet Sentry → hôte ingest → CSP → DSN → déploiement.  
> Suivre les étapes ci-dessous dans l'ordre numérique — ne **pas** configurer
> `PUBLIC_SENTRY_DSN` avant d'avoir élargi le CSP, sinon la télémétrie
> client est bloquée silencieusement au premier déploiement.

### 7.1 Création du projet Sentry

1. Sur [sentry.io](https://sentry.io), créer un projet **Node.js** pour le
   server (`omf-therapie-server`).
2. Créer un second projet **Browser JavaScript** pour le client
   (`omf-therapie-client`) — OU réutiliser le même projet (DSN unique). La
   séparation permet de filtrer les erreurs navigateur vs serveur.
3. Créer un projet **Node.js** séparé pour le staging
   (`omf-therapie-server-staging`) — évite que les erreurs de
   `deploy-preview` ne polluent le project prod.

Récupérer le DSN dans **Project Settings → Client Keys (DSN)** pour chaque
projet. Il s'agit d'une clé publique (safe to expose) — le préfixe `PUBLIC_`
permet à Astro de l'exposer côté client (mirroir de `PUBLIC_GA4_ID`).

### 7.2 Élargir le CSP avec l'hôte ingest exact

> **⚠️ À faire AVANT de configurer `PUBLIC_SENTRY_DSN`** — sinon la
> télémétrie client est bloquée silencieusement au premier déploiement.

L'enveloppe Sentry est POSTée vers l'hôte d'ingest de la région du projet
(ex. `https://o<orgId>.ingest.de.sentry.io` pour l'EU). Cette hôte à 3 labels
**n'est pas** couverte par `*.sentry.io` (CSP ne match qu'un seul label DNS).
Dans `netlify.toml`, ajouter l'hôte exact à `connect-src` :

```
connect-src … https://stats.g.doubleclick.net/ https://o<orgId>.ingest.<region>.sentry.io …
```

L'hôte se lit dans le DSN récupéré à l'étape 7.1 (la partie entre `@` et la
première `/`). L'`<orgId>` est stable par org Sentry — les projets prod et
staging d'une même org partagent le même hôte d'ingest (seuls le key et le
projectId diffèrent, neither n'apparaît dans le CSP). Si l'org est déplacée
vers une autre région, mettre à jour l'hôte ici ET dans `netlify.toml`.
Alternative : configurer `tunnel` dans `Sentry.init` (route `/sentry-tunnel/`
locale) pour tout ramener sous `connect-src 'self'`. Le SDK serveur n'est pas
affecté (les requêtes server-side bypassent le CSP navigateur).

> Pour omf-therapie, l'org est en région EU : l'hôte d'ingest est
> `https://o4511756155617280.ingest.de.sentry.io` (déjà allowlisté dans
> `netlify.toml`).

### 7.3 Configuration Netlify (production)

Dans **Site settings → Environment variables**, scope `Production` :

| Variable | Valeur |
|----------|--------|
| `PUBLIC_SENTRY_DSN` | `https://<key>@o<orgId>.ingest.<region>.sentry.io/<projectId>` (region = `us` \| `de` \| … dépend de l'org) |

### 7.4 Configuration Netlify (deploy-preview / staging)

Scope `Deploy previews` :

| Variable | Valeur |
|----------|--------|
| `PUBLIC_SENTRY_DSN` | DSN du projet staging (§7.1 étape 3) |

Quand `PUBLIC_SENTRY_DSN` est absent (ex : dev local), le SDK reste inerte —
le logger dégrade vers `console.*` uniquement.

### 7.5 Monitors Sentry (cron check-ins)

Les cron functions sont enveloppées par `Sentry.withMonitor()`. Dans Sentry :

1. **Alerts → Monitors** : vérifier que `send-reminders` (crontab
   `0 18 * * *`, checkInMargin 5 min) et `calendar-token-heartbeat` (crontab
   `0 0 * * 0`, checkInMargin 5 min) apparaissent après le premier
   déclenchement.
2. Configurer une alerte email/Slack sur **No check-ins** (mauvais fire) et
   **Execution duration** (timeout).

Netlify scheduler n'ayant pas d'alerting natif, les monitors Sentry sont le
seul canal de détection des ratés.

### 7.6 Uptime monitoring (sonde externe)

Configurer un service externe (Better Stack / UptimeRobot / Pingdom) avec deux
sondes :

| Sonde | URL | Réponse attendue | Rôle |
|-------|-----|------------------|------|
| `site-up` | `https://omf-therapie.fr/` | 200 | Détecte un build cassé ou une panne static |
| `runtime-up` | `https://omf-therapie.fr/api/health/` | 200 `{ok:true}` | Détecte un runtime serverless cassé (la route n'a aucune dépendance — pas de Supabase/Google) |

Interval recommandé : 5 min. Alert email : `ADMIN_EMAIL`. Documenter le vendor
retenu dans ce tableau (les deux sont interchangeables).

### 7.7 Vérification post-déploiement (canary)

Après chaque déploiement, vérifier dans Sentry qu'un message
`deploy: <git-sha>` apparaît dans les **5 minutes** suivant le deploy. Ce
canary est émis une fois par cold start (server via `emitDeployCanary()`,
client via `captureMessage` dans `Layout.astro`). Son absence signifie que
l'instrumentation est cassée (DSN mauvais, CSP bloquante, SDK non chargé) —
à distinguer d'un site sain mais silencieux.

---

## Fichiers de référence

| Fichier | Rôle |
|---------|------|
| `supabase/migrations/001_init.sql` | Schéma complet de la base de données |
| `scripts/seed-admin.ts` | Création du compte thérapeute |
| `.env.example` | Toutes les variables avec documentation inline |
| `netlify.toml` | Configuration build + headers sécurité + redirects |
| `netlify/functions/send-reminders.ts` | Cron J-1 |
