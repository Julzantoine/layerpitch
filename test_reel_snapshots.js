// Moteur d'affichage des AdReels (espace Projet, étape 5, 28/09) : le code qui applique le thème et dessine les blocs est
// sorti de index.html vers src/reel/ (fichier fabriqué reel.js), pour être partagé avec les vitrines de Projet. Ce test
// garantit que les AdReels restent IDENTIQUES : il affiche une série d'AdReels types (tous les blocs, les trois paliers,
// thèmes, séparateurs, image de fond, réglages par bloc et par élément) avec le VRAI code de la page, et compare le
// résultat (variables de thème, contenu des blocs, pied de page) à l'instantané enregistré AVANT le déplacement
// (test-fixtures/reel-snapshots.json). `node test_reel_snapshots.js --update` réenregistre l'instantané (seulement après
// un changement d'affichage VOULU).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const FIXTURE = path.join(__dirname, 'test-fixtures', 'reel-snapshots.json');

function pageScripts() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim() && !s.includes('cloud.umami.is') && !s.includes('clarity.ms'));
  if (inline.length !== 1) throw new Error('index.html : ' + inline.length + ' bloc(s) <script> inline, 1 attendu');
  // Scripts locaux chargés par la page, dans son ordre (hors SDK externes).
  const srcs = [...html.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  return srcs.map(s => fs.readFileSync(path.join(__dirname, s), 'utf-8')).concat([inline[0]]).map(s => s.replace(/<\/script/gi, '<\\/script'));
}

async function render(adReel, extra) {
  const scripts = pageScripts();
  const html = `<!DOCTYPE html><html><body>
  <div id="lightboxOverlay" class="lightbox-overlay"><button class="lightbox-close" type="button">x</button><button class="lightbox-prev" type="button">p</button><img id="lightboxImg" src="" alt=""><button class="lightbox-next" type="button">n</button></div>
  <button id="shareBtn"></button>
  <div class="page"><div id="blocksContainer"></div><div class="contact" id="contact"></div><div class="layerpitch-credit" id="layerpitchCredit"></div>
  <label><input type="checkbox" id="nightModeToggle"></label><label><input type="checkbox" id="contrastToggle"></label></div>
  ${scripts.map(s => `<script>${s}</script>`).join('\n')}
  </body></html>`;
  const data = Object.assign({ publishedAt: 1, adReels: [adReel], customFonts: [], library: [], packs: [], collections: [], sfxLibrary: [], socials: [] }, extra || {});
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html?adreel=' + encodeURIComponent(adReel.id), runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return 0; } });
      FakeAudioContext.prototype.resume = () => Promise.resolve();
      FakeAudioContext.prototype.createGain = () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
      FakeAudioContext.prototype.createBufferSource = () => ({ buffer: null, onended: null, connect() {}, stop() {}, start() {} });
      FakeAudioContext.prototype.decodeAudioData = () => Promise.resolve({ duration: 2 });
      win.AudioContext = FakeAudioContext;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = cb => setTimeout(cb, 16); win.cancelAnimationFrame = id => clearTimeout(id);
      win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(data), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      win.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000000';
      win.Math.random = () => 0.5;
      win.Date.now = () => 1790000000000;
    },
    virtualConsole: process.env.DEBUG_REEL ? new (require('jsdom').VirtualConsole)().forwardTo(console) : new (require('jsdom').VirtualConsole)(),
  });
  const { window } = dom;
  window.loadPostgresReadScripts = () => Promise.resolve();
  window.LayerPitchSiteData = { loadSiteDataFromPostgres: () => Promise.resolve(data) };
  await new Promise(r => setTimeout(r, 30));
  await window.init();
  await new Promise(r => setTimeout(r, 60));
  const d = window.document;
  const out = {
    rootStyle: d.documentElement.getAttribute('style') || '',
    head: [...d.head.querySelectorAll('link, style')].map(e => e.outerHTML).join('\n'),
    containerClass: d.getElementById('blocksContainer').className,
    blocks: d.getElementById('blocksContainer').innerHTML,
    contact: d.getElementById('contact').innerHTML,
    credit: d.getElementById('layerpitchCredit').outerHTML,
    title: d.title,
    bodyLayers: [...d.body.children].filter(e => e.style && e.style.position === 'fixed').map(e => e.outerHTML).join('\n'),
  };
  window.close();
  return out;
}

