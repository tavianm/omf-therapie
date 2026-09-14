---
title: "Poste de travail — rafraîchissement automatique des données admin"
description: "Données du poste de travail vivantes : GET admin dédié + polling client visible-only avec backoff, état appointments possédé par le Workbench, actions sans reload, indicateur de fraîcheur — la thérapeute ne recharge plus jamais la page pour actualiser"
type: spec
issue: 165
tier: F-lite
date: 2026-09-13
status: approved
---

## Context

Promu depuis `artifacts/frames/165-poste-travail-auto-refresh-frame.md` (F-lite, approuvé). Source amont : issue #165 — en l'état, `/poste-travail/` charge les rendez-vous côté serveur au montage et les passe en props à `<Workbench client:load>` ; il n'existe **aucun** refetch client. La thérapeute garde la page ouverte toute la journée : nouvelle demande de RDV, changement de statut, paiement reçu, annulation patient — rien n'apparaît sans un rechargement manuel complet de la page. Les actions internes du Workbench aggravent le problème : `AppointmentDetail` termine chaque mutation par `window.location.reload()` (plein écran, perte du scroll et de l'état local).

Choix de mécanisme (tranché au frame, contrainte de stack) : **polling GET** côté client. Supabase Realtime/WebSocket est écarté — la stack de déploiement (Netlify, Postgres via PostgREST) n'embarque pas de canal WS dédié et l'activer est un chantier d'infrastructure hors ticket. Le dataset (praticienne unique, colonnes déjà sérialisées en props SSR) est petit ; un refetch complet à intervalle est suffisant et sans risque de désordre d'événements.

Interaction #164 (rework synthèse, ouvert) : ce ticket ne touche que la **possession des données et leur rafraîchissement** ; #164 retouche la **composition de la Synthèse**. Les deux se composent — SyntheseView continue de recevoir `appointments` en props. Aucun ordre d'atterrissage bloquant ; ce ticket évite délibérément de modifier la mise en page.

## Intent

La page poste de travail affiche des données figées au chargement alors qu'elle sert de poste de surveillance continu : la thérapeute répond aux patients sur des données potentiellement périmées et doit recharger manuellement (ou subir un reload plein écran après chaque action). Pourquoi maintenant : la page est adoptée en production (proposition B livrée par #148/#149) et le retard de réponse aux demandes patients est le coût observable de cette cécité.

## Goal

La thérapeute laisse `/poste-travail/` ouverte toute la journée : les nouvelles demandes et changements de statut apparaissent seuls, ses propres actions mettent la liste à jour sans reload plein écran, et rien de ce qu'elle n'a pas enregistré n'est jamais perdu par un rafraîchissement.

## Users

- **Primaire :** la thérapeute — surveillance continue sans action, actions sans révolution de la page.
- **Secondaire :** l'opérateur — charge API contenue (poll visible-only, backoff, pause pendant les interactions) ; les patients bénéficient de réponses plus rapides.

## Expected Behavior

**Au montage, rien ne change** : les props SSR restent l'état initial (pas de flash de chargement, comportement dégradé actuel préservé si la requête SSR a échoué). Le `Workbench` **possède** désormais la liste dans un state React initialisé depuis les props ; toutes les vues (Synthèse, Rendez-vous, Patients, tiroir de création) continuent de recevoir les mêmes props — leur contrat ne change pas.

**Un scheduler de polling** (`createAppointmentPoller`, module pur à timers injectés) déclenche un `GET /api/admin/appointments/` toutes les 30 s **uniquement si** l'onglet est visible (`document.visibilityState === 'visible'`) et le tiroir de création fermé. Les fetchs sont **single-flighted** : un tick ne peut jamais s'intercaler avec un `refresh()` en cours (une seule lane de requête). Un retour de visibilité (`visibilitychange` → visible) déclenche un refetch immédiat ; s'il tombe sur un poll en cours, il est **rejoué à la fin de ce poll** (jamais avalé). L'intervalle est une constante du module ; après chaque succès il revient à 30 s.

**Application monotone des snapshots** : chaque réponse porte un `fetchedAt` serveur ; une réponse plus ancienne que le dernier snapshot appliqué est ignorée. Un poll parti *avant* une mutation ne peut donc jamais revenir *après* le `refresh()` post-action et faire régresser l'UI vers des données pré-mutation (course lecture-après-écriture). Aucun plumbing « action en cours » n'est nécessaire : le Workbench n'a pas à connaître l'état interne des vues.

**Résilience** : un poll en échec (réseau, 5xx) conserve les données affichées, double l'intervalle (cap 5 min) et repart en arrière dès le premier succès. Aucune erreur bloquante : la page reste utilisable en données dégradées, l'indicateur de fraîcheur le signale (voir V3).

