// ============================================================================
// Suivi des envois (23/11, cadrage layerpitch-docs/2026-11-23-suivi-des-envois-cadrage.md ; migration 20261123010000).
// « Envoyer à… » : le compositeur déclare à qui il envoie un AdReel (studio, personne, note) et reçoit un lien rien qu'à ce
// destinataire (adresse habituelle + #r=<code>). Il le colle dans SON mail : LayerPitch ne lit jamais sa boîte, créer le
// lien = enregistrer l'envoi. Onglet « Envois » : tous les envois, la liste « à relancer » en haut, statuts, écoutes.
// Réservé à l'admin jusqu'au feu vert 'sends_tracking' (bouton et onglet cachés sinon, barrière aussi côté serveur).
// ============================================================================

// Délais de la liste « à relancer » (en jours) -- à ajuster après les premiers essais.
const SENDS_REMIND_UNHEARD_DAYS = 10; // envoyé, jamais écouté
const SENDS_REMIND_HEARD_DAYS = 5;    // écouté, toujours sans réponse
let sendsCache = null;       // { tier, detailed, sends: [...] }
let sendsLoading = false;
let sendsFilter = { text: '', status: '', studio: '' };
let sendsOpenId = null;      // envoi dont le détail est déplié

function sendsRpc(name, args) { return window.LayerPitchSupabaseClient.getClient().rpc(name, args || {}); }
function sendsDays(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null; }
function sendsDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(currentLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return iso.slice(0, 10); }
}
function sendsAgo(iso) {
  const d = sendsDays(iso);
  if (d == null) return '';
  return d <= 0 ? tr('sendsToday') : d === 1 ? tr('sendsYesterday') : tr('sendsDaysAgo', { n: d });
}
// Statut affiché : « Écouté » n'est pas stocké, il se déduit des visites tant que le compositeur n'a rien choisi d'autre.
function sendShownStatus(s) { return s.status === 'sent' && s.listened ? 'listened' : s.status; }
function sendLink(s) {
  const base = computeAdReelUrl(s.adReelId);
  return base ? `${base}#r=${s.code}` : null;
}
// Raison de relancer, ou null.
function sendRemindReason(s) {
  if (s.status !== 'sent' || s.adReelExists === false) return null;
  if (!s.listened) {
    const since = s.followedUpAt && s.followedUpAt > s.createdAt ? s.followedUpAt : s.createdAt;
    const d = sendsDays(since);
    if (d >= SENDS_REMIND_UNHEARD_DAYS) return s.followedUpAt ? tr('sendsRemindUnheardAfterFollowUp', { n: d }) : tr('sendsRemindUnheard', { n: d });
    return null;
  }
  const since = s.followedUpAt && s.followedUpAt > s.firstVisitAt ? s.followedUpAt : s.firstVisitAt;
  const d = sendsDays(since);
  if (d >= SENDS_REMIND_HEARD_DAYS) {
    return s.visits != null && s.visits > 1 ? tr('sendsRemindHeardMany', { n: s.visits, d: sendsDays(s.lastVisitAt) }) : tr('sendsRemindHeard', { d: sendsDays(s.lastVisitAt) });
  }
  return null;
}

async function loadSends(force) {
  if (!flagOpen('sends_tracking')) return;
  if (sendsLoading) return;
  if (sendsCache && !force) { renderSends(); return; }
  sendsLoading = true;
  const host = document.getElementById('sendsList');
  if (host && !sendsCache) host.innerHTML = `<div class="hint">${tr('sendsLoading')}</div>`;
  try {
    await loadPostgresReadScripts();
    const { data, error } = await sendsRpc('list_my_adreel_sends');
    if (error) throw error;
    sendsCache = data;
  } catch (e) {
    if (host) host.innerHTML = `<div class="hint">${escapeHtml(tr('errorPrefix', { message: (e && e.message) || String(e) }))}</div>`;
    sendsLoading = false;
    return;
  }
  sendsLoading = false;
  renderSends();
}

