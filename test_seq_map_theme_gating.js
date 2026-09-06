// Vérifie le gating Pro du thème de la carte des chemins (Chantier Apparence, palier Pro, 06/09) sur les
// 3 pages publiques : Free/Starter imposent "light" quel que soit data.seqMapTheme, Pro applique le
// réglage choisi. Réglage GLOBAL au compositeur (data.seqMapTheme, pas un champ par AdReel/pack/
// collection), même principe que test_waveform_style_gating.js -- même harnais (sources réelles inlinées
// dans JSDOM, fetch stubbé).
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
const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');

async function runIndexInit(adreelId, adReels, seqMapTheme) {
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
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, adReels, customFonts: [], seqMapTheme }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}
async function runPackInit(packId, packs, seqMapTheme) {
  const packSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'pack.html'), 'utf-8'), 'pack.html').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <button id="shareBtn"></button>
  <div class="page"><div id="content"></div><label><input type="checkbox" id="nightModeToggle"></label><label><input type="checkbox" id="contrastToggle"></label></div>
  <script>${i18nSrc}</script><script>${playerSrc}</script><script>${packSrc}</script>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/pack.html?id=' + encodeURIComponent(packId),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, packs, collections: [], adReels: [], customFonts: [], seqMapTheme }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}
async function runCollectionInit(collId, collections, seqMapTheme) {
  const collSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'collection.html'), 'utf-8'), 'collection.html').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <button id="shareBtn"></button>
  <div class="page"><div id="content"></div><label><input type="checkbox" id="nightModeToggle"></label><label><input type="checkbox" id="contrastToggle"></label></div>
  <script>${i18nSrc}</script><script>${playerSrc}</script><script>${collSrc}</script>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/collection.html?id=' + encodeURIComponent(collId),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, collections, packs: [], adReels: [], customFonts: [], seqMapTheme }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}

(async () => {
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // ---- AdReel : Free/Starter imposent "light" même si data.seqMapTheme demande "dark" ----
  for (const tier of ['free', 'starter']) {
    const win = await runIndexInit('a-' + tier, [{
      id: 'a-' + tier, label: 'x', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'default' }, effectivePlan: tier }
    }], 'dark');
    check(`AdReel ${tier} : thème forcé sur "light" malgré data.seqMapTheme="dark"`, win.LayerPlayerCore.currentSeqMapTheme() === 'light');
  }
  {
    const win = await runIndexInit('a-pro', [{
      id: 'a-pro', label: 'x', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'default' }, effectivePlan: 'pro' }
    }], 'dark');
    check('AdReel pro : thème "dark" appliqué', win.LayerPlayerCore.currentSeqMapTheme() === 'dark');
  }
  {
    // AdReel publié avant ce chantier (data.seqMapTheme absent) : repli "light", jamais de crash.
    const win = await runIndexInit('a-pro-notheme', [{
      id: 'a-pro-notheme', label: 'x', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'default' }, effectivePlan: 'pro' }
    }], undefined);
    check('AdReel pro sans data.seqMapTheme : repli sur "light"', win.LayerPlayerCore.currentSeqMapTheme() === 'light');
  }

  // ---- Pack : même logique ----
  for (const tier of ['free', 'starter']) {
    const win = await runPackInit('p-' + tier, [{ id: 'p-' + tier, title: 'x', presentationFr: 't', presentationEn: '', presetId: 'default', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: tier, trackIds: [], sfxIds: [] }], 'dark');
    check(`Pack ${tier} : thème forcé sur "light" malgré data.seqMapTheme="dark"`, win.LayerPlayerCore.currentSeqMapTheme() === 'light');
  }
  {
    const win = await runPackInit('p-pro', [{ id: 'p-pro', title: 'x', presentationFr: 't', presentationEn: '', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: 'pro', trackIds: [], sfxIds: [] }], 'dark');
    check('Pack pro : thème "dark" appliqué', win.LayerPlayerCore.currentSeqMapTheme() === 'dark');
  }

  // ---- Collection : même logique ----
  for (const tier of ['free', 'starter']) {
    const win = await runCollectionInit('c-' + tier, [{ id: 'c-' + tier, title: 'x', presentationFr: 't', presentationEn: '', presetId: 'default', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: tier, packIds: [] }], 'dark');
    check(`Collection ${tier} : thème forcé sur "light" malgré data.seqMapTheme="dark"`, win.LayerPlayerCore.currentSeqMapTheme() === 'light');
  }
  {
    const win = await runCollectionInit('c-pro', [{ id: 'c-pro', title: 'x', presentationFr: 't', presentationEn: '', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: 'pro', packIds: [] }], 'dark');
    check('Collection pro : thème "dark" appliqué', win.LayerPlayerCore.currentSeqMapTheme() === 'dark');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