**Fin de session** : un 401/403 arrête définitivement la boucle de polling (aucune requête ultérieure) et redirige **exactement comme le guard SSR** : 401 (session absente/expirée) → `/login/?redirect=/poste-travail/` ; 403 (session non-admin) → `/login/?error=acces-refuse`. Un input non enregistré est perdu par cette navigation — conséquence acceptée d'une session expirée, pas de l'auto-refresh.

**Non-intrusion (garde forte)** : si les nouvelles données sont deep-égales à l'état courant, l'identité du tableau est conservée (aucun `setState`, aucun re-rendu) ; sinon la liste est remplacée et les états locaux non enregistrés survivent — texte et focus des notes en cours d'édition dans `AppointmentDetail`, RDV déplié, section active, filtres et sélection du tiroir. Règle d'implémentation liée : l'état local du détail n'est **jamais re-dérivé des props après le montage** (pas de `useEffect` de resynchronisation notes ← props) — c'est la seule façon structurelle de garantir la survie de la saisie quand un poll renvoie des données *modifiées*. Si le RDV ouvert disparaît du payload (soft-delete ailleurs), le détail se **ferme explicitement** — jamais une destruction silencieuse de saisie. Le polling est en pause tant que le tiroir de création est ouvert ; le `refresh()` explicite post-action contourne cette pause mais partage la lane single-flight. Les listes restent stables au rendu (clés React par `id`) — pas de clignotement.

**Réconciliation post-mutation (V2)** : après une mutation réussie suivie de `refresh()`, les états transitoires du détail sont réinitialisés (`actionLoading`, panneau d'action ouvert, message d'action) et le champ notes est ré-aligné sur la valeur serveur **uniquement si aucune édition locale non enregistrée n'est en cours** (après un `save_notes`, local et serveur coïncident ; après une action qui append un message dans les notes côté serveur, le ré-alignement reflète la nouvelle valeur — sauf édition locale plus récente, qui gagne).

**Actions sans reload** : après une mutation réussie (changement de statut, notes, régénération calendrier, création de RDV), les composants appellent le `refresh()` fourni par le Workbench au lieu de `window.location.reload()` (3 sites : les 2 de `AppointmentDetail`, celui du `CreateAppointmentDrawer`) — la liste se met à jour in place, scroll et contexte préservés. En cas d'échec du refresh post-action, les données affichées restent cohérentes (dernier snapshot appliqué) et l'erreur est loguée silencieusement, sans bloquer le retour d'action déjà réussi.

**Indicateur de fraîcheur** : caché jusqu'au premier poll réussi (y compris en cas de dégradation SSR — page rendue avec `[]`), puis texte discret (« Mis à jour à HH:MM ») dans la zone d'en-tête de la Synthèse ; en échec persistant, il bascule sur « Données du HH:MM — hors ligne ». Aucun spinner bloquant, aucune modale.

**Endpoint** : `GET /api/admin/appointments/` réutilise exactement la requête SSR (mêmes colonnes explicites — qui incluent délibérément `therapist_notes` et `patient_reason`, contrat actuel des props SSR —, soft-delete exclu, tri `scheduled_at desc` ; aucune colonne hors de cette liste). Réponse `Cache-Control: no-store` sur le succès comme sur les erreurs : un endpoint dont la valeur est la fraîcheur ne doit être cacheable par aucune couche. La requête partagée vit dans `src/lib/admin-appointments.ts` (`fetchActiveAppointments()`) et remplace les copies dupliquées des deux pages `.astro` (zéro delta comportemental, même contrat de dégradation : erreur → tableau vide, jamais de cast sur la branche erreur).

## Data Model & Consumers

