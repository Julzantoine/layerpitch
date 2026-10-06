// layerpitch-studio-albums.js — LayerPitch, onglet « Albums » de l'espace studio (29/09, vente d'OST par un studio).
//
// Décision de Jules-Antoine : on n'entre pas dans les questions de propriété (réglées en amont, au plus un message de
// confirmation). Le studio crée un album avec les morceaux qu'il a (ceux de ses packs), ou invite un compositeur qui y
// ajoute les siens ; l'album reste celui du studio (prix, mise en vente, argent). Serveur : migration 20260929020000
// (upsert_studio_album, album_contributors) ; co-ayants droit : 20260928040000 ; pochette : dossier images/<id du studio>/
// (create-media-signed-url).
//
//   LayerPitchStudioAlbums.mount(panel, { tr, esc, lang, ownedTracks: [{ id, title, packTitle }], notify })
//
// L'éditeur d'un album (champs, morceaux, versions officielles, écoute libre, invités, droits, enregistrement) est le module
// commun layerpitch-album-editor.js, aussi utilisé par le Backstage compositeur ; ce fichier ne garde que la liste, le nom du
// studio et ce qui est propre au studio (morceaux de ses packs, pochette rangée sous son identifiant, RPC upsert_studio_album).
(function () {
  const MEDIA_IMAGES = 'https://media.layerpitch.com/images/';
  const S = { loaded: false, albums: [], editing: null, ed: null, msg: null, ctx: null, uid: null, studioId: null, isOwner: true, studioName: null };
  let panel = null;

  const $ = sel => panel.querySelector(sel);
  const tr = (k, v) => S.ctx.tr(k, v);
  const esc = s => S.ctx.esc(s);
  const client = () => window.LayerPitchSupabaseClient.getClient();
  const say = (text, kind) => { S.msg = text ? { text, kind: kind || 'ok' } : null; };
  const msgHtml = () => S.msg ? `<div class="msg ${S.msg.kind === 'error' ? 'err' : ''}">${esc(S.msg.text)}</div>` : '';
  const E = () => window.LayerPitchAlbumEditor;

  async function listStudioAlbums() {
    const r = await window.LayerPitchAlbums.listAlbums({ sellerId: S.uid });
    if (r.error) throw new Error(r.error);
    return r.albums.filter(a => a.sellerRole === 'studio');
  }
  async function load() {
    const { session } = await window.LayerPitchAuth.getSession();
    S.uid = session && session.user ? session.user.id : null;
    const st = await window.LayerPitchAuth.getMyStudioId();
    S.studioId = st.studioId; S.isOwner = st.isOwner !== false; S.studioName = st.name || null;
    S.albums = (await listStudioAlbums()).map(E().fromApi);
    S.loaded = true;
  }
  async function refresh() {
    try { S.albums = (await listStudioAlbums()).map(E().fromApi); } catch (e) { /* on garde la liste précédente */ }
  }

  function closeEditor() {
    if (S.ed) { S.ed.destroy(); S.ed = null; }
    E().stopAll();
  }

  // ---- Liste ----
  function renderList() {
    closeEditor();
    panel.innerHTML = `<div class="card">
        <h2 style="margin:0 0 6px">${esc(tr('alb_studioName'))}</h2>
        <p class="hint">${esc(tr('alb_studioNameHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input type="text" id="albStudioName" maxlength="80" value="${esc(S.studioName || '')}" placeholder="${esc(tr('alb_studioNamePlaceholder'))}" style="flex:1 1 240px;min-width:0" ${S.isOwner ? '' : 'disabled'}>
          ${S.isOwner ? `<button class="btn" id="albStudioNameSave" type="button">${esc(tr('alb_studioNameSave'))}</button>` : ''}</div>
        ${S.studioName ? '' : `<p class="hint" style="margin-top:8px">${esc(tr('alb_studioNameNeeded'))}</p>`}
      </div>
      <div class="card">
        <h2 style="margin:0 0 6px">${esc(tr('alb_title'))}</h2>
        <p class="hint">${esc(tr('alb_intro'))}</p>
        <button class="btn primary" id="albNew" type="button" ${S.ctx.ownedTracks.length ? '' : 'disabled'}>${esc(tr('alb_new'))}</button>
        ${S.ctx.ownedTracks.length ? '' : `<p class="hint" style="margin-top:8px">${esc(tr('alb_needsPack'))}</p>`}
        ${msgHtml()}
      </div>
      ${S.albums.length ? `<div class="card">${S.albums.map((a, i) => `
        <div class="row" data-i="${i}">
          <div class="row-main"><div class="row-title">${esc(a.title || tr('alb_untitled'))}</div>
            <div class="row-sub">${esc(tr(a.buyable ? 'alb_onSale' : 'alb_draft'))} · ${esc(tr('alb_trackCount', { n: a.trackIds.length }))}</div></div>
          <div class="row-actions">
            ${a.buyable ? `<a class="btn" href="${esc('/album/' + encodeURIComponent(a.id) + (S.ctx.lang === 'en' ? '?lang=en' : ''))}" target="_blank" rel="noopener">${esc(tr('alb_openPage'))}</a>` : ''}
            <button class="btn" data-act="edit" type="button">${esc(tr('alb_edit'))}</button>
          </div>
        </div>`).join('')}</div>` : ''}`;
    const saveName = $('#albStudioNameSave');
    if (saveName) saveName.onclick = async () => {
      const r = await window.LayerPitchStudio.setMyStudioName($('#albStudioName').value);
      if (r.ok) { S.studioName = r.name; say(tr('alb_studioNameSaved')); } else say(tr('alb_error', { error: r.error }), 'error');
      renderList();
    };
    $('#albNew').onclick = () => { say(null); openEditor(E().newAlbum()); };
    panel.querySelectorAll('.row[data-i]').forEach(row => {
      row.querySelector('[data-act="edit"]').onclick = () => { say(null); openEditor(S.albums[+row.dataset.i]); };
    });
  }

  // ---- Éditeur (module commun) ----
  async function uploadCover(al) {
    const ext = ((/\.([a-z0-9]+)$/i.exec(al.pendingCover.name) || [0, 'jpg'])[1]).toLowerCase();
    const path = `images/${S.studioId}/album-${al.id}.${ext}`;
    const bytes = new Uint8Array(await al.pendingCover.arrayBuffer());
    const { data, error } = await client().functions.invoke('create-media-signed-url', { body: { path, method: 'PUT', size: bytes.byteLength } });
    if (error) throw new Error(await window.LayerPitchAuth.describeFunctionError(error));
    if (!data || !data.url) throw new Error((data && data.error) || 'Réponse inattendue.');
    const res = await fetch(data.url, { method: 'PUT', headers: data.headers || { 'content-type': al.pendingCover.type }, body: bytes });
    if (!res.ok) throw new Error('Envoi de la pochette refusé (' + res.status + ')');
    return { illustration: `${S.studioId}/album-${al.id}.${ext}`, illustrationOriginalName: al.pendingCover.name };
  }

  function openEditor(al) {
    closeEditor();
    S.editing = al;
    panel.innerHTML = `<div class="card">
        <h2 style="margin:0 0 10px">${esc(al.saved ? tr('alb_editTitle') : tr('alb_newTitle'))}</h2>
        <div id="albEditor"></div>
      </div>`;
    const ownIds = () => new Set(S.ctx.ownedTracks.map(t => t.id));
    S.ed = E().create({
      host: $('#albEditor'), album: al,
      cfg: {
        tracks: () => S.ctx.ownedTracks.map(t => ({ id: t.id, title: t.title, group: t.packTitle || '' })),
        trackTitle: id => { const t = S.ctx.ownedTracks.find(x => x.id === id); return t ? t.title : id; },
        ownIds, mediaBase: MEDIA_IMAGES,
        features: { contributors: true, rights: true, confirmRights: true },
        save: p => window.LayerPitchAlbums.upsertStudioAlbum(p),
        uploadCover,
        reload: async id => (await listStudioAlbums()).find(a => a.id === id) || null,
        checkBeforeSale: () => (S.studioName ? null : tr('alb_needsName')),
        actions: () => [{ id: 'back', label: tr('alb_back'), onClick: async () => { await refresh(); renderList(); } }],
        confirm: (text, opts) => S.ctx.notify.confirm(text, opts),
      },
    });
    S.ed.render();
    S.ed.loadExtras();
  }

  async function mount(el, ctx) {
    panel = el; S.ctx = ctx;
    panel.innerHTML = `<div class="card"><p class="hint">${esc(ctx.tr('alb_loading'))}</p></div>`;
    try { if (!S.loaded) await load(); renderList(); }
    catch (e) { panel.innerHTML = `<div class="card"><div class="msg err">${esc(ctx.tr('alb_error', { error: e.message }))}</div></div>`; }
  }
  function unmount() { closeEditor(); S.loaded = false; }

  window.LayerPitchStudioAlbums = { mount, unmount };
})();
