# Backstage LayerPitch — sources découpées (dette S4, 27/09/2026)

`layerpitch-backstage.html` (à la racine) est **fabriqué** à partir des fichiers de ce dossier : `npm run build`. Ne jamais le modifier à la main — `test_generated_files.js` échoue s'il ne correspond plus à ces sources.

Les fichiers sont des **tranches de la même page**, collées dans l'ordre de leur nom (01-, 02-, …, 20a-, 20b-, …, 90-). Les `.js` sont des tranches du même script (une seule portée, globale) : une fonction d'un fichier peut utiliser une variable d'un autre. `03-` ouvre la balise `<script>` principale et `90-` la referme.

**Numéros de version** : `npm run bump-version` met à jour les balises `?v=` dans `03-ecran-et-scripts.html`, puis reconstruit la page.

| Fichier | Contenu |
|---|---|
| 01-tete.html | début de la page (doctype, avertissement « fichier généré », en-tête) |
| 02-styles.css | toutes les règles de style du Backstage |
| 03-ecran-et-scripts.html | l'écran (menus, onglets, panneaux), les balises de scripts (numéros ?v= mis à jour par bump-version), ouverture du script principal |
| 10-ouverture.js | tout début du script principal |
| 11-verrou-de-connexion.js | verrou de connexion (redirection si pas de session) |
| 12-bulles-d-aide.js | bulles d'aide contextuelle |
| 13-suivi-d-usage.js | suivi d'usage (bêta) |
| 14-connexion-abonnement-admin.js | connexion, nom public, abonnement et palier, panneaux admin, menu du compte, cloche |
| 14a-suivi-onglets-themes.js | suivi d'usage, changement d'onglet, préréglages de thème, couleurs |
| 14b-partage-et-outils-d-affichage.js | partage sur les réseaux, éléments de listes, blocs repliables |
| 14c-catalogue-et-suppressions.js | catalogue publié, suppressions en base et fichiers à effacer |
| 14d-utilitaires.js | journal, slug, échappement, identifiants, sélecteurs de fichiers, poignées |
| 14e-editeurs-effets-triggers-curseurs.js | éditeurs d'effets, de triggers et de curseurs |
| 14f-glisser-deposer-et-dossiers.js | glisser-déposer (dont Alt + glisser), dossiers des listes |
| 14g-fichiers-et-blocs.js | fichiers (dépôt, état), migration et création des blocs d'AdReel |
| 15-selecteur-de-morceaux.js | sélecteur de morceaux (bibliothèque -> AdReel ou pack) |
| 16-bibliotheque-de-morceaux.js | bibliothèque de morceaux (liste, dossiers) |
| 17-duree-auto.js | durée automatique des fichiers |
| 18-editeur-de-morceaux-et-timeline.js | éditeur de morceau (renderLibrary) et timeline des points de boucle |
| 19-bibliotheque-sfx.js | bibliothèque Sfx et son éditeur |
| 20-reseaux-sociaux.js | réseaux sociaux |
| 20a-actions-bibliotheque-sfx.js | actions sur la bibliothèque Sfx (clics, saisies) |
| 20b-actions-bibliotheque-morceaux.js | actions sur la bibliothèque de morceaux (clics, saisies, effets, triggers, curseurs) |
| 21-insertion-de-lien.js | Cmd+K : insertion de lien |
| 22-retour-beta.js | formulaire de retour bêta |
| 23-fiche-d-implementation.js | fiche d'implémentation générée |
| 24-ordre-des-cartes.js | ordre des cartes de l'AdReel |
| 25-glisser-deposer-des-blocs.js | glisser-déposer des blocs |
| 26-construction-des-cartes.js | construction des cartes de l'AdReel |
| 27-selecteur-de-packs.js | sélecteur de packs (bloc « Packs ») |
| 28-selecteur-de-collections.js | sélecteur de collections |
| 29-selecteur-de-sfx.js | sélecteur de Sfx (bloc « Sfx ») et suite des blocs |
| 30-packs.js | onglet Packs |
| 31-collections.js | onglet Collections |
| 32-apparence.js | apparence : thème général, réglages par bloc, partage, adresse de l'AdReel |
| 33-onglet-albums.js | onglet Albums (vente d'Adaptive OST, version du compositeur) |
| 34-polices.js | polices personnalisées |
| 35-aide-a-l-implementation.js | aide à l'implémentation (Wwise, FMOD…) |
| 36-style-de-forme-d-onde.js | style de forme d'onde |
| 37-theme-carte-des-chemins.js | thème de la carte des chemins |
| 38-chargement.js | chargement du catalogue (loadData) |
| 39-brouillon-automatique.js | brouillon automatique |
| 40-conversion-wav-ogg.js | conversion WAV -> OGG |
| 41-envoi-r2-et-bibliotheque-video.js | envoi des fichiers (R2), bibliothèque vidéo |
| 42-publication.js | publication |
| 90-fin.html | fin du script principal, petit script de fin, fermeture de la page |

Après modification : `npm run build` (et `npm run bump-version` si un `.js` servi aux navigateurs a changé).
