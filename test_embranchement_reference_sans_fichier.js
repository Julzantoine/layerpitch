// Embranchement vertical : une boucle de référence sans fichier (ex. « Boucle 1 » vide créée avec « + Boucle ») ne doit
// pas définir le cycle : sinon les autres boucles redémarrent trop tôt et se superposent.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const src = fs.readFileSync(path.join(__dirname, 'src/player/04-etat-partage-constantes-minutages.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src + '\n;this.embrReferenceIndex = embrReferenceIndex; this.embrLoopTimingOf = embrLoopTimingOf;', ctx);
const ref = ctx.embrReferenceIndex;

check('référence = boucle initiale quand elle a un fichier', ref({ loops: [{ file: 'a.wav' }, { isInitial: true, file: 'b.wav' }] }) === 1);
check('référence vide : on prend la première boucle qui a un fichier', ref({ loops: [{ isInitial: true }, { file: 'a.wav' }, { file: 'b.wav' }] }) === 1);
check('fichier local (aperçu) reconnu', ref({ loops: [{ isInitial: true }, { localFile: {} }] }) === 1);
check('aucun fichier : comportement historique (boucle initiale)', ref({ loops: [{}, { isInitial: true }] }) === 1);
check('aucune boucle initiale ni fichier : 0', ref({ loops: [{}, {}] }) === 0);
const track = { bpm: 120, beatsPerBar: 4, loops: [{ isInitial: true, bars: 8 }, { file: 'a.wav', bars: 18, duration: 41.5, loopInBeat: 8, loopOutBeat: 72 }] };
const t = ctx.embrLoopTimingOf(track);
check('cycle lu sur la boucle qui a un fichier : 32 s (et non 16 s de la boucle vide)', Math.abs(t.cycleLength - 32) < 1e-9);
console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
