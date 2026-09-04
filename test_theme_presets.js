// Vérifie la résolution des presets du palier Free côté page publique (Chantier Apparence Phase 3, 4
// septembre) : sélection d'un preset -> couleurs/police/séparateur effectivement appliqués, repli
// silencieux sur "Défaut" si presetId absent/inconnu, et surtout que block.appearance est bien IGNORÉ au
// rendu pour un AdReel Free (mais reste en base -- non-destructif, testé séparément dans
// test_free_tier_fallback.js). Charge le VRAI code de index.html (extrait de son unique <script> inline)
// dans JSDOM, avec fetch('./data.json') stubbé -- même esprit que test_player_regression.js (sources
// réelles inlinées, pas une réimplémentation de la logique testée).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function extractInlineScript(html) {
  const matches = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  if (matches.length !== 1) throw new Error('index.html : ' + matches.length + ' bloc(s) <script> inline trouvés, 1 attendu -- ajuster ce test.');
  return matches[0];
}

async function runIndexInit(adreelId, adReels, customFonts) {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  const indexSrc = extractInlineScript(indexHtml).replace(/<\/script/gi, '<\\/script');

  const html = `<!DOCTYPE html><html><body>
  <div id="lightboxOverlay" class="lightbox-overlay">
    <button class="lightbox-close" type="button">x</button>
    <button class="lightbox-prev" type="button">p</button>
    <img id="lightboxImg" src="" alt="">
    <button class="lightbox-next" type="button">n</button>
  </div>
  <button id="shareBtn"></button>
  <div class="page">
    <div id="blocksContainer"></div>
    <div class="contact" id="contact"></div>
    <div class="layerpitch-credit" id="layerpitchCredit"></div>
    <label><input type="checkbox" id="nightModeToggle"></label>
    <label><input type="checkbox" id="contrastToggle"></label>
  </div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  <script>${indexSrc}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html?adreel=' + encodeURIComponent(adreelId),
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
      win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, adReels, customFonts: customFonts || [] }) });
    }
  });
  const { window } = dom;
  await new Promise(resolve => setTimeout(resolve, 30));
  await window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return window;
}

(async () => {
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  const textBlock = { id: 'b1', type: 'text', content: 'Hello block', appearance: { titleColor: '#00ff00' } };

  // ---- Free, preset connu (forest) ----
  {
    const win = await runIndexInit('free1', [{
      id: 'free1', label: 'Free Test', lang: 'fr', blocks: [textBlock], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'Free Composer', theme: { bgColor: '#123456', titleColor: '#111111', contentColor: '#222222', font: 'default', presetId: 'forest' }, effectivePlan: 'free' }
    }]);
    const root = win.document.documentElement;
    check('Free + preset connu (forest) : --bg vient du preset, pas du thème fin', root.style.getPropertyValue('--bg') === '#16321F');
    check('Free + preset connu (forest) : --text-title vient du preset', root.style.getPropertyValue('--text-title') === '#D4AF37');
    const blockEl = [...win.document.querySelectorAll('.block')].find(el => el.textContent.includes('Hello block'));
    check('Free : block.appearance ignoré au rendu (titleColor du bloc PAS appliqué)', blockEl && blockEl.style.getPropertyValue('--text-title') !== '#00ff00');
  }

  // ---- Free, presetId absent -> repli silencieux sur "Défaut" ----
  {
    const win = await runIndexInit('free2', [{
      id: 'free2', label: 'Free No Preset', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'Free Composer 2', theme: { bgColor: '#123456' }, effectivePlan: 'free' }
    }]);
    const root = win.document.documentElement;
    check('Free + presetId absent : repli sur preset "Défaut" (#FAFAF8)', root.style.getPropertyValue('--bg') === '#FAFAF8');
  }

  // ---- Free, presetId inconnu -> même repli ----
  {
    const win = await runIndexInit('free3', [{
      id: 'free3', label: 'Free Bad Preset', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'Free Composer 3', theme: { presetId: 'does-not-exist' }, effectivePlan: 'free' }
    }]);
    const root = win.document.documentElement;
    check('Free + presetId inconnu : repli sur preset "Défaut" (#FAFAF8)', root.style.getPropertyValue('--bg') === '#FAFAF8');
  }

  // ---- Starter : thème fin appliqué, PAS le preset, et block.appearance appliqué ----
  {
    const win = await runIndexInit('starter1', [{
      id: 'starter1', label: 'Starter Test', lang: 'fr', blocks: [textBlock], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'Starter Composer', theme: { bgColor: '#111111', titleColor: '#222222', contentColor: '#333333', font: 'default' }, effectivePlan: 'starter' }
    }]);
    const root = win.document.documentElement;
    check('Starter : --bg vient du thème fin du compositeur, pas d\'un preset', root.style.getPropertyValue('--bg') === '#111111');
    const blockEl = [...win.document.querySelectorAll('.block')].find(el => el.textContent.includes('Hello block'));
    check('Starter : block.appearance appliqué (titleColor du bloc respecté)', blockEl && blockEl.style.getPropertyValue('--text-title') === '#00ff00');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
