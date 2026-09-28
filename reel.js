// FICHIER GÉNÉRÉ par scripts/build-sources.js à partir de src/reel/ — ne pas le modifier ici : modifier src/reel/, puis `npm run build` (voir src/reel/LISEZMOI.md).
// reel.js — moteur d'affichage des AdReels (espace Projet, étape 5, 28/09) : sorti de index.html tel quel, sans aucun
// changement visible (test_reel_snapshots.js), pour être partagé avec les vitrines de Projet (vitrine.html).
function genId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------------- Migration (anciens formats de data.json) ---------------- */
function migrateBlocks(data) {
  let blocks = data.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0 || typeof blocks[0] !== 'object') {
    const legacy = Array.isArray(blocks) ? blocks : ['header', 'testimonials', 'videos', 'gallery', 'bio', 'tracks'];
    const out = [];
    legacy.forEach(type => {
      const t = type === 'photo' ? 'gallery' : type;
      if (t === 'gallery') out.push({ id: genId(), type: 'photo', align: 'left', images: (data.gallery || []).map(g => ({ file: g.file })) });
      else if (t === 'videos') out.push({ id: genId(), type: 'video', videos: (data.videos || []).map(v => ({ title: v.title, url: v.url })) });
      else if (['header', 'bio', 'testimonials', 'tracks'].includes(t)) out.push({ id: genId(), type: t });
    });
    blocks = out;
  }
  blocks.forEach(b => {
    if (b.type === 'photo' && !b.images) b.images = b.file ? [{ file: b.file }] : [];
    if (b.type === 'video' && !b.videos) b.videos = (b.title || b.url) ? [{ title: b.title || '', url: b.url || '' }] : [];
  });
  ['header', 'testimonials', 'tracks'].forEach(t => {
    if (!blocks.some(b => b.type === t)) blocks.push({ id: genId(), type: t });
  });
  return blocks;
}

/* ---------------- Blocs ---------------- */
function renderHeaderBlock(container, profile) {
  const el = document.createElement('div');
  el.className = 'header';
  // Rétrocompatibilité : un AdReel publié avant ce changement n'a qu'un tagline (jamais de subtitle),
  // repris ici comme repli. Le titre n'a pas d'équivalent antérieur — repli sur "LayerPitch" seulement
  // si vraiment rien n'a jamais été configuré, comme au tout premier chargement d'un AdReel neuf.
  const subtitle = (profile.subtitle != null && profile.subtitle !== '') ? profile.subtitle : (profile.tagline || '');
  const title = profile.title || (profile.logo ? '' : 'LayerPitch');
  el.innerHTML = `
    ${profile.logo ? `<img class="logo-img" src="${resolveImageUrl(profile.logo)}" alt="${tr('logoAlt')}">` : ''}
    ${title ? `<div class="header-title">${escapeHtml(title)}</div>` : ''}
    ${subtitle ? `<div class="header-subtitle">${escapeHtml(subtitle)}</div>` : ''}
  `;
  container.appendChild(el);
}
function renderBioBlock(container, profile) {
  if (!profile.bio && !profile.photo) return;
  const textHtml = (profile.bio || '').split('\n\n').map(p => `<p>${linkify(p)}</p>`).join('');
  const photoHtml = profile.photo
    ? `<div class="bio-photo"><img src="${resolveImageUrl(profile.photo)}" alt="${tr('photoAlt')}" loading="lazy"></div>`
    : `<div class="bio-photo empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>`;
  const el = section(tr('aboutSection'), `<div class="bio">${photoHtml}<div class="bio-text">${textHtml}</div></div>`);
  container.appendChild(el);
  if (profile.photo) {
    const bioImg = el.querySelector('.bio-photo img');
    const url = resolveImageUrl(profile.photo);
    bioImg.addEventListener('click', () => openLightbox([url], 0));
  }
}
function renderTestimonialsBlock(container, list) {
  if (!list || list.length === 0) return;
  const inner = list.map(t => {
    const avatarHtml = t.avatar ? `<img class="testimonial-avatar" src="${resolveImageUrl(t.avatar)}" alt="" loading="lazy">` : '';
    const roleHtml = t.role ? `<span class="testimonial-role">${escapeHtml(t.role)}</span>` : '';
    return `<div class="testimonial">${avatarHtml}<div class="testimonial-body"><p>« ${linkify(t.text)} »</p><cite>${escapeHtml(t.author)}</cite>${roleHtml}</div></div>`;
  }).join('');
  container.appendChild(section(tr('testimonialsSection'), inner));
}
function renderTextBlockItem(container, block) {
  if (!block.content && !block.title) return;
  const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'left';
  const html = (block.content || '').split('\n\n').map(p => `<p>${linkify(p)}</p>`).join('');
  const el = document.createElement('div');
  el.className = 'block text-block';
  el.style.textAlign = align;
  el.innerHTML = `${block.title ? `<div class="text-block-title">${escapeHtml(block.title)}</div>` : ''}${html}`;
  container.appendChild(el);
}
function renderPhotoBlockItem(container, block) {
  if (!block.images || block.images.length === 0) return;
  const align = block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start';
  const el = document.createElement('div');
  el.className = 'block';
  const urls = block.images.map(g => resolveImageUrl(g.file));
  const captionHtml = block.caption ? `<div class="photo-block-caption">${escapeHtml(block.caption)}</div>` : '';
  if (block.images.length === 1) {
    el.innerHTML = `<div class="photo-block-single" style="justify-content:${align}"><img src="${urls[0]}" alt="" loading="lazy"></div>${captionHtml}`;
  } else {
    const imgs = urls.map(u => `<img src="${u}" alt="" loading="lazy">`).join('');
    el.innerHTML = `<div class="photo-grid">${imgs}</div>${captionHtml}`;
  }
  container.appendChild(el);
  el.querySelectorAll('img').forEach((img, i) => {
    img.addEventListener('click', () => openLightbox(urls, i));
  });
}
function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    }
  } catch (e) { /* URL invalide, on ignore */ }
  return null;
}

