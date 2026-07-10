---
issue: 72
title: "Audit de conformité RGPD — données patient (rétention, effacement, consentement, sous-traitants)"
status: approved
tier: F-full
created: 2026-07-11
---

## Problem

OMF Thérapie est un cabinet de psychothérapie français (monocompte, Oriane
Montabonnet) qui collecte des données personnelles via le formulaire de prise de
rendez-vous : nom, email, téléphone, code postal, ville, et surtout
`patient_reason` — un champ texte libre (≤1500 caractères) où le patient décrit
le motif de consultation. Pour une ligne de service qui inclut « troubles
alimentaires », ce texte libre est potentiellement une donnée à caractère
spécial (Article 9 RGPD), ou au minimum une donnée personlle santé-adjacente.

La précédente revue de code a évalué les mécanismes de sécurité (auth,
sessions, authorization) mais n'a jamais évalué la conformité réglementaire.
Pour un cabinet français santé-adjacent, l'exposition réglementaire (sanctions
CNIL, atteinte à la confiance patient) prime sur la plupart des constats
techniques. Cet audit est l'évaluation préalable à toute correction : il
documente l'exposition avant de décider des remédiations.

L'enjeu concret : sans cet inventaire, le cabinet opère à l'aveugle sur le plan
RGPD — on ne sait pas quelles données vont où, combien de temps elles y
restent, ni si la politique de confidentialité publiée reflète la réalité des
flux de données.

## Who

- **Primaire — les patients :** leurs données personnelles (et
  potentiellement santé) circulent dans Supabase, Resend, Google Calendar, et
  les logs Netlify. Leur droit RGPD à l'effacement (Art. 17) et à la limitation
  du traitement dépend de processus qui ne sont pas encore documentés.
- **Secondaire — la thérapeute (responsable du traitement) :** exposée
  personnellement aux sanctions CNIL (jusqu'à 4 % du CA ou 20 M€, bien que la
  pratique soit de sanctions proportionnelles). La confiance patient est son
  actif commercial principal.
- **Sous-traitants :** Supabase (DB), Resend (email transactionnel), Google
  (Calendar pour les RDV vidéo, Meet), Stripe (paiements vidéo), Netlify
  (hébergement + logs). Chacun doit être divulgué dans la politique avec son
  rôle.

## Constraints

- **Livrable = note de constats, pas du code.** Le résultat est un document
  Markdown dans `docs/audits/`. Aucune modification de schéma, d'API, ou d'UI
  dans ce cycle — l'implémentation fait l'objet de tickets de suivi.
- **Profondeur = constats + direction de remédiation.** Chaque écart est noté
  en sévérité (P1–P4) avec une orientation de remédiation (un paragraphe, pas
  du code). Les tickets de suivi concrets sont créés séparément après l'audit.
- **Stance réglementaire = neutre sur Art. 9.** On ne tranche pas la question
  juridique « `patient_reason` est-il une donnée Art. 9 ? » — on la documente
  comme un point ouvert et on note l'impact de chaque réponse possible sur les
  sévérités.
- **Pas d'accès au dépôt Supabase en production.** L'audit se base sur les
  migrations SQL versionnées (`supabase/migrations/001`–`008`) et le code
  applicatif, pas sur l'état live de la base.
- **Langue :** document en français (cohérent avec le métier et la politique de
  confidentialité existante).

## Out of Scope

- **Implémentation des remédiations** — chaque écart débouche sur un ticket de
  suivi, pas sur une PR dans ce cycle.
- **Classification juridique définitive d'Art. 9** — requiert un avis juridique
  (CNIL/avocat). L'audit identifie la question, ne la résout pas.
- **AIPD/DPIA formelle** — l'audit peut recommander d'en faire une, mais ne la
  rédige pas.
- **Audit de sécurité applicative** — déjà couvert par la revue précédente.
  L'audit RGPD cite les mécanismes de sécurité comme contexte, ne les
  réévalue pas.
- **Conformité hors RGPD** (accessibilité, mentions légales société, fiscalité)
  — seul le volet données personnelles est en scope.

## Premise Validity

**Success in 6 months :** Une note de constats est mergée dans `docs/audits/`,
couvrant les 6 domaines (inventaire des données, rétention/effacement,
`patient_reason`, consentement CookieYes/Consent Mode v2, diff
politique/réalité, sous-traitants). Chaque écart est noté en sévérité avec une
direction de remédiation. Des tickets de suivi existent pour les items P1/P2
dans le backlog. Observable : le document existe, est mergé, et les tickets
sont dans le backlog GitHub.

**Failure in 6 months :** Six mois après le merge de la note, on compte les PR
de suivi mergées pour les constats P1. Si **zéro** écart P1 a été remédié (ou
explicitement accepté avec une rationale documentée), l'audit a échoué à
produire du changement — il a généré un document, pas de la sécurité. C'est
falsifiable : on peut compter les PR de suivi et vérifier leur mapping aux
constats P1 de la note.

**Simplest alternative :** Une checklist mécanique couvrant seulement
l'inventaire des données (domaine 1) et le diff politique/réalité (domaine 5) —
les vérifications rapides et déterministes.

**Why not simplest :** Cette version minimale rate les jugements difficiles qui
sont le cœur du risque réglementaire : la classification Art. 9 de
`patient_reason`, le processus de rétention/effacement, la vérification du
câblage réel de Consent Mode v2, et la divulgation des sous-traitants. Sans ces
domaines, l'audit donne une fausse impression de couverture tout en laissant
les expositions les plus matérielles non évaluées.

## Complexity

**Tier : F-full** — Issue labellisée `Size: L`, portée multi-domaine (6 domaines
distincts nécessitant chacun une investigation spécialisée), avec des
interrogations réglementaires ouvertes (Art. 9) et des vérifications
trans-hypergraphiques (politique ↔ code ↔ schéma ↔ flux email).

**Signaux observés :**
- Label `Size: L` → F-full (règle de classification).
- 6 domaines d'investigation distincts — aucun n'est trivial.
- Question réglementaire ouverte (Art. 9) qui conditionne les sévérités de
  plusieurs constats — incertitude structurelle.
- Diff trans-artéfact : `confidentialite.astro` (354 lignes) à comparer aux
  flux réels (schéma SQL, API, emails, logs) — ni mécanique ni trivial.
- Livrable document (pas code) mais à décision-grade : chaque constat engage
  une direction de remédiation, ce qui exige une investigation rigoureuse au-delà
  d'un simple inventaire.
