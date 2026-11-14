// 14/11 (retour d'Hugo) : depuis l'AdReel d'un autre compositeur (adresse jolie /<nom>/), ?u= n'est plus dans location.search ;
// les liens vers un pack doivent quand même porter le nom du compositeur (sinon « Pack introuvable » et « Retour » vers l'AdReel de Jules-Antoine),
// et s'ouvrir dans une nouvelle fenêtre.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync('./src/player/01-contexte-audio-ios.js', 'utf8');
const fn = src.slice(src.indexOf('function adReelFromParam()'), src.indexOf('// Traductions de l'));
let failures = 0;
const check = (l, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' - ' + l); if (!c) failures++; };
function run(url, extra) {
  const dom = new JSDOM('<!doctype html>', { url, runScripts: 'outside-only' });
  const w = dom.window; Object.assign(w, extra || {});
  return w.eval(fn + '; adReelFromParam()');
}
check('adresse jolie : le nom du compositeur est repris', run('https://x/h-delplanque-pro/', { __lpTrackContext: { type: 'adreel', id: 'main' }, __lpComposerHandle: 'h-delplanque-pro' }) === '&from=main&u=h-delplanque-pro');
check('adresse avec ?u= : inchangé', run('https://x/index.html?u=jules', { __lpTrackContext: { type: 'adreel', id: 'main' } }) === '&from=main&u=jules');
check('sans nom (AdReel de Jules-Antoine) : pas de u', run('https://x/index.html', { __lpTrackContext: { type: 'adreel', id: 'main' } }) === '&from=main');
const reel = fs.readFileSync('./src/reel/20-blocs.js', 'utf8'), row = fs.readFileSync('./src/player/07-ligne-de-morceau.js', 'utf8');
check('bloc Packs : nouvelle fenêtre', /a\.target = '_blank'[\s\S]{0,200}\.\/pack\.html/.test(reel));
check('« Fait partie du pack » : nouvelle fenêtre', /pack\.html\?id=[^`]*adReelFromParam\(\)\}" target="_blank"/.test(row));
for (const f of ['index.html', 'collection.html']) check(f + ' publie le nom capturé', fs.readFileSync(f, 'utf8').includes('window.__lpComposerHandle = composerHandleFromUrl'));
console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'); process.exit(failures ? 1 : 0);
