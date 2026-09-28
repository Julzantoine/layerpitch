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
      case 'links': renderLinksBlockItem(container, block); break;
      case 'audio': renderAudioBlockItem(container, block); break;
      case 'tracks': {
        // Un AdReel n'a qu'une liste de morceaux (ctx.trackIds) ; un bloc de vitrine porte la sienne (block.trackIds).
        const orderedTracks = (block.trackIds || ctx.trackIds || []).map(id => ctx.libraryById[id]).filter(Boolean)
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
