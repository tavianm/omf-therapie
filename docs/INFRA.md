# Infrastructure — OMF Thérapie

Ce document décrit les services externes à configurer pour que la fonctionnalité de prise de rendez-vous fonctionne en production.

---

## Ordre de mise en place recommandé

```
1. Supabase   → créer projet + exécuter migration SQL
2. Resend     → vérifier domaine DNS (peut prendre 24-48h)
3. Google     → compte de service + partage calendrier
4. Stripe     → activer compte + configurer webhook
5. Netlify    → ajouter toutes les env vars + déployer
6. seed-admin → créer le compte thérapeute (site déployé requis)
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

**Variables à récupérer** dans *Settings → API* :

| Variable | Où trouver |
|----------|-----------|
| `SUPABASE_DATABASE_URL` | Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Settings → API → anon / public |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role (confidentielle) |
| `DATABASE_URL` | Settings → Database → Connection string → URI (mode `Session` ou `Transaction`) |

Format `DATABASE_URL` : `postgresql://postgres:[password]@db.<ref>.supabase.co:5432/postgres?sslmode=require`

---

## 2. BetterAuth (authentification thérapeute)

Générer un secret robuste :

```bash
openssl rand -base64 32   # → BETTER_AUTH_SECRET
```

**Créer le compte admin** (une seule fois, après le premier déploiement) :

```bash
BETTER_AUTH_URL=https://omf-therapie.fr \
ADMIN_EMAIL=contact@omf-therapie.fr \
ADMIN_PASSWORD=<MotDePasse16chars!> \
ADMIN_NAME="Oriane Montabonnet" \
npx tsx scripts/seed-admin.ts
```

> ⚠️ Un hook anti-inscription bloque toute création de compte supplémentaire après le premier.  
> Le mot de passe doit faire **16 caractères minimum** (majuscules + minuscules + chiffres + symboles).

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

Ajouter dans *Site settings → Environment variables* :

| Variable | Valeur / Description |
|----------|---------------------|
| `SUPABASE_DATABASE_URL` | URL projet Supabase |
| `SUPABASE_ANON_KEY` | Clé publique |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service (confidentielle) |
| `DATABASE_URL` | Connexion directe PostgreSQL (BetterAuth) |
| `BETTER_AUTH_SECRET` | Secret 32 caractères minimum |
| `BETTER_AUTH_URL` | `https://omf-therapie.fr` |
| `ADMIN_EMAIL` | Email de la thérapeute |
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `STRIPE_SUCCESS_URL` | `https://omf-therapie.fr/rdv/merci` |
| `RESEND_API_KEY` | `re_…` |
| `RESEND_FROM_EMAIL` | `OMF Thérapie <contact@omf-therapie.fr>` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email compte de service Google |
| `GOOGLE_PRIVATE_KEY` | Clé privée PEM |
| `GOOGLE_CALENDAR_ID` | ID du calendrier Google |

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
