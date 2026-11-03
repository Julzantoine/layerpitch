/* ---------------- Imports en attente : fichiers déposés par un assistant IA (3/11, chantier MCP) ----------------
   Un programme local (layerpitch-cli.js) dépose des .wav dans une zone d'attente privée du compte (Edge Function assistant-import).
   Ici, le compositeur voit ces imports, les télécharge (liens signés par pending-import-files), puis retrouve EXACTEMENT la fenêtre
   d'import de dossier habituelle (titre modifiable, structure proposée par l'assistant, confirmation) : le morceau est un brouillon,
   publié seulement par « Publier ». Une fois le morceau créé, les fichiers sont effacés tout de suite côté serveur (finish 'added').
   Feu vert 'assistant_import' (admin seulement tant qu'il n'est pas donné). Conversion WAV -> OGG : faite à la publication comme pour
   tout WAV déposé (40-conversion-wav-ogg.js). */
let pendingImportsList = [];
let pendingImportDownload = null; // { id, abort } pendant un téléchargement

async function pendingImportsCall(body) {
  const { data, error } = await window.LayerPitchSupabaseClient.getClient().functions.invoke('pending-import-files', { body });
  if (error) throw new Error(await LayerPitchAuth.describeFunctionError(error));
  return data;
}
async function refreshPendingImports() {
  const host = document.getElementById('pendingImports');
  if (!host) return;
  if (!flagOpen('assistant_import')) { host.hidden = true; return; }
  const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('list_my_pending_imports');
  pendingImportsList = error ? [] : (data || []);
  renderPendingImports();
}
function renderPendingImports() {
  const host = document.getElementById('pendingImports');
  if (!host) return;
  host.hidden = !pendingImportsList.length;
  if (!pendingImportsList.length) { host.innerHTML = ''; return; }
  const mb = n => (n / 1048576).toFixed(1);
  host.innerHTML = `<div class="hint-inline" style="font-weight:600;margin-bottom:6px">${tr('pendingImportsTitle', { n: pendingImportsList.length })}</div>` + pendingImportsList.map(p => {
    const bytes = (p.files || []).reduce((a, f) => a + (f.size || 0), 0);
    const busy = pendingImportDownload && pendingImportDownload.id === p.id;
    return `<div class="pending-import-row" data-pi="${escapeAttr(p.id)}" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--border)">
      <span style="flex:1;min-width:180px"><strong>${escapeHtml(p.title || '…')}</strong> — ${tr('pendingImportsSummary', { files: (p.files || []).length, mb: mb(bytes), date: new Date(p.expires_at).toLocaleDateString(currentLang()) })}</span>
      <span data-pi-status></span>
      ${busy ? `<button class="btn btn-small" type="button" data-pi-btn="cancel">${tr('cancel')}</button>`
        : `<button class="btn btn-small btn-primary" type="button" data-pi-btn="open">${tr('pendingImportsBuild')}</button>
           <button class="btn btn-small" type="button" data-pi-btn="discard">${tr('pendingImportsDiscard')}</button>`}
    </div>`;
  }).join('');
}
async function openPendingImport(id) {
  const p = pendingImportsList.find(x => x.id === id);
  if (!p || pendingImportDownload) return;
  const ctl = new AbortController();
  pendingImportDownload = { id, abort: () => ctl.abort() };
  renderPendingImports();
  const status = () => document.querySelector(`[data-pi="${CSS.escape(id)}"] [data-pi-status]`);
  try {
    const { files } = await pendingImportsCall({ action: 'download_urls', import_id: id });
    const out = [];
    for (let i = 0; i < files.length; i++) {
      if (status()) status().textContent = tr('pendingImportsDownloading', { i: i + 1, n: files.length });
      const res = await fetch(files[i].url, { signal: ctl.signal });
      if (!res.ok) throw new Error(tr('pendingImportsDownloadError', { name: files[i].name }));
      out.push(new File([await res.blob()], files[i].name, { type: 'audio/wav' }));
    }
    pendingImportDownload = null; renderPendingImports();
    const plan = p.plan || {};
    openFolderImportDialog({
      name: p.title || plan.folder || '', files: out.sort(folderImportByName), ignored: [],
      presetMode: ['vertical', 'vertical-random', 'sequential', 'embranchement-vertical', 'static'].includes(plan.mode) ? plan.mode : null,
      onRegistered: () => finishPendingImport(id, 'added'),
    });
  } catch (e) {
    pendingImportDownload = null; renderPendingImports();
    if (e && e.name !== 'AbortError') window.LayerPitchNotify.error(tr('errorPrefix', { message: e.message }));
  }
}
async function finishPendingImport(id, outcome) {
  try { await pendingImportsCall({ action: 'finish', import_id: id, outcome }); }
  catch (e) { window.LayerPitchNotify.error(tr('errorPrefix', { message: e.message })); }
  refreshPendingImports();
}
(function wirePendingImports() {
  const host = document.getElementById('pendingImports');
  if (!host) return;
  host.addEventListener('click', async e => {
    const b = e.target.closest('[data-pi-btn]'); const row = e.target.closest('[data-pi]');
    if (!b || !row) return;
    const id = row.dataset.pi;
    if (b.dataset.piBtn === 'open') openPendingImport(id);
    else if (b.dataset.piBtn === 'cancel' && pendingImportDownload) pendingImportDownload.abort();
    else if (b.dataset.piBtn === 'discard') {
      if (await window.LayerPitchNotify.confirm(tr('pendingImportsDiscardConfirm'), { okLabel: tr('pendingImportsDiscard'), danger: true })) finishPendingImport(id, 'discarded');
    }
  });
})();
