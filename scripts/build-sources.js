#!/usr/bin/env node
// scripts/build-sources.js — fabrique les gros fichiers servis aux navigateurs à partir de leurs sources découpées
// (dette S4, 27/09).
//
//   npm run build                      reconstruit player.js, layerpitch-backstage.html, pack.html, atelier.html et reel.js
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
  // Page publique d'un pack + « Tester en jeu » public (27/09) ; avertissement dans src/pack/01-tete.html.
  pack: { dir: 'src/pack', out: 'pack.html', pattern: /^\d\d[a-z]?-.*\.(html|css|js)$/, header: '' },
  // Atelier vidéo (21/10) : l'outil de capture et de Versioning, sorti de la page publique du pack et ouvert dans le Backstage
  // (onglet Vidéo) et l'espace studio (onglet Vidéos). Ses propres morceaux (src/atelier/) + ceux de la page pack qu'il partage
  // (styles, chargement des données, langue) : un seul code, jamais recopié. Morceaux triés ensemble par leur nom.
  atelier: {
    sources: [{ dir: 'src/pack', pattern: /^(02|10|11)-.*\.(css|js)$/ }, { dir: 'src/atelier', pattern: /^\d\d[a-z]?-.*\.(html|css|js)$/ }],
    out: 'atelier.html', header: '',
  },
  // Moteur d'affichage des AdReels, partagé avec les vitrines de Projet (28/09) ; avertissement dans src/reel/01-tete.js.
  reel: { dir: 'src/reel', out: 'reel.js', pattern: /^\d\d[a-z]?-.*\.js$/, header: '' },
};

function build(name, check) {
  const t = TARGETS[name];
  const sources = t.sources || [{ dir: t.dir, pattern: t.pattern }];
  const parts = [].concat(...sources.map(s => fs.readdirSync(path.join(root, s.dir)).filter(f => s.pattern.test(f)).map(f => ({ f, file: path.join(root, s.dir, f) }))))
    .sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
  const out = t.header + parts.map(p => fs.readFileSync(p.file, 'utf8')).join('');
  const target = path.join(root, t.out);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (check) return { ok: current === out, msg: current === out ? `${t.out} à jour (${parts.length} morceaux).` : `${t.out} n'est pas à jour : lance \`npm run build\` (ou il a été modifié à la main au lieu de ${sources.map(s => s.dir + '/').join(' / ')}).` };
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
