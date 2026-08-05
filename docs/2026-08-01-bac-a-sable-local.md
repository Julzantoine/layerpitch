# ADR — Bac à sable local (test rapide de morceaux hors ligne)

*Date de la décision : 1er août 2026. Discussion menée en canal général (pas Claude Code), aucun code écrit à ce stade.*

## Contexte

Jules-Antoine a exprimé le besoin de pouvoir tester rapidement un morceau fraîchement composé, dans tous les modes de lecture disponibles, sans la charge mentale du backstage web actuel. Cause identifiée en discussion : le backstage web ne connaît qu'un seul état — "prêt à passer en bibliothèque" — ce qui fait qu'ouvrir le backstage pour tester un morceau non abouti est vécu comme prématuré, avant même toute question de nombre d'étapes ou de connexion réseau. Le point de friction réel est l'absence d'un espace à faible enjeu, distinct de l'espace de publication.

Une ambition plus large a été évoquée en amont (LayerPitch comme "terrain de jeu" pour compositeurs, au-delà du jeu vidéo) puis explicitement mise de côté pour cette décision : la cible reste le compositeur de jeu vidéo, sans dilution de positionnement marketing. L'idée d'expansion de cible est notée séparément dans `extensions-roadmap.md`, pas engagée.

## Décision

**Un outil desktop (Electron) constituant un "bac à sable" local, scopé à la bibliothèque de morceaux uniquement** (couches, modes de lecture, points de boucle) — pas aux packs, AdReels, apparence ou témoignages, qui restent exclusivement gérés dans le backstage web.

**Réutilisation du moteur de lecture partagé** : `player.js` (`window.LayerPlayerCore`) est embarqué tel quel dans le bac à sable, pour garantir que la lecture y est strictement identique à celle du web — pas de réimplémentation parallèle qui risquerait de diverger.

**Transfert par fichier, pas par synchronisation de compte** : un fichier au format `.layerpitch` (nom provisoire), exporté depuis le bac à sable et importé manuellement dans le backstage web via un nouveau bouton d'import (à construire). Le geste de transfert reste volontaire et déclenché uniquement quand le compositeur juge le morceau satisfaisant — dans les deux mécanismes envisagés (fichier ou API), cette pression psychologique de "geste définitif" est en réalité déjà réglée par la simple existence d'un espace séparé, pas par le choix du mécanisme de transfert lui-même (voir section Correction ci-dessous).

**Contenu du fichier `.layerpitch`** :
- Un fichier = un morceau (pas de session multi-morceaux dans un seul fichier).
- Audio déjà converti en OGG (léger, prêt à l'emploi côté import web) — pas les sources brutes.
- JSON conforme au schéma `library[]` réellement implémenté par le moteur de lecture au moment de l'export (aujourd'hui : statique, vertical, vertical-random, séquentiel, embranchement-vertical, `nextOptions`) — jamais un schéma en avance sur ce que le moteur sait décoder.

**Sauvegarde de session locale — fichier distinct** : contient les sources audio brutes (WAV/MP3), pour permettre de reprendre ou recommencer le travail dans le bac à sable. Poids non contraint (reste sur la machine de Jules-Antoine, ne voyage jamais vers le web).

**Rétrocompatibilité comme exigence permanente** : chaque nouvelle version du moteur de lecture (web ou bac à sable) doit continuer à savoir lire les fichiers `.layerpitch` générés par d'anciennes versions. Évolutions de schéma strictement additives, jamais destructives. Un champ de version dans le fichier sert d'identifiant, pas de base à une logique de migration complexe.

**Technologie retenue : Electron**, plutôt que Tauri. Justification : tout le pilotage de développement du projet se fait en JS (aucun développeur humain en continu sur ce projet), et Tauri implique un cœur natif en Rust qui introduirait un langage non maîtrisé dans une zone difficile à déboguer à distance. Le poids plus élevé des binaires Electron n'est pas un enjeu réel pour un outil desktop à usage personnel.

## Alternatives écartées

**Scénario B — bac à sable couvrant aussi packs/AdReels** : écarté pour cette itération, gardé en réserve dans `extensions-roadmap.md`. Raisons : duplication de logique/UI avec le backstage web (apparence, blocs, témoignages) sans réutilisation de code triviale ; un AdReel est intrinsèquement lié au partage en ligne (URL publique, témoignages liés à un vrai lien), donc moins pertinent à éditer hors ligne dans le vide ; repousse significativement le moment où l'outil devient utile.

**Transfert par synchronisation API/compte** (façon client-serveur type Native Access) : écarté au profit du fichier. Raisons retenues : indépendance vis-à-vis du calendrier de la bascule backend (le bac à sable peut exister et être utile avant même que Supabase/R2 soit en place) ; pas de système d'authentification à construire dans le bac à sable ; simplicité de développement et de maintenance.

## Correction actée en cours de discussion

Une justification initiale du choix "fichier plutôt qu'API" reposait sur l'idée que le fichier réduirait la pression psychologique de connexion. Cette justification était incorrecte : le geste de transfert est volontaire et déclenché par satisfaction du compositeur dans les deux mécanismes (fichier ou API) — c'est l'existence d'un espace séparé qui résout la pression, pas le mécanisme de transfert choisi. Le vrai argument en faveur du fichier est la simplicité de développement et l'indépendance calendaire vis-à-vis du backend, pas un gain de confort psychologique supplémentaire.

## Conséquences

- Le bac à sable peut être spécifié et développé indépendamment de la bascule backend — aucune dépendance calendaire.
- Un nouveau bouton d'import doit être ajouté au backstage web pour lire les fichiers `.layerpitch` (non construit à ce jour).
- Le format exact du fichier (structure d'archive, nommage des champs, champ de version) reste à formaliser techniquement — cette ADR fixe les principes, pas la spécification binaire/JSON complète.
- Aucun code écrit à ce stade ; discussion à reprendre en canal Claude Code une fois ce chantier priorisé.

## Statut

Réflexion actée, développement non commencé. Priorité annoncée par Jules-Antoine : basse à moyen terme (bêta et bascule backend passent avant), avec une fenêtre de réflexion plus poussée possible dans les jours suivant cette discussion (contexte vacances).
