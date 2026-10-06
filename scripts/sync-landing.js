#!/usr/bin/env node
/**
 * LayerPitch — recopie la landing de ce dépôt (landing.html, landing-en.html, landing-assets/) vers le dépôt qui sert
 * www.layerpitch.com (Julzantoine.github.io : index.html, en.html, assets/). Les deux dépôts avaient chacun leur copie, à
 * corriger deux fois (voir la mémoire du projet) ; ce script fait la copie, avec les deux seules différences connues :
 *   - les liens FR/EN du haut de page (landing.html <-> index.html, landing-en.html <-> en.html) ;
 *   - le dossier des images (landing-assets/ <-> assets/).
 * Usage : node scripts/sync-landing.js [dossier-du-dépôt-cible]   (défaut : ../Julzantoine.github.io à côté de ce dépôt)
 * Il ne fait ni commit ni push : il écrit les fichiers, puis on relit (git diff) et on pousse soi-même.
 */
const fs = require('fs');
const path = require('path');

function transform(html) {
  return html
    .split('./landing-en.html').join('./en.html')
    .split('./landing.html').join('./index.html')
    .split('./landing-assets/').join('./assets/');
}

function sync(targetDir, sourceDir) {
  const src = sourceDir || path.join(__dirname, '..');
  const done = [];
  [['landing.html', 'index.html'], ['landing-en.html', 'en.html']].forEach(([from, to]) => {
    fs.writeFileSync(path.join(targetDir, to), transform(fs.readFileSync(path.join(src, from), 'utf8')));
    done.push(to);
  });
  const assetsSrc = path.join(src, 'landing-assets'), assetsDst = path.join(targetDir, 'assets');
  fs.mkdirSync(assetsDst, { recursive: true });
  fs.readdirSync(assetsSrc).forEach(f => { fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDst, f)); done.push('assets/' + f); });
  return done;
}

if (require.main === module) {
  const target = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'Julzantoine.github.io'));
  if (!fs.existsSync(path.join(target, 'CNAME'))) { console.error('Dossier cible introuvable ou sans CNAME : ' + target); process.exit(1); }
  console.log('Copié dans ' + target + ' :\n  ' + sync(target).join('\n  '));
}
module.exports = { transform, sync };
