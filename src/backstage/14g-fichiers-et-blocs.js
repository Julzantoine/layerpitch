// Repère de section dans un formulaire dense (éditeur de morceau) — même langage visuel que les eyebrows
// de la sidebar (nav-section-label), avec un filet de séparation en plus puisqu'ici le repère s'intercale
// entre des champs plutôt qu'en haut d'une liste de navigation.
function sectionEyebrow(label) {
  return `<div class="nav-section-label track-section-label">${label}</div>`;
}
// Bouton de repli en bas à droite d'un bloc long — mêmes data-action/data-* que le bouton du haut, pour
// qu'il soit pris en charge par le même gestionnaire délégué sans rien ajouter de spécifique. N'a besoin
// d'afficher qu'un seul état ("replier") : il ne peut jamais être visible quand le bloc est déjà replié,
// puisqu'il vit à l'intérieur du corps repliable lui-même.
function collapseFooterHtml(action, dataAttrs) {
  const attrs = Object.entries(dataAttrs).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  return `<div class="collapse-footer"><button type="button" class="btn btn-small" data-action="${action}" ${attrs}>▴ ${tr('collapseBlockBtn')}</button></div>`;
}
function updateFileStatus(statusEl, pendingFile, remoteFile, originalFileName) {
  if (pendingFile) { statusEl.textContent = tr('selectedFilePrefix', { name: pendingFile.name }); statusEl.className = 'file-status pending'; }
  // Nom de fichier affiché même une fois publié (29/08, retour de Jules-Antoine) -- remoteFile est déjà le
  // chemin/nom lui-même partout dans ce fichier, plus besoin d'aller chercher ailleurs.
  // originalFileName (29/08, retour de Jules-Antoine) : nom donné par le compositeur au moment de
  // l'upload (ex. "Lent.wav"), distinct du nom généré par l'app pour le stockage distant (ex.
  // "loop1-on-est-repere.ogg", dérivé du label) -- bien plus lisible pour le compositeur que le nom
  // technique. Absent sur les fichiers publiés AVANT ce chantier (jamais capturé à l'époque) : repli sur
  // le nom de stockage, comportement inchangé pour eux.
  else if (remoteFile) { statusEl.textContent = tr('publishedFilePrefix', { name: originalFileName || basenameOf(remoteFile) }); statusEl.className = 'file-status ok'; }
  else { statusEl.textContent = tr('noFileStatus'); statusEl.className = 'file-status'; }
}
function wireFileControl(root, accept, getPending, getRemote, onSelect, getOriginalName) {
  const btn = root.querySelector('[data-role="pickBtn"]');
  const input = root.querySelector('[data-role="fileInput"]');
  const status = root.querySelector('[data-role="fileStatus"]');
  input.accept = accept;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0] || null;
    onSelect(f);
    updateFileStatus(status, f, getRemote(), getOriginalName ? getOriginalName() : null);
  });
  updateFileStatus(status, getPending(), getRemote(), getOriginalName ? getOriginalName() : null);
  // Glisser-déposer un fichier directement sur la ligne du bouton (25/09, demande de Jules-Antoine pour
  // l'intro/outro) : même effet qu'un choix via le bouton. Posé ici plutôt qu'au cas par cas, donc valable
  // pour TOUS les sélecteurs de fichier. stopPropagation seulement si le fichier est accepté : un dépôt
  // précis sur un sélecteur remplace SON fichier, au lieu d'être aussi capté par une zone de dépôt
  // multi-fichiers englobante (wireBatchDrop, qui ajoute de nouvelles variations).
  const dropZone = root.querySelector('.file-ctrl') || root;
  const acceptsFile = f => fileMatchesAccept(f, accept);
  dropZone.addEventListener('dragover', e => {
    if (![...(e.dataTransfer.types || [])].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    dropZone.classList.remove('drag-over');
    e.preventDefault(); // jamais d'ouverture du fichier par le navigateur (qui quitterait la page sans sauvegarder)
    const f = [...(e.dataTransfer.files || [])].find(acceptsFile);
    if (!f) return; // type refusé : on laisse remonter vers une éventuelle zone de dépôt englobante
    e.stopPropagation();
    onSelect(f);
    updateFileStatus(status, f, getRemote(), getOriginalName ? getOriginalName() : null);
  });
}
// Vérifie un fichier contre une chaîne `accept` d'input file (".wav,audio/wav,image/*"...) -- extensions,
// types MIME exacts et jokers "type/*".
function fileMatchesAccept(f, accept) {
  if (!f) return false;
  if (!accept) return true;
  const name = (f.name || '').toLowerCase();
  const type = (f.type || '').toLowerCase();
  return accept.split(',').map(a => a.trim().toLowerCase()).filter(Boolean).some(a => {
    if (a.startsWith('.')) return name.endsWith(a);
    if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1));
    return type === a;
  });
}

