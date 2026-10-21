# Atelier vidéo LayerPitch — sources découpées (21/10/2026)

`atelier.html` (à la racine) est **fabriqué** par `npm run build` à partir des fichiers de ce dossier ET de trois fichiers partagés avec la page pack (`src/pack/02-styles.css`, `10-donnees-et-achat.js`, `11-langue-et-theme.js`). Ne jamais le modifier à la main — `test_generated_files.js` échoue s'il ne correspond plus à ses sources.

L'atelier est l'outil de capture et de Versioning vidéo (décidé par Jules-Antoine le 21/10) : il a quitté la page publique du pack. Il s'ouvre dans un cadre du Backstage (onglet Vidéo → Atelier) et de l'espace studio (onglet Vidéos, `?studio=1`). Paramètres : `id` (pack), `studio=1`, `montage` (montage à rouvrir), `lang`, `tuto`/`lesson`.

Les morceaux des deux dossiers sont triés ENSEMBLE par leur nom (une seule portée de script) : `03-` ouvre la balise `<script>` principale, `90-` la referme.

| Fichier | Contenu |
|---|---|
| 01-tete.html | début de la page (doctype, avertissement, en-tête) |
| (src/pack) 02-styles.css | styles partagés avec la page pack |
| 02b-styles-atelier.css | styles propres à l'atelier (choix du pack) |
| 03-ecran-et-scripts.html | écran de l'atelier, dialogue « choisir la vidéo », balises de scripts |
| (src/pack) 10-donnees-et-achat.js, 11-langue-et-theme.js | chargement des scripts du compte, langue, traductions |
| 13-capture-enregistrement.js | capture : armer un morceau, démarrer, arrêter l'enregistrement |
| 14-frise-libelles.js | libellés des pistes et des évènements de la frise, étiquettes des versions |
| 15-frise-edition.js | frise de la capture : affichage et édition |
| 16-sauvegarde-et-envois.js | sauvegarde des montages, ffmpeg, envoi vers le stockage et la bibliothèque vidéo |
| 17-export-video.js | export vidéo (rendu audio exact, incrustations, encodage) |
| 18-panneau-de-capture.js | panneau de capture (ouverture, fermeture, réglages, Versioning) |
| 19-bouton-de-capture.js | droits (compositeur / studio), bouton et dialogue « choisir la vidéo » |
| 20-demarrage-atelier.js | démarrage : compte, choix du pack, morceaux, leçon du tutoriel |
| 90-fin.html | fermeture du script et de la page |

Leçon du tutoriel : `atelier-lecons.js` (racine). Après modification : `npm run build` (et `npm run bump-version` si un `.js` servi aux navigateurs a changé).
