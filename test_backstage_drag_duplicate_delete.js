// Poignées, Alt + glisser pour dupliquer, touche Supprimer, effacement des fichiers à la publication seulement
// (25/09, demandes de Jules-Antoine).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const backstageSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8')
    .replace(/<script[^>]*src="https:\/\/unpkg\.com[^"]*"[^>]*><\/script>\s*/g, '');
  function inlineExactLine(html, filename, tagline) {
    const content = fs.readFileSync(path.join(__dirname, filename), 'utf-8').replace(/<\/script/gi, '<\\/script');
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
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  const ev = code => window.eval(code);

  const q = sel => doc.querySelector(sel);
  doc.getElementById('authGateOverlay').remove(); // retiré à la connexion dans le vrai Backstage (pas de session ici)
  function setValue(el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); }
  const r2Deleted = [];
  window.r2DeleteFileLogged = key => { r2Deleted.push(key); };
  window.LayerPitchTracks = window.LayerPitchPacks = window.LayerPitchSfx = window.LayerPitchCollections = window.LayerPitchAdReels = {};
  let confirmAnswer = true, confirmCalls = 0;
  window.confirm = () => { confirmCalls++; return confirmAnswer; };

  // Glisser interne simulé : poignée pressée, dragstart, dragover puis drop sur la cible (jsdom : rectangles nuls,
  // donc toujours "après la cible").
  function dragItem(fromEl, toEl, alt) {
    const handle = fromEl.querySelector('.block-drag-handle');
    handle.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    const dt = { types: ['text/plain'], setData() {}, effectAllowed: '', dropEffect: '' };
    const mk = type => { const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, altKey: !!alt, clientY: 1 }); Object.defineProperty(e, 'dataTransfer', { value: dt }); return e; };
    fromEl.dispatchEvent(mk('dragstart'));
    toEl.dispatchEvent(mk('dragover'));
    const container = fromEl.parentElement;
    const reordering = container.classList.contains('is-reordering');
    toEl.dispatchEvent(mk('drop'));
    fromEl.dispatchEvent(mk('dragend'));
    return reordering;
  }
  const slotItem = si => q(`#libraryContainer .seq-master-item[data-action="select-seq-slot"][data-si="${si}"]`);
  const labels = () => ev('library[0].segmentSlots.map(s => s.label).join("|")');

  ev('currentUserIsAdmin = true'); // Alt + glisser et touche Supprimer : réservés à l'admin (voir fin du test)
  click(q('.nav-item[data-tab="library"]')); // la touche Supprimer n'agit que dans l'onglet affiché
  // ---- Morceau séquentiel à 3 slots ----
  click(doc.getElementById('btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="0"]'), 'sequential');
  ev(`library[0].id = 'trk'; library[0].segmentSlots = ['A', 'B', 'C'].map(l => ({ id: 'slot' + l, label: l, avoidImmediateRepeat: true, alternatives: [{ id: 'alt' + l, label: l + '1', bars: 8, remoteFile: l.toLowerCase() + '.ogg', pendingFile: null }] })); renderLibrary();`);
  click(slotItem(0));
  check('poignée sur chaque slot', [0, 1, 2].every(si => slotItem(si) && slotItem(si).querySelector('.block-drag-handle')));
  check('plus de flèches ↑/↓', !q('[data-action="move-slot-up"], [data-action="move-slot-down"]'));

  // Réordonner
  const sawGaps = dragItem(slotItem(0), slotItem(1), false);
  check('espaces entre slots rendus visibles pendant le glisser', sawGaps);
  check('A glissé après B : B, A, C', labels() === 'B|A|C');
  check('le slot déplacé reste sélectionné', slotItem(1).classList.contains('active'));

  // Alt + glisser = copie
  dragItem(slotItem(2), slotItem(2), true);
  check('Alt + glisser : copie de C insérée après C', labels() === 'B|A|C|C (copie)');
  const copy = ev('library[0].segmentSlots[3]'), orig = ev('library[0].segmentSlots[2]');
  check('la copie a ses propres id', copy.id !== orig.id && copy.alternatives[0].id !== orig.alternatives[0].id);
  check('la copie partage le fichier en ligne de l\'original', copy.alternatives[0].remoteFile === 'c.ogg');
  check('intro/outro ne sont pas déplaçables', !q('.seq-master-item[data-seq-key="seqIntro"] .block-drag-handle'));

  // ---- Touche Supprimer : sélection de la copie puis Supp ----
  click(slotItem(3));
  const pressKey = (key, target) => (target || doc.body).dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  slotItem(3).dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  confirmAnswer = false; confirmCalls = 0;
  pressKey('Delete');
  check('Supp : confirmation demandée, "Annuler" ne supprime rien', confirmCalls === 1 && labels() === 'B|A|C|C (copie)');
  confirmAnswer = true;
  slotItem(3).dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  pressKey('Backspace');
  check('⌫ + confirmation : la copie est supprimée', labels() === 'B|A|C');
  check('fichiers pas effacés au clic', r2Deleted.length === 0);
  check('fichier de la copie mis de côté pour la publication', ev('pendingOrphanR2Keys.has("audio/trk/c.ogg")'));

  // Saisie dans un champ : la touche ne supprime rien
  click(slotItem(0));
  slotItem(0).dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  const nameInput = q('input[data-slot-field="label"][data-si="0"]');
  confirmCalls = 0;
  pressKey('Backspace', nameInput);
  check('dans un champ de saisie : aucune suppression', confirmCalls === 0 && labels() === 'B|A|C');

  // ---- Publication : le fichier partagé par l'original n'est pas effacé, un fichier vraiment orphelin l'est ----
  ev('rememberPublishedCatalog()');
  slotItem(0).dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  pressKey('Delete');
  check('slot B supprimé au clavier', labels() === 'A|C');
  await ev('deleteRemovedCatalogItems()');
  check('à la publication : b.ogg (plus utilisé) effacé, c.ogg (encore utilisé par C) conservé', r2Deleted.join() === 'audio/trk/b.ogg');
  check('plus rien en attente', ev('pendingOrphanR2Keys.size') === 0);

  // ---- Rechargement sans publier : rien n'est effacé ----
  ev('queueR2Delete("audio/trk/x.ogg"); pendingR2Deletes.clear(); pendingOrphanR2Keys.clear();');
  check('abandon (rechargement) : la file est vidée sans effacer', r2Deleted.length === 1);

  // ---- Sections du vertical-random : Alt + glisser ----
  click(doc.getElementById('btnAddLibraryTrack'));
  setValue(q('#libraryContainer select[data-field="mode"][data-ti="1"]'), 'vertical-random');
  ev(`library[1].sections = [{ id: 'secA', label: 'Calme', pools: [] }, { id: 'secB', label: 'Combat', pools: [] }]; renderLibrary();`);
  const secItem = i => q(`#libraryContainer .seq-master-item[data-ti="1"][data-si="${i}"]`);
  check('sections : poignées présentes', !!(secItem(0) && secItem(0).querySelector('.block-drag-handle')));
  dragItem(secItem(0), secItem(1), true);
  check('sections : Alt + glisser copie "Calme" après "Combat"', ev('library[1].sections.map(s => s.label).join("|")') === 'Calme|Combat|Calme (copie)');

  // ---- Blocs de contenu d'un AdReel : Alt + glisser copie un bloc texte, jamais un bloc unique (Header) ----
  click(q('.nav-item[data-tab="content"]'));
  ev(`blocks.length = 0; blocks.push({ id: 'bh', type: 'header' }, { id: 'bt', type: 'text', title: 'Intro', body: 'Salut' }); rebuildAllCards(); layoutBlocks();`);
  const card = id => q(`#blocksEditorContainer .block-editor-card[data-id="${id}"]`);
  const blockDrag = (fromId, toId, alt) => {
    card(fromId).querySelector('.block-drag-handle').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    const dt = { types: ['text/plain'], setData() {}, effectAllowed: '', dropEffect: '' };
    const mk = type => { const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, altKey: !!alt, clientY: 1 }); Object.defineProperty(e, 'dataTransfer', { value: dt }); return e; };
    const from = card(fromId), to = card(toId);
    from.dispatchEvent(mk('dragstart')); to.dispatchEvent(mk('dragover')); to.dispatchEvent(mk('drop')); from.dispatchEvent(mk('dragend'));
  };
  blockDrag('bt', 'bt', true);
  const types = () => ev('blocks.map(b => b.type).join()');
  check('bloc texte copié (Alt + glisser)', types() === 'header,text,text' && ev('blocks[2].body') === 'Salut' && ev('blocks[2].id') !== 'bt');
  check('la copie a sa carte dans l\'éditeur', doc.querySelectorAll('#blocksEditorContainer .block-editor-card').length === 3);
  blockDrag('bh', 'bt', true);
  check('Header : pas de copie (bloc unique), simple déplacement', types() === 'text,header,text');
  // Touche Supprimer sur un bloc
  const copyId = ev('blocks[2].id');
  card(copyId).dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  check('bloc sélectionné visible', card(copyId).classList.contains('kb-selected'));
  doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  check('Supp sur un bloc : supprimé après confirmation', types() === 'text,header');

  // ---- Hors admin : Alt + glisser déplace, la touche Supprimer ne fait rien ----
  ev('currentUserIsAdmin = false'); click(q('.nav-item[data-tab="library"]')); ev('manageLibrarySelectedId = library[0].id; renderLibrary()');
  click(slotItem(0));
  dragItem(slotItem(0), slotItem(1), true);
  check('non-admin : Alt + glisser déplace sans copier', labels() === 'C|A');
  confirmCalls = 0;
  slotItem(1).dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  check('non-admin : la touche Supprimer ne fait rien', confirmCalls === 0 && labels() === 'C|A');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
