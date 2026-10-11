// Intro d'un morceau séquentiel (08/10) : tempo et temps par mesure propres (intro.timingOwn). Sans le drapeau, le
// comportement historique est strictement conservé, même si un intro.bpm déjà enregistré traîne dans les données.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const src = read('src/player/04-etat-partage-constantes-minutages.js');
const ctx = vm.createContext({});
vm.runInContext(src + '\n;this.seqIntroSeconds = seqIntroSeconds; this.seqBlockSeconds = seqBlockSeconds;', ctx);
const intro = ctx.seqIntroSeconds, block = ctx.seqBlockSeconds;
const near = (a, b) => Math.abs(a - b) < 1e-9;

const track = { bpm: 120, beatsPerBar: 4, segmentSlots: [] };
// 1 mesure de 4 temps à 120 BPM = 2 s
track.intro = { bars: 1 };
check('historique : 1 mesure x 4 temps à 120 BPM = 2 s', near(intro(track, null), 2));
// woosh d'un temps : 1 mesure de 1 temps = 0,5 s
track.intro = { bars: 1, beatsPerBar: 1, timingOwn: true };
check('intro d\'un temps (1 x 1) à 120 BPM = 0,5 s', near(intro(track, null), 0.5));
// tempo propre
track.intro = { bars: 2, bpm: 60, beatsPerBar: 4, timingOwn: true };
check('tempo propre 60 BPM, 2 mesures de 4 temps = 8 s', near(intro(track, null), 8));
// héritage champ par champ : seuls les temps par mesure sont propres, le tempo vient du premier emplacement
const slot = { bpm: 90 };
track.intro = { bars: 1, beatsPerBar: 3, timingOwn: true };
check('tempo hérité du premier emplacement (90) : 3 temps = 2 s', near(intro(track, slot), 3 * 60 / 90));
// compatibilité : intro.bpm enregistré SANS drapeau = ignoré, comme avant
track.intro = { bars: 1, bpm: 60, beatsPerBar: 1 };
check('sans drapeau : intro.bpm / beatsPerBar enregistrés restent ignorés', near(intro(track, null), block(track, 1, null)));
// drapeau sans valeur : repli historique
track.intro = { bars: 1, timingOwn: true };
check('drapeau sans valeur : repli historique', near(intro(track, null), block(track, 1, null)));

check('exporté par le cœur du lecteur', /seqBlockSeconds, seqIntroSeconds,/.test(read('src/player/61-lecteur-sfx-et-exports.js')));
check('moteur séquentiel : utilise seqIntroSeconds', read('src/player/26-moteur-sequentiel.js').includes('seqIntroSeconds(track, firstSlot)'));
check('export vidéo : utilise seqIntroSeconds', read('capture-retarget.js').includes('C().seqIntroSeconds(dst, dstSlots[0])'));
check('éditeur : champs BPM et temps par mesure de l\'intro', /data-field="introBpm"/.test(read('src/backstage/18g-sequentiel-intro-et-emplacements.js')) && /data-field="introBeatsPerBar"/.test(read('src/backstage/18g-sequentiel-intro-et-emplacements.js')));
process.exit(failures ? 1 : 0);
