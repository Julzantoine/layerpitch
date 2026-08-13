// Extrait uniquement la fonction createSectionPlaybackScheduler de player.js et l'évalue isolément —
// elle n'a aucune dépendance à window/ctx/DOM, donc pas besoin de jsdom ni d'AudioContext pour la tester.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8');
const startMarker = 'function createSectionPlaybackScheduler(playableSections, options) {';
const startIdx = src.indexOf(startMarker);
if (startIdx === -1) throw new Error('createSectionPlaybackScheduler not found in player.js');
// Trouve l'accolade fermante correspondante par comptage de profondeur (pas de template literals à
// l'intérieur de cette fonction, donc un comptage naïf est fiable ici).
let depth = 0, i = startIdx, started = false;
while (i < src.length) {
  const c = src[i];
  if (c === '{') { depth++; started = true; }
  else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
  i++;
}
const fnSrc = src.slice(startIdx, i);
const createSectionPlaybackScheduler = eval('(' + fnSrc.replace('function createSectionPlaybackScheduler', 'function') + ')');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
function sameSeq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------------- Scénario 1 : une seule section, boucles infinies (= ancien vertical-random) ----------------
{
  const sched = createSectionPlaybackScheduler([{ maxLoops: null }], { randomize: false, hasIntro: false, hasOutro: false });
  const results = [];
  for (let k = 0; k < 5; k++) results.push(sched.decideNext());
  check('scénario 1 : reste toujours sur la section 0', results.every(r => r.type === 'section' && r.index === 0));
  check('scénario 1 : "Départ" seulement sur le tout premier passage', results[0].isFirstEverForThisSection === true && results.slice(1).every(r => r.isFirstEverForThisSection === false));
}

// ---------------- Scénario 2 : 3 sections, ordre fixe, maxLoops variés ----------------
{
  const sched = createSectionPlaybackScheduler(
    [{ maxLoops: 2 }, { maxLoops: 1 }, { maxLoops: null }],
    { randomize: false, hasIntro: false, hasOutro: false }
  );
  const seq = [];
  for (let k = 0; k < 10; k++) seq.push(sched.decideNext().index);
  // Attendu : A joue 2x (boucles), B joue 1x, C joue en boucle indéfiniment (maxLoops null) tant qu'on
  // ne force rien manuellement -> 0,0,1,2,2,2,2,2,2,2
  check('scénario 2 : séquence attendue (A x2, B x1, puis C indéfiniment)',
    sameSeq(seq, [0, 0, 1, 2, 2, 2, 2, 2, 2, 2]));
}

// ---------------- Scénario 3 : "Aller vers la section suivante" force l'avancement sans répétition en plus ----------------
{
  const sched = createSectionPlaybackScheduler(
    [{ maxLoops: null }, { maxLoops: null }, { maxLoops: null }],
    { randomize: false, hasIntro: false, hasOutro: false }
  );
  const seq = [];
  seq.push(sched.decideNext().index); // 0 (premier passage, Départ)
  seq.push(sched.decideNext().index); // 0 (boucle infinie, resterait indéfiniment)
  sched.requestGoToNextSection();
  seq.push(sched.decideNext().index); // doit sauter directement à 1, PAS rejouer 0 une fois de plus
  seq.push(sched.decideNext().index); // 1 (reboucle sur elle-même, infini)
  sched.requestGoToNextSection();
  seq.push(sched.decideNext().index); // 2
  sched.requestGoToNextSection();
  seq.push(sched.decideNext().index); // reboucle sur 0 (fin de cycle)
  check('scénario 3 : "section suivante" avance sans répétition supplémentaire', sameSeq(seq, [0, 0, 1, 1, 2, 0]));
}

