// Vérifie les quatre styles de forme d'onde (Chantier Apparence, palier Pro, 05/09) : chaque style
// produit un rendu valide à partir des mêmes pics, et le repli automatique d'espace se déclenche
// correctement pour Miroir plein/Vagues superposées. Charge le vrai player.js dans JSDOM (même
// FakeAudioContext que test_embr_vertical_waveform.js/test_watermark_gating.js, seul moyen simple
// d'obtenir un environnement complet -- navigator/ResizeObserver/etc -- sans le whack-a-mole d'un
// sandbox vm minimal). JSDOM ne fournit aucun contexte canvas 2D réel (voir en-tête de
// test_embr_vertical_waveform.js) : on remplace donc getContext()/getBoundingClientRect() de chaque
// <canvas> par un faux qui enregistre ses appels, plutôt qu'un vrai moteur de rendu -- suffisant pour
// vérifier QUEL dessin a été produit.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function fakeAudioContextHooks(win) {
  function FakeAudioContext() { this.destination = {}; }
  Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return 0; } });
  FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
  win.AudioContext = FakeAudioContext;
  win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
  win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
  win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
}

const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
const dom = new JSDOM(`<!DOCTYPE html><html><body><script>${playerSrc}</script></body></html>`, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(win) { fakeAudioContextHooks(win); },
});
const win = dom.window;
const Core = win.LayerPlayerCore;

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

// Fausse <canvas> : un vrai élément DOM (pour que le code du moteur ne trébuche sur aucune méthode
// manquante), mais avec getBoundingClientRect()/getContext() remplacés pour piloter la taille annoncée
// et enregistrer les appels de dessin plutôt que de vraiment dessiner.
function makeFakeCanvas(widthCss, heightCss) {
  const calls = { fill: 0, fillRect: 0, arc: 0, roundRect: 0 };
  const ctx = {
    fillStyle: null, globalAlpha: 1,
    clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    roundRect() { calls.roundRect++; },
    fillRect() { calls.fillRect++; },
    arc() { calls.arc++; },
    fill() { calls.fill++; },
  };
  const canvas = win.document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ width: widthCss, height: heightCss });
  canvas.getContext = () => ctx;
  canvas._calls = calls;
  return canvas;
}

function fakePeaks(n) {
  return Array.from({ length: n }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i / 3)));
}

// ---- 1. Les quatre styles produisent un rendu valide à partir des mêmes pics ----
const peaks = fakePeaks(40);
['bars', 'mirror', 'dots', 'layers'].forEach(style => {
  const canvas = makeFakeCanvas(300, 60); // hauteur confortable, au-dessus du seuil de repli
  let threw = false;
  try { Core.drawWaveformCanvas(canvas, peaks, '#ff0000', style); }
  catch (e) { threw = true; console.error(e); }
  check(`${style} : ne lève aucune exception`, !threw);
  check(`${style} : dimensionne le canvas`, canvas.width > 0 && canvas.height > 0);
  check(`${style} : produit au moins un fill()`, canvas._calls.fill > 0);
});

// Signatures spécifiques par style (nombre de fill() attendu selon la structure de chaque dessin) --
// vérifie que chaque style dessine réellement SA forme, pas juste "quelque chose".
{
  const canvasBars = makeFakeCanvas(300, 60);
  Core.drawWaveformCanvas(canvasBars, peaks, '#fff', 'bars');
  check('bars : un fill() par colonne (via roundRect)', canvasBars._calls.fill === peaks.length && canvasBars._calls.roundRect === peaks.length);

  const canvasMirror = makeFakeCanvas(300, 60);
  Core.drawWaveformCanvas(canvasMirror, peaks, '#fff', 'mirror');
  check('mirror : un seul contour rempli (un seul fill())', canvasMirror._calls.fill === 1);

  const canvasLayers = makeFakeCanvas(300, 60);
  Core.drawWaveformCanvas(canvasLayers, peaks, '#fff', 'layers');
  check('layers : trois courbes empilées (trois fill())', canvasLayers._calls.fill === 3);

  const canvasDots = makeFakeCanvas(300, 60);
  Core.drawWaveformCanvas(canvasDots, peaks, '#fff', 'dots');
  check('dots : autant de fill() que de points (via arc)', canvasDots._calls.fill === canvasDots._calls.arc && canvasDots._calls.arc > 0);
}

// ---- 2. Repli automatique sous le seuil de hauteur ----
check('mirror sous le seuil (18px) -> repli sur bars', Core.resolveEffectiveWaveformStyle('mirror', 18) === 'bars');
check('layers sous le seuil (18px) -> repli sur bars', Core.resolveEffectiveWaveformStyle('layers', 18) === 'bars');
check('mirror au-dessus du seuil (40px) -> reste mirror', Core.resolveEffectiveWaveformStyle('mirror', 40) === 'mirror');
check('layers au-dessus du seuil (40px) -> reste layers', Core.resolveEffectiveWaveformStyle('layers', 40) === 'layers');
check('dots sous le seuil (18px) -> reste dots (pas de repli pour ce style)', Core.resolveEffectiveWaveformStyle('dots', 18) === 'dots');
check('bars sous le seuil (18px) -> reste bars (déjà le repli)', Core.resolveEffectiveWaveformStyle('bars', 18) === 'bars');
check('style inconnu -> repli sur bars', Core.resolveEffectiveWaveformStyle('bogus', 40) === 'bars');

// Vérifie que le repli s'applique bien EN PRATIQUE dans drawWaveformCanvas (pas seulement dans la
// fonction pure isolée) : un canvas trop bas demandant "mirror" doit produire la signature de "bars" (un
// fill() par colonne), pas celle de "mirror" (un seul fill()).
{
  const shortCanvas = makeFakeCanvas(300, 18); // sous WAVEFORM_TALL_STYLE_MIN_HEIGHT_CSS_PX (32)
  Core.drawWaveformCanvas(shortCanvas, peaks, '#fff', 'mirror');
  check('drawWaveformCanvas : mirror dans un espace bas retombe sur le rendu bars', shortCanvas._calls.fill === peaks.length);
}

// ---- 3. computeWaveformPeaks : résolution configurable, indépendante du style ----
{
  const sampleRate = 44100;
  const seconds = 2;
  const data = new Float32Array(sampleRate * seconds);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 20) * 0.8;
  const fakeBuffer = { sampleRate, getChannelData: () => data };
  const p64 = Core.computeWaveformPeaks(fakeBuffer, 64);
  const p256 = Core.computeWaveformPeaks(fakeBuffer, 256);
  check('computeWaveformPeaks : respecte le bucketCount demandé (64)', p64.length === 64);
  check('computeWaveformPeaks : respecte le bucketCount demandé (256, plus fin)', p256.length === 256);
  check('computeWaveformPeaks : pics dans [0,1]', p64.every(v => v >= 0 && v <= 1));
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
