// Bug du 22/11 (AdReel « Concerts de Poche ») : supprimer de la bibliothèque un morceau utilisé par l'AdReel
// ouvert remplaçait `ar.trackIds` par une NOUVELLE liste, alors que l'écran (variable globale `trackIds`)
// gardait l'ancienne. Le morceau ajouté ensuite s'affichait dans le Backstage mais n'était jamais envoyé à la
// sauvegarde. Vérifie que la suppression d'un morceau ou d'un Sfx retire l'élément SUR PLACE :
// 1) la liste affichée et la liste sauvegardée de l'AdReel restent la même liste ;
// 2) un morceau ajouté après la suppression part bien dans la sauvegarde (buildDataSnapshot) ;
// 3) même chose pour les packs, et pour les listes de Sfx (blocs, packs, morceaux).
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  const realConfirm = window.LayerPitchNotify.confirm;
  window.LayerPitchNotify.confirm = (...args) => {
    const answer = realConfirm(...args);
    setTimeout(() => click(doc.querySelector('#lpConfirmOverlay .lp-confirm-ok')), 0);
    return answer;
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const ev = code => window.eval(code);

  // ---- Morceaux : l'AdReel ouvert utilise « ancienne » et « pari » ----
  click(doc.getElementById('btnAddLibraryTrack'));
  click(doc.getElementById('btnAddLibraryTrack'));
  click(doc.getElementById('btnAddLibraryTrack'));
  ev(`library[0].id = 'pari'; library[0].title = '6. Pari';
      library[1].id = 'ancienne'; library[1].title = '6. La Paix (ancienne version)';
      library[2].id = 'nouvelle'; library[2].title = '6. La Paix (nouvelle version)';
      packs = [{ id: 'pk', title: 'Pack', trackIds: ['ancienne', 'pari'], sfxIds: [] }];
      adReels = [{ id: 'main', label: 'Concerts', lang: 'fr', blocks: [], profile: { title: '', theme: {} }, testimonials: [], trackIds: ['pari', 'ancienne'], trackOverrides: {}, allowIndexing: false, folderId: null }];
      currentAdReelId = 'main'; trackIds = adReels[0].trackIds;
      window.__packList = packs[0].trackIds;
      manageLibrarySelectedId = 'ancienne'; renderLibrary();`);

  const removeOld = [...doc.querySelectorAll('[data-action="remove-track"]')]
    .find(b => ev('library')[parseInt(b.dataset.ti, 10)].id === 'ancienne');
  check('bouton de suppression du morceau présent', !!removeOld);
  click(removeOld);
  await settle();
  check('morceau retiré de la bibliothèque', ev('library.map(t => t.id).join()') === 'pari,nouvelle');
  check('morceau retiré de l\'AdReel', ev('adReels[0].trackIds.join()') === 'pari');
  check('liste affichée et liste sauvegardée restent la même liste', ev('trackIds === adReels[0].trackIds'));
  check('la liste du pack est gardée (retrait sur place)', ev('packs[0].trackIds === window.__packList && packs[0].trackIds.join() === "pari"'));

  // Ce que fait le sélecteur de morceaux quand on ajoute un morceau : il modifie la liste affichée.
  ev(`trackIds.push('nouvelle')`);
  const snap = ev(`buildDataSnapshot('pro', '2026-11-22T00:00:00Z')`);
  const savedIds = (snap.adReels.find(a => a.id === 'main') || {}).trackIds || [];
  check('le morceau ajouté après la suppression part dans la sauvegarde', savedIds.join() === 'pari,nouvelle');

  // ---- Sfx : listes des blocs, des packs et des morceaux gardées ----
  ev(`sfxLibrary.length = 0;
      sfxLibrary.push({ id: 'sx1', title: 'Sfx 1', alternatives: [], folderId: null }, { id: 'sx2', title: 'Sfx 2', alternatives: [], folderId: null });
      library[0].sfxIds = ['sx1', 'sx2']; packs[0].sfxIds = ['sx1', 'sx2'];
      adReels[0].blocks = [{ id: 'bs', type: 'sfx', sfxIds: ['sx2', 'sx1'] }];
      window.__sfxLists = [library[0].sfxIds, packs[0].sfxIds, adReels[0].blocks[0].sfxIds];
      manageSfxSelectedId = 'sx1'; renderSfxLibrary();`);
  const removeSfx = [...doc.querySelectorAll('[data-action="remove-sfx"]')]
    .find(b => ev('sfxLibrary')[parseInt(b.dataset.si, 10)].id === 'sx1');
  check('bouton de suppression du Sfx présent', !!removeSfx);
  click(removeSfx);
  await settle();
  check('Sfx retiré partout, mêmes listes gardées', ev(`library[0].sfxIds === __sfxLists[0] && packs[0].sfxIds === __sfxLists[1] && adReels[0].blocks[0].sfxIds === __sfxLists[2]
    && [library[0].sfxIds, packs[0].sfxIds, adReels[0].blocks[0].sfxIds].every(l => l.join() === 'sx2')`));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
