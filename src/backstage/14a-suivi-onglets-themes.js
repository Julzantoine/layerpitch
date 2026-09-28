function pushEvent(entry) {
  try {
    if (entry.context === 'test' || !window.umami || typeof window.umami.track !== 'function') return;
    window.umami.track('backstage_' + entry.type, Object.assign({ name: String(entry.name).slice(0, 200) }, entry.detail));
  } catch (e) { /* jamais bloquant pour l'utilisateur */ }
}
function trackBackstageEvent(name, detail) {
  pushEvent({ type: 'action', name, ts: new Date().toISOString(), context: isModeTest() ? 'test' : 'real', detail: detail || {} });
}
function trackBackstageError(message, detail) {
  pushEvent({ type: 'error', name: message, ts: new Date().toISOString(), context: isModeTest() ? 'test' : 'real', detail: detail || {} });
}
window.addEventListener('error', (e) => {
  trackBackstageError(e.message, { source: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  trackBackstageError((e.reason && e.reason.message) || String(e.reason), { unhandledRejection: true });
});

function switchTab(tabName) {
  document.querySelectorAll('.backstage-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tabName));
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
}
document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!btn.disabled) {
      switchTab(btn.dataset.tab);
      trackBackstageEvent('tab_switch', { tab: btn.dataset.tab });
      // Chargement à la demande (appel RPC get_my_analytics()) -- jamais au chargement du
      // backstage, seulement quand le compositeur ouvre vraiment l'onglet.
      if (btn.dataset.tab === 'analytics') loadAnalyticsIfNeeded();
      if (btn.dataset.tab === 'videoLibrary') renderVideoLibrary();
      if (btn.dataset.tab === 'albums') loadAlbums();
    }
  });
});

const BLOCK_LABELS = { header: tr('blockLabelHeader'), bio: tr('blockLabelBio'), testimonials: tr('blockLabelTestimonials'), tracks: tr('blockLabelTracks'), text: tr('blockLabelText'), photo: tr('blockLabelPhoto'), video: tr('blockLabelVideo'), packs: tr('blockLabelPacks'), collections: tr('blockLabelCollections'), sfx: tr('blockLabelSfx'), socials: tr('blockLabelSocials'), contact: tr('blockLabelContact') };
const SINGLETON_TYPES = ['header', 'bio', 'testimonials', 'tracks'];
const KNOWN_TYPES = ['header', 'bio', 'testimonials', 'tracks', 'text', 'photo', 'video'];

