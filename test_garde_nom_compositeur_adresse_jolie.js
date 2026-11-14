// Garde-fou (14/11) : sur l'adresse jolie /<nom>/..., 404.html passe le nom du compositeur en ?u=, puis la page remet l'adresse jolie
// (history.replaceState) et ?u= DISPARAÎT de location.search. Ce bug est revenu trois fois (4/09, 18/09, 14/11) parce que chaque correctif
// ne touchait que la page où il avait été vu, alors que d'autres codes relisent location.search après coup.
// Règle : seuls les sites de capture listés ci-dessous (lus AVANT le replaceState) ont le droit de lire ?u= ; tout autre code doit passer par
// composerHandleFromUrl (dans la page) ou window.__lpComposerHandle (dans le lecteur partagé). Un nouveau lecteur de ?u= fait échouer ce test.
const fs = require('fs'), path = require('path');
const ALLOWED = new Set([
  'index.html', 'collection.html',            // capture avant restorePrettyUrl, publiée dans window.__lpComposerHandle
  'src/pack/10-donnees-et-achat.js',          // idem pour pack.html
  'src/player/01-contexte-audio-ios.js',      // adReelFromParam : ?u= d'abord, repli sur window.__lpComposerHandle
]);
const files = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  if (e.name === 'node_modules' || e.name === '.git' || e.name === '.claude' || e.name === 'supabase') return;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (/\.(js|html)$/.test(e.name) && !/^test_/.test(e.name)) files.push(p);
});
walk('.');
const GENERATED = new Set(['player.js', 'reel.js', 'pack.html', 'atelier.html', 'layerpitch-backstage.html', 'layerpitch-cli.js']); // copies de src/
const re = /\.get\(\s*['"]u['"]\s*\)/;
let failures = 0;
const check = (l, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' - ' + l); if (!c) failures++; };
const offenders = [];
files.forEach(f => {
  const rel = f.replace(/^\.\//, '');
  if (GENERATED.has(rel)) return;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (re.test(line) && !ALLOWED.has(rel)) offenders.push(rel + ':' + (i + 1)); });
});
check('aucun code hors des sites de capture ne relit ?u= (' + offenders.join(', ') + ')', offenders.length === 0);
check('index.html publie le nom capturé', /window\.__lpComposerHandle = composerHandleFromUrl/.test(fs.readFileSync('index.html', 'utf8')));
check('collection.html publie le nom capturé', /window\.__lpComposerHandle = composerHandleFromUrl/.test(fs.readFileSync('collection.html', 'utf8')));
check('la capture précède le replaceState dans index.html', (() => { const s = fs.readFileSync('index.html', 'utf8'); return s.indexOf("window.__lpComposerHandle = composerHandleFromUrl") < s.indexOf('(function restorePrettyUrl()'); })());
check('la capture précède le replaceState dans collection.html', (() => { const s = fs.readFileSync('collection.html', 'utf8'); return s.indexOf("window.__lpComposerHandle = composerHandleFromUrl") < s.indexOf('(function restorePrettyUrl()'); })());
console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'); process.exit(failures ? 1 : 0);
