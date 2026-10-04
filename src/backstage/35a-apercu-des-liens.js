/* ---------------- Aperçu des liens partagés (1er/10, rubrique Réseaux sociaux) ----------------
 * Titre, description et image de la carte qu'affichent LinkedIn, Facebook, WhatsApp, Discord… quand on colle un lien de l'AdReel
 * (voir cloudflare/LISEZMOI.md et la fonction get_share_preview). Beaucoup de compositeurs mettent leur image dans le bloc
 * Header et n'ont ni photo ni titre dans le profil : ces champs passent avant le profil. Enregistrés à la publication
 * (settings.share_preview) ; l'image choisie attend la publication, comme les autres images. */
function renderSharePreviewMock() {
  const mock = document.getElementById('sharePreviewMock');
  if (!mock) return;
  const src = sharePreviewPendingFile ? (sharePreviewPendingFileUrl || '') : (sharePreview.image ? MEDIA_BASE + 'images/' + sharePreview.image : '');
  const img = src ? `<img src="${escapeAttr(src)}" alt="" style="display:block;width:100%;aspect-ratio:1200/630;object-fit:cover">` : `<div style="aspect-ratio:1200/630;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-dimmer)">${tr('sharePreviewDefaultImage')}</div>`;
  const title = (sharePreview.title || '').trim() || tr('sharePreviewMockTitleFallback');
  const desc = (sharePreview.description || '').trim();
  mock.innerHTML = `${img}<div style="padding:10px 12px"><div style="font-size:11px;color:var(--text-dimmer)">beta.layerpitch.com</div><div style="font-weight:600;font-size:13px;margin-top:2px">${escapeHtml(title)}</div>${desc ? `<div style="font-size:12px;color:var(--text-dim);margin-top:2px">${escapeHtml(desc)}</div>` : ''}</div>`;
}
let sharePreviewPendingFileUrl = null;
function fillSharePreviewFields() {
  const t = document.getElementById('sharePreviewTitleInput');
  if (!t) return;
  t.value = sharePreview.title || '';
  document.getElementById('sharePreviewDescInput').value = sharePreview.description || '';
  const ctrl = document.getElementById('sharePreviewImageCtrl');
  ctrl.innerHTML = fileCtrlHtml(tr('chooseSharePreviewImage'), `<button type="button" class="btn btn-small btn-danger" data-role="removeSharePreviewImage">${tr('removeSharePreviewImage')}</button>`);
  const rm = ctrl.querySelector('[data-role="removeSharePreviewImage"]');
  const refreshRm = () => { rm.hidden = !(sharePreviewPendingFile || sharePreview.image); };
  wireFileControl(ctrl, 'image/*', () => sharePreviewPendingFile, () => sharePreview.image, f => {
    if (sharePreviewPendingFileUrl) { URL.revokeObjectURL(sharePreviewPendingFileUrl); sharePreviewPendingFileUrl = null; }
    sharePreviewPendingFile = f || null;
    if (f) sharePreviewPendingFileUrl = URL.createObjectURL(f);
    hasUnsavedEdits = true; refreshRm(); renderSharePreviewMock();
  }, () => sharePreview.imageOriginalName);
  refreshRm();
  rm.addEventListener('click', () => {
    // L'image publiée est effacée du stockage à la prochaine publication, si plus rien ne la référence (file d'orphelins).
    if (sharePreview.image) queueR2Delete('images/' + sharePreview.image);
    sharePreview.image = null; sharePreview.imageOriginalName = null;
    if (sharePreviewPendingFileUrl) { URL.revokeObjectURL(sharePreviewPendingFileUrl); sharePreviewPendingFileUrl = null; }
    sharePreviewPendingFile = null;
    hasUnsavedEdits = true;
    fillSharePreviewFields();
  });
  renderSharePreviewMock();
}
document.getElementById('sharePreviewTitleInput').addEventListener('input', e => { sharePreview.title = e.target.value; hasUnsavedEdits = true; renderSharePreviewMock(); });
document.getElementById('sharePreviewDescInput').addEventListener('input', e => { sharePreview.description = e.target.value; hasUnsavedEdits = true; renderSharePreviewMock(); });
fillSharePreviewFields();
