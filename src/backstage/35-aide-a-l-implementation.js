/* ---------------- Aide à l'implémentation (réglage global, une case par logiciel) ---------------- */
function fillImplementationSkillsFields() {
  document.getElementById('skillWwise').checked = !!implementationSkills.wwise;
  document.getElementById('skillFmod').checked = !!implementationSkills.fmod;
  document.getElementById('skillUnity').checked = !!implementationSkills.unity;
  document.getElementById('skillUnreal').checked = !!implementationSkills.unreal;
}
document.getElementById('skillWwise').addEventListener('change', e => { implementationSkills.wwise = e.target.checked; hasUnsavedEdits = true; });
document.getElementById('skillFmod').addEventListener('change', e => { implementationSkills.fmod = e.target.checked; hasUnsavedEdits = true; });
document.getElementById('skillUnity').addEventListener('change', e => { implementationSkills.unity = e.target.checked; hasUnsavedEdits = true; });
document.getElementById('skillUnreal').addEventListener('change', e => { implementationSkills.unreal = e.target.checked; hasUnsavedEdits = true; });
fillImplementationSkillsFields();

function fillNoAiCertifiedGlobalField() {
  document.getElementById('noAiCertifiedGlobal').checked = !!noAiCertifiedGlobal;
}
document.getElementById('noAiCertifiedGlobal').addEventListener('change', e => {
  noAiCertifiedGlobal = e.target.checked;
  hasUnsavedEdits = true;
  renderLibrary(); // les fiches morceau affichent le réglage global effectif pour ceux réglés sur "suivre"
});
fillNoAiCertifiedGlobalField();

// Menu « Intégration par les visiteurs » (26/10) : une case par AdReel, pack et collection (embedAllowed = listes d'identifiants).
function normalizeEmbedAllowed(v) {
  const o = v || {};
  const arr = k => Array.isArray(o[k]) ? o[k].filter(x => typeof x === 'string') : [];
  return { adreels: arr('adreels'), packs: arr('packs'), collections: arr('collections') };
}
// Valeur publiée : uniquement les éléments qui existent encore (un élément supprimé n'y reste pas).
function cleanEmbedAllowed() {
  const keep = (kind, items) => items.map(x => x.id).filter(id => embedAllowed[kind].includes(id));
  return { adreels: keep('adreels', adReels), packs: keep('packs', packs), collections: keep('collections', collections) };
}
function renderEmbedAllowedList() {
  const box = document.getElementById('embedAllowedList');
  if (!box) return;
  const kinds = [
    ['adreels', 'embedAllowedAdreels', adReels, a => a.label || a.id],
    ['packs', 'embedAllowedPacks', packs, p => p.title || p.id],
    ['collections', 'embedAllowedCollections', collections, c => c.title || c.id],
  ];
  box.innerHTML = kinds.map(([kind, titleKey, items, nameOf]) => {
    const n = items.filter(x => embedAllowed[kind].includes(x.id)).length;
    const rows = items.length ? items.map(x => `<label style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px;">
        <input type="checkbox" style="width:auto;margin:0" data-embed-kind="${kind}" data-embed-id="${escapeAttr(x.id)}"${embedAllowed[kind].includes(x.id) ? ' checked' : ''}>
        <span>${escapeHtml(nameOf(x))}</span></label>`).join('')
      : `<div style="font-size:11px;color:var(--text-dimmer)">${tr('embedAllowedNone')}</div>`;
    return `<details style="margin-bottom:6px"><summary style="cursor:pointer;font-size:12px;font-weight:600;">${tr(titleKey)} (${n}/${items.length})</summary><div style="padding:6px 0 0 14px">${rows}</div></details>`;
  }).join('');
}
document.getElementById('embedAllowedList').addEventListener('change', e => {
  const cb = e.target.closest('[data-embed-kind]');
  if (!cb) return;
  const list = embedAllowed[cb.dataset.embedKind];
  const i = list.indexOf(cb.dataset.embedId);
  if (cb.checked && i < 0) list.push(cb.dataset.embedId);
  if (!cb.checked && i >= 0) list.splice(i, 1);
  hasUnsavedEdits = true;
  const d = cb.closest('details');
  const kind = cb.dataset.embedKind, items = { adreels: adReels, packs, collections }[kind];
  d.querySelector('summary').textContent = d.querySelector('summary').textContent.replace(/\(\d+\//, `(${items.filter(x => embedAllowed[kind].includes(x.id)).length}/`);
});
renderEmbedAllowedList();

