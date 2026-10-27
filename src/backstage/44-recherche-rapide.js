/* ---------------- Recherche rapide Cmd+P / Ctrl+P (27/10) ----------------
 * Une petite fenêtre au milieu de l'écran : on tape quelques lettres et on saute directement à un onglet, un morceau,
 * un Sfx, un AdReel, un pack, une collection ou un album. Flèches pour choisir, Entrée pour ouvrir, Échap pour fermer.
 * Cmd/Ctrl+K reste l'insertion de lien (21-insertion-de-lien.js). Feu vert 'quick_search' (admin seulement jusqu'à
 * son ouverture) : feu vert fermé, Cmd/Ctrl+P garde son effet habituel du navigateur (imprimer). */
const QUICK_SEARCH_MAX = 60;
let quickSearchEl = null, quickSearchResults = [], quickSearchIndex = 0;

function quickSearchNormalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// Ouvre un élément d'une liste en accordéon (packs, collections, albums) : on l'amène à l'écran.
function quickSearchScrollTo(containerId, index) {
  const box = document.getElementById(containerId);
  const el = box && box.children[index];
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function quickSearchItems() {
  const items = [];
  // Onglets visibles et utilisables de la barre latérale.
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    if (btn.disabled || btn.hidden || btn.closest('[hidden]')) return;
    const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
    if (label) items.push({ kind: 'tab', label, run: () => openTab(btn.dataset.tab) });
  });
  library.forEach((t, i) => items.push({ kind: 'track', label: t.title || tr('trackFallback', { n: i + 1 }), run: () => {
    if (t.folderId) collapsedLibraryFolderIds.delete(t.folderId);
    manageLibrarySelectedId = t.id;
    openTab('library');
    renderLibrary();
  } }));
  sfxLibrary.forEach((s, i) => items.push({ kind: 'sfx', label: s.title || tr('sfxFallback', { n: i + 1 }), run: () => {
    if (s.folderId) collapsedSfxFolderIds.delete(s.folderId);
    manageSfxSelectedId = s.id;
    openTab('sfxLibrary');
    renderSfxLibrary();
  } }));
  adReels.forEach(a => items.push({ kind: 'adreel', label: a.label || a.id, run: () => {
    if (a.id !== currentAdReelId) switchAdReel(a.id);
    openTab('content');
  } }));
  packs.forEach((p, i) => items.push({ kind: 'pack', label: p.title || tr('packFallback', { n: i + 1 }), run: () => {
    openTab('packs');
    if (collapsedPackIds.has(p.id)) { collapsedPackIds.delete(p.id); renderPacks(); }
    quickSearchScrollTo('packsContainer', i);
  } }));
  collections.forEach((c, i) => items.push({ kind: 'collection', label: c.title || tr('collectionFallback', { n: i + 1 }), run: () => {
    openTab('collections');
    if (collapsedCollectionIds.has(c.id)) { collapsedCollectionIds.delete(c.id); renderCollections(); }
    quickSearchScrollTo('collectionsContainer', i);
  } }));
  // Albums : chargés à la première ouverture de leur onglet seulement ; avant, l'onglet « Albums » suffit.
  const albumsNav = document.getElementById('navItemAlbums');
  if (albumsState.loaded && albumsNav && !albumsNav.hidden) {
    albumsState.albums.forEach((al, i) => items.push({ kind: 'album', label: al.title || tr('quickSearchUntitled'), run: () => {
      openTab('albums');
      quickSearchScrollTo('albumsContainer', i);
    } }));
  }
  return items;
}
// Classement : début du nom, puis début d'un mot, puis n'importe où ; à égalité, l'ordre des listes est gardé.
function quickSearchFilter(query) {
  const all = quickSearchItems();
  const q = quickSearchNormalize(query);
  if (!q) return all.slice(0, QUICK_SEARCH_MAX);
  const scored = [];
  all.forEach((it, order) => {
    const name = quickSearchNormalize(it.label);
    const pos = name.indexOf(q);
    if (pos < 0) return;
    const score = pos === 0 ? 0 : /[\s\-_'’(]/.test(name[pos - 1]) ? 1 : 2;
    scored.push({ it, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, QUICK_SEARCH_MAX).map(s => s.it);
}
function quickSearchRender() {
  const list = quickSearchEl.querySelector('.qs-list');
  quickSearchResults = quickSearchFilter(quickSearchEl.querySelector('.qs-input').value);
  if (quickSearchIndex >= quickSearchResults.length) quickSearchIndex = Math.max(0, quickSearchResults.length - 1);
  if (!quickSearchResults.length) { list.innerHTML = `<div class="qs-empty">${escapeHtml(tr('quickSearchNoResult'))}</div>`; return; }
  list.innerHTML = quickSearchResults.map((it, i) => `
    <div class="qs-item${i === quickSearchIndex ? ' active' : ''}" role="option" aria-selected="${i === quickSearchIndex}" data-qs-index="${i}">
      <span class="qs-label">${escapeHtml(it.label)}</span>
      <span class="qs-kind">${escapeHtml(tr('quickSearchKind_' + it.kind))}</span>
    </div>`).join('');
  const active = list.querySelector('.qs-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}
function quickSearchChoose(i) {
  const it = quickSearchResults[i];
  closeQuickSearch();
  if (!it) return;
  it.run();
  trackBackstageEvent('quick_search_open', { kind: it.kind });
}
function buildQuickSearch() {
  const el = document.createElement('div');
  el.id = 'quickSearchOverlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="qs-box" role="dialog" aria-modal="true" aria-label="${escapeAttr(tr('quickSearchTitle'))}">
      <input type="text" class="qs-input" autocomplete="off" spellcheck="false" placeholder="${escapeAttr(tr('quickSearchPlaceholder'))}">
      <div class="qs-list" role="listbox"></div>
      <div class="qs-hint">${escapeHtml(tr('quickSearchHint'))}</div>
    </div>`;
  document.body.appendChild(el);
  const input = el.querySelector('.qs-input');
  input.addEventListener('input', () => { quickSearchIndex = 0; quickSearchRender(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!quickSearchResults.length) return;
      const n = quickSearchResults.length;
      quickSearchIndex = (quickSearchIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      quickSearchRender();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      quickSearchChoose(quickSearchIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickSearch();
    }
  });
  el.addEventListener('mousedown', e => { if (e.target === el) closeQuickSearch(); }); // clic à côté : on ferme
  el.querySelector('.qs-list').addEventListener('click', e => {
    const row = e.target.closest('[data-qs-index]');
    if (row) quickSearchChoose(Number(row.dataset.qsIndex));
  });
  return el;
}
function openQuickSearch() {
  if (!quickSearchEl) quickSearchEl = buildQuickSearch();
  const input = quickSearchEl.querySelector('.qs-input');
  input.value = '';
  quickSearchIndex = 0;
  quickSearchEl.hidden = false;
  quickSearchRender();
  input.focus();
}
function closeQuickSearch() {
  if (quickSearchEl) quickSearchEl.hidden = true;
}
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key || '').toLowerCase() !== 'p') return;
  if (!flagOpen('quick_search')) return; // feu vert fermé : le navigateur garde son « Imprimer »
  e.preventDefault();
  if (e.repeat) return;
  if (quickSearchEl && !quickSearchEl.hidden) closeQuickSearch(); else openQuickSearch();
});
