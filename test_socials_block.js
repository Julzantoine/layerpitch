// Bloc « Réseaux sociaux » des AdReels (28/09) : icônes détectées d'après le lien, liens dangereux refusés, et rendu
// sur la page publique (seuls les réseaux cochés dans le bloc, dans l'ordre de la rubrique, aucun bloc si rien à
// afficher). Même harnais JSDOM que test_theme_presets.js (vrai code de index.html).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function extractInlineScript(html) {
  // Exclut les chargeurs Umami ET Microsoft Clarity (blocs inline dynamiques, voir index.html/pack.html/collection.html/bienvenue.html/layerpitch-backstage.html, 16 septembre) qui ne sont pas le
  // code applicatif visé par ce test.
  const matches = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim() && !s.includes('cloud.umami.is') && !s.includes('clarity.ms'));
  if (matches.length !== 1) throw new Error('index.html : ' + matches.length + ' bloc(s) <script> inline trouvés (hors chargeur Umami), 1 attendu -- ajuster ce test.');
  // public-page.js (24/09) : briques communes aux pages publiques, chargées par le navigateur juste avant ce script.
  return fs.readFileSync(path.join(__dirname, 'public-page.js'), 'utf-8') + '\n' + matches[0];
}

async function runIndexInit(adreelId, adReels, customFonts, socials) {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const iconsSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-social-icons.js'), 'utf-8');
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
  <script>${iconsSrc}</script>
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
  // Depuis le 7 septembre, loadSiteData() charge Postgres via de vraies balises <script src>
  // (loadPostgresReadScripts()) que JSDOM ne charge jamais -- sans ce court-circuit, window.init()
  // reste éternellement en attente.
  window.loadPostgresReadScripts = () => Promise.resolve();
  window.LayerPitchSiteData = { loadSiteDataFromPostgres: () => Promise.resolve({ publishedAt: 1, adReels, customFonts: customFonts || [], socials: socials || [] }) };
  await new Promise(resolve => setTimeout(resolve, 30));
  await window.init();
  await new Promise(resolve => setTimeout(resolve, 30));
  return window;
}

(async () => {
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  const Icons = require('./layerpitch-social-icons.js');
  check('détection : instagram.com -> instagram', Icons.detect('https://www.instagram.com/moi', 'website') === 'instagram');
  check('détection : youtu.be -> youtube', Icons.detect('youtu.be/abc', 'twitter') === 'youtube');
  check('détection : x.com -> twitter', Icons.detect('https://x.com/moi') === 'twitter');
  check('détection : sous-domaine bandcamp -> bandcamp', Icons.detect('https://moi.bandcamp.com') === 'bandcamp');
  check('détection : site inconnu, réseau choisi « website » -> website', Icons.detect('https://moi.fr', 'website') === 'website');
  check('détection : site inconnu, réseau inconnu -> lien générique', Icons.detect('https://moi.fr', 'autre') === 'link');
  check('détection : faux domaine (instagram.com.pirate.io) pas reconnu comme Instagram', Icons.detect('https://instagram.com.pirate.io', 'website') === 'website');
  check('lien sans https:// complété', Icons.safeUrl('soundcloud.com/moi') === 'https://soundcloud.com/moi');
  check('lien javascript: refusé', Icons.safeUrl('javascript:alert(1)') === '');
  check('lien data: refusé', Icons.safeUrl('data:text/html,x') === '');
  check('lien vide refusé', Icons.safeUrl('   ') === '');
  check('chaque icône est un <svg> sans script', Icons.keys.every(k => Icons.svg(k).startsWith('<svg') && !/script|on\w+=/i.test(Icons.svg(k))));

  const socials = [
    { id: 's1', platform: 'instagram', url: 'https://instagram.com/moi' },
    { id: 's2', platform: 'website', url: 'moi.bandcamp.com' },
    { id: 's3', platform: 'youtube', url: 'javascript:alert(1)' },
    { id: 's4', platform: 'tiktok', url: 'https://tiktok.com/@moi' },
  ];
  const adReel = blocks => [{ id: 'a1', label: 'A', lang: 'fr', blocks, testimonials: [], trackIds: [], trackOverrides: {},
    profile: { title: 'Compo', theme: {}, effectivePlan: 'pro' } }];

  {
    const win = await runIndexInit('a1', adReel([{ id: 'b1', type: 'socials', socialIds: ['s4', 's1', 's3', 's2'], elementAppearance: { icons: { color: '#ff0000' } } }]), [], socials);
    const links = [...win.document.querySelectorAll('.social-links a')];
    check('page publique : 3 liens affichés (le lien javascript: est écarté)', links.length === 3);
    check('page publique : ordre de la rubrique (Instagram, Bandcamp, TikTok)', links.map(a => a.getAttribute('aria-label')).join(',') === 'Instagram,Bandcamp,TikTok');
    check('page publique : lien complété en https', links[1] && links[1].getAttribute('href') === 'https://moi.bandcamp.com/');
    check('page publique : ouverture dans un nouvel onglet, sans transmettre la page d\'origine', links.every(a => a.target === '_blank' && /noopener/.test(a.rel)));
    check('page publique : couleur des icônes réglée par bloc (palier Boss)', links[0] && links[0].style.color === 'rgb(255, 0, 0)');
  }
  {
    const win = await runIndexInit('a1', adReel([{ id: 'b1', type: 'socials', socialIds: ['s1'] }]), [], []);
    check('aucun lien dans la rubrique : pas de bloc affiché', !win.document.querySelector('.social-links'));
  }
  {
    const win = await runIndexInit('a1', adReel([{ id: 'b1', type: 'socials', socialIds: [] }]), [], socials);
    check('rien de coché : pas de bloc affiché', !win.document.querySelector('.social-links'));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
