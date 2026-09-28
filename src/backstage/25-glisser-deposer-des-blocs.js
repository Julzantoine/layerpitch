/* ---------------- Glisser-déposer des blocs (poignée uniquement) ----------------
 * L'attribut draggable de la carte n'est activé que pendant que le pointeur est sur sa poignée
 * (pointerdown -> pointerup/pointercancel, sur tout le document pour couvrir un relâchement hors de
 * la poignée) -- un clic ailleurs sur la carte (titre, boutons, champs) ne peut donc jamais déclencher
 * un drag involontaire. API HTML5 native (pas de pointeur fait main) : outil desktop (Electron/
 * Chromium), zéro dépendance externe comme le reste du fichier. */
let draggedBlockId = null;
document.getElementById('blocksEditorContainer').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.block-drag-handle');
  if (!handle) return;
  const card = handle.closest('.block-editor-card');
  if (card && ownsHandle(card, handle)) card.draggable = true; // pas la poignée d'un morceau du bloc Musique (27/09)
});
// ---- Touche Supprimer (Supp ou ⌫) sur l'élément sélectionné (25/09, demande de Jules-Antoine) ----
// Sélection = dernier élément cliqué d'une liste (morceau, Sfx, AdReel, slot, section, boucle, couche) ou dernier bloc
// de contenu cliqué. La touche déclenche le bouton "Supprimer" existant de cet élément -- même nettoyage, mêmes
// garde-fous (bouton désactivé = rien) -- après confirmation, sauf quand ce bouton demande déjà la sienne.
// Jamais pendant la saisie dans un champ, ni quand une fenêtre est ouverte.
let kbSelection = null; // { kind: 'master', dragId, listId } | { kind: 'block', id }
const KB_DELETE_BY_LIST = { libraryMaster: 'remove-track', sfxLibraryMaster: 'remove-sfx', manageAdreelsMaster: 'delete-adreel-manage' };
const KB_DELETE_NESTED = ['remove-segment-slot', 'remove-section', 'remove-embr-loop', 'remove-layer'];
const KB_DELETE_SELF_CONFIRMING = ['remove-track', 'delete-adreel-manage'];
document.addEventListener('pointerdown', e => {
  if (!flagOpen('alt_drag_delete')) return; // touche Supprimer : feu vert 'alt_drag_delete' (admin seulement d'ici là)
  const card = e.target.closest('#blocksEditorContainer .block-editor-card');
  const item = !card && e.target.closest('.seq-master-item[data-drag-id]');
  if (!card && !item) return;
  document.querySelectorAll('.block-editor-card.kb-selected').forEach(c => c.classList.remove('kb-selected'));
  if (card) { card.classList.add('kb-selected'); kbSelection = { kind: 'block', id: card.dataset.id }; return; }
  const list = item.closest('.seq-master-list');
  kbSelection = { kind: 'master', dragId: item.dataset.dragId, listId: (list && list.id) || null };
}, true);
function kbDeleteTarget() {
  if (!kbSelection) return null;
  if (kbSelection.kind === 'block') {
    const card = document.querySelector(`#blocksEditorContainer .block-editor-card[data-id="${CSS.escape(kbSelection.id)}"]`);
    const btn = card && card.querySelector('[data-action="remove-block"]');
    return btn ? { btn, name: (card.querySelector('.block-editor-head strong') || {}).textContent || '' } : null;
  }
  const item = document.querySelector(`.seq-master-item[data-drag-id="${CSS.escape(kbSelection.dragId)}"]`);
  // Seul l'élément affiché à droite peut être supprimé : c'est lui que montre le détail, et son bouton qu'on déclenche.
  const panel = item && item.closest('.backstage-panel');
  if (!item || !item.classList.contains('active') || (panel && !panel.classList.contains('active'))) return null; // onglet affiché seulement
  const name = ((item.querySelector('.seq-master-item-label') || item).textContent || '').trim();
  const action = KB_DELETE_BY_LIST[kbSelection.listId];
  if (action) {
    const detail = document.getElementById(kbSelection.listId.replace('Master', 'Detail'));
    const btn = detail && detail.querySelector(`[data-action="${action}"]`);
    return btn ? { btn, name } : null;
  }
  const col = item.closest('.seq-two-col');
  const detail = col && col.querySelector(':scope > .seq-detail-col');
  const btn = detail && detail.querySelector(KB_DELETE_NESTED.map(a => `[data-action="${a}"]`).join(','));
  return btn ? { btn, name } : null;
}
document.addEventListener('keydown', async e => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  if (!flagOpen('alt_drag_delete')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) return;
  if ([...document.querySelectorAll('.vrs-batch-overlay, [id$="Overlay"]')].some(el => getComputedStyle(el).display !== 'none')) return; // fenêtre ouverte
  const target = kbDeleteTarget();
  if (!target || target.btn.disabled) return;
  e.preventDefault();
  const action = target.btn.dataset.action;
  if (!KB_DELETE_SELF_CONFIRMING.includes(action) && !(await window.LayerPitchNotify.confirm(tr('kbDeleteConfirm', { name: target.name || tr('untitledFallback') }), { danger: true }))) return;
  if (!target.btn.isConnected) return; // rendu refait pendant la question
  kbSelection = null;
  target.btn.click();
});
// Blocs uniques par nature (Header, Bio, Témoignages, Musique : un seul par AdReel, voir SINGLETON_TYPES) : pas de
// copie par Alt + glisser, ils restent seulement déplaçables.
function canDuplicateBlock(id) {
  const b = blocks.find(x => x.id === id);
  return !!b && !SINGLETON_TYPES.includes(b.type);
}
function releaseDragHandles() {
  document.querySelectorAll('#blocksEditorContainer .block-editor-card[draggable="true"]').forEach(c => { c.draggable = false; });
}
document.addEventListener('pointerup', releaseDragHandles);
document.addEventListener('pointercancel', releaseDragHandles);
document.getElementById('blocksEditorContainer').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.block-editor-card');
  if (!card || e.target !== card || !card.draggable) return; // drag d'une ligne imbriquée : pas le bloc
  draggedBlockId = card.dataset.id;
  card.classList.add('dragging');
  document.getElementById('blocksEditorContainer').classList.add('is-reordering');
  e.dataTransfer.effectAllowed = 'copyMove';
  try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (err) { /* certains navigateurs exigent un type MIME valide, jamais bloquant ici */ }
});
document.getElementById('blocksEditorContainer').addEventListener('dragover', (e) => {
  if (!draggedBlockId) return;
  // Toujours preventDefault dès qu'un drag de bloc est en cours -- y compris au-dessus de l'espace vide
  // du conteneur (pas seulement une carte) : sans ça, le navigateur refuse le drop hors des cartes, et
  // il devient impossible de déposer un bloc tout en bas de la liste.
  e.preventDefault();
  const dup = canDuplicateBlock(draggedBlockId) && isDuplicateDrag(e);
  e.dataTransfer.dropEffect = dup ? 'copy' : 'move';
  document.getElementById('blocksEditorContainer').classList.toggle('is-duplicating', dup);
  const card = e.target.closest('.block-editor-card');
  if (!card || (card.dataset.id === draggedBlockId && !dup)) return;
  const rect = card.getBoundingClientRect();
  const before = (e.clientY - rect.top) < rect.height / 2;
  card.classList.toggle('drag-over-top', before);
  card.classList.toggle('drag-over-bottom', !before);
});
document.getElementById('blocksEditorContainer').addEventListener('dragleave', (e) => {
  const card = e.target.closest('.block-editor-card');
  if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over-top', 'drag-over-bottom');
});
document.getElementById('blocksEditorContainer').addEventListener('drop', (e) => {
  if (!draggedBlockId) return;
  e.preventDefault();
  const targetCard = e.target.closest('.block-editor-card');
  document.querySelectorAll('#blocksEditorContainer .block-editor-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
  document.getElementById('blocksEditorContainer').classList.remove('is-reordering', 'is-duplicating');
  const fromIdx = blocks.findIndex(b => b.id === draggedBlockId);
  if (fromIdx === -1) return;
  if (canDuplicateBlock(draggedBlockId) && isDuplicateDrag(e)) {
    // Alt + glisser : copie du bloc à l'endroit visé (en fin de liste si lâché sous le dernier bloc).
    const copy = deepCloneWithNewIds(blocks[fromIdx]);
    let insertAt = blocks.length;
    if (targetCard) {
      const toIdx = blocks.findIndex(b => b.id === targetCard.dataset.id);
      const rect = targetCard.getBoundingClientRect();
      if (toIdx !== -1) insertAt = (e.clientY - rect.top) < rect.height / 2 ? toIdx : toIdx + 1;
    }
    blocks.splice(insertAt, 0, copy);
    if (collapsedBlockIds.has(draggedBlockId)) collapsedBlockIds.add(copy.id); // même état replié que l'original
    const newCard = buildCardForBlock(copy);
    if (newCard) blockCards[copy.id] = newCard;
    hasUnsavedEdits = true;
    layoutBlocks();
    return;
  }
  if (targetCard && targetCard.dataset.id !== draggedBlockId) {
    const toIdx = blocks.findIndex(b => b.id === targetCard.dataset.id);
    if (toIdx === -1) return;
    const rect = targetCard.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const insertAt = before ? toIdx : toIdx + 1;
    const [moved] = blocks.splice(fromIdx, 1);
    const adjustedInsertAt = insertAt > fromIdx ? insertAt - 1 : insertAt;
    blocks.splice(adjustedInsertAt, 0, moved);
    hasUnsavedEdits = true;
    layoutBlocks();
  } else if (!targetCard) {
    // Dépôt sur l'espace vide du conteneur (sous le dernier bloc, par exemple) : déplace le bloc en
    // toute fin de liste plutôt que de ne rien faire.
    const [moved] = blocks.splice(fromIdx, 1);
    blocks.push(moved);
    hasUnsavedEdits = true;
    layoutBlocks();
  }
});
document.getElementById('blocksEditorContainer').addEventListener('dragend', (e) => {
  if (!draggedBlockId) return;
  document.querySelectorAll('#blocksEditorContainer .block-editor-card').forEach(c => { c.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'); c.draggable = false; });
  document.getElementById('blocksEditorContainer').classList.remove('is-reordering', 'is-duplicating');
  draggedBlockId = null;
});

