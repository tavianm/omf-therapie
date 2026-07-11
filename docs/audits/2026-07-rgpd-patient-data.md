# Audit RGPD — données patient OMF Thérapie

| Champ | Valeur |
|---|---|
| **Date** | 2026-07-11 |
| **Auteur** | Audit automatique — pipeline dev-core #72 |
| **Périmètre** | 6 domaines : (1) inventaire des données, (2) rétention/effacement, (3) `patient_reason`, (4) consentement, (5) politique vs réalité, (6) sous-traitants |
| **Nature** | Note de constats (DOC-ONLY) — aucune recommandation d'implémentation de code |
| **Analyse source** | `artifacts/analyses/72-rgpd-patient-data-compliance-audit-analysis.md` |

---

## Méthodologie

Cet audit repose sur la **lecture statique du code et de la politique de confidentialité** publiée sur le site. Aucun test dynamique n'a été réalisé ; aucune requête réseau n'a été inspectée au runtime. Les constats citent des preuves sous la forme `fichier:ligne` (code) ou citation verbatim (politique).

**Fichiers inspectés (liste exhaustive en annexe) :**

- Politique et mentions légales : `src/pages/confidentialite.astro` (354 lignes, lecture intégrale), `src/pages/mentions-legales.astro`
- Schéma base de données : `supabase/migrations/001_init.sql` → `008_credits.sql`
- Couche consentement / analytics : `src/layouts/Layout.astro`, `src/lib/analytics.ts`
- Routes API : `src/pages/api/appointments/`, `src/pages/api/admin/`, `src/pages/api/stripe-webhook.ts`
- Fonctions planifiées : `netlify/functions/send-reminders.ts`
- Bibliothèques métier : `src/lib/stripe.ts`, `src/lib/google-calendar.ts`, `src/lib/manual-slots.ts`, `src/lib/auth.server.ts`
- Composants de réservation : `src/components/booking/BookingWizard.tsx`
- Emails : `src/emails/AppointmentRequestNotification.tsx`
- Configuration déploiement : `netlify.toml`

**Stance sur la classification Art. 9 (donnée de santé).** L'audit est **délibérément neutre** sur la question de savoir si le champ `patient_reason` relève de l'article 9 du RGPD (données sensibles) ou de l'article 6 (données ordinaires). Cette classification a des conséquences majeures sur les sévérités (voir Domaine 3) mais **requiert un avis CNIL ou un conseil juridique externe** que cet audit ne peut pas se substituer. La note documente les deux scénarios (A et B) sans en choisir un.

---

## Légende des sévérités

| Code | Libellé | Définition |
|------|---------|------------|
| **P1** | Critique | Écart réglementaire majeur touchant les droits fondamentaux des personnes concernées, ou fausse déclaration active dans la politique. Sanction CNIL probable / atteinte directe à la confiance patient. |
| **P2** | Élevée | Écart réglementaire significatif : droit non exécutable, promesse de conservation non tenue, ou collecte non divulguée de données sensibles. |
| **P3** | Moyenne | Faiblesse technique ou d'exposition augmentant le risque (logs PII, mécanisme partiellement câblé, dépendance non vérifiable côté code). |
| **P4** | Faible | Amélioration de robustesse / bonne pratique (ex. précision CSP, edge case de polling). |

---

## Cadrage risque-métier

Pour un cabinet de psychothérapie, **la confiance patient est l'actif commercial dominant**. Le canal d'acquisition principal est le bouche-à-oreille ; un patient qui découvre que son motif de consultation est stocké ou logué en clair, ou que la politique de confidentialité ment sur l'utilisation de Google Analytics, subit une atteinte qui n'est pas qu'une amende théorique — c'est une atteinte réputationnelle potentiellement fatale pour un monocompte.

