// Copie d'un morceau de la bibliothèque (6/10) : copie indépendante (nouveaux id, références internes redirigées, fichiers copiés
// côté serveur pour un morceau publié), refus pour un morceau protégé, insertion à l'endroit visé (Alt + glisser), bouton réservé
// tant que le feu vert n'est pas donné. Le vrai Backstage dans jsdom ; l'Edge Function copy-track-files est simulée.
const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  const ev = code => w.eval(code);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 20));

  const data = {
    library: [
      { id: 'tA', title: 'Morceau A', mode: 'sequential', base: 'https://m/tA/', folderId: 'f1',
        segmentSlots: [{ id: 'S1', label: 'A', alternatives: [{ id: 'alt1', file: 'a.ogg', label: 'a' }], nextOptions: [{ targetId: 'S2', label: 'vers B', fxActions: [{ triggerId: 'T1', active: true }] }] },
                       { id: 'S2', label: 'B', alternatives: [{ id: 'alt2', file: 'b.ogg', label: 'b' }], referencesSlotId: null }],
        fxTriggers: [{ id: 'T1', label: 'Low life', target: { type: 'track' }, fx: { lowcut: { frequency: 150 } }, visible: true, relations: { activates: [{ triggerId: 'T2', delaySec: 1 }] },
                      steps: [{ id: 'st1', delaySec: 2, fx: {}, children: [{ id: 'st2', delaySec: 1, fx: {} }] }] },
                     { id: 'T2', label: 'Suite', target: { type: 'track' }, fx: { bitcrush: { bits: 6 } }, visible: false }],
        fxSliders: [{ id: 'SL1', label: 'Curseur', thresholds: [{ triggerId: 'T1', at: 50 }], bindings: [] }] },
      { id: 'tB', title: 'Morceau B', mode: 'vertical', base: 'https://m/tB/', folderId: null, layers: [{ id: 'l1', label: 'L', file: 'l.ogg' }] },
      { id: 'tP', title: 'Protégé', mode: 'vertical', base: 'https://m/tP/', protected: true, layers: [{ id: 'l2', label: 'L', file: 'p.ogg' }] },
    ],
    libraryFolders: [{ id: 'f1', label: 'Dossier' }],
    packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: [],
  };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();
  // Les fichiers « publiés » portent remoteFile (c'est ce que le chargement fournit à un morceau en ligne).
  ev("library[0].segmentSlots[0].alternatives[0].remoteFile = 'a.ogg'; library[0].segmentSlots[1].alternatives[0].remoteFile = 'b.ogg'; library[2].layers[0].remoteFile = 'p.ogg'; library[2].protected = true;");
  const calls = [];
  w.LayerPitchTracks = Object.assign({}, w.LayerPitchTracks, { copyTrackFiles: async (from, to) => { calls.push([from, to]); return { ok: true, files: 2 }; } });
  ev('loadPostgresReadScripts = async () => {}');
  const msgs = [];
  ev("window.LayerPitchNotify.error = m => { window.__err = m; }; window.LayerPitchNotify.info = m => { window.__info = m; };");

  // --- copie simple ---
  const copy = await ev('duplicateLibraryTrack(library[0])');
  const lib = ev('library');
  check('copie : un morceau de plus, juste après l\'original, même dossier', lib.length === 4 && lib[1] === copy && copy.folderId === 'f1');
  check('copie : titre « … (copie) », nouvel id', copy.title === 'Morceau A (copie)' && copy.id !== 'tA');
  check('copie : les fichiers sont copiés côté serveur (de l\'original vers la copie)', calls.length === 1 && calls[0][0] === 'tA' && calls[0][1] === copy.id);
  const ids = JSON.stringify(copy);
  check('copie : aucun ancien id n\'y reste (ni emplacement, ni trigger, ni étape)', !['S1', 'S2', 'alt1', 'alt2', 'T1', 'T2', 'SL1', 'st1', 'st2', 'tA'].some(o => new RegExp('"' + o + '"').test(ids)));
  const s1 = copy.segmentSlots[0], s2 = copy.segmentSlots[1];
  check('copie : l\'embranchement pointe vers l\'emplacement DE LA COPIE', s1.nextOptions[0].targetId === s2.id && s2.id !== 'S2');
  const t1 = copy.fxTriggers[0], t2 = copy.fxTriggers[1];
  check('copie : l\'action d\'embranchement vise le trigger de la copie', s1.nextOptions[0].fxActions[0].triggerId === t1.id);
  check('copie : « Active aussi » vise le trigger de la copie', t1.relations.activates[0].triggerId === t2.id);
  check('copie : seuil de curseur vise le trigger de la copie', copy.fxSliders[0].thresholds[0].triggerId === t1.id);
  check('copie : étapes et enfants gardés, avec leurs propres id', t1.steps[0].children[0].delaySec === 1 && t1.steps[0].id !== 'st1');
  check('copie : fichiers publiés gardent leur nom (copiés sous le nouvel id)', s1.alternatives[0].remoteFile === 'a.ogg');
  check('copie : l\'original est intact', lib[0].segmentSlots[0].nextOptions[0].targetId === 'S2' && lib[0].fxTriggers[0].id === 'T1');
  check('copie : modifications non publiées signalées, copie sélectionnée', ev('hasUnsavedEdits') === true && ev('manageLibrarySelectedId') === copy.id);
  copy.fxTriggers[0].fx.lowcut.frequency = 999;
  check('copie indépendante : modifier la copie ne touche pas l\'original', lib[0].fxTriggers[0].fx.lowcut.frequency === 150);

  // --- sans fichier publié : aucun appel serveur ---
  ev('library.find(t => t.id === "tB").layers.forEach(l => { l.remoteFile = null; })'); // jamais publié : fichiers seulement en attente
  const before = calls.length;
  const c2 = await ev('duplicateLibraryTrack(library.find(t => t.id === "tB"))');
  check('morceau sans fichier publié : copié sans appel serveur', !!c2 && calls.length === before);

  // --- protégé ---
  const nb = ev('library.length');
  const c3 = await ev('duplicateLibraryTrack(library.find(t => t.id === "tP"))');
  check('morceau protégé : refusé, rien créé, message clair', c3 === null && ev('library.length') === nb && /prot/.test(w.__err || ''));

  // --- échec serveur ---
  w.LayerPitchTracks.copyTrackFiles = async () => ({ ok: false, error: 'boom' });
  const nb2 = ev('library.length');
  const c4 = await ev('duplicateLibraryTrack(library[0])');
  check('échec de la copie des fichiers : aucune copie créée', c4 === null && ev('library.length') === nb2 && /boom/.test(w.__err || ''));
  w.LayerPitchTracks.copyTrackFiles = async (from, to) => { calls.push([from, to]); return { ok: true, files: 1 }; };

  // --- endroit visé (Alt + glisser) ---
  const c5 = await ev('duplicateLibraryTrack(library.find(t => t.id === "tB"), { folderId: "f1", anchorId: "tA", before: true })');
  const order = ev('library.map(t => t.id)');
  check('Alt + glisser sur une ligne (moitié haute) : copie insérée AVANT elle, dans son dossier', order.indexOf(c5.id) === order.indexOf('tA') - 1 && c5.folderId === 'f1');
  const c6 = await ev('duplicateLibraryTrack(library.find(t => t.id === "tB"), { folderId: null, append: true })');
  check('Alt + glisser sur une zone vide : copie en dernier, dans le groupe visé', ev('library[library.length - 1].id') === c6.id && c6.folderId === null);

  // --- bouton et glisser réels ---
  ev("manageLibrarySelectedId = 'tB'; renderLibrary();"); await settle();
  check('bouton « Dupliquer » présent (feu vert ouvert)', w.document.querySelectorAll('[data-action="duplicate-track"]').length === 1);
  const n0 = ev('library.length');
  w.document.querySelector('[data-action="duplicate-track"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle(); await settle();
  check('clic sur « Dupliquer » : une copie de plus', ev('library.length') === n0 + 1);
  ev("myFlags = new Proxy({}, { get: () => false }); currentUserIsAdmin = false; renderLibrary();"); await settle();
  check('feu vert fermé : pas de bouton « Dupliquer »', w.document.querySelectorAll('[data-action="duplicate-track"]').length === 0);

  // --- Edge Function ---
  const fn = fs.readFileSync('supabase/functions/copy-track-files/index.ts', 'utf8');
  check('Edge Function : refuse un morceau protégé et une destination existante, vérifie le propriétaire',
    /source\.protected\) return json/.test(fn) && /existing\) return json/.test(fn) && /owner_id !== composerId/.test(fn));
  check('Edge Function : copie dans le seau public sous le nouvel identifiant, ne supprime rien', /audio\/\$\{toTrackId\}\//.test(fn) && !/method: 'DELETE'/.test(fn));

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
