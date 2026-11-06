// Fondu à l'arrêt (05/11, demande de Jules-Antoine) : dans l'atelier vidéo, arrêter un morceau à la main (Stop, ou un autre
// morceau lancé) le fait s'éteindre en fondu au lieu de couper net -- en direct (gain maître du lecteur) ET dans le rendu
// (écoute des versions, export), grâce au repère d'arrêt qui porte la durée du fondu. Hors atelier (aucune durée réglée),
// rien ne change : arrêt net.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const { playerPageHtml } = require('./scripts/test-harness.js');
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = playerPageHtml().replace('</body>', `<script>${read('capture-render.js')}</script><script>${read('capture-plan.js')}</script></body>`);
  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function FakeAudioContext() { this.destination = {}; this.sampleRate = 44100; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () {
        const gain = { value: 1, ramps: [], setValueAtTime() {}, linearRampToValueAtTime(v, t) { gain.ramps.push([v, t]); }, cancelScheduledValues() {} };
        (win.__gains = win.__gains || []).push(gain);
        return { gain, connect() {}, disconnect() {} };
      };
      FakeAudioContext.prototype.createBufferSource = function () {
        const node = { buffer: null, loop: false, connect() {}, start() {}, stop() { node.stopped = true; (win.__stops = win.__stops || []).push(Date.now()); }, playbackRate: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } };
        return node;
      };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 10, numberOfChannels: 1, getChannelData: () => new Float32Array(10) }); };
      win.AudioContext = FakeAudioContext;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
      win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
    }
  });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 50));
  const doc = window.document, Core = window.LayerPlayerCore, CP = window.LayerCapturePlan;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const fakeFile = name => ({ name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

  const marks = [];
  doc.addEventListener('layerpitch-capture-mark', e => { if (e.detail.name === 'voices_stop') marks.push(e.detail.detail); });
  const mk = id => ({ id, title: id, mode: 'static', description: '', duration: 10, base: '', publishedAt: 1, loopable: true, layers: [{ label: 'L', localFile: fakeFile(id + '.wav') }], sfxIds: [] });
  const rows = ['fa', 'fb'].map(id => { const t = mk(id); const row = Core.buildTrackRow(t, null, false); doc.getElementById('host').appendChild(row); Core.initTrackPlayer(t, row); return row; });
  await sleep(300);
  const [playA, stopA] = ['playBtn', 'stopBtn'].map(r => rows[0].querySelector(`[data-role="${r}"]`));
  const playB = rows[1].querySelector('[data-role="playBtn"]');

  // -- Hors atelier : arrêt net, repère sans fondu --
  window.__lpStopFadeSec = 0;
  click(playA); await sleep(50);
  marks.length = 0;
  click(stopA); await sleep(30);
  check('sans réglage : Stop arrête tout de suite (bouton masqué)', stopA.style.display === 'none');
  check('sans réglage : un seul repère d\'arrêt, sans fondu', marks.length === 1 && !marks[0].fadeSec);

  // -- Atelier : fondu de 0,3 s sur Stop --
  window.__lpStopFadeSec = 0.3;
  click(playA); await sleep(50);
  marks.length = 0; window.__stops = [];
  click(stopA); await sleep(30);
  check('fondu : le morceau sonne encore juste après Stop', stopA.style.display === '' && window.__stops.length === 0);
  check('fondu : repère d\'arrêt posé tout de suite, avec sa durée', marks.length === 1 && near(marks[0].fadeSec, 0.3));
  check('fondu : le gain maître descend vers 0', window.__gains.some(g => g.ramps.some(r => r[0] === 0)));
  await sleep(400);
  check('fondu : arrêt réel à la fin du fondu', stopA.style.display === 'none' && window.__stops.length > 0);
  check('fondu : pas de second repère d\'arrêt', marks.length === 1);

  // -- Atelier : lancer un autre morceau éteint le premier en fondu --
  click(playA); await sleep(50);
  marks.length = 0;
  click(playB); await sleep(30);
  check('autre morceau lancé : le premier s\'éteint en fondu', marks.some(m => m.trackId === 'fa' && near(m.fadeSec, 0.3)) && stopA.style.display === '');
  await sleep(400);
  check('autre morceau lancé : le premier est arrêté à la fin du fondu', marks.filter(m => m.trackId === 'fa').length === 1);
  window.__lpStopFadeSec = 0;
  click(rows[1].querySelector('[data-role="stopBtn"]')); await sleep(30);

  // -- Rendu : les voix arrêtées par un repère à fondu s'éteignent en fondu --
  const st = { id: 's', mode: 'static', base: 'https://m/s/', duration: 8, loopable: true, layers: [{ file: 'a.ogg' }], fxTriggers: [], fxSliders: [] };
  const vt = { id: 'v', mode: 'vertical', base: 'https://m/v/', duration: 8, layers: [{ file: 'a.ogg' }, { file: 'b.ogg' }], fxTriggers: [], fxSliders: [] };
  const findTrack = id => ({ s: st, v: vt })[id];
  const gainAt = (g, t) => { let v = g.init, pt = -Infinity, pv = g.init; for (const [tag, at, val] of g.auto) { if (at > t) { if (tag === 'lin' && isFinite(pt)) return pv + (val - pv) * (t - pt) / (at - pt); break; } v = val; pt = at; pv = val; } return v; };
  const plan = events => CP.buildPlan(events, { findTrack, findSfx: () => null }).plan;

  let p = plan([{ t: 0, name: 'layer_segment', detail: { trackId: 's', layerIndex: 0, duration: 4 } }, { t: 4, name: 'voices_stop', detail: { trackId: 's', fadeSec: 1 } }]);
  let v = p.voices[0];
  check('statique : la voix sonne pendant le fondu', near(v.stop, 5));
  check('statique : volume plein au début du fondu, moitié au milieu, 0 à la fin', near(gainAt(v.gain, 4), 1) && near(gainAt(v.gain, 4.5), 0.5) && near(gainAt(v.gain, 5), 0));
  check('le rendu dure jusqu\'à la fin du fondu (+ marge)', p.total >= 5);
  p = plan([{ t: 0, name: 'layer_segment', detail: { trackId: 's', layerIndex: 0, duration: 3 } }, { t: 4, name: 'voices_stop', detail: { trackId: 's', fadeSec: 1 } }]);
  check('statique : bloc raccourci sur la frise, le fondu suit la fin du bloc', near(p.voices[0].stop, 4) && near(gainAt(p.voices[0].gain, 3.5), 0.5));
  p = plan([{ t: 0, name: 'layer_segment', detail: { trackId: 's', layerIndex: 0, duration: 4 } }, { t: 4, name: 'voices_stop', detail: { trackId: 's' } }]);
  check('statique sans fondu : arrêt net, comme avant', near(p.voices[0].stop, 4));

  const vEvents = fade => [
    { t: 0, name: 'layer_run', detail: { trackId: 'v', offset: 0, loop: [0, 8], level: 1 } },
    { t: 0, name: 'layer_segment', detail: { trackId: 'v', layerIndex: 0, duration: 3 } },
    { t: 0, name: 'layer_segment', detail: { trackId: 'v', layerIndex: 1, duration: 3 } },
    { t: 3, name: 'voices_stop', detail: Object.assign({ trackId: 'v' }, fade ? { fadeSec: fade } : {}) }];
  p = plan(vEvents(1.5));
  check('vertical : chaque couche s\'éteint en 1,5 s', p.voices.length === 2 && p.voices.every(x => near(x.stop, 4.5) && near(gainAt(x.gain, 3), 1) && near(gainAt(x.gain, 4.5), 0)));
  p = plan(vEvents(0));
  check('vertical sans fondu : arrêt net à 3 s', p.voices.every(x => near(x.stop, 3)));

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
