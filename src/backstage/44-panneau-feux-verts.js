/* ---------------- Panneau « Feux verts » (admin, 08/10) ---------------- */
// Remplace la commande collée dans la console : liste les feux verts (table feature_flags, lisible par tous) et
// ouvre / ferme chacun via la fonction set_feature_released, qui vérifie côté base que l'appelant est admin.
// Ouvrir un feu vert l'ouvre à TOUS les comptes : confirmation avant chaque changement.
let featureFlagRows = [];
function featureFlagKeyLabel(k) { return '<code>' + escapeHtml(k) + '</code>'; }

async function loadFeatureFlagsPanel() {
  const listEl = document.getElementById('featureFlagsList');
  if (!listEl) return;
  const { data, error } = await window.LayerPitchSupabaseClient.getClient()
    .from('feature_flags').select('key, released, released_at, description').order('key');
  if (error) { listEl.textContent = 'Erreur : ' + error.message; return; }
  featureFlagRows = data || [];
  renderFeatureFlagsPanel();
}
function renderFeatureFlagsPanel() {
  const listEl = document.getElementById('featureFlagsList');
  const countEl = document.getElementById('featureFlagsCount');
  if (!listEl) return;
  const filter = ((document.getElementById('featureFlagsSearch') || {}).value || '').trim().toLowerCase();
  const rows = featureFlagRows
    .filter(r => !filter || r.key.toLowerCase().includes(filter) || (r.description || '').toLowerCase().includes(filter))
    .sort((a, b) => (a.released === b.released ? a.key.localeCompare(b.key) : (a.released ? 1 : -1))); // fermés d'abord
  const closed = featureFlagRows.filter(r => !r.released).length;
  if (countEl) countEl.textContent = closed + ' fermé' + (closed > 1 ? 's' : '') + ' (admin seulement) sur ' + featureFlagRows.length;
  if (!rows.length) { listEl.textContent = 'Aucun feu vert ne correspond.'; return; }
  listEl.innerHTML = rows.map(r => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid #e2e2e6;">
      <div style="flex:1;min-width:0;">
        <div>${featureFlagKeyLabel(r.key)} <span style="font-size:11px;color:${r.released ? '#2a7' : '#b8862e'};">${r.released ? 'ouvert à tous' : 'admin seulement'}</span></div>
        <div style="font-size:12px;color:var(--text-dimmer);margin-top:2px;">${escapeHtml(r.description || '')}</div>
      </div>
      <button class="btn btn-small ${r.released ? '' : 'btn-primary'}" type="button" data-flag-key="${escapeAttr(r.key)}" data-flag-open="${r.released ? '0' : '1'}">${r.released ? 'Refermer' : 'Ouvrir à tous'}</button>
    </div>`).join('');
}
async function toggleFeatureFlag(key, open) {
  const msg = open
    ? 'Ouvrir « ' + key + ' » à TOUS les comptes ? Les compositeurs et studios le verront tout de suite.'
    : 'Refermer « ' + key + ' » ? Seuls les admins le verront de nouveau.';
  if (!(await window.LayerPitchNotify.confirm(msg, { danger: !open }))) return;
  const { error } = await window.LayerPitchSupabaseClient.getClient().rpc('set_feature_released', { p_key: key, p_released: open });
  if (error) { window.LayerPitchNotify.error('Erreur : ' + error.message); return; }
  window.LayerPitchNotify.success(open ? '« ' + key + ' » est ouvert à tous.' : '« ' + key + ' » est refermé.');
  await loadFeatureFlagsPanel();
}
(function wireFeatureFlagsPanel() {
  const listEl = document.getElementById('featureFlagsList');
  if (!listEl) return;
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-flag-key]');
    if (btn) toggleFeatureFlag(btn.dataset.flagKey, btn.dataset.flagOpen === '1');
  });
  const search = document.getElementById('featureFlagsSearch');
  if (search) search.addEventListener('input', renderFeatureFlagsPanel);
})();
