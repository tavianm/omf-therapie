---
title: "Audit RGPD données patient — analyse"
description: "Investigation des 6 domaines d'exposition RGPD + shapes pour la note de constats"
issue: 72
type: analysis
date: 2026-07-11
---

## Source

Issue #72 — *« feat(rgpd): patient-data compliance audit — retention, erasure, consent, sub-processors »*. Le constat déclencheur : un cabinet de psychothérapie français collecte des données personnelles (dont `patient_reason`, texte libre santé-adjacent) sans évaluation de conformité réglementaire. La précédente revue de code a évalué la sécurité applicative mais jamais la conformité RGPD.

## Problem

Pour un cabinet santé-adjacent français, l'exposition réglementaire (sanctions CNIL, atteinte à la confiance patient) prime sur les constats techniques. Aujourd'hui, le cabinet opère sans visibilité sur : (a) quelles données vont où, (b) combien de temps elles y restent, (c) si la politique publiée reflète la réalité. Cette analyse documente l'exposition avant que la note de constats (livrable de #72) ne priorise les remédiations.

## Outcome

Une note de constats décisionnelle, mergée dans `docs/audits/`, couvrant les 6 domaines. Chaque écart est noté en sévérité (P1–P4, voir légende ci-dessous) avec une direction de remédiation. Les tickets de suivi pour les items P1/P2 sont au backlog. Cette analyse est le matériel brut qui alimentera cette note.

## Appetite

Un cycle court (≤2 jours) pour la note de constats. L'investigation (cette analyse) est déjà faite — la rédaction est mécanique à partir des constats ci-dessous.

## Légende de sévérité

| Code | Libellé | Définition |
|------|---------|------------|
| **P1** | Critique | Écart réglementaire majeur touchant les droits fondamentaux des personnes concernées, ou fausse déclaration active dans la politique. Sanction CNIL probable / atteinte directe à la confiance patient. |
| **P2** | Élevée | Écart réglementaire significatif : droit non exécutable, promesse de conservation non tenue, ou collecte non divulguée de données sensibles. |
| **P3** | Moyenne | Faiblesse technique ou d'exposition augmentant le risque (logs PII, mécanisme partiellement câblé, dépendance non vérifiable côté code). |
| **P4** | Faible | Amélioration de robustesse / bonne pratique (ex. précision CSP, edge case de polling). |

