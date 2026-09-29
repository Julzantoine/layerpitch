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
// DETTE CONNUE : l'éditeur d'albums du Backstage compositeur (src/backstage/33*.js) fait presque la même chose avec ses
// propres fonctions ; les deux sont à réunir un jour dans un module commun (voir le changelog du 29/09).
(function () {
  const MEDIA_IMAGES = 'https://media.layerpitch.com/images/';
  const S = { loaded: false, albums: [], editing: null, msg: null, recorder: null, playback: null, ctx: null, uid: null, studioId: null, isOwner: true, studioName: null };
  let panel = null;

  const $ = sel => panel.querySelector(sel);
  const tr = (k, v) => S.ctx.tr(k, v);
  const esc = s => S.ctx.esc(s);
  const client = () => window.LayerPitchSupabaseClient.getClient();
  const fmtDur = sec => { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  const newId = () => 'alb_' + ((window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12));
  const trackTitle = id => { const t = S.ctx.ownedTracks.find(x => x.id === id); return t ? t.title : id; };
  const say = (text, kind) => { S.msg = text ? { text, kind: kind || 'ok' } : null; };
  const msgHtml = () => S.msg ? `<div class="msg ${S.msg.kind === 'error' ? 'err' : 'ok'}">${esc(S.msg.text)}</div>` : '';

  function fromApi(a) {
    return {
      id: a.id, title: a.title || '', presFr: a.presentationFr || '', presEn: a.presentationEn || '',
      price: a.priceEurCents == null ? '' : (a.priceEurCents / 100).toFixed(2), buyable: !!a.buyable, saved: true, shopListed: !!a.shopListed, listenMode: a.listenMode || 'none', freeTrackIds: (a.freeTrackIds || []).slice(),
      trackIds: (a.trackIds || []).slice(), durations: Object.assign({}, a.officialDurations || {}),
      illustration: a.illustration || null, pendingCover: null, pendingCoverUrl: null, confirmedRights: !!a.buyable,
      contributors: [], rights: null,
    };
  }

  async function load() {
    const { session } = await window.LayerPitchAuth.getSession();
    S.uid = session && session.user ? session.user.id : null;
    const st = await window.LayerPitchAuth.getMyStudioId();
    S.studioId = st.studioId; S.isOwner = st.isOwner !== false; S.studioName = st.name || null;
    const r = await window.LayerPitchAlbums.listAlbums({ sellerId: S.uid });
    if (r.error) throw new Error(r.error);
    S.albums = r.albums.filter(a => a.sellerRole === 'studio').map(fromApi);
    S.loaded = true;
  }

  // ---- Liste ----
  function renderList() {
    stopPlayback(); closeRecorder();
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
    $('#albNew').onclick = () => {
      S.editing = { id: newId(), title: '', presFr: '', presEn: '', price: '', buyable: false, shopListed: false, listenMode: 'none', freeTrackIds: [], saved: false, trackIds: [], durations: {}, illustration: null,
        pendingCover: null, pendingCoverUrl: null, confirmedRights: false, contributors: [], rights: null };
      say(null); renderEditor();
    };
    panel.querySelectorAll('.row[data-i]').forEach(row => {
      row.querySelector('[data-act="edit"]').onclick = async () => { S.editing = S.albums[+row.dataset.i]; say(null); await loadExtras(S.editing); renderEditor(); };
    });
  }

  async function loadExtras(al) {
    if (!al.saved) return;
    const [c, r] = await Promise.all([window.LayerPitchAlbums.listAlbumContributors(al.id), window.LayerPitchAlbums.getAlbumRights(al.id)]);
    al.contributors = c.contributors || [];
    al.rights = r.rights ? rightsFromServer(r.rights) : { declaration: 'sole', ack: false, rows: [], settled: true };
  }
  function rightsFromServer(d) {
    return { declaration: d.declaration || 'sole', ack: !!d.ackAt, settled: !!d.settled, sellerShareBps: d.sellerShareBps,
      rows: (d.holders || []).map(h => ({ id: h.id, email: h.email, pct: String(h.shareBps / 100).replace('.', ','), status: h.status })) };
  }
  const pctToBps = s => Math.round(Number(String(s || '').trim().replace(',', '.')) * 100);

  // ---- Éditeur ----
  function renderEditor() {
    const al = S.editing;
    const mine = S.ctx.ownedTracks;
    const byPack = {};
    mine.forEach(t => { (byPack[t.packTitle || ''] = byPack[t.packTitle || ''] || []).push(t); });
    const ownIds = new Set(mine.map(t => t.id));
    const foreign = al.trackIds.filter(id => !ownIds.has(id)); // ajoutés par un compositeur invité
    const rs = al.rights;
    panel.innerHTML = `<div class="card">
      <h2 style="margin:0 0 10px">${esc(al.saved ? tr('alb_editTitle') : tr('alb_newTitle'))}</h2>
      <label>${esc(tr('alb_titleLabel'))}</label>
      <input type="text" id="albTitle" maxlength="200" value="${esc(al.title)}">
      <label>${esc(tr('alb_presFr'))}</label><textarea id="albPresFr" rows="3">${esc(al.presFr)}</textarea>
      <label>${esc(tr('alb_presEn'))}</label><textarea id="albPresEn" rows="3">${esc(al.presEn)}</textarea>
      <label>${esc(tr('alb_cover'))}</label>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        ${al.pendingCoverUrl || al.illustration ? `<img src="${esc(al.pendingCoverUrl || (MEDIA_IMAGES + al.illustration))}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">` : `<div style="width:72px;height:72px;border-radius:6px;border:1px dashed var(--border)"></div>`}
        <input type="file" id="albCover" accept="image/png,image/jpeg,image/webp">
      </div>
      <label>${esc(tr('alb_price'))}</label>
      <input type="text" id="albPrice" inputmode="decimal" placeholder="3.00" value="${esc(al.price)}" style="max-width:140px">
      <p class="hint">${esc(tr('alb_priceHint'))}</p>
    </div>
    <div class="card">
      <div class="section-label">${esc(tr('alb_tracks'))}</div>
      ${Object.keys(byPack).map(p => `<div class="hint" style="margin-top:8px"><strong>${esc(p)}</strong></div>${byPack[p].map(t => `
        <label style="display:flex;align-items:center;gap:8px;font-weight:normal;margin-top:4px"><input type="checkbox" style="width:auto;margin:0" data-track="${esc(t.id)}"${al.trackIds.includes(t.id) ? ' checked' : ''}> ${esc(t.title)}</label>`).join('')}`).join('')}
      ${foreign.length ? `<p class="hint" style="margin-top:8px">${esc(tr('alb_foreignTracks', { n: foreign.length }))}</p>` : ''}
      <div class="section-label" style="margin-top:14px">${esc(tr('alb_official'))}</div>
      <p class="hint">${esc(tr('alb_officialHint'))}</p>
      ${!al.saved || !al.trackIds.some(id => ownIds.has(id)) ? `<p class="hint">${esc(tr('alb_officialSaveFirst'))}</p>` : al.trackIds.filter(id => ownIds.has(id)).map(id => {
        const has = Object.prototype.hasOwnProperty.call(al.durations, id);
        return `<div class="item-row" style="flex-wrap:wrap"><span class="item-name">${esc(trackTitle(id))}</span>
          ${has ? `<span class="hint" style="margin:0">✓ ${esc(fmtDur(al.durations[id]))}</span>` : `<span class="plan-badge" style="color:#c0392b;border-color:#c0392b">${esc(tr('alb_officialMissing'))}</span>`}
          ${has ? `<button class="btn" type="button" data-play="${esc(id)}">${esc(tr(S.playback && S.playback.id === id ? 'alb_stop' : 'alb_listen'))}</button>` : ''}
          <button class="btn${has ? '' : ' primary'}" type="button" data-record="${esc(id)}">${esc(tr(has ? 'alb_redo' : 'alb_record'))}</button>
          <div data-rec-host="${esc(id)}" style="flex-basis:100%"></div></div>`;
      }).join('')}
    </div>
    <div class="card">
      <div class="section-label">${esc(tr('alb_listenTitle'))}</div>
      <p class="hint">${esc(tr('alb_listenHint'))}</p>
      ${['none', 'all', 'selected'].map(m => `<label style="display:flex;gap:8px;font-weight:normal;align-items:center"><input type="radio" name="albListen" value="${m}" style="width:auto;margin:0"${al.listenMode === m ? ' checked' : ''}> ${esc(tr('alb_listen' + { none: 'None', all: 'All', selected: 'Some' }[m]))}</label>`).join('')}
      ${al.listenMode === 'selected' ? (al.trackIds.length ? al.trackIds.map(id => `<label style="display:flex;gap:8px;font-weight:normal;align-items:center;margin:4px 0 0 22px"><input type="checkbox" style="width:auto;margin:0" data-free="${esc(id)}"${al.freeTrackIds.includes(id) ? ' checked' : ''}> ${esc(trackTitle(id))}</label>`).join('') : `<p class="hint" style="margin-left:22px">${esc(tr('alb_listenNoTracks'))}</p>`) : ''}
    </div>
    ${al.saved ? `<div class="card">
      <div class="section-label">${esc(tr('alb_contributors'))}</div>
      <p class="hint">${esc(tr('alb_contributorsHint'))}</p>
      ${al.contributors.map(c => `<div class="item-row"><span class="item-name">${esc(c.email)}</span>
        <span class="plan-badge">${esc(tr('alb_status_' + c.status))}${c.status === 'accepted' ? ' · ' + esc(tr('alb_trackCount', { n: c.trackCount })) : ''}</span>
        <button class="btn danger" type="button" data-remove-contrib="${esc(c.id)}">${esc(tr('alb_remove'))}</button></div>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input type="email" id="albInvite" placeholder="${esc(tr('alb_invitePlaceholder'))}" style="flex:1 1 220px;min-width:0"><button class="btn" id="albInviteBtn" type="button">${esc(tr('alb_invite'))}</button></div>
    </div>
    <div class="card">
      <div class="section-label">${esc(tr('alb_rights'))}</div>
      <p class="hint">${esc(tr('alb_rightsHint'))}</p>
      <label style="display:flex;gap:8px;font-weight:normal;align-items:center"><input type="radio" name="albRights" value="sole" style="width:auto;margin:0"${rs.declaration === 'sole' ? ' checked' : ''}> ${esc(tr('alb_rightsSole'))}</label>
      <label style="display:flex;gap:8px;font-weight:normal;align-items:center"><input type="radio" name="albRights" value="shared" style="width:auto;margin:0"${rs.declaration === 'shared' ? ' checked' : ''}> ${esc(tr('alb_rightsShared'))}</label>
      ${rs.declaration === 'shared' ? `<div style="margin:8px 0 0 22px">
        ${rs.rows.map((r, i) => `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">
          <input type="email" data-rr="${i}" data-col="email" value="${esc(r.email)}" placeholder="${esc(tr('alb_invitePlaceholder'))}" style="flex:1 1 200px;min-width:0">
          <input type="text" inputmode="decimal" data-rr="${i}" data-col="pct" value="${esc(r.pct)}" placeholder="30" style="width:70px"> %
          ${r.status ? `<span class="plan-badge">${esc(tr('alb_rstatus_' + r.status))}</span>` : ''}
          ${r.id && (r.status === 'pending' || r.status === 'self_pay') ? `<button class="btn" type="button" data-rinvite="${esc(r.id)}">${esc(tr('alb_reinvite'))}</button>` : ''}
          ${r.id && r.status === 'pending' ? `<button class="btn" type="button" data-rselfpay="${esc(r.id)}" title="${esc(tr('alb_selfPayHelp'))}">${esc(tr('alb_selfPay'))}</button>` : ''}
          <button class="btn danger" type="button" data-rremove="${i}">✕</button></div>`).join('')}
        <button class="btn" type="button" id="albRAdd" style="margin-top:8px">${esc(tr('alb_rightsAdd'))}</button>
        <p class="hint">${esc(tr('alb_sellerShare', { pct: ((10000 - rs.rows.reduce((s, r) => s + (pctToBps(r.pct) || 0), 0)) / 100).toLocaleString(S.ctx.lang) }))}</p>
        <label style="display:flex;gap:8px;font-weight:normal;align-items:flex-start"><input type="checkbox" id="albRAck" style="width:auto;margin:3px 0 0"${rs.ack ? ' checked' : ''}> <span class="hint" style="margin:0">${esc(tr('alb_rightsDisclaimer'))}</span></label>
      </div>` : ''}
      <button class="btn" id="albRSave" type="button" style="margin-top:8px">${esc(tr('alb_rightsSave'))}</button>
    </div>` : ''}
    <div class="card">
      <label style="display:flex;gap:8px;font-weight:normal;align-items:center"><input type="checkbox" id="albBuyable" style="width:auto;margin:0"${al.buyable ? ' checked' : ''}> ${esc(tr('alb_buyable'))}</label>
      <label style="display:flex;gap:8px;font-weight:normal;align-items:center;margin-top:8px"><input type="checkbox" id="albShop" style="width:auto;margin:0"${al.shopListed ? ' checked' : ''}> ${esc(tr('alb_shopListed'))}</label>
      <p class="hint" style="margin:2px 0 0">${esc(tr('alb_shopListedHint'))}</p>
      <label style="display:flex;gap:8px;font-weight:normal;align-items:flex-start;margin-top:8px"><input type="checkbox" id="albConfirm" style="width:auto;margin:3px 0 0"${al.confirmedRights ? ' checked' : ''}> <span class="hint" style="margin:0">${esc(tr('alb_confirmRights'))}</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn primary" id="albSave" type="button">${esc(tr('alb_save'))}</button>
        <button class="btn" id="albBack" type="button">${esc(tr('alb_back'))}</button>
      </div>
      ${msgHtml()}
    </div>`;
    wireEditor();
    if (S.recorder) { const h = panel.querySelector(`[data-rec-host="${CSS.escape(S.recorder.trackId)}"]`); if (h) h.appendChild(S.recorder.el); else closeRecorder(); }
  }

  function wireEditor() {
    const al = S.editing;
    $('#albTitle').oninput = e => { al.title = e.target.value; };
    $('#albPresFr').oninput = e => { al.presFr = e.target.value; };
    $('#albPresEn').oninput = e => { al.presEn = e.target.value; };
    $('#albPrice').oninput = e => { al.price = e.target.value; };
    $('#albBuyable').onchange = e => { al.buyable = e.target.checked; };
    $('#albShop').onchange = e => { al.shopListed = e.target.checked; };
    $('#albConfirm').onchange = e => { al.confirmedRights = e.target.checked; };
    $('#albCover').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (al.pendingCoverUrl) URL.revokeObjectURL(al.pendingCoverUrl);
      al.pendingCover = f; al.pendingCoverUrl = URL.createObjectURL(f); renderEditor();
    };
    panel.querySelectorAll('[data-track]').forEach(cb => cb.onchange = () => {
      al.trackIds = cb.checked ? al.trackIds.concat(cb.dataset.track) : al.trackIds.filter(t => t !== cb.dataset.track);
      renderEditor();
    });
    panel.querySelectorAll('[data-record]').forEach(b => b.onclick = () => openRecorder(b.dataset.record));
    panel.querySelectorAll('[data-play]').forEach(b => b.onclick = () => togglePlay(b.dataset.play));
    panel.querySelectorAll('input[name="albListen"]').forEach(r => r.onchange = () => { al.listenMode = r.value; renderEditor(); });
    panel.querySelectorAll('[data-free]').forEach(cb => cb.onchange = () => { al.freeTrackIds = cb.checked ? al.freeTrackIds.concat(cb.dataset.free) : al.freeTrackIds.filter(t => t !== cb.dataset.free); });
    $('#albSave').onclick = save;
    $('#albBack').onclick = async () => { await refresh(); renderList(); };
    if (!al.saved) return;
    $('#albInviteBtn').onclick = inviteContributor;
    panel.querySelectorAll('[data-remove-contrib]').forEach(b => b.onclick = async () => {
      const c = al.contributors.find(x => x.id === b.dataset.removeContrib);
      if (!await S.ctx.notify.confirm(tr('alb_removeConfirm', { email: c.email }), { okLabel: tr('alb_remove'), danger: true })) return;
      const r = await window.LayerPitchAlbums.removeAlbumContributor(c.id);
      say(r.ok ? tr(r.unpublished ? 'alb_removedUnpublished' : 'alb_removed') : tr('alb_error', { error: r.error }), r.ok ? 'ok' : 'error');
      if (r.ok) { await refresh(); S.editing = S.albums.find(x => x.id === al.id) || al; await loadExtras(S.editing); }
      renderEditor();
    });
    const rs = al.rights;
    panel.querySelectorAll('input[name="albRights"]').forEach(r => r.onchange = () => { rs.declaration = r.value; renderEditor(); });
    panel.querySelectorAll('[data-rr]').forEach(inp => inp.oninput = () => { rs.rows[+inp.dataset.rr][inp.dataset.col] = inp.value; });
    panel.querySelectorAll('[data-rremove]').forEach(b => b.onclick = () => { rs.rows.splice(+b.dataset.rremove, 1); renderEditor(); });
    const add = $('#albRAdd'); if (add) add.onclick = () => { rs.rows.push({ email: '', pct: '' }); renderEditor(); };
    const ack = $('#albRAck'); if (ack) ack.onchange = () => { rs.ack = ack.checked; };
    $('#albRSave').onclick = saveRights;
    panel.querySelectorAll('[data-rinvite]').forEach(b => b.onclick = () => sendRightsInvites([b.dataset.rinvite]));
    panel.querySelectorAll('[data-rselfpay]').forEach(b => b.onclick = async () => {
      const r = await window.LayerPitchAlbums.markRightsHolderSelfPay(b.dataset.rselfpay);
      if (r.error) say(tr('alb_error', { error: r.error }), 'error'); else { al.rights = rightsFromServer(r.rights); say(tr('alb_saved')); }
      renderEditor();
    });
  }

  async function refresh() {
    const r = await window.LayerPitchAlbums.listAlbums({ sellerId: S.uid });
    if (!r.error) S.albums = r.albums.filter(a => a.sellerRole === 'studio').map(fromApi);
  }

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

  async function save() {
    const al = S.editing;
    const raw = al.price.trim().replace(',', '.');
    let cents = null;
    if (raw !== '') { const n = Number(raw); if (!Number.isFinite(n) || n < 0) { say(tr('alb_priceInvalid'), 'error'); return renderEditor(); } cents = Math.round(n * 100); }
    if (al.buyable && cents === null) { say(tr('alb_needsPrice'), 'error'); return renderEditor(); }
    if (al.buyable && !S.studioName) { say(tr('alb_needsName'), 'error'); return renderEditor(); }
    if (al.buyable && !al.confirmedRights) { say(tr('alb_needsConfirm'), 'error'); return renderEditor(); }
    say(tr('alb_saving'), 'ok'); renderEditor();
    try {
      let cover = null;
      if (al.pendingCover) cover = await uploadCover(al);
      const ownIds = new Set(S.ctx.ownedTracks.map(t => t.id));
      const r = await window.LayerPitchAlbums.upsertStudioAlbum({
        id: al.id, title: al.title, presentationFr: al.presFr, presentationEn: al.presEn, priceEurCents: cents, buyable: al.buyable,
        trackIds: al.trackIds.filter(id => ownIds.has(id)), ...(cover || {}),
      });
      if (!r.ok) { say(tr('alb_error', { error: r.error }), 'error'); return renderEditor(); }
      const shop = await window.LayerPitchAlbums.setAlbumShopListed(al.id, al.shopListed);
      if (!shop.ok) { say(tr('alb_error', { error: shop.error }), 'error'); return renderEditor(); }
      const listen = await window.LayerPitchAlbums.setAlbumListening(al.id, al.listenMode, al.freeTrackIds.filter(id => al.trackIds.includes(id)));
      if (!listen.ok) { say(tr('alb_listenError', { error: listen.error }), 'error'); return renderEditor(); }
      const wasSaved = al.saved;
      al.saved = true; if (al.pendingCoverUrl) URL.revokeObjectURL(al.pendingCoverUrl);
      await refresh();
      const fresh = S.albums.find(x => x.id === al.id);
      if (fresh) { fresh.confirmedRights = al.confirmedRights; S.editing = fresh; await loadExtras(fresh); }
      say(tr(wasSaved ? 'alb_saved' : 'alb_savedNew'));
    } catch (e) { say(tr('alb_error', { error: e.message }), 'error'); }
    renderEditor();
  }

  async function inviteContributor() {
    const al = S.editing, email = $('#albInvite').value.trim();
    if (!email) return;
    const r = await window.LayerPitchAlbums.inviteAlbumContributor(al.id, email, location.origin + '/invitation.html' + (S.ctx.lang === 'en' ? '?lang=en' : ''));
    if (r.ok) say(tr('alb_invited', { email }));
    else if (r.invited) say(tr('alb_inviteMailFailed', { error: r.error }) + (r.actionLink ? ' ' + r.actionLink : ''), 'error');
    else say(tr('alb_error', { error: r.error }), 'error');
    await loadExtras(al); renderEditor();
  }

  async function saveRights() {
    const al = S.editing, rs = al.rights;
    const holders = rs.declaration === 'shared' ? rs.rows.map(r => ({ email: r.email.trim(), shareBps: pctToBps(r.pct) })) : [];
    const r = await window.LayerPitchAlbums.setAlbumRights(al.id, rs.declaration, holders, rs.ack);
    if (r.error) { say(tr('alb_error', { error: r.error }), 'error'); return renderEditor(); }
    al.rights = rightsFromServer(r.rights);
    say(tr('alb_saved'));
    if (r.rights.toInvite && r.rights.toInvite.length) await sendRightsInvites(r.rights.toInvite);
    if (r.rights.unlisted) { al.buyable = false; say(tr('alb_rightsUnlisted')); }
    renderEditor();
  }
  async function sendRightsInvites(ids) {
    const al = S.editing;
    for (const id of ids) {
      const r = await window.LayerPitchAlbums.inviteRightsHolder(al.id, id, location.origin + '/invitation.html' + (S.ctx.lang === 'en' ? '?lang=en' : ''));
      if (!r.ok) { say(tr('alb_inviteMailFailed', { error: r.error }) + (r.actionLink ? ' ' + r.actionLink : ''), 'error'); return renderEditor(); }
    }
    say(tr('alb_rightsInvited')); renderEditor();
  }

  // ---- Version officielle : enregistrer et écouter ----
  let captureLoaded = null;
  function loadCaptureRender() {
    if (window.LayerCaptureRender) return Promise.resolve();
    if (captureLoaded) return captureLoaded;
    const v = (document.querySelector('script[src*="layerpitch-i18n.js?v="]') || {}).src;
    const version = v ? new URL(v).searchParams.get('v') : '';
    captureLoaded = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = './capture-render.js' + (version ? '?v=' + version : '');
      sc.onload = resolve; sc.onerror = () => { captureLoaded = null; reject(new Error('Échec du chargement de ' + sc.src)); };
      document.head.appendChild(sc);
    });
    return captureLoaded;
  }
  function stopPlayback() { const pb = S.playback; S.playback = null; if (pb && pb.ctrl) pb.ctrl.stop(); }
  async function togglePlay(id) {
    const al = S.editing;
    const same = S.playback && S.playback.id === id;
    stopPlayback();
    if (same) return renderEditor();
    closeRecorder();
    const pb = { id, ctrl: null }; S.playback = pb; renderEditor();
    try {
      await loadCaptureRender();
      const { take, error } = await window.LayerPitchAlbums.getAlbumTrackOfficialTake(al.id, id);
      if (error || !take) throw new Error(error || tr('alb_officialMissing'));
      const fetchBytes = url => window.LayerPlayerCore.fetchAudioBytes(url);
      const ctrl = await window.LayerCaptureRender.playTake(take, { fetchBytes, onEnd: () => { if (S.playback === pb) { S.playback = null; renderEditor(); } } });
      if (S.playback !== pb) { ctrl.stop(); return; }
      pb.ctrl = ctrl;
    } catch (e) { if (S.playback === pb) S.playback = null; say(tr('alb_error', { error: e.message }), 'error'); renderEditor(); }
  }
  function closeRecorder() {
    const rec = S.recorder; if (!rec) return;
    S.recorder = null;
    document.dispatchEvent(new CustomEvent('stop-track', { detail: rec.trackId }));
    rec.el.remove();
  }
  // La version PUBLIÉE du morceau, jouée dans le lecteur habituel, journal de prise actif ; « Enregistrer » garde tout ce
  // qui a été joué depuis le lancement (même principe que l'onglet Albums du Backstage).
  async function openRecorder(trackId) {
    const al = S.editing, P = window.LayerPlayerCore;
    closeRecorder(); stopPlayback();
    const el = document.createElement('div');
    el.style.cssText = 'margin:8px 0 12px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)';
    el.innerHTML = `<div class="hint">${esc(tr('alb_recLoading'))}</div>`;
    const rec = { trackId, el }; S.recorder = rec; renderEditor();
    try {
      const r = await window.LayerPitchTracks.getTrack(trackId);
      if (!r || !r.track) throw new Error(tr('alb_recUnpublished'));
      const track = r.track, sfxById = {};
      for (const sid of (track.sfxIds || [])) { const x = await window.LayerPitchSfx.getSfx(sid); if (x && x.sfx) sfxById[sid] = x.sfx; }
      if (S.recorder !== rec) return;
      P.setSfxLibrary(sfxById); P.setTakeRecording(true);
      el.innerHTML = `<div class="hint" style="margin-bottom:8px">${esc(tr('alb_recHint'))}</div><div data-role="recPlayer"></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" type="button" data-role="recSave">${esc(tr('alb_recSave'))}</button><button class="btn" type="button" data-role="recClose">${esc(tr('alb_recClose'))}</button></div>
        <div class="msg" data-role="recMsg"></div>`;
      const row = P.buildTrackRow(track, null, false);
      el.querySelector('[data-role="recPlayer"]').appendChild(row);
      P.initTrackPlayer(track, row);
      const say2 = t => { el.querySelector('[data-role="recMsg"]').textContent = t; };
      el.querySelector('[data-role="recClose"]').onclick = () => closeRecorder();
      el.querySelector('[data-role="recSave"]').onclick = async e => {
        const take = P.getTrackTake(trackId);
        if (!take || !take.voices.length) return say2(tr('alb_recNothing'));
        if (take.missing) return say2(tr('alb_recUnpublished'));
        e.target.disabled = true;
        try {
          const res = await window.LayerPitchAlbums.setAlbumTrackOfficialTake(al.id, trackId, take);
          if (!res.ok) throw new Error(res.error);
          al.durations[trackId] = take.duration;
          say(tr('alb_recSaved', { duration: fmtDur(take.duration) }));
          renderEditor();
        } catch (err) { say2(tr('alb_error', { error: err.message })); }
        finally { e.target.disabled = false; }
      };
    } catch (e) { el.innerHTML = `<div class="msg err">${esc(tr('alb_error', { error: e.message }))}</div>`; }
  }

  async function mount(el, ctx) {
    panel = el; S.ctx = ctx;
    panel.innerHTML = `<div class="card"><p class="hint">${esc(ctx.tr('alb_loading'))}</p></div>`;
    try { if (!S.loaded) await load(); renderList(); }
    catch (e) { panel.innerHTML = `<div class="card"><div class="msg err">${esc(ctx.tr('alb_error', { error: e.message }))}</div></div>`; }
  }
  function unmount() { stopPlayback(); closeRecorder(); S.loaded = false; }

  window.LayerPitchStudioAlbums = { mount, unmount };
})();
