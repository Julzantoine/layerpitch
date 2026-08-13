// Extrait uniquement la fonction advanceChainIndex de player.js et l'évalue isolément — comme
// test-section-scheduler.js, aucune dépendance à window/ctx/DOM/audio, donc pas besoin de jsdom.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8');
const startMarker = 'function advanceChainIndex(index, n, chainState, maxChainLoops) {';
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

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
