// Courbes lissées des curseurs de paramètre (27/09) : interpolation cubique monotone entre les points posés par le
// compositeur -- passe par chaque point, ne dépasse jamais ses voisins, reste entre 0 et 1 ; sans l'option, segments
// droits comme avant. Vérifie aussi que l'option voyage : Backstage (nettoyage à la publication) -> lecteur (liaisons
// compilées) -> valeur du paramètre. Le rendu hors-ligne (outil vidéo) passe par les mêmes fonctions.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
const check = (l, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' - ' + l); if (!c) failures++; };

const player = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf8');
const ctx = { window: {}, document: { addEventListener() {}, createElement: () => ({ style: {} }) }, navigator: {} };
// Seules les fonctions pures des curseurs sont nécessaires : on les extrait du vrai player.js.
const a = player.indexOf("const FX_SLIDER_PARAMS"), b = player.indexOf('// Réglages imposés à UNE cible par les curseurs');
vm.createContext(ctx);
vm.runInContext('function fxTargetKeyFromTarget(t){ return t && t.type === "track" ? "track" : null; }\n' + player.slice(a, b) + '\nthis.api = { fxCurveEval, fxCurveSanitize, fxSlidersValid, fxSliderBindingValue };', ctx);
const { fxCurveEval, fxSlidersValid, fxSliderBindingValue } = ctx.api;

const c = [{ x: 0, y: 0 }, { x: 0.5, y: 0.9 }, { x: 1, y: 1 }];
check('sans option : segments droits (inchangé)', Math.abs(fxCurveEval(c, 0.25, false) - 0.45) < 1e-9);
check('lissée : passe par chaque point', Math.abs(fxCurveEval(c, 0.5, true) - 0.9) < 1e-9 && fxCurveEval(c, 0, true) === 0 && fxCurveEval(c, 1, true) === 1);
check('lissée : différente des segments entre deux points', Math.abs(fxCurveEval(c, 0.25, true) - 0.45) > 0.02);
let mono = true, prev = -1;
for (let i = 0; i <= 200; i++) { const y = fxCurveEval(c, i / 200, true); if (y < prev - 1e-12) mono = false; prev = y; }
check('lissée : une courbe qui monte ne redescend jamais (pas de creux)', mono);
const z = [{ x: 0, y: 0.2 }, { x: 0.3, y: 1 }, { x: 0.6, y: 0 }, { x: 1, y: 0.5 }];
let over = false;
for (let i = 0; i <= 400; i++) {
  const x = i / 400, y = fxCurveEval(z, x, true);
  const k = z.findIndex(q => q.x >= x), lo = Math.min(z[Math.max(0, k - 1)].y, z[k].y), hi = Math.max(z[Math.max(0, k - 1)].y, z[k].y);
  if (y < lo - 1e-9 || y > hi + 1e-9) over = true;
}
check('lissée : entre deux points, jamais au-delà de leurs valeurs (zigzag)', !over);
check('deux points seulement : droite, même avec l’option', Math.abs(fxCurveEval([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.3, true) - 0.3) < 1e-9);

const track = { fxSliders: [{ id: 's', bindings: [{ target: { type: 'track' }, param: 'highcut.frequency', from: 400, to: 20000, curve: c, curveSmooth: true }] }] };
const compiled = fxSlidersValid(track)[0].bindings[0];
check('lecteur : l’option est gardée dans la liaison compilée', compiled.curveSmooth === true);
const smoothVal = fxSliderBindingValue(compiled, 0.25), straightVal = fxSliderBindingValue(Object.assign({}, compiled, { curveSmooth: false }), 0.25);
check('lecteur : la valeur du paramètre suit la courbe lissée', smoothVal !== straightVal);

// Backstage : fxSlidersClean garde l'option (seulement avec une courbe)
const bs = fs.readFileSync(path.join(__dirname, 'src', 'backstage', '14e-editeurs-effets-triggers-curseurs.js'), 'utf8');
const fnStart = bs.indexOf('function fxSlidersClean'), fnEnd = bs.indexOf('\n}\n', fnStart) + 3;
const bctx = { window: { LayerPlayerCore: { fxCurveSanitize: ctx.api.fxCurveSanitize } } };
vm.createContext(bctx);
vm.runInContext(bs.slice(fnStart, fnEnd) + '\nthis.clean = fxSlidersClean;', bctx);
const cleaned = bctx.clean([{ id: 's', bindings: [{ target: { type: 'track' }, param: 'volume.gain', from: 0, to: 1, curve: c, curveSmooth: true }, { target: { type: 'track' }, param: 'volume.gain', from: 0, to: 1, curveSmooth: true }] }]);
check('Backstage : option publiée avec sa courbe', cleaned[0].bindings[0].curveSmooth === true);
check('Backstage : option sans courbe écartée', !('curveSmooth' in cleaned[0].bindings[1]));
console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
