// Vérifie le réglage d'apparence par élément (Chantier Apparence, palier Pro, réglage par élément, 05/09) :
// cascade élément -> bloc -> AdReel dans les deux sens, gating Pro strict (Free/Starter n'appliquent
// jamais, même si des données existent en base suite à une rétrogradation), valeurs par défaut cohérentes
// avant toute personnalisation, et couleurs "jouée"/"à jouer" effectivement reçues par le moteur de la
// forme d'onde/barre de progression (player.js). Même harnais que test_watermark_gating.js/
// test_waveform_style_gating.js pour la partie page publique (sources réelles inlinées dans JSDOM, fetch
// stubbé) ; le canevas 2D n'étant pas disponible sous JSDOM (voir test_embr_vertical_waveform.js), la
// forme d'onde est vérifiée via la fonction pure resolveWaveformColors() plutôt qu'en lisant un canvas
// réel -- la barre de progression, elle, est un simple <div> coloré directement en style inline et donc
// pleinement vérifiable en DOM.
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
const indexSrc = extractInlineScript(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8'), 'index.html').replace(/<\/script/gi, '<\\/script');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

(async () => {
  const headerBlock = {
    id: 'b1', type: 'header',
    elementAppearance: { title: { color: '#ff0000', font: 'default' } }
  };
  const tracksBlock = {
    id: 'b2', type: 'tracks',
    elementAppearance: { progressBar: { playedColor: '#111111', unplayedColor: '#222222' } }
  };
  const library = [{ id: 't1', title: 'T', description: '', mode: 'vertical', layers: [{ id: 'l1', file: 'a.wav' }] }];

  async function runWithLibrary(adreelId, tier, blocks) {
    const html = `<!DOCTYPE html><html><body>
    <div id="lightboxOverlay"><button class="lightbox-close" type="button"></button><button class="lightbox-prev" type="button"></button><img id="lightboxImg" src="" alt=""><button class="lightbox-next" type="button"></button></div>
    <button id="shareBtn"></button>
    <div class="page"><div id="blocksContainer"></div><div class="contact" id="contact"></div><div class="layerpitch-credit" id="layerpitchCredit"></div>
    <label><input type="checkbox" id="nightModeToggle"></label><label><input type="checkbox" id="contrastToggle"></label></div>
    <script>${i18nSrc}</script><script>${playerSrc}</script><script>${indexSrc}</script>
    </body></html>`;
    const adReels = [{
      id: adreelId, label: 'x', lang: 'fr', blocks, testimonials: [], trackIds: ['t1'], trackOverrides: {},
      profile: { title: 'Mon titre', subtitle: 'Mon sous-titre', theme: { presetId: 'default' }, effectivePlan: tier }
    }];
    const dom = new JSDOM(html, {
      url: 'http://localhost/index.html?adreel=' + encodeURIComponent(adreelId),
      runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(win) { fakeAudioContextHooks(win); win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ publishedAt: 1, adReels, library, customFonts: [] }) }); }
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    await dom.window.init();
    await new Promise(resolve => setTimeout(resolve, 60));
    return dom.window;
  }

  // ---- 1. Palier Pro : élément personnalisé (titre) appliqué, élément non personnalisé (sous-titre) hérite ----
  {
    const win = await runWithLibrary('a-pro', 'pro', [headerBlock, tracksBlock]);
    const title = win.document.querySelector('.header-title');
    const subtitle = win.document.querySelector('.header-subtitle');
    check('Pro : titre personnalisé reçoit la couleur réglée', !!title && title.style.color !== '' && title.style.color !== undefined);
    check('Pro : sous-titre non personnalisé n\'a AUCUNE couleur inline (hérite du thème)', !!subtitle && subtitle.style.color === '');
    const progressTrack = win.document.querySelector('[data-role="progressTrack"]');
    const progressFill = win.document.querySelector('[data-role="progressFill"]');
    check('Pro : barre de progression "à jouer" reçoit la couleur réglée', !!progressTrack && progressTrack.style.background !== '');
    check('Pro : barre de progression "jouée" reçoit la couleur réglée', !!progressFill && progressFill.style.background !== '');
  }

  // ---- 2. Palier Starter : mêmes données en base (rétrogradation simulée), jamais appliquées ----
  {
    const win = await runWithLibrary('a-starter', 'starter', [headerBlock, tracksBlock]);
    const title = win.document.querySelector('.header-title');
    const progressTrack = win.document.querySelector('[data-role="progressTrack"]');
    check('Starter : titre reste sans couleur inline malgré elementAppearance en base', !!title && title.style.color === '');
    check('Starter : barre de progression reste sans couleur inline malgré elementAppearance en base', !!progressTrack && progressTrack.style.background === '');
  }

  // ---- 3. Palier Free : idem, jamais appliqué (section bloc entière déjà masquée) ----
  {
    const win = await runWithLibrary('a-free', 'free', [headerBlock, tracksBlock]);
    const title = win.document.querySelector('.header-title');
    check('Free : titre reste sans couleur inline malgré elementAppearance en base', !!title && title.style.color === '');
  }

  // ---- 4. Pas de réglage du tout : comportement inchangé, aucune couleur inline nulle part ----
  {
    const plainHeader = { id: 'b1', type: 'header' };
    const plainTracks = { id: 'b2', type: 'tracks' };
    const win = await runWithLibrary('a-plain', 'pro', [plainHeader, plainTracks]);
    const title = win.document.querySelector('.header-title');
    const progressTrack = win.document.querySelector('[data-role="progressTrack"]');
    check('Sans réglage : titre sans couleur inline (hérite normalement)', !!title && title.style.color === '');
    check('Sans réglage : barre de progression sans couleur inline (hérite normalement)', !!progressTrack && progressTrack.style.background === '');
  }

  // ---- 5. resolveWaveformColors (pure) : reprend la même logique de repli que la barre de progression ----
  {
    const sandboxWin = (await runWithLibrary('a-pure', 'pro', [])); // récupère juste un LayerPlayerCore chargé
    const Core = sandboxWin.LayerPlayerCore;
    const custom = Core.resolveWaveformColors({ waveform: { playedColor: '#abcabc', unplayedColor: '#defdef' } });
    check('resolveWaveformColors : couleur "jouée" personnalisée reprise telle quelle', custom.fg === '#abcabc');
    check('resolveWaveformColors : couleur "à jouer" personnalisée reprise telle quelle', custom.bg === '#defdef');
    const fallback = Core.resolveWaveformColors(null);
    check('resolveWaveformColors : repli sur les couleurs générales si aucun réglage', typeof fallback.bg === 'string' && typeof fallback.fg === 'string' && fallback.bg !== '#defdef');
    const partial = Core.resolveWaveformColors({ waveform: { playedColor: '#123123' } });
    check('resolveWaveformColors : une seule couleur réglée -> l\'autre reste au repli général', partial.fg === '#123123' && partial.bg === fallback.bg);
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
