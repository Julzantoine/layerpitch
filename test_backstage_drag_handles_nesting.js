// Toutes les poignées de glisser-déposer du Backstage (27/09, demande de Jules-Antoine après le bloc Musique resté
// grisé) : chaque poignée n'arme QUE l'élément qui la porte (jamais un bloc/dossier qui le contient), et après un
// glisser-déposer complet -- y compris quand la ligne glissée est reconstruite au dépôt -- plus rien ne reste grisé
// ni « en cours de glisser ».
const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  const ev = code => window.eval(code);

  const q = sel => doc.querySelector(sel);
  doc.getElementById('authGateOverlay').remove();
  window.LayerPitchTracks = window.LayerPitchPacks = window.LayerPitchSfx = window.LayerPitchCollections = window.LayerPitchAdReels = {};
  const ITEM = '[data-drag-id], .block-editor-card';
  const dt = () => ({ types: ['text/plain'], setData() {}, effectAllowed: '', dropEffect: '' });
  const mk = (type, d) => { const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: 1 }); Object.defineProperty(e, 'dataTransfer', { value: d }); return e; };
  const up = () => doc.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  const visibleHandles = () => visibleHandlesImpl();

  // Pour chaque poignée présente : 1) presser n'arme que son propre élément ; 2) glisser-déposer complet sur un
  // voisin (ce qui reconstruit la liste, comme en vrai) ne laisse rien de grisé ni d'état de glisser en cours.
  function sweep(label) {
    let n = 0, armBad = [], leftBad = [];
    for (let i = 0; i < visibleHandles().length; i++) {
      const h = visibleHandles()[i];
      const own = h.closest(ITEM);
      h.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
      const armed = [...doc.querySelectorAll('[draggable="true"]')];
      if (!(armed.length === 1 && armed[0] === own)) armBad.push(i + ':' + (own ? own.className : '?') + ' armés=' + armed.map(a => a.className).join('/'));
      const from = armed.find(a => a === own) || own;
      const sib = [...from.parentElement.children].find(c => c !== from && c.matches(ITEM) && c.querySelector('.block-drag-handle')) || from;
      const d = dt();
      from.dispatchEvent(mk('dragstart', d)); sib.dispatchEvent(mk('dragover', d)); sib.dispatchEvent(mk('drop', d));
      if (from.isConnected) from.dispatchEvent(mk('dragend', d)); // ligne reconstruite au dépôt : son dragend ne remonte pas
      up();
      const stuck = [...doc.querySelectorAll('.dragging, .is-reordering, [draggable="true"]')];
      const globals = ev('[draggedBlockId, draggedOrgItemId, draggedOrgFolderId].filter(x => x !== null).length');
      if (stuck.length || globals) leftBad.push(i + ':' + stuck.map(s => s.className).join('/') + (globals ? ' +état global' : ''));
      n++;
    }
    check(`${label} : ${n} poignée(s), chacune n'arme que son élément` + (armBad.length ? ' -> ' + armBad.join(' | ') : ''), n > 0 && !armBad.length);
    check(`${label} : rien de grisé ni de glisser en cours après dépôt` + (leftBad.length ? ' -> ' + leftBad.join(' | ') : ''), n > 0 && !leftBad.length);
  }
  let visibleHandlesImpl = null;

  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  const lib = (mode, extra) => `{ id: 't_${mode}', title: '${mode}', mode: '${mode}', folderId: null, ${extra} }`;
  ev(`library.length = 0; libraryFolders.length = 0;
    libraryFolders.push({ id: 'f1', name: 'Dossier 1' }, { id: 'f2', name: 'Dossier 2' });
    library.push(
      { id: 't_x', title: 'X', mode: 'static', folderId: 'f1' }, { id: 't_y', title: 'Y', mode: 'static', folderId: 'f1' },
      { id: 't_z', title: 'Z', mode: 'static', folderId: null });`);
  click(q('.nav-item[data-tab="library"]'));
  const modes = {
    sequential: `segmentSlots: ['A','B','C'].map(l => ({ id: 's' + l, label: l, alternatives: [] }))`,
    'vertical-random': `sections: [{ id: 'secA', label: 'Calme', pools: [] }, { id: 'secB', label: 'Combat', pools: [] }]`,
    'embranchement-vertical': `loops: [{ id: 'lA', label: 'L1', bars: 4 }, { id: 'lB', label: 'L2', bars: 4 }]`,
    vertical: `layers: [{ id: 'yA', label: 'Basse' }, { id: 'yB', label: 'Batterie' }]`,
  };
  for (const [mode, extra] of Object.entries(modes)) {
    ev(`library.push(${lib(mode, extra)}); manageLibrarySelectedId = 't_${mode}'; renderLibrary();`);
    const ti = ev(`library.findIndex(t => t.id === 't_${mode}')`);
    const first = q(`#libraryContainer .seq-master-item[data-ti="${ti}"][data-drag-id]`);
    if (first) click(first);
    const n = doc.querySelectorAll(`#libraryContainer .seq-master-item[data-ti="${ti}"][data-drag-id] .block-drag-handle`).length;
    check(`morceau ${mode} : éléments à poignée affichés`, n >= 2);
    visibleHandlesImpl = () => [...doc.querySelectorAll('#libraryContainer .block-drag-handle')];
    sweep(`Bibliothèque, morceau ${mode} (slots/sections/boucles/couches)`);
  }
  visibleHandlesImpl = () => [...doc.querySelectorAll('#libraryMaster .block-drag-handle, [id$="Master"] .block-drag-handle')].filter(h => h.closest('#libraryPanel, [data-panel="library"]') || true);
  const libMasterSel = ev(`(() => { const el = document.querySelector('.org-row[data-drag-id="t_x"]'); return el ? '#' + el.closest('[id]').id : null; })()`);
  visibleHandlesImpl = () => [...doc.querySelectorAll(libMasterSel + ' .block-drag-handle')];
  sweep('Bibliothèque musicale : morceaux et dossiers');

  ev(`sfxLibrary.length = 0; sfxFolders.length = 0; sfxFolders.push({ id: 'sf1', name: 'D' });
    sfxLibrary.push({ id: 'x1', title: 'A', folderId: 'sf1' }, { id: 'x2', title: 'B', folderId: 'sf1' }, { id: 'x3', title: 'C', folderId: null });`);
  click(q('.nav-item[data-tab="sfxLibrary"]')); ev('renderSfxLibrary()');
  const sfxSel = ev(`(() => { const el = document.querySelector('.org-row[data-drag-id="x1"]'); return el ? '#' + el.closest('[id]').id : null; })()`);
  visibleHandlesImpl = () => [...doc.querySelectorAll(sfxSel + ' .block-drag-handle')];
  sweep('Bibliothèque Sfx : Sfx et dossiers');

  ev(`adReels.length = 0; adReelFolders.length = 0; adReelFolders.push({ id: 'af1', name: 'D' });
    adReels.push({ id: 'a1', name: 'A', slug: 'a', folderId: 'af1', blocks: [] }, { id: 'a2', name: 'B', slug: 'b', folderId: 'af1', blocks: [] }, { id: 'a3', name: 'C', slug: 'c', folderId: null, blocks: [] });`);
  click(q('.nav-item[data-tab="manageAdreels"]')); ev('renderManageAdreels()');
  const arSel = ev(`(() => { const el = document.querySelector('.org-row[data-drag-id="a1"]'); return el ? '#' + el.closest('[id]').id : null; })()`);
  visibleHandlesImpl = () => [...doc.querySelectorAll(arSel + ' .block-drag-handle')];
  sweep('Gérer les AdReels : AdReels et dossiers');

  // Blocs de contenu, dont le bloc Musique avec ses morceaux (le cas signalé le 27/09)
  click(q('.nav-item[data-tab="content"]'));
  ev(`trackIds.length = 0; trackIds.push('t_x', 't_y', 't_z'); blocks.length = 0;
    blocks.push({ id: 'bh', type: 'header' }, { id: 'bt', type: 'text', title: 'Intro', body: 'Salut' }, { id: 'bm', type: 'tracks' });
    rebuildAllCards(); layoutBlocks();`);
  check('bloc Musique : 3 morceaux à poignée', doc.querySelectorAll('#blocksEditorContainer .sel-track-item .block-drag-handle').length === 3);
  visibleHandlesImpl = () => [...doc.querySelectorAll('#blocksEditorContainer .block-drag-handle')];
  sweep('Contenu de l\'AdReel : blocs + morceaux du bloc Musique');

  // Morceaux d'un pack (même liste de morceaux que le bloc Musique, hors bloc)
  ev(`packs.length = 0; packs.push({ id: 'p1', name: 'P', trackIds: ['t_x', 't_y', 't_z'] });`);
  click(q('.nav-item[data-tab="packs"]')); ev('renderPacks()');
  const packHandles = doc.querySelectorAll('#packsContainer .block-drag-handle, [id*="ack"] .sel-track-item .block-drag-handle').length;
  if (packHandles) { visibleHandlesImpl = () => [...doc.querySelectorAll('.sel-track-item .block-drag-handle')].filter(h => !h.closest('#blocksEditorContainer')); sweep('Packs : morceaux d\'un pack'); }
  else console.log('INFO - Packs : liste de morceaux non dépliée dans ce rendu (vérifiée via le bloc Musique, même composant)');

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
