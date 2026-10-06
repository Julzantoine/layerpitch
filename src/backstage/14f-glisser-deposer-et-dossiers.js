// Glisser-déposer par poignée, généralisé (18/08) à partir du mécanisme déjà en place pour les blocs de
// contenu (16/08) -- réutilisable pour n'importe quelle liste réordonnable pilotée par un vrai tableau de
// données : couches (vertical), sections (vertical-random), boucles nommées (embranchement-vertical).
// containerEl : élément parent qui reçoit les écouteurs délégués. itemClass : classe CSS des lignes
// draggables (chacune doit porter data-drag-id = un id stable de l'objet qu'elle représente).
// getArray() : renvoie le tableau réel à réordonner (jamais une copie). onDrop() : callback après un
// réordonnancement effectif (typiquement renderLibrary()).
// Piège corrigé en relecture (18/08) : cette fonction est appelée à chaque renderLibrary() (donc à
// chaque frappe dans un champ, potentiellement des centaines de fois par session) -- brancher les
// écouteurs pointerup/pointercancel de secours ICI, comme un premier jet l'avait fait, les aurait
// empilés sur `document` sans jamais les retirer (fuite). Ils sont donc posés UNE SEULE FOIS plus bas
// (releaseAllDragHandles), pas à chaque appel -- seuls les écouteurs posés sur containerEl (recréé à
// chaque rendu, donc jamais dupliqués puisque l'ancien conteneur part avec) restent ici.
// ---- Duplication par Alt + glisser (25/09, demande de Jules-Antoine) ----
// Alt (Option sur Mac) enfoncé au moment de lâcher : l'élément est COPIÉ à l'endroit visé au lieu d'être déplacé.
// Certains navigateurs ne renseignent pas altKey sur les événements de glisser : on suit aussi la touche au clavier.
let altKeyHeld = false;
document.addEventListener('keydown', e => { if (e.key === 'Alt') altKeyHeld = true; });
document.addEventListener('keyup', e => { if (e.key === 'Alt') altKeyHeld = false; });
window.addEventListener('blur', () => { altKeyHeld = false; });
// Réservé à l'admin tant que Jules-Antoine n'a pas donné son feu vert (25/09) : ailleurs, Alt + glisser déplace simplement.
function isDuplicateDrag(e) { return flagOpen('alt_drag_delete') && !!(e.altKey || altKeyHeld); }
// Copie profonde : nouveaux id partout (l'élément et tout ce qu'il contient), fichiers (File) et fichiers déjà en
// ligne (remoteFile) partagés tels quels -- rien à re-télécharger ; supprimer une copie ne peut plus effacer les
// fichiers de l'original (voir pendingOrphanR2Keys). Les références vers d'autres éléments (targetId,
// referencesSlotId, sfxIds...) sont conservées.
function deepCloneWithNewIds(v) {
  if (Array.isArray(v)) return v.map(deepCloneWithNewIds);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o = {};
    Object.keys(v).forEach(k => { o[k] = k === 'id' ? genId() : deepCloneWithNewIds(v[k]); });
    return o;
  }
  return v;
}
// Copie d'un MORCEAU entier (6/10) : tous les id sont renouvelés ET toute référence interne qui les cite (targetId d'un
// embranchement, referencesSlotId, triggerId des actions / relations / seuils de curseur...) est redirigée vers la copie --
// contrairement à deepCloneWithNewIds, pensé pour UN élément dont les références pointent hors de lui. Les id sont des chaînes
// aléatoires uniques : remplacer toute valeur égale à un ancien id est sans risque. Fichiers (File) partagés tels quels.
function cloneTrackWithRemap(track) {
  const idMap = new Map();
  const isPlain = v => !!v && Object.prototype.toString.call(v) === '[object Object]'; // File, Blob... restent partagés ; indifférent au « monde » de l'objet
  const collect = v => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (isPlain(v)) {
      if (typeof v.id === 'string' && v.id && !idMap.has(v.id)) { let n; do { n = genId(); } while ([...idMap.values()].includes(n)); idMap.set(v.id, n); }
      Object.keys(v).forEach(k => collect(v[k]));
    }
  };
  collect(track);
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (isPlain(v)) { const o = {}; Object.keys(v).forEach(k => { o[k] = walk(v[k]); }); return o; }
    return typeof v === 'string' && idMap.has(v) ? idMap.get(v) : v;
  };
  return walk(track);
}
// Duplique un morceau de la bibliothèque : copie indépendante (nouvel id, ses propres fichiers copiés côté serveur par l'Edge
// Function copy-track-files quand le morceau est déjà publié), insérée à `place` ({ folderId, anchorId, before }) ou juste après
// l'original. Un morceau protégé n'est pas copié (voir la fonction). Renvoie la copie, ou null.
async function duplicateLibraryTrack(src, place) {
  if (!src) return null;
  if (src.protected) { window.LayerPitchNotify.error(tr('trackCopyProtected')); return null; }
  const copy = cloneTrackWithRemap(src);
  copy.protected = false;
  copy.title = src.title && String(src.title).trim() ? tr('duplicateLabel', { label: src.title }) : src.title;
  if (trackRemoteFileKeys(src).length) {
    try {
      await loadPostgresReadScripts();
      const r = await window.LayerPitchTracks.copyTrackFiles(src.id, copy.id);
      if (!r.ok) { window.LayerPitchNotify.error(tr('trackCopyError', { error: r.error })); return null; }
    } catch (e) { window.LayerPitchNotify.error(tr('trackCopyError', { error: e.message })); return null; }
  }
  if (library.indexOf(src) < 0) { window.LayerPitchNotify.error(tr('trackCopyError', { error: 'données rechargées' })); return null; }
  copy.folderId = place && place.folderId !== undefined ? (place.folderId || null) : (src.folderId || null);
  let at = library.indexOf(src) + 1;
  if (place && place.anchorId) { const a = library.findIndex(x => x.id === place.anchorId); if (a >= 0) at = place.before ? a : a + 1; }
  else if (place && place.append) at = library.length;
  library.splice(at, 0, copy);
  manageLibrarySelectedId = copy.id;
  hasUnsavedEdits = true;
  window.LayerPitchNotify.info(tr('trackCopyDone', { title: copy.title || '' }));
  renderLibrary();
  return copy;
}
function cloneWithCopyLabel(item, labelKey) {
  const c = deepCloneWithNewIds(item);
  const k = labelKey || 'label';
  if (c[k] && String(c[k]).trim()) c[k] = tr('duplicateLabel', { label: c[k] });
  return c;
}
// Une poignée n'arme que l'élément qui la porte directement, jamais un élément qui le contient (27/09 : la
// poignée d'un morceau du bloc Musique armait aussi le bloc entier, resté grisé après le dépôt).
const DRAG_ITEM_SELECTOR = '[data-drag-id], .block-editor-card';
function ownsHandle(item, handle) { return handle.closest(DRAG_ITEM_SELECTOR) === item; }
// cloneItem (optionnel) : active la duplication Alt + glisser pour cette liste. onDrop(item) reçoit l'élément
// déplacé ou la copie créée.
function wireArrayDragReorder(containerEl, itemClass, getArray, onDrop, cloneItem) {
  // idOf (29/08) : accepte aussi bien un tableau d'objets {id, ...} (usage historique, ex. track.loops)
  // qu'un tableau de simples chaînes d'identifiants (ex. selectedTrackIds d'un AdReel) -- sans dupliquer
  // ce mécanisme de glisser-déposer pour ce second cas de figure.
  const idOf = x => (typeof x === 'string' ? x : x.id);
  let draggedId = null;
  containerEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.block-drag-handle');
    if (!handle) return;
    const item = handle.closest('.' + itemClass);
    if (item && ownsHandle(item, handle)) item.draggable = true;
  });
  containerEl.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.' + itemClass);
    if (!item || e.target !== item || !item.draggable) return; // seul l'élément réellement glissé (27/09)
    draggedId = item.dataset.dragId;
    item.classList.add('dragging');
    containerEl.classList.add('is-reordering');
    e.dataTransfer.effectAllowed = cloneItem ? 'copyMove' : 'move';
    try { e.dataTransfer.setData('text/plain', draggedId); } catch (err) { /* MIME requis par certains navigateurs, jamais bloquant ici */ }
  });
  containerEl.addEventListener('dragover', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    const dup = !!cloneItem && isDuplicateDrag(e);
    e.dataTransfer.dropEffect = dup ? 'copy' : 'move';
    containerEl.classList.toggle('is-duplicating', dup);
    const item = e.target.closest('.' + itemClass);
    if (!item || !item.dataset.dragId || (item.dataset.dragId === draggedId && !dup)) return;
    const rect = item.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    item.classList.toggle('drag-over-top', before);
    item.classList.toggle('drag-over-bottom', !before);
  });
  containerEl.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.' + itemClass);
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  containerEl.addEventListener('drop', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    const targetItem = e.target.closest('.' + itemClass);
    containerEl.querySelectorAll('.' + itemClass).forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
    containerEl.classList.remove('is-reordering', 'is-duplicating');
    const arr = getArray();
    const fromIdx = arr.findIndex(x => idOf(x) === draggedId);
    draggedId = null;
    if (fromIdx === -1) return;
    if (!targetItem || !targetItem.dataset.dragId) return;
    if (cloneItem && isDuplicateDrag(e)) {
      const toIdx = arr.findIndex(x => idOf(x) === targetItem.dataset.dragId);
      if (toIdx === -1) return;
      const rect = targetItem.getBoundingClientRect();
      const copy = cloneItem(arr[fromIdx]);
      arr.splice((e.clientY - rect.top) < rect.height / 2 ? toIdx : toIdx + 1, 0, copy);
      hasUnsavedEdits = true;
      onDrop(copy);
      return;
    } // pas de dépôt en fin de liste ici (contrairement aux blocs de contenu) : chaque
    // ligne de cette liste maître occupe toute la largeur disponible, il n'y a pas d'espace vide sous la
    // dernière ligne où déposer sans ambiguïté.
    const targetId = targetItem.dataset.dragId;
    if (targetId === idOf(arr[fromIdx])) return;
    const toIdx = arr.findIndex(x => idOf(x) === targetId);
    if (toIdx === -1) return;
    const rect = targetItem.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const insertAt = before ? toIdx : toIdx + 1;
    const [moved] = arr.splice(fromIdx, 1);
    const adjustedInsertAt = insertAt > fromIdx ? insertAt - 1 : insertAt;
    arr.splice(adjustedInsertAt, 0, moved);
    hasUnsavedEdits = true;
    onDrop(moved);
  });
  containerEl.addEventListener('dragend', (e) => {
    const item = e.target.closest('.' + itemClass);
    if (item) { item.classList.remove('dragging'); item.draggable = false; }
    containerEl.querySelectorAll('.' + itemClass).forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
    containerEl.classList.remove('is-reordering', 'is-duplicating');
    draggedId = null;
  });
}
// Filet de sécurité global (posé une seule fois, pas à chaque appel de wireArrayDragReorder ci-dessus) :
// relâche n'importe quel élément resté armé en draggable="true" si le pointeur remonte sans qu'un vrai
// drag n'ait eu lieu (simple clic bref sur la poignée, ou relâchement hors de la liste). Balaie tout le
// document plutôt qu'un conteneur précis -- volontairement large, puisqu'un seul écouteur suffit pour
// toutes les listes maître de tous les morceaux, quel que soit leur nombre.
function releaseAllDragHandles() {
  document.querySelectorAll('.seq-master-item[draggable="true"], .sel-track-item[draggable="true"]').forEach(c => { c.draggable = false; });
}
document.addEventListener('pointerup', releaseAllDragHandles);
document.addEventListener('pointercancel', releaseAllDragHandles);
// Glisser-déposer à dossiers, généralisé (20/08) -- construit d'abord pour "Gérer les AdReels", factorisé
// le même jour pour être partagé avec la bibliothèque Sfx et la bibliothèque de morceaux : même besoin
// exact dans les trois cas (organiser une liste plate en dossiers, réordonnancement des éléments ET des
// dossiers eux-mêmes par glisser-déposer). Deux systèmes coexistent dans le même conteneur, distingués par
// la classe de poignée pressée (.block-drag-handle nu pour un élément, .folder-drag-handle pour un
// dossier) :
//   - Élément : déposer SUR un autre élément change à la fois son groupe (folderId, lu depuis l'élément
//     cible) et sa position (avant/après selon la moitié survolée) ; déposer sur une zone vide (dossier
//     vide ou padding sous le dernier élément) ne change que le groupe, l'élément est ajouté en dernière
//     position de son nouveau groupe.
//   - Dossier : réordonnancement classique au sein du tableau de dossiers, même logique avant/après que
//     wireArrayDragReorder, mais réécrite ici plutôt que réutilisée -- wireArrayDragReorder cible
//     spécifiquement .block-drag-handle sans distinction, ce qui armerait aussi les éléments nichés à
//     l'intérieur d'un dossier (ils remontent jusqu'à .org-folder-group via closest()).
// getItems()/getFolders() renvoient les tableaux RÉELS actifs pour ce conteneur (jamais une copie) --
// chaque élément a .id et .folderId (null = racine), chaque dossier a .id. onDrop() est appelé après toute
// modification effective (typiquement le renderX() du panneau appelant).
// Une seule paire de variables de suivi (draggedOrgItemId/draggedOrgFolderId), partagée entre tous les
// appelants : un vrai glisser-déposer HTML5 n'est jamais qu'une seule opération active à la fois dans tout
// le navigateur, donc aucun risque de collision entre les panneaux qui appellent cette fonction chacun sur
// leur propre conteneur.
let draggedOrgItemId = null;
let draggedOrgFolderId = null;
function wireOrgDragDrop(containerEl, getItems, getFolders, onDrop, duplicateItem) {
  containerEl.addEventListener('pointerdown', (e) => {
    const folderHandle = e.target.closest('.folder-drag-handle');
    if (folderHandle) {
      const group = folderHandle.closest('.org-folder-group');
      if (group) group.draggable = true;
      return;
    }
    const rowHandle = e.target.closest('.block-drag-handle');
    if (!rowHandle) return;
    const row = rowHandle.closest('.org-row');
    if (row && ownsHandle(row, rowHandle)) row.draggable = true;
  });
  containerEl.addEventListener('dragstart', (e) => {
    const group = e.target.closest('.org-folder-group');
    if (group && e.target === group && group.draggable) {
      draggedOrgFolderId = group.dataset.dragId;
      group.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', draggedOrgFolderId); } catch (err) { /* non bloquant */ }
      return;
    }
    const row = e.target.closest('.org-row');
    if (!row || e.target !== row || !row.draggable) return;
    draggedOrgItemId = row.dataset.dragId;
    row.classList.add('dragging');
    containerEl.classList.add('is-reordering');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', draggedOrgItemId); } catch (err) { /* non bloquant */ }
  });
  containerEl.addEventListener('dragover', (e) => {
    if (draggedOrgFolderId) {
      const group = e.target.closest('.org-folder-group');
      if (!group || group.dataset.dragId === draggedOrgFolderId) return;
      e.preventDefault();
      const rect = group.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      group.classList.toggle('drag-over-top', before);
      group.classList.toggle('drag-over-bottom', !before);
      return;
    }
    if (!draggedOrgItemId) return;
    const row = e.target.closest('.org-row');
    if (duplicateItem) { try { e.dataTransfer.dropEffect = isDuplicateDrag(e) ? 'copy' : 'move'; } catch (err) { /* non bloquant */ } }
    if (row && row.dataset.dragId !== draggedOrgItemId) {
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      row.classList.toggle('drag-over-top', before);
      row.classList.toggle('drag-over-bottom', !before);
      return;
    }
    const zone = e.target.closest('.org-folder-dropzone, .org-root-dropzone');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('org-drop-target');
  });
  containerEl.addEventListener('dragleave', (e) => {
    const group = e.target.closest('.org-folder-group');
    if (group && !group.contains(e.relatedTarget)) group.classList.remove('drag-over-top', 'drag-over-bottom');
    const row = e.target.closest('.org-row');
    if (row && !row.contains(e.relatedTarget)) row.classList.remove('drag-over-top', 'drag-over-bottom');
    const zone = e.target.closest('.org-folder-dropzone, .org-root-dropzone');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('org-drop-target');
  });
  containerEl.addEventListener('drop', (e) => {
    containerEl.classList.remove('is-reordering');
    containerEl.querySelectorAll('.drag-over-top, .drag-over-bottom, .org-drop-target').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom', 'org-drop-target');
    });
    const folders = getFolders();
    const items = getItems();
    if (draggedOrgFolderId) {
      e.preventDefault();
      const targetGroup = e.target.closest('.org-folder-group');
      const fromIdx = folders.findIndex(f => f.id === draggedOrgFolderId);
      draggedOrgFolderId = null;
      if (!targetGroup || fromIdx === -1) return;
      const targetId = targetGroup.dataset.dragId;
      if (targetId === folders[fromIdx].id) return;
      const toIdx = folders.findIndex(f => f.id === targetId);
      if (toIdx === -1) return;
      const rect = targetGroup.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      const insertAt = before ? toIdx : toIdx + 1;
      const [moved] = folders.splice(fromIdx, 1);
      const adjustedInsertAt = insertAt > fromIdx ? insertAt - 1 : insertAt;
      folders.splice(adjustedInsertAt, 0, moved);
      hasUnsavedEdits = true;
      onDrop();
      return;
    }
    if (!draggedOrgItemId) return;
    e.preventDefault();
    const it = items.find(x => x.id === draggedOrgItemId);
    const targetRow = e.target.closest('.org-row');
    const zone = e.target.closest('.org-folder-dropzone, .org-root-dropzone');
    draggedOrgItemId = null;
    if (!it) return;
    const fromIdx = items.indexOf(it);
    // Alt + glisser (6/10) : le morceau est COPIÉ à l'endroit visé au lieu d'être déplacé (liste qui le permet : duplicateItem).
    if (duplicateItem && isDuplicateDrag(e)) {
      if (targetRow && targetRow.dataset.dragId !== it.id) {
        const rect = targetRow.getBoundingClientRect();
        duplicateItem(it, { folderId: targetRow.dataset.folderId || null, anchorId: targetRow.dataset.dragId, before: (e.clientY - rect.top) < rect.height / 2 });
      } else if (zone) duplicateItem(it, { folderId: zone.dataset.folderId || null, append: true });
      else if (targetRow) duplicateItem(it, {}); // déposé sur lui-même : copie juste après
      return;
    }
    if (targetRow && targetRow.dataset.dragId !== it.id) {
      // Déposé sur un autre élément : change de groupe ET se positionne juste avant/après lui.
      const targetFolderId = targetRow.dataset.folderId || null;
      const rect = targetRow.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      items.splice(fromIdx, 1);
      const targetIdxNow = items.findIndex(x => x.id === targetRow.dataset.dragId);
      const insertAt = before ? targetIdxNow : targetIdxNow + 1;
      it.folderId = targetFolderId;
      items.splice(insertAt, 0, it);
      hasUnsavedEdits = true;
      onDrop();
    } else if (zone) {
      // Déposé sur une zone vide (dossier vide, ou padding sous le dernier élément) : change de groupe
      // seulement, ajouté en dernière position de ce groupe (donc en dernière position globale du
      // tableau -- l'ordre relatif au sein d'un groupe suivant celui du tableau, peu importe où vivent
      // les éléments des autres groupes entre-temps).
      const targetFolderId = zone.dataset.folderId || null;
      if (it.folderId === targetFolderId) return;
      items.splice(fromIdx, 1);
      it.folderId = targetFolderId;
      items.push(it);
      hasUnsavedEdits = true;
      onDrop();
    }
  });
  containerEl.addEventListener('dragend', (e) => {
    const group = e.target.closest('.org-folder-group');
    if (group) { group.classList.remove('dragging'); group.draggable = false; }
    const row = e.target.closest('.org-row');
    if (row) { row.classList.remove('dragging'); row.draggable = false; }
    containerEl.classList.remove('is-reordering');
    containerEl.querySelectorAll('.drag-over-top, .drag-over-bottom, .org-drop-target').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom', 'org-drop-target');
    });
    draggedOrgItemId = null;
    draggedOrgFolderId = null;
  });
}
// Pas de filet de sécurité pointerup/pointercancel dédié pour les lignes d'élément : chacune porte à la
// fois .org-row ET .seq-master-item (voir buildOrgRowEl), donc releaseAllDragHandles() ci-dessus
// (sélecteur .seq-master-item[draggable="true"]) les couvre déjà, quel que soit le panneau. Les groupes de
// dossier n'ont pas cette classe -- filet dédié pour eux, générique lui aussi.
function releaseAllOrgFolderDragHandles() {
  document.querySelectorAll('.org-folder-group[draggable="true"]').forEach(c => { c.draggable = false; });
}
document.addEventListener('pointerup', releaseAllOrgFolderDragHandles);
document.addEventListener('pointercancel', releaseAllOrgFolderDragHandles);
// Construit la colonne maître à dossiers (repliables) + zone racine pour une liste organisée en dossiers
// (20/08, généralisé) : réutilisée par "Gérer les AdReels", la bibliothèque Sfx et la bibliothèque de
// morceaux. items/folders doivent être les tableaux RÉELS (jamais une copie). opts :
//   selectedId          id actuellement affiché dans le panneau de détail
//   selectAction        nom de l'action data-action posée sur chaque ligne au clic (propre à chaque appelant)
//   toggleFolderAction  nom de l'action data-action du bouton repli/dépli de dossier
//   deleteFolderAction  nom de l'action data-action du bouton suppression de dossier
//   folderFieldAttr     nom de l'attribut data-*-folder-field posé sur le champ titre du dossier
//   folderFallbackKey   clé i18n du placeholder "dossier sans nom"
//   buildRowInner(item) renvoie le HTML interne d'une ligne (après la poignée) -- laisse à l'appelant le
//                       soin d'afficher ce qui a du sens pour lui (titre + badge, titre + compteur, etc.)
function renderOrgMasterList(masterHost, items, folders, collapsedFolderIds, opts) {
  function rowEl(item) {
    const row = document.createElement('div');
    row.className = 'seq-master-item org-row' + (item.id === opts.selectedId ? ' active' : '');
    row.dataset.action = opts.selectAction;
    row.dataset.dragId = item.id;
    row.dataset.folderId = item.folderId || '';
    row.innerHTML = `${dragHandleHtml()}${opts.buildRowInner(item)}`;
    return row;
  }
  masterHost.innerHTML = '';
  folders.forEach(folder => {
    const itemsInFolder = items.filter(it => it.folderId === folder.id);
    const collapsed = collapsedFolderIds.has(folder.id);
    const group = document.createElement('div');
    group.className = 'org-folder-group';
    group.dataset.dragId = folder.id;
    group.innerHTML = `
      <div class="org-folder-header">
        ${dragHandleHtml('folder-drag-handle')}
        <button class="btn btn-icon" data-action="${opts.toggleFolderAction}" data-folder-id="${folder.id}" type="button">${collapsed ? '▸' : '▾'}</button>
        <input type="text" class="org-folder-title" ${opts.folderFieldAttr}="label" data-folder-id="${folder.id}" value="${escapeAttr(folder.label)}" placeholder="${tr(opts.folderFallbackKey)}">
        ${deleteIconBtnHtml(opts.deleteFolderAction, { 'folder-id': folder.id }, tr('deleteBtn'))}
      </div>
    `;
    if (!collapsed) {
      const dropzone = document.createElement('div');
      dropzone.className = 'org-folder-dropzone';
      dropzone.dataset.folderId = folder.id;
      if (itemsInFolder.length) {
        itemsInFolder.forEach(it => dropzone.appendChild(rowEl(it)));
      } else {
        dropzone.innerHTML = `<div class="hint-inline org-folder-empty-hint">${tr('orgFolderEmptyHint')}</div>`;
      }
      group.appendChild(dropzone);
    }
    masterHost.appendChild(group);
  });
  const rootZone = document.createElement('div');
  rootZone.className = 'org-root-dropzone';
  rootZone.dataset.folderId = ''; // racine, hors de tout dossier
  items.filter(it => !it.folderId).forEach(it => rootZone.appendChild(rowEl(it)));
  masterHost.appendChild(rootZone);
}
// Supprime un dossier de façon non destructrice (20/08, généralisé) : demande confirmation seulement s'il
// contient encore des éléments, et les fait remonter à la racine plutôt que de les supprimer -- un
// AdReel/Sfx/morceau contient trop de travail pour risquer une perte accidentelle sur un simple clic de
// dossier. Renvoie (promesse) true si la suppression a eu lieu (pour laisser l'appelant décider de re-rendre ou non).
async function deleteOrgFolder(folders, items, folderId) {
  const hasItems = items.some(it => it.folderId === folderId);
  if (hasItems && !(await window.LayerPitchNotify.confirm(tr('deleteOrgFolderConfirm')))) return false;
  items.forEach(it => { if (it.folderId === folderId) it.folderId = null; });
  const idx = folders.findIndex(f => f.id === folderId);
  if (idx !== -1) folders.splice(idx, 1);
  return true;
}