// Thème général d'un AdReel : remplace les anciens champs profile.bgColor/textColor (gardés en lecture
// seule pour la rétrocompatibilité — jamais réécrits, seul profile.theme est publié désormais).
const DEFAULT_THEME = { bgColor: '#f5f6f8', titleColor: '#24262b', contentColor: '#24262b', sectionLabelColor: '#2f80c0', font: 'default', bgImage: null, bgImageOpacity: 1 };
// Liste de polices Google Fonts pré-intégrées — mélange délibéré sans-serif/serif/display pour couvrir
// différents styles de pitch (neutre/technique vs plus éditorial), sans imposer d'upload personnalisé.
const GOOGLE_FONTS_PRESET = [
  'Inter', 'Space Grotesk', 'Poppins', 'Sora', 'Manrope',
  'Playfair Display', 'Fraunces', 'DM Serif Display', 'Spectral', 'Zilla Slab',
  'IBM Plex Mono', 'JetBrains Mono'
];
// Champs d'apparence personnalisables, partagés entre le réglage général (profile.theme) et les
// réglages par bloc (block.appearance) — un seul et même jeu de champs, une seule UI générique.
// type 'color' -> <input type=color> ; type 'font' -> sélecteur (buildFontSelectOptionsHtml).
const APPEARANCE_FIELDS = [
  { key: 'bgColor', label: 'themeBgColorLabel', type: 'color' },
  { key: 'titleColor', label: 'themeTitleColorLabel', type: 'color' },
  { key: 'contentColor', label: 'themeContentColorLabel', type: 'color' },
  { key: 'sectionLabelColor', label: 'themeSectionLabelColorLabel', type: 'color' },
  { key: 'font', label: 'themeFontLabel', type: 'font' },
  { key: 'bgImage', label: 'themeBgImageLabel', type: 'image' },
  { key: 'bgImageOpacity', label: 'themeBgImageOpacityLabel', type: 'opacity' }
];
// Presets Free (Chantier Apparence Phase 3, 4 septembre) : le palier Free n'a plus accès aux réglages
// fins (couleurs/police/séparateurs libres) -- seulement le choix d'un des 6 presets ci-dessous, qui
// fige tout (fond, titres, contenu, police, séparateur) en un clic. Stocké comme un identifiant
// (profile.theme.presetId / pack.presetId / collection.presetId), jamais dupliqué en valeurs de
// couleur dans les données du compositeur -- la résolution id -> valeurs se fait ici et, à l'identique
// (copié tel quel), côté chacune des 3 pages publiques. Contraste vérifié WCAG AA (voir changelog) :
// pire ratio observé 4.29:1 (titre Ambre, réservé au grand texte du header -> seuil AA 3:1, large marge).
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
// 6 thèmes supplémentaires, réservés au départ rapide du palier Pro (10 septembre) -- jamais proposés
// dans la galerie Free, jamais résolus par resolveThemePreset() ci-dessus (qui reste la lecture utilisée
// par le rendu public pour le palier Free, inchangée). Contraste WCAG AA vérifié via contrastRatio()
// ci-dessous, pire ratio observé 4.22:1 (titre Sakura, grand texte du header -> seuil AA 3:1, large
// marge) ; tous les autres ratios de contenu ≥ 4.5:1 (texte normal, seuil le plus strict).
const THEME_PRESETS_PRO = [
  { id: 'ocean', labelKey: 'themePresetOcean', bgColor: '#0A2E36', titleColor: '#4ECDC4', contentColor: '#B8E3E0', font: 'google:Sora', separator: { visible: true, color: '#1F5A63', thickness: 1 } },
  { id: 'crimson', labelKey: 'themePresetCrimson', bgColor: '#1A0A0A', titleColor: '#E63946', contentColor: '#D9B8B8', font: 'google:DM Serif Display', separator: { visible: true, color: '#5C1A1A', thickness: 2 } },
  { id: 'sakura', labelKey: 'themePresetSakura', bgColor: '#FDF2F4', titleColor: '#D6336C', contentColor: '#6B4650', font: 'google:Poppins', separator: { visible: true, color: '#F3C6D3', thickness: 1 } },
  { id: 'steel', labelKey: 'themePresetSteel', bgColor: '#1C1F26', titleColor: '#A8B5C4', contentColor: '#8E9AAC', font: 'google:IBM Plex Mono', separator: { visible: true, color: '#3A4150', thickness: 1 } },
  { id: 'royal', labelKey: 'themePresetRoyal', bgColor: '#2E0F1D', titleColor: '#D4AF37', contentColor: '#E8DCC8', font: 'google:Playfair Display', separator: { visible: true, color: '#6B4A8C', thickness: 2 } },
  { id: 'dune', labelKey: 'themePresetDune', bgColor: '#EDE0C8', titleColor: '#A64B2A', contentColor: '#6B5842', font: 'google:Spectral', separator: { visible: true, color: '#C9A876', thickness: 1 } }
];
// Résolution pour le départ rapide Pro uniquement : cherche dans les 12 (6 Free + 6 Pro). Ne remplace
// PAS resolveThemePreset() -- celle-ci reste la lecture Free/rendu public, jamais étendue aux 6 Pro
// puisque le palier Pro ne stocke jamais de presetId (voir applyThemePresetQuickFill).
function resolveAnyThemePreset(presetId) {
  return THEME_PRESETS.concat(THEME_PRESETS_PRO).find(p => p.id === presetId) || THEME_PRESETS[0];
}
// Réglage des séparateurs entre blocs/sections, indépendant du reste du thème général -- palier Starter
// et au-dessus uniquement (le palier Free suit le séparateur imposé par son preset). Absent tant que le
// compositeur n'y touche pas -> aucun changement visuel pour les AdReels/Packs/Collections déjà publiés
// (il n'existe aucun séparateur visuel aujourd'hui, seulement du margin entre blocs/sections).
const DEFAULT_SEPARATOR = { visible: false, color: '#E2E2E6', thickness: 1 };

