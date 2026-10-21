// Durée d'une transition séquentielle : le BPM et les temps par mesure propres comptent même si l'unité n'a jamais été
// choisie (l'éditeur affiche « Mesures » par défaut sans l'enregistrer) -- 21/10.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const src = fs.readFileSync(path.join(__dirname, 'src/player/04-etat-partage-constantes-minutages.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src + '\n;this.seqTransitionDurationSec = seqTransitionDurationSec;', ctx);
const fn = ctx.seqTransitionDurationSec;
{
  const track = { bpm: 120, beatsPerBar: 4 };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check('sans unité ni réglage propre : ancien calcul (1 mesure à 120 = 2 s)', near(fn(track, { transition: { bars: 1 } }, {}), 2));
  check('sans unité, temps par mesure propres = 2 : 1 mesure = 1 s', near(fn(track, { transition: { bars: 1, beatsPerBar: 2 } }, {}), 1));
  check('sans unité, BPM propre 60 : 1 mesure = 4 s', near(fn(track, { transition: { bars: 1, bpm: 60 } }, {}), 4));
  check('unité mesures explicite : inchangé', near(fn(track, { transition: { bars: 1, durationUnit: 'bars', beatsPerBar: 2 } }, {}), 1));
}
process.exit(failures ? 1 : 0);
