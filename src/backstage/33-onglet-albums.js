/* ---------------- Onglet Albums : vente d'Adaptive OST (21 septembre) ----------------
 * Volontairement autonome (pas branché sur l'état `packs`/`publishAll()`) : un album s'enregistre
 * directement en base par la RPC upsert_album (api/albums.js), pas via la publication GitHub que
 * Jules-Antoine prévoit de quitter. Conséquence assumée : un album ne peut contenir que des morceaux
 * DÉJÀ publiés en base (les morceaux n'y arrivent qu'à la publication) -- d'où l'indice
 * albumTracksNotPublishedHint quand l'enregistrement est refusé pour cette raison.
 * Bêta : le paiement n'est pas branché, « Obtenir (test) » (claim_test_album) simule l'achat.
 * Vendeur compositeur seulement ici (décision du 21 septembre : le côté studio reste à concevoir). */
const albumsState = { loaded: false, loading: false, albums: [], purchases: [], testEnabled: false, messages: {},
  recorder: null,   // enregistreur de version du compositeur ouvert : { albumId, trackId, el } (un seul à la fois)
  playback: null }; // version du compositeur en écoute : { key, ctrl }

function newAlbumId() {
  // Identifiant aléatoire : albums.id est unique sur TOUTE la base (pas par compositeur), un titre
  // slugifié risquerait de collisionner avec l'album d'un autre compositeur.
  const rand = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12);
  return 'alb_' + rand;
}

function albumFromApi(a) {
  return {
    id: a.id, title: a.title || '', presentationFr: a.presentationFr || '', presentationEn: a.presentationEn || '',
    priceInput: a.priceEurCents == null ? '' : (a.priceEurCents / 100).toFixed(2),
    buyable: !!a.buyable, trackIds: a.trackIds || [], saved: true, savedBuyable: !!a.buyable,
    // Morceaux enregistrés en base (seuls eux peuvent recevoir une version du compositeur) et durée de leur version.
    savedTrackIds: (a.trackIds || []).slice(), officialDurations: Object.assign({}, a.officialDurations || {}),
    illustration: a.illustration || null, illustrationOriginalName: a.illustrationOriginalName || null, pendingCover: null, pendingCoverUrl: null,
  };
}

async function loadAlbums() {
  if (albumsState.loaded || albumsState.loading) return;
  const box = document.getElementById('albumsContainer');
  albumsState.loading = true;
  box.innerHTML = `<div class="sub">${tr('albumsLoading')}</div>`;
  try {
    await loadPostgresReadScripts();
    const { session } = await window.LayerPitchAuth.getSession();
    if (!session || !session.user) throw new Error(tr('albumsNoSession'));
    const A = window.LayerPitchAlbums;
    const [al, pu, fl] = await Promise.all([A.listAlbums({ sellerId: session.user.id }), A.listMyPurchases(), A.getPlatformFlags()]);
    if (al.error) throw new Error(al.error);
    // Les brouillons pas encore enregistrés (+ Album cliqué avant la fin du chargement) sont gardés.
    const drafts = albumsState.albums.filter(x => !x.saved);
    albumsState.albums = al.albums.map(albumFromApi).concat(drafts);
    albumsState.purchases = pu.purchases || [];
    albumsState.testEnabled = !!(fl.flags && fl.flags.testPurchasesEnabled);
    albumsState.loaded = true;
    renderAlbums();
    renderAlbumsLibrary();
  } catch (e) {
    box.innerHTML = `<div class="sub" style="color:#c0392b">${escapeHtml(tr('albumsLoadError', { error: e.message }))}</div>`;
  } finally {
    albumsState.loading = false;
  }
}