- `Appointment` — inchangé. Aucune migration, aucune colonne nouvelle.
- Réponse GET — enveloppe `{ appointments: Appointment[]; fetchedAt: string }` (ISO 8601, généré côté serveur, sert de marqueur monotone d'application des snapshots). L'enveloppe distingue une liste vide légitime d'une réponse malformée et laisse un champ d'évolution sans casser le consommateur.
- `AppointmentPoller` (pur) — `src/utils/appointment-poller.ts` (**client-safe** : `src/lib/**` est server-only, interdit d'import depuis les îles — le poller vit donc en `utils/`, comme `workbench.ts`/`date.ts`). `createAppointmentPoller({ fetchAppointments, isVisible, isPaused, onSuccess, onAuthError, onError, now?, setTimeout?, clearTimeout? })` → `{ start(), stop(), triggerRefresh() }` ; `isVisible`/`isPaused` sont des `() => boolean` **évaluées à chaque tick et à chaque `triggerRefresh()`** (le test simule le changement en mutant la valeur retournée, pas en re-montrant le hook). Machine à états `idle → polling → backing-off → stopped` ; fetchs single-flighted ; application monotone par `fetchedAt` ; testable en environnement node avec `vi.useFakeTimers` (le repo n'a ni jsdom ni @testing-library — le hook React reste une coquille mince, la logique est dans le module pur ; les assertions d'UI passent par les specs Playwright existantes du repo).
- `useAppointmentsPolling` (hook) — adapte le poller au cycle de vie React : `visibilitychange`, cleanup au démontage, garde tiroir ouvert passée en `isPaused`.

| Consommateur | Champs | Quand | Statut |
|---|---|---|---|
| `Workbench.tsx` | `appointments` (state), `refresh()`, `lastUpdated`, `isStale` | montage + polls | ce ticket |
| `SyntheseView` / `RendezVousView` / `PatientsView` | `appointments` (props, inchangé) | chaque render | inchangé |
| `CreateAppointmentDrawer` | `appointments` (préfill patients) + garde pause | ouverture/édition | ce ticket (garde + reload→refresh) |
| `AppointmentDetail` | `refresh()` post-action + contrat de réconciliation | mutations réussies | ce ticket |
| `src/pages/api/admin/appointments/index.ts` | GET handler (s'ajoute au POST existant), `Cache-Control: no-store` | poll client | ce ticket |
| `mes-rdvs.astro` / `poste-travail.astro` | `fetchActiveAppointments()` (helper partagé) | SSR | refactor zéro-delta |

## Breadboard

| ID | Élément | Handler | Données |
|---|---|---|---|
| N1 | `fetchActiveAppointments()` — `src/lib/admin-appointments.ts` | SSR (2 pages) + route GET | colonnes explicites, `deleted_at is null`, tri desc ; erreur → `[]` |
| N2 | `GET /api/admin/appointments/` | guard `getSession` + `isAdminSession` → 401/403 ; `Cache-Control: no-store` | `{ appointments, fetchedAt }` |
| N3 | `createAppointmentPoller()` — module pur (`src/utils/appointment-poller.ts`, client-safe) | timers injectés ; intervalle 30 s, backoff ×2 cap 5 min ; single-flight + monotonic `fetchedAt` | machine à états + callbacks |
| N4 | `useAppointmentsPolling()` — hook (`src/hooks/`) | `visibilitychange`, cleanup, `isPaused` (tiroir) | state appointments + `refresh()` |
| N5 | Workbench — lift `appointments` en state, passe `refresh`/indicateur | sections + tiroir | props SSR = initial |
| N6 | `AppointmentDetail` + `CreateAppointmentDrawer` — `refresh()` remplace `reload()` ; réconciliation post-mutation | mutations admin | in place |
| U1 | Indicateur de fraîcheur — en-tête Synthèse | `lastUpdated` / `isStale` | texte discret |

## Slices

| # | Slice | Démo |
|---|-------|------|
| V1 (N1→N5) | Données vivantes | un RDV créé/modifié en base (ou via un second onglet) apparaît sur la page ouverte sans aucune action, sans reload ; onglet masqué = zéro requête |
| V2 (N6) | Actions sans reload | accepter/refuser/notes/régénérer/créer → liste à jour in place, plus jamais `window.location.reload()`, détail réconcilié |
| V3 (U1) | Indicateur de fraîcheur | « Mis à jour à HH:MM » ; débrancher le réseau → « Données du HH:MM — hors ligne », rebrancher → retour normal |

## Success Criteria

- [ ] **SC1 — Endpoint admin authentifié** : `GET /api/admin/appointments/` exige une session admin vérifiée ; la réponse admin liste exactement les colonnes SSR — liste qui inclut délibérément `therapist_notes` et `patient_reason` (contrat actuel des props SSR) — et aucune colonne hors de cette liste.

```yaml
claim:   authz
priced:  "seule une session admin vérifiée peut lire la liste des rendez-vous via le nouvel endpoint ; toute autre requête est refusée sans divulguer la moindre ligne"
not:     "vérifier seulement que la route répond / qu'un cookie est présent / tester uniquement le chemin 200 / épingler l'oracle sur une liste qui serait plus restreinte que le contrat SSR"
oracles: ["GET sans session → 401, corps sans aucune donnée appointment", "GET session non-admin → 403", "GET admin → 200 dont les clés de chaque ligne == APPOINTMENT_COLUMNS + id, pas une de plus ni une de moins (comparaison littérale des deux ensembles)"]
```

- [ ] **SC2 — Données vivantes, sans régression cachée** : page visible et non verrouillée → un refetch part à chaque intervalle (30 s) ; un RDV inséré en base apparaît dans Synthèse et Rendez-vous sans interaction ni reload. Les fetchs sont single-flighted et l'application des snapshots est monotone par `fetchedAt`. Vérifié au poller pur avec timers factices : tick → exactement 1 fetch → données remplacées ; les courses ci-dessous ne peuvent pas se produire.
- [ ] **SC2a — Course lecture-après-écriture** : un poll parti avant une mutation et résolu après le `refresh()` post-action est **ignoré** (`fetchedAt` antérieur au dernier snapshot appliqué) — l'UI ne régresse jamais vers des données pré-mutation ; tick et `refresh()` partagent une seule lane (jamais deux fetchs simultanés).
- [ ] **SC3 — Visibilité** : onglet masqué → zéro fetch quelle que soit la durée ; retour au premier plan → 1 refetch immédiat ; si ce refetch tombe sur un poll en cours, il est **rejoué à la fin de ce poll** (jamais silencieusement avalé).
- [ ] **SC4 — Résilience** : échec réseau/5xx → données affichées conservées, intervalle doublé à chaque échec consécutif (cap 5 min), retour à 30 s au premier succès ; aucune erreur bloquante rendue.
- [ ] **SC5 — Non-intrusion** : aucun rafraîchissement n'écrase une saisie non enregistrée — **y compris un poll qui renvoie des données modifiées** ; l'état local du détail n'est jamais re-dérivé des props après le montage ; RDV ouvert absent du payload → fermeture explicite du détail ; polling en pause tant que le tiroir de création est ouvert. Oracles 1, 2 et 4 vérifiés en Playwright e2e (le repo a un environnement e2e) ; oracle 3 (tiroir) vérifié au poller pur.

```yaml
claim:   fail-closed
priced:  "aucun rafraîchissement automatique ne peut effacer ou écraser une saisie non enregistrée de la thérapeute — quel que soit le moment du poll ET quel que soit le contenu renvoyé (identique ou modifié)"
not:     "vérifier seulement que les données sont remplacées / tester uniquement un poll dont les données n'ont pas changé / tester seulement le cas page au repos"
oracles: ["notes modifiées non enregistrées + poll renvoyant des données MODIFIÉES (nouvelle ligne, statut changé) → le texte saisi et le focus survivent à l'écran (e2e)", "RDV ouvert disparaît du payload → le détail se ferme explicitement, la saisie n'est pas détruite sans décision visible (e2e)", "tiroir de création ouvert → 0 fetch pendant toute l'ouverture (poller pur, timers factices)", "RDV déplié + poll → le détail reste ouvert sur le même RDV (e2e)"]
```

- [ ] **SC6 — Actions sans reload + réconciliation** : après une mutation admin réussie (statut, notes, régénération calendrier, création), la liste se met à jour in place ; `window.location.reload()` a disparu du Workbench et de ses vues (3 sites : ×2 `AppointmentDetail`, ×1 `CreateAppointmentDrawer`) ; les états transitoires du détail sont réinitialisés et le champ notes n'est ré-aligné serveur que si aucune édition locale non enregistrée n'est en cours.
- [ ] **SC7 — Fin de session** : un 401/403 pendant le polling arrête la boucle définitivement (aucune requête ultérieure, y compris après retour de visibilité) et redirige comme le guard SSR : 401 → `/login/?redirect=/poste-travail/`, 403 → `/login/?error=acces-refuse`.

```yaml
claim:   fail-closed
priced:  "une session expirée ne peut jamais laisser une boucle de polling marteler l'endpoint : la boucle est irrévocablement arrêtée avant toute redirection"
not:     "vérifier seulement qu'une redirection a lieu / compter les requêtes avant redirection sans vérifier l'absence de requêtes après"
oracles: ["401 au poll → 0 requête supplémentaire sur l'horloge factice, tous les événements de visibilité simulés", "403 au poll → même arrêt irrévocable", "401 → /login/?redirect=/poste-travail/ ; 403 → /login/?error=acces-refuse (miroir exact du guard SSR)"]
```

- [ ] **SC8 — Équivalence et non-régression** : l'extraction de `fetchActiveAppointments()` laisse `/mes-rdvs/` et `/poste-travail/` à l'identique (mêmes colonnes, même dégradation erreur → `[]` sans cast sur branche erreur) ; suites existantes vertes sans modification de contrat ; chemin patient intact.

## Hors périmètre

Auto-refresh de `/mes-rdvs/` (proposition A reste figée au chargement — elle vit encore mais n'est plus la cible d'investissement), Supabase Realtime/WebSocket, notifications push hors navigateur, refonte visuelle au-delà de l'indicateur, données propres à `DisponibilitesView` (gère déjà ses propres fetchs), pagination/filtrage serveur de la liste — follow-up déclenché quand la réponse GET dépasse ~2 000 lignes ou ~500 Ko (l'historique complet est re-téléchargé à chaque poll et grossit sans borne avec les années), refonte des statuts/API métier.
