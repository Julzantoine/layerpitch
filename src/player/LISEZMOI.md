# Lecteur LayerPitch — sources découpées (dette S4, 27/09/2026)

`player.js` (à la racine) est **fabriqué** à partir des fichiers de ce dossier : `npm run build`. Ne jamais le modifier à la main — `test_generated_files.js` échoue s'il ne correspond plus à ces sources.

Les fichiers sont des **tranches du même script**, collées dans l'ordre de leur nom : elles partagent la même portée (une seule fonction englobante, ouverte dans `01-` et fermée dans `61-`). Ce ne sont pas des modules indépendants : une fonction d'un fichier peut utiliser une variable d'un autre. Le découpage sert à s'y retrouver et à relire un thème à la fois.

| Fichier | Contenu |
|---|---|
| 01-contexte-audio-ios.js | ouverture, contexte audio, déblocage iOS, décodage |
| 02-telechargement-zip.js | téléchargement gratuit (zip dans le navigateur) |
| 03-formes-d-onde.js | formes d'onde (fonctions pures) |
| 04-etat-partage-constantes-minutages.js | état partagé de la page, constantes de volume, minutages musicaux |
| 05-journal-de-prise.js | journal de prise (Figer), repères de capture |
| 06-enchainements-purs.js | logique pure d'enchaînement (vertical-random, séquentiel) |
| 07-ligne-de-morceau.js | rendu HTML d'une ligne de morceau (buildTrackRow) |
| 08-effets-par-voix.js | chaîne d'effets par voix |
| 09-spatialisation-sfx.js | spatialisation des Sfx, tête de l'auditeur, matrice publique |
| 10-aides-rendu-hors-ligne.js | aides pour le rendu hors-ligne (outil vidéo) |
| 11-regles-entre-triggers.js | règles entre triggers |
| 12-curseurs-de-parametre.js | curseurs de paramètre (RTPC) |
| **20 à 33 : le lecteur d'un morceau** (`initTrackPlayer`, une seule fonction ouverte dans `20-` et fermée dans `33-`) | |
| 20-lecteur-debut-et-etat.js | début de la fonction, état du morceau, vitesse (pitch) |
| 21-triggers-d-effets.js | triggers d'effets : état, boutons, fusion des effets |
| 22-curseurs-execution.js | curseurs de paramètre en cours de lecture, vitesse du morceau |
| 23-journal-ducking-formes-d-onde.js | journal de prise du morceau, ducking des Sfx, formes d'onde des voix |
| 24-horloges-minutages-etapes.js | horloge de l'embranchement-vertical, minutages, tirages, étapes du séquentiel |
| 25-carte-des-chemins.js | carte des chemins du séquentiel |
| 26-moteur-sequentiel.js | moteur séquentiel (coupures, générations, seek) |
| 27-progression-et-affichage.js | barre de progression, Sfx du morceau, affichage arrêté |
| 28-moteur-simple.js | moteur simple (bouclage natif) |
| 29-moteur-quantifie.js | moteur quantifié (BPM + mesures) |
| 30-moteur-embranchement-vertical.js | moteur embranchement-vertical |
| 31-moteur-vertical-random.js | moteur vertical-random |
| 32-pause-reprise-lecture.js | pause, reprise, arrêt, lecture, nouveau tirage, boutons |
| 33-chargement-des-fichiers.js | chargement et décodage des fichiers, fin de la fonction |
| 60-init-et-modes-visuels.js | initialisation, contraste renforcé, mode nuit |
| 61-lecteur-sfx-et-exports.js | lecteur de Sfx, exports (window.LayerPlayerCore), fermeture |

Après modification : `npm run build`, puis `npm run bump-version` (player.js est servi aux navigateurs).
