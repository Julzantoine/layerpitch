// Extrait uniquement la fonction advanceChainIndex de player.js et l'évalue isolément — comme
// test-section-scheduler.js, aucune dépendance à window/ctx/DOM/audio, donc pas besoin de jsdom.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8');
const startMarker = 'function advanceChainIndex(index, n, chainState, maxChainLoops, randomize) {';
const startIdx = src.indexOf(startMarker);
if (startIdx === -1) throw new Error('advanceChainIndex not found in player.js');
let depth = 0, i = startIdx, started = false;
while (i < src.length) {
  const c = src[i];
  if (c === '{') { depth++; started = true; }
  else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
  i++;
}
const fnSrc = src.slice(startIdx, i);
const advanceChainIndex = eval('(' + fnSrc.replace('function advanceChainIndex', 'function') + ')');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

// ---------------- Scénario 1 : avancement simple sans limite (maxChainLoops null) ----------------
{
  const chainState = { cyclesCompleted: 0, capReached: false };
  const seq = [];
  let idx = 0;
  for (let k = 0; k < 7; k++) { idx = advanceChainIndex(idx, 3, chainState, null); seq.push(idx); }
  check('scénario 1 : boucle normalement sur 0,1,2 sans limite', JSON.stringify(seq) === JSON.stringify([1, 2, 0, 1, 2, 0, 1]));
  check('scénario 1 : jamais de capReached sans maxChainLoops', chainState.capReached === false);
}

// ---------------- Scénario 2 : détection du retour à l'emplacement 0 (cycle complet) ----------------
{
  const chainState = { cyclesCompleted: 0, capReached: false };
  let idx = 0;
  idx = advanceChainIndex(idx, 2, chainState, null); // -> 1, pas un cycle
  check('scénario 2 : pas encore de cycle complet après un seul pas (n=2)', chainState.cyclesCompleted === 0);
  idx = advanceChainIndex(idx, 2, chainState, null); // -> 0, cycle complet
  check('scénario 2 : un cycle complet compté au retour à 0', chainState.cyclesCompleted === 1);
}

// ---------------- Scénario 3 : capReached au seuil exact de maxChainLoops, jamais avant ----------------
{
  const chainState = { cyclesCompleted: 0, capReached: false };
  let idx = 0;
  for (let cycle = 1; cycle <= 3; cycle++) {
    idx = advanceChainIndex(idx, 2, chainState, 3); // 2 pas par cycle
    idx = advanceChainIndex(idx, 2, chainState, 3);
    if (cycle < 3) check(`scénario 3 : pas de capReached avant le cycle ${cycle}/3`, chainState.capReached === false);
  }
  check('scénario 3 : capReached exactement au 3e cycle complet (maxChainLoops=3)', chainState.capReached === true && chainState.cyclesCompleted === 3);
}

// ---------------- Scénario 4 : chaîne à un seul emplacement (n=1) — chaque pas est un cycle complet ----------------
{
  const chainState = { cyclesCompleted: 0, capReached: false };
  let idx = 0;
  idx = advanceChainIndex(idx, 1, chainState, 2);
  check('scénario 4 : n=1, premier pas déjà un cycle complet', chainState.cyclesCompleted === 1 && chainState.capReached === false);
  idx = advanceChainIndex(idx, 1, chainState, 2);
  check('scénario 4 : n=1, deuxième pas atteint maxChainLoops=2', chainState.cyclesCompleted === 2 && chainState.capReached === true);
}

// ---------------- Scénario 5 : capReached ne redescend jamais tout seul (c'est à l'appelant de le consommer et le remettre à false) ----------------
{
  const chainState = { cyclesCompleted: 0, capReached: false };
  let idx = 0;
  idx = advanceChainIndex(idx, 1, chainState, 1); // capReached devient true dès le 1er pas
  advanceChainIndex(idx, 1, chainState, 1); // un pas de plus sans que l'appelant n'ait remis capReached à false
  check('scénario 5 : capReached reste vrai tant que l\'appelant ne le consomme pas explicitement', chainState.capReached === true);
}

// ---------------- Scénario 6 : ordre aléatoire (25/09) -- brassage complet par tour ----------------
{
  let allToursComplete = true, noJunctionRepeat = true, cyclesOk = true, sawNonNatural = false;
  for (let run = 0; run < 200; run++) {
    const chainState = { cyclesCompleted: 0, capReached: false };
    const n = 4;
    let idx = advanceChainIndex(-1, n, chainState, null, true);
    const seq = [idx];
    for (let k = 1; k < n * 3; k++) { idx = advanceChainIndex(idx, n, chainState, null, true); seq.push(idx); }
    for (let t = 0; t < 3; t++) {
      const tour = seq.slice(t * n, t * n + n);
      if (JSON.stringify(tour.slice().sort()) !== JSON.stringify([0, 1, 2, 3])) allToursComplete = false;
      if (JSON.stringify(tour) !== JSON.stringify([0, 1, 2, 3])) sawNonNatural = true;
      if (t > 0 && seq[t * n] === seq[t * n - 1]) noJunctionRepeat = false;
    }
    if (chainState.cyclesCompleted !== 2) cyclesOk = false;
  }
  check('scénario 6 : chaque tour joue chaque emplacement exactement une fois', allToursComplete);
  check('scénario 6 : jamais le même emplacement deux fois de suite à la jonction de deux tours', noJunctionRepeat);
  check('scénario 6 : les tours complets sont comptés (2 jonctions sur 3 tours)', cyclesOk);
  check('scénario 6 : l\'ordre est bien mélangé (pas toujours 0,1,2,3)', sawNonNatural);
}
// ---------------- Scénario 7 : ordre aléatoire + maxChainLoops, et saut d'embranchement ----------------
{
  const chainState = { cyclesCompleted: 0, capReached: false };
  let idx = advanceChainIndex(-1, 3, chainState, 1, true);
  idx = advanceChainIndex(idx, 3, chainState, 1, true);
  idx = advanceChainIndex(idx, 3, chainState, 1, true);
  check('scénario 7 : pas de limite atteinte avant la fin du premier tour', chainState.capReached === false);
  advanceChainIndex(idx, 3, chainState, 1, true);
  check('scénario 7 : limite atteinte à la fin du premier tour', chainState.capReached === true);
  const cs2 = { cyclesCompleted: 0, capReached: false, order: [2, 0, 1] };
  check('scénario 7 : après un saut direct vers 0, on continue depuis sa place dans le tour', advanceChainIndex(0, 3, cs2, null, true) === 1);
  check('scénario 7 : sans aléatoire, rien ne change (0 -> 1)', advanceChainIndex(0, 3, { cyclesCompleted: 0 }, null, false) === 1);
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
