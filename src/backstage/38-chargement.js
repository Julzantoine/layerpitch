/* ---------------- Chargement (auto + manuel) ---------------- */
async function loadData(silent) {
  if (!silent) log(tr('loadingDataMsg'));
  try {
    const data = await fetchSiteData();
    loadedPublishedAt = data ? (data.publishedAt != null ? data.publishedAt : null) : null;
    if (!data) {
      log(tr('dataNotFoundMsg'));
      library = []; packs = []; collections = []; customFonts = []; sfxLibrary = []; socials = []; adReelFolders = [];
      implementationSkills = { wwise: false, fmod: false, unity: false, unreal: false };
      noAiCertifiedGlobal = false;
      waveformStyle = 'bars';
      seqMapTheme = 'light';
      allowEmbedding = false;
      sharePreview = Object.assign({}, DEFAULT_SHARE_PREVIEW); sharePreviewPendingFile = null;
      adReels = [{ id: 'main', label: tr('defaultAdreelLabel'), lang: currentLang(), blocks: freshBlocks(), profile: { title: '', subtitle: '', bio: '', contactEmail: '', contactUrl: '', logo: null, photo: null, theme: Object.assign({}, DEFAULT_THEME) }, testimonials: [], trackIds: [], trackOverrides: {}, allowIndexing: true, logoPendingFile: null, photoPendingFile: null, themeBgImagePendingFile: null, folderId: null }];
      currentAdReelId = 'main';
      const cur = adReels[0];
      blocks = cur.blocks; profile = cur.profile; testimonials = cur.testimonials; trackIds = cur.trackIds; trackOverrides = cur.trackOverrides;
      logoPendingFile = null; photoPendingFile = null;
      collapsedPackIds.clear(); collapsedBlockIds.clear(); collapsedCollectionIds.clear();
      cur.blocks.forEach(b => collapsedBlockIds.add(b.id));
      renderLibrary(); renderSfxLibrary(); renderSocials(); renderPacks(); renderCollections(); renderAdReelSelect(); renderManageAdreels(); fillAppearanceFields(); fillImplementationSkillsFields(); fillNoAiCertifiedGlobalField(); fillAllowEmbeddingField(); fillSharePreviewFields(); rebuildAllCards();
      pendingR2Deletes.clear(); pendingOrphanR2Keys.clear();
      rememberPublishedCatalog();
      dataLoadOk = true; // absence légitime de data.json (premier lancement) -- pas un échec, publier est sûr
      document.getElementById('btnPublish').disabled = false;
      return;
    }

    library = (data.library || []).map(t => {
      const legacyMode = t.mode || 'vertical';
      // "vertical-random-sequential" n'a jamais existé que localement (jamais publié) — repli de sécurité
      // au cas où un data.json de test l'aurait quand même, fusionné depuis le 30/07 dans "vertical-random".
      const mode = (legacyMode === 'vertical-random-sequential') ? 'vertical-random' : legacyMode;

      // Migration douce (30/07) : l'ancien vertical-random avait un tempo/timeline unique pour tout le
      // morceau, avec des couches fixes + groupes aléatoires au niveau du morceau. Le nouveau modèle donne
      // à chaque section son propre tempo/timeline (comme un vrai segment Wwise indépendant) — un morceau
      // déjà publié dans l'ancien format devient donc une unique section qui reprend tout à l'identique
      // (mêmes fichiers, même timeline, mêmes probabilités) : comportement de lecture strictement inchangé.
      let sections;
      if (t.sections && t.sections.length) {
        sections = t.sections.map(sec => ({
          id: sec.id || genId(), label: sec.label || '',
          referencesSectionId: sec.referencesSectionId || null,
          bpm: sec.bpm || 120, beatsPerBar: sec.beatsPerBar || 4,
          startTrackBeat: sec.startTrackBeat || 0,
          loopInBeat: sec.loopInBeat || 0,
          // Repli sur l'ancien champ plat "bars" (version locale jamais publiée du 30/07, avant l'ajout
          // d'une vraie timeline par section) si présent, sinon 4 mesures par défaut.
          loopOutBeat: sec.loopOutBeat || ((sec.bars || 4) * (sec.beatsPerBar || 4)),
          maxLoops: (sec.maxLoops !== undefined && sec.maxLoops !== null) ? sec.maxLoops : null,
          duration: sec.duration || 0,
          pools: (sec.pools || []).map(p => ({
            id: p.id || genId(), label: p.label || '', avoidImmediateRepeat: p.avoidImmediateRepeat !== false,
            referencesPoolId: p.referencesPoolId || null,
            alternatives: (p.alternatives || []).map(a => ({ label: a.label || '', remoteFile: a.file || null, originalFileName: a.originalFileName || null, pendingFile: null, gain: a.gain || 1 })),
            fx: p.fx || null
          }))
        }));
      } else if (mode === 'vertical-random' && (t.fixedLayers || t.fixedLayer || (t.randomGroups && t.randomGroups.length))) {
        const migratedPools = [];
        (t.fixedLayers ? t.fixedLayers : (t.fixedLayer ? [t.fixedLayer] : [])).forEach(f => {
          migratedPools.push({ id: genId(), label: f.label || '', avoidImmediateRepeat: true, referencesPoolId: null,
            alternatives: [{ label: f.label || '', remoteFile: f.file || null, pendingFile: null, gain: f.gain || 1 }] });
        });
        (t.randomGroups || []).forEach(g => {
          migratedPools.push({
            id: g.id || genId(), label: g.label || '', avoidImmediateRepeat: g.avoidImmediateRepeat !== false,
            referencesPoolId: g.referencesGroupId || null,
            alternatives: (g.alternatives || []).map(a => ({ label: a.label || '', remoteFile: a.file || null, pendingFile: null, gain: a.gain || 1 }))
          });
        });
        sections = migratedPools.length ? [{
          id: genId(), label: '', referencesSectionId: null,
          bpm: t.bpm || 120, beatsPerBar: t.beatsPerBar || 4,
          startTrackBeat: t.startTrackBeat || 0, loopInBeat: t.loopInBeat || 0,
          loopOutBeat: t.loopOutBeat || (t.beatsPerBar || 4) * 4,
          maxLoops: (t.maxLoops !== undefined && t.maxLoops !== null) ? t.maxLoops : null,
          duration: t.duration || 0,
          pools: migratedPools
        }] : [];
      } else {
        sections = [];
      }

      return {
        id: t.id, title: t.title, description: t.description || '', tags: t.tags || '', mode, protected: !!t.protected,
        implementationNote: t.implementationNote || '',
        noAiOverride: (t.noAiOverride === true || t.noAiOverride === false) ? t.noAiOverride : null,
        duration: t.duration || 0, base: t.base || '', loopable: !!t.loopable,
        loopEngine: t.loopEngine || 'simple',
        // bpm/beatsPerBar/loopInBeat/loopOutBeat/startTrackBeat/maxLoops au niveau du morceau ne servent plus
        // qu'au séquentiel (BPM d'affichage) et au moteur de boucle simple/quantifié classique — plus au
        // vertical-random, désormais entièrement porté par chaque section.
        bpm: t.bpm || 120, beatsPerBar: t.beatsPerBar || 4, loopGridUnit: t.loopGridUnit || 'bars',
        loopInBeat: t.loopInBeat || 0, loopOutBeat: t.loopOutBeat || (t.beatsPerBar || 4) * 4,
        startTrackBeat: t.startTrackBeat || 0,
        maxLoops: (t.maxLoops !== undefined && t.maxLoops !== null) ? t.maxLoops : null,
        maxChainLoops: (t.maxChainLoops !== undefined && t.maxChainLoops !== null) ? t.maxChainLoops : null,
        normalizeVolume: !!t.normalizeVolume,
        fx: t.fx || null,
        fxTriggers: (t.fxTriggers || []).map(x => ({ id: x.id, label: x.label || '', target: x.target || null, fx: x.fx || {}, visible: !!x.visible, fadeSec: x.fadeSec != null ? x.fadeSec : null, fadeOutSec: x.fadeOutSec != null ? x.fadeOutSec : null, relations: fxRelationsClean(x.relations), steps: fxStepsClean(x.steps) })),
        fxSliders: fxSlidersClean(t.fxSliders),
        layers: (t.layers || []).map(l => ({ label: l.label, remoteFile: l.file, pendingFile: null, gain: l.gain || 1, duration: l.duration || 0, fx: l.fx || null })),
        intro: t.intro ? { label: t.intro.label || 'Intro', bars: t.intro.bars || 8, remoteFile: t.intro.file || null, pendingFile: null, gain: t.intro.gain || 1, descriptionFr: t.intro.descriptionFr || '', descriptionEn: t.intro.descriptionEn || '', bpm: t.intro.bpm || null, beatsPerBar: t.intro.beatsPerBar || null, fx: t.intro.fx || null } : null,
        outro: t.outro ? { label: t.outro.label || 'Outro', remoteFile: t.outro.file || null, pendingFile: null, gain: t.outro.gain || 1, descriptionFr: t.outro.descriptionFr || '', descriptionEn: t.outro.descriptionEn || '', fx: t.outro.fx || null } : null,
        // Migration douce : les morceaux séquentiels publiés avant l'architecture à emplacements avaient un
        // pool de segments plat (un seul groupe, anti-répétition au niveau du morceau) — repris tel quel comme
        // unique emplacement, comportement de lecture strictement identique à avant (même ordre de tirage
        // possible, mêmes probabilités, juste une seule "case" dans la chaîne au lieu de plusieurs).
        segmentSlots: t.segmentSlots ? t.segmentSlots.map(sl => ({
          id: sl.id || genId(), label: sl.label || '', avoidImmediateRepeat: sl.avoidImmediateRepeat !== false,
          referencesSlotId: sl.referencesSlotId || null, repeatCount: sl.repeatCount || 1,
          quantization: sl.quantization || 'bar', cutStyle: sl.cutStyle || 'fade', customCutFadeSec: sl.customCutFadeSec,
          bpm: sl.bpm, beatsPerBar: sl.beatsPerBar,
          descriptionFr: sl.descriptionFr || '', descriptionEn: sl.descriptionEn || '',
          nextOptions: (sl.nextOptions && sl.nextOptions.length) ? sl.nextOptions.map(opt => ({
            targetId: opt.targetId, label: opt.label || '',
            transition: opt.transition ? { label: opt.transition.label || '', bars: opt.transition.bars || 4, durationUnit: opt.transition.durationUnit || null, bpm: opt.transition.bpm, beatsPerBar: opt.transition.beatsPerBar, durationSeconds: opt.transition.durationSeconds, durationBeats: opt.transition.durationBeats, remoteFile: opt.transition.file || null, originalFileName: opt.transition.originalFileName || null, pendingFile: null, gain: opt.transition.gain || 1, descriptionFr: opt.transition.descriptionFr || '', descriptionEn: opt.transition.descriptionEn || '', fx: opt.transition.fx || null } : null,
            fxActions: opt.fxActions || null
          })) : null,
          alternatives: (sl.alternatives || []).map(a => ({ label: a.label || '', bars: a.bars || 8, remoteFile: a.file || null, originalFileName: a.originalFileName || null, pendingFile: null, gain: a.gain || 1 })),
          fx: sl.fx || null
        })) : ((t.segments && t.segments.length) ? [{
          id: genId(), label: '', avoidImmediateRepeat: t.avoidImmediateRepeat !== false, repeatCount: 1,
          alternatives: t.segments.map(s => ({ label: s.label || '', bars: s.bars || 8, remoteFile: s.file || null, pendingFile: null, gain: s.gain || 1 }))
        }] : []),
        // Embranchement-vertical : une entrée par boucle déclarée, id conservé pour que les cibles
        // d'embranchement séquentiel d'autres morceaux (sans rapport ici, mais même principe partout dans
        // le fichier) et les boutons du lecteur restent stables d'une publication à l'autre.
        loops: (() => {
          const rawLoops = t.loops || [];
          // Migration douce (24/08) : la classification paire/détour est désormais un champ explicite
          // (isDetour) plutôt qu'une comparaison implicite des mesures avec la référence -- mais un
          // morceau publié AVANT ce changement n'a jamais eu ce champ dans son JSON. Sans repli, une
          // boucle détour déjà publiée (mesures différentes de la référence, mais isDetour absent du
          // fichier) retomberait à tort sur `false` (= paire) au premier chargement. Le repli ne
          // s'applique que si le champ est réellement absent du JSON source (`'isDetour' in l` ment sinon,
          // y compris pour une boucle explicitement remise à false) -- migration ponctuelle, une seule
          // fois, jamais après un premier passage par le formulaire.
          const refBarsForMigration = (rawLoops.find(l => l.isInitial) || rawLoops[0] || {}).bars;
          return rawLoops.map(l => ({
            id: l.id || genId(), label: l.label || '', bars: l.bars || 8, isInitial: !!l.isInitial,
            remoteFile: l.file || null, originalFileName: l.originalFileName || null, pendingFile: null, gain: l.gain || 1,
            switchQuantize: l.switchQuantize || 'immediate',
            autoReturnEnabled: !!l.autoReturnEnabled, autoReturnValue: l.autoReturnValue || 4, autoReturnUnit: l.autoReturnUnit || 'bars',
            detourMode: l.detourMode || 'once', endLoopButtonLabel: l.endLoopButtonLabel || '',
            // Points de boucle (24/08) -- ne s'appliquent qu'à la boucle de référence (isInitial), mais
            // stockés sur toutes par simplicité, comme les autres champs par-boucle ci-dessus.
            startTrackBeat: l.startTrackBeat || 0, loopInBeat: l.loopInBeat || 0, loopOutBeat: l.loopOutBeat || null,
            duration: l.duration || 0,
            // Classification paire/détour explicite + tempo propre à une boucle de détour (24/08).
            isDetour: 'isDetour' in l ? !!l.isDetour : (!l.isInitial && refBarsForMigration != null && l.bars !== refBarsForMigration),
            bpm: l.bpm || null, beatsPerBar: l.beatsPerBar || null,
            // Fondu de coupure + transition optionnelle, même modèle que le séquentiel (24/08). Champs de
            // durée (durationUnit/bars/durationBeats/durationSeconds/bpm/beatsPerBar, 29/08) restaurés au
            // chargement -- absents ici jusqu'à cette correction, ils ne survivaient pas à une republication.
            cutStyle: l.cutStyle || 'fade', customCutFadeSec: l.customCutFadeSec,
            transition: l.transition ? {
              label: l.transition.label || '', durationUnit: l.transition.durationUnit || null,
              bars: l.transition.bars, durationBeats: l.transition.durationBeats, durationSeconds: l.transition.durationSeconds,
              bpm: l.transition.bpm, beatsPerBar: l.transition.beatsPerBar,
              remoteFile: l.transition.file || null, originalFileName: l.transition.originalFileName || null, pendingFile: null,
              fx: l.transition.fx || null
            } : null,
            fx: l.fx || null,
            fxActions: l.fxActions || null
          }));
        })(),
        stingers: (t.stingers || []).map(s => ({ label: s.label, remoteFile: s.file, pendingFile: null, gain: s.gain || 1 })),
        sfxIds: t.sfxIds ? t.sfxIds.slice() : null, // null = pas encore migré (voir migration juste après le chargement de sfxLibrary) ; [] = migré, aucun Sfx attaché
        randomizeSections: !!t.randomizeSections,
        sections,
        folderId: t.folderId || null
      };
    });
    libraryFolders = (data.libraryFolders || []).map(f => ({ id: f.id, label: f.label || '' }));
    // Dossiers fermés par défaut à l'ouverture (29/08, retour de Jules-Antoine) : peupler l'ensemble des
    // dossiers repliés avec TOUS les dossiers existants juste après leur chargement, plutôt que de partir
    // d'un Set() vide qui les laissait tous ouverts. Un dossier créé plus tard dans la session (bouton "+
    // Dossier") n'est PAS concerné -- il n'existe pas encore à cet instant, donc reste ouvert comme avant.
    libraryFolders.forEach(f => collapsedLibraryFolderIds.add(f.id));
    library.forEach(t => { if (t.folderId && !libraryFolders.some(f => f.id === t.folderId)) t.folderId = null; });
    sfxLibrary = (data.sfxLibrary || []).map(s => ({
      id: s.id, title: s.title || '', protected: !!s.protected,
      // Repli sur l'ancien champ unique "description" pour tout Sfx publié avant le passage au bilingue —
      // lu une fois ici, jamais réécrit dans l'ancien champ ensuite (même principe que tagline -> title/subtitle).
      descriptionFr: s.descriptionFr != null ? s.descriptionFr : (s.description || ''),
      descriptionEn: s.descriptionEn || '',
      tag: s.tag || '',
      rrMode: s.rrMode === 'sequential' ? 'sequential' : 'random',
      duckMainTrack: !!s.duckMainTrack,
      spatial: s.spatial || null,
      alternatives: (s.alternatives || []).map(a => ({ label: a.label || '', remoteFile: a.file, originalFileName: a.originalFileName || null, pendingFile: null })),
      folderId: s.folderId || null
    }));
    sfxFolders = (data.sfxFolders || []).map(f => ({ id: f.id, label: f.label || '' }));
    sfxFolders.forEach(f => collapsedSfxFolderIds.add(f.id)); // fermés par défaut à l'ouverture (29/08), même principe que libraryFolders ci-dessus
    sfxLibrary.forEach(s => { if (s.folderId && !sfxFolders.some(f => f.id === s.folderId)) s.folderId = null; });
    socials = (data.socials || []).map(s => ({ id: s.id, platform: s.platform || 'twitter', url: s.url || '' }));
    adReelFolders = (data.adReelFolders || []).map(f => ({ id: f.id, label: f.label || '' }));
    adReelFolders.forEach(f => collapsedAdReelFolderIds.add(f.id)); // fermés par défaut à l'ouverture (29/08), même principe que libraryFolders ci-dessus
    packs = (data.packs || []).map(p => ({
      id: p.id, title: p.title || '', illustration: p.illustration || null, illustrationOriginalName: p.illustrationOriginalName || null, pendingIllustration: null,
      watermark: p.watermark || null, watermarkOriginalName: p.watermarkOriginalName || null, pendingWatermark: null,
      // Migration douce : les packs publiés avant l'architecture bilingue n'ont qu'un champ "presentation"
      // unique — repris tel quel comme version française plutôt que perdu.
      presentationFr: p.presentationFr || p.presentation || '', presentationEn: p.presentationEn || '',
      buyable: !!p.buyable, buyUrl: p.buyUrl || '', videoTestModeEnabled: !!p.videoTestModeEnabled,
      priceEurCents: p.priceEurCents == null ? null : p.priceEurCents, subscriberCredits: p.subscriberCredits == null ? null : p.subscriberCredits, catalogListed: p.catalogListed !== false,
      bgColor: p.bgColor || '#f5f6f8', textColor: p.textColor || '#24262b', font: p.font || 'default',
      trackIds: p.trackIds ? p.trackIds.slice() : [],
      sfxIds: p.sfxIds ? p.sfxIds.slice() : [],
      linkedAdReelId: p.linkedAdReelId || '',
      freeDownloadEnabled: !!p.freeDownloadEnabled
    }));
    implementationSkills = Object.assign({ wwise: false, fmod: false, unity: false, unreal: false }, data.implementationSkills || {});
    noAiCertifiedGlobal = !!data.noAiCertifiedGlobal;
    waveformStyle = window.LayerPlayerCore.WAVEFORM_STYLES.includes(data.waveformStyle) ? data.waveformStyle : 'bars';
    seqMapTheme = window.LayerPlayerCore.SEQ_MAP_THEMES.includes(data.seqMapTheme) ? data.seqMapTheme : 'light';
    allowEmbedding = !!data.allowEmbedding;
    sharePreview = Object.assign({}, DEFAULT_SHARE_PREVIEW, data.sharePreview || {}); sharePreviewPendingFile = null;
    collections = (data.collections || []).map(c => ({
      id: c.id, title: c.title || '', illustration: c.illustration || null, illustrationOriginalName: c.illustrationOriginalName || null, pendingIllustration: null,
      presentationFr: c.presentationFr || '', presentationEn: c.presentationEn || '',
      bgColor: c.bgColor || '#f5f6f8', textColor: c.textColor || '#24262b', font: c.font || 'default',
      buyable: !!c.buyable, buyUrl: c.buyUrl || '', freeDownloadEnabled: !!c.freeDownloadEnabled,
      packIds: c.packIds ? c.packIds.slice() : []
    }));
    customFonts = (data.customFonts || []).map(f => ({ id: f.id, name: f.name || '', remoteFile: f.file || null, originalFileName: f.originalFileName || null, pendingFile: null }));
    adReels = (data.adReels || []).map(a => ({
      id: a.id, label: a.label || a.id,
      lang: a.lang || 'fr',
      profile: Object.assign(
        { title: '', subtitle: '', bio: '', contactEmail: '', contactUrl: '', logo: null, photo: null },
        a.profile || {},
        { theme: migrateProfileTheme(a.profile) }
      ),
      testimonials: a.testimonials || [],
      trackIds: a.trackIds ? a.trackIds.slice() : [],
      trackOverrides: a.trackOverrides ? JSON.parse(JSON.stringify(a.trackOverrides)) : {},
      allowIndexing: a.allowIndexing !== false,
      slug: a.slug || null,
      blocks: migrateBlocks(a).map(b => {
        if (b.type === 'photo') return { ...b, images: (b.images || []).map(img => ({ file: img.file, originalFileName: img.originalFileName || null, pendingFile: null })) };
        if (b.type === 'video') return { ...b, videos: (b.videos || []).map(v => ({ title: v.title, url: v.url, comment: v.comment || '', thumbnail: v.thumbnail || null, thumbnailOriginalName: v.thumbnailOriginalName || null, pendingThumbnail: null, source: v.source === 'library' ? 'library' : 'url', libraryVideoId: v.libraryVideoId || null })) };
        return b;
      }),
      logoPendingFile: null, photoPendingFile: null, themeBgImagePendingFile: null,
      folderId: a.folderId || null
    }));
    // Filet de sécurité : un folderId qui ne correspond plus à aucun dossier existant (dossier supprimé
    // entre deux publications par exemple) fait remonter l'AdReel à la racine plutôt que de le rendre
    // introuvable dans la liste maître.
    adReels.forEach(a => { if (a.folderId && !adReelFolders.some(f => f.id === a.folderId)) a.folderId = null; });
    if (adReels.length === 0) {
      adReels.push({ id: 'main', label: tr('defaultAdreelLabel'), lang: currentLang(), blocks: freshBlocks(), profile: { title: '', subtitle: '', bio: '', contactEmail: '', contactUrl: '', logo: null, photo: null, theme: Object.assign({}, DEFAULT_THEME) }, testimonials: [], trackIds: [], trackOverrides: {}, allowIndexing: true, logoPendingFile: null, photoPendingFile: null, themeBgImagePendingFile: null, folderId: null });
    }
    currentAdReelId = adReels.some(a => a.id === 'main') ? 'main' : adReels[0].id;
    const cur = adReels.find(a => a.id === currentAdReelId);
    blocks = cur.blocks; profile = cur.profile; testimonials = cur.testimonials; trackIds = cur.trackIds; trackOverrides = cur.trackOverrides || (cur.trackOverrides = {});
    logoPendingFile = cur.logoPendingFile; photoPendingFile = cur.photoPendingFile; themeBgImagePendingFile = cur.themeBgImagePendingFile || null;

    collapsedPackIds.clear();
    packs.forEach(p => collapsedPackIds.add(p.id));
    collapsedCollectionIds.clear();
    collections.forEach(c => collapsedCollectionIds.add(c.id));
    collapsedBlockIds.clear();
    adReels.forEach(a => a.blocks.forEach(b => collapsedBlockIds.add(b.id)));

    renderLibrary();
    renderSfxLibrary();
    renderSocials();
    renderPacks();
    renderCollections();
    renderAdReelSelect();
    renderManageAdreels();
    fillAppearanceFields();
    fillImplementationSkillsFields();
    fillNoAiCertifiedGlobalField();
    fillAllowEmbeddingField(); fillSharePreviewFields();
    rebuildAllCards();
    hasUnsavedEdits = false;
    // Suppressions non publiées abandonnées par ce rechargement : les éléments reviennent, leurs fichiers R2 restent.
    pendingR2Deletes.clear(); pendingOrphanR2Keys.clear();
    rememberPublishedCatalog();
    dataLoadOk = true;
    document.getElementById('btnPublish').disabled = false;
    log(tr('loadedSummary', { adreels: adReels.length, packs: packs.length, tracks: library.length }), 'ok');
  } catch (err) {
    log(tr('errorPrefix', { message: err.message }), 'err');
    // Garde-fou (29/08, scénario réel vécu par Jules-Antoine : erreur 403 au chargement automatique, puis
    // clic sur Publier en mode panique, écrasant les vraies données sur GitHub par une bibliothèque restée
    // vide). Publier reste bloqué UNIQUEMENT si aucun chargement n'a JAMAIS réussi depuis l'ouverture du
    // backstage -- si dataLoadOk est déjà vrai (rechargement manuel ultérieur ayant échoué à son tour),
    // les données en mémoire restent les bonnes (ce catch ne les a pas touchées), publier reste donc sûr et
    // le bouton n'est délibérément pas re-désactivé ici.
    if (!dataLoadOk) {
      log(tr('publishBlockedNoLoadMsg'), 'err');
      document.getElementById('btnPublish').disabled = true;
    }
  }
}
// Attend la décision du verrou de connexion (voir en tête de script) avant de charger quoi que ce
// soit -- si le visiteur n'a pas de session valide, backstageAuthGateReady a déjà déclenché la
// redirection vers bienvenue.html et ne se résout jamais à `true`.
// Premier chargement, puis proposition de reprendre un brouillon non publié (voir « Brouillon automatique » ci-dessous).
backstageAuthGateReady.then(async (authOk) => { if (authOk) { await loadData(true); await offerDraftRestore(); } });

document.getElementById('btnLoad').addEventListener('click', async () => {
  if (hasUnsavedEdits) {
    const proceed = await window.LayerPitchNotify.confirm(tr('reloadConfirm'), { danger: true });
    if (!proceed) return;
    await clearDraft(); // recharger = abandonner les modifications non publiées, brouillon compris
  }
  loadData(false);
});

