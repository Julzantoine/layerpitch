/* ---------------- Réseaux sociaux ---------------- */
function renderSocials() {
  const container = document.getElementById('socialsContainer');
  container.innerHTML = '';
  socials.forEach((s, si) => {
    const row = document.createElement('div');
    row.className = 'list-block';
    row.style.cssText = 'padding:12px;margin-bottom:8px';
    row.innerHTML = `
      <div class="row">
        <div>
          <label>${tr('socialPlatformLabel')}</label>
          <select data-social-field="platform" data-si="${si}">
            ${SOCIAL_PLATFORMS.map(p => `<option value="${p}"${s.platform === p ? ' selected' : ''}>${tr('socialPlatform_' + p)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>${tr('socialUrlLabel')}</label>
          <input type="text" data-social-field="url" data-si="${si}" value="${escapeAttr(s.url)}" placeholder="https://...">
        </div>
      </div>
      <div class="hint-inline">${PUBLISHABLE_SOCIAL_PLATFORMS.includes(s.platform) ? tr('socialPublishableHint') : tr('socialReferenceOnlyHint')}</div>
      <div class="actions"><button class="btn btn-small btn-danger" data-action="remove-social" data-si="${si}">${tr('removeBtn')}</button></div>
    `;
    container.appendChild(row);
  });
}
document.getElementById('btnAddSocial').addEventListener('click', () => {
  socials.push({ id: genId(), platform: 'twitter', url: '' });
  hasUnsavedEdits = true;
  trackBackstageEvent('social_add', {});
  renderSocials();
});
document.getElementById('socialsContainer').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="remove-social"]');
  if (!btn) return;
  const si = parseInt(btn.dataset.si, 10);
  socials.splice(si, 1);
  hasUnsavedEdits = true;
  trackBackstageEvent('social_remove', {});
  renderSocials();
  renderPacks();       // les boutons "Publier" des packs dépendent de cette liste
  renderCollections();  // idem pour les collections
});
document.getElementById('socialsContainer').addEventListener('input', e => {
  const field = e.target.dataset.socialField;
  if (!field) return;
  const si = parseInt(e.target.dataset.si, 10);
  socials[si][field] = e.target.value;
  hasUnsavedEdits = true;
  if (field === 'platform') { renderSocials(); renderPacks(); renderCollections(); }
});