function renderPacksBlockItem(container, block, packsById) {
  const selected = (block.packIds || []).map(id => packsById[id]).filter(Boolean);
  if (!selected.length) return;
  const titleHtml = `${tr('packsSection')} <span class="info-badge" title="${tr('packsSectionHelp')}">${window.LayerPlayerCore.infoBadgeSvg()}</span>`;
  const presentationHtml = block.presentation ? `<div class="block-presentation">${linkify(block.presentation)}</div>` : '';
  const el = section(titleHtml, presentationHtml);
  const list = document.createElement('div');
  list.className = 'packs-list';
  selected.forEach(p => {
    const a = document.createElement('a');
    a.className = 'packs-list-item';
    a.href = `./pack.html?id=${encodeURIComponent(p.id)}&lang=${pageLang}${window.LayerPlayerCore.adReelFromParam()}`;
    a.innerHTML = `${p.illustration ? `<img class="packs-list-item-thumb" src="${IMAGES_BASE}${p.illustration}" alt="" loading="lazy">` : `<div class="packs-list-item-thumb empty"></div>`}<span class="packs-list-item-title">${escapeHtml(p.title)}</span><span class="packs-list-item-arrow">→</span>`;
    list.appendChild(a);
  });
  el.appendChild(list);
  container.appendChild(el);
}

function renderCollectionsBlockItem(container, block, collectionsById) {
  const selected = (block.collectionIds || []).map(id => collectionsById[id]).filter(Boolean);
  if (!selected.length) return;
  const presentationHtml = block.presentation ? `<div class="block-presentation">${linkify(block.presentation)}</div>` : '';
  const el = section(tr('collectionsSection'), presentationHtml);
  const list = document.createElement('div');
  list.className = 'packs-list';
  selected.forEach(c => {
    const a = document.createElement('a');
    a.className = 'packs-list-item';
    // adReelFromParam() (déjà utilisée pour les packs juste au-dessus) : trouvée manquante ici le
    // 4 septembre en étendant le correctif "← Retour" aux collections -- sans elle, collection.html
    // ne savait jamais depuis quel AdReel elle avait été ouverte.
    a.href = `./collection.html?id=${encodeURIComponent(c.id)}&lang=${pageLang}${window.LayerPlayerCore.adReelFromParam()}`;
    a.innerHTML = `${c.illustration ? `<img class="packs-list-item-thumb" src="${IMAGES_BASE}${c.illustration}" alt="" loading="lazy">` : `<div class="packs-list-item-thumb empty"></div>`}<span class="packs-list-item-title">${escapeHtml(c.title)}</span><span class="packs-list-item-arrow">→</span>`;
    list.appendChild(a);
  });
  el.appendChild(list);
  container.appendChild(el);
}