L'exposition réglementaire est réelle : la CNIL peut prononcer des sanctions jusqu'à **4 % du chiffre d'affaires / 20 M€**, mais surtout des **injonctions sous astreinte** et la **publication de la sanction** (effet dissuasif et réputationnel supérieur à l'amende elle-même). La praticienne (monocompte, sans équipe juridique interne) doit pouvoir **actionner elle-même les remédiations** — la note propose donc un séquencement réaliste (P1 trivialement remédiables d'abord, P1 structurels ensuite, questions juridiques en parallèle).

---

> **3 actions prioritaires** (langage métier)
>
> 1. **Mettez la politique de confidentialité en conformité avec la réalité.** Le site utilise Google Analytics et un bandeau cookies (CookieYes) que la politique actuelle nie explicitement, par écrit. C'est l'écart le plus facilement sanctionnable et le plus rapide à corriger — soit en supprimant Google Analytics, soit en réécrivant la politique [D5.2 / D6.2].
> 2. **Permettez réellement le droit à l'effacement d'un patient.** La politique annonce ce droit, mais aujourd'hui aucune fonction du site ne le permet — les données patient restent indéfiniment, sans recours. Il faut construire ce mécanisme [D2.1 / D5.5].
> 3. **Revoyez la collecte du motif de consultation.** Le champ est obligatoire alors que la politique le dit facultatif, et son texte d'aide invite activement à mentionner des informations financières sensibles (RSA, ASS, chômage). C'est un risque réglementaire élevé qui demande un choix de produit [D5.1 / D3.1].

---

## Matrice synthèse — tous constats

Triée par sévérité décroissante (P1 → P4), puis par domaine.

| ID | Domaine | Sév. | Écart | Remédiation (direction) |
|----|---------|------|-------|--------------------------|
| D2.1 | Rétention/effacement | **P1** | `appointments.deleted_at` jamais écrite ; aucune purge | Endpoint admin `/api/admin/erasure` + brancher `deleted_at` + cascade `credits` |
| D5.2 | Politique vs réalité | **P1** | Politique nie GA4 (L137-138, L310-313) ; GA4 actif | **Supprimer GA4** (reco) ou réécrire politique §7 + divulguer |
| D5.5 | Politique vs réalité | **P1** | Droit Art. 17 annoncé (L254) ; aucun code l'implémente | Workflow effacement admin + processus demande patient |
| D6.2 | Sous-traitants | **P1** | GA4 sous-traitant actif omis + explicitement nié | Voir D5.2 (facette) |
| D2.2 | Rétention/effacement | P2 | `email_threads`, `credits` sans rétention/FK | Purge/anonymisation annexe + FK cascade |
| D3.1 | `patient_reason` | P2 | Champ `required` ; politique dit « facultatif » | Rendre facultatif + supprimer aide RSA/ASS + décision menu vs libre |
| D5.1 | Politique vs réalité | P2 | Motif « facultatif » (L103) vs `required` code | Aligner UI sur politique (voir D3.1) |
| D5.3 | Politique vs réalité | P2 | Promesses 3 ans/5 ans (L177-190) ; aucune purge | Cron `pg_cron` OU retirer promesses chiffrées |
| D5.4 | Politique vs réalité | P2 | « Aucune donnée Google patient » (L123) ; Calendar écrit nom+email | Corriger politique OU pseudonymiser événements Calendar |
| D6.1 | Sous-traitants | P2 | CookieYes non listé (L207-240) | Ajouter CookieYes à la section sous-traitants |
| D1.1 | Inventaire | P3 | `patient_reason` (sensible) emailé en clair à thérapeute | Voir D3.1 (facette transversale) |
| D1.2 | Inventaire | P3 | `patient_email` dans logs Netlify (6+ lignes) | Logger `appointment_id` seulement, jamais l'email brut |
| D4.1 | Consentement | P3 | `trackEvent()` sans gate consentement | Gater sur `__ckyAnalyticsReady` (comme `merci.astro`) |
| D4.2 | Consentement | P3 | `url_passthrough: true` (L88) envoie URL pré-consent | Revenir à `false` |
| D4.3 | Consentement | P3 | Consent update entièrement délégué CookieYes (non vérifiable code) | Vérification manuelle tableau de bord CookieYes |
| D4.4 | Consentement | P4 | CSP `script-src` — vérification runtime recommandée | Vérifier console navigateur ; corriger si blocage observé |
| D4.5 | Consentement | P4 | GA4 gtag.js chargé inconditionnellement | Chargement différé sur consentement |
| D4.6 | Consentement | P4 | Plafond polling `__ckyAnalyticsReady` 6 s | Augmenter plafond OU écouter événement consent |

**Total : 18 constats — 4 P1, 6 P2, 5 P3, 3 P4.**

---

# Domaine 1 — Inventaire des données

Ce domaine dresse l'inventaire des champs PII collectés, leur table de stockage, et l'ensemble de leurs flux externes (sous-traitants et logs). L'inventaire couvre ~80 % d'un registre Art. 30 (voir Recommandations transversales).

## D1.1 — Champs PII collectés et flux externes (P3)

**Preuve.** Table `appointments` (`supabase/migrations/001_init.sql:14-23`) contient :

| Champ | Type | Classification | Note |
|---|---|---|---|
| `patient_name` | TEXT | PII Art. 6 | Identité |
| `patient_email` | TEXT | PII Art. 6 | Identifiant unique de contact |
| `patient_phone` | TEXT | PII Art. 6 | — |
| `patient_postal_code` | TEXT | PII Art. 6 | — |
| `patient_city` | TEXT | PII Art. 6 | — |
| `patient_reason` | TEXT ≤1500 | **Santé-adjacent — question Art. 9 ouverte** | Voir Domaine 3 |
| `therapist_notes` | TEXT | Potentiellement clinique (secret médical ?) | Jamais exposé patient |

**Flux externes (mapping complet, vérifié par lecture du code) :**

| Sous-traitant | Champs PII transmis | Chemin |
|---|---|---|
| **Resend (email)** | **TOUS les 6** incluant `patient_reason` en clair | `src/emails/AppointmentRequestNotification.tsx:131` → thérapeute (l'unique sortie de `patient_reason` vers un sous-traitant externe) |
| **Google Calendar** | `patient_name` + `patient_email` (titre + description + attendee) | 8 sites d'appel : `appointments/[id].ts:203,254,850`, `admin/appointments/index.ts:247`, `admin/appointments/[id]/regenerate-calendar.ts:58`, `stripe-webhook.ts:241,275,305` |
| **Stripe** | **Aucun** (metadata = `appointment_id` seulement ; `patientName`/`patientEmail` détruits avant l'appel) | `src/lib/stripe.ts:83,110-125` |
| **Logs Netlify** | `patient_email` explicite (6 lignes) + erreurs Supabase brutes (2 lignes) | `netlify/functions/send-reminders.ts:192,206,221,243,257`, `appointments/index.ts:174`, `admin/appointments/index.ts:217` |
| **URLs / historique** | `?name=<prénom>` legacy (parsé mais non construit côté serveur) ; `?email=` sur admin credits | `merci.astro:28`, `admin/credits.ts:33` |

**Constat clé.** `patient_reason` (le champ le plus sensible) ne sort de la DB vers un sous-traitant externe que via un email à la thérapeute — légitime (intérêt légitime de gestion du RDV), mais stocké dans les logs d'envoi Resend. Les emails patients ne contiennent que `patient_name`. Google Calendar reçoit l'identité du patient mais jamais le motif.

**Note de minimisation.** `patient_reason` ET `therapist_notes` transitent aussi vers l'UI admin (`mes-rdvs.astro:37-46` via `APPOINTMENT_COLUMNS` → island `<AppointmentsManager>`). Cet affichage est légitime : l'espace admin est gardé par `auth.api.getSession` + `isAdminSession` (`mes-rdvs.astro:24-31`), avec `noindex:true`. Ce n'est pas une exposition patient, mais un axe de minimisation existe : **ne sélectionner ces colonnes qu'au dépliement de carte**, pas en liste.

**Renvoi croisé :** D1.1 → D3.1 (collecte `patient_reason`), D5.1 (politique).

**Remédiation (direction).** Voir D3.1 pour la facette transversale `patient_reason`. Axe propre à D1.1 : minimisation de l'affichage admin (sélectionner `patient_reason`/`therapist_notes` à la demande, pas par défaut). Surface : `src/pages/mes-rdvs.astro:37-46`, composant `AppointmentsManager`. Effort S.

## D1.2 — Logs Netlify fuient `patient_email` (P3)

**Preuve.** Sites où `patient_email` apparaît explicitement dans des logs :

- `netlify/functions/send-reminders.ts:192,206,221,243,257` — 5 lignes d'email explicite dans les logs de rappels.
- `appointments/index.ts:174` et `admin/appointments/index.ts:217` — `console.error` qui loguent l'objet d'erreur Supabase. Les erreurs PostgREST contiennent `{message, details, hint, code}` et **n'échoent normalement pas le payload PII soumis**, mais le risque résiduel d'une fuite via un message d'erreur détaillé n'est pas nul.

**Risque.** Les logs Netlify sont agrégés côté plateforme ; `patient_email` y persiste hors du contrôle direct de la praticienne. Si `patient_reason` est un jour logué (il ne l'est pas actuellement côté Netlify — uniquement via Resend), le risque Art. 9 s'applique.

**Remédiation (direction).** Logger `appointment_id` + `error.code` / `error.message`, jamais l'objet erreur brut ni l'email. Surface : `netlify/functions/send-reminders.ts` + les 2 routes API `appointments/index.ts`, `admin/appointments/index.ts`. Effort S.


---

# Domaine 2 — Rétention et effacement

## D2.1 — `appointments.deleted_at` jamais écrite ; aucune purge (P1)

**Constat majeur.** La colonne `appointments.deleted_at` (`001_init.sql:79`, soft-delete, `NULL` = actif) est **filtrée dans 8 requêtes de lecture mais n'est jamais écrite pour cette table**. Aucun chemin de code ne fait `UPDATE appointments SET deleted_at = ...`.

> **Précision factuelle importante.** `deleted_at` **est** écrite pour la table `manual_time_slots` (`src/lib/manual-slots.ts:81`, invoqué par `src/pages/api/admin/time-slots/[id].ts:49-50`) — mais cette table ne contient **aucune donnée patient** (juste des plages horaires). Le mécanisme de soft-delete existe donc dans le projet mais n'est jamais branché sur les rendez-vous.

**Les 8 sites de lecture qui filtrent `appointments.deleted_at IS NULL`** (filtrent une colonne toujours `NULL`) :

1. `src/lib/appointment-conflicts.ts:32`
2. `src/lib/appointment-conflicts.ts:59`
3. `src/pages/api/admin/patients.ts:46`
4. `src/pages/api/availability.ts:69`
5. `src/pages/api/calendar/invite/[id].ts:26`
6. `src/pages/mes-rdvs.astro:51`
7. `netlify/functions/send-reminders.ts:126`
8. `netlify/functions/send-reminders.ts:141`

| Question | Réponse |
|---|---|
| Soft-delete pour `appointments` ? | **Non** — colonne jamais écrite |
| Hard-delete ? | Non (un seul `DELETE` compensateur de rollback crédit : `admin/appointments/index.ts:232`) |
| Cron de nettoyage ? | **Aucun** (2 fonctions planifiées `send-reminders`, `calendar-token-heartbeat` — aucune ne supprime) |
| Endpoint Art. 17 ? | **N'existe pas** |
| Effacement réellement possible ? | Seulement via SQL manuel en production |

**Blast radius.** Toutes les personnes concernées, **indéfiniment, sans recours**. Les données patient (nom, email, téléphone, code postal, ville, motif, notes thérapeute, IDs Stripe, liens vidéo) **persistent indéfiniment**. La politique promet 3 ans / 5 ans (`confidentialite.astro:177-190`) — **contradiction directe** (violation Art. 5-1-e : limitation de la conservation).

**Remédiation (assez précise pour chiffrer un ticket, sans spécifier l'implémentation).**

(a) Endpoint `/api/admin/erasure` (admin-only) qui **anonymise les PII** d'un patient (`patient_name='[supprimé]'`, `patient_email=NULL`, `patient_phone=NULL`, etc.) plutôt que hard-delete — préserve l'intégrité comptable et les avoirs.
(b) Brancher `appointments.deleted_at` sur une action admin « Archiver / Supprimer ».
(c) Gérer la cascade `credits.patient_email` (`008_credits.sql:15` : `ON DELETE SET NULL` → anonymisation explicite).
(d) Documenter le processus pour les demandes patient (voir D5.5).

**Surface pressentie :** `src/pages/api/admin/erasure.ts` (nouveau), `src/lib/erasure.ts` (nouveau), `supabase/migrations/009_erasure.sql` (nouveau). Effort L.

**Renvoi croisé :** D2.1 → D5.5 (facette politique : la promesse d'effacement est écrite mais non tenue).

## D2.2 — Tables annexes sans rétention ni FK (P2)

**Preuve.**

- **`email_threads`** (migrations 002/003) — pas de `deleted_at`, pas de purge, pas de FK vers `appointments`. Les métadonnées d'emails (message-ids, threads) survivent indéfiniment, indépendamment du sort des rendez-vous.
- **`credits` / `credit_usages`** (migration 008) — `credits.patient_email` survit à la suppression d'un appointment via `ON DELETE SET NULL` (`008_credits.sql:15`). Conséquence : même si un appointment est supprimé, **l'email patient reste dans le registre des avoirs**.

**Risque.** Même après une (hypothétique) implémentation de l'effacement sur `appointments`, ces tables annexes constitueraient des **résidus PII** non purgés.

**Remédiation (direction).** Purge/anonymisation annexe + FK cascade explicite vers `appointments`. Surface : `supabase/migrations/002_*`, `003_*`, `008_credits.sql`. Effort M.


---

# Domaine 3 — Collecte du champ `patient_reason`

## D3.1 — Champ `required`, politique dit « facultatif », aide RSA/ASS aggravante (P2)

**Preuve.** Collecte dans `src/components/booking/BookingWizard.tsx:665-689` :

- Élément `<textarea>` libre, attribut `required`, plage 10–1500 caractères.
- Label : *« Motif de consultation * »* (astreint).
- Placeholder : *« Décrivez brièvement ce qui vous amène à consulter... »*
- Texte d'aide (`BookingWizard.tsx:687-689`) qui **aggrave le risque Art. 9** :

> *« Si vous traversez une période financière difficile (RSA, ASS, études, chômage…), n'hésitez pas à le mentionner ici — un tarif adapté peut être proposé. »*

→ Ce texte invite **activement** le patient à fournir des données socio-économiques en plus des données de santé.

**Écart politique vs code.** La politique dit *« Motif de consultation **(facultatif)** »* (`confidentialite.astro:103`) mais le code exige le champ (`required`, astérisque `*`). Le patient est **contraint de fournir des données potentiellement sensibles** que la politique présente comme facultatives.

**Stockage.** Texte clair en base (`appointments.patient_reason TEXT`), pas de chiffrement au-delà de ce que Supabase/Postgres fournit par défaut. `therapist_notes` similaire.

### Question Art. 9 ouverte — stance neutre

L'audit **ne tranche pas** la classification de `patient_reason`. Deux scénarios sont documentés :

**Scénario A — `patient_reason` qualifié Art. 9 (donnée de santé).**
- Conséquences : consentement **explicite** Art. 9-2-a requis, encadrement renforcé, **AIPD probablement requise**.
- Le texte d'aide (RSA/ASS/chômage) renforce cette qualification : la situation financière est une donnée sensible dans certains contextes CNIL.
- **Impact sévérité : D3.1 monte à P1, D1.1 et D5.1 également.**

**Scénario B — qualifié Art. 6 (donnée ordinaire).**
- Conséquences : la base contractuelle suffit.
- Le texte d'aide socio-économique pousse néanmoins vers la frontière Art. 9.
- **Impact : les sévérités actuelles (P2/P3) tiennent.**

**Direction de remédiation (avant classification).** Consulter la CNIL ou un avocat pour classification définitive. En attendant, les remédiations ci-dessous réduisent le risque quel que soit le scénario.

**Remédiation (orientation).**

(a) Rendre le champ **facultatif** côté UI (`required` → optionnel), pour aligner avec la politique.
(b) **Supprimer le texte d'aide RSA/ASS/chômage** — c'est le déclencheur le plus fort vers la qualification Art. 9.
(c) Décider produit : champ libre (risque Art. 9 plus élevé) **vs** menu structuré (catégories de motifs sans détail clinique — réduit drastiquement le risque).

**Surface :** `src/components/booking/BookingWizard.tsx:665-689`. Effort S (UI) ; décision produit pour menu vs libre.

**Renvois croisés :** D3.1 → D1.1 (flux), D5.1 (politique).

---

# Domaine 4 — Consentement

**État réel de la couche consentement.** Consent Mode v2 est câblé correctement (7 types de stockage, défaut `denied`, `security_storage: granted`). La bannière CookieYes est chargée (`Layout.astro:133-135`). Le tag GA4 est présent (`Layout.astro:137-143`). Une race condition historique (commit `6ab6f35`) a été résolue via une Promise `__ckyAnalyticsReady`. La couche est **structuralement saine** mais présente 6 écarts (D4.1 à D4.6).

## D4.1 — `trackEvent()` sans gate de consentement (P3, ex-D4.A)

**Preuve.** `src/lib/analytics.ts:19-26` — la fonction `trackEvent()` envoie des événements **sans vérifier l'état du consentement**. Événements concernés : `booking_step_view` et `generate_lead` (contact). Appelants : `BookingWizard.tsx:935`, `useContactForm.ts:59`.

**Nuance.** Consent Mode v2 en défaut-denied supprime les cookies, mais avec `url_passthrough:true` (D4.2), des **pings sans cookie contenant l'URL partent quand même**.

**Remédiation.** Gater `trackEvent` sur `window.__ckyAnalyticsReady`, comme le fait déjà `rdv/merci.astro:314-315`. Surface : `src/lib/analytics.ts:19-26`. Effort S.

## D4.2 — `url_passthrough: true` envoie l'URL pré-consent (P3, ex-D4.B)

**Preuve.** `Layout.astro:88` — `url_passthrough: true`, basculé de `false` → `true` au commit `78fd39b`. Cette option envoie l'URL de la page dans les pings sans cookie **avant consentement**. La CNIL considère cela comme un **traitement de données personnelles avant consentement** (l'URL peut contenir des paramètres identifiants).

**Remédiation.** Revenir à `false` (sauf besoin métier documenté). Surface : `src/layouts/Layout.astro:88`. Effort XS.

## D4.3 — Consent update entièrement délégué à CookieYes (P3, ex-D4.C)

**Preuve.** Aucun `gtag('consent','update',…)` explicite dans le code. La mise à jour du consentement est **entièrement déléguée au tableau de bord CookieYes**. Si le réglage *Consent Mode v2 integration* venait à être désactivé côté CookieYes, les analytics ne s'activeraient jamais — et ce **non vérifiable dans le code**.

**Remédiation.** Vérification manuelle du tableau de bord CookieYes (réglage *Consent Mode v2 integration* activé). À documenter comme **contrôle opérationnel** (pas un ticket de code).

## D4.4 — CSP `script-src` manque `google-analytics.com` (P4, ex-D4.D)

**Preuve.** `netlify.toml:71` — inspection de la CSP : le loader GA4 (`googletagmanager.com/gtag/js`) est bien dans `script-src`, et les hits de mesure (`google-analytics.com/g/collect`) sont couverts par `connect-src`. Aucun domaine fonctionnellement manquant n'a été identifié par lecture statique. Ce constat est **à vérifier au runtime** (console du navigateur) pour confirmer l'absence de blocages résiduels — la lecture statique ne peut pas détecter les edge cases de chargement conditionnel.

**Remédiation.** Vérification runtime recommandée (console navigateur, onglet Network/Security). Si un blocage est observé, ajouter le domaine manquant à la directive CSP correspondante dans `netlify.toml:71`. Effort XS (vérification).

## D4.5 — GA4 `gtag.js` chargé inconditionnellement (P4, ex-D4.E)

**Preuve.** `Layout.astro:137` — le script GA4 `gtag.js` se charge inconditionnellement (pas de chargement différé sur consentement). C'est l'approche recommandée par Google, mais **une lecture CNIL stricte considère cela comme un traitement pré-consent** (le script s'exécute, même si les cookies sont bloqués par Consent Mode).

**Remédiation.** Chargement différé sur consentement : gate le `<script>` sur `__ckyAnalyticsReady`. Effort S.

## D4.6 — Plafond de polling `__ckyAnalyticsReady` à 6 s (P4, ex-D4.F)

**Preuve.** `Layout.astro:129` — le plafond de scrutation de `__ckyAnalyticsReady` est de **6 secondes**. Si CookieYes restaure le consentement d'un visiteur revenant plus lentement (6 s), les conversions `merci.astro` sont **ignorées silencieusement**.

**Remédiation.** Augmenter le plafond OU écouter un événement `consent` dédié au lieu de scruter. Effort S.


---

# Domaine 5 — Différence politique vs réalité

Ce domaine compare la politique de confidentialité (`src/pages/confidentialite.astro`, 354 lignes, lecture intégrale) au comportement réel du code. **Deux P1** s'y trouvent (D5.2 et D5.5), conjointement et pour des raisons différentes : D5.5 a le blast radius le plus large (tous les patients, indéfiniment) ; D5.2 est le plus facilement sanctionnable (déclaration écrite fausse). La note ne hiérarchise pas l'un au-dessus de l'autre.

## D5.1 — Motif « facultatif » (politique) vs `required` (code) (P2)

**Preuve.**

- Politique `confidentialite.astro:103` : *« Motif de consultation (facultatif) »*
- Code `BookingWizard.tsx:673` : champ `patient_reason` avec `required` et astérisque `*`.

**Écart.** Contrainte non divulguée + collecte forcée de données potentiellement sensibles. Le patient est contraint de fournir une donnée que la politique dit facultative. Le texte d'aide sollicitant RSA/ASS/chômage aggrave vers Art. 9 (voir D3.1).

**Remédiation.** Aligner l'UI sur la politique (rendre le champ facultatif) — voir D3.1 (constat transversal). Effort S.

**Renvoi croisé :** D5.1 → D3.1, D1.1.

## D5.2 — Politique nie GA4 ; GA4 est actif (P1)

**Le plus flagrant des écarts politique/réalité.**

**Preuve.**

- Politique `confidentialite.astro:137-138` :

> *« Nous n'utilisons pas d'outil d'analyse d'audience (pas de Google Analytics, pas de Matomo, etc.). »*

- Politique `confidentialite.astro:310-313` :

> *« Ce site ne dépose aucun cookie de mesure d'audience, de publicité ou de suivi. Aucun consentement aux cookies n'est requis. »*

- Code :
  - GA4 tag actif — `Layout.astro:137-143`
  - CookieYes banner active — `Layout.astro:133-135`
  - Consent Mode v2 actif
  - Événements de conversion actifs (`trackEvent`, voir D4.1)

**Qualification.** **Déclarations contraires à la réalité** — violation des Art. 13/14 RGPD (information inexacte des personnes concernées). C'est l'écart le plus trivialement sanctionnable : la contradiction est **écrite, publique et vérifiable en 30 secondes** par tout inspecteur CNIL ou toute personne concernée.

**Renvoi croisé :** D5.2 → D6.2 (facette sous-traitant : GA4 omis de la liste).

**Recommandation de résolution.** Voir encadré dédié ci-après.

## D5.3 — Promesses de rétention 3 ans / 5 ans non tenues (P2)

**Preuve.**

- Politique `confidentialite.astro:177-184` :
  - *« Données de contact : 3 ans à compter du dernier contact, conformément aux recommandations CNIL. »*
  - *« Données de rendez-vous : 5 ans à compter de la séance, correspondant au délai de prescription civile (art. 2224 du Code civil). »*
- Code : **aucune purge implémentée** (voir D2.1).

**Qualification.** Promesse réglementaire non tenue — violation Art. 5-1-e (limitation de la conservation). Ironiquement, les données sont conservées *au-delà* de la promesse, ce qui est aussi un manquement (la promesse crée une expectation légitime).

**Remédiation (direction).** Deux options :

1. **Implémenter la purge** via un cron Netlify ou `pg_cron` (purge/anonymisation à 3 ans pour les données de contact, 5 ans pour les données de RDV). C'est l'option préférable — la rétention longue est défendable (prescription civile, Art. 2224 du Code civil). Surface : nouvelle fonction planifiée + règles SQL. Effort M.
2. **Retirer les promesses chiffrées** et les remplacer par un cadre réel (ex. « conservation jusqu'à demande d'effacement »).

**Renvoi croisé :** D5.3 → D2.1.

## D5.4 — « Aucune donnée Google patient » (politique) vs Calendar écrit nom+email (P2)

**Preuve.**

- Politique `confidentialite.astro:123` :

> *« Aucune donnée Google d'un patient ou visiteur n'est jamais collectée. »*

- Code : `patient_name` + `patient_email` écrits dans Google Calendar (8 sites d'appel, voir D1.1).

**Qualification.** Affirmation fausse. La politique oublie que le nom et l'email du patient sont écrits dans l'événement calendrier pour gérer le RDV.

**Remédiation (direction).** Deux options :

1. **Corriger la politique** — écrire : *« Le nom et l'email du patient sont écrits dans l'événement calendrier pour la gestion du RDV »*. Effort S.
2. **Pseudonymiser les événements Calendar** (référence opaque côté Google + lookup dashboard côté app pour retrouver le détail). Plus sûr, plus lourd. Effort L.

## D5.5 — Droit à l'effacement Art. 17 annoncé, non implémenté (P1)

**Blast radius le plus large de tout l'audit.**

**Preuve.**

- Politique `confidentialite.astro:254` :

> *« Droit à l'effacement (art. 17 RGPD) : obtenir la suppression de vos données dans les conditions prévues par le RGPD. »*

- Code : **aucun code n'implémente ce droit** (voir D2.1).

**Qualification.** Droit fondamental annoncé, **non exécutable pour aucun patient**. Blast radius : toutes les personnes concernées, indéfiniment, sans recours. Le couple D2.1 (pas de mécanisme) + D5.3 (promesse de rétention non tenue) constitue un **échec total du droit à l'effacement**.

**Remédiation.** Voir D2.1 (facette — la remédiation technique est écrite là) + documentation du processus de demande patient (formulaire, délai, trace). Effort L (technique) + S (processus).

**Renvoi croisé :** D5.5 → D2.1.

---

## Recommandation GA4 — la note prend position (résolution χ2)

Pour D5.2 et D6.2 conjointement, la note recommande la **suppression de GA4** — c'est-à-dire aligner le code sur la politique **déjà publiée** plutôt que l'inverse.

**Raisons :**

1. Élimine trivialement le P1 de fausse déclaration (le constat disparaît avec le tag).
2. **Zéro réécriture de politique** sur ce point (la politique dit déjà « pas de GA » — il suffit que ce soit vrai).
3. Plus conforme à la doctrine CNIL pour un cabinet santé-adjacent.
4. La praticienne n'a pas de besoin analytics démontré : monocompte, acquisition par bouche-à-oreille, pas de funnel marketing à optimiser.

**Alternative documentée (si la praticienne souhaite garder l'analytics) :** divulgation de GA4 — réécriture de la politique §7 + ajout de GA4 comme sous-traitant. Coût : réécriture politique + maintenance continue de cohérence. La praticienne décide, **mais la note recommande la suppression**.

---

# Domaine 6 — Sous-traitants

Politique, section 5, `confidentialite.astro:207-240`. Liste déclarée : Supabase, Resend, Stripe, Google, Netlify.

| Sous-traitant | Listé politique ? | Réellement utilisé ? | Conforme ? |
|---|---|---|---|
| Supabase | Oui (L209) | Oui — DB principale | Oui |
| Resend | Oui (L213) | Oui — emails transactionnels | Oui |
| Stripe | Oui (L218) | Oui — paiements vidéo | Oui |
| Google | Oui (L223) — Calendar + Meet | Oui — Calendar, Meet, **+ GA4 non divulgué** | Partiel — GA4 omis |
| Netlify | Oui (L238) | Oui — hébergement + functions | Oui |
| **CookieYes** | **Non listé** | Oui — bandeau consentement + scripts | **Omis** |
| **Google Analytics (GA4)** | **Non listé** (politique dit *« pas de GA »* L137) | Oui — tag actif | **Omis + démenti explicite** |

**Constat clé.** CookieYes et GA4 sont des sous-traitants actifs non divulgués — et dans le cas de GA4, **explicitement niés** par la politique. C'est le même écart politique/réalité que D5.2 (le plus flagrant de l'audit).

## D6.1 — CookieYes sous-traitant actif non divulgué (P2)

**Preuve.** CookieYes n'apparaît pas dans la liste des sous-traitants (`confidentialite.astro:207-240`). Pourtant la bannière et les scripts CookieYes sont chargés (`Layout.astro:133-135`). CookieYes est donc un **sous-traitant actif** (dépose des cookies de préférences, exécute du JS côté patient) **non divulgué**.

**Remédiation.** Ajouter CookieYes à la section sous-traitants :

- Finalité : gestion du consentement cookies.
- Base légale : intérêt légitime.
- Durée : 12 mois.

Surface : `src/pages/confidentialite.astro:207-240`. Effort S (politique).

## D6.2 — GA4 sous-traitant actif omis et explicitement nié (P1)

**Preuve.** GA4 n'apparaît pas dans la liste des sous-traitants. Pire : la politique **dit explicitement le contraire** (*« pas de Google Analytics »* L137). C'est le **même écart que D5.2** (le plus flagrant), vu sous l'angle sous-traitants plutôt que politique.

**Remédiation.** Voir D5.2 (facette) — recommandation suppression GA4. Effort S (suppression) / M (divulgation).

**Renvoi croisé :** D6.2 → D5.2.


---

# Questions ouvertes / préoccupations non résolues

1. **Classification Art. 9 de `patient_reason`.** Avis juridique CNIL ou avocat requis. Impact direct sur les sévérités (Scénario A → D3.1, D1.1, D5.1 montent à **P1** ; AIPD probablement requise). Cette classification **ne peut pas être tranchée par audit automatique**.
2. **Scopes OAuth Google réels.** La politique cite `calendar.events` + `calendar.readonly` (`confidentialite.astro:225-226`) mais ces scopes ne sont **pas vérifiés dans la configuration OAuth live** (`src/lib/google-calendar.ts`, `src/lib/auth.server.ts`). À confirmer côté console Google Cloud.
3. **Réglage CookieYes Consent Mode v2.** Non vérifiable côté code (dépend du tableau de bord CookieYes, voir D4.3). Vérification manuelle requise.
4. **`therapist_notes` potentiellement clinique.** Ce champ pourrait relever du **secret médical** (Art. L1110-4 CSP / Art. 226-13 Code pénal) — un régime **plus strict** que le RGPD de base. Classification juridique à confirmer ; si confirmé, le champ sort du périmètre RGPD ordinaire et entre dans un régime pénal.

---

# Recommandations transversales

1. **Formaliser un registre Art. 30** (activités de traitement). L'inventaire du Domaine 1 est ~80 % d'un registre Art. 30, **obligatoire** pour tout cabinet de santé. Il manque : finalités, bases légales, destinataires, transferts hors UE, délais par finalité. Formaliser le présent inventaire comme registre Art. 30 vivant.
2. **Préparation breach Art. 33/34.** Si les logs Resend contenant `patient_reason` venaient à fuir, **aucun runbook breach n'existe**. Créer un runbook : détection, notification CNIL sous 72 h (Art. 33), communication aux patients (Art. 34), registre des violations.
3. **AIPD / DPIA.** Probablement requise si `patient_reason` est qualifié Art. 9 (Scénario A). La note recommande d'en produire une, **surtout si la classification Art. 9 est confirmée** — même dans le Scénario B, une AIPD allégée renforcerait la posture défensive.
4. **Capacité d'actionnement.** Le backlog de remédiation représente **plusieurs semaines de développement + conseil juridique externe** pour la question Art. 9. La praticienne (monocompte) doit séquencer :
   - **P1 triviaux d'abord** (suppression GA4, alignement politique `patient_reason`) — jours.
   - **P1 structurels ensuite** (effacement, rétention) — semaines.
   - **Art. 9 en parallèle** (conseil juridique) — non bloquant pour les P1 triviaux.

---

# Critère de succès / échec (résolution χ1)

La note documente explicitement le critère suivant :

> **Succès = chaque P1 est remédié en flux réel (code OU politique — changement de flux, pas cosmétique) OU explicitement accepté avec décision documentée dans les 6 mois ; ET chaque P2 a un plan de remédiation séquencé avec responsable et date.**

L'ancien critère « zéro P1 remédié = échec » est noté comme **trop permissif** (le seul P1 propre D5.2 est trivialement remédiable en 1 jour, les P1 difficiles comme D2.1/D5.5 pourraient stagner tout en satisfaisant le critère) et **rejeté**. Le critère retenu impose une **décision documentée** pour chaque P1 dans les 6 mois, ce qui empêche la stagnation silencieuse.

---

# Suivi — tickets à créer

Libellés suggérés par constat, suffisamment précis pour création post-merge mécanique. La création effective des issues GitHub est un **step post-merge explicite et tracé** : après le merge de cette note, le porteur de l'issue #72 crée les tickets listés et ferme #72.

## P1

- **[D2.1]** `feat(erasure): endpoint admin /api/admin/erasure + brancher appointments.deleted_at + cascade credits.patient_email`
  - Surface : `src/pages/api/admin/erasure.ts` (nouveau), `src/lib/erasure.ts` (nouveau), `supabase/migrations/009_erasure.sql` (nouveau).
  - Effort : L.

- **[D5.2 / D6.2]** `chore(analytics): supprimer GA4 (gtag + tag + url_passthrough + events) OU réécrire politique §7 + divulguer sous-traitant`
  - Surface : `src/layouts/Layout.astro:88,129-143`, `src/lib/analytics.ts`, `src/pages/confidentialite.astro`.
  - Effort : S (suppression) / M (divulgation).

- **[D5.5]** (facette D2.1 — même ticket technique) + `docs(erasure): documenter le processus de demande d'effacement patient (formulaire, délai, trace)`
  - Surface : documentation processus.
  - Effort : S (doc).

## P2

- **[D2.2]** `feat(retention): purge/anonymisation email_threads + FK cascade credits → appointments`
  - Surface : `supabase/migrations/002_*`, `003_*`, `008_credits.sql`.
  - Effort : M.

- **[D3.1 / D5.1]** `feat(booking): rendre patient_reason facultatif + supprimer aide RSA/ASS + décision menu structuré vs champ libre`
  - Surface : `src/components/booking/BookingWizard.tsx:665-689`.
  - Effort : S.

- **[D5.3]** `feat(retention): cron pg_cron/netlify purge 3 ans (contact) / 5 ans (RDV) OU retirer promesses chiffrées politique`
  - Surface : nouvelle fonction planifiée, `confidentialite.astro:177-190`.
  - Effort : M.

- **[D5.4]** `fix(policy): corriger « aucune donnée Google patient » (L123) OU pseudonymiser événements Calendar`
  - Surface : `confidentialite.astro:123`, `src/lib/google-calendar.ts`.
  - Effort : S (politique) / L (pseudonymisation).

- **[D6.1]** `docs(policy): ajouter CookieYes à la section sous-traitants (finalité, base légale, durée)`
  - Surface : `confidentialite.astro:207-240`.
  - Effort : S.

## P3 (regroupables)

- **[D1.2]** `fix(logs): remplacer patient_email par appointment_id dans send-reminders + console.error API`
  - Surface : `netlify/functions/send-reminders.ts:192,206,221,243,257`, `appointments/index.ts:174`, `admin/appointments/index.ts:217`.
  - Effort : S.

- **[D4.1]** `fix(consent): gater trackEvent() sur __ckyAnalyticsReady`
  - Surface : `src/lib/analytics.ts:19-26`.
  - Effort : S.

- **[D4.2]** `revert(consent): url_passthrough false (Layout.astro:88)`
  - Effort : XS.

- **[D4.3]** `ops(consent): vérifier tableau de bord CookieYes (Consent Mode v2 integration activé)`
  - Vérification manuelle (pas de code).

## P4 (regrouper dans un ticket « durcissement couche consentement »)

- **[D4.4 / D4.5 / D4.6]** `chore(consent): vérification runtime CSP, chargement GA4 différé, plafond polling __ckyAnalyticsReady`
  - Surface : `netlify.toml:71`, `src/layouts/Layout.astro:129,137`.
  - Effort : S.

---

# Annexe — fichiers inspectés

| Fichier | Rôle dans l'audit |
|---|---|
| `src/pages/confidentialite.astro` | Politique de confidentialité (354 lignes, lecture intégrale) — source de tous les constats du Domaine 5 |
| `src/pages/mentions-legales.astro` | Mentions légales |
| `supabase/migrations/001_init.sql` → `008_credits.sql` | Schéma DB — source des constats Domaines 1, 2 |
| `src/layouts/Layout.astro` | Consent Mode v2, GA4, CookieYes — source des constats Domaine 4 |
| `src/lib/analytics.ts` | `trackEvent` — D4.1 |
| `src/lib/stripe.ts` | Flux paiement — vérification D1.1 (aucune fuite) |
| `src/lib/google-calendar.ts` | Flux calendrier — D1.1, D5.4 |
| `src/lib/manual-slots.ts` | Pattern soft-delete — précision D2.1 |
| `src/lib/appointment-conflicts.ts` | Filtres `deleted_at` — D2.1 |
| `src/components/booking/BookingWizard.tsx` | Collecte `patient_reason` — D3.1, D5.1 |
| `src/emails/AppointmentRequestNotification.tsx` | Email thérapeute — D1.1 (flux Resend) |
| `src/pages/api/appointments/` | CRUD patient — D1.1, D1.2, D2.1 |
| `src/pages/api/admin/` | Routes admin — D1.1, D2.1 |
| `src/pages/api/stripe-webhook.ts` | Webhook paiement — D1.1 |
| `src/pages/api/availability.ts` | Disponibilités — D2.1 (filtre) |
| `src/pages/api/calendar/invite/[id].ts` | Invitation calendrier — D2.1 (filtre) |
| `src/pages/mes-rdvs.astro` | UI admin — D1.1, D2.1 |
| `src/pages/rdv/merci.astro` | Page de remerciement — D4.1 (pattern gate), D4.6 |
| `netlify/functions/send-reminders.ts` | Rappels, logs — D1.2, D2.1 |
| `netlify.toml` | CSP, déploiement — D4.4 |

---

*Fin de la note de constats. Document DOC-ONLY — aucune implémentation de code. Les remédiations nomment les surfaces pour scoping de tickets ; le détail d'implémentation est hors périmètre (Frame §Out of Scope).*
