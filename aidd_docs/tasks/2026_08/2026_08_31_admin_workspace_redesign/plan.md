---
objective: "Transformer /mes-rdvs en un poste de travail iPad lisible à grande échelle, rapide pour les créations successives et cohérent avec une marge globale entre séances."
status: reviewed
---

# Plan: Refonte du poste de travail administrateur

## Overview

| Field      | Value |
| ---------- | ----- |
| **Goal**   | Remplacer les listes de fiches et la modale centrale par un espace opérationnel compact, unifié et sûr côté planification. |
| **Source** | [`spec.md`](./spec.md) |

## Phases

| #   | Phase | File |
| --- | ----- | ---- |
| 1 | Politique de planification et marge globale | [`phase-1.md`](./phase-1.md) |
| 2 | Socle du poste de travail et rendez-vous à grande échelle | [`phase-2.md`](./phase-2.md) |
| 3 | Création successive et répertoire patients | [`phase-3.md`](./phase-3.md) |
| 4 | Disponibilités, présence au cabinet et finition iPad | [`phase-4.md`](./phase-4.md) |

## Decisions

| Decision | Why |
| -------- | --- |
| Réunir la navigation, les rendez-vous, les patients, la création et les disponibilités dans une seule island de poste de travail. | Un état React unique permet de synchroniser les compteurs et les listes après chaque mutation sans événement global ni rechargement de page. |
| Présenter les données sous forme de listes compactes bornées avec un panneau maître-détail, et réserver la fiche détaillée à l'élément sélectionné. | Plusieurs centaines de fiches complètes ne doivent ni dominer la lecture ni être rendues simultanément. |
| Remplacer la modale centrale de création par un panneau latéral en paysage et une feuille plein écran en portrait. | La saisie reste contextualisée, visible et stable sur iPad tout en laissant le planning consultable lorsque l'espace le permet. |
| Conserver l'identité patient dérivée de l'email pour cette livraison. | Le besoin porte sur la consultation et le préremplissage, pas sur un dossier patient autonome nécessitant une migration de données plus large. |
| Stocker une borne de blocage distincte de la durée clinique et sérialiser les mutations de planning en base. | La marge doit protéger tous les parcours contre les chevauchements concurrents sans allonger les invitations ni les durées affichées. |
