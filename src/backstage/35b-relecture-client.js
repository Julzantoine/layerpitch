// ---- Relecture client d'un morceau (23/11, migration 20261123010000 ; idée tirée de DropCue) ----
// Sur la fiche d'un morceau : « Relecture client » ouvre un panneau avec
//   - les LIENS de relecture, UN PAR CLIENT (/relecture/<nom>, clé magique ou mot de passe, étiquette « pour qui ») : créer, renommer,
//     désactiver, nouvelle clé, supprimer. La clé d'un lien magique n'est montrée qu'une fois (à la création ou au renouvellement) ;
//   - les COMMENTAIRES reçus, rangés par lien : instant + état du lecteur (boucle, section, intensité, couches, événements, curseurs),
//     « Écouter dans cet état » (ouvre l'aperçu et le remet dans cet état : wrapper.lpReview.apply), répondre, traité, supprimer.
// Ouvrir le panneau vaut lecture des commentaires (la cloche se vide). Admin seulement jusqu'au feu vert track_review.
// Les commentaires d'un lien ne sont jamais montrés à un autre lien, ni sur un AdReel ou une page publique.
const trackReviewOpen = new Set();      // morceaux dont le panneau est ouvert
const trackReviewData = {};             // id du morceau -> { links, comments, reveal: { idDuLien: adresse complète avec clé }, error }
function trackReviewAllowed() { return flagOpen('track_review'); }
function trackReviewAdminOnly() { return typeof myFlagsReleased !== 'undefined' && myFlagsReleased.track_review === false; }
function trackReviewSaved(track) { return !!(publishedCatalog && publishedCatalog.tracks && publishedCatalog.tracks.has(track.id)); }
function trackReviewAddress(slug) { return new URL('/relecture/' + slug, document.baseURI).href; }
function trackReviewSlugSuggestion(track, label) {
  const base = [track.title, label].filter(Boolean).join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  return base.length >= 3 ? base : 'relecture-' + Math.random().toString(36).slice(2, 7);
}
function trackReviewButtonHtml(track, ti) {
  if (!trackReviewAllowed() || isExample(track)) return '';
  const d = trackReviewData[track.id];
  const unseen = d && d.links ? d.links.reduce((n, l) => n + (l.unseen || 0), 0) : 0;
  return `<button class="btn btn-small${trackReviewAdminOnly() ? ' lp-admin-only' : ''}" data-action="track-review" data-ti="${ti}" type="button" title="${escapeAttr(tr('trBtnTitle'))}"${trackReviewAdminOnly() ? ' data-admin-only-flag="track_review"' : ''}>${tr('trBtn')}${unseen ? ` <span class="badge">${unseen}</span>` : ''}</button>`;
}
async function trackReviewRpc(name, args) {
  const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc(name, args);
  if (error) throw new Error(error.message || String(error));
  return data;
}
async function trackReviewLoad(trackId) {
  const prev = trackReviewData[trackId] || {};
  try {
    const [links, comments] = await Promise.all([
      trackReviewRpc('list_track_review_links', { p_track_id: trackId }),
      trackReviewRpc('list_track_review_comments', { p_track_id: trackId }), // les ouvrir vaut lecture
    ]);
    trackReviewData[trackId] = { links: links || [], comments: comments || [], reveal: prev.reveal || {}, error: null };
    // Commentaires lus : les compteurs passent à zéro tout de suite (la cloche suit à sa prochaine vérification).
    trackReviewData[trackId].links.forEach(l => { l.unseen = 0; });
  } catch (e) { trackReviewData[trackId] = { links: prev.links || [], comments: prev.comments || [], reveal: prev.reveal || {}, error: e.message }; }
}
function trackReviewToggle(ti, cardEl) {
  const track = library[ti];
  if (!track) return;
  if (trackReviewOpen.has(track.id)) trackReviewOpen.delete(track.id); else trackReviewOpen.add(track.id);
  trackReviewRender(track, ti, cardEl);
  if (trackReviewOpen.has(track.id) && trackReviewSaved(track)) trackReviewLoad(track.id).then(() => trackReviewRender(track, ti, cardEl));
}
function trackReviewRender(track, ti, cardEl) {
  const host = cardEl && cardEl.querySelector('[data-role="reviewHost"]');
  if (!host) return;
  if (!trackReviewOpen.has(track.id)) { host.innerHTML = ''; return; }
  if (!trackReviewSaved(track)) { host.innerHTML = `<div class="tr-panel"><div class="hint-inline">${escapeHtml(tr('trSaveFirst'))}</div></div>`; return; }
  const d = trackReviewData[track.id];
  if (!d) { host.innerHTML = `<div class="tr-panel"><div class="hint-inline">…</div></div>`; return; }
  const lang = currentLang();
  const linkName = l => l.label || l.slug;
  const linksHtml = d.links.map(l => {
    const full = d.reveal[l.id];
    return `<div class="tr-link${l.enabled ? '' : ' tr-off'}" data-link="${escapeAttr(l.id)}">
      <div class="tr-link-head">
        <input type="text" class="tr-label" data-tr-label="${escapeAttr(l.id)}" maxlength="60" value="${escapeAttr(l.label || '')}" placeholder="${escapeAttr(tr('trLabelPlaceholder'))}">
        <span class="tr-meta">${escapeHtml(tr('trLinkComments', { n: l.comments || 0 }))}${l.enabled ? '' : ' · ' + escapeHtml(tr('trLinkOff'))} · ${escapeHtml(tr(l.mode === 'password' ? 'trModePassword' : 'trModeMagic'))}</span>
      </div>
      <div class="tr-address"><code>${escapeHtml(full || trackReviewAddress(l.slug))}</code>
        <button class="btn btn-small" type="button" data-tr-copy="${escapeAttr(l.id)}">${escapeHtml(tr(full ? 'trCopyFull' : 'trCopyAddress'))}</button></div>
      ${full ? `<div class="hint-inline tr-once">${escapeHtml(tr('trKeyOnce'))}</div>` : (l.mode === 'magic' ? `<div class="hint-inline">${escapeHtml(tr('trKeyLost'))}</div>` : '')}
      <div class="tr-actions">
        <button class="btn btn-small" type="button" data-tr-enable="${escapeAttr(l.id)}">${escapeHtml(tr(l.enabled ? 'trDisable' : 'trEnable'))}</button>
        ${l.mode === 'magic' ? `<button class="btn btn-small" type="button" data-tr-rotate="${escapeAttr(l.id)}">${escapeHtml(tr('trRotate'))}</button>` : `<button class="btn btn-small" type="button" data-tr-password="${escapeAttr(l.id)}">${escapeHtml(tr('trNewPassword'))}</button>`}
        <button class="btn btn-small btn-danger" type="button" data-tr-delete="${escapeAttr(l.id)}">${escapeHtml(tr('deleteBtn'))}</button>
      </div>
    </div>`;
  }).join('');
  const byLink = id => d.comments.filter(c => c.linkId === id);
  const commentsHtml = d.links.filter(l => byLink(l.id).length).map(l => {
    const all = byLink(l.id);
    const top = all.filter(c => !c.parentId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return `<div class="tr-group"><div class="tr-group-title">${escapeHtml(linkName(l))}</div>${top.map(c => {
      const desc = window.LayerPitchReviewState.describe(c.state || { t: c.t }, lang);
      const replies = all.filter(r => r.parentId === c.id);
      return `<div class="tr-comment${c.resolved ? ' tr-resolved' : ''}">
        <div class="tr-comment-meta"><strong>${escapeHtml(desc.at)}${desc.where ? ' · ' + escapeHtml(desc.where) : ''}</strong> · ${escapeHtml(c.author)}${c.resolved ? ' · ✓ ' + escapeHtml(tr('trResolved')) : ''}</div>
        ${desc.chips.length ? `<div class="tr-chips">${desc.chips.map(x => `<span class="tr-chip">${escapeHtml(x)}</span>`).join('')}</div>` : ''}
        <div class="tr-body">${escapeHtml(c.body)}</div>
        ${replies.map(r => `<div class="tr-reply"><strong>${escapeHtml(r.author)}</strong> ${escapeHtml(r.body)}</div>`).join('')}
        <div class="tr-actions">
          ${c.state ? `<button class="btn btn-small" type="button" data-tr-listen="${escapeAttr(c.id)}">▶ ${escapeHtml(tr('trListen'))}</button>` : ''}
          <button class="btn btn-small" type="button" data-tr-reply="${escapeAttr(c.id)}">${escapeHtml(tr('trReply'))}</button>
          <button class="btn btn-small" type="button" data-tr-resolve="${escapeAttr(c.id)}">${escapeHtml(tr(c.resolved ? 'trUnresolve' : 'trResolve'))}</button>
          <button class="btn btn-small btn-danger" type="button" data-tr-remove="${escapeAttr(c.id)}">${escapeHtml(tr('deleteBtn'))}</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }).join('');
  host.innerHTML = `<div class="tr-panel">
    <div class="tr-title">${escapeHtml(tr('trTitle'))}</div>
    <div class="hint-inline">${escapeHtml(tr('trIntro'))}</div>
    ${d.error ? `<div class="hint-inline" style="color:#b45309">${escapeHtml(d.error)}</div>` : ''}
    ${linksHtml || `<div class="hint-inline">${escapeHtml(tr('trNoLinks'))}</div>`}
    <div class="tr-new">
      <input type="text" data-tr-new-label maxlength="60" placeholder="${escapeAttr(tr('trLabelPlaceholder'))}">
      <select data-tr-new-mode><option value="magic">${escapeHtml(tr('trModeMagic'))}</option><option value="password">${escapeHtml(tr('trModePassword'))}</option></select>
      <input type="password" data-tr-new-password placeholder="${escapeAttr(tr('trPasswordPlaceholder'))}" hidden autocomplete="new-password">
      <button class="btn btn-small btn-primary" type="button" data-tr-create>${escapeHtml(tr('trCreate'))}</button>
    </div>
    <div class="tr-title" style="margin-top:14px">${escapeHtml(tr('trCommentsTitle'))}</div>
    ${commentsHtml || `<div class="hint-inline">${escapeHtml(tr('trNoComments'))}</div>`}
  </div>`;
  trackReviewWire(track, ti, cardEl, host);
}
function trackReviewWire(track, ti, cardEl, host) {
  const d = trackReviewData[track.id];
  const rerender = () => trackReviewRender(track, ti, cardEl);
  const reload = async () => { await trackReviewLoad(track.id); rerender(); };
  const fail = e => window.LayerPitchNotify.error(tr('trError', { error: e.message || e }));
  // Lien enregistré : une clé neuve (lien magique) est gardée pour l'affichage, cette seule fois.
  const keep = r => { if (r && r.secret) d.reveal[r.id] = trackReviewAddress(r.slug) + '#k=' + encodeURIComponent(r.secret); };
  const set = (linkId, o) => trackReviewRpc('set_track_review_link', Object.assign({ p_track_id: track.id, p_link_id: linkId, p_enabled: null, p_slug: null, p_mode: null, p_password: null, p_rotate: false, p_label: null }, o));
  const modeSel = host.querySelector('[data-tr-new-mode]'), pw = host.querySelector('[data-tr-new-password]');
  if (modeSel) modeSel.addEventListener('change', () => { pw.hidden = modeSel.value !== 'password'; });
  const createBtn = host.querySelector('[data-tr-create]');
  if (createBtn) createBtn.addEventListener('click', async () => {
    const label = host.querySelector('[data-tr-new-label]').value.trim();
    const mode = modeSel.value;
    if (mode === 'password' && pw.value.length < 6) { window.LayerPitchNotify.error(tr('trPasswordShort')); pw.focus(); return; }
    let slug = trackReviewSlugSuggestion(track, label);
    slug = await window.LayerPitchNotify.prompt(tr('trSlugPrompt'), { inputValue: slug, okLabel: tr('trCreate') });
    if (slug == null) return;
    createBtn.disabled = true;
    try { keep(await set(null, { p_slug: slug.trim(), p_mode: mode, p_password: mode === 'password' ? pw.value : null, p_label: label || null })); await reload(); }
    catch (e) { fail(e); createBtn.disabled = false; }
  });
  host.querySelectorAll('[data-tr-label]').forEach(inp => inp.addEventListener('change', async () => {
    try { await set(inp.dataset.trLabel, { p_label: inp.value.trim() }); await reload(); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-copy]').forEach(b => b.addEventListener('click', () => {
    const l = d.links.find(x => x.id === b.dataset.trCopy); if (!l) return;
    const url = d.reveal[l.id] || trackReviewAddress(l.slug);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => window.LayerPitchNotify.success(tr('trCopied'))).catch(() => window.LayerPitchNotify.error(tr('copyFailedAlert')));
  }));
  host.querySelectorAll('[data-tr-enable]').forEach(b => b.addEventListener('click', async () => {
    const l = d.links.find(x => x.id === b.dataset.trEnable); if (!l) return;
    try { await set(l.id, { p_enabled: !l.enabled }); await reload(); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-rotate]').forEach(b => b.addEventListener('click', async () => {
    if (!(await window.LayerPitchNotify.confirm(tr('trRotateConfirm')))) return;
    try { keep(await set(b.dataset.trRotate, { p_rotate: true })); await reload(); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-password]').forEach(b => b.addEventListener('click', async () => {
    const p = await window.LayerPitchNotify.prompt(tr('trPasswordPlaceholder'), { inputValue: '', okLabel: tr('trNewPassword') });
    if (p == null) return;
    if (p.length < 6) { window.LayerPitchNotify.error(tr('trPasswordShort')); return; }
    try { await set(b.dataset.trPassword, { p_mode: 'password', p_password: p }); await reload(); window.LayerPitchNotify.success(tr('trPasswordDone')); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-delete]').forEach(b => b.addEventListener('click', async () => {
    const l = d.links.find(x => x.id === b.dataset.trDelete); if (!l) return;
    if (!(await window.LayerPitchNotify.confirm(tr('trDeleteConfirm', { name: l.label || l.slug, n: l.comments || 0 }), { danger: true }))) return;
    try { await trackReviewRpc('delete_track_review_link', { p_link_id: l.id }); delete d.reveal[l.id]; await reload(); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-reply]').forEach(b => b.addEventListener('click', async () => {
    const text = await window.LayerPitchNotify.prompt(tr('trReplyPrompt'), { inputValue: '', okLabel: tr('trReply') });
    if (!text || !text.trim()) return;
    try { await trackReviewRpc('reply_review_comment', { p_parent_id: b.dataset.trReply, p_body: text.trim(), p_author: tr('trOwnerName'), p_studio: false }); await reload(); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-resolve]').forEach(b => b.addEventListener('click', async () => {
    const c = d.comments.find(x => x.id === b.dataset.trResolve); if (!c) return;
    try { await trackReviewRpc('resolve_review_comment', { p_id: c.id, p_resolved: !c.resolved, p_studio: false }); await reload(); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!(await window.LayerPitchNotify.confirm(tr('trRemoveConfirm'), { danger: true }))) return;
    try { await trackReviewRpc('delete_review_comment', { p_id: b.dataset.trRemove, p_studio: false }); await reload(); } catch (e) { fail(e); }
  }));
  host.querySelectorAll('[data-tr-listen]').forEach(b => b.addEventListener('click', () => trackReviewListen(ti, cardEl, d.comments.find(x => x.id === b.dataset.trListen))));
}
// « Écouter dans cet état » : ouvre l'aperçu du morceau s'il ne l'est pas, attend son lecteur, puis le remet dans l'état du commentaire.
async function trackReviewListen(ti, cardEl, comment) {
  if (!comment || !comment.state) return;
  const host = cardEl.querySelector('[data-role="previewHost"]');
  if (!host) return;
  if (host.dataset.active !== '1') togglePreview(ti, cardEl, { autoplay: false }); // la remise en place lance elle-même la lecture
  let row = null;
  for (let i = 0; i < 50 && !(row && row.lpReview); i++) {
    row = host.querySelector('.track-row-wrapper');
    if (!(row && row.lpReview)) await new Promise(r => setTimeout(r, 100));
  }
  if (!row || !row.lpReview) return;
  const ok = await row.lpReview.apply(comment.state);
  if (!ok) window.LayerPitchNotify.info(tr('trListenFailed'));
  if (host.scrollIntoView) host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Arrivée depuis la cloche ou l'e-mail : layerpitch-backstage.html?tab=library&review=<id du morceau> ouvre la bibliothèque sur ce
// morceau, panneau « Relecture client » ouvert (dès que les données du Backstage sont chargées).
(function openTrackReviewFromUrl() {
  const id = new URLSearchParams(location.search).get('review');
  if (!id) return;
  let waited = 0;
  const timer = setInterval(() => {
    waited += 200;
    if (waited > 60000) { clearInterval(timer); return; }
    if (!dataLoadOk || !publishedCatalog || !library.some(t => t.id === id) || !trackReviewAllowed()) return;
    clearInterval(timer);
    openTab('library');
    manageLibrarySelectedId = id;
    trackReviewOpen.add(id);
    renderLibrary();
    trackReviewLoad(id).then(() => renderLibrary());
  }, 200);
})();