// Bloc « Réseaux sociaux » (28/09) : les liens viennent de la rubrique Réseaux sociaux du Backstage (data.socials,
// une seule saisie pour tous les AdReels) ; le bloc ne garde que les identifiants cochés, dans l'ordre de la rubrique.
// Un lien vide ou inutilisable n'est pas affiché ; aucun lien affichable = pas de bloc.
function renderSocialsBlockItem(container, block, socials) {
  const Icons = window.LayerPitchSocialIcons;
  if (!Icons) return;
  const chosen = new Set(block.socialIds || []);
  const links = (socials || []).filter(s => chosen.has(s.id)).map(s => ({ s, href: Icons.safeUrl(s.url) })).filter(x => x.href);
  if (!links.length) return;
  const el = section(tr('socialsSection'), '');
  const row = document.createElement('div');
  row.className = 'social-links';
  row.innerHTML = links.map(({ s, href }) => {
    const key = Icons.detect(href, s.platform);
    const label = Icons.label(key) || new URL(href).hostname.replace(/^www\./, '');
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${Icons.svg(key, 20)}</a>`;
  }).join('');
  row.querySelectorAll('a').forEach(a => a.addEventListener('click', () => trackPublicEvent('social_click', { platform: a.getAttribute('aria-label') })));
  el.appendChild(row);
  container.appendChild(el);
}

function renderSfxBlockItem(container, block, sfxById) {
  const selected = (block.sfxIds || []).map(id => sfxById[id]).filter(Boolean);
  if (!selected.length) return;
  const el = section(tr('sfxSection'), '');
  selected.forEach(s => { el.appendChild(window.LayerPlayerCore.buildSfxPlayer(s)); });
  container.appendChild(el);
}

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
const LAYERPITCH_FUNCTIONS_URL = 'https://ypygllyjfynrnvapufow.supabase.co/functions/v1';
const LAYERPITCH_ANON_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';

function renderContactBlockItem(container, profile) {
  const hasContactEmail = profile && profile.contactEmail && profile.contactEmail.trim();
  if (!hasContactEmail) return; // pas configuré côté backstage : ce bloc ne s'affiche simplement pas
  const el = section(tr('contactSection'), '');
  el.innerHTML += `
    <form data-role="contactForm" class="contact-form">
      <label>${tr('formName')}</label>
      <input type="text" name="name" required>
      <label>${tr('formEmail')}</label>
      <input type="email" name="email" required>
      <label>${tr('formMessage')}</label>
      <textarea name="message" required rows="5"></textarea>
      <button type="submit" data-role="contactSubmit">${tr('send')}</button>
      <div class="contact-form-status" data-role="contactStatus"></div>
    </form>
  `;
  container.appendChild(el);
  const form = el.querySelector('[data-role="contactForm"]');
  const submitBtn = el.querySelector('[data-role="contactSubmit"]');
  const statusEl = el.querySelector('[data-role="contactStatus"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    statusEl.textContent = tr('sending');
    statusEl.className = 'contact-form-status';
    try {
      const adReelId = (window.__lpTrackContext && window.__lpTrackContext.id) || 'main';
      const formData = new FormData(form);
      const res = await fetch(`${LAYERPITCH_FUNCTIONS_URL}/submit-contact-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: LAYERPITCH_ANON_KEY, Authorization: `Bearer ${LAYERPITCH_ANON_KEY}` },
        body: JSON.stringify({
          adReelId,
          name: formData.get('name'),
          email: formData.get('email'),
          message: formData.get('message'),
        }),
      });
      if (res.ok) {
        trackPublicEvent('contact_submit', {});
        form.innerHTML = `<div class="contact-form-status success">${tr('sent')}</div>`;
      } else {
        const data = await res.json().catch(() => ({}));
        statusEl.textContent = data.error || tr('genericError');
        statusEl.className = 'contact-form-status error';
        submitBtn.disabled = false;
      }
    } catch (err) {
      statusEl.textContent = tr('networkError');
      statusEl.className = 'contact-form-status error';
      submitBtn.disabled = false;
    }
  });
}

