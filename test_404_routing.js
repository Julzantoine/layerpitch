// 404.html (chemin joli par compositeur) : quelles adresses mènent à quelle page, et lesquelles restent de vraies 404.
// Adresses personnalisables (27/09) : /<nom>/<adreel> -> index.html?u=<nom>&s=<adreel>.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const html = fs.readFileSync(path.join(__dirname, '404.html'), 'utf-8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function route(pathname, search) {
  let target = null;
  const location = { pathname, search: search || '', replace: u => { target = u; } };
  vm.runInNewContext(script, { location, URLSearchParams, decodeURIComponent });
  if (!target) return null;
  const [file, q] = target.split('?');
  return { file, params: Object.fromEntries(new URLSearchParams(q)) };
}
let r = route('/jean/');
check('/nom/ -> index.html?u=nom', r && r.file === '/index.html' && r.params.u === 'jean' && !r.params.s && r.params.__pretty === '/jean/');
r = route('/jean/pitch-ubisoft', '?lang=en');
check('/nom/adreel -> index.html?u=nom&s=adreel (paramètres gardés)', r && r.file === '/index.html' && r.params.u === 'jean' && r.params.s === 'pitch-ubisoft' && r.params.lang === 'en' && r.params.__pretty === '/jean/pitch-ubisoft?lang=en');
r = route('/jean/pitch-ubisoft/');
check('/nom/adreel/ (barre finale) -> même chose', r && r.params.s === 'pitch-ubisoft');
r = route('/jean/pack.html', '?id=p1');
check('/nom/pack.html -> pack.html?u=nom', r && r.file === '/pack.html' && r.params.u === 'jean' && r.params.id === 'p1' && !r.params.s);
check('/nom/inconnu.html -> vraie 404', route('/jean/secret.html') === null);
check('/favicon.ico -> vraie 404', route('/favicon.ico') === null);
check('trois segments -> vraie 404', route('/a/b/c') === null);
r = route('/vitrine/ost-foret', '?lang=en');
check('/vitrine/nom -> vitrine.html?s=nom (vitrine de Projet, 28/09)', r && r.file === '/vitrine.html' && r.params.s === 'ost-foret' && r.params.lang === 'en' && !r.params.u && r.params.__pretty === '/vitrine/ost-foret?lang=en');
check('/vitrine/fichier.html -> pas une vitrine', !(route('/vitrine/x.html') || {}).file || route('/vitrine/x.html').file !== '/vitrine.html');
console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