// ---------------- Scénario 4 : intro puis première section, "Départ" une seule fois ----------------
{
  const sched = createSectionPlaybackScheduler([{ maxLoops: null }], { randomize: false, hasIntro: true, hasOutro: false });
  const first = sched.decideNext();
  const second = sched.decideNext();
  const third = sched.decideNext();
  check('scénario 4 : intro jouée en tout premier', first.type === 'intro');
  check('scénario 4 : puis section 0 avec Départ', second.type === 'section' && second.index === 0 && second.isFirstEverForThisSection === true);
  check('scénario 4 : passages suivants sans Départ', third.type === 'section' && third.isFirstEverForThisSection === false);
}

// ---------------- Scénario 5 : "Aller vers la fin" avec outro définie ----------------
{
  const sched = createSectionPlaybackScheduler([{ maxLoops: null }], { randomize: false, hasIntro: false, hasOutro: true });
  sched.decideNext(); // section 0, en cours de lecture
  sched.requestGoToEnd();
  const next = sched.decideNext();
  check('scénario 5 : "aller vers la fin" programme l\'outro (attend la fin du générateur en cours)', next.type === 'outro');
  const after = sched.decideNext();
  check('scénario 5 : rien après l\'outro (reprend la boucle normale, ici on ne teste que le point de rupture)', after.type === 'section');
}

// ---------------- Scénario 6 : "Aller vers la fin" SANS outro -> fin naturelle (comme le séquentiel existant) ----------------
{
  const sched = createSectionPlaybackScheduler([{ maxLoops: null }], { randomize: false, hasIntro: false, hasOutro: false });
  sched.decideNext();
  sched.requestGoToEnd();
  const next = sched.decideNext();
  check('scénario 6 : sans outro, "aller vers la fin" ne programme rien (fin naturelle)', next === null);
}

// ---------------- Scénario 7 : brassage complet — chaque section joue exactement une fois par cycle ----------------
{
  const sched = createSectionPlaybackScheduler(
    [{ maxLoops: 1 }, { maxLoops: 1 }, { maxLoops: 1 }, { maxLoops: 1 }],
    { randomize: true, hasIntro: false, hasOutro: false }
  );
  const cycle1 = [sched.decideNext().index, sched.decideNext().index, sched.decideNext().index, sched.decideNext().index];
  const cycle2 = [sched.decideNext().index, sched.decideNext().index, sched.decideNext().index, sched.decideNext().index];
  check('scénario 7 : chaque cycle contient bien les 4 sections une fois chacune (cycle 1)', sameSeq([...cycle1].sort(), [0, 1, 2, 3]));
  check('scénario 7 : chaque cycle contient bien les 4 sections une fois chacune (cycle 2)', sameSeq([...cycle2].sort(), [0, 1, 2, 3]));
}

// ---------------- Scénario 8 : section dupliquée (même index apparaissant deux fois dans la liste) pèse plus lourd ----------------
{
  // Simule une duplication "AABA" : la playableSections list a 4 entrées mais les entrées 0 et 2
  // représentent la MÊME section source (le moteur réel résout ça en amont ; ici on vérifie juste que
  // la logique d'ordre traite bien 4 emplacements distincts, peu importe qu'ils pointent vers le même
  // contenu réel — c'est la responsabilité de l'appelant de résoudre le contenu, pas du scheduler).
  const sched = createSectionPlaybackScheduler(
    [{ maxLoops: 1 }, { maxLoops: 1 }, { maxLoops: 1 }, { maxLoops: 1 }],
    { randomize: true, hasIntro: false, hasOutro: false }
  );
  let countIndex0 = 0, countIndex2 = 0;
  for (let cyc = 0; cyc < 100; cyc++) {
    for (let k = 0; k < 4; k++) {
      const idx = sched.decideNext().index;
      if (idx === 0) countIndex0++;
      if (idx === 2) countIndex2++;
    }
  }
  check('scénario 8 : sur 100 cycles, chaque emplacement (dont les doublons) joue exactement 100 fois', countIndex0 === 100 && countIndex2 === 100);
}

