const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Versioning vidéo, étape 2 (26/09) : la section « Versioning » du panneau de capture (capture-versioning.js), avec un
// serveur simulé en mémoire (mêmes fonctions que la migration 20260926010000). On vérifie le parcours du compositeur :
// montage pas encore sauvegardé, création d'une version (morceau compatible seulement, Sfx proposés, dossier entier,
// « à choisir » signalé), remarques de la traduction, enregistrement, duplication, suppression confirmée, rendu en série
// (journal traduit envoyé à l'export, rangement en bibliothèque), migration absente.
(async () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body><div id="host"></div>
  <script>${read('layerpitch-i18n.js')}</script><script>${read('player.js')}</script>
  <script>${read('capture-render.js')}</script><script>${read('capture-plan.js')}</script><script>${read('capture-retarget.js')}</script>
  <script>${read('capture-versioning.js')}</script></body></html>`;
  const store = { rows: [], calls: [], missing: false };
  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function P(v) { return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }; }
      function Ctx() { this.destination = {}; this.sampleRate = 44100; this.currentTime = 0; }
      Ctx.prototype.createGain = () => ({ gain: P(1), connect() {} });
      Ctx.prototype.resume = () => Promise.resolve();
      win.AudioContext = Ctx;
      win.ResizeObserver = function () { return { observe() {}, disconnect() {} }; };
      win.CSS = { escape: s => String(s).replace(/"/g, '\\"') };
      win.LayerPitchNotify = { confirm: async () => true };
      win.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (name, args) => {
        store.calls.push([name, JSON.parse(JSON.stringify(args))]);
        if (store.missing) return { data: null, error: { message: 'Could not find the function public.' + name, code: 'PGRST202' } };
        if (name === 'list_video_capture_versions') return { data: store.rows.filter(r => r.captureId === args.p_capture_id), error: null };
        if (name === 'save_video_capture_version') {
          const row = store.rows.find(r => r.id === args.p_id);
          if (row) Object.assign(row, { title: args.p_title, substitutions: args.p_substitutions });
          else store.rows.push({ id: args.p_id, captureId: args.p_capture_id, title: args.p_title, substitutions: args.p_substitutions, lastExportVideoId: null });
          return { data: { ok: true }, error: null };
        }
        if (name === 'delete_video_capture_version') { store.rows = store.rows.filter(r => r.id !== args.p_id); return { data: null, error: null }; }
        if (name === 'set_video_capture_version_export') { const r = store.rows.find(x => x.id === args.p_id); if (r) r.lastExportVideoId = args.p_video_id; return { data: null, error: null }; }
        return { data: null, error: { message: 'inconnu' } };
      } }) };
    }
  });
  await new Promise(r => setTimeout(r, 50));
  const W = dom.window, doc = W.document;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const tick = () => new Promise(r => setTimeout(r, 20));
  const I18N = W.LAYERPITCH_I18N.fr.pack;
  const tr = k => I18N[k] || k;

  const fx = { fxTriggers: [], fxSliders: [] };
  const library = {
    library: [
      Object.assign({ id: 'st1', title: 'Galactic Baston', mode: 'static', base: 'https://m/st1/', duration: 20, loopable: true, layers: [{ file: 'g.ogg' }] }, fx),
      Object.assign({ id: 'st2', title: 'Les Petits Poissons', mode: 'static', base: 'https://m/st2/', duration: 30, loopable: true, layers: [{ file: 'p.ogg' }] }, fx),
      Object.assign({ id: 'v1', title: 'Hache', mode: 'vertical', base: 'https://m/v1/', duration: 8, layers: [{ file: 'a' }, { file: 'b' }] }, fx),
    ],
    sfxLibrary: [
      { id: 'x1', title: 'Pas forêt', tag: 'Footsteps', folderId: 'F1', base: 'https://m/x1/', alternatives: [{ file: 'f0.ogg' }] },
      { id: 'x3', title: 'Porte forêt', tag: 'Door', folderId: 'F1', base: 'https://m/x3/', alternatives: [{ file: 'd.ogg' }] },
      { id: 'x2', title: 'Pas ville', tag: 'footsteps', folderId: 'F2', base: 'https://m/x2/', alternatives: [{ file: 'c0.ogg' }] },
    ],
    sfxFolders: [{ id: 'F1', name: 'Forêt' }, { id: 'F2', name: 'Ville' }],
  };
  const findTrack = id => library.library.find(t => t.id === id), findSfx = id => library.sfxLibrary.find(s => s.id === id);
  const events = [
    { t: 0, name: 'track_play', detail: { trackId: 'st1' } },
    { t: 0, name: 'layer_segment', detail: { trackId: 'st1', layerIndex: 0, duration: 12 } },
    { t: 2, name: 'stinger_play', detail: { trackId: 'st1', sfxId: 'x1', variationIndex: 0 } },
    { t: 5, name: 'stinger_play', detail: { trackId: 'st1', sfxId: 'x3', variationIndex: 0 } },
    { t: 12, name: 'voices_stop', detail: { trackId: 'st1' } },
  ];
  let captureId = null;
  const exports = [], saved = [], detached = [];
  const ctx = {
    tr, videoEl: doc.createElement('video'), fetchBytes: async () => { throw new Error('pas de réseau dans le test'); }, fullExportLocked: false,
    library, findTrack, findSfx,
    getEvents: () => events, getCaptureId: () => captureId, getCaptureTitle: () => 'Trailer',
    exportEvents: async (evs, mode, onProgress) => { onProgress('rendu'); exports.push({ evs, mode }); return new W.Blob(['x']); },
    saveToLibrary: async (blob, title) => { saved.push(title); return 'vid-' + saved.length; },
    detach: async (evs, title) => { detached.push({ evs, title }); },
  };
  W.URL.createObjectURL = () => 'blob:x'; W.URL.revokeObjectURL = () => {};
  const host = doc.getElementById('host');
  const V = W.LayerCaptureVersioning.mount(host, ctx);
  await tick();
  check('montage pas encore sauvegardé : invitation à le sauvegarder, pas de bouton de création', host.textContent.includes(tr('versioningNeedsSave')) && !host.querySelector('[data-act="new"]'));

  captureId = 'cap1';
  await V.refresh(); await tick();
  check('montage sauvegardé, aucune version : message + bouton « Créer une version vidéo »', host.textContent.includes(tr('versioningNone')) && !!host.querySelector('[data-act="new"]'));

  host.querySelector('[data-act="new"]').click(); await tick();
  const trackSel = host.querySelector('[data-track="st1"]');
  const opts = [...trackSel.options].map(o => o.value);
  check('éditeur : le morceau du montage propose seulement les morceaux compatibles (statique -> statique)', opts.includes('st2') && !opts.includes('v1'));
  const snap = host.querySelector('[data-snap="st1"]');
  check('éditeur : « Caler sur l\'image » grisé tant que le morceau est gardé', snap.disabled);
  const sfxSel = host.querySelector('[data-sfx="x1"]');
  check('éditeur : Sfx -> équivalent proposé en tête (même étiquette), toute la bibliothèque disponible',
    [...sfxSel.options].some(o => o.value === 'x2' && o.textContent.startsWith('★')) && [...sfxSel.options].some(o => o.value === 'x3'));

  trackSel.value = 'st2'; trackSel.dispatchEvent(new W.Event('change')); await tick();
  check('choix d\'un remplaçant : « Caler sur l\'image » devient disponible', !host.querySelector('[data-snap="st1"]').disabled);
  const folder = host.querySelector('[data-role="folder"]');
  folder.value = 'F2'; folder.dispatchEvent(new W.Event('change')); await tick(); await tick();
  check('dossier Sfx entier : « Pas forêt » -> « Pas ville » (même étiquette)', host.querySelector('[data-sfx="x1"]').value === 'x2');
  check('dossier Sfx entier : « Porte » sans équivalent -> « à choisir », ligne signalée', host.querySelector('[data-sfx="x3"]').value === '__choose' && host.querySelector('[data-sfx="x3"]').closest('.vcv-row').classList.contains('vcv-orange'));
  await tick();
  const notes = host.querySelector('[data-role="notes"]').textContent;
  check('remarques de la traduction affichées (Sfx à choisir)', notes.includes('Porte forêt'));
  check('nom proposé automatiquement d\'après les remplacements', host.querySelector('[data-role="title"]').placeholder.includes('Les Petits Poissons') && host.querySelector('[data-role="title"]').placeholder.includes('Ville'));

  host.querySelector('[data-act="saveDraft"]').click(); await tick(); await tick();
  const saveCall = store.calls.find(c => c[0] === 'save_video_capture_version');
  check('enregistrement : rattaché au montage, table de remplacement complète', saveCall && saveCall[1].p_capture_id === 'cap1'
    && saveCall[1].p_substitutions.tracks.st1.to === 'st2' && saveCall[1].p_substitutions.sfx.x1 === 'x2' && saveCall[1].p_substitutions.sfx.x3 === null);
  check('liste : la version apparaît avec son résumé', host.querySelectorAll('.vcv-version').length === 1 && host.querySelector('.vcv-summary').textContent.includes('Galactic Baston → Les Petits Poissons'));

  host.querySelector('[data-act="duplicate"]').click(); await tick();
  check('dupliquer : éditeur pré-rempli, nom « (copie) »', host.querySelector('[data-role="title"]').value.includes('(copie)') && host.querySelector('[data-track="st1"]').value === 'st2');
  host.querySelector('[data-act="saveDraft"]').click(); await tick(); await tick();
  check('dupliquer : deuxième version distincte', store.rows.length === 2 && store.rows[0].id !== store.rows[1].id);

  // Rendu en série des deux versions, rangées en bibliothèque.
  host.querySelectorAll('[data-role="pick"]').forEach(cb => { cb.checked = true; });
  host.querySelector('[data-role="toLibrary"]').checked = true;
  host.querySelector('[data-render="copy"]').click();
  for (let i = 0; i < 20 && exports.length < 2; i++) await tick();
  await tick(); await tick();
  check('rendu en série : les deux versions exportées, l\'une après l\'autre, en vidéo rapide', exports.length === 2 && exports.every(x => x.mode === 'copy'));
  check('rendu : le journal envoyé à l\'export est traduit (nouveau morceau, nouveau Sfx)', exports[0].evs.some(e => e.name === 'layer_segment' && e.detail.trackId === 'st2')
    && exports[0].evs.some(e => e.name === 'stinger_play' && e.detail.sfxId === 'x2') && !exports[0].evs.some(e => e.detail && e.detail.trackId === 'st1'));
  check('rendu : rangé dans la bibliothèque sous le nom du montage + de la version, rattaché à la version', saved.length === 2 && saved[0].startsWith('Trailer — ') && store.rows.every(r => r.lastExportVideoId));
  check('rendu : avancement affiché puis bilan', host.querySelector('[data-role="batchStatus"]').textContent.includes('2'));

  // Détacher.
  host.querySelector('.vcv-version [data-act="detach"]').click(); await tick(); await tick();
  check('détacher (après confirmation) : montage indépendant créé avec le journal traduit', detached.length === 1 && detached[0].evs.some(e => e.detail && e.detail.trackId === 'st2'));

  // Supprimer (confirmation dans l'interface LayerPitch, jamais confirm() du navigateur).
  host.querySelector('.vcv-version [data-act="delete"]').click(); await tick(); await tick();
  check('supprimer (après confirmation) : une version de moins', store.rows.length === 1 && host.querySelectorAll('.vcv-version').length === 1);

  // Migration pas encore appliquée.
  store.missing = true;
  await V.refresh(); await tick();
  check('migration absente : message clair au lieu d\'une erreur brute', host.textContent.includes(tr('versioningNotReady')));

  // Versions « de la séance » (28/09, palier Warrior) : tout en mémoire, rien envoyé au serveur, pas de « Détacher ».
  store.missing = false;
  const callsBefore = store.calls.length;
  const host2 = doc.createElement('div'); doc.body.appendChild(host2);
  const V2 = W.LayerCaptureVersioning.mount(host2, Object.assign({}, ctx, { sessionOnly: true, getCaptureId: () => 'session' }));
  await tick();
  check('séance : mention « versions de la séance », bouton de création présent sans montage sauvegardé', host2.textContent.includes(tr('versioningSessionNote')) && !!host2.querySelector('[data-act="new"]'));
  host2.querySelector('[data-act="new"]').click(); await tick();
  const ts2 = host2.querySelector('[data-track="st1"]'); ts2.value = 'st2'; ts2.dispatchEvent(new W.Event('change')); await tick();
  host2.querySelector('[data-act="saveDraft"]').click(); await tick(); await tick();
  check('séance : version créée et listée', host2.querySelectorAll('.vcv-version').length === 1);
  check('séance : aucun appel serveur', store.calls.length === callsBefore);
  check('séance : pas de « Détacher » (il enregistrerait un montage)', !host2.querySelector('[data-act="detach"]'));
  host2.querySelector('[data-act="delete"]').click(); await tick(); await tick();
  check('séance : suppression en mémoire', host2.querySelectorAll('.vcv-version').length === 0 && store.calls.length === callsBefore);
  V2.stop();

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
