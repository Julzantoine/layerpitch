// Exemples préchargés dans le Backstage (4/11, src/backstage/45-exemples.js) : étiquettes « Exemple », ajout au chargement,
// garde-fous (fichiers son, protection, copie, pages publiques, vente, album), AdReel Démo sans lien, « Retirer les exemples ».
// Le vrai Backstage dans jsdom ; le serveur est simulé.
const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  const ev = code => w.eval(code);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 20));
  const SRC = 'https://media.layerpitch.com/audio/bmvjfdonbsfnkd/';

  const full = () => ({
    library: [
      { id: 'tEx', title: 'Example 1 - EZ Jazz Statique', mode: 'static', base: SRC, folderId: 'fEx', exampleSourceId: 'bmvjfdonbsfnkd', layers: [{ label: 'L', file: '0-l.ogg' }], sfxIds: ['sEx'] },
      { id: 'tMine', title: 'Le mien', mode: 'static', base: 'https://media.layerpitch.com/audio/tMine/', folderId: null, layers: [{ label: 'L', file: 'm.ogg' }], sfxIds: [] },
    ],
    libraryFolders: [{ id: 'fEx', label: 'Exemples', exampleSourceId: 'example-folder' }],
    sfxLibrary: [{ id: 'sEx', title: 'Glaçons', base: 'https://media.layerpitch.com/audio/sfx-bmvjel4krqhewx/', exampleSourceId: 'bmvjel4krqhewx', alternatives: [{ file: '0-g.ogg', label: 'G' }] }],
    sfxFolders: [],
    packs: [{ id: 'pEx', title: 'Pack d\'exemple', exampleSourceId: 'example-pack', trackIds: ['tEx'], sfxIds: ['sEx'], catalogListed: false }],
    adReels: [
      { id: 'main', label: 'Principal', lang: 'fr', profile: { title: 'Ana' }, trackIds: ['tMine'], blocks: [] },
      { id: 'demo', label: 'Démo', lang: 'fr', profile: { title: 'Démo', bio: 'Ici, tu pourrais…' }, trackIds: ['tEx'], blocks: [], accessMode: 'example', exampleSourceId: 'example-adreel' },
    ],
    collections: [], socials: [], customFonts: [],
  });
  let data = full();
  const rpcCalls = [];
  w.fetchSiteData = async () => { await w.eval('seedMyExamplesIfNeeded()'); return JSON.parse(JSON.stringify(data)); };
  w.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (name, params) => { rpcCalls.push({ name, params }); return { data: name === 'seed_my_examples' ? { seeded: true, tracks: 6, sfx: 3 } : { tracks: 1 }, error: null }; } }) };
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) }); myComposerHandle = 'ana';");
  ev('loadPostgresReadScripts = async () => {}');
  ev("window.LayerPitchNotify.error = m => { window.__err = m; }; window.LayerPitchNotify.info = m => { window.__info = m; }; window.LayerPitchNotify.confirm = async () => true;");
  await ev('loadData(true)'); await settle();

  // ---- Ajout au chargement
  const seed = rpcCalls.filter(c => c.name === 'seed_my_examples');
  check('ajout au chargement : seed_my_examples appelé une fois, dans la langue affichée', seed.length === 1 && seed[0].params.p_lang === 'fr');
  await ev('loadData(true)'); await settle();
  check('… pas rappelé au rechargement suivant de la même page', rpcCalls.filter(c => c.name === 'seed_my_examples').length === 1);
  check('marquage lu au chargement (morceau, Sfx, pack, AdReel, dossier)', ev(`[library[0], sfxLibrary[0], packs[0], adReels[1], libraryFolders[0]].every(isExample) && !isExample(library[1]) && !isExample(adReels[0])`));

  // ---- Étiquettes
  ev("manageLibrarySelectedId = 'tEx'; renderLibrary();"); await settle();
  const doc = w.document;
  check('bibliothèque : dossier « Exemples » (replié) étiqueté, sans « Créer un pack »', doc.querySelectorAll('#libraryMaster .lp-example-badge').length === 1 && !doc.querySelector('#libraryMaster [data-action="pack-from-library-folder"]'));
  ev("collapsedLibraryFolderIds.delete('fEx'); renderLibrary();"); await settle();
  check('… déplié : étiquette aussi sur la ligne du morceau d\'exemple', doc.querySelectorAll('#libraryMaster .lp-example-badge').length === 2);
  check('fiche de l\'exemple : ligne d\'explication, pas de bouton « Dupliquer »', !!doc.querySelector('#libraryDetail .lp-example-notice') && !doc.querySelector('#libraryDetail [data-action="duplicate-track"]'));
  check('bouton « Retirer les exemples » visible', doc.getElementById('btnRemoveExamples').hidden === false);
  ev("renderSfxLibrary(); renderPacks(); renderManageAdreels();"); await settle();
  check('Sfx, pack et AdReel Démo : étiquette « Exemple »', !!doc.querySelector('#sfxLibraryMaster .lp-example-badge') && !!doc.querySelector('#packsContainer .lp-example-badge') && !!doc.querySelector('#manageAdreelsMaster .lp-example-badge'));

  // ---- Fichiers son verrouillés
  w.__err = '';
  const pick = doc.querySelector('#libraryDetail [data-example] [data-role="pickBtn"]');
  let inputClicked = false;
  if (pick) pick.closest('.file-ctrl').querySelector('input[type="file"]').addEventListener('click', () => { inputClicked = true; });
  if (pick) pick.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('exemple : choisir un fichier son est arrêté, avec un message', !!pick && !inputClicked && /partagés/.test(w.__err));
  w.__err = '';
  const drop = new w.Event('drop', { bubbles: true, cancelable: true });
  drop.dataTransfer = { types: ['Files'], files: [] };
  pick && pick.dispatchEvent(drop);
  check('exemple : déposer un fichier est arrêté aussi', drop.defaultPrevented && /partagés/.test(w.__err));
  ev("manageLibrarySelectedId = 'tMine'; renderLibrary();"); await settle();
  const myPick = doc.querySelector('#libraryDetail [data-role="pickBtn"]');
  w.__err = ''; let myClicked = false;
  myPick.closest('.file-ctrl').querySelector('input[type="file"]').addEventListener('click', () => { myClicked = true; });
  myPick.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('son propre morceau : le choix de fichier marche normalement', myClicked && !w.__err);

  // ---- Protection, copie
  check('protection : remplacée par une explication sur un exemple', ev("trackProtectionHtml(library[0], 0)").includes(ev("tr('exampleNoProtect')")) && !ev("trackProtectionHtml(library[0], 0)").includes('toggle-track-protection')
    && ev("sfxProtectionHtml(sfxLibrary[0], 0)").includes(ev("tr('exampleNoProtect')")));
  w.__err = '';
  const nb = ev('library.length');
  check('copie (bouton ou Alt + glisser) d\'un exemple : refusée', (await ev('duplicateLibraryTrack(library[0])')) === null && ev('library.length') === nb && /copié/.test(w.__err));

  // ---- Sélecteurs : un exemple ne va que dans le pack / l'AdReel d'exemple
  // Menu « Ajouter… » à recherche (06/11) : la liste se remplit à l'ouverture du champ.
  const opts = host => { const inp = host.querySelector('input[data-sel-action="add"]'); if (!inp) return []; inp.dispatchEvent(new w.Event('focus')); return [...host.querySelectorAll('[data-pick-id]')].map(o => o.dataset.pickId); };
  const h1 = doc.createElement('div'); ev('buildTrackSelectorWidget')(h1, [], () => {}, undefined, false);
  const h2 = doc.createElement('div'); ev('buildTrackSelectorWidget')(h2, [], () => {}, undefined, true);
  check('sélecteur de morceaux d\'un pack/AdReel ordinaire : sans les exemples', opts(h1).join() === 'tMine');
  check('… du pack ou de l\'AdReel d\'exemple : avec', opts(h2).includes('tEx'));
  const h3 = doc.createElement('div'); ev('buildSfxSelectorWidget')(h3, [], () => {}, false);
  const h4 = doc.createElement('div'); ev('buildPackSelectorWidget')(h4, [], () => {}, false);
  check('Sfx et packs d\'exemple : absents d\'un sélecteur ordinaire (collection, morceau, AdReel)', opts(h3).length === 0 && opts(h4).length === 0);

  // ---- AdReel Démo et pack d'exemple sans lien public
  check('AdReel principal : lien public ; AdReel Démo : aucun', /beta\.layerpitch\.com\/ana\/$/.test(ev("computeAdReelUrl('main')")) && ev("computeAdReelUrl('demo')") === null);
  check('pack d\'exemple : aucun lien public', ev("computePackUrl('pEx')") === null);
  ev("switchAdReel('demo'); renderAdReelSelect();"); await settle();
  check('AdReel Démo en édition : « AdReel d\'exemple : il n\'a pas de page publique »', /pas de page publique/.test(doc.getElementById('adReelUrlBox').textContent));
  check('… « Copier le lien », « Partager », « Code d\'intégration » grisés', ['btnCopyAdReelUrl', 'btnShareAdReelUrl', 'btnEmbedAdReelTracks'].every(id => doc.getElementById(id).disabled));
  ev("switchAdReel('main'); renderAdReelSelect();"); await settle();
  check('AdReel principal : boutons de lien actifs', !doc.getElementById('btnCopyAdReelUrl').disabled && !doc.getElementById('btnShareAdReelUrl').disabled);
  ev("manageAdreelsSelectedId = 'demo'; renderManageAdreels();"); await settle();
  check('gestion des AdReels : copier, partager, dupliquer grisés pour la Démo', ['copy-adreel-url-manage', 'share-adreel-url-manage', 'duplicate-adreel'].every(a => doc.querySelector(`#manageAdreelsDetail [data-action="${a}"]`).disabled));
  ev("packSelectedEntry.set('pEx', 'distribution'); collapsedPackIds.delete('pEx'); renderPacks();"); await settle();
  const dist = doc.querySelector('#packsContainer');
  check('pack d\'exemple : vente, catalogue, lien grisés ; « Prévisualiser » actif',
    ['buyable', 'catalogListed', 'priceEurCents'].every(f => dist.querySelector(`[data-pack-field="${f}"]`).disabled)
    && dist.querySelector('[data-action="copy-pack-url"]').disabled && !dist.querySelector('[data-action="preview-pack"]').disabled && !!dist.querySelector('.lp-example-notice'));

  // ---- Avant sauvegarde
  check('sauvegarde : rien à redire au départ', ev('examplePublishProblem()') === null);
  ev("adReels[0].trackIds.push('tEx')");
  check('exemple dans l\'AdReel principal : sauvegarde arrêtée, « remplace-le par ta propre musique »', /propre musique/.test(ev('examplePublishProblem()') || ''));
  ev("adReels[0].trackIds.pop(); library[1].sfxIds.push('sEx')");
  check('Sfx d\'exemple attaché à son propre morceau : arrêté aussi', /propre musique/.test(ev('examplePublishProblem()') || ''));
  ev("library[1].sfxIds.pop(); library[0].layers[0].pendingFile = { name: 'nouveau.wav' }");
  check('nouveau fichier son sur un exemple : sauvegarde arrêtée', /fichiers son sont partagés/.test(ev('examplePublishProblem()') || ''));
  ev('library[0].layers[0].pendingFile = null');
  const pub = fs.readFileSync('src/backstage/42-publication.js', 'utf8');
  check('sauvegarde : la base (dossier des fichiers) d\'un exemple n\'est jamais réécrite', /if \(!isExample\(track\)\) track\.base = /.test(pub) && /if \(!isExample\(sfx\)\) sfx\.base = /.test(pub) && /examplePublishProblem\(\)/.test(pub));
  check('albums : les exemples ne sont pas proposés', /library\.filter\(t => !t\.exampleSourceId\)/.test(fs.readFileSync('src/backstage/33-onglet-albums.js', 'utf8')));

  // ---- Retirer les exemples
  ev('hasUnsavedEdits = true'); w.__info = '';
  doc.getElementById('btnRemoveExamples').click(); await settle();
  check('changements non sauvegardés : on demande de sauvegarder d\'abord', /Sauvegarde d'abord/.test(w.__info) && !rpcCalls.some(c => c.name === 'remove_my_examples'));
  ev('hasUnsavedEdits = false');
  data = full();
  data.library = data.library.filter(t => !t.exampleSourceId); data.sfxLibrary = []; data.packs = []; data.libraryFolders = [];
  data.adReels = data.adReels.filter(a => !a.exampleSourceId);
  doc.getElementById('btnRemoveExamples').click(); await settle(); await settle();
  check('« Retirer les exemples » : remove_my_examples puis rechargement', rpcCalls.some(c => c.name === 'remove_my_examples') && ev('library.length') === 1 && /retirés/.test(w.__info));
  check('… le bouton disparaît', doc.getElementById('btnRemoveExamples').hidden === true);

  // ---- La Démo ne remplace jamais l'AdReel principal
  data = full(); data.adReels = data.adReels.filter(a => a.exampleSourceId);
  await ev('loadData(true)'); await settle();
  check('compte avec seulement la Démo : un AdReel principal vierge est ajouté, en tête, et c\'est lui en édition',
    ev("adReels.length === 2 && adReels[0].id === 'main' && !isExample(adReels[0]) && currentAdReelId === 'main'"));

  // ---- Fonctions serveur
  const prot = fs.readFileSync('supabase/functions/set-track-protection/index.ts', 'utf8');
  const copyFn = fs.readFileSync('supabase/functions/copy-track-files/index.ts', 'utf8');
  check('set-track-protection : refuse un exemple AVANT de déplacer quoi que ce soit', /if \(item\.example_source_id\) return json/.test(prot) && prot.indexOf('item.example_source_id) return') < prot.indexOf('set_track_protected'));
  check('copy-track-files : refuse un exemple', /if \(source\.example_source_id\) return json/.test(copyFn));

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
