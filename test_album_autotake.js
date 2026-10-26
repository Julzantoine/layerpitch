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
  <script>${read('capture-render.js')}</script><script>${read('capture-plan.js')}</script><script>${read('layerpitch-album-autotake.js')}</script></body></html>`;
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

  check('modes pris en charge : statique et vertical seulement', A.supports(vertical) && A.supports(stat) && !A.supports({ mode: 'sequential' }) && !A.supports({ mode: 'embranchement-vertical' }) && !A.supports({ mode: 'vertical-random' }));

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

  // ---- Refus des modes non gérés ----
  let refused = false;
  try { await A.generate({ id: 'z', mode: 'sequential' }, {}, {}, {}); } catch (e) { refused = true; }
  check('mode séquentiel : refusé clairement (étape suivante)', refused);

  if (failures) { console.log('\n' + failures + ' échec(s)'); process.exit(1); }
  console.log('\nTous les tests passent');
})().catch(e => { console.error(e); process.exit(1); });
