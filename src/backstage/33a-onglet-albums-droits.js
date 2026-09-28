/* ---------------- Onglet Albums : co-ayants droit (chantier profils et permissions, étape 4a, 28/09) ----------------
 * D4-D6 du cadrage layerpitch-docs/2026-09-27-cadrage-profils-permissions.md : à la mise en vente, le vendeur déclare
 * s'il est seul propriétaire ou s'il partage les droits (e-mail + part de chaque co-ayant droit, avertissement à
 * reconnaître). Chaque co-ayant droit est invité par e-mail (Edge Function invite-rights-holder) et accepte ou refuse
 * sur invitation.html. Injoignable : « je reverse moi-même sa part ». Refus : vente bloquée. Tout est vérifié côté
 * serveur (set_album_rights, upsert_album, 20260928040000) ; cette section ne fait qu'afficher et envoyer.
 * État par album : albumsState.rights[albumId] = { loaded, loading, declaration, ack, rows: [{ id?, email, pct, status }], msg }. */
function albumRightsState(al) {
  albumsState.rights = albumsState.rights || {};
  if (!albumsState.rights[al.id]) albumsState.rights[al.id] = { loaded: false, loading: false, declaration: 'sole', ack: false, rows: [], msg: null };
  return albumsState.rights[al.id];
}
function albumRightsFromServer(st, data) {
  st.declaration = data.declaration || 'sole';
  st.ack = !!data.ackAt;
  st.rows = (data.holders || []).map(h => ({ id: h.id, email: h.email, pct: String(h.shareBps / 100).replace('.', ','), status: h.status, payoutRole: h.payoutRole, hasAccount: h.hasAccount }));
  st.settled = !!data.settled;
  st.sellerShareBps = data.sellerShareBps;
}
async function loadAlbumRights(al) {
  const st = albumRightsState(al);
  if (st.loaded || st.loading) return;
  st.loading = true;
  const { rights, error } = await window.LayerPitchAlbums.getAlbumRights(al.id);
  st.loading = false;
  if (error) { st.msg = { kind: 'error', text: tr('rightsLoadError', { error }) }; }
  else { albumRightsFromServer(st, rights); st.loaded = true; }
  renderAlbums();
}
const rightsPctToBps = s => Math.round(Number(String(s || '').trim().replace(',', '.')) * 100);
function renderAlbumRights(al, ai) {
  const head = `<label style="margin-top:16px">${tr('rightsTitle')}</label>`;
  if (!al.saved) return head + `<div class="sub">${tr('rightsSaveFirst')}</div>`;
  const st = albumRightsState(al);
  if (!st.loaded) { if (!st.loading) setTimeout(() => loadAlbumRights(al), 0); return head + `<div class="sub">${tr('albumsLoading')}</div>`; }
  const rowStyle = 'display:flex;align-items:center;gap:8px;';
  let html = head + `
    <label style="${rowStyle}font-weight:normal"><input type="radio" name="rights-${escapeAttr(al.id)}" data-rights-field="declaration" data-ai="${ai}" value="sole" style="width:auto;margin:0"${st.declaration === 'sole' ? ' checked' : ''}> ${tr('rightsSole')}</label>
    <label style="${rowStyle}font-weight:normal"><input type="radio" name="rights-${escapeAttr(al.id)}" data-rights-field="declaration" data-ai="${ai}" value="shared" style="width:auto;margin:0"${st.declaration === 'shared' ? ' checked' : ''}> ${tr('rightsShared')}</label>`;
  if (st.declaration === 'shared') {
    const others = st.rows.reduce((s, r) => s + (rightsPctToBps(r.pct) || 0), 0);
    html += `<div style="margin:8px 0 0 22px">
      ${st.rows.map((r, i) => `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px">
          <input type="email" data-rights-row="${i}" data-rights-col="email" data-ai="${ai}" value="${escapeAttr(r.email)}" placeholder="${escapeAttr(tr('rightsEmailPlaceholder'))}" style="flex:1 1 200px;min-width:0">
          <input type="text" inputmode="decimal" data-rights-row="${i}" data-rights-col="pct" data-ai="${ai}" value="${escapeAttr(r.pct)}" placeholder="30" style="width:70px"> %
          ${r.status ? `<span class="badge">${escapeHtml(tr('rightsStatus_' + r.status))}</span>` : ''}
          ${r.id && (r.status === 'pending' || r.status === 'self_pay') ? `<button class="btn btn-small" type="button" data-action="rights-invite" data-ai="${ai}" data-holder="${escapeAttr(r.id)}">${tr('rightsReinvite')}</button>` : ''}
          ${r.id && r.status === 'pending' ? `<button class="btn btn-small" type="button" data-action="rights-self-pay" data-ai="${ai}" data-holder="${escapeAttr(r.id)}" title="${escapeAttr(tr('rightsSelfPayHelp'))}">${tr('rightsSelfPay')}</button>` : ''}
          <button class="btn btn-small btn-danger" type="button" data-action="rights-remove" data-ai="${ai}" data-row="${i}">${tr('deleteBtn')}</button>
        </div>`).join('')}
      <button class="btn btn-small" type="button" data-action="rights-add" data-ai="${ai}" style="margin-top:8px">${tr('rightsAdd')}</button>
      <div class="sub" style="margin-top:6px">${tr('rightsSellerShare', { pct: ((10000 - others) / 100).toLocaleString(currentLang()) })}</div>
      <label style="${rowStyle}font-weight:normal;margin-top:8px;align-items:flex-start"><input type="checkbox" data-rights-field="ack" data-ai="${ai}" style="width:auto;margin:3px 0 0"${st.ack ? ' checked' : ''}> <span class="sub" style="margin:0">${tr('rightsDisclaimer')}</span></label>
    </div>`;
  }
  html += `<div class="actions" style="margin-top:8px"><button class="btn btn-small" type="button" data-action="rights-save" data-ai="${ai}">${tr('rightsSaveBtn')}</button></div>`;
  if (st.declaration === 'shared' && st.loaded && st.rows.some(r => r.status)) html += `<div class="sub" style="margin-top:4px">${tr(st.settled ? 'rightsSettled' : 'rightsNotSettled')}</div>`;
  if (st.msg) html += `<div class="sub" style="margin-top:6px;${st.msg.kind === 'error' ? 'color:#c0392b' : 'color:#2e8b57'}">${escapeHtml(st.msg.text)}</div>`;
  return html;
}
async function inviteRightsHolders(al, ids) {
  const failures = [];
  for (const id of ids) {
    const r = await window.LayerPitchAlbums.inviteRightsHolder(al.id, id, location.origin + '/invitation.html');
    if (!r.ok) failures.push(r.actionLink ? tr('rightsInviteFailedWithLink', { error: r.error, link: r.actionLink }) : r.error);
  }
  return failures;
}
async function saveAlbumRights(ai) {
  const al = albumsState.albums[ai];
  const st = albumRightsState(al);
  const holders = st.declaration === 'shared' ? st.rows.filter(r => r.email.trim()).map(r => ({ email: r.email.trim(), shareBps: rightsPctToBps(r.pct) })) : [];
  st.msg = { kind: 'ok', text: tr('albumSaving') }; renderAlbums();
  const { rights, error } = await window.LayerPitchAlbums.setAlbumRights(al.id, st.declaration, holders, st.ack);
  if (error) { st.msg = { kind: 'error', text: tr('rightsSaveError', { error }) }; renderAlbums(); return; }
  albumRightsFromServer(st, rights);
  if (rights.unlisted) { al.buyable = false; al.savedBuyable = false; }
  const failures = rights.toInvite && rights.toInvite.length ? await inviteRightsHolders(al, rights.toInvite) : [];
  st.msg = failures.length ? { kind: 'error', text: tr('rightsInviteFailed', { errors: failures.join(' / ') }) }
    : { kind: 'ok', text: tr(rights.toInvite && rights.toInvite.length ? 'rightsSavedInvited' : 'rightsSaved', { n: (rights.toInvite || []).length }) + (rights.unlisted ? ' ' + tr('rightsUnlisted') : '') };
  renderAlbums();
}
(function wireAlbumRights() {
  const box = document.getElementById('albumsContainer');
  box.addEventListener('input', e => {
    const d = e.target.dataset;
    if (d.rightsRow == null) return;
    albumRightsState(albumsState.albums[Number(d.ai)]).rows[Number(d.rightsRow)][d.rightsCol] = e.target.value;
  });
  box.addEventListener('change', e => {
    const d = e.target.dataset;
    if (!d.rightsField) return;
    const st = albumRightsState(albumsState.albums[Number(d.ai)]);
    if (d.rightsField === 'declaration') { st.declaration = e.target.value; if (st.declaration === 'shared' && !st.rows.length) st.rows.push({ email: '', pct: '' }); renderAlbums(); }
    if (d.rightsField === 'ack') st.ack = e.target.checked;
  });
  box.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action^="rights-"]');
    if (!btn) return;
    const ai = Number(btn.dataset.ai), al = albumsState.albums[ai], st = albumRightsState(al);
    const act = btn.dataset.action;
    if (act === 'rights-add') { st.rows.push({ email: '', pct: '' }); renderAlbums(); }
    if (act === 'rights-remove') { st.rows.splice(Number(btn.dataset.row), 1); renderAlbums(); }
    if (act === 'rights-save') saveAlbumRights(ai);
    if (act === 'rights-invite') {
      btn.disabled = true;
      const failures = await inviteRightsHolders(al, [btn.dataset.holder]);
      st.msg = failures.length ? { kind: 'error', text: tr('rightsInviteFailed', { errors: failures.join(' / ') }) } : { kind: 'ok', text: tr('rightsInviteSent') };
      renderAlbums();
    }
    if (act === 'rights-self-pay') {
      const ok = await window.LayerPitchNotify.confirm(tr('rightsSelfPayConfirm'), { okLabel: tr('rightsSelfPay') });
      if (!ok) return;
      const { rights, error } = await window.LayerPitchAlbums.markRightsHolderSelfPay(btn.dataset.holder);
      st.msg = error ? { kind: 'error', text: tr('rightsSaveError', { error }) } : { kind: 'ok', text: tr('rightsSelfPayDone') };
      if (rights) albumRightsFromServer(st, rights);
      renderAlbums();
    }
  });
})();
