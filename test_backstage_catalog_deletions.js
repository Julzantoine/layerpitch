// Suppressions réellement envoyées à la base (25/09) : avant ce correctif, publishAll() ne faisait que des upsert_*,
// un morceau retiré dans le Backstage restait en base et revenait au chargement suivant (compte tuto : deux
// "My first adaptive track" qui réapparaissaient sans cesse). Vérifie :
// 1) seuls les éléments présents au chargement puis retirés sont supprimés, dans le bon type ;
// 2) les fichiers R2 d'un morceau retiré ne partent qu'après la suppression en base (plus au clic) ;
// 3) un refus "déjà acheté" n'arrête rien, garde les fichiers et remonte un message lisible ;
// 4) une panne arrête la publication et la suppression est retentée la fois suivante ;
// 5) aucun chargement réussi = aucune suppression ;
// 6) retirer un pack le retire aussi des collections et des blocs "packs".
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

  // Faux accès base : chaque suppression est enregistrée ; `responses` force une réponse par id.
  const calls = [];
  const responses = {};
  const fake = kind => async id => { calls.push(kind + ':' + id); return responses[id] || { ok: true, blocked: false, error: null }; };
  window.LayerPitchTracks = { deleteTrack: fake('tracks') };
  window.LayerPitchPacks = { deletePack: fake('packs') };
  window.LayerPitchSfx = { deleteSfx: fake('sfx') };
  window.LayerPitchCollections = { deleteCollection: fake('collections') };
  window.LayerPitchAdReels = { deleteAdReel: fake('adReels') };
  const r2Deleted = [];
  window.r2DeleteFileLogged = key => { r2Deleted.push(key); };

  // ---- 5) Aucun chargement réussi : rien n'est supprimé ----
  let res = await ev('deleteRemovedCatalogItems()');
  check('sans chargement réussi, aucune suppression', res.deleted === 0 && calls.length === 0);

  // ---- État "chargé depuis la base" : 2 morceaux (dont le fantôme), 2 packs, 1 Sfx, 1 collection ----
  click(doc.getElementById('btnAddLibraryTrack'));
  click(doc.getElementById('btnAddLibraryTrack'));
  ev(`library[0].id = 'good'; library[0].title = 'My first adaptive track (thanks for listening)';
      library[1].id = 'ghost'; library[1].title = 'My first adaptive track';
      library[1].layers = [{ label: 'L', remoteFile: 'layer0.ogg', pendingFile: null, gain: 1 }];
      packs = [{ id: 'p-sold', title: 'Pack vendu', trackIds: [] }, { id: 'p-free', title: 'Pack libre', trackIds: [] }];
      sfxLibrary = [];
      collections = [{ id: 'c1', title: 'Collection', packIds: ['p-sold', 'p-free'] }];
      adReels = [{ id: 'main', label: 'Main', blocks: [{ id: 'blk', type: 'packs', packIds: ['p-free'] }], trackIds: [] }];
      rememberPublishedCatalog(); manageLibrarySelectedId = 'ghost'; renderLibrary(); renderPacks();`);

  // ---- 2) Retirer le morceau fantôme via le vrai bouton : fichiers PAS effacés au clic ----
  const removeGhost = [...doc.querySelectorAll('[data-action="remove-track"]')]
    .find(b => ev('library')[parseInt(b.dataset.ti, 10)].id === 'ghost');
  check('bouton de suppression du morceau présent', !!removeGhost);
  window.confirm = () => true;
  click(removeGhost);
  check('morceau retiré du Backstage', ev('library.map(t => t.id).join()') === 'good');
  check('fichiers R2 non effacés au clic', r2Deleted.length === 0);
  check('fichiers R2 mis de côté pour la publication', ev(`(pendingR2Deletes.get('tracks:ghost') || []).join()`) === 'audio/ghost/layer0.ogg');

  // ---- 6) Retirer un pack le retire des collections et des blocs "packs" ----
  const removeFree = [...doc.querySelectorAll('[data-action="remove-pack"]')]
    .find(b => ev('packs')[parseInt(b.dataset.pi, 10)].id === 'p-free');
  check('bouton de suppression du pack présent', !!removeFree);
  click(removeFree);
  check('pack retiré de la collection', ev(`collections[0].packIds.join()`) === 'p-sold');
  check('pack retiré du bloc "packs" de l\'AdReel', ev(`adReels[0].blocks.find(b => b.id === 'blk').packIds.length`) === 0);

  // ---- 4) Panne sur le morceau : publication arrêtée, rien n'est oublié ----
  responses.ghost = { ok: false, blocked: false, error: 'réseau coupé' };
  let threw = null;
  try { await ev('deleteRemovedCatalogItems()'); } catch (e) { threw = e; }
  check('une panne arrête la publication', threw && /réseau coupé/.test(threw.message));
  check('fichiers du morceau conservés après la panne', r2Deleted.length === 0);

  // ---- 1) + 3) Nouvelle tentative : le morceau part, le pack vendu est refusé ----
  calls.length = 0;
  delete responses.ghost;
  ev(`packs = packs.filter(p => p.id !== 'p-sold')`); // retrait du pack vendu aussi
  responses['p-sold'] = { ok: false, blocked: true, error: 'déjà acheté' };
  res = await ev('deleteRemovedCatalogItems()');
  check('suppressions envoyées : pack libre, pack vendu, morceau fantôme (et rien d\'autre)',
    calls.slice().sort().join() === ['packs:p-free', 'packs:p-sold', 'tracks:ghost'].sort().join());
  check('packs supprimés avant les morceaux', calls.indexOf('packs:p-free') < calls.indexOf('tracks:ghost'));
  check('le bon morceau n\'est jamais supprimé', !calls.includes('tracks:good'));
  check('fichiers du morceau fantôme effacés après la suppression en base', r2Deleted.join() === 'audio/ghost/layer0.ogg');
  check('2 suppressions faites', res.deleted === 2);
  check('refus "déjà acheté" remonté avec le titre du pack', res.blocked.length === 1 && res.blocked[0].includes('Pack vendu'));
  check('plus aucun fichier en attente', ev('pendingR2Deletes.size') === 0);

  // ---- Après publication réussie : plus rien à supprimer ----
  ev('rememberPublishedCatalog()');
  calls.length = 0;
  res = await ev('deleteRemovedCatalogItems()');
  check('publication suivante : aucune suppression en double', calls.length === 0 && res.deleted === 0);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
