// Zones d'intensité (26/09) : en mode vertical, un curseur de paramètre peut remplacer les boutons d'intensité 1/2/3
// -- n couches = n zones (limites réglables, découpage égal par défaut), un seul curseur par morceau.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

(async () => {
  const backstageSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8')
    .replace(/<script[^>]*src="https:\/\/unpkg\.com[^"]*"[^>]*><\/script>\s*/g, '');
  function inlineExactLine(html, filename, tagline) {
    const content = fs.readFileSync(path.join(__dirname, filename), 'utf-8').replace(/<\/script/gi, '<\\/script');
    return html.split('\n').map(line => {
      const normalized = line.trim().replace(/\.js(\?[^"]*)?"/, '.js"');
      return normalized === tagline ? `<script>${content}</script>` : line;
    }).join('\n');
  }
  let html = inlineExactLine(backstageSrc, 'layerpitch-i18n.js', '<script src="layerpitch-i18n.js"></script>');
  html = inlineExactLine(html, 'layerpitch-help.js', '<script src="layerpitch-help.js"></script>');
  html = inlineExactLine(html, 'player.js', '<script src="player.js"></script>');

  const dom = new JSDOM(html, {
    url: 'http://localhost/test_backstage.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function FakeAudioContext() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () { return { gain: { setValueAtTime() {}, value: 1 }, connect() {}, disconnect() {} }; };
      FakeAudioContext.prototype.createBufferSource = function () { return { connect() {}, start() {}, stop() {}, buffer: null }; };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.reject(new Error('no audio in test env')); };
      FakeAudioContext.prototype.close = function () {};
      win.AudioContext = FakeAudioContext;
    }
  });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 300));
  const C = window.LayerPlayerCore;

  // ---- Fonctions pures ----
  const eq3 = C.fxIntensityBounds(null, 3);
  check('3 couches sans limites : découpage égal (1/3, 2/3)', eq3.length === 2 && Math.abs(eq3[0] - 1 / 3) < 1e-9 && Math.abs(eq3[1] - 2 / 3) < 1e-9);
  check('limites réglables conservées (30 %, 60 %)', JSON.stringify(C.fxIntensityBounds([0.3, 0.6], 3)) === '[0.3,0.6]');
  check('limites dans le désordre : triées', JSON.stringify(C.fxIntensityBounds([0.6, 0.3], 3)) === '[0.3,0.6]');
  check('nombre de limites incohérent (couche ajoutée) : retour au découpage égal', C.fxIntensityBounds([0.3, 0.6], 4).length === 3);
  check('moins de 2 couches : pas de zones', C.fxIntensityBounds([0.5], 1) === null);
  const b = [0.3, 0.6];
  check('0 % -> intensité 1', C.fxSliderIntensityLevel(b, 0) === 0);
  check('29 % -> intensité 1', C.fxSliderIntensityLevel(b, 0.29) === 0);
  check('30 % -> intensité 2', C.fxSliderIntensityLevel(b, 0.3) === 1);
  check('59 % -> intensité 2', C.fxSliderIntensityLevel(b, 0.59) === 1);
  check('60 % -> intensité 3', C.fxSliderIntensityLevel(b, 0.6) === 2);
  check('100 % -> intensité 3', C.fxSliderIntensityLevel(b, 1) === 2);

  const layers = [{ label: 'Calme', file: 'a.ogg' }, { label: 'Tension', file: 'b.ogg' }, { label: 'Combat', file: 'c.ogg' }];
  const vertical = extra => Object.assign({ id: 'v1', title: 'V', mode: 'vertical', duration: 8, layers }, extra);
  const slIntensity = { id: 's1', label: 'Ennemis', defaultValue: 0.5, visible: true, bindings: [], thresholds: [], intensity: { bounds: [0.3, 0.6] } };
  const slHealth = { id: 's2', label: 'Santé', defaultValue: 1, visible: true, bindings: [{ target: { type: 'track' }, param: 'highcut.frequency', from: 800, to: 20000 }], thresholds: [] };

  const valid = C.fxSlidersValid(vertical({ fxSliders: [slIntensity, slHealth] }));
  check('un curseur sans liaison ni seuil mais qui pilote l\'intensité est gardé', valid.some(s => s.id === 's1'));
  check('le curseur Santé ne pilote pas l\'intensité', !valid.find(s => s.id === 's2').intensity);
  const two = C.fxSlidersValid(vertical({ fxSliders: [slIntensity, Object.assign({}, slIntensity, { id: 's3' })] }));
  check('deux curseurs d\'intensité : seul le premier pilote', two.filter(s => s.intensity).length === 1 && two[0].intensity);
  check('hors mode vertical : pas de zones d\'intensité', C.fxSlidersValid({ mode: 'sequential', layers, fxSliders: [slIntensity] }).length === 0);

  // ---- Lecteur : boutons OU curseur ----
  const rowButtons = C.buildTrackRow(vertical({ fxSliders: [slHealth] }), [], false, true);
  check('sans curseur d\'intensité : boutons 1/2/3 affichés', rowButtons.querySelectorAll('.intensity-chip').length === 3);
  const rowSlider = C.buildTrackRow(vertical({ fxSliders: [slIntensity, slHealth] }), [], false, true);
  check('avec curseur d\'intensité : plus de boutons 1/2/3', rowSlider.querySelectorAll('.intensity-chip').length === 0);
  check('avec curseur d\'intensité : curseur public affiché', !!rowSlider.querySelector('[data-fx-slider="s1"]'));

  // ---- Lecteur en marche : bouger le curseur change l'intensité au franchissement d'une limite ----
  const events = [];
  window.umami = { track: (name, detail) => events.push({ name, detail }) };
  const trk = vertical({ id: 'v2', fxSliders: [slIntensity] });
  const wrap = C.buildTrackRow(trk, [], false, true);
  window.document.body.appendChild(wrap);
  C.initTrackPlayer(trk, wrap);
  const inp = wrap.querySelector('[data-fx-slider="s1"]');
  const move = pct => { inp.value = String(pct); inp.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const levels = () => events.filter(e => e.name === 'intensity_change').map(e => e.detail.level);
  move(55);
  check('50 % -> 55 % (même zone) : aucun changement d\'intensité', levels().length === 0);
  move(75);
  check('55 % -> 75 % : passage à l\'intensité 3', JSON.stringify(levels()) === '[2]');
  move(80);
  check('75 % -> 80 % : rien de plus', JSON.stringify(levels()) === '[2]');
  move(10);
  check('80 % -> 10 % : retour à l\'intensité 1', JSON.stringify(levels()) === '[2,0]');

  // ---- Backstage : interrupteur + zones ----
  window.eval('currentUserIsAdmin = true');
  const edNo = window.eval('fxSlidersEditorHtml')(vertical({ fxSliders: [slHealth] }), 0);
  check('Backstage : interrupteur « Pilote l\'intensité » proposé en mode vertical', edNo.includes('data-fxs-prop="intensity"'));
  const edYes = window.eval('fxSlidersEditorHtml')(vertical({ fxSliders: [slIntensity] }), 0);
  check('Backstage : 2 limites réglables pour 3 couches', (edYes.match(/data-field="fxSliderIntensityBound"/g) || []).length === 2);
  check('Backstage : zone nommée d\'après la couche', edYes.includes('(Tension)') && edYes.includes('value="30"') && edYes.includes('value="60"'));
  const edSeq = window.eval('fxSlidersEditorHtml')({ mode: 'sequential', layers, fxSliders: [slHealth] }, 0);
  check('Backstage : pas d\'interrupteur hors mode vertical', !edSeq.includes('data-fxs-prop="intensity"'));
  const cleaned = window.eval('fxSlidersClean')([slIntensity, slHealth]);
  check('enregistrement : zones conservées', JSON.stringify(cleaned[0].intensity) === '{"bounds":[0.3,0.6]}' && !('intensity' in cleaned[1]));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
