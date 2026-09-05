// Vérifie le gating Pro du style de forme d'onde (Chantier Apparence, palier Pro, 05/09) sur les 3 pages
// publiques : Free/Starter imposent "bars" quel que soit data.waveformStyle, Pro applique le réglage
// choisi. Réglage GLOBAL au compositeur (data.waveformStyle, pas un champ par AdReel/pack/collection) --
// contrairement à test_watermark_gating.js, le tier testé ici varie par item mais data.waveformStyle est
// unique par appel de fetch (comme en production : une seule ligne `settings` par compositeur). Même
// harnais que test_watermark_gating.js (sources réelles inlinées dans JSDOM, fetch stubbé).
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

async function runIndexInit(adreelId, adReels, waveformStyle) {
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
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, adReels, customFonts: [], waveformStyle }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}
async function runPackInit(packId, packs, waveformStyle) {
  const packSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'pack.html'), 'utf-8'), 'pack.html').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <button id="shareBtn"></button>
  <div class="page"><div id="content"></div><label><input type="checkbox" id="nightModeToggle"></label><label><input type="checkbox" id="contrastToggle"></label></div>
  <script>${i18nSrc}</script><script>${playerSrc}</script><script>${packSrc}</script>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/pack.html?id=' + encodeURIComponent(packId),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, packs, collections: [], adReels: [], customFonts: [], waveformStyle }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}
async function runCollectionInit(collId, collections, waveformStyle) {
  const collSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'collection.html'), 'utf-8'), 'collection.html').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <button id="shareBtn"></button>
  <div class="page"><div id="content"></div><label><input type="checkbox" id="nightModeToggle"></label><label><input type="checkbox" id="contrastToggle"></label></div>
  <script>${i18nSrc}</script><script>${playerSrc}</script><script>${collSrc}</script>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/collection.html?id=' + encodeURIComponent(collId),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, collections, packs: [], adReels: [], customFonts: [], waveformStyle }) }); }
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await dom.window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom.window;
}

(async () => {
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // ---- AdReel : Free/Starter imposent "bars" même si data.waveformStyle demande "mirror" ----
  for (const tier of ['free', 'starter']) {
    const win = await runIndexInit('a-' + tier, [{
      id: 'a-' + tier, label: 'x', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'default' }, effectivePlan: tier }
    }], 'mirror');
    check(`AdReel ${tier} : style forcé sur "bars" malgré data.waveformStyle="mirror"`, win.LayerPlayerCore.currentWaveformStyle() === 'bars');
  }
  {
    const win = await runIndexInit('a-pro', [{
      id: 'a-pro', label: 'x', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'default' }, effectivePlan: 'pro' }
    }], 'mirror');
    check('AdReel pro : style "mirror" appliqué', win.LayerPlayerCore.currentWaveformStyle() === 'mirror');
  }
  {
    // AdReel publié avant ce chantier (data.waveformStyle absent) : repli "bars", jamais de crash.
    const win = await runIndexInit('a-pro-nowave', [{
      id: 'a-pro-nowave', label: 'x', lang: 'fr', blocks: [], testimonials: [], trackIds: [], trackOverrides: {},
      profile: { title: 'x', theme: { presetId: 'default' }, effectivePlan: 'pro' }
    }], undefined);
    check('AdReel pro sans data.waveformStyle : repli sur "bars"', win.LayerPlayerCore.currentWaveformStyle() === 'bars');
  }

  // ---- Pack : même logique ----
  for (const tier of ['free', 'starter']) {
    const win = await runPackInit('p-' + tier, [{ id: 'p-' + tier, title: 'x', presentationFr: 't', presentationEn: '', presetId: 'default', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: tier, trackIds: [], sfxIds: [] }], 'layers');
    check(`Pack ${tier} : style forcé sur "bars" malgré data.waveformStyle="layers"`, win.LayerPlayerCore.currentWaveformStyle() === 'bars');
  }
  {
    const win = await runPackInit('p-pro', [{ id: 'p-pro', title: 'x', presentationFr: 't', presentationEn: '', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: 'pro', trackIds: [], sfxIds: [] }], 'layers');
    check('Pack pro : style "layers" appliqué', win.LayerPlayerCore.currentWaveformStyle() === 'layers');
  }

  // ---- Collection : même logique ----
  for (const tier of ['free', 'starter']) {
    const win = await runCollectionInit('c-' + tier, [{ id: 'c-' + tier, title: 'x', presentationFr: 't', presentationEn: '', presetId: 'default', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: tier, packIds: [] }], 'dots');
    check(`Collection ${tier} : style forcé sur "bars" malgré data.waveformStyle="dots"`, win.LayerPlayerCore.currentWaveformStyle() === 'bars');
  }
  {
    const win = await runCollectionInit('c-pro', [{ id: 'c-pro', title: 'x', presentationFr: 't', presentationEn: '', bgColor: '#fff', textColor: '#000', font: 'default', effectivePlan: 'pro', packIds: [] }], 'dots');
    check('Collection pro : style "dots" appliqué', win.LayerPlayerCore.currentWaveformStyle() === 'dots');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
