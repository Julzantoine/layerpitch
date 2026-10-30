// Layering additif à sections (30/10) : niveau propre à chaque section, sur le moteur du vertical-random.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8');

// Extrait une fonction de premier niveau du lecteur, sans window/ctx/DOM.
function extract(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('introuvable : ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (;; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const player = read('player.js');
const startLevel = new Function(['resolveVRSection', 'additiveSectionLevelCount', 'additiveSectionStartLevel'].map(n => extract(player, n)).join('\n') + '\nreturn additiveSectionStartLevel;')();

const pool = () => ({ alternatives: [{ file: 'a.mp3' }] });
const track = { sections: [
  { id: 'a', pools: [pool(), pool(), pool()], startLevel: 1 },
  { id: 'b', pools: [pool(), pool()] },
  { id: 'c', pools: [pool()], startLevel: 5 },
  { id: 'd', referencesSectionId: 'a', pools: [], startLevel: 2 },
] };
check('niveau de départ réglé', startLevel(track, 0) === 1);
check('sans réglage : première couche seule', startLevel(track, 1) === 0);
check('ramené aux couches qui existent', startLevel(track, 2) === 0);
check('un duplicata garde son propre niveau, sur les couches de sa source', startLevel(track, 3) === 2);

// Les textes et les copies champ par champ : un champ oublié ici disparaîtrait à la publication ou au rechargement.
['src/backstage/38-chargement.js', 'src/backstage/42-publication.js', 'src/backstage/16-bibliotheque-de-morceaux.js'].forEach(f =>
  check('startLevel recopié dans ' + f, /startLevel: sec\.startLevel \|\| 0/.test(read(f))));

const backstage = read('layerpitch-backstage.html');
check('option du mode réservée au feu vert', /flagOpen\('additive_sections'\)/.test(backstage));
check('feu vert déclaré en base', read('supabase/migrations/20261030010000_additive_sections_flag.sql').includes("'additive_sections'"));
check('mode jouable par le lecteur', /PLAYABLE_MODES = \[[^\]]*ADDITIVE_SECTIONS_MODE/.test(player));

// Boutons et volumes dans le vrai lecteur, avec un faux moteur audio qui retient le volume visé par chaque voix.
(async () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="host"></div><script>${read('layerpitch-i18n.js')}</script><script>${player.replace(/<\/script/gi, '<\\/script')}</script></body></html>`, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () {
        const gain = { value: 1, target: 1, setValueAtTime(v) { gain.target = v; }, linearRampToValueAtTime(v) { gain.target = v; }, cancelScheduledValues() {} };
        return { gain, connect() {}, disconnect() {} };
      };
      win.__started = [];
      FakeAudioContext.prototype.createBufferSource = function () {
        const node = { buffer: null, onended: null, _g: null, connect(g) { node._g = g; }, stop() { node._stopped = true; }, start() { win.__started.push(node); } };
        return node;
      };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 2 }); };
      win.AudioContext = FakeAudioContext;
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
      win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
    }
  });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 50));
  const Core = window.LayerPlayerCore;
  check('mode exporté par le lecteur', Core.ADDITIVE_SECTIONS_MODE === 'vertical-additive-sequential');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitUntil = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(20); } return fn(); };
  const fakeFile = name => ({ name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  const layer = (label, n) => ({ id: 'p' + n, label, avoidImmediateRepeat: false, alternatives: [{ label, localFile: fakeFile(label + '.wav') }] });
  const track = {
    id: 't1', title: 'Add', mode: 'vertical-additive-sequential', description: '', duration: 0, base: 'https://example.invalid/', publishedAt: Date.now(), sfxIds: [], randomizeSections: false,
    sections: [
      { id: 'a', label: 'A', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: null, startLevel: 1, pools: [layer('Basse', 1), layer('Batterie', 2), layer('Cuivres', 3)] },
      { id: 'b', label: 'B', bpm: 150, beatsPerBar: 1, startTrackBeat: 0, loopInBeat: 0, loopOutBeat: 1, maxLoops: null, pools: [layer('Piano', 4), layer('Cordes', 5)] },
    ],
  };
  const row = Core.buildTrackRow(track, null, false);
  window.document.getElementById('host').appendChild(row);
  Core.initTrackPlayer(track, row);
  await sleep(300);
  const picker = row.querySelector('[data-role="sectionLevelPicker"]');
  const chips = () => [...picker.querySelectorAll('.intensity-chip')];
  const activeChip = () => chips().findIndex(c => c.classList.contains('active'));
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const current = row.querySelector('[data-role="sectionCurrent"]');
  // Volumes visés des dernières voix démarrées (n = nombre de couches de la section).
  const lastGains = n => window.__started.filter(s => !s._stopped).slice(-n).map(s => s._g.gain.target);

  check('avant lecture : 3 boutons de la première section', chips().length === 3);
  check('avant lecture : niveau de départ réglé', activeChip() === 1);

  click(row.querySelector('[data-role="playBtn"]'));
  check('section A entendue', await waitUntil(() => current.textContent === 'A', 2000));
  check('niveau 2 : deux couches sur trois', lastGains(3).join() === '1,1,0');

  click(chips()[2]);
  check('niveau 3 : toutes les couches', lastGains(3).join() === '1,1,1');

  // Le solo/muet recalcule les volumes : il ne doit pas rouvrir une couche coupée par le niveau.
  click(chips()[0]);
  check('niveau 1 : première couche seule', lastGains(3).join() === '1,0,0');
  click(row.querySelector('[data-voice-action="mute"][data-voice-key="pool-0"]'));
  click(row.querySelector('[data-voice-action="mute"][data-voice-key="pool-0"]'));
  check('muet puis rétabli : les couches coupées restent coupées', lastGains(3).join() === '1,0,0');
  click(chips()[2]);

  click(row.querySelector('[data-role="goToNextSectionBtn"]'));
  check('passage à la section B', await waitUntil(() => current.textContent === 'B', 3000));
  check('section B : ses 2 boutons, à son propre niveau', chips().length === 2 && activeChip() === 0);
  check('section B : une couche sur deux', lastGains(2).join() === '1,0');

  click(row.querySelector('[data-role="goToNextSectionBtn"]'));
  check('retour à la section A', await waitUntil(() => current.textContent === 'A', 3000));
  check('section A : retrouve le dernier niveau choisi', chips().length === 3 && activeChip() === 2);
  check('section A : toutes ses couches', lastGains(3).join() === '1,1,1');

  if (failures) { console.log(failures + ' échec(s)'); process.exit(1); }
  console.log('Tous les tests sont passés.');
  process.exit(0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
