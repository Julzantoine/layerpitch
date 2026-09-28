// Presets du palier Free (Chantier Apparence Phase 3, 4 septembre) — copiés tel quel depuis
// layerpitch-backstage.html, même encodage, même logique, pas de duplication de concept. resolveThemePreset
// applique le même repli silencieux sur "Défaut" que côté backstage si presetId est absent/inconnu.
const THEME_PRESETS = [
  { id: 'default', labelKey: 'themePresetDefault', bgColor: '#FAFAF8', titleColor: '#1A1A1A', contentColor: '#333333', font: 'default', separator: { visible: true, color: '#E0E0DC', thickness: 1 } },
  { id: 'night', labelKey: 'themePresetNight', bgColor: '#121212', titleColor: '#FFFFFF', contentColor: '#C9C9CE', font: 'default', separator: { visible: true, color: '#3A3A40', thickness: 1 } },
  { id: 'amber', labelKey: 'themePresetAmber', bgColor: '#F5EDE0', titleColor: '#A85C1E', contentColor: '#5C4530', font: 'google:Fraunces', separator: { visible: true, color: '#C99A6B', thickness: 3 } },
  { id: 'neon', labelKey: 'themePresetNeon', bgColor: '#1B1035', titleColor: '#FF3EA5', contentColor: '#D9CFFF', font: 'google:Space Grotesk', separator: { visible: true, color: '#7A5FFF', thickness: 1 } },
  { id: 'forest', labelKey: 'themePresetForest', bgColor: '#16321F', titleColor: '#D4AF37', contentColor: '#EDE6D6', font: 'google:Zilla Slab', separator: { visible: true, color: '#8C7A3D', thickness: 1 } },
  { id: 'minimal', labelKey: 'themePresetMinimal', bgColor: '#FFFFFF', titleColor: '#000000', contentColor: '#4D4D4D', font: 'google:Manrope', separator: { visible: false, color: '#E0E0DC', thickness: 1 } }
];
function resolveThemePreset(presetId) {
  return THEME_PRESETS.find(p => p.id === presetId) || THEME_PRESETS[0];
}
const DEFAULT_SEPARATOR = { visible: false, color: '#E2E2E6', thickness: 1 };
// Applique le réglage d'apparence par bloc (block.appearance), s'il existe, par-dessus le thème général —
// un bloc sans override n'est jamais touché (transparent, hérite entièrement du thème). Un bloc avec une
// couleur de fond personnalisée devient visuellement une "carte" (fond + marge intérieure) puisqu'il se
// détache alors du fond de page ; sans override de fond, aucun style de boîte n'est ajouté.
function applyBlockAppearance(el, block, customFonts) {
  const ov = block.appearance;
  if (!ov) return;
  if (ov.bgColor) {
    el.style.background = ov.bgColor;
    el.style.borderRadius = '10px';
    el.style.padding = '28px';
    el.style.margin = '12px 0';
  }
  if (ov.titleColor) el.style.setProperty('--text-title', ov.titleColor);
  if (ov.contentColor) el.style.setProperty('--text', ov.contentColor);
  if (ov.sectionLabelColor) el.style.setProperty('--section-label-color', ov.sectionLabelColor);
  if (ov.font) {
    const family = fontCssFamily(ov.font, customFonts);
    if (family) el.style.setProperty('--font-body', family);
  }
  // Image de fond propre à CE bloc : un calque interne en arrière-plan (position absolue, opacité
  // réglable) plutôt que de mettre l'opacité sur le bloc entier — sans ça, le texte du bloc deviendrait
  // lui aussi transparent, ce qui n'est jamais l'effet recherché.
  // IMPORTANT : on déplace les vrais nœuds DOM existants (pas une copie via innerHTML) pour ne jamais
  // perdre les gestionnaires d'événements déjà attachés par le rendu du bloc (formulaire de contact,
  // lecteur de morceaux, etc.) — une simple copie de innerHTML les aurait silencieusement détruits.
  if (ov.bgImage) {
    const inner = document.createElement('div');
    inner.style.position = 'relative';
    inner.style.zIndex = '1';
    while (el.firstChild) inner.appendChild(el.firstChild);
    const bgLayer = document.createElement('div');
    const opacity = (ov.bgImageOpacity != null) ? ov.bgImageOpacity : 1;
    bgLayer.style.cssText = `position:absolute;inset:0;background-image:url('${resolveImageUrl(ov.bgImage)}');background-size:cover;background-position:center;opacity:${opacity};border-radius:inherit;`;
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    if (!ov.bgColor) { el.style.borderRadius = '10px'; el.style.padding = '28px'; el.style.margin = '12px 0'; }
    el.appendChild(bgLayer);
    el.appendChild(inner);
  }
}

