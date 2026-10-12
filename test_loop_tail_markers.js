// Repères de boucle du lecteur (moteur quantifié) : entrée / sortie sur la forme d'onde, queue du fichier après la
// sortie, déplacement borné au repère de sortie, et deuxième tête de lecture qui montre la queue en train d'être jouée.
const { JSDOM } = require('jsdom');

(async () => {
  const { playerPageHtml, installTimedFakeAudio } = require('./scripts/test-harness.js');
  const dom = new JSDOM(playerPageHtml(), {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { installTimedFakeAudio(win); }
  });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 50));
  const doc = window.document;
  const Core = window.LayerPlayerCore;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fakeFile = name => ({ name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // ---- Fonctions pures ----
  const timing = { loopInSec: 2, loopOutSec: 8, cycleLength: 6 };
  const m = Core.quantizedLoopMarkers(timing, 10);
  check('repères : entrée à 20 %, sortie à 80 %, queue à 80 %', m.loopInPct === 20 && m.loopOutPct === 80 && m.tailStartPct === 80 && m.hasTail);
  const m0 = Core.quantizedLoopMarkers({ loopInSec: 0, loopOutSec: 10, cycleLength: 10 }, 10);
  check('repères : pas d\'entrée si la boucle part du début, pas de queue si la sortie est la fin', m0.loopInPct === null && !m0.hasTail);
  check('déplacement borné : dans la queue -> repère de sortie', Core.clampSeekToLoopExit(9.3, timing) === 8);
  check('déplacement borné : dans la boucle -> inchangé', Core.clampSeekToLoopExit(5, timing) === 5);
  const gens = [
    { ctxStartTime: 0, bufferOffset: 0, ratio: 1 },
    { ctxStartTime: 8, bufferOffset: 2, ratio: 1 },
    { ctxStartTime: 14, bufferOffset: 2, ratio: 1 },
    { ctxStartTime: 20, bufferOffset: 2, ratio: 1 }, // pas encore démarrée
  ];
  const tails = Core.quantizedTailPositions(gens, 15, 10);
  // à t=15 : gén. courante = celle de 14 ; celle de 8 est à 2 + 7 = 9 (queue), celle de 0 à 15 (finie)
  check('queues : seule la génération encore dans le fichier est montrée', tails.length === 1 && Math.abs(tails[0] - 9) < 1e-9);
  const tailsRate = Core.quantizedTailPositions([{ ctxStartTime: 0, bufferOffset: 0, ratio: 2 }, { ctxStartTime: 4, bufferOffset: 2, ratio: 2 }], 5, 20);
  check('queues : suit le rapport de vitesse (x2)', tailsRate.length === 1 && Math.abs(tailsRate[0] - 10) < 1e-9);
  check('queues : une génération arrêtée n\'est plus montrée',
    Core.quantizedTailPositions([{ ctxStartTime: 0, bufferOffset: 0, ratio: 1, stopped: true }, { ctxStartTime: 4, bufferOffset: 2, ratio: 1 }], 5, 20).length === 0);

  // ---- Lecteur : statique bouclable en moteur quantifié, 480 BPM (1 temps = 0,125 s), sortie au temps 8 = 1 s, fichier de 10 s ----
  const track = {
    id: 'tail-1', title: 'Queue', mode: 'static', loopable: true, loopEngine: 'quantized', description: '', duration: 10, base: '',
    publishedAt: 1, bpm: 480, beatsPerBar: 4, loopInBeat: 0, loopOutBeat: 8,
    layers: [{ label: 'L1', localFile: fakeFile('a.wav') }], sfxIds: []
  };
  const row = Core.buildTrackRow(track, null, false);
  doc.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);
  const q = s => row.querySelector(s);
  const tailZone = q('[data-role="loopTail"]'), markOut = q('[data-role="loopMarkOut"]'), markIn = q('[data-role="loopMarkIn"]');
  check('zone de queue visible, commence à 10 % (1 s sur 10 s)', tailZone && !tailZone.hidden && tailZone.style.left.startsWith('10'));
  check('repère de sortie visible à 10 %', markOut && !markOut.hidden && markOut.style.left.startsWith('10'));
  check('pas de repère d\'entrée (la boucle démarre au début)', markIn && markIn.hidden);
  check('la forme d\'onde n\'est pas tronquée (canvas toujours en pleine largeur)', !!q('[data-role="waveformBg"]') && q('[data-role="waveformBg"]').style.width === '');
  check('légende de la queue présente (titre)', !!tailZone.title && tailZone.title.length > 10);

  // Déplacement dans la queue : la tête se pose sur le repère de sortie (1 s -> « 0:01 »).
  const wrap = q('[data-role="progressWrap"]');
  wrap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 44, right: 100, bottom: 44 });
  const ev = (type, x) => wrap.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x }));
  ev('pointerdown', 90);
  const during = q('[data-role="timeCurrent"]').textContent;
  ev('pointerup', 90);
  check('glisser dans la queue : la tête reste sur le repère de sortie (0:01)', during === '0:01' && q('[data-role="timeCurrent"]').textContent === '0:01');
  ev('pointerdown', 5); ev('pointerup', 5);
  check('glisser dans la boucle : la tête suit (0:00 à 5 %)', q('[data-role="timeCurrent"]').textContent === '0:00');

  // Deuxième tête : après le premier rebouclage (1 s), la queue de la génération précédente est montrée, puis tout disparaît à l'arrêt.
  click(q('[data-role="playBtn"]'));
  await sleep(1500);
  const tailHead = q('.progress-tail-head');
  const pct = tailHead ? parseFloat(tailHead.style.left) : NaN;
  check('deuxième tête visible après le rebouclage, dans la queue', tailHead && !tailHead.hidden && pct >= 10 && pct < 100);
  click(q('[data-role="playBtn"]')); await sleep(100);
  check('deuxième tête masquée en pause', q('.progress-tail-head').hidden);
  click(q('[data-role="stopBtn"]')); await sleep(50);

  // Moteur simple : aucun repère.
  const simple = { id: 'tail-2', title: 'Simple', mode: 'static', loopable: true, description: '', duration: 10, base: '', publishedAt: 1, layers: [{ label: 'L1', localFile: fakeFile('b.wav') }], sfxIds: [] };
  const sRow = Core.buildTrackRow(simple, null, false);
  check('moteur simple : pas de repères de boucle', !sRow.querySelector('[data-role="loopOverlay"]'));

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