**Note sur le calibrage :** pour un cabinet de psychothérapie français, `therapist_notes` est potentiellement un contenu clinique relevant du **secret médical** (Art. L1110-4 CSP / Art. 226-13 Code pénal) — un régime *plus strict* que le RGPD de base. La classification juridique définitive de ce champ (ainsi que de `patient_reason` au regard de l'Art. 9) requiert un avis CNIL/avocat ; l'audit documente la question, ne la tranche pas (stance neutre, per Frame §Constraints).

---

## Constats par domaine (matériel brut pour la note)

### Domaine 1 — Inventaire des données

**Champs PII collectés** (table `appointments`, `supabase/migrations/001_init.sql:14-23`) :
- `patient_name`, `patient_email`, `patient_phone`, `patient_postal_code`, `patient_city` — PII standard (Art. 6)
- `patient_reason` (TEXT ≤1500, `CHECK char_length <= 1500`) — **texte libre, santé-adjacent** (question Art. 9 ouverte)
- `therapist_notes` (TEXT) — notes internes, jamais exposées au patient

**Flux externes des PII** (mapping complet via investigation) :

| Sous-traitant | Champs PII transmis | Chemin |
|---|---|---|
| **Resend (email)** | **TOUS les 6** incluant `patient_reason` en clair | `AppointmentRequestNotification.tsx:131` → thérapeute (l'unique sortie de `patient_reason` vers un sous-traitant externe) |
| **Google Calendar** | `patient_name`, `patient_email` (titre + description + attendee) | 8 sites d'appel : `appointments/[id].ts:203,254,850`, `admin/appointments/index.ts:247`, `admin/appointments/[id]/regenerate-calendar.ts:58`, `stripe-webhook.ts:231,294`(×2 chemins) |
| **Stripe** | Aucun (metadata = `appointment_id` seulement ; `patientName`/`patientEmail` sont acceptés par l'API helper mais **détruits avant l'appel** — `stripe.ts:83`) | `stripe.ts:110-125` |
| **Logs Netlify** | `patient_email` explicite (6 lignes), erreurs Supabase brutes (2 lignes, peuvent échoer le payload PII complet) | `netlify/functions/send-reminders.ts:192,206,221,243,257` ; `appointments/index.ts:174`, `admin/appointments/index.ts:217` |
| **URLs/historique** | `?name=<prénom>` sur `merci.astro` (legacy, parse mais non construit côté serveur) ; `?email=` sur admin credits | `merci.astro:28`, `admin/credits.ts:33` |

**Constat clé :** `patient_reason` (le champ le plus sensible) ne sort de la DB vers un sous-traitant externe que via un email à la thérapeute — légitime (intérêt légitime de gestion du RDV), mais stocké dans les logs d'envoi Resend. Les emails patients ne contiennent que `patient_name`. Google Calendar reçoit l'identité du patient mais jamais le motif.

> **Précision (revue architecte) :** `patient_reason` ET `therapist_notes` circulent aussi **en interne** vers l'interface d'administration : `mes-rdvs.astro:42` les inclut dans `APPOINTMENT_COLUMNS` et les sérialise dans les props de l'island admin `<AppointmentsManager>`. C'est légitime pour l'espace admin (gardé par `auth.api.getSession` + `isAdminSession`, `mes-rdvs.astro:24-31`, `noindex:true`), mais cela signifie que des données potentiellement cliniques transitent par le payload côté navigateur de l'admin. À noter pour la minimisation (ne sélectionner ces colonnes que si l'admin déplie la carte rendez-vous), pas une exposition patient.

### Domaine 2 — Rétention & effacement

**Découverte majeure :** La colonne **`appointments.deleted_at`** existe (soft-delete, `001_init.sql:79`) et est filtrée dans 8 requêtes de lecture, mais **n'est jamais écrite pour cette table**. Aucun chemin de code ne définit `appointments.deleted_at`. Le soft-delete est une colonne morte pour les données patient.

> **Précision factuelle (revue architecte) :** `deleted_at` *est* écrite ailleurs dans le codebase, mais uniquement pour la table `manual_time_slots` (`src/lib/manual-slots.ts:81`, invoqué par `src/pages/api/admin/time-slots/[id].ts:49-50`) — qui ne contient **aucune donnée patient** (juste des plages horaires). Le mécanisme de soft-delete existe donc dans le projet, mais il n'est jamais branché sur les rendez-vous.

| Question | Réponse | Preuve |
|---|---|---|
| Soft-delete utilisé pour `appointments` ? | **Non** — colonne jamais écrite | Aucun `UPDATE ... SET deleted_at` sur `appointments` ; les 8 filtres `.is('deleted_at', null)` filtrent une colonne toujours NULL |
| Hard-delete ? | Non (un seul DELETE compensateur pour rollback crédit : `admin/appointments/index.ts:232`) | Aucun chemin de purge par rétention |
| Cron de nettoyage ? | **Aucun** | 2 fonctions planifiées (`send-reminders`, `calendar-token-heartbeat`), aucune ne supprime de données ; pas de `pg_cron`, pas d'edge function de purge |
| Endpoint d'effacement (Art. 17) ? | **N'existe pas** | La politique annonce le droit (`confidentialite.astro:254`), aucun code ne l'implémente |
| Effacement réellement possible ? | Seulement via SQL manuel en prod | Aucun bouton admin, aucun workflow formulaire |

Les 8 sites de lecture qui filtrent `appointments.deleted_at IS NULL` : `src/lib/appointment-conflicts.ts:32,59`, `src/pages/api/admin/patients.ts:46`, `src/pages/api/availability.ts:69`, `src/pages/api/calendar/invite/[id].ts:26`, `src/pages/mes-rdvs.astro:51`, `netlify/functions/send-reminders.ts:126,141`.

**Tables annexes sans rétention :**
- `email_threads` (migrations 002/003) — pas de `deleted_at`, pas de purge, pas de FK vers `appointments` → métadonnées d'emails conservées indéfiniment
- `credits` / `credit_usages` (migration 008) — `credits.patient_email` survit à la suppression d'un appointment (`ON DELETE SET NULL` à la ligne 15) → l'effacement d'un RDV laisserait l'email patient dans le registre des avoirs

**Constat clé :** Les données patient (nom, email, téléphone, code postal, ville, motif, notes thérapeute, IDs Stripe, liens vidéo) **persistent indéfiniment**. La politique promet 3 ans / 5 ans (`confidentialite.astro:177-190`) — contradiction directe entre politique et implémentation (violation Art. 5-1-e, limitation de conservation).

### Domaine 3 — `patient_reason` en texte libre

**Collecte** (`BookingWizard.tsx:666-689`) :
- Champ : `<textarea>` libre, `required`, 10–1500 caractères
- Label : « Motif de consultation * » (astreint)
- Placeholder : « Décrivez brièvement ce qui vous amène à consulter... »
- **Texte d'aide qui aggrave le risque** (`BookingWizard.tsx:687-689`) : *« Si vous traversez une période financière difficile (RSA, ASS, études, chômage…), n'hésitez pas à le mentionner ici — un tarif adapté peut être proposé. »* → invite activement des **données socio-économiques** en plus des données santé

**Écart politique vs réalité (voir aussi Domaine 5) :** La politique indique « Motif de consultation **(facultatif)** » (`confidentialite.astro:103`), mais le code exige le champ (`required`, `*`). Le patient est contraint de fournir des données potentiellement sensibles que la politique dit facultatives.

**Question Art. 9 ouverte (par design, stance neutre) :**
- Si `patient_reason` est qualifié Art. 9 (donnée de santé) → nécessite consentement explicite Art. 9-2-a, encadrement renforcé, AIPD probablement requise
- Si qualifié Art. 6 (donnée personnelle ordinaire) → base contractuelle suffit, mais le texte d'aide socio-économique pousse vers Art. 9 (situation financière = donnée sensible dans certains contextes CNIL)
- **La note documente les deux scénarios et leur impact sur les sévérités, ne tranche pas.**

**Stockage :** texte clair en base (`appointments.patient_reason TEXT`), pas de chiffrement au-delà de ce que Supabase/Postgres fournit par défaut. `therapist_notes` similaire.

### Domaine 4 — Consentement (CookieYes + Consent Mode v2 + GA4)

**État réel :** Consent Mode v2 est câblé correctement (7 types, défaut denied, `security_storage: granted`). CookieYes banner chargée (`Layout.astro:133-135`). GA4 tag présent (`Layout.astro:137-143`). La race condition (commit `6ab6f35`) est résolue via Promise `__ckyAnalyticsReady`.

**Écarts :**

| # | Sévérité | Écart | Localisation |
|---|---|---|---|
| A | P3 | `trackEvent()` **sans vérification de consentement** — `booking_step_view` et `generate_lead` (contact) partent sans contrôle. Consent Mode v2 default-denied supprime les cookies, mais avec `url_passthrough:true`, des pings sans cookie avec l'URL partent quand même | `analytics.ts:19-26`, appelants `BookingWizard.tsx:935`, `useContactForm.ts:59` |
| B | P3 | `url_passthrough: true` (basculé de `false` → `true` au commit `78fd39b`) — envoie l'URL de la page dans les pings sans cookie **avant consentement**. La CNIL considère cela comme un traitement de données personnelles avant consent | `Layout.astro:88` |
| C | P3 | Aucun `gtag('consent','update',…)` explicite dans le code — la mise à jour est **entièrement déléguée au tableau de bord CookieYes**. Si le réglage « Consent Mode v2 integration » est désactivé côté CookieYes, analytics ne s'active jamais. Non vérifiable dans le code | `Layout.astro` (absent) |
| D | P4 | CSP `script-src` manque `https://www.google-analytics.com` ; `*.cookieyes.com` seulement dans `connect-src`, pas `script-src`. Blocages au runtime possibles | `netlify.toml:71` |
| E | P4 | GA4 gtag.js se charge inconditionnellement (pas de chargement différé sur consentement). Approche recommandée par Google mais lecture CNIL stricte = traitement pré-consent | `Layout.astro:137` |
| F | P4 | Plafond de scrutation 6 s sur `__ckyAnalyticsReady` — si CookieYes restaure le consentement d'un visiteur revenant plus lentement, les conversions `merci.astro` sont ignorées silencieusement | `Layout.astro:129` |

**Détail critique (recoupe Domaine 5) :** La politique de confidentialité (section 7 Cookies, `confidentialite.astro:298-313`) déclare explicitement : *« Ce site ne dépose aucun cookie de mesure d'audience, de publicité ou de suivi. Aucun consentement aux cookies n'est requis. »* — **GA4 + CookieYes sont actifs, la politique ment.** C'est l'écart politique/réalité le plus flagrant.

### Domaine 5 — Différence politique vs réalité

Lecture intégrale de `src/pages/confidentialite.astro` (354 lignes) comparée aux flux réels :

| # | Ce que dit la politique | Ce que fait le code | Sévérité |
|---|---|---|---|
| 5.1 | « Motif de consultation **(facultatif)** » (L103) | `patient_reason` est `required` avec `*` (`BookingWizard.tsx:673`) | **P2** — Contrainte non divulguée + collecte forcée de données sensibles (texte d'aide sollicitant RSA/ASS/chômage aggrave vers Art. 9) |
| 5.2 | « Nous n'utilisons pas d'outil d'analyse d'audience (pas de Google Analytics, pas de Matomo) » (L137-138) ; « Ce site ne dépose aucun cookie de mesure d'audience... Aucun consentement aux cookies n'est requis » (L310-313) | GA4 tag actif, CookieYes banner active, Consent Mode v2 actif, événements de conversion actifs | **P1** — Déclarations contraires à la réalité (Art. 13/14 : information inexacte des personnes concernées) ; le plus flagrant des écarts politique/réalité |
| 5.3 | « Données de contact : 3 ans », « Données de rendez-vous : 5 ans » (L177-184) | Aucun mécanisme de purge ; données persistées indéfiniment | **P2** — Promesse réglementaire non tenue (Art. 5-1-e, limitation de conservation) |
| 5.4 | « Aucune donnée Google d'un patient ou visiteur n'est jamais collectée » (L123) | `patient_name` + `patient_email` écrits dans les événements Google Calendar (8 sites d'appel) | **P2** — Affirmation fausse |
| 5.5 | Droit à l'effacement Art. 17 annoncé (L254) | Aucun code ne l'implémente | **P1** — Droit fondamental annoncé, non exécutable pour AUCUN patient (couple Domaine 2 + 5.3 = échec total du droit à l'effacement). Blast radius : toutes les personnes concernées, indéfiniment, sans recours |
| 5.6 | « Données de paiement : gérées directement par Stripe » (L186) ; Stripe listé comme sous-traitant | Correct — Stripe ne reçoit que `appointment_id` | ✓ Conforme |
| 5.7 | Scopes Google : `calendar.events` et `calendar.readonly` (L225-226) | À vérifier dans la config OAuth réelle (`src/lib/google-calendar.ts`, `src/lib/auth.server.ts` — hors scope de cette lecture) | À confirmer |

> **Réordonnancement (revue product-lead) :** 5.5 (absence d'effacement) et 5.2 (politique ment sur GA4) sont **tous deux P1**, pour des raisons différentes. 5.5 a le blast radius le plus large (tous les patients, indéfiniment) ; 5.2 est le plus facilement sanctionnable par la CNIL (déclaration écrite fausse). La note de constats doit les présenter conjointement comme les deux priorités P1, pas les hiérarchiser l'une au-dessus de l'autre.

### Domaine 6 — Sous-traitants

La politique (section 5, `confidentialite.astro:207-240`) liste : **Supabase, Resend, Stripe, Google, Netlify**.

| Sous-traitant | Listé dans politique ? | Réellement utilisé ? | Conforme ? |
|---|---|---|---|
| Supabase | ✓ (L209) | ✓ DB principale | ✓ |
| Resend | ✓ (L213) | ✓ emails transactionnels | ✓ |
| Stripe | ✓ (L218) | ✓ paiements vidéo | ✓ |
| Google | ✓ (L223) — Calendar + Meet | ✓ Calendar, Meet, **+ GA4 non divulgué** | Partiel — GA4 omis |
| Netlify | ✓ (L238) | ✓ hébergement + functions | ✓ |
| **CookieYes** | **✗ NON LISTÉ** | ✓ bandeau de consentement + scripts | **✗ Omis (P2)** |
| **Google Analytics (GA4)** | **✗ NON LISTÉ** (la politique dit explicitement « pas de Google Analytics » L137) | ✓ tag actif | **✗ Omis + démenti (P1, voir 5.2)** |

**Constat clé :** CookieYes et GA4 sont des sous-traitants actifs non divulgués — et dans le cas de GA4, **explicitement niés** par la politique. C'est le même écart politique/réalité que 5.2 (le plus flagrant de l'audit).

---

## Directions de remédiation par constat P1/P2 (matériel pour la note)

Pour que la note hérite de la spécificité plutôt que de devoir inventer les directions à froid (revue product-lead / doc-writer) :

| Constat | Direction de remédiation (orientation, pas implémentation) | Effort estimé |
|---|---|---|
| **5.2 / 5.6 — Politique ment sur GA4** (P1) | (a) Réécrire la section 7 Cookies + sous-traitants pour divulguer GA4 + CookieYes avec finalité, base légale, durée. (b) Décider stratégiquement : **soit** supprimer GA4 (aligner le code sur la politique actuelle), **soit** le garder et corriger la politique. La première option est plus simple et plus conforme CNIL pour un cabinet santé-adjacent. (c) Le critère d'échec de l'audit doit exiger un changement de flux (code OU politique), pas seulement un changement de texte cosmétique | S (politique) ; M si suppression GA4 |
| **5.5 + Domaine 2 — Droit à l'effacement inexistant** (P1) | (a) Implémenter un endpoint `/api/admin/erasure` (admin-only) qui annonymise les PII d'un patient (`patient_name='[supprimé]'`, email/phone null, etc.) plutôt que hard-delete (préserve l'intégrité comptable/avoirs). (b) Brancher `appointments.deleted_at` sur une action admin « Archiver/Supprimer ». (c) Gérer la cascade `credits.patient_email` (anonymisation explicite). (d) Documenter le processus pour les demandes patient via formulaire | L |
| **5.3 — Promesses de rétention non tenues** (P2) | Soit implémenter un cron Netlify `pg_cron` qui purge/anonymise selon les règles 3 ans / 5 ans, **soit** retirer les promesses chiffrées de la politique et les remplacer par un cadre réel. L'option « implémenter » est préférable (la rétention longue est défendable pour la prescription civile) | M |
| **5.1 — `patient_reason` forcé + invite socio-économique** (P2) | (a) Rendre le champ facultatif côté UI (`required` → optionnel), aligner avec la politique. (b) **Supprimer le texte d'aide** qui sollicite RSA/ASS/chômage — c'est le déclencheur le plus fort vers une classification Art. 9. (c) Décider : champ libre (risque Art. 9) vs menu structuré (catégories de motifs sans détail clinique). Le menu structuré réduit drastiquement le risque | S (UI) ; décision produit pour menu vs libre |
| **5.4 — Affirmation Google Calendar fausse** (P2) | Corriger la politique : « Le nom et l'email du patient sont écrits dans l'événement calendrier de la praticienne pour la gestion du RDV. » — ou pseudonymiser les événements Calendar (référence + lookup via dashboard), ce qui est plus sûr mais plus lourd | S (politique) ; L (pseudonymisation) |
| **Domaine 4 A — `trackEvent()` sans gate** (P3) | Gater `trackEvent` sur `window.__ckyAnalyticsReady` comme le fait déjà `merci.astro:314-316` | S |
| **Domaine 4 B — `url_passthrough: true`** (P3) | Revenir à `false` (commit `78fd39b` l'a basculé) — sauf besoin métier documenté | XS |
| **Domaine 1 — `patient_email` dans logs** (P3) | Remplacer les logs `send-reminders.ts:192,206,221,243,257` et les `console.error` d'insert par `appointment_id` seulement (jamais l'email). Logger `error.code`/`error.message`, jamais l'objet erreur brut | S |

**Items P4** (CSP précision, chargement GA4 inconditionnel, plafond polling 6s) : améliorations de robustesse, regroupables dans un ticket « durcissement couche consentement ».

## Shapes — structures possibles pour la note de constats

### Shape 1 : Par-domaine (fidèle à l'issue)

Une section par domaine (1–6), chaque section liste les constats avec sévérité + remédiation directionnelle. Résume les écarts transversaux (ex. politique/réalité) dans une section de synthèse finale.

**Trade-offs :**
- Pro : fidèle au scoping de l'issue (6 domaines explicites) ; facile à mapper aux critères d'acceptation ; le lecteur peut sauter au domaine qui l'intéresse
- Con : les constats transversaux (ex. `patient_reason` touche domaines 1, 3, 5) sont dispersés ; redondance possible

**Effort estimé : M** — 6 sections + synthèse, ~800–1200 lignes.

### Shape 2 : Par-sévérité (P1 d'abord)

Tous les constats rassemblés, triés par sévérité (P1 critique → P4 mineur). Chaque constat référence les domaines touchés. Section politique/réalité en annexe.

**Trade-offs :**
- Pro : la praticienne voit immédiatement ce qui est urgent ; facilite la priorisation des tickets de suivi ; meilleur pour un public non-technique
- Con : perd la structure de l'issue ; un même écart politique peut apparaître à plusieurs sévérités ; moins traçable comme artefact d'audit

**Effort estimé : M** — sections par sévérité + matrice de domaines en annexe.

### Shape 3 : Hybride (matrice + détails par-domaine)

Ouvre avec une **matrice de synthèse** (constats × domaines × sévérité), puis détails par-domaine. Les constats transversaux sont listés une fois dans la matrice et détaillés dans le domaine principal.

**Trade-offs :**
- Pro : vue exécutive immédiate (matrice) + détail traçable (par-domaine) ; meilleur des deux ; les écarts transversaux sont visibles sans redondance
- Con : légèrement plus long à rédiger (matrice à maintenir) ; deux lectures possibles (matrice OU détails)

**Effort estimé : M-L** — matrice + 6 sections détaillées + synthèse remédiation.

## Fit Check

**Shape 3 (Hybride) est le meilleur fit.** Raisons :
- Le critère d'acceptation de l'issue demande un inventaire complet (domaines 1–6) **et** des directions de remédiation par item — la matrice force la complétude, le détail par-domaine donne la profondeur.
- Plusieurs constats sont **transversaux** (ex. `patient_reason` touche collecte/domaine 3 + politique/domaine 5 + flux/domaine 1) — la matrice les capture sans les disperser.
- L'audience (praticienne + futur développeur des remédiations) bénéficie d'une vue exécutive (matrice P1 d'abord) ET d'un détail traçable (citations file:line).

**Éliminés :**
- Shape 1 (par-domaine pur) — disperse les constats transversaux, redondance sur politique/réalité.
- Shape 2 (par-sévérité pur) — perd la structure de l'issue et la traçabilité par-domaine ; un même écart politique éclaté à plusieurs sévérités.

**Appetite aligné :** Shape 3 (M-L) rentre dans le cycle ≤2 jours — l'investigation est faite, la rédaction est mécanique à partir des constats ci-dessus.

## Fichiers impactés (par la note de constats)

| Fichier | Nature |
|---|---|
| `docs/audits/2026-07-rgpd-patient-data.md` (nouveau) | La note de constats — livrable principal |
| `docs/audits/README.md` (nouveau, optionnel) | Index des audits si `docs/audits/` n'existe pas encore |

Aucun fichier de code modifié — c'est un livrable document.

## Préoccupations non résolues

1. **Scopes OAuth Google réels** — la politique cite `calendar.events` + `calendar.readonly` (L225-226) mais cela n'a pas été vérifié dans la config OAuth live. La note de constats doit le signaler comme « à confirmer » ou l'investiguer pendant l'implémentation.
2. **Réglage CookieYes Consent Mode v2** — non vérifiable côté code (dépend du tableau de bord CookieYes). La note doit le lister comme une vérification manuelle requise.
3. **Classification Art. 9 définitive** — hors scope (requiert avis juridique). La note documente les deux scénarios, ne tranche pas. Direction de remédiation : consulter la CNIL / un avocat.
4. **AIPD/DPIA** — l'audit peut recommander d'en faire une (surtout si `patient_reason` est qualifié Art. 9), mais ne la rédige pas.
5. **`therapist_notes` potentiellement clinique** — les notes thérapeute pourraient relever du secret médical (Art. L1110-4 CSP / Art. 226-13 Code pénal), un régime plus strict que le RGPD de base. Classification à confirmer juridiquement.
6. **Registre des activités de traitement (Art. 30)** — l'inventaire du Domaine 1 est ~80 % d'un registre Art. 30, obligatoire pour tout cabinet de santé. La note devrait recommander de le formaliser comme registre Art. 30.
7. **Préparation à la violation (Art. 33/34)** — si les logs Resend contenant `patient_reason` venaient à fuiter, quel est le processus ? Aucun runbook breach n'existe. À signaler.

## Cadrage à valider avec la praticienne (revue product-lead)

Le critère d'échec « zéro P1 remédié en 6 mois » (Frame §Premise) est **trop permissif** : le seul P1 « propre » (5.2 — politique ment sur GA4) est trivialement remédiable (réécriture texte + suppression/gate GA4 ≈ 1 jour), tandis que les remédiations difficiles et à fort impact (effacement Art. 17, cron de rétention, classification Art. 9, divulgation sous-traitants) pourraient stagner non traitées. L'audit « réussirait » sans que rien de matériel ne change.

**Critère d'échec proposé (plus exigeant) :** « En 6 mois, CHAQUE P1 est soit remédié en code/politique (changement de flux réel, pas cosmétique), SOIT explicitement accepté avec une décision documentée ; ET chaque P2 a un plan de remédiation séquencé avec responsable et date. » *Validation requise de la praticienne / du porteur de produit.*

À noter aussi :
- **Confiance patient = actif commercial.** Pour un cabinet de psychothérapie, le bouche-à-oreille patient est le canal d'acquisition dominant. Un patient qui découvre que son `patient_reason` est emailé en clair et logué, ou que la politique ment sur GA4, c'est un événement réputationnel — pas juste une amende théorique. La note devrait porter un paragraphe de cadrage risque-métier pour motiver l'action.
- **Capacité d'actionnement.** Le backlog de remédiation représente plusieurs semaines de dev + conseil juridique externe pour Art. 9. La praticienne (monocompte) peut-elle actionner P1/P2 seule ? La note devrait être honnête sur la capacité et proposer un séquencement réaliste.
- **Arbitrage conversion vs conformité.** Rendre `patient_reason` facultatif (5.1) a un coût produit : thérapeute moins préparée, séances plus courtes. La note doit reconnaître cet arbitrage pour que les tickets de remédiation soient chiffrés réalistement.