function sendRowHtml(s, remind) {
  const shown = sendShownStatus(s);
  const who = escapeHtml(s.studio) + (s.person ? ` <span class="sends-person">· ${escapeHtml(s.person)}</span>` : '');
  const adreel = escapeHtml(s.adReelLabel || s.adReelId) + (s.adReelExists === false ? ` <span class="sends-gone">${tr('sendsAdreelGone')}</span>` : '');
  let listen = '';
  if (s.listened) {
    listen = sendsCache.detailed
      ? tr(s.visits > 1 ? 'sendsVisitsMany' : 'sendsVisitsOne', { n: s.visits }) + (s.plays ? ' · ' + tr(s.plays > 1 ? 'sendsPlaysMany' : 'sendsPlaysOne', { n: s.plays }) : '') + ' · ' + tr('sendsLastVisit', { ago: sendsAgo(s.lastVisitAt) })
      : tr('sendsLastVisit', { ago: sendsAgo(s.lastVisitAt) });
  } else listen = tr('sendsNotHeard');
  const statusSel = `<select class="sends-status sends-status-${shown}" data-send-status="${s.id}" aria-label="${escapeAttr(tr('sendsStatusLabel'))}">
      ${['sent', 'replied', 'signed', 'dropped'].map(k => `<option value="${k}"${s.status === k ? ' selected' : ''}>${escapeHtml(tr(k === 'sent' && s.listened ? 'sendsStatus_listened' : 'sendsStatus_' + k))}</option>`).join('')}
    </select>`;
  // Le détail ne s'ouvre que dans la liste principale ; depuis « À relancer », un clic l'y ouvre et y descend.
  const open = !remind && sendsOpenId === s.id;
  return `<div class="sends-row${open ? ' is-open' : ''}" data-send-id="${s.id}">
    <div class="sends-row-main">
      <button type="button" class="sends-who" ${remind ? `data-send-jump="${s.id}"` : `data-send-toggle="${s.id}" aria-expanded="${open}"`}>${who}</button>
      <div class="sends-meta">${adreel} · ${escapeHtml(tr('sendsSentOn', { date: sendsDate(s.createdAt) }))}</div>
      ${remind ? `<div class="sends-remind-reason">${escapeHtml(remind)}</div>` : `<div class="sends-listen${s.listened ? ' is-heard' : ''}">${escapeHtml(listen)}</div>`}
    </div>
    <div class="sends-row-actions">
      ${statusSel}
      <button type="button" class="btn btn-small" data-send-copy="${s.id}"${s.adReelExists === false ? ' disabled' : ''}>${tr('copyLink')}</button>
      ${remind ? `<button type="button" class="btn btn-small" data-send-followup="${s.id}">${tr('sendsFollowedUpBtn')}</button>` : ''}
    </div>
    ${open ? sendDetailHtml(s, listen) : ''}
  </div>`;
}

