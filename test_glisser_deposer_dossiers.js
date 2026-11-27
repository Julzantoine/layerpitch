// Glisser-déposer avec dossiers (retour bêta 11/11 : « je n'ai pas réussi à déplacer mes morceaux dans des dossiers ») : ranger un
// morceau en déposant sur l'EN-TÊTE d'un dossier (ouvert ou replié), le sortir d'un dossier par la zone « Hors dossier », saisir un
// dossier par le corps de son en-tête, voir le dossier d'arrivée teinté. Le geste complet est rejoué dans le vrai Backstage.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window, doc = w.document, ev = c => w.eval(c);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 30));
  const mk = (id, t, folderId) => ({ id, title: t, folderId, mode: 'vertical', base: 'https://m/' + id + '/', layers: [{ id: 'l' + id, label: 'L', file: 'x.ogg' }] });
  const data = {
    library: [mk('tA', 'A', 'f1'), mk('tB', 'B', 'f1'), mk('tC', 'C', 'f2'), mk('tD', 'D', null)],
    libraryFolders: [{ id: 'f1', label: 'Un' }, { id: 'f2', label: 'Deux' }, { id: 'f3', label: 'Trois' }],
    packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: []
  };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();
  ev("collapsedLibraryFolderIds.clear(); manageLibrarySelectedId = 'tA'; renderLibrary();"); await settle();
  const folderOf = id => ev('library.find(t => t.id === "' + id + '").folderId');
  const rowOf = id => [...doc.querySelectorAll('.org-row')].find(r => r.dataset.dragId === id);
  const header = fid => doc.querySelector('.org-folder-group[data-drag-id="' + fid + '"] .org-folder-header');
  const send = (type, target, y) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.clientY = y || 0; e.dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' }; target.dispatchEvent(e); return e; };
  const dragItem = (id, dropOn, y) => {
    const from = rowOf(id);
    from.querySelector('.block-drag-handle').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    send('dragstart', from);
    const over = send('dragover', dropOn, y);
    const marked = doc.querySelector('.org-drop-target') ? doc.querySelector('.org-drop-target').className : '';
    send('drop', dropOn, y); send('dragend', from);
    return { over, marked };
  };

  // 1. en-tête d'un dossier ouvert : le morceau y entre
  let r = dragItem('tD', header('f3'));
  check('déposer sur l\'en-tête du dossier « Trois » (vide) : D y entre', folderOf('tD') === 'f3' && r.over.defaultPrevented);
  ev('collapsedLibraryFolderIds.clear(); renderLibrary()'); await settle();
  // 2. en-tête d'un dossier OUVERT contenant déjà des lignes
  r = dragItem('tD', header('f2'));
  check('déposer sur l\'en-tête du dossier « Deux » (ouvert, avec lignes) : D y entre', folderOf('tD') === 'f2');
  check('le dossier visé est mis en évidence pendant le survol', /org-drop-target/.test(r.marked));
  ev('collapsedLibraryFolderIds.clear(); renderLibrary()'); await settle();
  // 3. dossier replié
  ev("collapsedLibraryFolderIds.add('f1'); renderLibrary();"); await settle();
  check('dossier replié : ses lignes ne sont pas affichées', !rowOf('tA'));
  r = dragItem('tC', header('f1'));
  check('déposer sur l\'en-tête d\'un dossier REPLIÉ : C y entre', folderOf('tC') === 'f1');
  ev("collapsedLibraryFolderIds.delete('f1'); renderLibrary();"); await settle();
  // 4. sortir d'un dossier : zone « Hors dossier »
  const hint = doc.querySelector('.org-root-hint');
  check('zone « Hors dossier » présente quand il y a des dossiers', !!hint);
  ev("library.forEach(t => { if (t.id !== 'tA') t.folderId = 'f1'; }); library.find(t => t.id === 'tA').folderId = 'f2'; renderLibrary();"); await settle();
  r = dragItem('tA', doc.querySelector('.org-root-hint'));
  check('déposer sur « Hors dossier » alors que la racine est vide : A sort de son dossier', folderOf('tA') === null);
  ev('collapsedLibraryFolderIds.clear(); renderLibrary()'); await settle();
  // 5. teinte du dossier d'arrivée quand on survole une ligne
  const from = rowOf('tB');
  from.querySelector('.block-drag-handle').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  send('dragstart', from);
  const target = rowOf('tC');
  target.getBoundingClientRect = () => ({ top: 0, bottom: 50, height: 50, left: 0, right: 300, width: 300 });
  send('dragover', target, 5);
  check('survol d\'une ligne : le dossier qui la contient est teinté', !!doc.querySelector('.org-drop-folder'));
  send('dragend', from);
  check('fin du glisser : plus aucun repère', !doc.querySelector('.org-drop-folder, .org-drop-target, .drag-over-top, .drag-over-bottom'));
  // 6. saisie d'un dossier par le corps de son en-tête
  const h = header('f1');
  h.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  check('en-tête (corps) : arme le dossier', h.closest('.org-folder-group').draggable === true);
  h.closest('.org-folder-group').draggable = false;
  h.querySelector('.org-folder-title').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  check('champ du nom du dossier : n\'arme pas le dossier (on peut taper / sélectionner le texte)', h.closest('.org-folder-group').draggable !== true);

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
