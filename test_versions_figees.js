// Filet de sécurité (27/10, entretien du site) : toute bibliothèque chargée depuis un CDN (unpkg, jsdelivr, esm.sh) ou
// importée par une fonction serveur (npm:…) doit porter une version EXACTE (ex. @2.118.0). Sans version, ou avec « @2 »,
// le CDN sert la dernière parue : une mise à jour faite par son auteur peut casser le lecteur ou la connexion du jour au
// lendemain, sans qu'on ait rien changé. Pour monter de version : changer le numéro partout, tester, puis pousser.
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.claude']);
const EXT = /\.(html|js|mjs|ts)$/;
const CDN = /(?:unpkg\.com|cdn\.jsdelivr\.net\/npm|esm\.sh)\/((?:@[\w.-]+\/)?[\w.-]+)(@[^/'"`\s?#)]*)?/g;
const NPM = /['"]npm:((?:@[\w.-]+\/)?[\w.-]+)(@[^/'"]*)?/g;
const EXACT = /^@\d+\.\d+\.\d+$/;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)); }
    else if (EXT.test(e.name)) yield path.join(dir, e.name);
  }
}

let failures = 0, count = 0;
for (const file of walk(__dirname)) {
  if (path.basename(file) === 'test_versions_figees.js') continue;
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    for (const re of [CDN, NPM]) {
      for (const m of line.matchAll(re)) {
        count++;
        if (!EXACT.test(m[2] || '')) {
          failures++;
          console.log(`FAIL - ${path.relative(__dirname, file)}:${i + 1} : « ${m[1]}${m[2] || ''} » sans version exacte`);
        }
      }
    }
  });
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : `OK   - ${count} bibliothèques externes, toutes à version exacte\n\nALL CHECKS PASSED`);
process.exit(failures ? 1 : 0);