// Filet de sécurité (25/09) : un fichier lâché hors d'une zone de dépôt ne doit jamais être ouvert par le
// navigateur, qui quitterait le Backstage en perdant les modifications non enregistrées. Les zones de dépôt
// traitent l'événement avant qu'il n'arrive ici.
['dragover', 'drop'].forEach(type => document.addEventListener(type, e => {
  if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault();
}));
function wireBatchDrop(hostEl, onFiles) {
  hostEl.addEventListener('dragover', e => {
    if (![...(e.dataTransfer.types || [])].includes('Files')) return; // un glisser interne (réordonner) n'est pas un dépôt de fichiers
    e.preventDefault(); hostEl.classList.add('drag-over');
  });
  hostEl.addEventListener('dragleave', () => hostEl.classList.remove('drag-over'));
  hostEl.addEventListener('drop', e => {
    e.preventDefault();
    hostEl.classList.remove('drag-over');
    // L'ordre fourni par dataTransfer.files n'est pas garanti par la spec (varie selon navigateur/OS lors
    // d'un dépôt multi-fichiers) -- on retrie par nom (tri naturel : "#2" avant "#10") pour que l'ordre
    // affiché corresponde à celui attendu par le compositeur, quel que soit l'ordre de dépôt réel (14/09,
    // retour de Jules-Antoine).
    const files = [...(e.dataTransfer.files || [])]
      .filter(f => /\.(wav|mp3)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (files.length) { e.stopPropagation(); onFiles(files); } // traité ici : pas une 2e fois par un bloc englobant
  });
}

function migrateBlocks(data) {
  let loaded = data.blocks;
  // Un tableau vide est désormais un état légitime (tous les blocs supprimés intentionnellement, 20/08) --
  // à ne pas confondre avec un champ absent/corrompu (ancien format en tableau de chaînes) qui, lui,
  // déclenche la reconstruction "legacy" ci-dessous. `loaded.length > 0 &&` évite de traiter [] comme
  // legacy simplement parce que loaded[0] vaut undefined.
  const isLegacyOrMissing = !Array.isArray(loaded) || (loaded.length > 0 && typeof loaded[0] !== 'object');
  if (isLegacyOrMissing) {
    const legacy = Array.isArray(loaded) ? loaded : ['header', 'testimonials', 'videos', 'gallery', 'bio', 'tracks'];
    const out = [];
    legacy.forEach(type => {
      const t = type === 'photo' ? 'gallery' : type;
      if (t === 'gallery') out.push({ id: genId(), type: 'photo', align: 'left', images: (data.gallery || []).map(g => ({ file: g.file })) });
      else if (t === 'videos') out.push({ id: genId(), type: 'video', videos: (data.videos || []).map(v => ({ title: v.title, url: v.url })) });
      else if (SINGLETON_TYPES.includes(t)) out.push({ id: genId(), type: t });
    });
    loaded = out;
  }
  loaded.forEach(b => {
    if (b.type === 'photo' && !b.images) b.images = b.file ? [{ file: b.file }] : [];
    if (b.type === 'video' && !b.videos) b.videos = (b.title || b.url) ? [{ title: b.title || '', url: b.url || '' }] : [];
  });
  // Plus de réinjection forcée des types "singleton" ici (retirée le 20/08) : un bloc Header/Bio/
  // Témoignages/Musique supprimé par le compositeur doit rester supprimé au rechargement suivant, pas
  // réapparaître vide tout seul. Le menu "+ Ajouter un bloc" permet de le rajouter s'il change d'avis
  // (voir les boutons btnAddHeaderBlock et consorts).
  return loaded;
}

function freshBlocks() {
  return [
    { id: genId(), type: 'header' },
    { id: genId(), type: 'tracks' },
    { id: genId(), type: 'bio' }
  ];
}

