// Curseur → position d'un Sfx sur sa trajectoire (27/09, demande de Jules-Antoine : « le véhicule commence loin, passe
// près de l'auditeur et repart au loin : le son commence pas fort, devient plus fort puis s'éloigne »). Vrai player.js
// chargé dans jsdom : le paramètre place le son le long du chemin (à vitesse constante), le son devient une source fixe
// que le curseur déplace en direct, sa distance à l'auditeur (donc son volume) suit ; sans ce paramètre, rien ne change.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
(async () => {
  let failures = 0;
  const check = (l, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' - ' + l); if (!c) failures++; };
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const dom = new JSDOM(`<!DOCTYPE html><html><body><script>${read('layerpitch-i18n.js')}</script><script>${read('player.js')}</script></body></html>`, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function P(v) { return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {}, setValueCurveAtTime() {} }; }
      function Ctx() { this.destination = {}; this.sampleRate = 48000; this.currentTime = 0; this.listener = {}; }
      Ctx.prototype.createGain = () => ({ gain: P(1), connect() {}, disconnect() {} });
      Ctx.prototype.createBiquadFilter = () => ({ frequency: P(20000), Q: P(1), connect() {}, disconnect() {} });
      Ctx.prototype.createPanner = () => ({ positionX: P(0), positionY: P(0), positionZ: P(0), connect() {}, disconnect() {} });
      Ctx.prototype.resume = () => Promise.resolve();
      win.AudioContext = Ctx;
      win.ResizeObserver = function () { return { observe() {}, disconnect() {} }; };
    }
  });
  await new Promise(r => setTimeout(r, 50));
  const C = dom.window.LayerPlayerCore;
  // Chemin : loin à gauche (−10, 20) -> tout près devant (0, 1) -> loin à droite (10, 20), deux segments de même longueur.
  const sfxSpatial = { enabled: true, room: 'outside', x: 0, y: 5, path: { mode: 'glide', points: [{ x: -10, y: 20 }, { x: 0, y: 1 }, { x: 10, y: 20 }] } };
  const at = f => C.fxSpatialWithOverride(sfxSpatial, { pathPos: f });
  const d = sp => Math.hypot(sp.x, sp.y);
  check('0 % : premier point', at(0).x === -10 && at(0).y === 20);
  check('50 % : milieu du chemin (le point le plus proche)', Math.abs(at(0.5).x) < 1e-9 && Math.abs(at(0.5).y - 1) < 1e-9);
  check('100 % : dernier point', at(1).x === 10 && at(1).y === 20);
  check('loin -> près -> loin : la distance (donc le volume) suit', d(at(0)) > d(at(0.25)) && d(at(0.25)) > d(at(0.5)) && d(at(0.5)) < d(at(0.75)) && d(at(0.75)) < d(at(1)));
  check('avec le curseur, le son devient une source fixe (déplaçable en direct)', C.normalizeSpatial(at(0.3)).path.mode === 'fixed' && C.normalizeSpatial(sfxSpatial).path.mode === 'glide');
  const ctx = new dom.window.AudioContext();
  const voice = C.buildSpatialVoice(ctx, at(0.3), {});
  check('voix construite : fixe, à la position voulue', voice.fixed === true && Math.abs(voice.startX - at(0.3).x) < 1e-9);
  check('sans paramètre « position sur la trajectoire » : chemin inchangé', C.fxSpatialWithOverride(sfxSpatial, { reverbDb: -3 }).path === sfxSpatial.path);
  check('Sfx sans trajectoire : le paramètre est ignoré', C.fxSpatialWithOverride({ enabled: true, x: 2, y: 3 }, { pathPos: 0.5 }).x === 2);
  // Liaison de curseur réelle : paramètre disponible et calculé de 0 à 1
  check('paramètre proposé pour les Sfx dans les liaisons', C.FX_SLIDER_PARAMS['spatial.pathPos'] && C.FX_SLIDER_PARAMS['spatial.pathPos'].kind === 'sfx');
  const sliders = C.fxSlidersValid({ fxSliders: [{ id: 's', bindings: [{ target: { type: 'sfx', id: 'car' }, param: 'spatial.pathPos', from: 0, to: 1 }] }] });
  const ov = C.fxSliderSfxOverrides(sliders, () => 0.5, 'car');
  check('curseur à mi-course -> pathPos 0,5', ov && Math.abs(ov.pathPos - 0.5) < 1e-9);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
