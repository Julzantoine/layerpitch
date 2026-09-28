/* ---------------- Layout (ordre des cartes) ---------------- */
// Résumé compact affiché sur l'en-tête de chaque bloc, replié ou déplié (10/08 -> lisibilité de la
// liste) : un simple comptage/aperçu, pas une vue détaillée, juste de quoi savoir ce qu'il y a dedans
// sans le déplier. tronqueSummary() coupe les textes libres (bio/texte) à une longueur d'aperçu.
function truncateSummary(str, max) {
  max = max || 46;
  const clean = String(str).replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}
function trCount(n, singularKey, pluralKey) {
  return tr(n === 1 ? singularKey : pluralKey, { n });
}
// Formulaire de contact configuré ou non -- même condition utilisée par buildContactBlockCard (avertissement
// dans le corps du bloc) et blockSummaryText (résumé compact de l'en-tête) : un seul point de vérité.
function hasContactFormEndpoint() {
  return !!(profile.contactEmail && profile.contactEmail.trim());
}
function blockSummaryText(block) {
  switch (block.type) {
    case 'header': {
      // Même fallback que l'affichage du champ dans buildHeaderCard : un AdReel publié avant l'existence
      // de profile.subtitle n'a qu'un profile.tagline (jamais recopié dans subtitle tant que le champ n'a
      // pas été édité) -- sans ce même fallback ici, le résumé dirait "vide" alors que l'écran montre un
      // vrai sous-titre hérité.
      const subtitle = (profile.subtitle != null) ? profile.subtitle : (profile.tagline || '');
      const parts = [profile.title, subtitle].filter(Boolean);
      return parts.length ? parts.join(' — ') : tr('blockSummaryEmpty');
    }
    case 'bio':
      return profile.bio ? truncateSummary(profile.bio) : tr('blockSummaryEmpty');
    case 'testimonials':
      return trCount(testimonials.length, 'blockSummaryTestimonialSingular', 'blockSummaryTestimonials');
    case 'tracks':
      return trCount(trackIds.length, 'blockSummaryTrackSingular', 'blockSummaryTracks');
    case 'text':
      return block.content ? truncateSummary(block.content) : tr('blockSummaryEmpty');
    case 'photo':
      return trCount((block.images || []).length, 'blockSummaryPhotoSingular', 'blockSummaryPhotos');
    case 'video':
      return trCount((block.videos || []).length, 'blockSummaryVideoSingular', 'blockSummaryVideos');
    case 'packs':
      return trCount((block.packIds || []).length, 'blockSummaryPackSingular', 'blockSummaryPacks');
    case 'collections':
      return trCount((block.collectionIds || []).length, 'blockSummaryCollectionSingular', 'blockSummaryCollections');
    case 'sfx':
      return trCount((block.sfxIds || []).length, 'blockSummarySfxSingular', 'blockSummarySfx');
    case 'socials': {
      const n = socialsShownInBlock(block).length;
      return n ? trCount(n, 'blockSummarySocialsSingular', 'blockSummarySocials') : tr('blockSummarySocialsNone');
    }
    case 'contact': {
      return hasContactFormEndpoint() ? tr('blockSummaryContactReady') : tr('blockSummaryContactMissing');
    }
    default:
      return '';
  }
}
// Appelé après layoutBlocks() (réordonnancement/ajout/suppression) et par chaque widget dont
// l'édition ne repasse pas par layoutBlocks() (sélecteur de morceaux, témoignages, photos, vidéos,
// packs/collections/Sfx, champs Header/Bio/Texte) -- simple rafraîchissement de texte, peu coûteux
// vu le nombre de blocs en jeu, pas besoin d'un système de dépendances plus fin.
function refreshAllBlockSummaries() {
  blocks.forEach(b => {
    const card = blockCards[b.id];
    if (!card) return;
    const el = card.querySelector('.block-summary');
    if (el) el.textContent = blockSummaryText(b);
  });
}

function allBlocksCollapsed() {
  return blocks.length > 0 && blocks.every(b => collapsedBlockIds.has(b.id));
}
function updateCollapseAllBtn() {
  const btn = document.getElementById('btnToggleCollapseAllBlocks');
  if (!btn) return;
  btn.textContent = allBlocksCollapsed() ? tr('expandAllBlocksBtn') : tr('collapseAllBlocksBtn');
}
function updateBlocksCountLabel() {
  const el = document.getElementById('blocksCountLabel');
  if (el) el.textContent = trCount(blocks.length, 'blocksCountSingular', 'blocksCountPlural');
}

function layoutBlocks() {
  const container = document.getElementById('blocksEditorContainer');
  blocks.forEach(b => { if (blockCards[b.id]) container.appendChild(blockCards[b.id]); });
  blocks.forEach((b, i) => {
    const card = blockCards[b.id];
    if (!card) return;
    card.querySelector('.pos').textContent = String(i + 1).padStart(2, '0');
  });
  refreshAllBlockSummaries();
  updateCollapseAllBtn();
  updateBlocksCountLabel();
  updateSingletonAddButtons();
}
// Les boutons "+ Bloc header/bio/témoignages/musique" (20/08, désormais supprimables comme n'importe quel
// autre bloc) ne sont affichés que si le type correspondant est absent de l'AdReel actuel -- pas de risque
// de doublon, pas de bouton inutile qui traînerait alors que le bloc existe déjà.
function updateSingletonAddButtons() {
  const presentTypes = new Set(blocks.map(b => b.type));
  const map = { header: 'btnAddHeaderBlock', bio: 'btnAddBioBlock', testimonials: 'btnAddTestimonialsBlock', tracks: 'btnAddTracksBlock' };
  Object.entries(map).forEach(([type, btnId]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.style.display = presentTypes.has(type) ? 'none' : '';
  });
}
document.getElementById('blocksEditorContainer').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.block-editor-card');
  const id = card.dataset.id;
  const i = blocks.findIndex(b => b.id === id);
  if (btn.dataset.action === 'toggle-collapse') {
    const body = card.querySelector('.block-editor-body');
    const collapsed = body.classList.toggle('collapsed');
    const topToggle = card.querySelector('.block-editor-head [data-action="toggle-collapse"]');
    if (topToggle) topToggle.textContent = collapsed ? '▸' : '▾';
    if (collapsed) collapsedBlockIds.add(id); else collapsedBlockIds.delete(id);
    updateCollapseAllBtn();
  }
  else if (btn.dataset.action === 'remove-block') {
    blocks.splice(i, 1);
    delete blockCards[id];
    card.remove();
    hasUnsavedEdits = true;
    layoutBlocks();
  }
});
document.getElementById('btnToggleCollapseAllBlocks').addEventListener('click', () => {
  const shouldCollapse = !allBlocksCollapsed();
  blocks.forEach(b => {
    const card = blockCards[b.id];
    if (!card) return;
    const body = card.querySelector('.block-editor-body');
    body.classList.toggle('collapsed', shouldCollapse);
    const topToggle = card.querySelector('.block-editor-head [data-action="toggle-collapse"]');
    if (topToggle) topToggle.textContent = shouldCollapse ? '▸' : '▾';
    if (shouldCollapse) collapsedBlockIds.add(b.id); else collapsedBlockIds.delete(b.id);
  });
  updateCollapseAllBtn();
});

