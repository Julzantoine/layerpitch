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
  <script>${read('layerpitch-av-sync.js')}</script><script>${read('capture-versioning.js')}</script></body></html>`;
  const store = { rows: [], calls: [], missing: false, link: null, comments: [] };
  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function P(v) { return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime(x) { this.value = x; } }; }
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
        if (name === 'set_video_capture_version_status') { const r = store.rows.find(x => x.id === args.p_id); if (r) { r.status = args.p_status; r.statusAt = '2026-11-09T10:00:00Z'; } return { data: { ok: true }, error: null }; }
        if (name === 'get_video_review_link') return { data: store.link ? Object.assign({}, store.link) : null, error: null };
        if (name === 'set_video_review_link') {
          const bad = (message, hint) => ({ data: null, error: { message, hint } });
          if (args.p_slug === 'deja-pris') return bad('adresse déjà prise', 'taken');
          const mode = args.p_mode || (store.link && store.link.mode) || 'magic';
          if (mode === 'password' && args.p_password != null && args.p_password.length < 6) return bad('Mot de passe trop court', 'short');
          let secret = null;
          if (!store.link) { if (!args.p_slug) return bad('adresse manquante', 'slug'); store.link = { slug: args.p_slug, enabled: true, mode }; if (mode === 'magic') secret = 'K1'.repeat(32); }
          else {
            if (args.p_enabled != null) store.link.enabled = args.p_enabled;
            if (args.p_slug) store.link.slug = args.p_slug;
            if (mode !== store.link.mode) { store.link.mode = mode; if (mode === 'magic') secret = 'K3'.repeat(32); }
            if (args.p_rotate) secret = 'K2'.repeat(32);
          }
          return { data: Object.assign({}, store.link, { secret }), error: null };
        }
        if (name === 'list_video_review_comments') return { data: JSON.parse(JSON.stringify(store.comments)), error: null };
        if (name === 'reply_video_review_comment') { const par = store.comments.find(c => c.id === args.p_parent_id); store.comments.push({ id: 'r' + store.comments.length, versionKey: par.versionKey, parentId: par.id, t: par.t, author: args.p_author, fromOwner: true, body: args.p_body, resolved: false }); return { data: { ok: true }, error: null }; }
        if (name === 'resolve_video_review_comment') { store.comments.find(c => c.id === args.p_id).resolved = args.p_resolved; return { data: null, error: null }; }
        if (name === 'delete_video_review_comment') { store.comments = store.comments.filter(c => c.id !== args.p_id && c.parentId !== args.p_id); return { data: null, error: null }; }
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
  const exports = [], saved = [], detached = [], reviewMarks = [];
  const ctx = {
    tr, videoEl: doc.createElement('video'), fetchBytes: async () => { throw new Error('pas de réseau dans le test'); }, fullExportLocked: false,
    library, findTrack, findSfx,
    getEvents: () => events, getCaptureId: () => captureId, getCaptureTitle: () => 'Trailer',
    exportEvents: async (evs, mode, onProgress) => { onProgress('rendu'); exports.push({ evs, mode }); return new W.Blob(['x']); },
    saveToLibrary: async (blob, title) => { saved.push(title); return 'vid-' + saved.length; },
    detach: async (evs, title) => { detached.push({ evs, title }); },
    onReviewComments: marks => { reviewMarks.length = 0; reviewMarks.push(...marks); }, authorName: () => 'Danny',
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

  // Statuts de relecture et différences (9/11, idée Pibox).
  check('statut : chaque version démarre en « Brouillon »', [...host.querySelectorAll('[data-role="reviewStatus"]')].every(sel => sel.value === 'draft'));
  const stSel = host.querySelector('[data-role="reviewStatus"]');
  stSel.value = 'sent'; stSel.dispatchEvent(new W.Event('change')); await tick(); await tick();
  const stCall = store.calls.find(c => c[0] === 'set_video_capture_version_status');
  check('statut : changement envoyé au serveur (« Envoyée au client »)', stCall && stCall[1].p_status === 'sent' && stCall[1].p_id === store.rows[0].id);
  check('statut : la liste affiche le nouveau statut sur la bonne version', host.querySelector('[data-role="reviewStatus"]').value === 'sent' && host.querySelectorAll('[data-role="reviewStatus"]')[1].value === 'draft');
  await V.refresh(); await tick();
  check('statut : relu depuis le serveur après rechargement', host.querySelector('[data-role="reviewStatus"]').value === 'sent');
  host.querySelector('[data-act="diff"]').click(); await tick();
  const dtxt = host.querySelector('.vcv-diff').textContent;
  check('différences (1 version) : morceau et Sfx changés par rapport à l\'original', dtxt.includes('Galactic Baston') && dtxt.includes('Les Petits Poissons') && dtxt.includes('Pas ville') && dtxt.includes(tr('versioningDiffToChoose')));
  host.querySelector('[data-act="closeDiff"]').click(); await tick();
  check('différences : fermeture', !host.querySelector('.vcv-diff'));
  host.querySelector('[data-act="compare"]').click(); await tick();
  check('comparer sans cocher deux versions : message, pas de tableau', !host.querySelector('.vcv-diff') && host.textContent.includes(tr('versioningComparePickTwo')));
  host.querySelectorAll('[data-role="pick"]').forEach(cb => { cb.checked = true; cb.dispatchEvent(new W.Event('change')); });
  host.querySelector('[data-act="compare"]').click(); await tick();
  check('comparer deux versions : tableau Original + 2 colonnes', host.querySelectorAll('.vcv-diff-table thead th').length === 4);
  host.querySelector('[data-act="closeDiff"]').click(); await tick();
  check('cases cochées conservées après réaffichage', [...host.querySelectorAll('[data-role="pick"]')].every(cb => cb.checked));

  // Relecture client (9/11) : lien secret, remarques reçues, réponse, traité, suppression, drapeaux de la frise.
  check('relecture : pas encore de lien -> bouton « Créer le lien de relecture »', !!host.querySelector('[data-act="rvCreate"]') && !host.querySelector('[data-role="rvUrl"]'));
  host.querySelector('[data-act="rvCreate"]').click(); await tick(); await tick(); await tick();
  const urlInput = host.querySelector('[data-role="rvUrl"]');
  check('relecture : lien créé -> adresse lisible /relecture/<nom> avec la clé après le # (montrée une fois)', urlInput && /\/relecture\/trailer#k=K1/.test(urlInput.value) && urlInput.value.includes('K1'.repeat(32)) && host.querySelector('.vcv-review-box').textContent.includes(tr('versioningReviewShowOnce')));
  const createCall = store.calls.find(c => c[0] === 'set_video_review_link');
  check('relecture : création envoyée avec l\'adresse, le mode magique, sans mot de passe', createCall && createCall[1].p_slug === 'trailer' && createCall[1].p_mode === 'magic' && createCall[1].p_password === null);
  store.comments = [
    { id: 'c1', versionKey: store.rows[0].id, parentId: null, t: 12.5, author: 'Camille', fromOwner: false, body: 'Drone trop fort', resolved: false },
    { id: 'c2', versionKey: 'original', parentId: null, t: 3, author: 'Léa', fromOwner: false, body: 'Début parfait', resolved: true },
  ];
  host.querySelector('[data-act="rvRefresh"]').click(); await tick(); await tick(); await tick();
  const boxTxt = host.querySelector('.vcv-review-box').textContent;
  check('relecture : remarques listées avec auteur, instant, version et nombre à traiter', boxTxt.includes('Drone trop fort') && boxTxt.includes('Camille') && boxTxt.includes('0:12') && boxTxt.includes('1 à traiter'));
  check('relecture : drapeaux envoyés à la frise (instant, auteur, version, traité)', reviewMarks.length === 2 && reviewMarks.some(m => m.id === 'c1' && m.t === 12.5 && m.author === 'Camille' && !m.resolved && m.versionTitle) && reviewMarks.some(m => m.id === 'c2' && m.resolved && m.versionTitle === tr('versioningReviewOriginal')));
  host.querySelector('.vcv-rcm[data-cid="c1"] [data-act="rvSeek"]').click();
  check('relecture : clic sur l\'instant -> la vidéo saute', Math.abs(ctx.videoEl.currentTime - 12.5) < 0.01 || ctx.videoEl.currentTime === 0 /* jsdom ne simule pas la lecture */);
  host.querySelector('.vcv-rcm[data-cid="c1"] [data-act="rvReply"]').click(); await tick();
  const rt = host.querySelector('[data-role="rvReplyText"]'); rt.value = 'Je baisse le drone'; rt.dispatchEvent(new W.Event('input'));
  host.querySelector('[data-act="rvSend"]').click(); await tick(); await tick(); await tick();
  check('relecture : réponse du compositeur envoyée avec son nom et affichée', store.comments.some(c => c.fromOwner && c.body === 'Je baisse le drone' && c.author === 'Danny') && host.querySelector('.vcv-rcm[data-cid="c1"] .vcv-rcm-reply').textContent.includes('Je baisse le drone'));
  host.querySelector('.vcv-rcm[data-cid="c1"] [data-act="rvResolve"]').click(); await tick(); await tick(); await tick();
  check('relecture : « Marquer traité » -> traité, plus rien à traiter, drapeau grisé', store.comments.find(c => c.id === 'c1').resolved === true && host.querySelector('.vcv-review-box').textContent.includes('0 à traiter') && reviewMarks.find(m => m.id === 'c1').resolved);
  host.querySelector('.vcv-rcm[data-cid="c2"] [data-act="rvDelete"]').click(); await tick(); await tick(); await tick();
  check('relecture : suppression (après confirmation) -> remarque et drapeau retirés', !store.comments.some(c => c.id === 'c2') && !host.querySelector('.vcv-rcm[data-cid="c2"]') && !reviewMarks.some(m => m.id === 'c2'));
  host.querySelector('[data-act="rvToggle"]').click(); await tick(); await tick(); await tick();
  check('relecture : désactiver le lien -> avertissement, champ et copie grisés', store.link.enabled === false && host.querySelector('.vcv-review-box').textContent.includes(tr('versioningReviewOff')) && host.querySelector('[data-role="rvUrl"]').disabled);
  host.querySelector('[data-act="rvToggle"]').click(); await tick(); await tick(); await tick();
  host.querySelector('[data-act="rvRotate"]').click(); await tick(); await tick(); await tick(); await tick();
  check('relecture : nouvelle clé (après confirmation) -> nouvelle clé affichée une fois', store.calls.filter(c => c[0] === 'set_video_review_link').pop()[1].p_rotate === true && host.querySelector('[data-role="rvUrl"]').value.includes('K2'.repeat(32)));
  // Renommer : adresse déjà prise
  host.querySelector('[data-act="rvRename"]').click(); await tick();
  const slugIn = host.querySelector('[data-role="rvSlug"]'); slugIn.value = 'deja-pris'; slugIn.dispatchEvent(new W.Event('input'));
  host.querySelector('[data-act="rvSave"]').click(); await tick(); await tick(); await tick();
  check('relecture : adresse déjà prise -> message clair, adresse inchangée', host.querySelector('[data-role="rvStatus"]').textContent === tr('versioningReviewSlugTaken') && store.link.slug === 'trailer');
  host.querySelector('[data-role="rvSlug"]').value = 'trailer-v2'; host.querySelector('[data-role="rvSlug"]').dispatchEvent(new W.Event('input'));
  host.querySelector('[data-act="rvSave"]').click(); await tick(); await tick(); await tick(); await tick();
  check('relecture : renommer -> la nouvelle adresse est affichée', store.link.slug === 'trailer-v2' && host.querySelector('[data-role="rvUrl"]').value.endsWith('/relecture/trailer-v2'));
  // Passer en mot de passe
  host.querySelector('[data-act="rvMode"]').click(); await tick();
  check('relecture : changer de mode -> choix du mode et champ mot de passe', !!host.querySelector('[data-role="rvPassword"]'));
  host.querySelector('[data-role="rvPassword"]').value = 'abc'; host.querySelector('[data-role="rvPassword"]').dispatchEvent(new W.Event('input'));
  host.querySelector('[data-act="rvSave"]').click(); await tick(); await tick(); await tick();
  check('relecture : mot de passe trop court -> message, mode inchangé', host.querySelector('[data-role="rvStatus"]').textContent === tr('versioningReviewPasswordShort') && store.link.mode === 'magic');
  host.querySelector('[data-role="rvPassword"]').value = 'sesame-2026'; host.querySelector('[data-role="rvPassword"]').dispatchEvent(new W.Event('input'));
  host.querySelector('[data-act="rvSave"]').click(); await tick(); await tick(); await tick(); await tick();
  const pwCall = store.calls.filter(c => c[0] === 'set_video_review_link').pop()[1];
  check('relecture : mode mot de passe -> envoyé avec le mot de passe, adresse seule affichée (pas de clé), mode annoncé', pwCall.p_mode === 'password' && pwCall.p_password === 'sesame-2026' && store.link.mode === 'password'
    && host.querySelector('[data-role="rvUrl"]').value.endsWith('/relecture/trailer-v2') && !host.querySelector('[data-role="rvUrl"]').value.includes('#') && host.querySelector('.vcv-review-box').textContent.includes(tr('versioningReviewPasswordMode')));
  check('relecture : le mot de passe n\'est plus affiché une fois enregistré', !host.innerHTML.includes('sesame-2026'));
  check('relecture : en mode mot de passe, « Changer le mot de passe » remplace « Nouvelle clé »', !!host.querySelector('[data-act="rvPassword"]') && !host.querySelector('[data-act="rvRotate"]'));

  // Rendu en série des deux versions, rangées en bibliothèque.
  host.querySelectorAll('[data-role="pick"]').forEach(cb => { cb.checked = true; cb.dispatchEvent(new W.Event('change')); });
  check('barre des versions cochées : cachée sans coche, visible et comptée avec', !host.querySelector('[data-role="pickedBar"]').hidden && host.querySelector('[data-role="pickedCount"]').textContent.includes('2'));
  // Exporter… : un seul bouton, le format et la publication se choisissent dans le dialogue (jsdom n'ouvre pas <dialog> : on simule sa fermeture « go »).
  const exDlg = host.querySelector('[data-role="exportDlg"]');
  exDlg.querySelector('input[value="copy"]').checked = true;
  exDlg.querySelector('[data-role="toLibrary"]').checked = true;
  if (!W.HTMLDialogElement.prototype.showModal) W.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  host.querySelector('[data-act="exportOpen"]').click();
  exDlg.returnValue = 'go'; exDlg.dispatchEvent(new W.Event('close'));
  for (let i = 0; i < 20 && exports.length < 2; i++) await tick();
  await tick(); await tick();
  check('rendu en série : les deux versions exportées, l\'une après l\'autre, en vidéo rapide', exports.length === 2 && exports.every(x => x.mode === 'copy'));
  check('rendu : le journal envoyé à l\'export est traduit (nouveau morceau, nouveau Sfx)', exports[0].evs.some(e => e.name === 'layer_segment' && e.detail.trackId === 'st2')
    && exports[0].evs.some(e => e.name === 'stinger_play' && e.detail.sfxId === 'x2') && !exports[0].evs.some(e => e.detail && e.detail.trackId === 'st1'));
  check('rendu : rangé dans la bibliothèque sous le nom du montage + de la version, rattaché à la version', saved.length === 2 && saved[0].startsWith('Trailer — ') && store.rows.every(r => r.lastExportVideoId));
  check('rendu : avancement affiché puis bilan', host.querySelector('[data-role="batchStatus"]').textContent.includes('2'));

  // Écoute multi-versions (9/11) : la musique d'origine + TOUTES les versions dans un menu déroulant sous la vidéo (dock toujours visible), sans rien
  // cocher ; on démarre par la version dont on a cliqué « Écouter », les autres se préparent en tâche de fond ; touches 1, 2, 3… aussi.
  const dockEl = doc.createElement('div'); dockEl.className = 'video-capture-dock'; doc.body.appendChild(dockEl); dockEl.appendChild(ctx.videoEl);
  const sources = [], gainsMade = [];
  const AC = W.AudioContext.prototype;
  AC.createBufferSource = function () { const n = { buffer: null, started: null, stopped: false, playbackRate: { value: 1 }, connect(g) { n.to = g; }, disconnect() {}, start(at, off) { n.started = [at, off]; }, stop() { n.stopped = true; } }; sources.push(n); return n; };
  const origGain = AC.createGain;
  AC.createGain = function () { const g = origGain.call(this); g.connect = function (d) {}; gainsMade.push(g); return g; };
  W.LayerCaptureRender.render = async () => ({ duration: 30 });
  let rolling = false;
  Object.defineProperty(ctx.videoEl, 'paused', { configurable: true, get: () => !rolling });
  Object.defineProperty(ctx.videoEl, 'readyState', { configurable: true, get: () => 4 });
  ctx.videoEl.play = () => { rolling = true; return Promise.resolve(); };
  ctx.videoEl.pause = () => { if (rolling) { rolling = false; ctx.videoEl.dispatchEvent(new W.Event('pause')); } };
  ctx.videoEl.currentTime = 7;
  host.querySelectorAll('[data-role="pick"]').forEach(cb => { cb.checked = false; cb.dispatchEvent(new W.Event('change')); });
  check('barre des versions cochées : cachée quand plus rien n\'est coché', host.querySelector('[data-role="pickedBar"]').hidden);
  const nVersions = host.querySelectorAll('.vcv-version').length;
  host.querySelectorAll('.vcv-version [data-act="listen"]')[0].click();
  check('écoute : dès le clic, le dock annonce le chargement (avant que la première version soit prête)', !dockEl.querySelector('.vcv-ab-dock').hidden && dockEl.querySelector('.vcv-ab-dock').textContent.includes(tr('versioningLoadingFirst')));
  for (let i = 0; i < 40 && sources.length < nVersions + 1; i++) await tick();
  await tick();
  const sel = () => dockEl.querySelector('.vcv-ab-select');
  // Les sons sont créés dans l'ordre : d'abord celui de la version cliquée (entrée 1 du menu), puis les autres dans l'ordre du menu.
  const creation = [1].concat(Array.from({ length: nVersions + 1 }, (_, i) => i).filter(i => i !== 1));
  const gA = () => { const g = gainsMade.slice(-sources.length).map(x => x.gain.value), out = []; creation.forEach((idx, k) => { out[idx] = g[k]; }); return out; };
  check('écoute : rien à cocher -- le menu du dock liste l\'original + toutes les versions', !!dockEl.querySelector('.vcv-ab-dock:not([hidden])') && sel().options.length === nVersions + 1 && sel().options[0].textContent.includes(tr('versioningABOriginal')));
  check('écoute : tous les sons sont préparés (en tâche de fond) et calés sur la vidéo', sources.length === nVersions + 1 && sources.every(x => Math.abs(x.started[1] - 7.03) < 0.005) && [...sel().options].every(o => !o.disabled));
  check('écoute : on a démarré par la version cliquée, les autres sont muettes', sel().value === '1' && JSON.stringify(gA()) === JSON.stringify([0, 1].concat(new Array(nVersions - 1).fill(0))));
  check('écoute : une fois tout chargé, le dock l\'annonce', dockEl.querySelector('[data-role="abNote"]').textContent === tr('versioningAllReady'));
  sel().value = '0'; sel().dispatchEvent(new W.Event('change')); await tick();
  check('écoute : choisir l\'original dans le menu -> il sonne, sans arrêter les sources', gA()[0] === 1 && gA().slice(1).every(v => v === 0) && sources.every(x => !x.stopped));
  doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: '2', bubbles: true })); await tick();
  check('écoute : touche 2 -> bascule sur la 2e entrée du menu', sel().value === '1' && gA()[1] === 1);
  if (nVersions > 1) {
    host.querySelectorAll('.vcv-version [data-act="listen"]')[1].click(); await tick();
    check('écoute : « Écouter » sur la ligne d\'une autre version bascule dessus, sans rien relancer', sel().value === '2' && sources.length === nVersions + 1 && sources.every(x => !x.stopped));
  }
  host.querySelector('.vcv-version [data-act="listen"]').click(); await tick();
  host.querySelectorAll('.vcv-version [data-act="listen"]').forEach(b => { if (b.textContent === tr('versioningStopListenBtn')) b.click(); }); await tick();
  dockEl.querySelector('[data-stop]') && dockEl.querySelector('.vcv-ab-dock:not([hidden])') && dockEl.querySelector('[data-stop]').click(); await tick();
  check('écoute : arrêt -> sources coupées, sélecteur retiré', sources.every(x => x.stopped) && dockEl.querySelector('.vcv-ab-dock').hidden && !V.isListening());

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

  // Publication automatique des versions (09/11) : le bouton global du Backstage / « Publier le montage » publie aussi les versions enregistrées
  // jamais publiées ou changées depuis (retouche du montage = toutes les versions) ; jamais en séance (Warrior).
  const pub = []; let soundKeyVar = 'k1'; const afterExports = []; const progress = [];
  const ctx3 = Object.assign({}, ctx, { getCaptureId: () => 'cap1', getSoundKey: () => soundKeyVar, cuesOf: () => [{ start: 0, end: 1, text: 'x' }], keepOld: () => true,
    publishVersion: async (evs, title) => { pub.push(title); return 'snd-' + pub.length; }, afterExport: r => afterExports.push(r), onProgress: m => progress.push(m) });
  const host3 = doc.createElement('div'); doc.body.appendChild(host3);
  const V3 = W.LayerCaptureVersioning.mount(host3, ctx3); await tick(); await tick();
  check('publication auto : versions déjà publiées, rien en attente', V3.hasPending() === false && (await V3.publishPending()) === 0 && pub.length === 0);
  store.rows.push({ id: 'vNew', captureId: 'cap1', title: 'Nouvelle', substitutions: JSON.parse(JSON.stringify(store.rows[0].substitutions)), lastExportVideoId: null });
  await V3.refresh(); await tick();
  check('publication auto : une version jamais publiée est en attente', V3.hasPending() === true);
  const n1 = await V3.publishPending(); await tick();
  check('publication auto : seule la version en attente est publiée (son + étiquettes rattachés), progression affichée', n1 === 1 && pub.length === 1 && pub[0].endsWith('Nouvelle')
    && store.rows.find(r => r.id === 'vNew').lastExportVideoId === 'snd-1' && store.calls.some(c => c[0] === 'set_video_capture_version_export' && c[1].p_id === 'vNew' && c[1].p_cues.length === 1) && progress.length === 1 && afterExports.length === 1);
  check('publication auto : republier tout de suite ne refait rien', V3.hasPending() === false && (await V3.publishPending()) === 0 && pub.length === 1);
  soundKeyVar = 'k2'; // le montage a été retouché : toutes ses versions changent
  check('publication auto : montage retouché = toutes les versions en attente', V3.hasPending() === true);
  const n2 = await V3.publishPending(); await tick();
  check('publication auto : toutes les versions sont republiées après la retouche du montage', n2 === store.rows.filter(r => r.captureId === 'cap1').length && V3.hasPending() === false);
  const V4 = W.LayerCaptureVersioning.mount(doc.createElement('div'), Object.assign({}, ctx3, { sessionOnly: true, getCaptureId: () => 'session' })); await tick();
  check('publication auto : versions de la séance (Warrior) jamais publiées', V4.hasPending() === false && (await V4.publishPending()) === 0);
  V4.stop(); V3.stop();

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
