# src/reel — moteur d'affichage des AdReels et des vitrines

`reel.js` est **fabriqué** à partir de ces fichiers (`npm run build`), collés dans l'ordre de leur nom. Ne jamais modifier
`reel.js` à la main (`test_generated_files.js` échoue sinon).

Sorti de `index.html` le 28/09 (espace Projet, étape 5) **sans aucun changement visible** : `test_reel_snapshots.js`
compare l'affichage d'une série d'AdReels types à l'instantané pris avant le déplacement (`test-fixtures/reel-snapshots.json`).

| Fichier | Contenu |
|---|---|
| `10-migration.js` | `genId`, `migrateBlocks` (anciens formats de blocs) |
| `20-blocs.js` | rendu des blocs : en-tête, bio, témoignages, texte, photo, packs, collections, réseaux sociaux, Sfx |
| `30-themes-et-apparence.js` | thèmes prêts à l'emploi du palier Free, réglages d'apparence par bloc et par élément |
| `35-blocs-contact-video.js` | blocs contact et vidéo, surcharges de morceau |
| `40-moteur.js` | `reelResolveTheme`, `reelApplyTheme`, `reelRenderBlocks` : ce qu'appelle une page |

## Contrat de la page hôte

Le moteur est fait de fonctions globales (scripts classiques, pas de modules, comme `player.js` et `public-page.js`). La
page qui le charge (après `public-page.js`, `player.js`, `layerpitch-social-icons.js`) doit fournir :

- `tr(clé)` (textes de la page), `pageLang` ;
- `section`, `escapeHtml`, `linkify` (tirés de `window.LayerPlayerCore`) ;
- `resolveImageUrl(fichier)` et `IMAGES_BASE` (où sont les images : médias publics pour un AdReel, fichiers du Projet
  pour une vitrine) ;
- `openLightbox(urls, index)` (agrandissement des photos) ;
- `trackPublicEvent` (fourni par `public-page.js`).