// Registre déclaratif des éléments personnalisables par type de bloc (Chantier Apparence, palier Pro,
// réglage par élément, 05/09) -- dupliqué à l'identique dans layerpitch-backstage.html (UI d'édition),
// même principe que THEME_PRESETS/DEFAULT_SEPARATOR déjà dupliqués ailleurs (pas de module JS partagé
// entre backstage et pages publiques dans ce projet). type 'text' -> {color, font} appliqués en style
// inline sur chaque élément trouvé par `selector` (couleur ET police, jamais l'un sans l'autre côté
// stockage même si un seul des deux a été réglé) ; 'simple' -> {color} seul, propriété CSS cible choisie
// par `simpleKind` ('icon' = color+borderColor, 'frame' = introduit un cadre de 2px, 'border' = recolore
// un cadre déjà existant dans la feuille de style) ; 'twostate' -> {playedColor, unplayedColor}, sans
// `selector` -- consommé directement par player.js (forme d'onde/barre de progression, pilotées par du
// JS/canvas, pas par une règle CSS), voir le cas 'tracks' plus haut dans blocks.forEach.
const ELEMENT_APPEARANCE_REGISTRY = {
  header: [
    { key: 'title', type: 'text', labelKey: 'elHeaderTitle', selector: '.header-title' },
    { key: 'subtitle', type: 'text', labelKey: 'elHeaderSubtitle', selector: '.header-subtitle' },
    { key: 'logo', type: 'simple', simpleKind: 'frame', labelKey: 'elHeaderLogo', selector: '.logo-img' }
  ],
  bio: [
    { key: 'title', type: 'text', labelKey: 'elBioTitle', selector: '.section-label' },
    { key: 'body', type: 'text', labelKey: 'elBioBody', selector: '.bio-text p' }
  ],
  testimonials: [
    { key: 'quote', type: 'text', labelKey: 'elTestimonialQuote', selector: '.testimonial p' },
    { key: 'author', type: 'text', labelKey: 'elTestimonialAuthor', selector: '.testimonial cite' },
    { key: 'role', type: 'text', labelKey: 'elTestimonialRole', selector: '.testimonial-role' },
    { key: 'avatar', type: 'simple', simpleKind: 'frame', labelKey: 'elTestimonialAvatar', selector: '.testimonial-avatar' }
  ],
  tracks: [
    { key: 'title', type: 'text', labelKey: 'elTrackTitle', selector: '.track-row-title .name' },
    { key: 'description', type: 'text', labelKey: 'elTrackDescription', selector: '.track-desc' },
    { key: 'tags', type: 'text', labelKey: 'elTrackTags', selector: '.track-tags .tag' },
    { key: 'waveform', type: 'twostate', labelKey: 'elTrackWaveform' },
    { key: 'progressBar', type: 'twostate', labelKey: 'elTrackProgressBar' },
    { key: 'playButton', type: 'simple', simpleKind: 'icon', labelKey: 'elTrackPlayButton', selector: '.play-btn' }
  ],
  text: [
    { key: 'title', type: 'text', labelKey: 'elTextTitle', selector: '.text-block-title' },
    { key: 'body', type: 'text', labelKey: 'elTextBody', selector: '.text-block p' }
  ],
  photo: [
    { key: 'caption', type: 'text', labelKey: 'elPhotoCaption', selector: '.photo-block-caption' },
    { key: 'border', type: 'simple', simpleKind: 'border', labelKey: 'elPhotoBorder', selector: '.photo-block-single img, .photo-grid img' }
  ],
  video: [
    { key: 'title', type: 'text', labelKey: 'elVideoTitle', selector: '.vt' },
    { key: 'caption', type: 'text', labelKey: 'elVideoCaption', selector: '.video-comment' }
  ],
  packs: [
    { key: 'title', type: 'text', labelKey: 'elPacksTitle', selector: '.packs-list-item-title' },
    { key: 'presentation', type: 'text', labelKey: 'elPacksPresentation', selector: '.block-presentation' },
    { key: 'illustration', type: 'simple', simpleKind: 'border', labelKey: 'elPacksIllustration', selector: '.packs-list-item-thumb' }
  ],
  collections: [
    { key: 'title', type: 'text', labelKey: 'elCollectionsTitle', selector: '.packs-list-item-title' },
    { key: 'presentation', type: 'text', labelKey: 'elCollectionsPresentation', selector: '.block-presentation' },
    { key: 'illustration', type: 'simple', simpleKind: 'border', labelKey: 'elCollectionsIllustration', selector: '.packs-list-item-thumb' }
  ],
  sfx: [
    { key: 'title', type: 'text', labelKey: 'elSfxTitle', selector: '.track-row-title .name' },
    { key: 'tag', type: 'text', labelKey: 'elSfxTag', selector: '.track-tags .tag' }
  ],
  socials: [
    { key: 'icons', type: 'text', labelKey: 'elSocialsIcons', selector: '.social-links a' }
  ],
  contact: [
    { key: 'buttonLabel', type: 'text', labelKey: 'elContactButtonLabel', selector: '.contact-form button' },
    { key: 'formFields', type: 'simple', simpleKind: 'border', labelKey: 'elContactFormFields', selector: '.contact-form input, .contact-form textarea' }
  ]
};
// Applique une surcharge par-élément (texte ou simple) à chaque élément correspondant trouvé DANS le
// conteneur du bloc -- jamais hors de ce sous-arbre, pour ne jamais déborder sur un autre bloc du même
// type (ex. deux blocs "Musique" distincts sur la même page, chacun avec son propre réglage).
function applyElementAppearanceValue(container, entry, ov, customFonts) {
  const els = container.querySelectorAll(entry.selector);
  if (!els.length) return;
  els.forEach(el => {
    if (entry.type === 'text') {
      if (ov.color) el.style.color = ov.color;
      if (ov.font) {
        const family = fontCssFamily(ov.font, customFonts);
        if (family) el.style.fontFamily = family;
      }
    } else if (entry.type === 'simple' && ov.color) {
      if (entry.simpleKind === 'icon') { el.style.color = ov.color; el.style.borderColor = ov.color; }
      else if (entry.simpleKind === 'frame') { el.style.border = `2px solid ${ov.color}`; if (!el.style.borderRadius) el.style.borderRadius = '8px'; }
      else { el.style.borderColor = ov.color; } // 'border' : la feuille de style pose déjà une bordure, on ne fait que la recolorer
    }
  });
}
// Point d'entrée pour les éléments 'text'/'simple' (les 'twostate' -- forme d'onde/barre de progression
// du bloc Musique -- sont résolus et transmis séparément à renderTracksBlock, voir blocks.forEach
// ci-dessus, car ils sont consommés par du JS/canvas et non par une règle CSS après coup).
function applyElementAppearance(container, block, tier, customFonts) {
  // Palier Pro strictement (imbriqué dans une section déjà visible dès Starter côté block.appearance) --
  // repli non destructif si le compositeur repasse Starter/Free : les données restent en base (voir
  // publication), simplement plus appliquées ici tant que le palier effectif n'est pas Pro.
  if (tier !== 'pro') return;
  const registry = ELEMENT_APPEARANCE_REGISTRY[block.type];
  const ov = block.elementAppearance;
  if (!registry || !ov) return;
  registry.forEach(entry => {
    if (entry.type === 'twostate') return;
    const entryOv = ov[entry.key];
    if (entryOv) applyElementAppearanceValue(container, entry, entryOv, customFonts);
  });
}

// LAYERPITCH_FUNCTIONS_URL/ANON_KEY : mêmes valeurs publiques que api/supabase-client.js (clé
// "publishable", pas un secret) — appelées ici en fetch() brut plutôt que de charger tout le SDK
// Supabase + loadPostgresReadScripts() (api/tracks.js, api/packs.js...) juste pour ce formulaire.
