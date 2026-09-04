// Vérifie le repli non-destructif Starter -> Free (Chantier Apparence Phase 3, 4 septembre, point 1 du
// prompt) : un compositeur rétrogradé Free garde ses anciens réglages fins (thème général + par bloc) en
// base -- ils cessent seulement d'être APPLIQUÉS au rendu tant que effectivePlan==='free', et
// réapparaissent automatiquement dès que le palier effectif redevient Starter, sans qu'aucune donnée
// n'ait été perdue ou migrée entre-temps. Round-trip sur les MÊMES données sous-jacentes (seul
// effectivePlan change), avec le vrai code de index.html (même harnais que test_theme_presets.js).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function extractInlineScript(html, file) {
  const matches = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  if (matches.length !== 1) throw new Error(file + ' : ' + matches.length + ' bloc(s) <script> inline trouvés, 1 attendu -- ajuster ce test.');
  return matches[0];
}

async function runIndexInit(adreelId, adReels) {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const indexSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8'), 'index.html').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <div id="lightboxOverlay"><button class="lightbox-close" type="button"></button><button class="lightbox-prev" type="button"></button><img id="lightboxImg" src="" alt=""><button class="lightbox-next" type="button"></button></div>
  <button id="shareBtn"></button>
  <div class="page"><div id="blocksContainer"></div><div class="contact" id="contact"></div><div class="layerpitch-credit" id="layerpitchCredit"></div>
  <label><input type="checkbox" id="nightModeToggle"></label><label><input type="checkbox" id="contrastToggle"></label></div>
  <script>${i18nSrc}</script><script>${playerSrc}</script><script>${indexSrc}</script>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html?adreel=' + encodeURIComponent(adreelId),
    runScripts: 'dangerously', pretendToBeVisual: true,
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
      win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, adReels, customFonts: [] }) });
    }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}

(async () => {
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // Un seul et même "profil publié" -- ancien thème fin (Starter) + un bloc personnalisé -- jamais
  // modifié entre les deux rendus ci-dessous. Seul profile.effectivePlan change, exactement comme lors
  // d'une vraie rétrogradation/re-souscription (publishAll() ne fait jamais autre chose que réécrire ce
  // seul champ -- voir test_publish_effective_plan.js).
  const richTheme = { bgColor: '#a1a1a1', titleColor: '#b2b2b2', contentColor: '#c3c3c3', font: 'google:Fraunces', presetId: 'forest' };
  const customizedBlock = { id: 'b1', type: 'text', content: 'Bloc personnalisé', appearance: { titleColor: '#00ff00' } };

  const adReelDowngraded = {
    id: 'x', label: 'x', lang: 'fr', blocks: [customizedBlock], testimonials: [], trackIds: [], trackOverrides: {},
    profile: { title: 'x', theme: richTheme, effectivePlan: 'free' }
  };
  const winFree = await runIndexInit('x', [adReelDowngraded]);
  const rootFree = winFree.document.documentElement;
  check('Free : anciens réglages fins IGNORÉS au rendu (fond = preset forest, pas #a1a1a1)', rootFree.style.getPropertyValue('--bg') === '#16321F');
  const blockElFree = [...winFree.document.querySelectorAll('.block')].find(el => el.textContent.includes('Bloc personnalisé'));
  check('Free : réglage par bloc IGNORÉ au rendu', blockElFree && blockElFree.style.getPropertyValue('--text-title') !== '#00ff00');

  // Repassage Starter : EXACTEMENT les mêmes données (richTheme/customizedBlock réutilisés tels quels,
  // aucune donnée reconstruite) -- seul effectivePlan diffère.
  const adReelRestored = {
    id: 'x', label: 'x', lang: 'fr', blocks: [customizedBlock], testimonials: [], trackIds: [], trackOverrides: {},
    profile: { title: 'x', theme: richTheme, effectivePlan: 'starter' }
  };
  const winStarter = await runIndexInit('x', [adReelRestored]);
  const rootStarter = winStarter.document.documentElement;
  check('Starter (repli) : anciens réglages fins RÉAPPARAISSENT tels quels (fond = #a1a1a1)', rootStarter.style.getPropertyValue('--bg') === '#a1a1a1');
  const blockElStarter = [...winStarter.document.querySelectorAll('.block')].find(el => el.textContent.includes('Bloc personnalisé'));
  check('Starter (repli) : réglage par bloc RÉAPPARAÎT tel quel (titleColor #00ff00)', blockElStarter && blockElStarter.style.getPropertyValue('--text-title') === '#00ff00');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
