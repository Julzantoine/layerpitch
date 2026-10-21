// Démarrage de l'atelier vidéo (21/10, décidé par Jules-Antoine : l'outil de capture et de Versioning vit dans le Backstage,
// onglet Vidéo, et dans l'espace studio, onglet Vidéos ; la page publique du pack ne garde que le test public).
//   1. compte connecté obligatoire (sinon : lien vers la connexion) ;
//   2. liste des packs : les siens (compositeur), ou ceux achetés par l'équipe (studio, ?studio=1) ;
//   3. pack choisi (?id=) : ses morceaux, dans le vrai lecteur, avec les boutons ⏺ « armer », puis « Choisir la vidéo ».
// Changer de pack recharge l'atelier sur l'autre pack (rien ne traîne d'un pack à l'autre). Dans un cadre (Backstage, studio), l'atelier
// prévient la page qui l'accueille du pack choisi (message « lp-atelier »), pour qu'elle le retienne.
const atelierParams = new URLSearchParams(location.search);
const atelierAsStudio = atelierParams.get('studio') === '1';
const atelierEmbedded = window.parent !== window;
if (atelierEmbedded) document.body.classList.add('atelier-embedded');

function atelierTell(type, detail) {
  if (!atelierEmbedded) return;
  try { window.parent.postMessage(Object.assign({ source: 'lp-atelier', type }, detail || {}), location.origin); } catch (e) { /* page d'accueil d'une autre origine : rien à dire */ }
}
// Tout enregistrement de l'atelier (montage, version, vidéo, historique) prévient la page hôte (« changed »), pour qu'elle rafraîchisse ses
// listes (bibliothèque, Versioning, bloc vidéo). Un seul point d'écoute : les appels serveur d'écriture du client.
const ATELIER_WRITES = new Set(['save_video_capture', 'delete_video_capture', 'upsert_video', 'delete_video', 'save_video_capture_version',
  'set_video_capture_version_export', 'delete_video_capture_version', 'set_video_capture_export', 'set_video_capture_base', 'restore_video_export', 'clear_video_export_history']);
function atelierWatchWrites() {
  const c = window.LayerPitchSupabaseClient && window.LayerPitchSupabaseClient.getClient();
  if (!c || c.__lpAtelierWatched) return;
  const rpc = c.rpc.bind(c);
  c.rpc = async (name, args) => { const r = await rpc(name, args); if (ATELIER_WRITES.has(name) && r && !r.error) atelierTell('changed'); return r; };
  c.__lpAtelierWatched = true;
}
function atelierEmpty(container, html) { container.innerHTML = `<div class="atelier-empty">${html}</div>`; }

// Packs proposés : les siens (lecture publique de la table packs) ou ceux de l'équipe du studio (my_team_purchases).
async function atelierPackChoices(client) {
  if (atelierAsStudio) {
    const { data } = await client.rpc('my_team_purchases');
    const seen = new Set();
    return (data || []).filter(p => p.packId && !seen.has(p.packId) && seen.add(p.packId))
      .map(p => ({ id: p.packId, title: (p.pack && p.pack.title) || p.packId }));
  }
  const { composerId } = await window.LayerPitchAuth.getMyComposerId();
  if (!composerId) return [];
  const { data } = await client.from('packs').select('id, title, owner_id').eq('owner_id', composerId).order('title');
  return (data || []).filter(p => p.owner_id === composerId).map(p => ({ id: p.id, title: p.title || tr('atelierUntitledPack') }));
}