function sendDetailHtml(s, listen) {
  const titleOf = id => { const t = library.find(x => x.id === id); return t ? (t.title || t.id) : id; };
  let heard = '';
  if (s.listened && sendsCache.detailed) {
    heard = `<div class="sends-detail-line">${escapeHtml(listen)} · ${escapeHtml(tr('sendsFirstVisit', { date: sendsDate(s.firstVisitAt) }))}</div>`
      + (s.trackIds && s.trackIds.length ? `<div class="sends-detail-line">${escapeHtml(tr('sendsTracksHeard'))} ${s.trackIds.map(id => `<span class="sends-track">${escapeHtml(titleOf(id))}</span>`).join(' ')}</div>` : '');
  } else if (s.listened) {
    heard = `<div class="sends-detail-line">${escapeHtml(listen)}</div><div class="sends-detail-line hint">${escapeHtml(tr('sendsDetailLocked'))}</div>`;
  }
  const history = sendsCache.sends.filter(o => o.id !== s.id && o.studio.toLowerCase() === s.studio.toLowerCase());
  return `<div class="sends-detail">
    ${heard}
    ${s.followedUpAt ? `<div class="sends-detail-line">${escapeHtml(tr('sendsFollowedUpOn', { date: sendsDate(s.followedUpAt) }))} <button type="button" class="btn-link" data-send-unfollowup="${s.id}">${tr('sendsUndo')}</button></div>` : ''}
    <div class="sends-detail-grid">
      <label>${tr('sendsStudioLabel')}<input type="text" maxlength="120" data-send-field="studio" value="${escapeAttr(s.studio)}"></label>
      <label>${tr('sendsPersonLabel')}<input type="text" maxlength="120" data-send-field="person" value="${escapeAttr(s.person)}"></label>
    </div>
    <label class="sends-note-label">${tr('sendsNoteLabel')}<textarea rows="3" maxlength="4000" data-send-field="note">${escapeHtml(s.note)}</textarea></label>
    ${history.length ? `<div class="sends-detail-line"><button type="button" class="btn-link" data-send-studio="${escapeAttr(s.studio)}">${escapeHtml(tr('sendsStudioHistory', { n: history.length, studio: s.studio }))}</button></div>` : ''}
    <div class="sends-detail-actions">
      <button type="button" class="btn btn-small btn-danger" data-send-delete="${s.id}">${tr('sendsDelete')}</button>
      <button type="button" class="btn btn-small btn-primary" data-send-save="${s.id}">${tr('sendsSave')}</button>
    </div>
  </div>`;
}

function renderSends() {
  const host = document.getElementById('sendsList');
  const remindHost = document.getElementById('sendsRemind');
  if (!host || !sendsCache) return;
  const all = sendsCache.sends || [];
  // Liste « à relancer »
  const reminders = all.map(s => ({ s, why: sendRemindReason(s) })).filter(x => x.why);
  remindHost.hidden = !reminders.length;
  remindHost.innerHTML = reminders.length ? `<h3 class="sends-h3">${tr('sendsRemindTitle')} <span class="sends-count">${reminders.length}</span></h3>` + reminders.map(x => sendRowHtml(x.s, x.why)).join('') : '';
  // Filtre par studio (historique) : bandeau pour revenir à tout
  const studioBar = document.getElementById('sendsStudioBar');
  studioBar.hidden = !sendsFilter.studio;
  studioBar.innerHTML = sendsFilter.studio ? `${escapeHtml(tr('sendsStudioFilterOn', { studio: sendsFilter.studio }))} <button type="button" class="btn-link" data-send-studio="">${tr('sendsShowAll')}</button>` : '';
  const text = sendsFilter.text.trim().toLowerCase();
  const rows = all.filter(s => {
    if (sendsFilter.studio && s.studio.toLowerCase() !== sendsFilter.studio.toLowerCase()) return false;
    if (sendsFilter.status && sendShownStatus(s) !== sendsFilter.status) return false;
    if (text && ![s.studio, s.person, s.note, s.adReelLabel].join(' ').toLowerCase().includes(text)) return false;
    return true;
  });
  if (!all.length) { host.innerHTML = `<div class="sends-empty">${tr('sendsEmpty')}</div>`; return; }
  host.innerHTML = `<h3 class="sends-h3">${tr('sendsAllTitle')} <span class="sends-count">${rows.length}</span></h3>`
    + (rows.length ? rows.map(s => sendRowHtml(s, null)).join('') : `<div class="sends-empty">${tr('sendsNoMatch')}</div>`);
  const dl = document.getElementById('sendStudioSuggestions');
  if (dl) dl.innerHTML = [...new Set(all.map(s => s.studio))].map(n => `<option value="${escapeAttr(n)}"></option>`).join('');
}

