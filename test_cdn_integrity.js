// Sécurité (audit du 16/11, I3) : toute bibliothèque chargée depuis un CDN (unpkg, jsDelivr, cdnjs, esm.sh) doit avoir
// une version exacte ET une empreinte (integrity) — si le CDN servait un autre fichier, le navigateur refuserait de
// l'exécuter. Une même adresse a partout la même empreinte. Mettre à jour une bibliothèque = changer la version et
// l'empreinte partout (calcul : curl -sL <adresse> | openssl dgst -sha384 -binary | openssl base64 -A).
// Le moteur ogg.wasm de l'encodeur (téléchargé à part par la bibliothèque) est vérifié dans src/backstage/40-conversion-wav-ogg.js.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

const CDN = /https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh)\/[^"'`\s)]+/;
const files = execSync('git ls-files "*.html" "*.js"', { cwd: __dirname }).toString().split('\n')
  .filter(f => f && !f.startsWith('vendor/') && !f.startsWith('supabase/') && !/^test[_-]/.test(f) && !f.startsWith('scripts/'));

const seen = {}; // adresse -> empreinte
const record = (where, url, integrity) => {
  check(`${where} : version exacte (${url.replace(/^https:\/\/[^/]+\//, '')})`, /@\d+\.\d+\.\d+/.test(url));
  check(`${where} : empreinte présente`, !!integrity);
  if (!integrity) return;
  if (seen[url] && seen[url] !== integrity) check(`${where} : même empreinte que partout ailleurs pour ${url}`, false);
  seen[url] = integrity;
};

for (const f of files) {
  const s = fs.readFileSync(path.join(__dirname, f), 'utf-8');
  // Balises <script src="…">
  for (const m of s.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    if (!CDN.test(m[1])) continue;
    const integ = (m[0].match(/\bintegrity="([^"]+)"/) || [])[1];
    record(f, m[1], integ);
    check(`${f} : crossorigin="anonymous" (exigé avec integrity)`, /\bcrossorigin="anonymous"/.test(m[0]));
  }
  // Chargement par code : x.src = '…'; x.integrity = '…';
  for (const m of s.matchAll(/(\w+)\.src = '([^']+)';([^\n]*)/g)) {
    if (!CDN.test(m[2])) continue;
    const integ = (m[3].match(new RegExp(m[1] + "\\.integrity = '([^']+)'")) || [])[1];
    record(f, m[2], integ);
  }
  // Listes d'adresses chargées par un chargeur commun (public-page.js, src/backstage/13-suivi-d-usage.js) : l'adresse doit
  // figurer dans la table d'empreintes du chargeur.
  for (const m of s.matchAll(/^\s*'(https:\/\/[^']+)',\s*$/gm)) {
    if (!CDN.test(m[1])) continue;
    const loaders = ['public-page.js', 'src/backstage/13-suivi-d-usage.js'].map(l => fs.readFileSync(path.join(__dirname, l), 'utf-8'));
    const integ = loaders.map(l => (l.match(new RegExp("'" + m[1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + "': '([^']+)'")) || [])[1]).find(Boolean);
    record(f + ' (chargeur)', m[1], integ);
  }
}
check('au moins 5 bibliothèques contrôlées', Object.keys(seen).length >= 5);
const oggWasm = fs.readFileSync(path.join(__dirname, 'src/backstage/40-conversion-wav-ogg.js'), 'utf-8');
const encTag = (fs.readFileSync(path.join(__dirname, 'src/backstage/01-tete.html'), 'utf-8').match(/wasm-media-encoders@([\d.]+)/) || [])[1];
check('moteur ogg.wasm : même version que la bibliothèque, empreinte vérifiée avant usage',
  !!encTag && oggWasm.includes(`wasm-media-encoders@${encTag}/wasm/ogg.wasm`) && /OGG_WASM_SHA384 = '[A-Za-z0-9+/=]{64}'/.test(oggWasm) && !/createOggEncoder\(\)/.test(oggWasm));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