async function init() {
  const container = document.getElementById('content');
  const packId = atelierParams.get('id');
  window.__lpTrackContext = { type: 'atelier', id: packId, sessionId: null };
  atelierEmpty(container, escapeHtml(tr('atelierLoading')));
  try {
    // Lecture des données publiées (même chargeur que la page pack), puis scripts du compte (connexion, achats).
    await loadPostgresReadScripts();
    await loadPurchaseScripts();
    if (atelierAsStudio) await lpLoadScriptsInOrder(['./api/studio.js']);
    atelierWatchWrites();
    const { session } = await window.LayerPitchAuth.getSession();
    if (!session) {
      atelierEmpty(container, `${escapeHtml(tr('atelierSignIn'))} <a href="./layerpitch-backstage.html" target="_top">${escapeHtml(tr('atelierSignInLink'))}</a>`);
      return;
    }
    const client = window.LayerPitchSupabaseClient.getClient();
    const choices = await atelierPackChoices(client);
    const row = document.getElementById('atelierPackRow');
    const select = document.getElementById('atelierPackSelect');
    if (!choices.length && !packId) {
      atelierEmpty(container, escapeHtml(tr(atelierAsStudio ? 'atelierNoPacksStudio' : 'atelierNoPacks')));
      return;
    }
    // Un pack ouvert par un lien (montage d'un autre compte de l'équipe, pack retiré de la liste…) reste proposé.
    if (packId && !choices.some(c => c.id === packId)) choices.unshift({ id: packId, title: packId });
    select.innerHTML = (packId ? '' : `<option value="">${escapeHtml(tr('atelierPickPack'))}</option>`)
      + choices.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === packId ? 'selected' : ''}>${escapeHtml(c.title)}</option>`).join('');
    row.hidden = false;
    select.addEventListener('change', () => {
      if (!select.value) return;
      const next = new URLSearchParams(location.search);
      next.set('id', select.value);
      next.delete('montage');
      atelierTell('pack', { packId: select.value });
      location.search = next.toString();
    });
    if (!packId) { atelierEmpty(container, escapeHtml(tr('atelierPickPackHint'))); return; }

    // Données publiées du compositeur du pack (le sien, ou celui qui a vendu le pack au studio) : mêmes données que la page publique.
    const { data: packRows } = await client.from('packs').select('id, owner_id').eq('id', packId);
    const owner = (packRows || []).find(p => p.id === packId);
    if (!owner) { atelierEmpty(container, escapeHtml(tr('packNotFound'))); return; }
    lastResolvedOwnerId = owner.owner_id;
    const data = await window.LayerPitchSiteData.loadSiteDataFromPostgres(owner.owner_id);
    const pack = (data.packs || []).find(p => p.id === packId);
    if (!pack) { atelierEmpty(container, escapeHtml(tr('packNotFound'))); return; }
    // Référence pour la capture (trackId/sfxId -> fichier réel, voir exportCaptureVideo) ; composerName : crédit compositeur de l'export.
    const mainAdReel = (data.adReels || []).find(a => a.id === 'main');
    window.__lpCaptureLibrary = {
      library: data.library || [], sfxLibrary: data.sfxLibrary || [], sfxFolders: data.sfxFolders || [],
      composerName: (mainAdReel && mainAdReel.profile && mainAdReel.profile.title) || '',
    };
    window.LayerPlayerCore.setSeqMapDensity('roomy');

    container.innerHTML = `<div class="atelier-pack-name">${escapeHtml(pack.title)}</div>
      <ol class="atelier-steps"><li>${escapeHtml(tr('atelierStepArm'))}</li><li>${escapeHtml(tr('atelierStepVideo'))}</li><li>${escapeHtml(tr('atelierStepPlay'))}</li></ol>`;
    const musicContainer = document.createElement('div');
    musicContainer.className = 'pub-section';
    container.appendChild(musicContainer);
    const libraryById = {};
    (data.library || []).forEach(t => { t.publishedAt = data.publishedAt; libraryById[t.id] = t; });
    const sfxById = {};
    (data.sfxLibrary || []).forEach(s => { s.publishedAt = data.publishedAt; sfxById[s.id] = s; });
    window.LayerPlayerCore.setSfxLibrary(sfxById);
    const packTracks = (pack.trackIds || []).map(id => libraryById[id]).filter(Boolean);
    renderTracksBlock(musicContainer, packTracks, null, data.noAiCertifiedGlobal);
    const packSfx = (pack.sfxIds || []).map(id => sfxById[id]).filter(Boolean);
    if (packSfx.length) {
      const sfxSectionEl = section(tr('sfxSection'), '');
      sfxSectionEl.classList.add('pub-section');
      packSfx.forEach(s => { sfxSectionEl.appendChild(window.LayerPlayerCore.buildSfxPlayer(s)); });
      container.appendChild(sfxSectionEl);
    }
    const open = await setupCaptureTrigger(pack, container, { asStudio: atelierAsStudio });
    // « Choisir la vidéo » juste sous le nom du pack et les étapes, avant les morceaux.
    const chooseBtn = container.querySelector('.video-capture-trigger-btn');
    if (chooseBtn) container.insertBefore(chooseBtn, musicContainer);
    if (!open) {
      const note = document.createElement('div');
      note.className = 'atelier-empty';
      note.textContent = tr(atelierAsStudio ? 'atelierNotAllowedStudio' : 'atelierNotAllowed');
      container.insertBefore(note, container.firstChild);
    }
    atelierTell('ready', { packId });
    startAtelierLessonIfAsked();
  } catch (e) {
    console.error('LayerPitch — atelier vidéo :', e);
    atelierEmpty(container, escapeHtml(tr('loadError')));
  }
}

// Mode tutoriel (?tuto&lesson=versioning) : la partie « atelier » de la leçon Versioning, guidée dans ce cadre (atelier-lecons.js) ; la
// page qui l'accueille (Backstage en mode tutoriel) reprend la main à la fin (message « lp-atelier » / lessonDone).
let atelierLessonStarted = false;
function startAtelierLessonIfAsked() {
  if (!atelierParams.has('tuto') || atelierLessonStarted || !window.LayerPitchAtelierLessons || !window.LayerPitchGuide) return;
  atelierLessonStarted = true;
  if (!atelierEmbedded) {
    const bar = document.createElement('div');
    bar.className = 'preview-mode-banner';
    bar.textContent = tr('tutoBannerText');
    document.body.prepend(bar);
    document.body.classList.add('has-preview-banner');
  }
  if (atelierParams.get('lesson') === 'versioning') {
    setTimeout(() => window.LayerPitchAtelierLessons.init({ lang: currentLang(), onDone: () => atelierTell('lessonDone') }).start(), 600);
  }
}

window.addEventListener('load', init);
