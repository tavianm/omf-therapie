# Refonte du poste de travail administrateur

## Target

Permettre à la thérapeute de piloter efficacement son activité sur iPad malgré plusieurs centaines de rendez-vous et des dizaines de patients, depuis un espace unique qui priorise le travail à faire, accélère la création successive de rendez-vous individuels et clarifie les disponibilités du cabinet.

## Hard constraints

- La création reste limitée à un rendez-vous par validation et doit pouvoir être répétée rapidement pour des patients différents sans recharger toute la page.
- La thérapeute doit pouvoir commencer une création avec un patient existant ou une nouvelle personne, tout en conservant les règles actuelles de statut, tarif, paiement, avoir, notification et calendrier.
- Les rendez-vous à venir, les demandes nécessitant une action et l'historique doivent rester accessibles avec environ 60 rendez-vous futurs, plus de 300 rendez-vous passés et une cinquantaine de patients, sans afficher toutes les fiches détaillées simultanément.
- Le parcours principal doit être pleinement utilisable au toucher en modes portrait et paysage sur iPad, sans action essentielle dépendante du survol.
- Tous les contrôles, états, erreurs et changements dynamiques doivent être compréhensibles au clavier et par les technologies d'assistance, avec des cibles tactiles adaptées et un contraste conforme au niveau AA.
- L'ajout d'une présence au cabinet doit continuer à prendre en charge le matin, l'après-midi et la journée complète, avec une explication visible de son effet sur les consultations en présentiel et en visio.
- La thérapeute doit pouvoir définir une marge globale après chaque séance parmi aucune, 15 minutes et 20 minutes ; cette marge doit être appliquée uniformément à tous les contrôles de disponibilité sans modifier la durée clinique affichée au patient.
- Toute mutation sensible doit rester contrôlée côté serveur et ne doit pas permettre de double réservation, y compris en cas d'actions concurrentes.
- Les libellés et retours visibles restent en français et aucune donnée clinique ou personnelle ne doit être exposée hors de la session administrateur.

## Non-goals

- Créer plusieurs rendez-vous en une seule validation, générer une série ou gérer une récurrence.
- Transformer l'espace en calendrier hebdomadaire avec glisser-déposer.
- Remplacer le calendrier externe ou afficher la marge comme un allongement de la séance dans les invitations patient.
- Créer un dossier patient médical complet, des notes cliniques structurées ou une gestion multi-praticiens.
- Ajouter des règles de marge différentes selon le patient, le type de séance ou le mode de consultation.
- Reconcevoir le parcours public de prise de rendez-vous au-delà de l'application cohérente des nouvelles règles de disponibilité.

## Done-when

- À l'ouverture, la thérapeute voit immédiatement les rendez-vous du jour, le prochain rendez-vous et les demandes nécessitant une action, sans parcourir l'historique.
- Elle peut naviguer entre une vue opérationnelle, les rendez-vous, les patients et les disponibilités avec un état actif clair et conservé pendant la session.
- Elle peut parcourir les rendez-vous futurs par période compacte, rechercher l'ensemble des rendez-vous et consulter l'historique par pages ou chargements bornés sans rendre des centaines de fiches détaillées.
- Elle peut rechercher un patient par nom, téléphone ou email, ouvrir un résumé de son activité et lancer un nouveau rendez-vous individuel prérempli depuis ce contexte.
- Elle peut enchaîner la création de rendez-vous pour plusieurs patients différents grâce à un parcours qui revient dans un état prêt pour la recherche suivante après chaque succès, sans rechargement complet.
- La création sépare clairement le choix du patient, les informations de séance, le créneau et les options exceptionnelles ; la saisie reste visible et récupérable lorsqu'un créneau est refusé.
- Une création ou une action sur un rendez-vous met à jour les vues, compteurs et détails concernés sans rechargement de l'application, avec un retour distinct pour l'enregistrement et les traitements externes encore en cours.
- Les rendez-vous passés ne dominent plus la vue principale mais restent trouvables par recherche, filtre et navigation bornée.
- La thérapeute peut ajouter ou retirer une présence au cabinet pour un matin, un après-midi ou une journée, et visualiser les prochaines présences dans un calendrier compact.
- Elle peut choisir une marge globale de 0, 15 ou 20 minutes et constater qu'un créneau commençant pendant cette marge est refusé dans les parcours public, administrateur et de report, tandis que la durée de séance reste inchangée.
- Deux créations concurrentes ne peuvent pas réserver des plages qui se chevauchent selon la durée clinique et la marge configurée.
- Le parcours complet peut être réalisé au toucher sur iPad portrait et paysage, ainsi qu'au clavier, sans contenu masqué par un panneau persistant ou par les zones sûres du système.

## Stakeholders

- Decider: propriétaire du cabinet OMF Thérapie
- Owner: mainteneur de l'application OMF Thérapie
- Consumer: thérapeute administratrice utilisant principalement un iPad

## Context

L'espace actuel repose sur de longues listes de fiches extensibles et une grande fenêtre modale de création. Ce modèle devient difficile à lire avec environ 60 rendez-vous futurs, plus de 300 rendez-vous passés et une cinquantaine de patients. Le besoin prioritaire est de traiter plusieurs patients à la suite pendant une même session administrative, avec un rendez-vous distinct créé pour chacun.