// ---- Utilitaires couleur (Chantier Apparence, réglage par élément, palier Pro, 05/09) --------------
// Contraste WCAG AA (formule officielle W3C) -- aucune fonction de ce genre n'existait avant ce chantier
// dans tout le projet (la vérification des 6 THEME_PRESETS avait été faite via un script Node ponctuel,
// jamais committé, voir docs/LAYERPITCH_CHANGELOG.md). Utilisée ici pour un avertissement EN DIRECT
// pendant l'édition (pas un blocage : le compositeur reste libre de son choix, juste informé).
function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (full.length !== 6 || isNaN(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function relativeLuminance({ r, g, b }) {
  const chan = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB), darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
const WCAG_AA_TEXT_RATIO = 4.5; // seuil AA texte normal (le plus strict des deux seuils AA -- volontairement pas 3:1 "grand texte", plus prudent sans distinguer la taille réelle de chaque élément)
// Variante atténuée d'une couleur -- mélange à 55% vers un gris neutre (148,148,148). Utilisée comme
// couleur "à jouer" par défaut (forme d'onde/barre de progression) avant toute personnalisation : point
// d'architecture 2 du chantier ("ne pas livrer un état visuellement cassé tant que le compositeur n'a
// rien réglé").
function mutedVariant(hex) {
  const { r, g, b } = hexToRgb(hex);
  const mix = c => Math.round(c * 0.45 + 148 * 0.55);
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Registre déclaratif des éléments personnalisables par type de bloc -- copie exacte de celui d'index.html
// (même principe de duplication que THEME_PRESETS/DEFAULT_SEPARATOR déjà dupliqués entre backstage et
// pages publiques, pas de module JS partagé dans ce projet). `selector` n'est pas utilisé ici (l'UI
// d'édition ne rend pas le DOM public), gardé pour éviter toute divergence de structure entre les deux
// copies. type 'text' -> {color, font} ; 'simple' -> {color} ; 'twostate' -> {playedColor, unplayedColor}.
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

// Reconstruit un thème complet à partir d'un profil quelconque : profile.theme s'il existe déjà, sinon
// dérivé des anciens champs bgColor/textColor s'ils existent (une seule teinte de texte à l'époque,
// reprise à la fois pour titleColor et contentColor faute de mieux), sinon les valeurs par défaut.
function migrateProfileTheme(rawProfile) {
  if (rawProfile && rawProfile.theme) return Object.assign({}, DEFAULT_THEME, rawProfile.theme);
  if (rawProfile && (rawProfile.bgColor || rawProfile.textColor)) {
    return {
      bgColor: rawProfile.bgColor || DEFAULT_THEME.bgColor,
      titleColor: rawProfile.textColor || DEFAULT_THEME.titleColor,
      contentColor: rawProfile.textColor || DEFAULT_THEME.contentColor,
      font: DEFAULT_THEME.font,
      bgImage: DEFAULT_THEME.bgImage,
      bgImageOpacity: DEFAULT_THEME.bgImageOpacity
    };
  }
  return Object.assign({}, DEFAULT_THEME);
}

let blocks = [];        // [{id, type, ...content pour text/photo/video}] — de l'AdReel en cours d'édition
let blockCards = {};    // id -> DOM element (card)
let profile = { title: '', subtitle: '', bio: '', contactEmail: '', contactUrl: '', logo: null, photo: null, theme: Object.assign({}, DEFAULT_THEME) };
let logoPendingFile = null, photoPendingFile = null;
// Image de fond générale de l'AdReel en cours d'édition — même principe de va-et-vient que logo/photo
// (fichier en attente hors de profile.theme lui-même, pour ne jamais contaminer la sérialisation de
// profile.theme avec un objet File non publiable ; mirroré vers/depuis ar.themeBgImagePendingFile au
// changement d'AdReel, uploadé à la publication).
let themeBgImagePendingFile = null;
let testimonials = [];
let trackIds = [];      // sélection ordonnée de morceaux (ids) pour l'AdReel en cours d'édition
// Surcharges de texte par morceau, propres à cet AdReel (jamais aux Packs) : { [trackId]: { title?, description?, layers?: {[li]: label}, stingers?: {[si]: label} } }.
// Absent = on garde le texte de la Bibliothèque tel quel. Permet par ex. une version anglaise d'un AdReel
// sans toucher aux textes français de référence dans la Bibliothèque.
let trackOverrides = {};
let library = [];       // bibliothèque de morceaux, partagée entre tous les AdReels et Packs
// Dossiers de la bibliothèque de morceaux (20/08, même mécanisme générique que les dossiers d'AdReel/Sfx).
let libraryFolders = [];
const collapsedLibraryFolderIds = new Set();
// Quel morceau est affiché dans le panneau de détail à droite de la bibliothèque -- par défaut, le
// premier de la liste.
let manageLibrarySelectedId = null;
// Bibliothèque de Sfx, partagée comme la bibliothèque de morceaux — chaque entrée : { id, title,
// description, rrMode: 'random'|'sequential', duckMainTrack, alternatives: [{label, remoteFile, pendingFile}] }.
// Note de session : la migration automatique des anciens stingers (upload direct par morceau) vers cette
// bibliothèque est délibérément différée à la phase où le bouton du morceau change de mécanisme (Phase 3)
// plutôt que faite ici — migrer les données maintenant sans encore relire depuis la bibliothèque casserait
// la lecture publique des Sfx déjà publiés, le temps qu'entre les deux phases. Rien n'est perdu, juste reporté.
let sfxLibrary = [];
// Dossiers de la bibliothèque Sfx (20/08, même mécanisme générique que les dossiers d'AdReel) : { id, label }.
let sfxFolders = [];
const collapsedSfxFolderIds = new Set();
// Quel Sfx est affiché dans le panneau de détail à droite de la bibliothèque Sfx -- par défaut, le premier
// de la liste (pas de notion de "Sfx en cours d'édition" comparable au currentAdReelId des AdReels).
let manageSfxSelectedId = null;
// Disposition maître-détail à l'intérieur d'un Sfx sélectionné (20/08) : quelle entrée (identity/behavior/
// variations) est affichée, par Sfx (clé = sfx.id). Même principe que packSelectedEntry.
const sfxSelectedEntry = new Map();
// Réseaux sociaux du compositeur — portée globale comme le reste des bibliothèques, réutilisable depuis
// n'importe quel pack/collection. { id, platform, url }. Seules les plateformes de PUBLISHABLE_SOCIAL_PLATFORMS
// proposent un vrai bouton "Publier" pré-rempli (URL de partage publique existante côté plateforme) — les
// autres (Instagram, TikTok, YouTube, SoundCloud) n'offrent aucun mécanisme de ce genre, gardées en simple
// aide-mémoire de lien.
let socials = [];
const SOCIAL_PLATFORMS = ['twitter', 'facebook', 'linkedin', 'whatsapp', 'telegram', 'instagram', 'tiktok', 'youtube', 'soundcloud', 'bandcamp', 'spotify', 'twitch', 'website'];
const PUBLISHABLE_SOCIAL_PLATFORMS = ['twitter', 'facebook', 'linkedin', 'whatsapp', 'telegram'];
