/* ---------------- Aperçu des liens partagés (1er/10, rubrique Réseaux sociaux) ----------------
 * Titre, description et image de la carte qu'affichent LinkedIn, Facebook, WhatsApp, Discord… quand on colle un lien de l'AdReel
 * (voir cloudflare/LISEZMOI.md et la fonction get_share_preview). Beaucoup de compositeurs mettent leur image dans le bloc
 * Header et n'ont ni photo ni titre dans le profil : ces champs passent avant le profil. Enregistrés à la publication
 * (settings.share_preview) ; l'image choisie attend la publication, comme les autres images. */
// Recadrage « remplir » centré au format 1200 × 630 (1,91 pour 1, celui des cartes LinkedIn/Facebook). Pure : rectangle source.
const SHARE_PREVIEW_W = 1200, SHARE_PREVIEW_H = 630;
function sharePreviewCropRect(w, h) {
  const target = SHARE_PREVIEW_W / SHARE_PREVIEW_H;
  if (w / h > target) { const sw = Math.round(h * target); return { sx: Math.floor((w - sw) / 2), sy: 0, sw, sh: h }; }
  const sh = Math.round(w / target);
  return { sx: 0, sy: Math.floor((h - sh) / 2), sw: w, sh };
}
// Mode « image entière » (marie-louise) : l'image est réduite pour tenir dans 1200 × 630 sans rien couper, centrée dans une bordure. Pure : rectangle d'arrivée.
function sharePreviewContainRect(w, h) {
  const k = Math.min(SHARE_PREVIEW_W / w, SHARE_PREVIEW_H / h);
  const dw = Math.round(w * k), dh = Math.round(h * k);
  return { dx: Math.floor((SHARE_PREVIEW_W - dw) / 2), dy: Math.floor((SHARE_PREVIEW_H - dh) / 2), dw, dh };
}
// Déjà au bon format et assez grande : rien à faire (écart de format de 1 % toléré).
function sharePreviewNeedsFit(w, h) {
  return !(w >= SHARE_PREVIEW_W && Math.abs(w / h - SHARE_PREVIEW_W / SHARE_PREVIEW_H) / (SHARE_PREVIEW_W / SHARE_PREVIEW_H) < 0.01);
}
// Fichier choisi -> fichier recadré 1200 × 630 (JPEG si la source l'est, PNG sinon), ou le fichier d'origine s'il est déjà bon.
async function sharePreviewFit(file, mode, color) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('image illisible')); i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('image vide');
    if (!sharePreviewNeedsFit(w, h)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_PREVIEW_W; canvas.height = SHARE_PREVIEW_H;
    const g = canvas.getContext('2d');
    if (mode === 'contain') {
      // Marie-louise : fond de la couleur choisie, puis l'image entière au centre.
      g.fillStyle = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#ffffff'; g.fillRect(0, 0, SHARE_PREVIEW_W, SHARE_PREVIEW_H);
      const c = sharePreviewContainRect(w, h);
      g.drawImage(img, 0, 0, w, h, c.dx, c.dy, c.dw, c.dh);
    } else {
      const r = sharePreviewCropRect(w, h);
      g.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, SHARE_PREVIEW_W, SHARE_PREVIEW_H);
    }
    const jpeg = /jpe?g/i.test(file.type);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('export impossible'))), jpeg ? 'image/jpeg' : 'image/png', 0.92));
    return new File([blob], 'share-preview.' + (jpeg ? 'jpg' : 'png'), { type: blob.type });
  } finally { URL.revokeObjectURL(url); }
}
function renderSharePreviewMock() {
  const mock = document.getElementById('sharePreviewMock');
  if (!mock) return;
  const src = sharePreviewPendingFile ? (sharePreviewPendingFileUrl || '') : (sharePreview.image ? MEDIA_BASE + 'images/' + sharePreview.image : '');
  const img = src ? `<img src="${escapeAttr(src)}" alt="" style="display:block;width:100%;aspect-ratio:1200/630;object-fit:${sharePreview.autoFit !== false && sharePreview.fitMode !== 'contain' ? 'cover' : 'contain'};background:${sharePreview.autoFit !== false && sharePreview.fitMode === 'contain' ? escapeAttr(sharePreview.fitColor || '#ffffff') : '#14181d'}">` : `<div style="aspect-ratio:1200/630;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-dimmer)">${tr('sharePreviewDefaultImage')}</div>`;
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
  document.getElementById('sharePreviewAutoFit').checked = sharePreview.autoFit !== false;
  document.getElementById('sharePreviewFitMode').value = sharePreview.fitMode === 'contain' ? 'contain' : 'fill';
  document.getElementById('sharePreviewFitMode').disabled = sharePreview.autoFit === false;
  document.getElementById('sharePreviewFitColor').value = /^#[0-9a-f]{6}$/i.test(sharePreview.fitColor || '') ? sharePreview.fitColor : '#ffffff';
  document.getElementById('sharePreviewFitColorWrap').style.display = sharePreview.fitMode === 'contain' && sharePreview.autoFit !== false ? 'flex' : 'none';
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
    document.getElementById('sharePreviewAutoFit').addEventListener('change', e => { sharePreview.autoFit = e.target.checked; document.getElementById('sharePreviewFitMode').disabled = !e.target.checked; document.getElementById('sharePreviewFitColorWrap').style.display = e.target.checked && sharePreview.fitMode === 'contain' ? 'flex' : 'none'; hasUnsavedEdits = true; renderSharePreviewMock(); });
document.getElementById('sharePreviewFitMode').addEventListener('change', e => { sharePreview.fitMode = e.target.value; document.getElementById('sharePreviewFitColorWrap').style.display = e.target.value === 'contain' ? 'flex' : 'none'; hasUnsavedEdits = true; renderSharePreviewMock(); });
document.getElementById('sharePreviewFitColor').addEventListener('input', e => { sharePreview.fitColor = e.target.value; hasUnsavedEdits = true; renderSharePreviewMock(); });
fillSharePreviewFields();
  });
  renderSharePreviewMock();
}
document.getElementById('sharePreviewTitleInput').addEventListener('input', e => { sharePreview.title = e.target.value; hasUnsavedEdits = true; renderSharePreviewMock(); });
document.getElementById('sharePreviewDescInput').addEventListener('input', e => { sharePreview.description = e.target.value; hasUnsavedEdits = true; renderSharePreviewMock(); });
document.getElementById('sharePreviewAutoFit').addEventListener('change', e => { sharePreview.autoFit = e.target.checked; hasUnsavedEdits = true; renderSharePreviewMock(); });
fillSharePreviewFields();