function renderVideoBlockItem(container, block) {
  if (!block.videos || block.videos.length === 0) return;
  const makeCard = (v) => {
    // Vidéo de la bibliothèque du compositeur (composer_videos, voir layerpitch-backstage.html) :
    // v.url pointe déjà vers un .mp4 hébergé sur R2 (résolu à la sélection côté Backstage, jamais une
    // page YouTube/Vimeo) -- lu directement avec <video>, pas d'iframe externe à charger.
    if (v.source === 'library' && v.url) {
      const wrap = document.createElement('div');
      wrap.className = 'video-card video-card-native';
      const video = document.createElement('video');
      video.className = 'video-embed-native';
      video.src = v.url;
      video.controls = true;
      video.preload = 'metadata';
      if (v.thumbnail) video.poster = resolveImageUrl(v.thumbnail);
      wrap.appendChild(video);
      return wrap;
    }

    const ytId = extractYouTubeId(v.url);
    const thumbUrl = v.thumbnail ? resolveImageUrl(v.thumbnail) : (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);
    const bg = thumbUrl ? `background-image:url('${thumbUrl}'); background-size:cover; background-position:center;` : '';

    if (ytId) {
      // Vignette cliquable : la vidéo YouTube ne se charge (iframe) qu'au clic — plus rapide et plus respectueux
      // de la vie privée du visiteur que d'intégrer YouTube dès l'affichage de la page.
      const card = document.createElement('div');
      card.className = 'video-card';
      card.style.cssText = bg;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.innerHTML = `<div class="vt">${escapeHtml(v.title || '')}</div><div class="play-dot"></div>`;
      const activate = () => {
        const iframe = document.createElement('iframe');
        iframe.className = 'video-embed-frame';
        iframe.src = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0`;
        iframe.title = v.title || tr('videoFallbackTitle');
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        card.replaceWith(iframe);
      };
      card.addEventListener('click', activate, { once: true });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }, { once: true });
      return card;
    }

    // Repli : URL non reconnue comme YouTube (Vimeo, autre) -> comportement existant, lien externe.
    const hasUrl = !!v.url;
    const el = document.createElement(hasUrl ? 'a' : 'div');
    el.className = 'video-card' + (hasUrl ? '' : ' disabled');
    el.style.cssText = bg;
    if (hasUrl) { el.href = v.url; el.target = '_blank'; el.rel = 'noopener'; }
    el.innerHTML = `<div class="vt">${escapeHtml(v.title || '')}</div>${hasUrl ? '<div class="play-dot"></div>' : ''}`;
    return el;
  };
  const makeItem = (v) => {
    const wrap = document.createElement('div');
    wrap.className = 'video-item';
    wrap.appendChild(makeCard(v));
    if (v.comment && v.comment.trim()) {
      const p = document.createElement('div');
      p.className = 'video-comment';
      p.textContent = v.comment;
      wrap.appendChild(p);
    }
    return wrap;
  };
  const el = document.createElement('div');
  el.className = 'block';
  if (block.videos.length === 1) {
    el.appendChild(makeItem(block.videos[0]));
  } else {
    const grid = document.createElement('div');
    grid.className = 'video-grid-multi';
    block.videos.forEach(v => grid.appendChild(makeItem(v)));
    el.appendChild(grid);
  }
  container.appendChild(el);
}
// Applique les surcharges de texte propres à cet AdReel (titre/description/labels de couche/labels de
// stinger) par-dessus le morceau tel qu'il vit dans la Bibliothèque — sans jamais modifier ce dernier.
// Absent = le texte de la Bibliothèque reste affiché tel quel.
function applyTrackOverride(track, ov) {
  if (!ov) return track;
  const merged = { ...track };
  if (ov.title !== undefined) merged.title = ov.title;
  if (ov.description !== undefined) merged.description = ov.description;
  if (ov.layers && Object.keys(ov.layers).length) {
    const key = track.mode === 'vertical-random' ? 'fixedLayers' : 'layers';
    merged[key] = (track[key] || []).map((l, i) => (ov.layers[i] !== undefined ? { ...l, label: ov.layers[i] } : l));
  }
  // Contrairement aux couches (propres au morceau), un Sfx est une entrée de bibliothèque partagée —
  // on ne peut pas réécrire son titre directement sans affecter tous les autres morceaux qui le
  // référencent aussi. La surcharge est donc portée à part (sfxLabelOverrides), lue par le rendu du
  // bouton Sfx du morceau (buildTrackRow / initTrackPlayer, player.js) plutôt que d'être fusionnée dans
  // une copie de l'entrée Sfx elle-même.
  if (ov.sfx && Object.keys(ov.sfx).length) merged.sfxLabelOverrides = ov.sfx;
  return merged;
}
// ---- Moteur : thème de la page et suite de blocs (espace Projet, étape 5, 28/09) ----
// Sorti tel quel de init() dans index.html : l'AdReel et les vitrines de Projet appellent ces trois fonctions.

// Thème effectif selon le palier : Free = preset choisi seulement ; sinon profile.theme (ou les anciens champs
// bgColor/textColor d'un AdReel publié avant profile.theme). separator : imposé par le preset sur Free, réglable sinon.
function reelResolveTheme(profile, tier) {
  const theme = tier === 'free'
    ? resolveThemePreset(profile.theme && profile.theme.presetId)
    : (profile.theme
      ? Object.assign({ bgColor: '#f5f6f8', titleColor: '#24262b', contentColor: '#24262b', font: 'default', bgImage: null, bgImageOpacity: 1 }, profile.theme)
      : { bgColor: profile.bgColor || '#f5f6f8', titleColor: profile.textColor || '#24262b', contentColor: profile.textColor || '#24262b', font: 'default', bgImage: null, bgImageOpacity: 1 });
  const separator = tier === 'free' ? theme.separator : Object.assign({}, DEFAULT_SEPARATOR, profile.theme && profile.theme.separator || {});
  return { theme, separator };
}

// Applique le thème à la page : variables CSS, séparateurs du conteneur de blocs, polices réellement utilisées
// (thème + réglages par bloc, jamais toute la bibliothèque), image de fond. opts : { tier, blocks, customFonts }.
function reelApplyTheme(theme, separator, container, opts) {
  const tier = opts.tier;
  document.documentElement.style.setProperty('--bg', theme.bgColor);
  document.documentElement.style.setProperty('--text', theme.contentColor);
  document.documentElement.style.setProperty('--text-title', theme.titleColor);
  // Couleur des petits titres de bloc (MUSIQUE, À PROPOS, TÉMOIGNAGES...) -- réglage ajouté le 7
  // septembre, absent -> repli sur --accent (comportement inchangé pour tout AdReel publié avant ce
  // changement, jamais republié depuis).
  if (theme.sectionLabelColor) document.documentElement.style.setProperty('--section-label-color', theme.sectionLabelColor);
  // Séparateurs entre blocs : imposés par le preset sur Free, réglables indépendamment du reste du
  // thème sur Starter et au-dessus (profile.theme.separator, absent -> désactivé par défaut).
  document.documentElement.style.setProperty('--separator-color', separator.color);
  document.documentElement.style.setProperty('--separator-width', separator.thickness + 'px');
  container.classList.toggle('show-separators', !!separator.visible);
  // Polices : n'injecte (lien Google Fonts / @font-face) que ce qui est réellement utilisé par ce
  // thème général et les éventuels réglages par bloc de CET AdReel — jamais toute la bibliothèque de
  // polices personnalisées du compositeur, pour ne pas charger des fichiers inutiles à ce visiteur.
  // Palier Free : les réglages par bloc (block.appearance) ne sont jamais pris en compte, ils
  // n'existent tout simplement plus pour ce palier -- seule la police du preset compte.
  const usedFontValues = new Set([theme.font].filter(Boolean));
  if (tier !== 'free') {
    (opts.blocks || []).forEach(b => { if (b.appearance && b.appearance.font) usedFontValues.add(b.appearance.font); });
  }
  injectFontAssets(usedFontValues, opts.customFonts);
  document.documentElement.style.setProperty('--font-body', fontCssFamily(theme.font, opts.customFonts) || "'Inter', sans-serif");
  // Image de fond générale : calque plein écran fixe, sous le contenu — reste indépendante de l'opacité
  // du texte, qui n'est jamais affectée par ce réglage. N'existe pas côté preset Free.
  if (theme.bgImage) {
    const bgLayer = document.createElement('div');
    bgLayer.style.cssText = `position:fixed;inset:0;z-index:-1;background-image:url('${resolveImageUrl(theme.bgImage)}');background-size:cover;background-position:center;opacity:${theme.bgImageOpacity != null ? theme.bgImageOpacity : 1};`;
    document.body.appendChild(bgLayer);
  }
}

// Dessine les blocs dans le conteneur, puis applique les réglages d'apparence par bloc (Starter et Pro) et par élément
// (Pro). ctx : { profile, tier, customFonts, testimonials, trackIds, trackOverrides, libraryById, packsByTrackId,
// packsById, collectionsById, sfxById, socials, noAiCertifiedGlobal }.
function reelRenderBlocks(container, blocks, ctx) {
  const { profile, tier } = ctx;
  blocks.forEach(block => {
    const beforeCount = container.children.length;
    switch (block.type) {
      case 'header': renderHeaderBlock(container, profile); break;
      case 'bio': renderBioBlock(container, profile); break;
      case 'testimonials': renderTestimonialsBlock(container, ctx.testimonials); break;
      case 'text': renderTextBlockItem(container, block); break;
      case 'photo': renderPhotoBlockItem(container, block); break;
      case 'video': renderVideoBlockItem(container, block); break;
      case 'packs': renderPacksBlockItem(container, block, ctx.packsById); break;
      case 'collections': renderCollectionsBlockItem(container, block, ctx.collectionsById); break;
      case 'sfx': renderSfxBlockItem(container, block, ctx.sfxById); break;
      case 'socials': renderSocialsBlockItem(container, block, ctx.socials); break;
      case 'contact': renderContactBlockItem(container, profile); break;
      case 'tracks': {
        const orderedTracks = (ctx.trackIds || []).map(id => ctx.libraryById[id]).filter(Boolean)
          .map(t => applyTrackOverride(t, (ctx.trackOverrides || {})[t.id]));
        // Éléments à deux états (forme d'onde/barre de progression) : consommés par le moteur JS de
        // player.js à la construction de chaque piste, pas par une simple règle CSS -- doivent donc être
        // résolus AVANT le rendu, pas retouchés après coup comme les éléments texte/simple ci-dessous.
        const trackElementColors = (tier === 'pro' && block.elementAppearance)
          ? { waveform: block.elementAppearance.waveform, progressBar: block.elementAppearance.progressBar }
          : null;
        window.LayerPlayerCore.renderTracksBlock(container, orderedTracks, ctx.packsByTrackId, ctx.noAiCertifiedGlobal, trackElementColors);
        break;
      }
    }
    // Un bloc peut ne rien avoir ajouté au DOM (contenu vide — cf. les nombreux early-return des
    // fonctions render*BlockItem) : dans ce cas, container.children n'a pas grandi, rien à styliser.
    // Palier Free : block.appearance n'est jamais appliqué (voir résolution du thème plus haut).
    if (tier !== 'free' && container.children.length > beforeCount) {
      const lastChild = container.children[container.children.length - 1];
      applyBlockAppearance(lastChild, block, ctx.customFonts);
      // Réglage par élément (Chantier Apparence, palier Pro, 05/09) : strictement Pro, imbriqué dans une
      // section déjà visible en Starter -- gating fait DANS applyElementAppearance (tier !== 'pro' ->
      // no-op), jamais recalculé ici, pour qu'un seul endroit décide (repli non destructif si le
      // compositeur repasse Starter/Free : les données restent en base, juste plus appliquées).
      applyElementAppearance(lastChild, block, tier, ctx.customFonts);
    }
  });
}
