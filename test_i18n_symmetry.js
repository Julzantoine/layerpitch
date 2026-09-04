// Vérification programmatique de la symétrie des clés FR/EN de layerpitch-i18n.js (Chantier Apparence
// Phase 3, 4 septembre) -- aucun script de ce genre n'existait avant. Charge le fichier dans un sandbox
// vm minimal (juste un objet `window`, pas de vrai DOM nécessaire) plutôt que de le require() tel quel,
// puisqu'il s'attend à trouver `window` en portée globale au chargement.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const I18N = sandbox.window.LAYERPITCH_I18N;

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

function keysOf(obj) { return obj ? Object.keys(obj).sort() : []; }

const zonesFr = Object.keys(I18N.fr || {}).sort();
const zonesEn = Object.keys(I18N.en || {}).sort();
check('mêmes zones FR/EN', zonesFr.join(',') === zonesEn.join(','));

zonesFr.forEach(zone => {
  const frKeys = keysOf(I18N.fr[zone]);
  const enKeys = keysOf((I18N.en || {})[zone]);
  const missingInEn = frKeys.filter(k => !enKeys.includes(k));
  const missingInFr = enKeys.filter(k => !frKeys.includes(k));
  check(`zone "${zone}" : clés FR présentes en EN`, missingInEn.length === 0);
  if (missingInEn.length) console.log('    manquantes en EN:', missingInEn.join(', '));
  check(`zone "${zone}" : clés EN présentes en FR`, missingInFr.length === 0);
  if (missingInFr.length) console.log('    manquantes en FR:', missingInFr.join(', '));
});

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
