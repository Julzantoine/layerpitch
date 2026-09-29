// scripts/test-harness.js — outils partagés par les tests qui chargent une vraie page dans jsdom (dette, 27/09).
//
// Avant : 15 tests recopiaient chacun le même « faux Backstage » (lecture de la page, scripts locaux recopiés dans la
// page, faux contexte audio, attente du chargement) -- une nouvelle balise de script ou un changement de la page
// obligeait à corriger chaque copie. Désormais un seul endroit. Rangé dans scripts/ (et non à la racine) pour que
// `npm test`, qui lance tous les test_*.js de la racine, ne le prenne pas pour un test.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const readLocal = file => fs.readFileSync(path.join(root, file), 'utf-8');

// Faux contexte audio minimal : assez pour que player.js se charge et que le Backstage construise ses aperçus, sans son.
function installFakeAudio(win) {
  function FakeAudioContext() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
  FakeAudioContext.prototype.createGain = function () { return { gain: { setValueAtTime() {}, value: 1 }, connect() {}, disconnect() {} }; };
  FakeAudioContext.prototype.createBufferSource = function () { return { connect() {}, start() {}, stop() {}, buffer: null }; };
  FakeAudioContext.prototype.decodeAudioData = function () { return Promise.reject(new Error('no audio in test env')); };
  FakeAudioContext.prototype.close = function () {};
  win.AudioContext = FakeAudioContext;
}

// Remplace les balises <script src="fichier.js?v=…"> LOCALES par le contenu du fichier (jsdom ne charge pas les fichiers
// lui-même). only : liste des fichiers à recopier (les autres balises restent, sans effet) ; par défaut tous.
function inlineLocalScripts(html, only) {
  return html.replace(/<script\b[^>]*\bsrc="(?!https?:|\/\/)([^"?]+\.js)(\?[^"]*)?"[^>]*><\/script>/g, (m, src) =>
    (only && !only.includes(src)) ? m : `<script>${readLocal(src).replace(/<\/script/gi, '<\\/script')}</script>`);
}

// Le vrai Backstage dans jsdom, prêt à l'emploi (après DOMContentLoaded). opts.scripts : fichiers locaux à recopier
// (défaut : tous ceux de la page) ; opts.beforeParse(win) : faux services à poser avant l'exécution des scripts.
async function loadBackstage(opts) {
  opts = opts || {};
  const html = inlineLocalScripts(readLocal('layerpitch-backstage.html')
    .replace(/<script[^>]*src="https:\/\/unpkg\.com[^"]*"[^>]*><\/script>\s*/g, ''),
    // layerpitch-appearance.js (apparence commune) et layerpitch-album-shared.js (éditeurs d'album) : le Backstage en dépend au démarrage, toujours recopiés.
    opts.scripts && opts.scripts.concat('layerpitch-appearance.js', 'layerpitch-album-shared.js'));
  const dom = new JSDOM(html, {
    url: opts.url || 'http://localhost/test_backstage.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { installFakeAudio(win); if (opts.beforeParse) opts.beforeParse(win); },
  });
  await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 50)));
  return dom;
}


// ---- Page de test du lecteur (dette « ~30 tests du lecteur à migrer », 29/09) ----
// Page minimale : i18n + player.js recopiés dans le HTML, comme le faisaient les tests un par un.
function playerPageHtml() {
  const i18nSrc = readLocal('layerpitch-i18n.js');
  const playerSrc = readLocal('player.js').replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html><html><body><div id="host"></div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;
}
// Faux contexte audio « à horloge réelle » : currentTime suit l'heure, un segment se termine à sa durée (10 s par défaut).
function installTimedFakeAudio(win) {
      const epoch = Date.now();
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () {
        return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} };
      };
      FakeAudioContext.prototype.createBufferSource = function () {
        const ctxRef = this;
        const node = {
          buffer: null, onended: null, connect() {},
          stop() { if (node._endTimer) clearTimeout(node._endTimer); if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } },
          start(when) {
            const dur = (node.buffer && node.buffer.duration) || 1;
            const delaySec = Math.max(0, (when - ctxRef.currentTime) + dur);
            node._endTimer = setTimeout(() => { if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } }, delaySec * 1000);
          }
        };
        return node;
      };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 10 }); };
      win.AudioContext = FakeAudioContext;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
      win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
}

module.exports = { playerPageHtml, installTimedFakeAudio, installFakeAudio, inlineLocalScripts, loadBackstage, readLocal };
