async function init() {
  const container = document.getElementById('content');
  const id = new URLSearchParams(location.search).get('id');
  // sessionId : voir le commentaire équivalent dans index.html.
  window.__lpTrackContext = {
    type: 'pack', id: id,
    sessionId: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
  };
  try {
    const data = await loadSiteData();
    if (previewActive) showPreviewModeBanner();
    window.__lpTrackContext.ownerId = lastResolvedOwnerId;
    // Référence pour le mode Capture (résolution trackId/sfxId -> fichier réel, voir exportCaptureVideo).
    // composerName : même source que le lien "← Retour" plus bas (data.adReels 'main'.profile.title) --
    // seul nom de compositeur déjà disponible côté client, réutilisé pour le crédit compositeur sur
    // l'export (2026-09-16, voir decisions/2026-09-16-capture-watermark-composer-credit.md, docs privés).
    const mainAdReelForCapture = (data.adReels || []).find(a => a.id === 'main');
    window.__lpCaptureLibrary = {
      library: data.library || [], sfxLibrary: data.sfxLibrary || [], sfxFolders: data.sfxFolders || [],
      composerName: (mainAdReelForCapture && mainAdReelForCapture.profile && mainAdReelForCapture.profile.title) || '',
    };
    const pack = (data.packs || []).find(p => p.id === id);
    if (!pack) {
      container.innerHTML = `<div class="empty">${tr('packNotFound')}</div>`;
      return;
    }
    // Ouverture (23 septembre) : sans cet événement, une visite sans aucune interaction n'existait pas
    // dans le tableau de bord compositeur (seules les interactions créaient une session). Pas
    // d'enregistrement en mode aperçu du backstage. Détail : analytics_events, get_my_analytics_overview.
    try {
      const lpCtx = window.__lpTrackContext || {};
      if (!previewActive && window.LayerPitchAnalytics && lpCtx.sessionId) {
        window.LayerPitchAnalytics.logAnalyticsEvent(lpCtx.type, lpCtx.id, lpCtx.sessionId, 'page_open', {}, lpDeviceType(), lpCtx.ownerId || null);
      }
    } catch (e) { /* jamais bloquant */ }
    // profile.effectivePlan / ici pack.effectivePlan est figé une fois pour toutes à la publication
    // (Chantier Apparence Phase 3) -- absent = pack publié avant cette Phase 3 -> traité comme Starter.
    const tier = pack.effectivePlan || 'starter';
    // Style de forme d'onde (Chantier Apparence, palier Pro, 05/09) : réglage global du compositeur
    // (data.waveformStyle), pas un champ de pack -- gating identique au reste de l'apparence Pro (voir
    // player.js et index.html, même logique).
    window.LayerPlayerCore.setWaveformStyle(tier === 'pro' ? (data.waveformStyle || 'bars') : 'bars');
    // Thème de la carte des chemins (Chantier Apparence, palier Pro, 06/09) : réglage global du
    // compositeur (data.seqMapTheme), même gating que le reste de l'apparence Pro ci-dessus.
    window.LayerPlayerCore.setSeqMapTheme(tier === 'pro' ? (data.seqMapTheme || 'light') : 'light');
    // Densité 'roomy' (10/09) : pas un réglage de palier, contrairement au thème ci-dessus -- posé
    // inconditionnellement sur cette page publique (voir le commentaire de SEQ_MAP_DENSITIES dans
    // player.js). Le Backstage l'appelle aussi depuis le 24/09 (aperçu identique au rendu public).
    window.LayerPlayerCore.setSeqMapDensity('roomy');
    const theme = tier === 'free'
      ? resolveThemePreset(pack.presetId)
      : { bgColor: pack.bgColor, titleColor: pack.textColor, contentColor: pack.textColor, font: pack.font };
    if (theme.bgColor) document.documentElement.style.setProperty('--bg', theme.bgColor);
    if (theme.contentColor) document.documentElement.style.setProperty('--text', theme.contentColor);
    if (theme.font) {
      injectFontAssets([theme.font], data.customFonts || []);
      document.documentElement.style.setProperty('--font-body', fontCssFamily(theme.font, data.customFonts || []) || "'Inter', sans-serif");
    }
    const separator = tier === 'free' ? theme.separator : Object.assign({}, DEFAULT_SEPARATOR, pack.separator || {});
    document.documentElement.style.setProperty('--separator-color', separator.color);
    document.documentElement.style.setProperty('--separator-width', separator.thickness + 'px');
    container.classList.toggle('show-separators', !!separator.visible);
    setupContrastToggle('contrastToggle', theme.bgColor, theme.contentColor);
    setupNightModeToggle('nightModeToggle', theme.bgColor, theme.contentColor);
    if (pack.watermark) {
      const watermarkEl = document.createElement('div');
      watermarkEl.className = 'pack-watermark';
      watermarkEl.style.backgroundImage = `url('${IMAGES_BASE}${pack.watermark}')`;
      document.body.prepend(watermarkEl);
    }
    container.innerHTML = `
      <div class="pub-section">
        ${pack.illustration ? `<img class="pack-illustration" src="${IMAGES_BASE}${pack.illustration}" alt="">` : `<div class="pack-illustration empty"></div>`}
        <div class="pack-title">${escapeHtml(pack.title)}</div>
        <div class="pack-presentation">${pickBilingualText(pack.presentationFr, pack.presentationEn).split('\n\n').map(p => `<p>${linkify(p)}</p>`).join('')}</div>
      </div>
    `;
    const musicContainer = document.createElement('div');
    musicContainer.className = 'pub-section';
    if (pack.videoTestModeEnabled) {
      const triggerBtn = document.createElement('button');
      triggerBtn.type = 'button';
      triggerBtn.className = 'video-test-trigger-btn';
      triggerBtn.textContent = tr('videoTestTriggerBtn');
      triggerBtn.title = tr('videoTestTriggerBtnHelp');
      triggerBtn.addEventListener('click', () => document.getElementById('videoTestDialog').showModal());
      container.appendChild(triggerBtn);
      setupCaptureTrigger(pack, container); // async, ne bloque pas le rendu -- s'insère seule si admin
    }
    container.appendChild(musicContainer);
    const libraryById = {};
    (data.library || []).forEach(t => { t.publishedAt = data.publishedAt; libraryById[t.id] = t; });
    const sfxById = {};
    (data.sfxLibrary || []).forEach(s => { s.publishedAt = data.publishedAt; sfxById[s.id] = s; });
    window.LayerPlayerCore.setSfxLibrary(sfxById);
    const packTracks = (pack.trackIds || []).map(id => libraryById[id]).filter(Boolean);
    renderTracksBlock(musicContainer, packTracks, null, data.noAiCertifiedGlobal);

    const packSfx = (pack.sfxIds || []).map(id => sfxById[id]).filter(Boolean);
    if (packSfx.length) {
      const sfxSectionEl = section(tr('sfxSection'), '');
      sfxSectionEl.classList.add('pub-section');
      packSfx.forEach(s => { sfxSectionEl.appendChild(window.LayerPlayerCore.buildSfxPlayer(s)); });
      container.appendChild(sfxSectionEl);
    }

    const skills = data.implementationSkills || {};
    const skillLabels = { wwise: 'Wwise', fmod: 'FMOD', unity: 'Unity', unreal: 'Unreal' };
    const checkedTools = Object.keys(skillLabels).filter(k => skills[k]).map(k => skillLabels[k]);
    if (checkedTools.length) {
      const implEl = document.createElement('div');
      implEl.className = 'implementation-help pub-section';
      implEl.textContent = tr('implementationHelpMessage').replace('{tools}', checkedTools.join(', '));
      container.appendChild(implEl);
    }

    const buySection = document.createElement('div');
    buySection.className = 'buy-section';
    // Téléchargement gratuit : réel dès aujourd'hui (zip généré côté navigateur, JSZip chargé à la
    // demande seulement — jamais au chargement de la page). Vente : voir PURCHASES_ENABLED plus haut —
    // grisée par défaut pendant la bêta (comportement historique inchangé), vrai flux Stripe/Postgres
    // activable en un seul flag une fois prêt (Décision 5, étape 4, construit et vérifié le 31 août).
    let buyHtml = '';
    if (pack.freeDownloadEnabled) {
      buyHtml += `<button class="buy-btn" id="freeDownloadBtn" type="button">${tr('freeDownloadBtn')}</button>`;
    }
    if (!PURCHASES_ENABLED) {
      buyHtml += `<div style="margin-top:${pack.freeDownloadEnabled ? '14px' : '0'}"><span class="buy-btn disabled">${tr('comingSoon')}</span><div class="buy-hint">${tr('notForSaleYet')}</div></div>`;
    }
    buySection.innerHTML = buyHtml;
    container.appendChild(buySection);
    if (pack.freeDownloadEnabled) {
      document.getElementById('freeDownloadBtn').addEventListener('click', async () => {
        const btn = document.getElementById('freeDownloadBtn');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = tr('downloadPreparing');
        try {
          await window.LayerPlayerCore.downloadTracksAsZip(pack.title, packTracks);
        } catch (e) {
          console.error('LayerPitch — échec du téléchargement du pack :', e);
          window.LayerPitchNotify.error(tr('downloadError'));
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    }
    if (PURCHASES_ENABLED) {
      const purchaseWrap = document.createElement('div');
      purchaseWrap.style.marginTop = pack.freeDownloadEnabled ? '14px' : '0';
      buySection.appendChild(purchaseWrap);
      renderRealPurchaseWidget(purchaseWrap, pack).catch(e => console.error('LayerPitch — widget achat :', e));
    }

    // handleParam ici aussi (avant sa déclaration principale plus bas) : sans lui, ce lien vers une
    // collection perdrait le handle du compositeur non-défaut, même bug que "← Retour" ci-dessous.
    const containingCollectionsHandleParam = composerHandleFromUrl ? `&u=${encodeURIComponent(composerHandleFromUrl)}` : '';
    const containingCollections = (data.collections || []).filter(c => (c.packIds || []).includes(pack.id));
    if (containingCollections.length) {
      const collEl = document.createElement('div');
      collEl.className = 'pack-link';
      collEl.innerHTML = containingCollections.map(c => `<a href="./collection.html?id=${encodeURIComponent(c.id)}&lang=${pageLang}${containingCollectionsHandleParam}">${tr('partOfCollectionMention').replace('{title}', escapeHtml(c.title))}</a>`).join('<br>');
      container.appendChild(collEl);
    }

    // Renvoi vers l'AdReel d'origine — priorité au paramètre `from` déposé dans l'URL par l'AdReel qui a
    // généré le lien vers ce pack (voir adReelFromParam, player.js) : un même pack peut être intégré dans
    // plusieurs AdReels (ex. un AdReel principal et un AdReel de démo envoyé à un prospect), et le retour
    // doit suivre celui par lequel CE visiteur est réellement arrivé, pas un choix figé. Si `from` est
    // absent (visite directe, lien du pack partagé isolément) ou pointe vers un AdReel depuis supprimé,
    // on retombe sur pack.linkedAdReelId choisi une fois pour toutes en backstage — même nettoyage
    // défensif que linkedAdReelId lui-même (un .find() qui échoue renvoie simplement undefined, geste
    // silencieux, cf. `if (linkedAdReel)` plus bas).
    const fromAdReelId = new URLSearchParams(location.search).get('from');
    // handle (compositeur non-défaut) : trouvé manquant le 4 septembre en corrigeant le bouton
    // "← Retour" -- sans lui, ce lien ET le "← Retour" ci-dessous seraient retombés sur
    // DEFAULT_OWNER_ID (le compte de Jules-Antoine) au clic, quel que soit le vrai compositeur
    // (même bug que adReelFromParam(), player.js, corrigé au même moment).
    const handleParam = composerHandleFromUrl ? `&u=${encodeURIComponent(composerHandleFromUrl)}` : '';
    const fromParam = fromAdReelId ? `&from=${encodeURIComponent(fromAdReelId)}` : '';
    const linkedAdReel = (fromAdReelId && (data.adReels || []).find(a => a.id === fromAdReelId))
      || (pack.linkedAdReelId ? (data.adReels || []).find(a => a.id === pack.linkedAdReelId) : null);
    // fromCollection (même chantier, extension aux collections) : priorité sur l'AdReel pour le
    // SEUL bouton "← Retour" -- un pack ouvert via une collection doit revenir à cette collection
    // (un pas en arrière), pas sauter directement à l'AdReel qui avait ouvert la collection. `from`/
    // `u` sont propagés vers collection.html pour qu'elle puisse continuer la chaîne jusqu'à
    // l'AdReel si SON "← Retour" est cliqué à son tour. Vérifié que la collection existe ET contient
    // bien ce pack (même nettoyage défensif que linkedAdReel) avant de faire confiance au paramètre.
    const fromCollectionId = new URLSearchParams(location.search).get('fromCollection');
    const linkedCollection = fromCollectionId
      ? (data.collections || []).find(c => c.id === fromCollectionId && (c.packIds || []).includes(pack.id))
      : null;
    // ← Retour (haut de page) : par défaut un lien générique vers index.html (repli faute de vraie
    // page d'accueil multi-compositeurs, docs/infrastructure.md), remplacé ci-dessous dès qu'une
    // collection ou un AdReel d'origine est résolu -- "Retour" doit suivre par où CE visiteur est
    // réellement arrivé, jamais un choix figé (même raisonnement que "Voir l'œuvre complète").
    const backLinkEl = document.querySelector('.back-link');
    if (linkedCollection) {
      if (backLinkEl) backLinkEl.href = `./collection.html?id=${encodeURIComponent(linkedCollection.id)}&lang=${pageLang}${fromParam}${handleParam}`;
    } else if (linkedAdReel) {
      if (backLinkEl) backLinkEl.href = (linkedAdReel.id === 'main' ? `./index.html?lang=${pageLang}` : `./index.html?adreel=${encodeURIComponent(linkedAdReel.id)}&lang=${pageLang}`) + handleParam;
    } else if (backLinkEl && composerHandleFromUrl) {
      // Aucune collection ni AdReel d'origine résolvable (visite directe, lien du pack partagé
      // isolément), mais le handle du compositeur est connu (URL du pack lui-même, ?u=<handle>) --
      // "Retour" n'a alors plus de sens (ce visiteur n'est jamais passé par le site du compositeur),
      // remplacé par un vrai lien vers son AdReel principal plutôt qu'un retour arrière trompeur ou
      // un repli navigateur qui pourrait renvoyer n'importe où. Retrouve le nom via l'AdReel 'main'
      // (même AdReel que celui utilisé par défaut quand index.html n'a pas de paramètre ?adreel=).
      const mainAdReel = (data.adReels || []).find(a => a.id === 'main');
      const composerName = (mainAdReel && mainAdReel.profile && mainAdReel.profile.title) || tr('linkedAdReelFallbackName');
      backLinkEl.href = `./index.html?lang=${pageLang}${handleParam}`;
      backLinkEl.textContent = tr('backToComposerLink').replace('{name}', composerName);
    } else if (backLinkEl && window.history.length > 1) {
      // Handle totalement inconnu (visite directe sans ?u=, cas hérité pré-multi-compositeur) --
      // rien de fiable vers quoi pointer, retour navigateur plutôt que de forcer index.html
      // (retomberait sur DEFAULT_OWNER_ID faute de vraie page d'accueil générique). Lien statique
      // laissé tel quel en tout dernier recours si aucun historique n'existe (onglet ouvert
      // directement sur ce pack).
      backLinkEl.addEventListener('click', (e) => { e.preventDefault(); window.history.back(); });
    }
    // Bouton "Intégrer" public (data.allowEmbedding, réglage global du compositeur) : jamais affiché
    // depuis une iframe déjà en mode embed (pas de poupées russes), génère le même lien que le backstage.
    if (!embedMode && data.allowEmbedding) {
      const publicEmbedUrl = `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}&lang=${pageLang}${handleParam}&embed=1`;
      showPublicEmbedButton(publicEmbedUrl);
    }
    // Bouton d'intégration (embedMode) : écrase tout ce qui précède, toujours vers l'AdReel principal
    // (jamais un AdReel/collection d'origine ponctuel -- il n'y en a pas ici, l'iframe est chargée
    // directement depuis le site tiers) et toujours dans un nouvel onglet.
    if (embedMode && backLinkEl) {
      const mainAdReel = (data.adReels || []).find(a => a.id === 'main');
      const composerName = (mainAdReel && mainAdReel.profile && mainAdReel.profile.title) || tr('linkedAdReelFallbackName');
      backLinkEl.href = `./index.html?lang=${pageLang}${handleParam}`;
      backLinkEl.target = '_blank';
      backLinkEl.rel = 'noopener';
      backLinkEl.textContent = tr('embedCtaLink').replace('{name}', composerName);
      backLinkEl.classList.add('embed-cta-btn');
    }
    if (linkedAdReel) {
      const composerName = (linkedAdReel.profile && linkedAdReel.profile.title) || tr('linkedAdReelFallbackName');
      const adReelHref = (linkedAdReel.id === 'main' ? `./index.html?lang=${pageLang}` : `./index.html?adreel=${encodeURIComponent(linkedAdReel.id)}&lang=${pageLang}`) + handleParam;
      const adReelLinkEl = document.createElement('div');
      adReelLinkEl.className = 'pack-link';
      adReelLinkEl.innerHTML = `<a href="${adReelHref}">${tr('viewFullWorkLink').replace('{name}', escapeHtml(composerName))}</a>`;
      container.appendChild(adReelLinkEl);
    }

    // Filigrane "propulsé par LayerPitch" (Chantier Apparence Phase 3) : affiché sur Free et Starter,
    // retiré sur Pro, cliquable vers la landing LayerPitch -- même logique que index.html.
    if (tier !== 'pro') {
      const credit = document.createElement('div');
      credit.className = 'layerpitch-credit';
      const creditLink = document.createElement('a');
      creditLink.href = 'https://layerpitch.com';
      creditLink.target = '_blank';
      creditLink.rel = 'noopener';
      creditLink.textContent = tr('creditLine').replace('{title}', pack.title);
      credit.appendChild(creditLink);
      container.appendChild(credit);
    }
  } catch (e) {
    container.innerHTML = `<div class="empty">${tr('loadError')}</div>`;
  }
}