function renderAlbums() {
  const box = document.getElementById('albumsContainer');
  box.innerHTML = '';
  if (!albumsState.albums.length) { box.innerHTML = `<div class="sub">${tr('albumsEmpty')}</div>`; return; }
  const rowStyle = 'display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--text-dim);';
  albumsState.albums.forEach((al, ai) => {
    const libIds = new Set(library.map(t => t.id));
    const trackRows = library.map(t => {
      const pos = al.trackIds.indexOf(t.id);
      return `<label style="${rowStyle}"><input type="checkbox" style="width:auto;margin:0" data-album-track="${escapeAttr(t.id)}" data-ai="${ai}"${pos >= 0 ? ' checked' : ''}><span>${pos >= 0 ? (pos + 1) + '. ' : ''}${escapeHtml(t.title || t.id)}</span></label>`;
    });
    // Piste de l'album absente de la bibliothèque locale (ex. supprimée) : on la montre quand même,
    // décochable, plutôt que de la perdre en silence au prochain enregistrement.
    al.trackIds.filter(id => !libIds.has(id)).forEach(id => {
      trackRows.push(`<label style="${rowStyle}"><input type="checkbox" style="width:auto;margin:0" data-album-track="${escapeAttr(id)}" data-ai="${ai}" checked><span>${al.trackIds.indexOf(id) + 1}. ${escapeHtml(id)}</span></label>`);
    });
    const msg = albumsState.messages[al.id];
    const canClaim = albumsState.testEnabled && al.saved && al.savedBuyable;
    const el = document.createElement('div');
    el.className = 'list-block';
    el.innerHTML = `
      <div class="list-block-head">
        <div class="list-block-head-left">
          <input type="text" class="seq-header-title" data-album-field="title" data-ai="${ai}" value="${escapeAttr(al.title)}" placeholder="${escapeAttr(tr('albumFallback', { n: ai + 1 }))}">
          ${al.saved ? '' : `<span class="badge">${tr('albumUnsavedBadge')}</span>`}
        </div>
      </div>
      <div class="list-block-body">
        <label>${tr('albumPresentationFrLabel')}</label>
        <textarea data-album-field="presentationFr" data-ai="${ai}">${escapeHtml(al.presentationFr)}</textarea>
        <label>${tr('albumPresentationEnLabel')}</label>
        <textarea data-album-field="presentationEn" data-ai="${ai}">${escapeHtml(al.presentationEn)}</textarea>
        <label>${tr('albumCoverLabel')}</label>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${al.pendingCoverUrl || al.illustration
            ? `<img src="${escapeAttr(al.pendingCoverUrl || (MEDIA_BASE + 'images/' + al.illustration))}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`
            : `<div style="width:72px;height:72px;border-radius:6px;border:1px dashed var(--border)"></div>`}
          <div data-role="albumCoverCtrl" data-ai="${ai}"></div>
        </div>
        <div class="sub" style="margin-top:4px">${tr('albumCoverHint')}</div>
        <label>${tr('albumMinPriceLabel')}</label>
        <input type="text" inputmode="decimal" data-album-field="priceInput" data-ai="${ai}" value="${escapeAttr(al.priceInput)}" placeholder="3.00" style="max-width:140px">
        <div class="sub" style="margin-top:4px">${tr('albumMinPriceHint')}</div>
        <label style="${rowStyle}margin-top:12px"><input type="checkbox" style="width:auto;margin:0" data-album-field="buyable" data-ai="${ai}"${al.buyable ? ' checked' : ''}><span>${tr('albumBuyableLabel')}</span></label>
        <label>${tr('albumTracksLabel')}</label>
        ${trackRows.length ? trackRows.join('') : `<div class="sub">${tr('albumNoTracksInLibrary')}</div>`}
        ${renderAlbumOfficialVersions(al, ai)}
        <div class="actions" style="margin-top:14px">
          <button class="btn btn-small btn-primary" data-action="save-album" data-ai="${ai}" type="button">${tr('albumSaveBtn')}</button>
          ${canClaim ? `<button class="btn btn-small" data-action="claim-test-album" data-ai="${ai}" type="button">${tr('albumClaimTestBtn')}</button>` : ''}
        </div>
        ${msg ? `<div class="sub" style="margin-top:8px;${msg.kind === 'error' ? 'color:#c0392b' : 'color:#2e8b57'}">${escapeHtml(msg.text)}</div>` : ''}
      </div>`;
    box.appendChild(el);
    // Pochette (A.9, 27/09) : choisie ici, envoyée à l'enregistrement de l'album (saveAlbum), comme les autres champs.
    const coverCtrl = el.querySelector('[data-role="albumCoverCtrl"]');
    coverCtrl.innerHTML = fileCtrlHtml(tr('chooseIllustration'));
    wireFileControl(coverCtrl, 'image/*', () => al.pendingCover, () => al.illustration, f => {
      if (al.pendingCoverUrl) URL.revokeObjectURL(al.pendingCoverUrl);
      al.pendingCover = f || null;
      al.pendingCoverUrl = f ? URL.createObjectURL(f) : null;
      renderAlbums();
    }, () => al.illustrationOriginalName);
  });
  // L'enregistreur ouvert (lecteur vivant) survit aux re-rendus : on replace son nœud, sans le reconstruire.
  const rec = albumsState.recorder;
  if (rec) {
    const host = [...box.querySelectorAll('[data-official-host]')].find(h => h.dataset.officialHost === rec.albumId + '|' + rec.trackId);
    if (host) host.appendChild(rec.el); else closeOfficialRecorder();
  }
}

// ---- Version du compositeur de chaque morceau (Adaptive OST, étape A.7, 26/09) ----
// C'est une PRISE du vendeur (journal du lecteur, comme les versions du fan), rangée dans album_tracks.default_settings
// (set_album_track_default_settings). Obligatoire pour chaque morceau avant la mise en vente (contrôle serveur dans
// upsert_album, migration 20260926020000 ; contrôle client dans saveAlbum pour un message clair).
const fmtAlbumDuration = sec => { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
function albumTrackTitle(id) { const t = library.find(x => x.id === id); return (t && t.title) || id; }
function renderAlbumOfficialVersions(al, ai) {
  const head = `<label style="margin-top:16px">${tr('albumOfficialTitle')}</label><div class="sub" style="margin-bottom:4px">${tr('albumOfficialHint')}</div>`;
  if (!al.saved || !al.savedTrackIds.length) return head + `<div class="sub">${tr('albumOfficialSaveFirst')}</div>`;
  const rowStyle = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--text-dim);';
  const pending = al.trackIds.join('|') !== al.savedTrackIds.join('|');
  return head + al.savedTrackIds.map(id => {
    const has = Object.prototype.hasOwnProperty.call(al.officialDurations, id);
    const key = al.id + '|' + id;
    const playing = albumsState.playback && albumsState.playback.key === key;
    return `<div style="${rowStyle}">
        <span style="min-width:0;flex:1 1 160px;color:var(--text)">${escapeHtml(albumTrackTitle(id))}</span>
        ${has ? `<span>✓ ${fmtAlbumDuration(al.officialDurations[id])}</span>` : `<span class="badge" style="color:#c0392b;border-color:#c0392b">${tr('albumOfficialMissing')}</span>`}
        ${has ? `<button class="btn btn-small" type="button" data-action="official-play" data-ai="${ai}" data-track="${escapeAttr(id)}">${tr(playing ? 'albumOfficialStopBtn' : 'albumOfficialListenBtn')}</button>` : ''}
        <button class="btn btn-small${has ? '' : ' btn-primary'}" type="button" data-action="official-record" data-ai="${ai}" data-track="${escapeAttr(id)}">${tr(has ? 'albumOfficialRedoBtn' : 'albumOfficialRecordBtn')}</button>
      </div>
      <div data-official-host="${escapeAttr(key)}"></div>`;
  }).join('') + (pending ? `<div class="sub" style="margin-top:6px">${tr('albumOfficialSaveFirst')}</div>` : '');
}

// capture-render.js (lecture d'une prise) n'est chargé qu'à la première écoute, avec le numéro de version de la page.
let captureRenderLoaded = null;
function loadCaptureRenderScript() {
  if (window.LayerCaptureRender) return Promise.resolve();
  if (captureRenderLoaded) return captureRenderLoaded;
  const v = (document.querySelector('script[src*="layerpitch-i18n.js?v="]') || {}).src;
  const version = v ? new URL(v).searchParams.get('v') : '';
  captureRenderLoaded = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = './capture-render.js' + (version ? '?v=' + version : '');
    sc.onload = resolve;
    sc.onerror = () => { captureRenderLoaded = null; reject(new Error('Échec du chargement de ' + sc.src)); };
    document.head.appendChild(sc);
  });
  return captureRenderLoaded;
}
function stopOfficialPlayback() {
  const pb = albumsState.playback;
  if (pb) { albumsState.playback = null; if (pb.ctrl) pb.ctrl.stop(); }
}
async function toggleOfficialPlayback(ai, trackId) {
  const al = albumsState.albums[ai];
  const key = al.id + '|' + trackId;
  const wasThis = albumsState.playback && albumsState.playback.key === key;
  stopOfficialPlayback();
  if (wasThis) { renderAlbums(); return; }
  // Une seule chose joue à la fois : enregistreur et aperçus « Écouter » s'arrêtent.
  if (albumsState.recorder) document.dispatchEvent(new CustomEvent('stop-track', { detail: albumsState.recorder.trackId }));
  activePreviewIds.forEach(id => document.dispatchEvent(new CustomEvent('stop-track', { detail: id })));
  const pb = { key, ctrl: null };
  albumsState.playback = pb;
  renderAlbums();
  try {
    await loadCaptureRenderScript();
    const { take, error } = await window.LayerPitchAlbums.getAlbumTrackOfficialTake(al.id, trackId);
    if (error || !take) throw new Error(error || tr('albumOfficialMissing'));
    const fetchBytes = async url => new Uint8Array(await (await fetch(url)).arrayBuffer());
    const ctrl = await window.LayerCaptureRender.playTake(take, { fetchBytes, onEnd: () => { if (albumsState.playback === pb) { albumsState.playback = null; renderAlbums(); } } });
    if (albumsState.playback !== pb) { ctrl.stop(); return; }
    pb.ctrl = ctrl;
  } catch (e) {
    if (albumsState.playback === pb) albumsState.playback = null;
    setAlbumMessage(al, tr('albumOfficialError', { error: e.message }), 'error');
  }
}
function closeOfficialRecorder() {
  const rec = albumsState.recorder;
  if (!rec) return;
  albumsState.recorder = null;
  document.dispatchEvent(new CustomEvent('stop-track', { detail: rec.trackId }));
  rec.el.remove();
}
// Enregistreur : la version PUBLIÉE du morceau (celle que le fan recevra), jouée dans le lecteur habituel, journal de
// prise actif ; « Enregistrer comme version de l'album » garde tout ce qui a été joué depuis le lancement.
async function openOfficialRecorder(ai, trackId) {
  const al = albumsState.albums[ai];
  closeOfficialRecorder();
  stopOfficialPlayback();
  const P = window.LayerPlayerCore;
  const el = document.createElement('div');
  el.style.cssText = 'margin:8px 0 12px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)';
  el.innerHTML = `<div class="sub">${tr('albumOfficialLoading')}</div>`;
  const rec = { albumId: al.id, trackId, el };
  albumsState.recorder = rec;
  renderAlbums();
  try {
    await loadPostgresReadScripts();
    const r = await window.LayerPitchTracks.getTrack(trackId);
    if (!r || !r.track) throw new Error(tr('albumOfficialUnpublished'));
    const track = r.track;
    const sfxById = {};
    for (const sid of (track.sfxIds || [])) { const x = await window.LayerPitchSfx.getSfx(sid); if (x && x.sfx) sfxById[sid] = x.sfx; }
    if (albumsState.recorder !== rec) return;
    activePreviewIds.forEach(id => document.dispatchEvent(new CustomEvent('stop-track', { detail: id })));
    P.setSfxLibrary(sfxById);
    P.setTakeRecording(true);
    el.innerHTML = `<div class="sub" style="margin-bottom:8px">${tr('albumOfficialRecorderHint')}</div><div data-role="recPlayer"></div>
      <div class="actions" style="margin-top:10px">
        <button class="btn btn-small btn-primary" type="button" data-role="recSave">${tr('albumOfficialSaveBtn')}</button>
        <button class="btn btn-small" type="button" data-role="recClose">${tr('albumOfficialCloseBtn')}</button>
      </div>
      <div class="sub" data-role="recMsg" style="margin-top:6px"></div>`;
    const row = P.buildTrackRow(track, null, false);
    el.querySelector('[data-role="recPlayer"]').appendChild(row);
    P.initTrackPlayer(track, row);
    const titleToggle = row.querySelector('[data-role="titleToggle"]');
    if (titleToggle) titleToggle.click();
    const say = text => { el.querySelector('[data-role="recMsg"]').textContent = text; };
    el.querySelector('[data-role="recClose"]').onclick = () => closeOfficialRecorder();
    el.querySelector('[data-role="recSave"]').onclick = async e => {
      const take = P.getTrackTake(trackId);
      if (!take || !take.voices.length) { say(tr('albumOfficialNothing')); return; }
      if (take.missing) { say(tr('albumOfficialUnpublished')); return; }
      e.target.disabled = true;
      try {
        const res = await window.LayerPitchAlbums.setAlbumTrackOfficialTake(al.id, trackId, take);
        if (!res.ok) throw new Error(res.error);
        al.officialDurations[trackId] = take.duration;
        say(tr('albumOfficialSaved', { duration: fmtAlbumDuration(take.duration) }));
        renderAlbums();
      } catch (err) { say(tr('albumOfficialError', { error: err.message })); }
      finally { e.target.disabled = false; }
    };
  } catch (e) {
    el.innerHTML = `<div class="sub" style="color:#c0392b">${escapeHtml(tr('albumOfficialError', { error: e.message }))}</div>`;
  }
}
// Le lecteur de l'enregistreur démarre : une version du compositeur en écoute s'arrête.
document.addEventListener('layerpitch-capture-mark', e => {
  if (e.detail && e.detail.name === 'track_play' && albumsState.playback) { stopOfficialPlayback(); renderAlbums(); }
});

function renderAlbumsLibrary() {
  const box = document.getElementById('albumsLibraryContainer');
  const fanLink = document.getElementById('albumsOpenFanPage'); // page fan (mes-albums.html), dans la langue du Backstage
  if (fanLink) fanLink.href = 'mes-albums.html' + (currentLang() === 'en' ? '?lang=en' : '');
  if (!albumsState.purchases.length) { box.innerHTML = `<div class="sub">${tr('albumsLibraryEmpty')}</div>`; return; }
  box.innerHTML = albumsState.purchases.map(p =>
    `<div style="${'display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--text-dim);'}">
      <span>${escapeHtml(p.title || p.albumId)}</span>
      ${p.isTest ? `<span class="badge">${tr('albumTestBadge')}</span>` : ''}
      <span style="color:var(--text-dimmer)">${escapeHtml(new Date(p.purchasedAt).toLocaleDateString(currentLang()))}</span>
    </div>`).join('');
}

function setAlbumMessage(al, text, kind) {
  albumsState.messages[al.id] = { text, kind };
  renderAlbums();
}

async function saveAlbum(ai) {
  const al = albumsState.albums[ai];
  // Prix saisi en dollars (« 3.5 », « 3,50 »), envoyé en centimes. Vide = pas de prix (refusé si en vente).
  const raw = al.priceInput.trim().replace(',', '.');
  let cents = null;
  if (raw !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { setAlbumMessage(al, tr('albumPriceInvalid'), 'error'); return; }
    cents = Math.round(n * 100);
  }
  if (al.buyable && cents === null) { setAlbumMessage(al, tr('albumSellingNeedsPrice'), 'error'); return; }
  // Mise en vente : chaque morceau doit avoir sa version du compositeur (même règle côté serveur).
  if (al.buyable) {
    if (!al.trackIds.length) { setAlbumMessage(al, tr('albumSellingNeedsTracks'), 'error'); return; }
    const missing = al.trackIds.filter(id => !Object.prototype.hasOwnProperty.call(al.officialDurations || {}, id));
    if (missing.length) { setAlbumMessage(al, tr('albumSellingNeedsVersions', { tracks: missing.map(albumTrackTitle).join(', ') }), 'error'); return; }
  }
  setAlbumMessage(al, tr('albumSaving'), 'info');
  try {
    await loadPostgresReadScripts();
    // Nouvelle pochette : envoyée d'abord (images/<id du compositeur>/album-<id>.<ext>, dossier du compositeur comme
    // toutes les images, voir publishAll), puis enregistrée avec l'album.
    let cover = null;
    if (al.pendingCover) {
      const { composerId, error: composerError } = await window.LayerPitchAuth.ensureMyComposerProfile();
      if (composerError || !composerId) throw new Error(composerError || 'aucun profil compositeur');
      const fileName = `${composerId}/album-${al.id}.${extOf(al.pendingCover.name)}`;
      await r2PutFile(`images/${fileName}`, new Uint8Array(await al.pendingCover.arrayBuffer()), imageContentType(extOf(fileName)));
      cover = { illustration: fileName, illustrationOriginalName: al.pendingCover.name };
    }
    const { ok, error, data: saved } = await window.LayerPitchAlbums.upsertAlbum({
      id: al.id, title: al.title, presentationFr: al.presentationFr, presentationEn: al.presentationEn,
      priceEurCents: cents, buyable: al.buyable, trackIds: al.trackIds,
      ...(cover || {}),
    });
    if (!ok) {
      const hint = /pistes/i.test(error || '') ? ' ' + tr('albumTracksNotPublishedHint') : '';
      setAlbumMessage(al, tr('albumSaveError', { error }) + hint, 'error');
      return;
    }
    al.saved = true;
    al.savedBuyable = al.buyable;
    if (cover) {
      Object.assign(al, cover);
      if (al.pendingCoverUrl) URL.revokeObjectURL(al.pendingCoverUrl);
      al.pendingCover = null; al.pendingCoverUrl = null;
    }
    // Morceaux décochés d'un album déjà obtenu : gardés pour ceux qui l'ont (27/09) -- on le dit au compositeur.
    const kept = (saved && saved.keptForBuyers) || [];
    const savedMessage = kept.length ? tr('albumSaved') + ' ' + tr('albumTracksKeptForBuyers', { tracks: kept.map(albumTrackTitle).join(', ') }) : tr('albumSaved');
    al.savedTrackIds = al.trackIds.slice();
    // Un morceau retiré de l'album perd sa version (la ligne album_tracks est supprimée côté serveur).
    Object.keys(al.officialDurations || {}).forEach(id => { if (!al.trackIds.includes(id)) delete al.officialDurations[id]; });
    setAlbumMessage(al, savedMessage, 'ok');
  } catch (e) {
    setAlbumMessage(al, tr('albumSaveError', { error: e.message }), 'error');
  }
}

async function claimTestAlbumFromUi(ai) {
  const al = albumsState.albums[ai];
  try {
    const { ok, error, alreadyOwned } = await window.LayerPitchAlbums.claimTestAlbum(al.id);
    if (!ok) { setAlbumMessage(al, tr('albumClaimError', { error }), 'error'); return; }
    const pu = await window.LayerPitchAlbums.listMyPurchases();
    if (pu.purchases) albumsState.purchases = pu.purchases;
    renderAlbumsLibrary();
    setAlbumMessage(al, tr(alreadyOwned ? 'albumAlreadyOwned' : 'albumClaimed'), 'ok');
  } catch (e) {
    setAlbumMessage(al, tr('albumClaimError', { error: e.message }), 'error');
  }
}

(function wireAlbumsPanel() {
  const box = document.getElementById('albumsContainer');
  // Saisie : on met à jour l'état sans re-rendre (sinon le champ perdrait le focus à chaque frappe).
  box.addEventListener('input', e => {
    const field = e.target.dataset.albumField;
    if (!field || field === 'buyable') return;
    albumsState.albums[Number(e.target.dataset.ai)][field] = e.target.value;
  });
  box.addEventListener('change', e => {
    const ai = Number(e.target.dataset.ai);
    if (e.target.dataset.albumField === 'buyable') {
      albumsState.albums[ai].buyable = e.target.checked;
    } else if (e.target.dataset.albumTrack) {
      const al = albumsState.albums[ai];
      const id = e.target.dataset.albumTrack;
      al.trackIds = e.target.checked ? al.trackIds.concat(id) : al.trackIds.filter(t => t !== id);
      renderAlbums(); // les numéros d'ordre (1., 2., …) suivent l'ordre de cochage
    }
  });
  box.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const ai = Number(btn.dataset.ai);
    if (btn.dataset.action === 'save-album') saveAlbum(ai);
    if (btn.dataset.action === 'claim-test-album') claimTestAlbumFromUi(ai);
    if (btn.dataset.action === 'official-record') openOfficialRecorder(ai, btn.dataset.track);
    if (btn.dataset.action === 'official-play') toggleOfficialPlayback(ai, btn.dataset.track);
  });
  document.getElementById('btnAddAlbum').addEventListener('click', () => {
    albumsState.albums.push({ id: newAlbumId(), title: '', presentationFr: '', presentationEn: '', priceInput: '', buyable: false, trackIds: [], saved: false, savedBuyable: false, savedTrackIds: [], officialDurations: {}, illustration: null, illustrationOriginalName: null, pendingCover: null, pendingCoverUrl: null });
    renderAlbums();
  });
})();

async function loadAnalyticsIfNeeded() {
  renderAnalyticsPresets();
  if (analyticsOverview && analyticsLoadedForTier === currentEffectivePlan) { renderAnalyticsView(); return; }
  await loadAnalyticsDashboard();
}

async function loadAnalyticsDashboard() {
  const loadingEl = document.getElementById('analyticsLoading');
  const errorEl = document.getElementById('analyticsError');
  if (loadingEl) loadingEl.hidden = false;
  if (errorEl) errorEl.hidden = true;
  await loadPostgresReadScripts();
  const { overview, error } = await window.LayerPitchAnalytics.getMyAnalyticsOverview(analyticsRange());
  if (loadingEl) loadingEl.hidden = true;
  if (error) {
    if (errorEl) { errorEl.hidden = false; errorEl.textContent = tr('analyticsErrorPrefix') + ' ' + error; }
    return;
  }
  const lockedEl = document.getElementById('analyticsLocked');
  const unlockedEl = document.getElementById('analyticsUnlocked');
  if (overview.locked) { if (lockedEl) lockedEl.hidden = false; if (unlockedEl) unlockedEl.hidden = true; return; }
  analyticsOverview = overview;
  analyticsLoadedForTier = currentEffectivePlan;
  analyticsRawLoadedForTier = null; // la liste brute dépend aussi de la période : à recharger si ouverte
  const rawDetails = document.getElementById('analyticsRawDetails');
  if (rawDetails && rawDetails.open) loadAnalyticsRawSessions();
  if (analyticsSelected) await openAnalyticsEntity(analyticsSelected.type, analyticsSelected.id);
  else renderAnalyticsView();
}

function analyticsFormatBucket(iso, bucket) {
  if (!iso) return '';
  const d = new Date(iso);
  const loc = currentLang() === 'en' ? 'en-GB' : 'fr-FR';
  if (bucket === 'hour') return d.toLocaleString(loc, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (bucket === 'month') return d.toLocaleDateString(loc, { month: 'short', year: 'numeric' });
  return d.toLocaleDateString(loc, { day: '2-digit', month: 'short' });
}

// Courbe avec axe des ordonnées (0 / moitié / max), grille et valeur exacte de chaque point au
// survol -- même construction que le panneau admin (admin.html), dupliquée ici faute de module
// commun. compact = mini-courbe sans axes (colonne "Tendance" de la liste).
function analyticsBuildChart(values, buckets, bucket, opts) {
  opts = opts || {};
  const n = values.length;
  if (!n) return '';
  const top = Math.max(...values, 1);
  const niceMax = top > 1 && top % 2 === 1 ? top + 1 : top;
  const ticks = niceMax >= 2 ? [niceMax, niceMax / 2, 0] : [niceMax, 0];
  const xPct = i => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const yPct = v => (1 - v / niceMax) * 100;
  const pts = values.map((v, i) => [xPct(i), yPct(v)]);
  const linePath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
  const areaPath = linePath + ` L${pts[n - 1][0].toFixed(2)},100 L${pts[0][0].toFixed(2)},100 Z`;
  const svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="none">
      ${opts.compact ? '' : ticks.map(t => `<line x1="0" x2="100" y1="${yPct(t).toFixed(2)}" y2="${yPct(t).toFixed(2)}" stroke="#e2e2e6" stroke-width="1" vector-effect="non-scaling-stroke" />`).join('')}
      <path d="${areaPath}" fill="#e6eef8" stroke="none" />
      <path d="${linePath}" fill="none" stroke="#2f80c0" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>`;
  if (opts.compact) return `<div class="an-spark">${svg}</div>`;
  const dots = values.map((v, i) => `<span class="an-dot" style="left:${pts[i][0].toFixed(2)}%;top:${pts[i][1].toFixed(2)}%"${opts.blur ? '' : ` title="${escapeHtml(analyticsFormatBucket(buckets[i], bucket))} : ${v}"`}></span>`).join('');
  const yLabels = ticks.map(t => `<span${opts.blur ? ' class="an-blur"' : ''} style="top:${yPct(t).toFixed(2)}%">${t}</span>`).join('');
  const mid = n > 2 ? buckets[Math.floor((n - 1) / 2)] : null;
  return `<div class="an-chart" style="height:${opts.height || 120}px"><div class="an-yaxis">${yLabels}</div><div class="an-plot">${svg}${dots}</div></div>
    <div class="an-xaxis"><span>${escapeHtml(analyticsFormatBucket(buckets[0], bucket))}</span>${mid ? `<span>${escapeHtml(analyticsFormatBucket(mid, bucket))}</span>` : ''}<span>${escapeHtml(analyticsFormatBucket(buckets[n - 1], bucket))}</span></div>`;
}

function analyticsTypeLabel(type) {
  return tr(type === 'pack' ? 'analyticsTypePack' : (type === 'collection' ? 'analyticsTypeCollection' : 'analyticsTypeAdreel'));
}
function analyticsBlur(txt) { return `<span class="an-blur" aria-hidden="true">${txt}</span>`; }
function analyticsKpi(label, value) {
  return `<div class="an-kpi"><div class="an-kpi-n">${value}</div><div class="an-kpi-l">${escapeHtml(label)}</div></div>`;
}
function analyticsLockedBadge() { return `<span class="an-lock" title="${escapeHtml(tr('analyticsProLocked'))}">🔒 Pro</span>`; }
function analyticsPct(part, total) { return total > 0 ? Math.round(100 * part / total) + ' %' : '—'; }

function renderAnalyticsView() {
  const overviewEl = document.getElementById('analyticsOverview');
  const entityEl = document.getElementById('analyticsEntityDetail');
  const emptyEl = document.getElementById('analyticsEmpty');
  const metaEl = document.getElementById('analyticsMeta');
  if (!overviewEl || !entityEl || !analyticsOverview) return;
  if (analyticsSelected && analyticsEntityData) { overviewEl.hidden = true; entityEl.hidden = false; return; }
  entityEl.hidden = true; overviewEl.hidden = false;
  const o = analyticsOverview;
  const isPro = o.tier === 'pro';
  const isFree = o.tier === 'free';
  if (metaEl) metaEl.textContent = tr('analyticsWindowNote', {
    from: analyticsFormatBucket(o.windowStart, 'day'), to: analyticsFormatBucket(o.windowEnd, 'day'), days: o.retentionDays,
  });
  const hasData = isFree ? (o.entities || []).length > 0 : o.totals.visits > 0;
  const rawEl = document.getElementById('analyticsRawDetails');
  if (rawEl) rawEl.hidden = isFree; // la liste détaillée des visites n'existe pas en aperçu
  if (emptyEl) emptyEl.hidden = hasData;
  const kpis = [
    analyticsKpi(tr('analyticsKpiVisits'), isFree ? analyticsBlur('128') : o.totals.visits),
    analyticsKpi(tr('analyticsKpiPlays'), isFree ? analyticsBlur('347') : (isPro ? o.totals.plays : analyticsLockedBadge())),
    analyticsKpi(tr('analyticsKpiMobile'), isFree ? analyticsBlur('64 %') : (o.totals.mobileShare == null ? '—' : o.totals.mobileShare + ' %')),
    analyticsKpi(tr('analyticsKpiItems'), isFree ? analyticsBlur('5') : o.totals.items),
  ].join('');
  const teaserBanner = isFree ? `<div class="an-teaser-banner"><span>🔒 ${escapeHtml(tr('analyticsFreeBanner'))}</span> <a class="btn btn-small" href="mon-compte.html" target="_blank" rel="noopener">${escapeHtml(tr('analyticsUpgradeCta'))}</a></div>` : '';
  const chartVisits = `<div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsChartVisits'))}</div>${analyticsBuildChart(o.series.visits || [], o.buckets, o.bucket, { blur: isFree })}</div>`;
  const chartPlays = `<div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsChartPlays'))}</div>${isPro
    ? analyticsBuildChart(o.series.plays || [], o.buckets, o.bucket)
    : `<div class="an-locked-box">${analyticsLockedBadge()}</div>`}</div>`;
  const rows = (o.entities || []).map(e => `
    <tr class="an-row${isFree ? ' teaser' : ''}" data-type="${escapeHtml(e.type)}" data-id="${escapeHtml(e.id)}"${isFree ? '' : ' tabindex="0"'}>
      <td>${escapeHtml(e.name)}</td>
      <td><span class="an-type">${escapeHtml(analyticsTypeLabel(e.type))}</span></td>
      <td>${isFree ? analyticsBlur('42') : e.visits}</td>
      <td>${isFree ? analyticsBlur('97') : (isPro ? e.plays : analyticsLockedBadge())}</td>
      <td>${isFree ? analyticsBlur('12/09/2026') : (e.lastVisit ? escapeHtml(new Date(e.lastVisit).toLocaleDateString(currentLang() === 'en' ? 'en-GB' : 'fr-FR')) : '—')}</td>
      <td class="an-trend">${analyticsBuildChart(e.series || [], o.buckets, o.bucket, { compact: true })}</td>
    </tr>`).join('');
  overviewEl.innerHTML = `
    ${teaserBanner}
    <div class="an-kpis">${kpis}</div>
    <div class="an-charts">${chartVisits}${chartPlays}</div>
    <div class="an-card">
      <div class="an-card-title">${escapeHtml(tr('analyticsItemsTitle'))} ${isFree ? '' : `<span class="hint">${escapeHtml(tr('analyticsItemsHint'))}</span>`}</div>
      ${hasData ? `<table class="an-table"><thead><tr>
        <th>${escapeHtml(tr('analyticsColName'))}</th><th>${escapeHtml(tr('analyticsColType'))}</th>
        <th>${escapeHtml(tr('analyticsColVisits'))}</th><th>${escapeHtml(tr('analyticsColPlays'))}</th>
        <th>${escapeHtml(tr('analyticsColLast'))}</th><th>${escapeHtml(tr('analyticsColTrend'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>` : `<div class="hint">${escapeHtml(tr('analyticsNoItems'))}</div>`}
    </div>`;
  if (isFree) return; // aperçu : lignes non cliquables (le détail est verrouillé côté serveur)
  overviewEl.querySelectorAll('.an-row').forEach(row => {
    const open = () => openAnalyticsEntity(row.dataset.type, row.dataset.id);
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

async function openAnalyticsEntity(type, id) {
  const errorEl = document.getElementById('analyticsError');
  const loadingEl = document.getElementById('analyticsLoading');
  if (loadingEl) loadingEl.hidden = false;
  if (errorEl) errorEl.hidden = true;
  await loadPostgresReadScripts();
  const { entity, error } = await window.LayerPitchAnalytics.getMyAnalyticsEntity(type, id, analyticsRange());
  if (loadingEl) loadingEl.hidden = true;
  if (error || !entity) {
    if (errorEl) { errorEl.hidden = false; errorEl.textContent = tr('analyticsErrorPrefix') + ' ' + (error || ''); }
    return;
  }
  analyticsSelected = { type, id };
  analyticsEntityData = entity;
  renderAnalyticsEntity();
}

function renderAnalyticsEntity() {
  const overviewEl = document.getElementById('analyticsOverview');
  const entityEl = document.getElementById('analyticsEntityDetail');
  const e = analyticsEntityData;
  if (!overviewEl || !entityEl || !e) return;
  const isPro = e.tier === 'pro';
  const t = e.totals;
  const known = t.mobile + t.desktop;
  const kpis = [
    analyticsKpi(tr('analyticsKpiVisits'), t.visits),
    analyticsKpi(tr('analyticsKpiPlays'), isPro ? t.plays : analyticsLockedBadge()),
    analyticsKpi(tr('analyticsKpiMobile'), analyticsPct(t.mobile, known)),
  ].join('');
  const devices = `<div class="an-devices">
      <span>${escapeHtml(tr('analyticsDeviceMobile'))} <strong>${t.mobile}</strong></span>
      <span>${escapeHtml(tr('analyticsDeviceDesktop'))} <strong>${t.desktop}</strong></span>
      ${t.unknownDevice ? `<span>${escapeHtml(tr('analyticsDeviceUnknown'))} <strong>${t.unknownDevice}</strong></span>` : ''}
    </div>`;
  let proBlocks;
  if (isPro) {
    const trackRows = (e.tracks || []).map(k => `<tr>
        <td>${escapeHtml(k.title)}</td><td>${k.plays}</td>
        <td>${analyticsPct(k.reachedEnd, k.plays)}</td><td>${analyticsPct(k.skipped, k.plays)}</td></tr>`).join('');
    const ix = (e.interactions || []).map(i => {
      const key = 'analyticsIx_' + i.name;
      const label = tr(key) === key ? i.name : tr(key);
      return `<li>${escapeHtml(label)} <strong>${i.count}</strong></li>`;
    }).join('');
    proBlocks = `
      <div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsTracksTitle'))} <span class="hint">${escapeHtml(tr('analyticsTracksNote'))}</span></div>
        ${trackRows ? `<table class="an-table"><thead><tr><th>${escapeHtml(tr('analyticsTracksTitle'))}</th><th>${escapeHtml(tr('analyticsColPlays'))}</th><th>${escapeHtml(tr('analyticsTrackColEnd'))}</th><th>${escapeHtml(tr('analyticsTrackColSkipped'))}</th></tr></thead><tbody>${trackRows}</tbody></table>` : `<div class="hint">${escapeHtml(tr('analyticsNoTracks'))}</div>`}
      </div>
      <div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsInteractionsTitle'))}</div>
        ${ix ? `<ul class="an-ix">${ix}</ul>` : `<div class="hint">${escapeHtml(tr('analyticsNoInteractionsShort'))}</div>`}
      </div>${analyticsFxButtonsCard(e.fxButtons)}`;
  } else {
    proBlocks = `<div class="an-card"><div class="an-locked-box">${analyticsLockedBadge()} <span>${escapeHtml(tr('analyticsProDetailLocked'))}</span></div></div>`;
  }
  const recent = (e.recentSessions || []).map(s => `<li>${escapeHtml(new Date(s.openedAt).toLocaleString(currentLang() === 'en' ? 'en-GB' : 'fr-FR'))} — ${escapeHtml(s.device || tr('analyticsUnknownDevice'))}${isPro && s.plays != null ? ' — ' + s.plays + ' ' + escapeHtml(tr('analyticsColPlays').toLowerCase()) : ''}</li>`).join('');
  entityEl.innerHTML = `
    <button type="button" class="btn btn-small" id="btnAnalyticsBack">${escapeHtml(tr('analyticsBackToList'))}</button>
    <h3 class="an-entity-title">${escapeHtml(e.entity.name)} <span class="an-type">${escapeHtml(analyticsTypeLabel(e.entity.type))}</span></h3>
    <div class="an-kpis">${kpis}</div>
    <div class="an-charts">
      <div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsChartVisits'))}</div>${analyticsBuildChart(e.series.visits || [], e.buckets, e.bucket)}</div>
      <div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsChartPlays'))}</div>${isPro ? analyticsBuildChart(e.series.plays || [], e.buckets, e.bucket) : `<div class="an-locked-box">${analyticsLockedBadge()}</div>`}</div>
    </div>
    <div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsDevicesTitle'))}</div>${devices}</div>
    ${proBlocks}
    <div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsRecentSessionsTitle'))}</div><ul class="an-ix">${recent || `<li class="hint">${escapeHtml(tr('analyticsNoItems'))}</li>`}</ul></div>`;
  overviewEl.hidden = true; entityEl.hidden = false;
  document.getElementById('btnAnalyticsBack').addEventListener('click', () => {
    analyticsSelected = null; analyticsEntityData = null; renderAnalyticsView();
  });
}

// Liste brute des visites (ancienne vue) : gardée dans un bloc replié, chargée à l'ouverture.
async function loadAnalyticsRawSessions() {
  const sessionsEl = document.getElementById('analyticsSessions');
  if (sessionsEl) sessionsEl.innerHTML = '';
  await loadPostgresReadScripts();
  const r = analyticsRange();
  const { analytics, error } = await window.LayerPitchAnalytics.getMyAnalytics({ from: r.from, to: r.to });
  if (error) { if (sessionsEl) sessionsEl.innerHTML = `<div class="hint">${escapeHtml(tr('analyticsErrorPrefix') + ' ' + error)}</div>`; return; }
  analyticsData = analytics;
  analyticsRawLoadedForTier = currentEffectivePlan;
  renderAnalyticsSessions();
}

// Boutons d'effet (23/09) : nom lisible du morceau et du bouton, retrouvés dans la bibliothèque locale (repli sur les
// identifiants si le morceau ou le bouton a été supprimé depuis).
function analyticsFxTriggerInfo(detail) {
  const track = library.find(t => t.id === detail.trackId);
  const trg = track && (track.fxTriggers || []).find(d => d.id === detail.triggerId);
  const idx = track ? (track.fxTriggers || []).findIndex(d => d.id === detail.triggerId) : -1;
  return { trackTitle: track ? (track.title || track.id) : detail.trackId, label: (trg && trg.label) || (idx >= 0 ? tr('fxTriggerFallbackLabel', { n: idx + 1 }) : detail.triggerId) };
}
// Boutons d'effet dans la vue détaillée (24/09, champ fxButtons de get_my_analytics_entity) : nom lisible du bouton et
// du morceau retrouvé dans la bibliothèque. Carte masquée tant qu'aucun appui n'a été enregistré sur cette page.
function analyticsFxButtonsCard(fxButtons) {
  if (!fxButtons || !fxButtons.length) return '';
  const rows = fxButtons.map(b => {
    const info = analyticsFxTriggerInfo({ trackId: b.trackId, triggerId: b.triggerId });
    return `<li>${escapeHtml(info.label)} <span class="hint">(${escapeHtml(info.trackTitle)})</span> <strong>${escapeHtml(tr('analyticsFxPresses', { n: b.presses, s: b.sessions }))}</strong></li>`;
  }).join('');
  return `<div class="an-card"><div class="an-card-title">${escapeHtml(tr('analyticsFxSummaryTitle'))} <span class="hint">${escapeHtml(tr('analyticsFxEntityHint'))}</span></div><ul class="an-ix">${rows}</ul></div>`;
}
function analyticsInteractionLabel(i) {
  if (i.name === 'fx_trigger' && i.detail) {
    const info = analyticsFxTriggerInfo(i.detail);
    return tr('analyticsFxInteraction', { label: info.label, track: info.trackTitle, state: tr(i.detail.active ? 'analyticsFxOn' : 'analyticsFxOff') });
  }
  return i.name;
}
// Synthèse « boutons d'effet les plus utilisés » : nombre d'appuis d'ACTIVATION par bouton sur toute la période
// chargée, et dans combien de sessions. Les boutons visibles du compositeur sans aucun appui figurent quand même
// (à zéro) : c'est justement ce qui dit qu'un bouton n'est jamais utilisé. Détail par interaction = Pro seulement.
function renderAnalyticsFxSummary(sessions) {
  if (currentEffectivePlan !== 'pro') return '';
  const stats = new Map();
  const key = d => d.trackId + '|' + d.triggerId;
  library.forEach(t => (t.fxTriggers || []).forEach(d => {
    if (d && d.id && d.visible !== false) stats.set(key({ trackId: t.id, triggerId: d.id }), { detail: { trackId: t.id, triggerId: d.id }, presses: 0, sessions: 0 });
  }));
  sessions.forEach(sess => {
    const seen = new Set();
    (sess.interactions || []).forEach(i => {
      if (i.name !== 'fx_trigger' || !i.detail || !i.detail.active) return;
      const k = key(i.detail);
      if (!stats.has(k)) stats.set(k, { detail: { trackId: i.detail.trackId, triggerId: i.detail.triggerId }, presses: 0, sessions: 0 });
      const st = stats.get(k);
      st.presses++;
      if (!seen.has(k)) { seen.add(k); st.sessions++; }
    });
  });
  if (!stats.size) return '';
  const rows = [...stats.values()].sort((a, b) => b.presses - a.presses).map(st => {
    const info = analyticsFxTriggerInfo(st.detail);
    return `<li>${escapeHtml(info.label)} <span class="hint">(${escapeHtml(info.trackTitle)})</span> — ${escapeHtml(tr('analyticsFxPresses', { n: st.presses, s: st.sessions }))}</li>`;
  }).join('');
  return `
    <div class="analytics-session">
      <div class="analytics-session-head"><strong>${escapeHtml(tr('analyticsFxSummaryTitle'))}</strong></div>
      <div class="analytics-session-detail">
        <div class="hint">${escapeHtml(tr('analyticsFxSummaryHint'))}</div>
        <ul>${rows}</ul>
      </div>
    </div>`;
}

function renderAnalyticsSessionCard(s) {
  const typeLabel = analyticsTypeLabel(s.type);
  const opened = s.openedAt ? new Date(s.openedAt).toLocaleString(currentLang() === 'en' ? 'en-US' : 'fr-FR') : '—';
  const device = s.device || tr('analyticsUnknownDevice');
  let detail = '';
  if (currentEffectivePlan === 'pro') {
    const tracks = s.tracks || [];
    const interactions = s.interactions || [];
    const trackItems = tracks.map(t => {
      const cls = t.skipped ? 'analytics-track-skipped' : (t.reachedEnd ? 'analytics-track-reached' : '');
      const stateLabel = t.reachedEnd ? tr('analyticsTrackReachedEnd') : (t.skipped ? tr('analyticsTrackSkipped') : tr('analyticsTrackPartial'));
      return `<li class="${cls}">${escapeHtml(t.trackId)} — ${escapeHtml(stateLabel)}</li>`;
    }).join('');
    const interactionItems = interactions.map(i => `<li>${escapeHtml(analyticsInteractionLabel(i))}</li>`).join('');
    detail = `
      <div class="analytics-session-detail">
        <div>${escapeHtml(tr('analyticsTracksHeading'))} <span class="hint">(${tr('analyticsTrackDetailApprox')})</span></div>
        <ul>${trackItems || '<li>' + escapeHtml(tr('analyticsNoTracks')) + '</li>'}</ul>
        <div>${escapeHtml(tr('analyticsInteractionsHeading'))} (${interactions.length})</div>
        <ul>${interactionItems || '<li>' + escapeHtml(tr('analyticsNoInteractions')) + '</li>'}</ul>
      </div>`;
  }
  return `
    <div class="analytics-session">
      <div class="analytics-session-head">
        <strong>${escapeHtml(typeLabel)} — ${escapeHtml(s.entityId)}</strong>
        <span>${escapeHtml(opened)}</span>
        <span>${escapeHtml(device)}</span>
      </div>
      ${detail}
    </div>`;
}

function renderAnalyticsSessions() {
  const sessionsEl = document.getElementById('analyticsSessions');
  if (!sessionsEl || !analyticsData) return;
  const sessions = analyticsData.sessions || [];
  sessionsEl.innerHTML = sessions.length ? renderAnalyticsFxSummary(sessions) + sessions.map(renderAnalyticsSessionCard).join('') : `<div class="hint">${escapeHtml(tr('analyticsNoItems'))}</div>`;
}
// Valeur effective d'un champ d'apparence pour le thème général actuel — sert de point de départ quand
// on active une personnalisation par bloc (plutôt que de partir d'une couleur arbitraire). Vérifie
// explicitement undefined/null plutôt que d'utiliser || : une opacité à 0 est une valeur valide et ne
// doit pas être confondue avec "champ non défini".
function effectiveThemeValue(field) {
  const v = profile.theme ? profile.theme[field] : undefined;
  return (v !== undefined && v !== null) ? v : DEFAULT_THEME[field];
}
// Applique un changement de réglage général : si un ou plusieurs blocs de l'AdReel en cours ont déjà
// personnalisé CE champ précis, on prévient plutôt que d'écraser silencieusement leur choix.
function handleThemeFieldChange(field, value) {
  if (!profile.theme) profile.theme = Object.assign({}, DEFAULT_THEME);
  profile.theme[field] = value;
  hasUnsavedEdits = true;
  const affected = blocks.filter(b => b.appearance && b.appearance[field] !== undefined);
  if (affected.length) showThemeConflictModal(field, affected);
}
function showThemeConflictModal(field, affectedBlocks) {
  const fieldDef = APPEARANCE_FIELDS.find(f => f.key === field);
  const fieldLabel = fieldDef ? tr(fieldDef.label) : field;
  const names = affectedBlocks.map(b => BLOCK_LABELS[b.type] || b.type).join(', ');
  document.getElementById('themeConflictMessage').textContent = tr('themeConflictMessage', { field: fieldLabel, blocks: names });
  const overlay = document.getElementById('themeConflictModalOverlay');
  overlay.style.display = 'flex';
  const keepBtn = document.getElementById('themeConflictKeep');
  const overwriteBtn = document.getElementById('themeConflictOverwrite');
  function close() { overlay.style.display = 'none'; keepBtn.onclick = null; overwriteBtn.onclick = null; }
  keepBtn.onclick = () => { close(); }; // ne change rien : les réglages par bloc restent prioritaires, déjà en place
  overwriteBtn.onclick = () => {
    affectedBlocks.forEach(b => {
      delete b.appearance[field];
      if (!Object.keys(b.appearance).length) delete b.appearance;
    });
    hasUnsavedEdits = true;
    rebuildAllCards(); // redessine les cartes pour refléter la case "Personnaliser" désormais décochée
    close();
  };
}
document.getElementById('appThemeBgColor').addEventListener('input', e => handleThemeFieldChange('bgColor', e.target.value));
document.getElementById('appThemeTitleColor').addEventListener('input', e => handleThemeFieldChange('titleColor', e.target.value));
document.getElementById('appThemeContentColor').addEventListener('input', e => handleThemeFieldChange('contentColor', e.target.value));
document.getElementById('appThemeSectionLabelColor').addEventListener('input', e => handleThemeFieldChange('sectionLabelColor', e.target.value));
document.getElementById('appThemeFont').addEventListener('change', e => handleThemeFieldChange('font', e.target.value));
document.getElementById('appThemeBgImageOpacity').addEventListener('input', e => {
  document.getElementById('appThemeBgImageOpacityValue').textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
  handleThemeFieldChange('bgImageOpacity', parseFloat(e.target.value));
});
document.getElementById('appLang').addEventListener('change', e => {
  const ar = adReels.find(a => a.id === currentAdReelId);
  if (ar) { ar.lang = e.target.value; hasUnsavedEdits = true; }
});
document.getElementById('appAdminTierOverride').addEventListener('change', e => {
  // Admin seulement (le fieldset est masqué pour les autres) : palier de publication forcé pour cet
  // AdReel, stocké dans son profile ; vide = pas d'override.
  if (e.target.value) profile.adminTierOverride = e.target.value; else delete profile.adminTierOverride;
  hasUnsavedEdits = true;
});
document.getElementById('adminPreviewTier').addEventListener('change', e => setAdminPreviewTier(e.target.value));
document.getElementById('btnAdminPreviewReset').addEventListener('click', () => setAdminPreviewTier(''));
// Adresse personnalisable d'un AdReel (27/09) : beta.layerpitch.com/<nom>/<adreel>. L'AdReel principal est à la racine.
function fillAdReelSlugField(ar) {
  const input = document.getElementById('appSlug'), btn = document.getElementById('btnSaveSlug');
  const isMain = !ar || ar.id === 'main';
  document.getElementById('appSlugPrefix').textContent = `beta.layerpitch.com/${myComposerHandle || '…'}/`;
  input.value = (ar && ar.slug) || '';
  input.placeholder = isMain ? '' : slugify((ar && ar.label) || '');
  input.disabled = btn.disabled = isMain || !currentUserIsAdmin;
  document.getElementById('appSlugHint').textContent = isMain ? tr('adreelSlugMainHint') : (currentUserIsAdmin ? tr('adreelSlugHint') : tr('adreelSlugAdminOnly'));
  document.getElementById('appSlugMsg').textContent = '';
}
// Nom d'adresse : slug() du Backstage, borné à 60 caractères ; vide reste vide (= retirer le nom).
function slugify(s) {
  const t = String(s || '').trim();
  return t ? slug(t).slice(0, 60).replace(/-+$/, '') : '';
}
document.getElementById('btnSaveSlug').addEventListener('click', async () => {
  const ar = adReels.find(a => a.id === currentAdReelId);
  const msg = document.getElementById('appSlugMsg');
  if (!ar || ar.id === 'main') return;
  const input = document.getElementById('appSlug');
  const wanted = slugify(input.value);
  input.value = wanted;
  msg.textContent = '…';
  try {
    await loadPostgresReadScripts();
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('set_my_ad_reel_slug', { p_ad_reel_id: ar.id, p_slug: wanted });
    if (error) throw error;
    ar.slug = data || null;
    input.value = ar.slug || '';
    msg.textContent = ar.slug ? tr('adreelSlugSaved', { url: computeAdReelUrl(ar.id) }) : tr('adreelSlugCleared');
    renderAdReelSelect(); renderManageAdreels(); // liens affichés
  } catch (e) {
    msg.textContent = e && e.hint === 'unpublished' ? tr('adreelSlugPublishFirst') : tr('errorPrefix', { message: (e && e.message) || String(e) });
  }
});
document.getElementById('appAllowIndexing').addEventListener('change', e => {
  const ar = adReels.find(a => a.id === currentAdReelId);
  if (ar) { ar.allowIndexing = e.target.checked; hasUnsavedEdits = true; }
});
fillAppearanceFields();

