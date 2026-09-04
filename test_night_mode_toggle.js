// Vérifie le mode nuit visiteur (Chantier Apparence Phase 3, 4 septembre) : présence du bouton,
// bascule effective, persistance localStorage, et surtout la non-régression / recomposition avec le
// contraste renforcé existant -- les deux cases cochées ensemble ne doivent jamais redonner un écran
// blanc (c'était tout l'objet du point 5 du chantier). Même harnais JSDOM que test_player_regression.js.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <div id="host"></div>
  <input type="checkbox" id="contrastToggle">
  <input type="checkbox" id="nightModeToggle">
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return 0; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }; };
      FakeAudioContext.prototype.createBufferSource = function () { return { buffer: null, onended: null, connect() {}, stop() {}, start() {} }; };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 2 }); };
      win.AudioContext = FakeAudioContext;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
      win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
    }
  });
  const { window } = dom;
  await new Promise(resolve => setTimeout(resolve, 50));
  const doc = window.document;
  const Core = window.LayerPlayerCore;
  const root = doc.documentElement;
  function bg() { return root.style.getPropertyValue('--bg'); }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  function toggle(el) { el.checked = !el.checked; el.dispatchEvent(new window.Event('change', { bubbles: true })); }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  check('setupNightModeToggle exporté', typeof Core.setupNightModeToggle === 'function');

  try { window.localStorage.clear(); } catch (e) {}
  const contrastToggle = doc.getElementById('contrastToggle');
  const nightToggle = doc.getElementById('nightModeToggle');

  Core.setupContrastToggle('contrastToggle', '#f6f5f3', '#262521', '#262521');
  Core.setupNightModeToggle('nightModeToggle', '#f6f5f3', '#262521', '#262521');

  // ---- état initial : rien coché, thème de base ----
  check('fond = thème de base au chargement (aucun mode actif)', bg() === '#f6f5f3');
  check('body sans night-mode au chargement', !doc.body.classList.contains('night-mode'));
  check('body sans high-contrast au chargement', !doc.body.classList.contains('high-contrast'));

  // ---- mode nuit seul ----
  toggle(nightToggle);
  check('mode nuit seul : fond sombre (#121212)', bg() === '#121212');
  check('mode nuit seul : body.night-mode posé', doc.body.classList.contains('night-mode'));
  check('mode nuit seul : body.high-contrast absent', !doc.body.classList.contains('high-contrast'));
  let saved = null;
  try { saved = window.localStorage.getItem('layerpitch-night-mode'); } catch (e) {}
  check('persistance localStorage mode nuit = "1"', saved === '1');

  // ---- retour à l'état de base, puis contraste seul (non-régression) ----
  toggle(nightToggle); // désactive le mode nuit
  check('contraste seul : setup encore fonctionnel après un cycle mode nuit', bg() === '#f6f5f3');
  toggle(contrastToggle);
  check('contraste seul (non-régression) : fond blanc pur (#ffffff)', bg() === '#ffffff');
  check('contraste seul : body.high-contrast posé', doc.body.classList.contains('high-contrast'));
  check('contraste seul : body.night-mode absent', !doc.body.classList.contains('night-mode'));

  // ---- les deux ensemble : jamais un écran blanc malgré le contraste renforcé ----
  toggle(nightToggle);
  check('combiné : body.night-mode ET body.high-contrast posés', doc.body.classList.contains('night-mode') && doc.body.classList.contains('high-contrast'));
  check('combiné : fond noir pur, PAS blanc (pas de régression sur l\'objectif du mode nuit)', bg() === '#000000');
  check('combiné : texte blanc pur (lisible sur fond noir)', root.style.getPropertyValue('--text') === '#ffffff');

  // ---- désactiver le contraste en gardant le mode nuit : repasse à la palette nuit normale ----
  toggle(contrastToggle);
  check('mode nuit seul à nouveau après désactivation du contraste : fond #121212', bg() === '#121212');
  check('mode nuit seul à nouveau : body.high-contrast retiré', !doc.body.classList.contains('high-contrast'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