// Copie du lien destinataire (rappels mot de passe / lien magique comme pour le lien normal).
async function copySendLink(s) {
  const ar = adReels.find(a => a.id === s.adReelId);
  if (ar && ar.accessMode === 'magic') {
    // Le jeton magique n'est montré qu'une fois à sa création : on ne peut pas refaire le lien complet. Le compositeur ajoute le code.
    const piece = `&r=${s.code}`;
    try { await navigator.clipboard.writeText(piece); } catch (e) { /* le texte reste lisible dans le message */ }
    window.LayerPitchNotify.info(tr('sendsMagicHint', { piece }));
    return;
  }
  const url = sendLink(s);
  if (!url) { window.LayerPitchNotify.info(adReelUrlMissingText(ar)); return; }
  try { await navigator.clipboard.writeText(url); window.LayerPitchNotify.success ? window.LayerPitchNotify.success(tr('sendsLinkCopied')) : window.LayerPitchNotify.info(tr('sendsLinkCopied')); }
  catch (e) { window.LayerPitchNotify.error(tr('copyFailedAlert')); return; }
  if (ar && ar.accessMode === 'password') window.LayerPitchNotify.info(tr('sharePasswordReminder'));
}

async function updateSend(id, patch) {
  const { error } = await sendsRpc('update_adreel_send', { p_id: id, p: patch });
  if (error) { window.LayerPitchNotify.error(tr('errorPrefix', { message: error.message })); return false; }
  await loadSends(true);
  return true;
}

// ---- Fenêtre « Envoyer à… » ----
function openSendModal(adReelId) {
  const sel = document.getElementById('sendAdReel');
  const real = adReels.filter(a => !isExample(a));
  sel.innerHTML = real.map(a => `<option value="${escapeAttr(a.id)}">${escapeHtml(a.label || a.id)}</option>`).join('');
  sel.value = real.some(a => a.id === adReelId) ? adReelId : (real[0] ? real[0].id : '');
  ['sendStudio', 'sendPerson', 'sendNote'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('sendFormStep').hidden = false;
  document.getElementById('sendDoneStep').hidden = true;
  document.getElementById('sendModalMsg').textContent = '';
  document.getElementById('sendModalOverlay').hidden = false;
  if (!sendsCache) loadSends(); // suggestions de studios déjà connus
  document.getElementById('sendStudio').focus();
}
function closeSendModal() { document.getElementById('sendModalOverlay').hidden = true; }

async function createSendFromModal() {
  const msg = document.getElementById('sendModalMsg');
  const adReelId = document.getElementById('sendAdReel').value;
  const studio = document.getElementById('sendStudio').value.trim();
  if (!studio) { msg.textContent = tr('sendsStudioRequired'); document.getElementById('sendStudio').focus(); return; }
  if (!computeAdReelUrl(adReelId)) { msg.textContent = adReelUrlMissingText(adReels.find(a => a.id === adReelId)); return; }
  msg.textContent = '…';
  await loadPostgresReadScripts();
  const { data, error } = await sendsRpc('create_adreel_send', {
    p_ad_reel_id: adReelId, p_studio: studio,
    p_person: document.getElementById('sendPerson').value.trim(), p_note: document.getElementById('sendNote').value,
  });
  if (error) { msg.textContent = /AdReel introuvable/.test(error.message) ? tr('sendsPublishFirst') : tr('errorPrefix', { message: error.message }); return; }
  msg.textContent = '';
  const s = { id: data.id, code: data.code, adReelId, studio };
  const ar = adReels.find(a => a.id === adReelId);
  const out = document.getElementById('sendLinkOut');
  const hint = document.getElementById('sendDoneHint');
  if (ar && ar.accessMode === 'magic') { out.value = `&r=${s.code}`; hint.textContent = tr('sendsMagicHint', { piece: out.value }); }
  else { out.value = sendLink(s); hint.textContent = ar && ar.accessMode === 'password' ? tr('sendsDoneHintPassword') : tr('sendsDoneHint'); }
  document.getElementById('sendDoneTitle').textContent = tr('sendsDoneTitle', { studio });
  document.getElementById('sendFormStep').hidden = true;
  document.getElementById('sendDoneStep').hidden = false;
  out.select();
  trackBackstageEvent('send_created', {});
  loadSends(true);
}

document.getElementById('btnSendAdReel').addEventListener('click', () => openSendModal(currentAdReelId));
document.getElementById('btnNewSend').addEventListener('click', () => openSendModal(currentAdReelId));
document.getElementById('sendCancel').addEventListener('click', closeSendModal);
document.getElementById('sendClose').addEventListener('click', () => { closeSendModal(); });
document.getElementById('sendOk').addEventListener('click', createSendFromModal);
document.getElementById('sendModalOverlay').addEventListener('click', e => { if (e.target.id === 'sendModalOverlay') closeSendModal(); });
document.getElementById('sendModalOverlay').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSendModal();
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !document.getElementById('sendFormStep').hidden) { e.preventDefault(); createSendFromModal(); }
});
document.getElementById('sendCopy').addEventListener('click', async () => {
  const input = document.getElementById('sendLinkOut');
  try { await navigator.clipboard.writeText(input.value); document.getElementById('sendCopy').textContent = tr('copiedStatus'); setTimeout(() => { document.getElementById('sendCopy').textContent = tr('copyLink'); }, 1500); }
  catch (e) { input.select(); }
});

