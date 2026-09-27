# Page pack LayerPitch — sources découpées (dette S4, 27/09/2026)

`pack.html` (à la racine) est **fabriqué** à partir des fichiers de ce dossier : `npm run build`. Ne jamais le modifier à la main — `test_generated_files.js` échoue s'il ne correspond plus à ces sources.

Tranches de la même page, collées dans l'ordre de leur nom. Les `.js` sont des tranches du même script (une seule portée) : `03-` ouvre la balise `<script>` principale, `90-` la referme. `npm run bump-version` met à jour les balises `?v=` de `03-ecran-et-scripts.html`, puis reconstruit la page.

| Fichier | Contenu |
|---|---|
| 01-tete.html | début de la page (doctype, avertissement, en-tête) |
| 02-styles.css | styles de la page pack et de l'outil vidéo (le lecteur a les siens : player.css) |
| 03-ecran-et-scripts.html | chargement d'Umami, écran de la page, balises de scripts, ouverture du script principal |
| 10-donnees-et-achat.js | chargement du pack, bandeau d'aperçu, achat (Stripe) |
| 11-langue-et-theme.js | langue de la page, thème |
| 12-test-en-jeu-lecteur-video.js | « Tester en jeu » : vidéo YouTube/Vimeo à côté du lecteur |
| 13-capture-enregistrement.js | capture : armer un morceau, démarrer, arrêter l'enregistrement |
| 14-frise-libelles.js | libellés des pistes et des évènements de la frise |
| 15-frise-edition.js | frise de la capture : affichage et édition (glisser, redimensionner, groupes) |
| 16-sauvegarde-et-envois.js | sauvegarde des montages, ffmpeg, envoi vers le stockage et la bibliothèque vidéo |
| 17-export-video.js | export vidéo (rendu audio exact, incrustations, encodage) |
| 18-panneau-de-capture.js | panneau de capture (ouverture, fermeture, réglages, Versioning) |
| 19-bouton-de-capture.js | bouton et dialogue d'ouverture de l'outil vidéo |
| 20-demarrage-de-la-page.js | démarrage de la page (rendu du pack, lecteurs, achat) |
| 21-integration-publique.js | bouton « intégrer » public |
| 90-fin.html | fermeture du script et de la page |

Après modification : `npm run build` (et `npm run bump-version` si un `.js` servi aux navigateurs a changé).