// ---------------- Scénario 9 : maxChainLoops avec une seule section — fin automatique sans avoir à cliquer "aller vers la fin" ----------------
{
  const sched = createSectionPlaybackScheduler([{ maxLoops: 2 }], { randomize: false, hasIntro: false, hasOutro: false, maxChainLoops: 1 });
  sched.decideNext(); // section 0, 1er passage
  sched.decideNext(); // section 0, 2e passage -> maxLoops de la section épuisé -> avance -> boucle sur elle-même (n=1) -> cycle complet -> maxChainLoops(1) atteint
  const after = sched.decideNext(); // sans outro -> fin naturelle (même comportement qu'un "aller vers la fin" manuel, scénario 6)
  check('scénario 9 : maxChainLoops=1 sur une section unique déclenche la fin automatiquement après un cycle complet', after === null);
}

// ---------------- Scénario 10 : maxChainLoops sur plusieurs sections — transition vers l'outro après le nombre de cycles voulu ----------------
{
  const sched = createSectionPlaybackScheduler(
    [{ maxLoops: 1 }, { maxLoops: 1 }],
    { randomize: false, hasIntro: false, hasOutro: true, maxChainLoops: 2 }
  );
  const seq = [];
  for (let k = 0; k < 4; k++) seq.push(sched.decideNext().index); // cycle 1 : 0,1 ; cycle 2 : 0,1
  check('scénario 10 : deux cycles complets joués avant la limite (ordre attendu)', sameSeq(seq, [0, 1, 0, 1]));
  const next = sched.decideNext();
  check('scénario 10 : après 2 cycles complets, transition automatique vers l\'outro', next.type === 'outro');
}

// ---------------- Scénario 11 : "section suivante" manuel compte aussi pour maxChainLoops (même frontière de cycle, quelle que soit la cause de l'avancement) ----------------
{
  const sched = createSectionPlaybackScheduler(
    [{ maxLoops: null }, { maxLoops: null }, { maxLoops: null }],
    { randomize: false, hasIntro: false, hasOutro: false, maxChainLoops: 1 }
  );
  sched.decideNext(); // section 0
  sched.requestGoToNextSection();
  sched.decideNext(); // section 1 (avance forcée 0->1, pas encore de cycle complet)
  sched.requestGoToNextSection();
  sched.decideNext(); // section 2 (avance forcée 1->2)
  sched.requestGoToNextSection();
  const fourth = sched.decideNext(); // avance forcée 2->0 : cycle complet ici, mais ce générateur déjà en cours va jusqu'à son terme (même règle que "aller vers la fin", scénario 5)
  check('scénario 11 : le générateur en cours au moment du cycle complet n\'est pas coupé', fourth.type === 'section' && fourth.index === 0);
  const after = sched.decideNext(); // seulement MAINTENANT la limite prend effet
  check('scénario 11 : "section suivante" manuel compte bien pour maxChainLoops (fin sans outro au tour suivant)', after === null);
}

// ---------------- Scénario 12 : maxChainLoops modifiable en cours de route (getter live, comme le fera le sélecteur visiteur) ----------------
{
  let liveCapValue = null; // au départ illimité, comme si le visiteur n'avait encore rien touché
  const sched = createSectionPlaybackScheduler(
    [{ maxLoops: 1 }, { maxLoops: 1 }],
    { randomize: false, hasIntro: false, hasOutro: false, get maxChainLoops() { return liveCapValue; } }
  );
  const seq = [];
  for (let k = 0; k < 4; k++) seq.push(sched.decideNext().index); // 2 cycles complets sans aucune limite
  check('scénario 12 : aucune fin tant que maxChainLoops (via getter) reste null', sameSeq(seq, [0, 1, 0, 1]));
  liveCapValue = 1; // le visiteur vient de choisir "1" en cours de lecture
  seq.push(sched.decideNext().index); // 0 — le cycle en cours va jusqu'à son terme
  seq.push(sched.decideNext().index); // 1 — referme le cycle -> limite (1) atteinte immédiatement, pas besoin d'attendre un futur changement de valeur
  const after = sched.decideNext();
  check('scénario 12 : le changement pris en compte dès le cycle suivant, sans recréer le scheduler', after === null);
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
