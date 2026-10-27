// Garde (27/10) : chaque fonction appelée seule sur une ligne du chargement et de la reprise de brouillon du Backstage
// (renderLibrary(); fillAppearanceFields(); …) doit exister quelque part. Cas réel : « intégration par playlist » (26/10) a retiré
// fillAllowEmbeddingField mais un appel est resté dans 38-chargement.js : le chargement s'arrêtait net sur cette ligne.
const fs = require('fs');
const path = require('path');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

const dir = path.join(__dirname, 'src/backstage');
const sources = fs.readdirSync(dir).filter(f => /\.(js|html)$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
  .concat(fs.readdirSync(__dirname).filter(f => /\.js$/.test(f) && !/^test_/.test(f)).map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')));
const all = sources.join('\n');
const defined = new Set();
for (const m of all.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
for (const m of all.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);

for (const file of ['38-chargement.js', '39-brouillon-automatique.js']) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const missing = new Set();
  // Appels sans argument enchaînés en début d'instruction : « nom(); » en tête de ligne ou après un « ; ».
  for (const m of src.matchAll(/(?:^|;)[ \t]*([A-Za-z_$][\w$]*)\(\);/gm)) if (!defined.has(m[1])) missing.add(m[1]);
  check(file + ' : toutes les fonctions appelées existent' + (missing.size ? ' (manquent : ' + [...missing].join(', ') + ')' : ''), missing.size === 0);
}

if (failures) { console.log('\n' + failures + ' échec(s)'); process.exit(1); }
console.log('\nTout est OK');
