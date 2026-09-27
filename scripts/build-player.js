#!/usr/bin/env node
// scripts/build-player.js — fabrique player.js à partir de src/player/*.js (dette S4, 27/09).
//
//   npm run build-player          recolle les morceaux dans player.js
//   npm run build-player -- --check   vérifie seulement que player.js est à jour (utilisé par test_player_build.js)
//
// Pourquoi : player.js (7 000+ lignes) est découpé en fichiers par thème pour qu'on s'y retrouve, mais les pages et les
// tests continuent de charger UN SEUL player.js -- aucun chargeur à modifier, aucun risque d'oublier un fichier. Les
// morceaux sont collés tels quels, dans l'ordre de leur nom (01-, 02-, ...) : ce sont des tranches du même script (une
// seule fonction englobante), pas des modules indépendants. Ne jamais modifier player.js à la main.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src', 'player');
const HEADER = '// FICHIER GÉNÉRÉ par scripts/build-player.js à partir de src/player/ — ne pas le modifier ici : modifier src/player/, puis `npm run build-player` (voir src/player/LISEZMOI.md).\n';
const parts = fs.readdirSync(dir).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
const out = HEADER + parts.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
const target = path.join(root, 'player.js');
const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
if (process.argv.includes('--check')) {
  if (current !== out) { console.error('player.js n\'est pas à jour : lance `npm run build-player` (ou player.js a été modifié à la main au lieu de src/player/).'); process.exit(1); }
  console.log(`player.js à jour (${parts.length} morceaux).`);
} else {
  if (current !== out) fs.writeFileSync(target, out);
  console.log(`player.js ${current === out ? 'déjà à jour' : 'reconstruit'} (${parts.length} morceaux).`);
}
