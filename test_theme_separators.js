// Vérifie le réglage des séparateurs (Chantier Apparence Phase 3, 4 septembre) : indépendant du reste du
// thème général sur Starter, imposé par le preset sur Free, désactivé par défaut si jamais réglé (pas de
// régression visuelle sur un AdReel/Pack Starter déjà publié). Charge le VRAI code de index.html et
// pack.html (extrait de leur unique <script> inline), même esprit que test_theme_presets.js.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function extractInlineScript(html, file) {
  const matches = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  if (matches.length !== 1) throw new Error(file + ' : ' + matches.length + ' bloc(s) <script> inline trouvés, 1 attendu -- ajuster ce test.');
  return matches[0];
}

function fakeAudioContextHooks(win) {
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

async function runIndexInit(adreelId, adReels) {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const indexSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8'), 'index.html').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <div id="lightboxOverlay"><button class="lightbox-close" type="button"></button><button class="lightbox-prev" type="button"></button><img id="lightboxImg" src="" alt=""><button class="lightbox-next" type="button"></button></div>
  <button id="shareBtn"></button>
  <div class="page">
    <div id="blocksContainer"></div>
    <div class="contact" id="contact"></div>
    <div class="layerpitch-credit" id="layerpitchCredit"></div>
    <label><input type="checkbox" id="nightModeToggle"></label>
    <label><input type="checkbox" id="contrastToggle"></label>
  </div>
  <script>${i18nSrc}</script><script>${playerSrc}</script><script>${indexSrc}</script>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html?adreel=' + encodeURIComponent(adreelId),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, adReels, customFonts: [] }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}

async function runPackInit(packId, packs) {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const packSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'pack.html'), 'utf-8'), 'pack.html').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <button id="shareBtn"></button>
  <div class="page">
    <div id="content"></div>
    <label><input type="checkbox" id="nightModeToggle"></label>
    <label><input type="checkbox" id="contrastToggle"></label>
  </div>
  <script>${i18nSrc}</script><script>${playerSrc}</script><script>${packSrc}</script>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/pack.html?id=' + encodeURIComponent(packId),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, packs, collections: [], adReels: [], customFonts: [] }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}

(async () => {
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // ---- AdReel Free : séparateur imposé par le preset (forest -> visible, #8C7A3D, 1px) ----
  {
    const win = await runIndexInit('free1', [{
      id: 'free1', label: 'Free', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'forest' }, effectivePlan: 'free' }
    }]);
    const root = win.document.documentElement;
    check('AdReel Free (forest) : séparateur du preset appliqué (#8C7A3D)', root.style.getPropertyValue('--separator-color') === '#8C7A3D');
    check('AdReel Free (forest) : show-separators posé (preset visible=true)', win.document.getElementById('blocksContainer').classList.contains('show-separators'));
  }

  // ---- AdReel Free : preset "minimal" (séparateur invisible) ----
  {
    const win = await runIndexInit('free2', [{
      id: 'free2', label: 'Free', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'minimal' }, effectivePlan: 'free' }
    }]);
    check('AdReel Free (minimal) : show-separators absent (preset visible=false)', !win.document.getElementById('blocksContainer').classList.contains('show-separators'));
  }

  // ---- AdReel Starter : séparateur réglé indépendamment du thème général ----
  {
    const win = await runIndexInit('starter1', [{
      id: 'starter1', label: 'Starter', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { bgColor: '#111111', separator: { visible: true, color: '#abcdef', thickness: 4 } }, effectivePlan: 'starter' }
    }]);
    const root = win.document.documentElement;
    check('AdReel Starter : couleur de séparateur indépendante du thème (#abcdef)', root.style.getPropertyValue('--separator-color') === '#abcdef');
    check('AdReel Starter : épaisseur de séparateur respectée (4px)', root.style.getPropertyValue('--separator-width') === '4px');
    check('AdReel Starter : show-separators posé', win.document.getElementById('blocksContainer').classList.contains('show-separators'));
  }

  // ---- AdReel Starter sans réglage de séparateur : désactivé par défaut (non-régression) ----
  {
    const win = await runIndexInit('starter2', [{
      id: 'starter2', label: 'Starter', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { bgColor: '#111111' }, effectivePlan: 'starter' }
    }]);
    check('AdReel Starter sans séparateur réglé : show-separators absent (défaut désactivé)', !win.document.getElementById('blocksContainer').classList.contains('show-separators'));
  }

  // ---- Pack Starter : séparateur entre sections, indépendant du thème ----
  {
    const win = await runPackInit('p1', [{
      id: 'p1', title: 'Pack Test', presentationFr: 'Texte', presentationEn: '', bgColor: '#111111', textColor: '#222222', font: 'default',
      separator: { visible: true, color: '#123123', thickness: 2 }, effectivePlan: 'starter', trackIds: [], sfxIds: []
    }]);
    const root = win.document.documentElement;
    check('Pack Starter : couleur de séparateur indépendante du thème (#123123)', root.style.getPropertyValue('--separator-color') === '#123123');
    check('Pack Starter : show-separators posé sur #content', win.document.getElementById('content').classList.contains('show-separators'));
  }

  // ---- Pack Free : séparateur imposé par le preset ----
  {
    const win = await runPackInit('p2', [{
      id: 'p2', title: 'Pack Free', presentationFr: 'Texte', presentationEn: '', presetId: 'neon', effectivePlan: 'free', trackIds: [], sfxIds: []
    }]);
    const root = win.document.documentElement;
    check('Pack Free (neon) : couleur de fond du preset appliquée (#1B1035)', root.style.getPropertyValue('--bg') === '#1B1035');
    check('Pack Free (neon) : séparateur du preset appliqué (#7A5FFF)', root.style.getPropertyValue('--separator-color') === '#7A5FFF');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
