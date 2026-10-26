/* ---------------- Polices personnalisées (portée globale, réutilisables par tout AdReel/bloc) ---------------- */
function renderCustomFontsList() {
  const container = document.getElementById('customFontsContainer');
  container.innerHTML = '';
  customFonts.forEach((font, fi) => {
    const el = document.createElement('div');
    el.className = 'list-block';
    el.innerHTML = `
      <div data-role="fontFileCtrl" style="margin-bottom:8px"></div>
      <div class="list-block-head">
        <input type="text" data-font-i="${fi}" data-font-field="name" value="${escapeAttr(font.name)}" placeholder="${tr('customFontNamePlaceholder')}" style="flex:1;margin-right:8px">
        <button class="btn btn-small btn-danger" data-action="remove-custom-font" data-font-i="${fi}">${tr('deleteBtn')}</button>
      </div>
      <div class="hint-inline" style="margin-bottom:4px">${tr('customFontNameHint')}</div>
    `;
    const ctrlHost = el.querySelector('[data-role="fontFileCtrl"]');
    ctrlHost.innerHTML = fileCtrlHtml(tr('chooseFontFile'));
    ctrlHost.querySelector('[data-role="fileInput"]').accept = '.woff2,.woff,.ttf,.otf';
    wireFileControl(ctrlHost, '.woff2,.woff,.ttf,.otf',
      () => font.pendingFile, () => font.remoteFile,
      f => { font.pendingFile = f; hasUnsavedEdits = true; }, () => font.originalFileName);
    container.appendChild(el);
  });
}
document.getElementById('customFontsContainer').addEventListener('input', e => {
  const field = e.target.dataset.fontField;
  if (!field) return;
  const fi = parseInt(e.target.dataset.fontI, 10);
  customFonts[fi][field] = e.target.value;
  hasUnsavedEdits = true;
  fillAppearanceFields(); // le nom affiché dans les sélecteurs de police doit rester à jour
  rebuildAllCards();
});
document.getElementById('customFontsContainer').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="remove-custom-font"]');
  if (!btn) return;
  const fi = parseInt(btn.dataset.fontI, 10);
  const removedId = customFonts[fi].id;
  customFonts.splice(fi, 1);
  // Un champ (général ou par bloc) qui pointait vers cette police supprimée retombe sur "Par défaut" —
  // mieux qu'une référence orpheline silencieusement ignorée à la publication.
  if (profile.theme && profile.theme.font === 'custom:' + removedId) profile.theme.font = 'default';
  blocks.forEach(b => { if (b.appearance && b.appearance.font === 'custom:' + removedId) b.appearance.font = 'default'; });
  hasUnsavedEdits = true;
  trackBackstageEvent('custom_font_delete', {});
  fillAppearanceFields();
  rebuildAllCards();
});
// Le bouton ouvre directement le dialogue de choix du fichier : une police n'existe qu'avec son fichier, donc
// rien n'est ajouté tant qu'aucun fichier n'est choisi (annuler le dialogue ne laisse pas de ligne vide).
// Le nom est prérempli avec celui du fichier, modifiable ensuite.
const CUSTOM_FONT_ACCEPT = '.woff2,.woff,.ttf,.otf';
document.getElementById('btnAddCustomFont').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = CUSTOM_FONT_ACCEPT;
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f || !fileMatchesAccept(f, CUSTOM_FONT_ACCEPT)) return;
    customFonts.push({ id: genId(), name: f.name.replace(/\.[^.]+$/, ''), pendingFile: f, remoteFile: null });
    hasUnsavedEdits = true;
    trackBackstageEvent('custom_font_add', {});
    renderCustomFontsList();
    fillAppearanceFields(); // le nouveau nom apparaît tout de suite dans les sélecteurs de police
  });
  input.click();
});
