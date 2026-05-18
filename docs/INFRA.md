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

Format `DATABASE_URL` : `postgresql://postgres:[password]@db.<ref>.supabase.co:5432/postgres?sslmode=require`

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

La fonction `netlify/functions/send-reminders.ts` se déclenche **automatiquement à 08h00 UTC** (09h00 / 10h00 heure de Paris selon DST) — aucune configuration manuelle requise, Netlify lit le `schedule: '0 8 * * *'` déclaré dans le code.

### Build settings

```
Build command  : npm run build
Publish dir    : dist
Node version   : 20
```

---

## Fichiers de référence

| Fichier | Rôle |
|---------|------|
| `supabase/migrations/001_init.sql` | Schéma complet de la base de données |
| `scripts/seed-admin.ts` | Création du compte thérapeute |
| `.env.example` | Toutes les variables avec documentation inline |
| `netlify.toml` | Configuration build + headers sécurité + redirects |
| `netlify/functions/send-reminders.ts` | Cron J-1 |
