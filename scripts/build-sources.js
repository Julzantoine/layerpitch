#!/usr/bin/env node
// scripts/build-sources.js — fabrique les gros fichiers servis aux navigateurs à partir de leurs sources découpées
// (dette S4, 27/09).
//
//   npm run build                      reconstruit player.js, layerpitch-backstage.html, pack.html et reel.js
//   node scripts/build-sources.js player      (ou backstage, pack)   un seul fichier
//   node scripts/build-sources.js --check     vérifie seulement qu'ils sont à jour (test_generated_files.js)
//
// Pourquoi : player.js (7 000+ lignes) et layerpitch-backstage.html (13 000+ lignes) sont découpés en fichiers par thème
// pour qu'on s'y retrouve, mais les pages et les tests continuent de charger UN SEUL fichier -- aucun chargeur à
// modifier, aucun risque d'oublier un morceau. Les morceaux sont collés tels quels, dans l'ordre de leur nom (01-, 02-,
// 20a-, ...) : ce sont des tranches du même fichier (une seule portée), pas des modules indépendants. Ne jamais modifier
// les fichiers fabriqués à la main (voir src/*/LISEZMOI.md).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const TARGETS = {
  player: {
    dir: 'src/player', out: 'player.js', pattern: /^\d\d[a-z]?-.*\.js$/,
    header: '// FICHIER GÉNÉRÉ par scripts/build-sources.js à partir de src/player/ — ne pas le modifier ici : modifier src/player/, puis `npm run build` (voir src/player/LISEZMOI.md).\n',
  },
  // L'avertissement du Backstage est dans src/backstage/01-tete.html (juste après le doctype : un commentaire AVANT le
  // doctype ferait passer la page en mode de compatibilité).
  backstage: { dir: 'src/backstage', out: 'layerpitch-backstage.html', pattern: /^\d\d[a-z]?-.*\.(html|css|js)$/, header: '' },
  // Page publique d'un pack + outil vidéo « Test in game » (27/09) ; avertissement dans src/pack/01-tete.html.
  pack: { dir: 'src/pack', out: 'pack.html', pattern: /^\d\d[a-z]?-.*\.(html|css|js)$/, header: '' },
  // Moteur d'affichage des AdReels, partagé avec les vitrines de Projet (28/09) ; avertissement dans src/reel/01-tete.js.
  reel: { dir: 'src/reel', out: 'reel.js', pattern: /^\d\d[a-z]?-.*\.js$/, header: '' },
};

function build(name, check) {
  const t = TARGETS[name];
  const dir = path.join(root, t.dir);
  const parts = fs.readdirSync(dir).filter(f => t.pattern.test(f)).sort();
  const out = t.header + parts.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  const target = path.join(root, t.out);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (check) return { ok: current === out, msg: current === out ? `${t.out} à jour (${parts.length} morceaux).` : `${t.out} n'est pas à jour : lance \`npm run build\` (ou il a été modifié à la main au lieu de ${t.dir}/).` };
  if (current !== out) fs.writeFileSync(target, out);
  return { ok: true, msg: `${t.out} ${current === out ? 'déjà à jour' : 'reconstruit'} (${parts.length} morceaux).` };
}

module.exports = { build, TARGETS };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const names = process.argv.slice(2).filter(a => TARGETS[a]);
  let ok = true;
  (names.length ? names : Object.keys(TARGETS)).forEach(n => { const r = build(n, check); console[r.ok ? 'log' : 'error'](r.msg); ok = ok && r.ok; });
  process.exit(ok ? 0 : 1);
}