const track = { id: 't1', title: 'Thème forêt', mode: 'static', base: 'https://media.layerpitch.com/t1/', duration: 12, loopable: true, layers: [{ file: 'forest.ogg' }], tags: 'ambiance, calme', description: 'Calme' };
const blocksAll = [
  { id: 'h', type: 'header' }, { id: 'b', type: 'bio' }, { id: 'te', type: 'testimonials' }, { id: 'tr', type: 'tracks' },
  { id: 'x', type: 'text', title: 'Mon approche', content: 'Du **texte** et un [lien](https://exemple.fr).', align: 'center' },
  { id: 'p', type: 'photo', align: 'left', caption: 'Studio', images: [{ file: 'c/a.jpg' }, { file: 'c/b.jpg' }] },
  { id: 'v', type: 'video', videos: [{ title: 'Trailer', url: 'https://youtu.be/dQw4w9WgXcQ', comment: 'Mon travail', thumbnail: null }] },
  { id: 'pk', type: 'packs', presentation: 'Mes packs', packIds: ['pk1'] },
  { id: 'co', type: 'collections', presentation: '', collectionIds: ['col1'] },
  { id: 'sf', type: 'sfx', sfxIds: [] },
  { id: 'so', type: 'socials', socialIds: ['s1', 's2'] },
  { id: 'ct', type: 'contact' },
];
const profile = plan => ({ title: 'Jean Compo', subtitle: 'Musique de jeu', bio: 'Compositeur **adaptatif**.', contactEmail: 'jean@exemple.fr', contactUrl: 'https://jean.fr',
  logo: 'c/logo.png', photo: 'c/photo.jpg', effectivePlan: plan,
  theme: { bgColor: '#101820', titleColor: '#f2aa4c', contentColor: '#eeeeee', font: 'google:Fraunces', bgImage: 'c/bg.jpg', bgImageOpacity: 0.4, presetId: 'forest',
    sectionLabelColor: '#88ccff', separator: { visible: true, color: '#333333', thickness: 2 } } });
const extra = { library: [track], packs: [{ id: 'pk1', title: 'Pack forêt', illustration: 'c/pk.jpg', trackIds: ['t1'] }], collections: [{ id: 'col1', title: 'Collection', illustration: null, packIds: ['pk1'] }],
  socials: [{ id: 's1', platform: 'instagram', url: 'https://instagram.com/jean' }, { id: 's2', platform: 'website', url: 'jean.fr' }] };
const withAppearance = blocksAll.map(b => b.type === 'text' ? Object.assign({}, b, { appearance: { bgColor: '#223344', titleColor: '#ff0000', font: 'google:Manrope' },
  elementAppearance: { title: { color: '#00ff00' } } }) : b.type === 'socials' ? Object.assign({}, b, { elementAppearance: { icons: { color: '#ff00ff' } } }) : b);
const CASES = {
  free: { id: 'a', label: 'A', lang: 'fr', blocks: blocksAll, testimonials: [{ text: 'Super', author: 'Ana', role: 'Dir. audio' }], trackIds: ['t1'], trackOverrides: {}, profile: profile('free') },
  starter: { id: 'a', label: 'A', lang: 'fr', blocks: withAppearance, testimonials: [{ text: 'Super', author: 'Ana', role: 'Dir. audio' }], trackIds: ['t1'], trackOverrides: {}, profile: profile('starter') },
  pro: { id: 'a', label: 'A', lang: 'en', blocks: withAppearance, testimonials: [], trackIds: ['t1'], trackOverrides: { t1: { title: 'Forest (edit)' } }, profile: profile('pro') },
  ancien: { id: 'a', label: 'A', blocks: [{ id: 'x', type: 'text', content: 'Ancien AdReel' }], trackIds: [], profile: { title: 'Vieux', bgColor: '#ffffff', textColor: '#000000' } },
};

(async () => {
  const update = process.argv.includes('--update');
  const got = {};
  for (const [name, ar] of Object.entries(CASES)) got[name] = await render(ar, extra);
  if (update || !fs.existsSync(FIXTURE)) {
    fs.writeFileSync(FIXTURE, JSON.stringify(got, null, 1));
    console.log('Instantané enregistré : ' + Object.keys(got).join(', '));
    process.exit(0);
  }
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  let failures = 0;
  for (const name of Object.keys(CASES)) for (const k of Object.keys(want[name])) {
    const ok = got[name][k] === want[name][k];
    if (!ok) {
      failures++;
      const a = want[name][k], b = got[name][k]; let i = 0; while (i < a.length && a[i] === b[i]) i++;
      console.log(`FAIL - ${name}.${k} différent (à partir du caractère ${i}) :\n  avant : ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 120))}\n  après : ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 120))}`);
    } else console.log(`OK   - ${name}.${k} identique`);
  }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
