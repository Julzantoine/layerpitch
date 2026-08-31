// Demande du 15/08 : "toutes les flèches repliées par défaut quand on ouvre le backstage" + "il faut une
// flèche pour sfx" (le sélecteur de Sfx attachés à un morceau n'avait aucun repli). Deux volets testés :
//
// 1) Bootstrap de chargement (loadData) : extraction littérale du bloc qui peuple les Sets de repli avec
//    TOUS les ids existants — même technique que test_backstage_custom_cut_fade_roundtrip.js pour player.js,
//    pas besoin de mocker tout le flux réseau GitHub pour vérifier cette logique pure.
// 2) UI en direct : le nouveau bouton de repli sur "Sfx (déclenchables à la main pendant la lecture)"
//    d'un morceau, câblage réel dans une page jsdom.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

const src = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');

// ---- 1) Bootstrap : extraction littérale du bloc collapsedSlotIds/collapsedSfxIds (chargement complet) ----
{
  const startMarker = 'collapsedSlotIds.clear();\n    library.forEach(t => (t.segmentSlots || []).forEach(sl => collapsedSlotIds.add(sl.id)));\n    collapsedSfxIds.clear();\n    sfxLibrary.forEach(s => collapsedSfxIds.add(s.id));';
  const idx = src.indexOf(startMarker);
  if (idx === -1) throw new Error('marker not found — le bloc a peut-être été reformulé, ajuster ce test');
  const fnSrc = 'function(library, sfxLibrary, collapsedSlotIds, collapsedSfxIds) { ' + startMarker + ' }';
  const fn = eval('(' + fnSrc + ')');

  const library = [
    { id: 't1', segmentSlots: [{ id: 's1' }, { id: 's2' }] },
    { id: 't2', segmentSlots: [{ id: 's3' }] },
    { id: 't3' } // morceau non séquentiel : pas de segmentSlots du tout, ne doit rien casser
  ];
  const sfxLibrary = [{ id: 'sfxA' }, { id: 'sfxB' }];
  const collapsedSlotIds = new Set(), collapsedSfxIds = new Set();
  fn(library, sfxLibrary, collapsedSlotIds, collapsedSfxIds);

  check('tous les emplacements de tous les morceaux sont repliés par défaut au chargement',
    collapsedSlotIds.has('s1') && collapsedSlotIds.has('s2') && collapsedSlotIds.has('s3') && collapsedSlotIds.size === 3);
  check('tous les Sfx de la bibliothèque sont repliés par défaut au chargement',
    collapsedSfxIds.has('sfxA') && collapsedSfxIds.has('sfxB') && collapsedSfxIds.size === 2);
}

// ---- 2) UI en direct : repli des Sfx attachés à un morceau ----
(async () => {
  const backstageSrc = src.replace(/<script[^>]*src="https:\/\/unpkg\.com[^"]*"[^>]*><\/script>\s*/g, '');
  function inlineExactLine(html, filename, tagline) {
    const content = fs.readFileSync(path.join(__dirname, filename), 'utf-8').replace(/<\/script/gi, '<\\/script');
    // Tolère le cache-busting "?v=..." ajouté aux balises <script> à la publication (13 août) —
    // sans ça, la comparaison stricte échoue silencieusement et le script n'est jamais inliné.
    return html.split('\n').map(line => {
      const normalized = line.trim().replace(/\.js(\?[^"]*)?"/, '.js"');
      return normalized === tagline ? `<script>${content}</script>` : line;
    }).join('\n');
  }
  let html = inlineExactLine(backstageSrc, 'layerpitch-i18n.js', '<script src="layerpitch-i18n.js"></script>');
  html = inlineExactLine(html, 'layerpitch-help.js', '<script src="layerpitch-help.js"></script>');
  html = inlineExactLine(html, 'player.js', '<script src="player.js"></script>');

  const dom = new JSDOM(html, {
    url: 'http://localhost/test_backstage.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function FakeAudioContext() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () { return { gain: { setValueAtTime() {}, value: 1 }, connect() {}, disconnect() {} }; };
      FakeAudioContext.prototype.createBufferSource = function () { return { connect() {}, start() {}, stop() {}, buffer: null }; };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.reject(new Error('no audio in test env')); };
      FakeAudioContext.prototype.close = function () {};
      win.AudioContext = FakeAudioContext;
    }
  });
  const { window } = dom;
  await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 50)));
  const doc = window.document;
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  function setValue(el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); }
  const q = sel => doc.querySelector(sel);

  // Un Sfx doit exister dans la bibliothèque pour pouvoir l'attacher à un morceau.
  click(q('#btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');

  const sfxToggle = q('[data-role="trackSfxToggle"]');
  const sfxBody = q('[data-role="trackSfxBody"]');
  check('le bouton de repli des Sfx attachés est bien présent', !!sfxToggle);
  check('le corps des Sfx attachés est REPLIÉ par défaut (nouveau morceau)', !!sfxBody && sfxBody.classList.contains('collapsed'));

  if (sfxToggle && sfxBody) {
    click(sfxToggle);
    check('un clic déplie le corps', !sfxBody.classList.contains('collapsed'));
    click(sfxToggle);
    check('un second clic replie à nouveau', sfxBody.classList.contains('collapsed'));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
