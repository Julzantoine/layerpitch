// Backstage → Vidéo → sous-onglet « Projets vidéo » (09/11, remplace « Atelier » + « Versioning », demande de Jules-Antoine : « même logique
// qu'un AdReel »). Un projet vidéo = un montage sauvegardé (video_captures) et ses versions : sélecteur + Nouveau + Suppr., l'atelier s'ouvre sur
// le projet choisi (atelier.html?...&id=<pack>&montage=<id>). Réservé au palier qui enregistre les montages ; sinon l'atelier s'ouvre comme avant.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  const doc = window.document;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 30));
  const ev = code => window.eval(code);

  const calls = [];
  const rpcData = {
    list_my_video_captures: [
      { id: 'cap1', packId: 'p1', title: 'Trailer', videoFilename: 'gameplay.mp4', updatedAt: '2026-09-26T10:00:00Z' },
      { id: 'cap2', packId: 'p2', title: '', videoFilename: null, updatedAt: '2026-09-25T10:00:00Z' },
    ],
    list_my_videos: { videos: [{ id: 'vid1' }], quotaGb: 100 },
  };
  const versions = { cap1: [{ id: 'v1', title: 'Musique B', lastExportVideoId: 'vid1' }, { id: 'v2', title: 'Sfx ville', lastExportVideoId: null }], cap2: [] };
  window.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'list_video_capture_versions') return { data: versions[args.p_capture_id], error: null };
    if (name === 'save_video_capture') { rpcData.list_my_video_captures.unshift({ id: args.p_id, packId: args.p_pack_id, title: args.p_title, videoFilename: null, updatedAt: '2026-11-09T10:00:00Z' }); return { data: { ok: true }, error: null }; }
    if (name === 'delete_video_capture') { rpcData.list_my_video_captures = rpcData.list_my_video_captures.filter(c => c.id !== args.p_id); return { data: null, error: null }; }
    return { data: rpcData[name], error: null };
  } }) };
  ev(`packs = [{ id: 'p1', title: 'Robot Adventure' }, { id: 'p2', title: 'Pack B' }];`);
  window.LayerPitchNotify.confirm = async () => true;
  // jsdom : <dialog> sans showModal/close
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

  const tabBtn = doc.querySelector('#panelVideoLibrary [data-video-subtab="capture"]');
  check('onglet Vidéo : sous-onglet « Projets vidéo » présent, plus de « Versioning » ni de panneau à part',
    !!tabBtn && !doc.querySelector('#panelVideoLibrary [data-video-subtab="versioning"]') && !doc.getElementById('videoVersioningList'));

  // Sans le palier : l'atelier s'ouvre comme avant, sans projet.
  ev("currentUserIsAdmin = false; myFlags = {}; myEntitlements = {};");
  tabBtn.click(); await settle();
  const frame = doc.getElementById('videoAtelierFrame');
  check('sans le palier : pas de barre de projets, atelier ouvert comme avant (choix du pack dans l\'atelier), aucune lecture de montages',
    doc.getElementById('videoProjectBar').hidden && /^\.\/atelier\.html\?lang=\w+$/.test(frame.getAttribute('src') || '') && !calls.some(c => c[0] === 'list_my_video_captures'));

  // Avec le palier : sélecteur de projets, premier ouvert.
  frame.removeAttribute('src');
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  tabBtn.click(); await settle(); await settle(); await settle();
  const select = doc.getElementById('videoProjectSelect');
  check('palier : barre « Projet vidéo » visible, tous les projets listés (tous packs, lecture sans filtre)', !doc.getElementById('videoProjectBar').hidden
    && select.options.length === 2 && calls.some(c => c[0] === 'list_my_video_captures' && c[1].p_pack_id === null));
  check('projet sans titre : nom de repli (pas de case vide)', select.options[1].textContent.trim().length > 0);
  check('le premier projet s\'ouvre dans l\'atelier, sur son pack et son montage', /^\.\/atelier\.html\?lang=\w+&id=p1&montage=cap1$/.test(frame.getAttribute('src') || '') && !frame.hidden);
  const meta = doc.getElementById('videoProjectMeta');
  check('infos du projet : pack, vidéo d\'origine', meta.textContent.includes('Robot Adventure') && meta.textContent.includes('gameplay.mp4'));
  const chips = meta.querySelectorAll('.video-versioning-chip');
  check('infos du projet : ses versions vidéo, celle déjà rangée en bibliothèque repérée', chips.length === 2 && chips[0].classList.contains('exported') && !chips[1].classList.contains('exported'));

  // Changer de projet.
  select.value = 'cap2'; select.dispatchEvent(new window.Event('change')); await settle(); await settle();
  check('autre projet choisi : l\'atelier s\'ouvre sur lui', /id=p2&montage=cap2$/.test(frame.getAttribute('src') || '')
    && meta.textContent.includes(ev("tr('videoVersioningNoVersion')")));

  // Nouveau projet.
  doc.getElementById('videoProjectNewBtn').click();
  const dlg = doc.getElementById('videoProjectDialog');
  check('« + Nouveau » : dialogue avec le nom et la liste des packs', dlg.hasAttribute('open') && doc.getElementById('videoProjectPack').options.length === 2);
  doc.getElementById('videoProjectForm').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle();
  check('nom obligatoire : rien n\'est créé sans nom', doc.getElementById('videoProjectError').textContent.length > 0 && !calls.some(c => c[0] === 'save_video_capture'));
  doc.getElementById('videoProjectName').value = 'Joris';
  doc.getElementById('videoProjectPack').value = 'p2';
  doc.getElementById('videoProjectForm').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle(); await settle(); await settle();
  const saved = calls.find(c => c[0] === 'save_video_capture');
  check('création : montage vide (nom + pack, sans vidéo ni prise)', !!saved && saved[1].p_title === 'Joris' && saved[1].p_pack_id === 'p2' && saved[1].p_video_filename === null && saved[1].p_events.length === 0);
  check('création : le nouveau projet est sélectionné et ouvert dans l\'atelier (sur son pack)', select.options.length === 3 && select.options[select.selectedIndex].textContent.includes('Joris')
    && new RegExp('id=p2&montage=' + saved[1].p_id + '$').test(frame.getAttribute('src') || '') && !dlg.hasAttribute('open'));

  // Supprimer.
  doc.getElementById('videoProjectDeleteBtn').click(); await settle(); await settle(); await settle();
  check('« Suppr. » : projet supprimé, le suivant est ouvert', calls.some(c => c[0] === 'delete_video_capture' && c[1].p_id === saved[1].p_id) && select.options.length === 2 && /montage=cap1$/.test(frame.getAttribute('src') || ''));

  // Plus aucun projet : invitation à en créer un, pas d'atelier.
  rpcData.list_my_video_captures = [];
  frame.setAttribute('src', 'x');
  await window.eval('initVideoProjects()'); await settle();
  check('aucun projet : message d\'invitation, atelier masqué', !doc.getElementById('videoProjectEmpty').hidden && frame.hidden && !frame.getAttribute('src'));

  // « Créer une version vidéo » (bloc d'un AdReel) : ouvre le projet concerné.
  rpcData.list_my_video_captures = [{ id: 'cap1', packId: 'p1', title: 'Trailer', videoFilename: 'gameplay.mp4', updatedAt: '2026-09-26T10:00:00Z' }];
  await window.eval("openVideoAtelier({ packId: 'p1', montageId: 'cap1' })"); await settle(); await settle();
  check('openVideoAtelier(montage) : onglet Projets vidéo, projet sélectionné', /id=p1&montage=cap1$/.test(frame.getAttribute('src') || '') && !frame.hidden && select.value === 'cap1'
    && doc.querySelector('#panelVideoLibrary .video-subpanel[data-video-subpanel="capture"]').classList.contains('active'));

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
