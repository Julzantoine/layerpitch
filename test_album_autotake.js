const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Version officielle automatique (26/10, étape 1 : statique + vertical) : de la config d'un morceau à une prise au format du
// journal du lecteur, sans jouer quoi que ce soit. On vérifie la frise (entrée des couches, stinger, fin), le passage par
// buildPlan, et la forme de la prise (celle que check_take côté serveur et playTake / renderTake attendent).
(async () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <script>${read('layerpitch-i18n.js')}</script><script>${read('player.js')}</script>
  <script>${read('capture-render.js')}</script><script>${read('capture-plan.js')}</script><script>${read('capture-retarget.js')}</script><script>${read('layerpitch-album-autotake.js')}</script></body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function P(v) { return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }; }
      function Ctx() { this.destination = {}; this.sampleRate = 44100; this.currentTime = 0; }
      Ctx.prototype.createGain = () => ({ gain: P(1), connect() {} });
      Ctx.prototype.resume = () => Promise.resolve();
      win.AudioContext = Ctx;
      win.ResizeObserver = function () { return { observe() {}, disconnect() {} }; };
    }
  });
  await new Promise(r => setTimeout(r, 50));
  const W = dom.window, A = W.LayerPitchAutoTake;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-3);
  const L = n => Array.from({ length: n }, (_, i) => ({ file: 'l' + i + '.ogg' }));
  const sfx = { id: 'x', base: 'https://m/x/', alternatives: [{ file: 'x0.ogg' }, { file: 'x1.ogg' }], duckMainTrack: false };
  const duckSfx = { id: 'dk', base: 'https://m/x/', alternatives: [{ file: 'd.ogg' }], duckMainTrack: true };
  const sfxById = { x: sfx, dk: duckSfx };
  // 120 bpm, 4/4 : une mesure = 2 s ; fichier de 8 s.
  const vertical = { id: 'v', mode: 'vertical', base: 'https://m/v/', publishedAt: 'p1', duration: 8, bpm: 120, beatsPerBar: 4, layers: L(3), fxTriggers: [], fxSliders: [] };
  const quant = Object.assign({}, vertical, { id: 'q', loopEngine: 'quantized', loopInBeat: 0, loopOutBeat: 16, duration: 10 });
  const stat = { id: 's', mode: 'static', base: 'https://m/s/', duration: 8, bpm: 120, beatsPerBar: 4, loopable: true, layers: L(1), fxTriggers: [], fxSliders: [] };
  const once = Object.assign({}, stat, { id: 'o', loopable: false });
  const statQ = Object.assign({}, stat, { id: 'sq', loopEngine: 'quantized', loopOutBeat: 16, duration: 10 });
  const measure = async () => 3;

  check('modes pris en charge : les cinq modes', ['static', 'vertical', 'sequential', 'vertical-random', 'embranchement-vertical'].every(m => A.supports({ mode: m })) && !A.supports({ mode: 'autre' }) && !A.supports(null));

  // Réglages de départ
  const d = A.defaults(vertical, [sfx]);
  check('réglages de départ : 2 min, 4 mesures (8 s) entre les couches, stinger sur le premier Sfx, fondu 3 s', d.duration === 120 && d.intervalSec === 8 && d.stinger && d.sfxId === 'x' && d.fadeSec === 3);
  check('sans Sfx : stinger désactivé par défaut', A.defaults(vertical, []).stinger === false);
  check('statique qui ne boucle pas : durée imposée par le fichier', A.defaults(once, []).duration === 8 && A.describe(once).fixedDuration);
  const many = Object.assign({}, vertical, { layers: L(20) });
  check('beaucoup de couches : intervalle resserré (la dernière entre avant 60 % de la durée)', A.defaults(many, []).intervalSec * 19 <= 0.6 * 120 + 1e-6 && A.defaults(many, []).intervalSec >= 2);

  // ---- Vertical, moteur simple ----
  {
    const s = Object.assign(A.defaults(vertical, [sfx]), { duration: 60, intervalSec: 8, seed: 3 });
    const { take, info } = await A.generate(vertical, sfxById, s, { measure });
    check('vertical simple : prise au bon format (kind, trackId, publishedAt, complete)', take.kind === 'layerpitch-take' && take.trackId === 'v' && take.publishedAt === 'p1' && take.complete === true && take.v === 1);
    check('vertical simple : une voix par couche, URL du lecteur (?v=), en boucle sur le fichier', take.voices.length === 3 && take.voices.every(v => v.loop && v.loop[1] === 8 && /^https:\/\/m\/v\/l\d\.ogg\?v=p1$/.test(v.url)));
    check('vertical simple : durée = nombre entier de tours (60 s -> 56 s = 7 tours de 8 s)', info.musicEnd === 56 || info.musicEnd === 64);
    const v1 = take.voices[1];
    check('couche 2 muette au départ puis entrée à la 4e mesure (8 s)', v1.gain.init === 0 && v1.gain.auto.some(a => a[0] === 'lin' && a[2] === 1 && a[1] > 8 && a[1] < 10));
    const v2 = take.voices[2];
    check('couche 3 entre à 16 s', v2.gain.auto.some(a => a[0] === 'lin' && a[2] === 1 && a[1] > 16 && a[1] < 18));
    check('toutes les voix s\'arrêtent à la fin musicale', take.voices.every(v => v.stop === info.musicEnd));
    check('fondu de sortie sur le gain maître sur les 3 dernières secondes', take.master.auto.some(a => a[0] === 'lin' && near(a[1], info.musicEnd) && a[2] === 0) && take.master.auto.some(a => a[0] === 'set' && near(a[1], info.musicEnd - 3)));
    check('un stinger posé sur un début de mesure, entre 50 et 80 % du morceau, après l\'entrée de la dernière couche',
      take.sfx.length === 1 && info.stingerAt % 2 === 0 && info.stingerAt >= 0.5 * info.musicEnd - 1e-6 && info.stingerAt >= 16 && info.stingerAt <= 0.8 * info.musicEnd + 2 && /^https:\/\/m\/x\/x[01]\.ogg$/.test(take.sfx[0].url));
    check('la durée de la prise couvre la fin musicale', take.duration >= info.musicEnd);
    check('chaque voix porte ses champs de rejeu (rate, gain, fx, fxLog)', take.voices.every(v => v.rate && v.rate.init === 1 && v.gain && v.fx && Array.isArray(v.fxLog) && v.dur === null));
    check('prise légère (largement sous 2 Mo)', JSON.stringify(take).length < 200000);
    // Même graine = même prise ; autre graine = autre tirage possible
    const again = await A.generate(vertical, sfxById, s, { measure });
    check('même graine : même stinger', again.info.stingerAt === info.stingerAt && again.take.sfx[0].url === take.sfx[0].url);
    const seen = new Set();
    for (let seed = 1; seed < 30; seed++) { const r = await A.generate(vertical, sfxById, Object.assign({}, s, { seed }), { measure }); seen.add(r.info.stingerAt + '|' + r.take.sfx[0].url); }
    check('« Régénérer » (autre graine) : le tirage change', seen.size > 1);
    const nos = await A.generate(vertical, sfxById, Object.assign({}, s, { stinger: false }), { measure });
    check('stinger désactivé : aucun Sfx', nos.take.sfx.length === 0 && nos.info.stingerAt === null);
    const nofade = await A.generate(vertical, sfxById, Object.assign({}, s, { fadeSec: 0, stinger: false }), { measure });
    check('fondu à 0 : pas de rampe sur le gain maître', nofade.take.master.auto.every(a => a[0] !== 'lin'));
    // intervalle calé sur la mesure
    const odd = await A.generate(vertical, sfxById, Object.assign({}, s, { intervalSec: 7 }), { measure });
    check('intervalle 7 s -> calé sur la mesure la plus proche (8 s)', odd.info.intervalSec === 8);
    const short = await A.generate(vertical, sfxById, Object.assign({}, s, { duration: 16, intervalSec: 8 }), { measure });
    check('durée courte : la couche qui entrerait après la fin n\'entre pas', short.info.layerEntries.length === 2 && short.info.layerEntries.every(t => t < short.info.musicEnd));
    const duck = await A.generate(vertical, sfxById, Object.assign({}, s, { sfxId: 'dk' }), { measure });
    check('Sfx avec « duck » : le gain maître baisse puis remonte', duck.take.master.auto.some(a => a[2] === W.LayerPlayerCore.CAPTURE_RAMPS.duckLevel));
  }

  // ---- Vertical, moteur quantifié ----
  {
    const s = Object.assign(A.defaults(quant, [sfx]), { duration: 40, intervalSec: 8, seed: 2, stinger: false });
    const { take, info } = await A.generate(quant, sfxById, s, { measure });
    const starts = [...new Set(take.voices.map(v => v.start))].sort((a, b) => a - b);
    check('quantifié : une génération par tour (cycle de 8 s), 3 couches chacune', starts.length === 5 && take.voices.length === 15 && starts.every((t, i) => near(t, i * 8)));
    check('quantifié : la 1re génération part du début, les suivantes du point d\'entrée de boucle', take.voices.filter(v => v.start === 0).every(v => v.offset === 0));
    check('quantifié : la dernière génération joue jusqu\'au bout du fichier (queue), les autres sont relayées', take.voices.filter(v => near(v.start, 32)).every(v => v.stop === null) && info.musicEnd === 40);
    check('quantifié : la durée de la prise couvre la queue (10 s de fichier depuis 32 s)', near(take.duration, 42));
    check('quantifié : pas de fondu forcé (fin naturelle)', info.fadeSec === 0 && take.master.auto.every(a => a[0] !== 'lin'));
    const l3 = start => take.voices.find(v => v.url.includes('l2.ogg') && near(v.start, start));
    check('quantifié : la couche 3 est muette sur les générations avant 16 s et pleine à partir de la génération de 16 s', l3(0).gain.init === 0 && l3(8).gain.init === 0 && l3(16).gain.init === 1 && l3(24).gain.init === 1);
  }

  // ---- Statique ----
  {
    const s = Object.assign(A.defaults(stat, [sfx]), { duration: 30, seed: 5 });
    const { take, info } = await A.generate(stat, sfxById, s, { measure });
    check('statique bouclable : une voix en boucle, arrêtée à la fin d\'un tour, fondu final', take.voices.length === 1 && take.voices[0].loop && take.voices[0].stop === info.musicEnd && info.musicEnd % 8 === 0 && take.master.auto.some(a => a[0] === 'lin'));
    check('statique bouclable : stinger posé', take.sfx.length === 1);
    const o = await A.generate(once, sfxById, A.defaults(once, [sfx]), { measure });
    check('statique sans boucle : le fichier joue une fois, sans boucle, durée du fichier', o.take.voices.length === 1 && o.take.voices[0].loop === null && near(o.take.voices[0].stop, 8) && o.info.musicEnd === 8);
    const q = await A.generate(statQ, sfxById, Object.assign(A.defaults(statQ, []), { duration: 30 }), { measure });
    check('statique en moteur quantifié : générations relayées comme un vertical à une couche', q.take.voices.length >= 3 && q.take.voices.every(v => /l0\.ogg/.test(v.url)) && q.take.voices.some(v => v.start > 0));
  }


  // ---- Séquentiel ----
  const SQ = { id: 'sq1', mode: 'sequential', base: 'https://m/sq/', publishedAt: 'p2', bpm: 120, beatsPerBar: 4, fxTriggers: [], fxSliders: [],
    intro: { file: 'i.ogg', bars: 1 }, outro: { file: 'o.ogg' },
    segmentSlots: [
      { id: 'A', repeatCount: 2, alternatives: [{ file: 'a0.ogg', bars: 2 }, { file: 'a1.ogg', bars: 2 }] },
      { id: 'B', alternatives: [{ file: 'b.ogg', bars: 2 }], nextOptions: [{ targetId: 'C', transition: { file: 't.ogg', bars: 1 } }, { targetId: 'A' }] },
      { id: 'C', alternatives: [{ file: 'c.ogg', bars: 2 }] }
    ] };
  {
    const ds = A.defaults(SQ, [sfx]);
    check('séquentiel : rythme de départ = 2 tours du premier emplacement (8 s)', ds.intervalSec === 8 && A.describe(SQ).intervalKind === 'slots');
    const s = Object.assign(ds, { duration: 60, seed: 4 });
    const { take, info } = await A.generate(SQ, sfxById, s, { measure });
    const names = take.voices.map(v => v.url.replace(/^https:\/\/m\/sq\//, '').replace(/\?v=p2$/, ''));
    check('séquentiel : l\'intro ouvre la prise, puis l\'emplacement A joue ses 2 répétitions (blocs de 4 s)', names[0] === 'i.ogg' && /^a[01]\.ogg$/.test(names[1]) && /^a[01]\.ogg$/.test(names[2]) && take.voices[1].start === 2 && take.voices[2].start === 6);
    check('séquentiel : l\'emplacement à embranchements reste le rythme choisi (2 blocs de 4 s) puis prend une sortie', names.indexOf('b.ogg') === 3 && names[4] === 'b.ogg' && (names[5] === 't.ogg' || /^a[01]\.ogg$/.test(names[5])));
    check('séquentiel : l\'outro termine la prise, après la durée visée', names[names.length - 1] === 'o.ogg' && info.musicEnd >= 60 && take.voices[take.voices.length - 1].start === info.musicEnd);
    check('séquentiel : chaque bloc part à la fin du précédent (jamais de coupure), sans arrêt forcé', take.voices.every(v => v.stop === null) && take.voices.slice(1).every((v, i) => v.start > take.voices[i].start));
    const outs = new Set();
    for (let seed = 1; seed < 12; seed++) { const r = await A.generate(SQ, sfxById, Object.assign({}, s, { seed, stinger: false }), { measure }); r.take.voices.forEach(v => outs.add(v.url.replace(/^.*\//, '').replace(/\?.*/, ''))); }
    check('séquentiel : les deux sorties de l\'emplacement B (transition vers C, retour sur A) s\'entendent selon les tirages', outs.has('t.ogg') && outs.has('c.ogg'));
    const tr = take.voices.find(v => /t\.ogg/.test(v.url));
    const noOutro = await A.generate(Object.assign({}, SQ, { outro: null }), sfxById, Object.assign({}, s, { stinger: false }), { measure });
    check('séquentiel sans outro : la prise finit avec le dernier bloc', !noOutro.take.voices.some(v => /o\.ogg/.test(v.url)));
    check('séquentiel : stinger posé (début de mesure)', take.sfx.length === 1 && info.stingerAt % 2 === 0);
    check('séquentiel : durée de la prise = fin du dernier fichier (3 s mesurées)', near(take.duration, take.voices[take.voices.length - 1].start + 3));
    void tr;
  }

  // ---- Vertical-aléatoire ----
  const VRT = { id: 'vr1', mode: 'vertical-random', base: 'https://m/vr/', publishedAt: 'p3', bpm: 120, beatsPerBar: 4, fxTriggers: [], fxSliders: [],
    intro: { file: 'i.ogg', bars: 1 }, outro: { file: 'o.ogg' },
    sections: [
      { id: 'S1', bpm: 120, beatsPerBar: 4, loopOutBeat: 16, maxLoops: 2, pools: [{ alternatives: [{ file: 'p0.ogg' }, { file: 'p1.ogg' }] }, { alternatives: [{ file: 'q0.ogg' }] }] },
      { id: 'S2', bpm: 120, beatsPerBar: 4, loopOutBeat: 16, pools: [{ alternatives: [{ file: 'r0.ogg' }] }] }
    ] };
  {
    const ds = A.defaults(VRT, []);
    check('vertical-aléatoire : rythme de départ = 2 cycles de la première section (16 s)', ds.intervalSec === 16 && A.describe(VRT).intervalKind === 'sections');
    const s = Object.assign(ds, { duration: 60, seed: 2 });
    const { take, info } = await A.generate(VRT, sfxById, Object.assign({}, s, { stinger: false }), { measure });
    const starts = [...new Set(take.voices.map(v => v.start))];
    check('vertical-aléatoire : intro, puis 2 cycles de S1 (maxLoops) de 8 s, puis S2 pour le rythme choisi (2 cycles)', starts[0] === 0 && starts[1] === 2 && starts[2] === 10 && starts[3] === 18 && starts[4] === 26);
    check('vertical-aléatoire : un tirage par pool à chaque cycle (S1 : 2 pools, S2 : 1)', take.voices.filter(v => v.start === 2).length === 2 && take.voices.filter(v => v.start === 18).length === 1);
    check('vertical-aléatoire : premier cycle depuis le point de départ, les suivants depuis l\'entrée de boucle', take.voices.filter(v => v.start === 2).every(v => v.offset === 0));
    check('vertical-aléatoire : l\'outro termine la prise', take.voices[take.voices.length - 1].url.includes('o.ogg') && take.voices[take.voices.length - 1].start === info.musicEnd);
    const seen = new Set();
    for (let seed = 1; seed < 20; seed++) { const r = await A.generate(VRT, sfxById, Object.assign({}, s, { seed, stinger: false }), { measure }); r.take.voices.forEach(v => seen.add(v.url.replace(/^.*\//, '').replace(/\?.*/, ''))); }
    check('vertical-aléatoire : le tirage varie avec la graine (les deux variations du pool 1 s\'entendent)', seen.has('p0.ogg') && seen.has('p1.ogg'));
    const x2 = await A.generate(VRT, sfxById, Object.assign({}, s, { stinger: false }), { measure });
    check('vertical-aléatoire : même graine, même prise', JSON.stringify(x2.take.voices.map(v => [v.url, v.start])) === JSON.stringify(take.voices.map(v => [v.url, v.start])));
  }

  // ---- Embranchement-vertical ----
  const EM = { id: 'em1', mode: 'embranchement-vertical', base: 'https://m/em/', publishedAt: 'p4', bpm: 120, beatsPerBar: 4, fxTriggers: [], fxSliders: [],
    loops: [
      { id: 'L0', file: 'l0.ogg', isInitial: true, isDetour: false, duration: 8, bars: 4 },
      { id: 'L1', file: 'l1.ogg', isDetour: false, duration: 8, bars: 4, transition: { file: 'tr.ogg', durationUnit: 'seconds', durationSeconds: 2 } },
      { id: 'L2', file: 'l2.ogg', isDetour: false, duration: 8, bars: 4 },
      { id: 'D', file: 'd.ogg', isDetour: true, detourMode: 'once', duration: 2, bars: 1 }
    ] };
  {
    const ds = A.defaults(EM, []);
    check('embranchement : rythme de départ = 2 cycles (16 s)', ds.intervalSec === 16 && A.describe(EM).intervalKind === 'loops' && A.describe(EM).fade);
    const s = Object.assign(ds, { duration: 64, seed: 1, stinger: false, fadeSec: 3 });
    const { take, info } = await A.generate(EM, sfxById, s, { measure });
    const gens = take.voices.filter(v => /l0\.ogg/.test(v.url)).map(v => v.start);
    check('embranchement : une génération des boucles jumelles par cycle (8 s), 3 boucles chacune', gens.length === 8 && take.voices.filter(v => /l1\.ogg/.test(v.url)).length === 8 && take.voices.filter(v => /l2\.ogg/.test(v.url)).length === 8);
    const l1 = take.voices.find(v => /l1\.ogg/.test(v.url) && v.start === 16);
    check('embranchement : à 16 s (+ fichier de transition de 2 s) la boucle L1 devient audible', l1.gain.auto.some(a => a[0] === 'lin' && a[2] === 1 && a[1] >= 18 && a[1] < 18.6) || l1.gain.init === 1);
    check('embranchement : le fichier de transition de L1 est joué', take.voices.some(v => /tr\.ogg/.test(v.url) && near(v.start, 16)));
    check('embranchement : le détour est joué une fois', take.voices.some(v => /d\.ogg/.test(v.url)));
    check('embranchement : les voix s\'arrêtent à la fin, fondu sur le gain maître', take.voices.filter(v => /l0\.ogg/.test(v.url)).every(v => v.stop === 64 || v.stop === null || v.stop <= 64) && take.master.auto.some(a => a[0] === 'lin' && near(a[1], 64) && a[2] === 0) && info.musicEnd === 64);
    check('embranchement : au moins une bascule jouée', info.switches >= 2);
    const st = await A.generate(EM, sfxById, Object.assign({}, s, { stinger: true, sfxId: 'x' }), { measure });
    check('embranchement : stinger posé', st.take.sfx.length === 1);
  }

  // ---- Partition retouchée (timeline, 26/10) ----
  {
    // Vertical : bascule « de couche 1 vers couche 2 » (la 1 sort, la 2 entre), deux stingers, fin déplacée.
    const sc = A.draft(vertical, sfxById, Object.assign(A.defaults(vertical, [sfx]), { duration: 60, seed: 3 }));
    check('partition : départ fixe, une bascule par couche qui entre, un stinger', sc.mode === 'vertical' && sc.markers[0].fixed && sc.markers.filter(m => m.kind === 'layers').length === 3 && sc.markers.filter(m => m.kind === 'stinger').length === 1);
    const edited = { mode: 'vertical', end: 40, fadeSec: 0, seed: 3, markers: [
      { id: 'a', kind: 'layers', t: 0, on: [0], fixed: true }, { id: 'b', kind: 'layers', t: 16, on: [1] }, { id: 'c', kind: 'layers', t: 24, on: [0, 1, 2] },
      { id: 'd', kind: 'layers', t: 90, on: [2] }, { id: 's1', kind: 'stinger', t: 10, sfxId: 'x', variationIndex: 1 }, { id: 's2', kind: 'stinger', t: 30, sfxId: 'x', variationIndex: 0 }] };
    const r = await A.compile(vertical, sfxById, edited, { measure });
    const v0 = r.take.voices[0], v1 = r.take.voices[1], v2 = r.take.voices[2];
    check('retouche verticale : la couche 1 sort à 16 s puis revient à 24 s', v0.gain.init === 1 && v0.gain.auto.some(a => a[2] === 0 && a[1] > 16 && a[1] < 18) && v0.gain.auto.some(a => a[2] === 1 && a[1] > 24 && a[1] < 26));
    check('retouche verticale : la couche 2 entre à 16 s, la couche 3 à 24 s', v1.gain.init === 0 && v1.gain.auto.some(a => a[2] === 1 && a[1] > 16 && a[1] < 18) && v2.gain.auto.some(a => a[2] === 1 && a[1] > 24 && a[1] < 26));
    check('retouche verticale : fin déplacée à 40 s, bascule après la fin ignorée (resolved null)', r.info.musicEnd === 40 && r.resolved.d === null && r.resolved.b === 16);
    check('retouche verticale : deux stingers posés (variation choisie), le premier annoncé', r.take.sfx.length === 2 && /x1\.ogg/.test(r.take.sfx[0].url) && r.info.stingerAt === 10);
    check('retouche : la prise garde sa partition (pour la rouvrir)', r.take.generated.v === 2 && r.take.generated.score.markers.length === 6);
  }
  {
    // Séquentiel : bascule vers C posée au milieu d'un bloc -> calée sur la fin de bloc la plus proche, avec la transition B -> C.
    const sc = { mode: 'sequential', end: 31, seed: 1, markers: [{ id: 'a', kind: 'slot', t: 2, slotId: 'B', fixed: true }, { id: 'b', kind: 'slot', t: 11, slotId: 'C' }] };
    const r = await A.compile(SQ, sfxById, sc, { measure });
    const names = r.take.voices.map(v => v.url.replace(/^.*\//, '').replace(/\?.*/, ''));
    check('retouche séquentielle : départ sur B après l\'intro, bascule demandée à 11 s jouée à 10 s (fin de bloc), transition B -> C', names[0] === 'i.ogg' && names[1] === 'b.ogg' && names[2] === 'b.ogg' && r.resolved.b === 10 && names[3] === 't.ogg' && names[4] === 'c.ogg' && r.take.voices[4].start === 12);
    check('retouche séquentielle : la fin se cale sur la fin de bloc la plus proche, puis l\'outro', r.info.musicEnd === 32 && names[names.length - 1] === 'o.ogg');
    const back = await A.compile(SQ, sfxById, { mode: 'sequential', end: 20, seed: 1, markers: [{ id: 'a', kind: 'slot', t: 2, slotId: 'C', fixed: true }, { id: 'b', kind: 'slot', t: 6, slotId: 'A' }] }, { measure });
    check('retouche séquentielle : bascule sans sortie prévue (C -> A) : enchaînement direct en fin de bloc, sans transition', !back.take.voices.some(v => /t\.ogg/.test(v.url)) && back.resolved.b === 6);
  }
  {
    // Vertical-aléatoire : S2 puis S1 à 20 s (cycle de 8 s : calé sur 18 s).
    const r = await A.compile(VRT, sfxById, { mode: 'vertical-random', end: 40, seed: 2, markers: [{ id: 'a', kind: 'section', t: 2, sectionIndex: 1, fixed: true }, { id: 'b', kind: 'section', t: 20, sectionIndex: 0 }] }, { measure });
    const firstS1 = r.take.voices.find(v => /p[01]\.ogg/.test(v.url));
    check('retouche vertical-aléatoire : départ sur S2, bascule vers S1 calée sur la fin de cycle (18 s)', r.take.voices[1].url.includes('r0.ogg') && r.resolved.b === 18 && firstS1.start === 18);
  }
  {
    // Embranchement : une seule bascule vers L2 à 24 s.
    const r = await A.compile(EM, sfxById, { mode: 'embranchement-vertical', end: 48, fadeSec: 0, seed: 1, markers: [{ id: 'a', kind: 'loop', t: 0, loopId: 'L0', fixed: true }, { id: 'b', kind: 'loop', t: 24, loopId: 'L2' }] }, { measure });
    const l2 = r.take.voices.find(v => /l2\.ogg/.test(v.url) && v.start === 24);
    check('retouche embranchement : une seule bascule, vers L2 à 24 s (marqueur posé sur la fin de cycle), fin à 48 s', r.info.switches === 1 && r.resolved.b === 24 && l2 && (l2.gain.init === 1 || l2.gain.auto.some(a => a[2] === 1)) && r.info.musicEnd === 48 && !r.take.voices.some(v => /d\.ogg/.test(v.url)));
  }

  // ---- Refus des modes non gérés ----
  let refused = false;
  try { await A.generate({ id: 'z', mode: 'autre' }, {}, {}, {}); } catch (e) { refused = true; }
  check('mode inconnu : refusé clairement', refused);

  if (failures) { console.log('\n' + failures + ' échec(s)'); process.exit(1); }
  console.log('\nTous les tests passent');
})().catch(e => { console.error(e); process.exit(1); });