// ---- Onglet Envois ----
document.getElementById('sendsSearch').addEventListener('input', e => { sendsFilter.text = e.target.value; renderSends(); });
document.getElementById('sendsStatusFilter').addEventListener('change', e => { sendsFilter.status = e.target.value; renderSends(); });
document.querySelector('[data-panel="sends"]').addEventListener('change', async e => {
  const sel = e.target.closest('[data-send-status]');
  if (sel) await updateSend(sel.dataset.sendStatus, { status: sel.value });
});
document.querySelector('[data-panel="sends"]').addEventListener('click', async e => {
  const find = id => (sendsCache && sendsCache.sends || []).find(s => s.id === id);
  const t = e.target;
  const toggle = t.closest('[data-send-toggle]');
  if (toggle) { sendsOpenId = sendsOpenId === toggle.dataset.sendToggle ? null : toggle.dataset.sendToggle; renderSends(); return; }
  const jump = t.closest('[data-send-jump]');
  if (jump) {
    sendsOpenId = jump.dataset.sendJump;
    sendsFilter = { text: '', status: '', studio: '' };
    document.getElementById('sendsSearch').value = ''; document.getElementById('sendsStatusFilter').value = '';
    renderSends();
    const row = document.querySelector(`#sendsList [data-send-id="${sendsOpenId}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const copy = t.closest('[data-send-copy]');
  if (copy) { const s = find(copy.dataset.sendCopy); if (s) copySendLink(s); return; }
  const fu = t.closest('[data-send-followup]');
  if (fu) { await updateSend(fu.dataset.sendFollowup, { followedUp: true }); return; }
  const unfu = t.closest('[data-send-unfollowup]');
  if (unfu) { await updateSend(unfu.dataset.sendUnfollowup, { followedUp: false }); return; }
  const studio = t.closest('[data-send-studio]');
  if (studio) { sendsFilter.studio = studio.dataset.sendStudio; renderSends(); return; }
  const save = t.closest('[data-send-save]');
  if (save) {
    const row = save.closest('.sends-row');
    const patch = {};
    row.querySelectorAll('[data-send-field]').forEach(f => { patch[f.dataset.sendField] = f.value; });
    if (!patch.studio || !patch.studio.trim()) { window.LayerPitchNotify.info(tr('sendsStudioRequired')); return; }
    if (await updateSend(save.dataset.sendSave, patch)) window.LayerPitchNotify.success ? window.LayerPitchNotify.success(tr('sendsSaved')) : null;
    return;
  }
  const del = t.closest('[data-send-delete]');
  if (del) {
    const s = find(del.dataset.sendDelete);
    if (!s || !(await window.LayerPitchNotify.confirm(tr('sendsDeleteConfirm', { studio: s.studio }), { okLabel: tr('sendsDelete'), danger: true }))) return;
    const { error } = await sendsRpc('delete_adreel_send', { p_id: s.id });
    if (error) { window.LayerPitchNotify.error(tr('errorPrefix', { message: error.message })); return; }
    sendsOpenId = null;
    await loadSends(true);
  }
});
