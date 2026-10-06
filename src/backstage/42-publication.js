/* ---------------- Publication ---------------- */
// URL locale temporaire (blob:) pour un fichier tout juste choisi mais pas encore publié -- utilisée
// UNIQUEMENT par pendingPreviewUrl() ci-dessous (images d'AdReel en Aperçu, 18/09). Sans effet en
// vraie publication : publishAll() a déjà uploadé puis vidé tous les pendingXxxFile avant d'appeler
// buildDataSnapshot() (voir plus bas), ce repli est donc systématiquement un no-op à ce moment-là --
// jamais de blob: dans les données réellement publiées.
function pendingPreviewUrl(file) {
  return file ? URL.createObjectURL(file) : null;
}
// Assemblage de l'objet au format data.json/Postgres à partir de l'état en mémoire (extrait de
// publishAll() le 7 septembre pour être réutilisable par la prévisualisation -- lecture pure, aucun
// effet de bord, aucun appel réseau. Images d'AdReel tout juste choisies mais pas encore publiées :
// remplacées par une URL locale temporaire (pendingPreviewUrl() ci-dessus, 18/09) plutôt que null --
// valable seulement le temps que CET onglet backstage (qui a créé l'URL) reste ouvert, jamais persisté
// ni publié. L'audio suit le même principe mais via un mécanisme différent (localFile/localUrl,
// consommé directement par player.js -- voir plus loin dans cette fonction). Pistes/packs/collections
// jamais encore publiés une seule fois restent, eux, en null/absents ici comme avant ce changement.
function buildDataSnapshot(effectivePlan, publishedAt) {
  return {
    publishedAt,
    library: library.map(t => ({
      id: t.id, title: t.title, description: t.description, tags: t.tags || '', mode: t.mode, loopable: !!t.loopable,
      implementationNote: t.implementationNote || '',
      noAiOverride: (t.noAiOverride === true || t.noAiOverride === false) ? t.noAiOverride : null,
      loopEngine: t.loopEngine || 'simple',
      bpm: t.bpm || 120, beatsPerBar: t.beatsPerBar || 4, loopGridUnit: t.loopGridUnit || 'bars',
      loopInBeat: t.loopInBeat || 0, loopOutBeat: t.loopOutBeat || (t.beatsPerBar || 4) * 4,
      startTrackBeat: t.startTrackBeat || 0,
      maxLoops: (t.maxLoops !== undefined && t.maxLoops !== null) ? t.maxLoops : null,
      maxChainLoops: (t.maxChainLoops !== undefined && t.maxChainLoops !== null) ? t.maxChainLoops : null,
      normalizeVolume: !!t.normalizeVolume,
      fx: t.fx || null,
      fxTriggers: (t.fxTriggers || []).map(x => ({ id: x.id, label: x.label || '', target: x.target || null, fx: x.fx || {}, visible: !!x.visible, fadeSec: x.fadeSec != null ? x.fadeSec : null, fadeOutSec: x.fadeOutSec != null ? x.fadeOutSec : null, relations: fxRelationsClean(x.relations), steps: fxStepsClean(x.steps), showEffects: x.showEffects !== false, targets: Array.isArray(x.targets) && x.targets.length ? x.targets.map(t => Object.assign({}, t)) : undefined })),
      fxSliders: fxSlidersClean(t.fxSliders),
      duration: Math.round(t.duration * 100) / 100, base: t.base,
      // file/localUrl (18/09) : un fichier tout juste choisi mais pas encore publié n'a pas de
      // remoteFile -- localUrl porte alors une URL locale temporaire (pendingPreviewUrl(), blob:),
      // lue directement par player.js (loadArrayBuffer()) sans jamais passer par track.base. file
      // reste null dans ce cas (jamais un blob: -- track.base+file resterait un vrai chemin distant
      // invalide). Même repli partout ci-dessous (layers/intro/outro/segmentSlots/loops/sections).
      layers: (t.mode === 'static' ? (t.layers || []).slice(0, 1) : (t.layers || [])).map(l => ({ label: l.label, file: l.remoteFile || null, localUrl: l.remoteFile ? null : pendingPreviewUrl(l.pendingFile), originalFileName: l.originalFileName || null, gain: l.gain || 1, duration: Math.round((l.duration || 0) * 100) / 100, fx: l.fx || null })),
      intro: (t.intro && (t.intro.remoteFile || t.intro.pendingFile)) ? { label: t.intro.label || 'Intro', bars: t.intro.bars || 8, file: t.intro.remoteFile || null, localUrl: t.intro.remoteFile ? null : pendingPreviewUrl(t.intro.pendingFile), originalFileName: t.intro.originalFileName || null, gain: t.intro.gain || 1, descriptionFr: t.intro.descriptionFr || '', descriptionEn: t.intro.descriptionEn || '', bpm: t.intro.bpm || null, beatsPerBar: t.intro.beatsPerBar || null, fx: t.intro.fx || null } : null,
      outro: (t.outro && (t.outro.remoteFile || t.outro.pendingFile)) ? { label: t.outro.label || 'Outro', file: t.outro.remoteFile || null, localUrl: t.outro.remoteFile ? null : pendingPreviewUrl(t.outro.pendingFile), originalFileName: t.outro.originalFileName || null, gain: t.outro.gain || 1, descriptionFr: t.outro.descriptionFr || '', descriptionEn: t.outro.descriptionEn || '', fx: t.outro.fx || null } : null,
      segmentSlots: (t.segmentSlots || []).map(sl => ({
        id: sl.id, label: sl.label || '', avoidImmediateRepeat: sl.avoidImmediateRepeat !== false,
        referencesSlotId: sl.referencesSlotId || null, repeatCount: sl.repeatCount || 1,
        quantization: sl.quantization || 'bar', cutStyle: sl.cutStyle || 'fade', customCutFadeSec: sl.customCutFadeSec,
        bpm: sl.bpm, beatsPerBar: sl.beatsPerBar,
        descriptionFr: sl.descriptionFr || '', descriptionEn: sl.descriptionEn || '',
        nextOptions: (sl.nextOptions && sl.nextOptions.length) ? sl.nextOptions.map(opt => ({
          targetId: opt.targetId, label: opt.label || '',
          transition: (opt.transition && (opt.transition.remoteFile || opt.transition.pendingFile)) ? { label: opt.transition.label || '', bars: opt.transition.bars || 4, durationUnit: opt.transition.durationUnit || null, bpm: opt.transition.bpm, beatsPerBar: opt.transition.beatsPerBar, durationSeconds: opt.transition.durationSeconds, durationBeats: opt.transition.durationBeats, file: opt.transition.remoteFile || null, localUrl: opt.transition.remoteFile ? null : pendingPreviewUrl(opt.transition.pendingFile), originalFileName: opt.transition.originalFileName || null, gain: opt.transition.gain || 1, descriptionFr: opt.transition.descriptionFr || '', descriptionEn: opt.transition.descriptionEn || '', fx: opt.transition.fx || null } : null,
          fxActions: opt.fxActions || null
        })) : null,
        alternatives: sl.referencesSlotId ? [] : (sl.alternatives || []).map(a => ({ label: a.label || '', bars: a.bars || 8, file: a.remoteFile || null, localUrl: a.remoteFile ? null : pendingPreviewUrl(a.pendingFile), originalFileName: a.originalFileName || null, gain: a.gain || 1 })),
        fx: sl.fx || null
      })),
      // Embranchement-vertical : une entrée par boucle déclarée (même les boucles sans fichier — voir
      // note dans buildPreviewTrackObject, l'index doit rester aligné avec data-loop-idx côté lecteur).
      loops: (t.loops || []).map(l => ({
        id: l.id, label: l.label || '', bars: l.bars || 8, isInitial: !!l.isInitial,
        file: l.remoteFile || null, localUrl: l.remoteFile ? null : pendingPreviewUrl(l.pendingFile), gain: l.gain || 1,
        switchQuantize: l.switchQuantize || 'immediate',
        autoReturnEnabled: !!l.autoReturnEnabled, autoReturnValue: l.autoReturnValue || 4, autoReturnUnit: l.autoReturnUnit || 'bars',
        detourMode: l.detourMode || 'once', endLoopButtonLabel: l.endLoopButtonLabel || '',
        startTrackBeat: l.startTrackBeat || 0, loopInBeat: l.loopInBeat || 0, loopOutBeat: l.loopOutBeat || null,
        duration: Math.round((l.duration || 0) * 100) / 100,
        isDetour: !!l.isDetour, bpm: l.bpm || null, beatsPerBar: l.beatsPerBar || null,
        cutStyle: l.cutStyle || 'fade', customCutFadeSec: l.customCutFadeSec,
        transition: (l.transition && (l.transition.remoteFile || l.transition.pendingFile)) ? {
          label: l.transition.label || '', durationUnit: l.transition.durationUnit || null,
          bars: l.transition.bars, durationBeats: l.transition.durationBeats, durationSeconds: l.transition.durationSeconds,
          bpm: l.transition.bpm, beatsPerBar: l.transition.beatsPerBar,
          file: l.transition.remoteFile || null, localUrl: l.transition.remoteFile ? null : pendingPreviewUrl(l.transition.pendingFile), originalFileName: l.transition.originalFileName || null,
          fx: l.transition.fx || null
        } : null,
        fx: l.fx || null,
        fxActions: l.fxActions || null
      })),
      randomizeSections: !!t.randomizeSections,
      // Vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07) : chaque section porte
      // désormais son propre tempo/timeline, comme un vrai segment Wwise indépendant — plus de
      // fixedLayers/randomGroups au niveau du morceau, tout vit dans sections[].pools[].
      sections: (t.sections || []).map(sec => ({
        id: sec.id, label: sec.label || '',
        referencesSectionId: sec.referencesSectionId || null,
        bpm: sec.bpm || 120, beatsPerBar: sec.beatsPerBar || 4,
        startTrackBeat: sec.startTrackBeat || 0,
        loopInBeat: sec.loopInBeat || 0, loopOutBeat: sec.loopOutBeat || (sec.beatsPerBar || 4) * 4,
        maxLoops: (sec.maxLoops !== undefined && sec.maxLoops !== null) ? sec.maxLoops : null,
        duration: Math.round((sec.duration || 0) * 100) / 100,
        pools: sec.referencesSectionId ? [] : (sec.pools || []).map(p => ({
          id: p.id, label: p.label || '', avoidImmediateRepeat: p.avoidImmediateRepeat !== false,
          referencesPoolId: p.referencesPoolId || null,
          alternatives: p.referencesPoolId ? [] : (p.alternatives || []).map(a => ({ label: a.label || '', file: a.remoteFile || null, localUrl: a.remoteFile ? null : pendingPreviewUrl(a.pendingFile), originalFileName: a.originalFileName || null, gain: a.gain || 1 })),
          fx: p.fx || null
        }))
      })),
      sfxIds: t.sfxIds || [],
      folderId: t.folderId || null
    })),
    libraryFolders: libraryFolders.map(f => ({ id: f.id, label: f.label || '' })),
    sfxLibrary: sfxLibrary.map(s => ({
      id: s.id, title: s.title || '', descriptionFr: s.descriptionFr || '', descriptionEn: s.descriptionEn || '', tag: s.tag || '',
      rrMode: s.rrMode === 'sequential' ? 'sequential' : 'random',
      duckMainTrack: !!s.duckMainTrack, base: s.base || '',
      spatial: s.spatial || null,
      alternatives: (s.alternatives || []).filter(a => a.remoteFile || a.pendingFile).map(a => ({ label: a.label || '', file: a.remoteFile || null, localUrl: a.remoteFile ? null : pendingPreviewUrl(a.pendingFile), originalFileName: a.originalFileName || null })),
      folderId: s.folderId || null
    })),
    sfxFolders: sfxFolders.map(f => ({ id: f.id, label: f.label || '' })),
    // Le lien de référence (url) est explicitement optionnel dans l'UI ("pour ta propre référence") et
    // n'est jamais utilisé pour construire l'URL de partage pré-remplie (buildSocialShareUrl ne s'appuie
    // que sur platform) -- filtrer sur sa présence faisait disparaître silencieusement à la publication
    // tout réseau choisi sans lien de référence renseigné (20/08, bug remonté par Jules-Antoine : LinkedIn
    // configuré mais jamais retrouvé au rechargement). On persiste désormais dès qu'une plateforme est
    // choisie, url ou non.
    socials: socials.map(s => ({ id: s.id, platform: s.platform, url: s.url || '' })),
    adReelFolders: adReelFolders.map(f => ({ id: f.id, label: f.label || '' })),
    packs: packs.map(p => ({ id: p.id, title: p.title, illustration: p.illustration || null, illustrationOriginalName: p.illustrationOriginalName || null, watermark: p.watermark || null, watermarkOriginalName: p.watermarkOriginalName || null, presentationFr: p.presentationFr || '', presentationEn: p.presentationEn || '', buyable: !!p.buyable, buyUrl: p.buyUrl || '', priceEurCents: p.priceEurCents == null ? null : p.priceEurCents, subscriberCredits: p.subscriberCredits == null ? null : p.subscriberCredits, catalogListed: p.catalogListed !== false, freeDownloadEnabled: !!p.freeDownloadEnabled, videoTestModeEnabled: !!p.videoTestModeEnabled, bgColor: p.bgColor || '#f6f5f3', textColor: p.textColor || '#262521', font: p.font || 'default', presetId: p.presetId || null, separator: p.separator || null, effectivePlan, trackIds: p.trackIds || [], sfxIds: p.sfxIds || [], linkedAdReelId: p.linkedAdReelId || null })),
    implementationSkills: { wwise: !!implementationSkills.wwise, fmod: !!implementationSkills.fmod, unity: !!implementationSkills.unity, unreal: !!implementationSkills.unreal },
    noAiCertifiedGlobal: !!noAiCertifiedGlobal,
    waveformStyle: window.LayerPlayerCore.WAVEFORM_STYLES.includes(waveformStyle) ? waveformStyle : 'bars',
    seqMapTheme: window.LayerPlayerCore.SEQ_MAP_THEMES.includes(seqMapTheme) ? seqMapTheme : 'light',
    allowEmbedding: !!allowEmbedding,
    sharePreview: { title: (sharePreview.title || '').trim(), description: (sharePreview.description || '').trim(), image: sharePreview.image || null, imageOriginalName: sharePreview.imageOriginalName || null, autoFit: sharePreview.autoFit !== false, fitMode: sharePreview.fitMode === 'contain' ? 'contain' : 'fill', fitColor: /^#[0-9a-f]{6}$/i.test(sharePreview.fitColor || '') ? sharePreview.fitColor : '#ffffff' },
    collections: collections.map(c => ({ id: c.id, title: c.title, illustration: c.illustration || null, illustrationOriginalName: c.illustrationOriginalName || null, presentationFr: c.presentationFr || '', presentationEn: c.presentationEn || '', bgColor: c.bgColor || '#f6f5f3', textColor: c.textColor || '#262521', font: c.font || 'default', presetId: c.presetId || null, separator: c.separator || null, effectivePlan, buyable: !!c.buyable, buyUrl: c.buyUrl || '', freeDownloadEnabled: !!c.freeDownloadEnabled, packIds: c.packIds || [] })),
    customFonts: customFonts.filter(f => f.remoteFile).map(f => ({ id: f.id, name: f.name || '', file: f.remoteFile, originalFileName: f.originalFileName || null })),
    adReels: adReels.map(ar => ({
      id: ar.id,
      label: ar.label || ar.id,
      lang: ar.lang || 'fr',
      blocks: ar.blocks.map(b => {
        let out;
        if (b.type === 'text') out = { id: b.id, type: 'text', title: b.title || '', content: b.content || '', align: b.align || 'left' };
        else if (b.type === 'photo') out = { id: b.id, type: 'photo', align: b.align || 'left', caption: b.caption || '', images: b.images.filter(i => i.file || i.pendingFile).map(i => ({ file: i.file || pendingPreviewUrl(i.pendingFile), originalFileName: i.originalFileName || null })) };
        else if (b.type === 'video') out = { id: b.id, type: 'video', videos: b.videos.map(v => ({ title: v.title || '', url: v.url || '', comment: v.comment || '', thumbnail: v.thumbnail || pendingPreviewUrl(v.pendingThumbnail) || null, thumbnailOriginalName: v.thumbnailOriginalName || null, source: v.source === 'library' ? 'library' : 'url' })) };
        else if (b.type === 'packs') out = { id: b.id, type: 'packs', presentation: b.presentation || '', packIds: b.packIds || [] };
        else if (b.type === 'collections') out = { id: b.id, type: 'collections', presentation: b.presentation || '', collectionIds: b.collectionIds || [] };
        else if (b.type === 'sfx') out = { id: b.id, type: 'sfx', sfxIds: b.sfxIds || [] };
        else if (b.type === 'socials') out = { id: b.id, type: 'socials', socialIds: b.socialIds || [] };
        else out = { id: b.id, type: b.type };
        // Champ commun à tous les types de bloc, sans exception (décision : réglages par bloc partout) —
        // ajouté une seule fois ici plutôt que dupliqué dans chacune des branches ci-dessus. Image de
        // fond par bloc : le fichier en attente vit hors de b.appearance (b._pending_bgImage, voir
        // publishAll()), jamais lu par ce Object.assign générique -- ajouté à part juste après.
        if (b.appearance && Object.keys(b.appearance).length) out.appearance = Object.assign({}, b.appearance);
        if (b._pending_bgImage) {
          if (!out.appearance) out.appearance = {};
          out.appearance.bgImage = out.appearance.bgImage || pendingPreviewUrl(b._pending_bgImage);
        }
        // Réglage par élément (Chantier Apparence, palier Pro, 05/09) : toujours écrit tel quel, même si
        // le compositeur n'est plus Pro au moment de PUBLIER -- le gating à l'application se fait côté
        // runtime (index.html, sur le tier figé ci-dessous), jamais en omettant la donnée à l'écriture
        // (cohérent avec block.appearance qui reste, lui aussi, toujours écrit indépendamment du palier).
        if (b.elementAppearance && Object.keys(b.elementAppearance).length) out.elementAppearance = Object.assign({}, b.elementAppearance);
        return out;
      }),
      profile: Object.assign({}, ar.profile, {
        // Admin seulement : palier de publication forcé pour CET AdReel (vérifier son rendu public sous un
        // autre palier). Sans override : le palier passé en paramètre (réel à la publication, affiché à l'aperçu).
        effectivePlan: (currentUserIsAdmin && ar.profile && ar.profile.adminTierOverride) || effectivePlan,
        logo: ar.profile.logo || pendingPreviewUrl(ar.logoPendingFile),
        photo: ar.profile.photo || pendingPreviewUrl(ar.photoPendingFile),
        theme: ar.profile.theme
          ? Object.assign({}, ar.profile.theme, { bgImage: ar.profile.theme.bgImage || pendingPreviewUrl(ar.themeBgImagePendingFile) })
          : ar.profile.theme
      }),
      testimonials: ar.testimonials.map(tm => {
        const out = Object.assign({}, tm, { avatar: tm.avatar || pendingPreviewUrl(tm.avatarPendingFile) });
        delete out.avatarPendingFile;
        return out;
      }),
      trackIds: ar.trackIds || [],
      trackOverrides: ar.trackOverrides || {},
      allowIndexing: ar.allowIndexing !== false,
      folderId: ar.folderId || null
    }))
  };
}
// Prévisualisation (aperçu en direct des modifications non publiées) : dépose l'état en mémoire dans
// localStorage (partagé entre onglets de même origine, contrairement à sessionStorage -- l'aperçu
// s'ouvre dans un nouvel onglet) puis ouvre la page publique concernée avec ?preview=1 -- son
// loadSiteData() lit alors ce dépôt local au lieu d'interroger Postgres. Audio et images tout juste
// ajoutés/remplacés ressortent en null (voir buildDataSnapshot) : seule la dernière version déjà
// publiée peut s'afficher, d'où le bandeau "Mode aperçu" côté page publique pour que ça ne passe pas
// pour un bug (décision du 7 septembre avec Jules-Antoine, plutôt que de retoucher tous les endroits
// des pages publiques qui vont chercher l'audio/les images en ligne -- risque jugé trop élevé pour ce
// chantier).
const PREVIEW_STORAGE_KEY = 'layerpitch_preview_data';
function openPreview(relativeUrl) {
  saveWorkingPendingIntoCurrent();
  try {
    const snapshot = buildDataSnapshot(currentEffectivePlan, Date.now());
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    log(tr('previewFailedMsg', { message: e.message }), 'err');
    return;
  }
  window.open(relativeUrl, '_blank');
}
document.getElementById('btnPreview').addEventListener('click', () => {
  const adreelParam = currentAdReelId === 'main' ? '' : `&adreel=${encodeURIComponent(currentAdReelId)}`;
  openPreview(`./index.html?preview=1${adreelParam}&lang=${currentLang()}`);
});
async function publishAll() {
  // Garde-fou (29/08, défense en profondeur -- le bouton est déjà désactivé dans ce cas, voir loadData(),
  // mais on protège aussi la fonction elle-même contre un déclenchement par un autre chemin). Scénario réel
  // vécu par Jules-Antoine : échec du chargement initial (403), puis clic sur Publier en mode panique,
  // écrasant les vraies données par une bibliothèque restée vide.
  if (!dataLoadOk) { log(tr('publishBlockedNoLoadMsg'), 'err'); return; }
  trackBackstageEvent('publish_click', {});
  const buildVersion = Date.now(); // identifiant unique de cette publication (date de publication figée dans le snapshot)
  document.getElementById('btnPublish').disabled = true;
  log(tr('publicationHeader'));
  saveWorkingPendingIntoCurrent();
  try {
    // Palier effectif figé une fois pour toute cette publication (Chantier Apparence Phase 3, 4
    // septembre) : les pages publiques (index.html/pack.html/collection.html) sont statiques, sans
    // appel serveur au chargement -- impossible d'y résoudre le palier à la volée. Résolu ici plutôt que
    // dans chacune des 3 boucles ci-dessous (un seul composer_profiles.plan pour tout le compositeur).
    // Bloque la publication plutôt que de deviner un palier si la session/RPC échoue -- même logique que
    // le garde-fou dataLoadOk ci-dessus, jamais de publication avec un palier incertain.
    log(tr('resolvingEffectivePlan'));
    await loadPostgresReadScripts();
    const { status: planStatus, error: planError } = await window.LayerPitchSubscriptions.getTrialStatus();
    if (planError || !planStatus) {
      throw new Error(tr('publishBlockedNoPlanMsg', { error: planError || 'aucun profil compositeur' }));
    }
    // Palier figé dans ce qui est publié = le VRAI palier, jamais l'aperçu admin ("Voir en tant que") ;
    // currentEffectivePlan (l'affichage) garde, lui, le palier simulé s'il y en a un.
    const effectivePlan = realTierFromTrialStatus(planStatus);
    currentEffectivePlan = effectiveTierFromTrialStatus(planStatus);
    log(tr('resolvedEffectivePlan', { plan: effectivePlan }), 'ok');
    // Identité du compositeur, résolue avant tout envoi de fichier (les polices sont rangées sous fonts/<son id>/) et
    // avant les écritures en base -- un seul message clair si la session manque ou a expiré.
    const { composerId: myComposerId, error: composerError } = await window.LayerPitchAuth.ensureMyComposerProfile();
    if (composerError) throw new Error('Aucune session active — connecte-toi avant de publier (' + composerError + ').');
    // Toutes les images vont dans le dossier du compositeur, images/<son id>/ (27/09) : l'id d'un AdReel n'est unique
    // que par compositeur ('main' pour tous), un nom à plat (images/photo-main.jpg) était partagé entre comptes -- la
    // photo de bio d'un bêta-testeur a ainsi remplacé celle d'un autre. Seul ce dossier est accepté par
    // create-media-signed-url.
    // Image de l'aperçu des liens partagés (1er/10) : images/<son id>/share-preview.<ext>, avant l'instantané ci-dessous.
    if (sharePreviewPendingFile) {
      // Ajustage automatique (case cochée) : recadrage centré au format 1200 × 630 ; sinon le fichier part tel quel.
      let toSend = sharePreviewPendingFile;
      if (sharePreview.autoFit !== false) {
        try { toSend = await sharePreviewFit(sharePreviewPendingFile, sharePreview.fitMode, sharePreview.fitColor); } catch (e) { log(tr('sharePreviewFitFailed', { error: e && e.message ? e.message : String(e) }), 'warn'); toSend = sharePreviewPendingFile; }
      }
      const bytes = new Uint8Array(await toSend.arrayBuffer());
      const fileName = `${myComposerId}/share-preview.${extOf(toSend.name)}`;
      await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
      sharePreview.image = fileName; sharePreview.imageOriginalName = sharePreviewPendingFile.name; sharePreviewPendingFile = null;
      log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
    }
    for (const ar of adReels) {
      if (ar.logoPendingFile) {
        log(tr('uploadingLogo', { id: ar.id }));
        const bytes = new Uint8Array(await ar.logoPendingFile.arrayBuffer());
        const fileName = `${myComposerId}/logo-${ar.id}.${extOf(ar.logoPendingFile.name)}`;
        await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
        ar.profile.logo = fileName; ar.profile.logoOriginalName = ar.logoPendingFile.name; ar.logoPendingFile = null;
        log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
      }
      if (ar.photoPendingFile) {
        log(tr('uploadingBioPhoto', { id: ar.id }));
        const bytes = new Uint8Array(await ar.photoPendingFile.arrayBuffer());
        const fileName = `${myComposerId}/photo-${ar.id}.${extOf(ar.photoPendingFile.name)}`;
        await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
        ar.profile.photo = fileName; ar.profile.photoOriginalName = ar.photoPendingFile.name; ar.photoPendingFile = null;
        log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
      }
      if (ar.themeBgImagePendingFile) {
        log(tr('uploadingThemeBgImage', { id: ar.id }));
        const bytes = new Uint8Array(await ar.themeBgImagePendingFile.arrayBuffer());
        const fileName = `${myComposerId}/theme-bg-${ar.id}.${extOf(ar.themeBgImagePendingFile.name)}`;
        await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
        if (!ar.profile.theme) ar.profile.theme = Object.assign({}, DEFAULT_THEME);
        ar.profile.theme.bgImage = fileName; ar.profile.theme.bgImageOriginalName = ar.themeBgImagePendingFile.name; ar.themeBgImagePendingFile = null;
        log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
      }
      for (let i = 0; i < (ar.testimonials || []).length; i++) {
        const tm = ar.testimonials[i];
        if (!tm.avatarPendingFile) continue;
        log(tr('uploadingTestimonialAvatar', { id: ar.id, n: i + 1 }));
        const bytes = new Uint8Array(await tm.avatarPendingFile.arrayBuffer());
        const fileName = `${myComposerId}/${ar.id}-testimonial-avatar-${i}.${extOf(tm.avatarPendingFile.name)}`;
        await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
        tm.avatar = fileName; tm.avatarOriginalName = tm.avatarPendingFile.name; tm.avatarPendingFile = null;
        log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
      }
      for (const b of ar.blocks) {
        if (b.type === 'photo') {
          for (let i = 0; i < b.images.length; i++) {
            const img = b.images[i];
            if (!img.pendingFile) continue;
            log(tr('uploadingBlockPhoto', { id: b.id, n: i + 1 }));
            const bytes = new Uint8Array(await img.pendingFile.arrayBuffer());
            const fileName = `${myComposerId}/${b.id}-${i}.${extOf(img.pendingFile.name)}`;
            await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
            img.file = fileName; img.originalFileName = img.pendingFile.name; img.pendingFile = null;
            log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
          }
        }
        if (b.type === 'video') {
          for (let i = 0; i < b.videos.length; i++) {
            const v = b.videos[i];
            if (!v.pendingThumbnail) continue;
            log(tr('uploadingThumbnail', { id: b.id, n: i + 1 }));
            const bytes = new Uint8Array(await v.pendingThumbnail.arrayBuffer());
            const fileName = `${myComposerId}/${b.id}-thumb-${i}.${extOf(v.pendingThumbnail.name)}`;
            await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
            v.thumbnail = fileName; v.thumbnailOriginalName = v.pendingThumbnail.name; v.pendingThumbnail = null;
            log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
          }
        }
        // Image de fond par bloc (n'importe quel type de bloc, cf. décision "tous les blocs sans
        // exception") — le fichier en attente vit hors de b.appearance (propriété _pending_bgImage sur
        // le bloc lui-même), jamais lu par la sérialisation générique de appearance.
        if (b._pending_bgImage) {
          log(tr('uploadingBlockBgImage', { id: b.id }));
          const bytes = new Uint8Array(await b._pending_bgImage.arrayBuffer());
          const fileName = `${myComposerId}/${b.id}-bg.${extOf(b._pending_bgImage.name)}`;
          await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
          if (!b.appearance) b.appearance = {};
          b.appearance.bgImage = fileName; b._pending_bgImage = null;
          log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
        }
      }
    }
    for (const pack of packs) {
      if (!pack.pendingIllustration) continue;
      log(tr('uploadingPackIllustration', { title: pack.title }));
      const bytes = new Uint8Array(await pack.pendingIllustration.arrayBuffer());
      const fileName = `${myComposerId}/pack-${pack.id}.${extOf(pack.pendingIllustration.name)}`;
      await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
      pack.illustration = fileName; pack.illustrationOriginalName = pack.pendingIllustration.name; pack.pendingIllustration = null;
      log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
    }
    for (const pack of packs) {
      if (!pack.pendingWatermark) continue;
      log(tr('uploadingPackWatermark', { title: pack.title }));
      const bytes = new Uint8Array(await pack.pendingWatermark.arrayBuffer());
      const fileName = `${myComposerId}/pack-watermark-${pack.id}.${extOf(pack.pendingWatermark.name)}`;
      await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
      pack.watermark = fileName; pack.watermarkOriginalName = pack.pendingWatermark.name; pack.pendingWatermark = null;
      log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
    }
    for (const coll of collections) {
      if (!coll.pendingIllustration) continue;
      log(tr('uploadingCollectionIllustration', { title: coll.title }));
      const bytes = new Uint8Array(await coll.pendingIllustration.arrayBuffer());
      const fileName = `${myComposerId}/collection-${coll.id}.${extOf(coll.pendingIllustration.name)}`;
      await r2PutFile(`images/${fileName}`, bytes, imageContentType(extOf(fileName)));
      coll.illustration = fileName; coll.illustrationOriginalName = coll.pendingIllustration.name; coll.pendingIllustration = null;
      log(tr('uploadedImageGeneric', { file: fileName }), 'ok');
    }
    for (const font of customFonts) {
      if (!font.pendingFile) continue;
      log(tr('uploadingCustomFont', { name: font.name || font.id }));
      const bytes = new Uint8Array(await font.pendingFile.arrayBuffer());
      // Stockage média (R2) comme les images et l'audio, dans le dossier du compositeur (24/09 : avant, envoyé sur GitHub,
      // ce qui échouait pour tout compositeur sans dépôt GitHub). Chargé par public-page.js depuis media.layerpitch.com.
      const ext = extOf(font.pendingFile.name);
      const fileName = `${myComposerId}/${font.id}.${ext}`;
      await r2PutFile(`fonts/${fileName}`, bytes, { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }[ext] || 'application/octet-stream');
      font.remoteFile = fileName; font.originalFileName = font.pendingFile.name; font.pendingFile = null;
      log(tr('uploadedFontGeneric', { file: fileName }), 'ok');
    }
    for (const track of library) {
      if (!track.id) track.id = slug(track.title);
      track.base = `${MEDIA_BASE}audio/${track.id}/`;
      const isStatic = track.mode === 'static';
      const layersToPublish = isStatic ? (track.layers || []).slice(0, 1) : (track.layers || []);
      for (let li = 0; li < layersToPublish.length; li++) {
        const layer = layersToPublish[li];
        if (!layer.pendingFile) continue;
        log(tr('convertingGeneric', { title: track.title, label: layer.label || tr('trackFallbackShort') }));
        const { bytes, duration, gain } = await wavFileToOgg(layer.pendingFile);
        // Vertical/Statique (20/08, correctif) : durée stockée par couche puis recalculée depuis les
        // couches réellement présentes, plutôt qu'accumulée sans jamais redescendre -- voir
        // recomputeTrackDuration(). Les 3 autres modes gardent l'ancien comportement pour l'instant (portée
        // de ce correctif limitée au Vertical, décision du 20/08).
        if (isStatic || track.mode === 'vertical') { layer.duration = duration; recomputeTrackDuration(track); }
        else { track.duration = Math.max(track.duration, duration); }
        const fileName = `${li}-${slug(layer.label || 'piste')}.ogg`;
        const path = `audio/${track.id}/${fileName}`;
        log(tr('uploadingPath', { path }));
        await r2PutFile(path, bytes, 'audio/ogg');
        layer.remoteFile = fileName; layer.originalFileName = layer.pendingFile.name; layer.pendingFile = null; layer.gain = gain;
        log(tr('uploadedPath', { path }), 'ok');
      }
      if (track.intro && track.intro.pendingFile) {
        log(tr('convertingGeneric', { title: track.title, label: track.intro.label || 'Intro' }));
        const { bytes, duration, gain } = await wavFileToOgg(track.intro.pendingFile);
        track.duration = Math.max(track.duration, duration);
        const fileName = `intro-${slug(track.intro.label || 'intro')}.ogg`;
        const path = `audio/${track.id}/${fileName}`;
        log(tr('uploadingPath', { path }));
        await r2PutFile(path, bytes, 'audio/ogg');
        track.intro.remoteFile = fileName; track.intro.originalFileName = track.intro.pendingFile.name; track.intro.pendingFile = null; track.intro.gain = gain;
        log(tr('uploadedPath', { path }), 'ok');
      }
      if (track.outro && track.outro.pendingFile) {
        log(tr('convertingGeneric', { title: track.title, label: track.outro.label || 'Outro' }));
        const { bytes, duration, gain } = await wavFileToOgg(track.outro.pendingFile);
        track.duration = Math.max(track.duration, duration);
        const fileName = `outro-${slug(track.outro.label || 'outro')}.ogg`;
        const path = `audio/${track.id}/${fileName}`;
        log(tr('uploadingPath', { path }));
        await r2PutFile(path, bytes, 'audio/ogg');
        track.outro.remoteFile = fileName; track.outro.originalFileName = track.outro.pendingFile.name; track.outro.pendingFile = null; track.outro.gain = gain;
        log(tr('uploadedPath', { path }), 'ok');
      }
      for (let si = 0; si < (track.segmentSlots || []).length; si++) {
        const slot = track.segmentSlots[si];
        for (let ai = 0; ai < slot.alternatives.length; ai++) {
          const alt = slot.alternatives[ai];
          if (!alt.pendingFile) continue;
          log(tr('convertingGeneric', { title: track.title, label: tr('slotAltLabel', { si: si + 1, label: alt.label || tr('altFallbackShort') }) }));
          const { bytes, duration, gain } = await wavFileToOgg(alt.pendingFile);
          track.duration = Math.max(track.duration, duration);
          const fileName = `slot${si}-${ai}-${slug(alt.label || 'alt')}.ogg`;
          const path = `audio/${track.id}/${fileName}`;
          log(tr('uploadingPath', { path }));
          await r2PutFile(path, bytes, 'audio/ogg');
          alt.remoteFile = fileName; alt.originalFileName = alt.pendingFile.name; alt.pendingFile = null; alt.gain = gain;
          log(tr('uploadedPath', { path }), 'ok');
        }
        // Fichiers de transition (optionnels, un par embranchement précis — voir schéma validé le 02/08) :
        // même boucle d'upload que les alternatives ci-dessus, mais indexée par nextOptions[oi], pas
        // alternatives[ai].
        for (let oi = 0; oi < (slot.nextOptions || []).length; oi++) {
          const opt = slot.nextOptions[oi];
          if (!opt.transition || !opt.transition.pendingFile) continue;
          log(tr('convertingGeneric', { title: track.title, label: opt.transition.label || tr('transitionFallbackShort') }));
          const { bytes, duration, gain } = await wavFileToOgg(opt.transition.pendingFile);
          track.duration = Math.max(track.duration, duration);
          const fileName = `slot${si}-branch${oi}-transition-${slug(opt.transition.label || 'transition')}.ogg`;
          const path = `audio/${track.id}/${fileName}`;
          log(tr('uploadingPath', { path }));
          await r2PutFile(path, bytes, 'audio/ogg');
          opt.transition.remoteFile = fileName; opt.transition.originalFileName = opt.transition.pendingFile.name; opt.transition.pendingFile = null; opt.transition.gain = gain;
          log(tr('uploadedPath', { path }), 'ok');
        }
      }
      for (let sci = 0; sci < (track.sections || []).length; sci++) {
        const section = track.sections[sci];
        for (let pi = 0; pi < (section.pools || []).length; pi++) {
          const pool = section.pools[pi];
          for (let ai = 0; ai < pool.alternatives.length; ai++) {
            const alt = pool.alternatives[ai];
            if (!alt.pendingFile) continue;
            log(tr('convertingGeneric', { title: track.title, label: tr('vrsPoolAltLabel', { si: sci + 1, pool: pool.label || tr('untitledFallback'), label: alt.label || tr('altFallbackShort') }) }));
            const { bytes, duration, gain } = await wavFileToOgg(alt.pendingFile);
            track.duration = Math.max(track.duration, duration);
            const fileName = `section${sci}-pool${pi}-${ai}-${slug(alt.label || 'alt')}.ogg`;
            const path = `audio/${track.id}/${fileName}`;
            log(tr('uploadingPath', { path }));
            await r2PutFile(path, bytes, 'audio/ogg');
            alt.remoteFile = fileName; alt.originalFileName = alt.pendingFile.name; alt.pendingFile = null; alt.gain = gain;
            log(tr('uploadedPath', { path }), 'ok');
          }
        }
      }
      for (let li = 0; li < (track.loops || []).length; li++) {
        const loop = track.loops[li];
        if (loop.pendingFile) {
          log(tr('convertingGeneric', { title: track.title, label: loop.label || tr('embrLoopFallbackShort') }));
          const { bytes, duration, gain } = await wavFileToOgg(loop.pendingFile);
          // Durée stockée par boucle (24/08, même correctif que ci-dessus pour les couches du mode
          // Vertical) -- ce point de publication polluait encore track.duration à l'ancienne jusqu'ici.
          loop.duration = duration;
          const fileName = `loop${li}-${slug(loop.label || 'boucle')}.ogg`;
          const path = `audio/${track.id}/${fileName}`;
          log(tr('uploadingPath', { path }));
          await r2PutFile(path, bytes, 'audio/ogg');
          loop.remoteFile = fileName; loop.originalFileName = loop.pendingFile.name; loop.pendingFile = null; loop.gain = gain;
          log(tr('uploadedPath', { path }), 'ok');
        }
        // Fichier de transition optionnel (24/08) -- même schéma d'upload que les transitions du
        // séquentiel, une seule par boucle plutôt qu'une par embranchement (pas de notion d'"emplacement
        // source" ici, la transition joue simplement au moment de basculer VERS cette boucle).
        if (loop.transition && loop.transition.pendingFile) {
          log(tr('convertingGeneric', { title: track.title, label: loop.transition.label || tr('transitionFallbackShort') }));
          const { bytes: transBytes } = await wavFileToOgg(loop.transition.pendingFile);
          const transFileName = `loop${li}-transition-${slug(loop.transition.label || 'transition')}.ogg`;
          const transPath = `audio/${track.id}/${transFileName}`;
          log(tr('uploadingPath', { path: transPath }));
          await r2PutFile(transPath, transBytes, 'audio/ogg');
          loop.transition.remoteFile = transFileName; loop.transition.originalFileName = loop.transition.pendingFile.name; loop.transition.pendingFile = null;
          log(tr('uploadedPath', { path: transPath }), 'ok');
        }
      }
    }
    for (const sfx of sfxLibrary) {
      if (!sfx.id) sfx.id = genId();
      sfx.base = `${MEDIA_BASE}audio/sfx-${sfx.id}/`;
      for (let ai = 0; ai < (sfx.alternatives || []).length; ai++) {
        const alt = sfx.alternatives[ai];
        if (alt.pendingFile) {
          log(tr('convertingSfxAlt', { title: sfx.title, label: alt.label || tr('sfxAltFallbackShort', { n: ai + 1 }) }));
          const { bytes } = await wavFileToOgg(alt.pendingFile);
          const fileName = `${ai}-${slug(alt.label || 'variation')}.ogg`;
          const path = `audio/sfx-${sfx.id}/${fileName}`;
          log(tr('uploadingPath', { path }));
          await r2PutFile(path, bytes, 'audio/ogg');
          alt.remoteFile = fileName; alt.originalFileName = alt.pendingFile.name; alt.pendingFile = null;
          log(tr('uploadedPath', { path }), 'ok');
        }
      }
    }

    const data = buildDataSnapshot(effectivePlan, buildVersion);
    // Écriture en base : la seule source de vérité du site public. Si une écriture échoue, la publication s'arrête
    // là (l'exception remonte au catch de publishAll()) avec la liste des éléments en échec.
    log('Écriture en base : morceaux...');
    const pgErrors = [];
    for (const track of data.library) {
      const { ok, error } = await window.LayerPitchTracks.upsertTrack(track);
      if (!ok) pgErrors.push(`${track.title || track.id} : ${error}`);
    }
    if (pgErrors.length) {
      throw new Error('Écriture Postgres échouée pour ' + pgErrors.length + ' morceau(x) — publication arrêtée :\n' + pgErrors.join('\n'));
    }
    log(`Écriture en base : ${data.library.length} morceau(x) OK.`, 'ok');

    log('Écriture en base : packs...');
    const pgPackErrors = [];
    for (const pack of data.packs) {
      const { ok, error } = await window.LayerPitchPacks.upsertPack(pack);
      if (!ok) pgPackErrors.push(`${pack.title || pack.id} : ${error}`);
    }
    if (pgPackErrors.length) {
      throw new Error('Écriture Postgres échouée pour ' + pgPackErrors.length + ' pack(s) — publication arrêtée :\n' + pgPackErrors.join('\n'));
    }
    log(`Écriture en base : ${data.packs.length} pack(s) OK.`, 'ok');

    log('Écriture en base : AdReels...');
    const pgAdReelErrors = [];
    for (const adReel of data.adReels) {
      const { ok, error } = await window.LayerPitchAdReels.upsertAdReel(adReel);
      if (!ok) pgAdReelErrors.push(`${adReel.label || adReel.id} : ${error}`);
    }
    if (pgAdReelErrors.length) {
      throw new Error('Écriture Postgres échouée pour ' + pgAdReelErrors.length + ' AdReel(s) — publication arrêtée :\n' + pgAdReelErrors.join('\n'));
    }
    log(`Écriture en base : ${data.adReels.length} AdReel(s) OK.`, 'ok');

    log('Écriture en base : Sfx...');
    const pgSfxErrors = [];
    for (const sfx of data.sfxLibrary) {
      const { ok, error } = await window.LayerPitchSfx.upsertSfx(sfx);
      if (!ok) pgSfxErrors.push(`${sfx.title || sfx.id} : ${error}`);
    }
    if (pgSfxErrors.length) {
      throw new Error('Écriture Postgres échouée pour ' + pgSfxErrors.length + ' Sfx — publication arrêtée :\n' + pgSfxErrors.join('\n'));
    }
    log(`Écriture en base : ${data.sfxLibrary.length} Sfx OK.`, 'ok');

    log('Écriture en base : collections...');
    const pgCollectionErrors = [];
    for (const collection of data.collections) {
      const { ok, error } = await window.LayerPitchCollections.upsertCollection(collection);
      if (!ok) pgCollectionErrors.push(`${collection.title || collection.id} : ${error}`);
    }
    if (pgCollectionErrors.length) {
      throw new Error('Écriture Postgres échouée pour ' + pgCollectionErrors.length + ' collection(s) — publication arrêtée :\n' + pgCollectionErrors.join('\n'));
    }
    log(`Écriture en base : ${data.collections.length} collection(s) OK.`, 'ok');

    // Après les écritures (les collections/packs mis à jour ne référencent déjà plus ce qui est supprimé ici).
    log(tr('deletingRemovedItems'));
    const { deleted: deletedCount, blocked: blockedDeletes, retired: retiredDeletes } = await deleteRemovedCatalogItems();
    blockedDeletes.forEach(msg => log(msg, 'warn'));
    retiredDeletes.forEach(msg => log(msg, 'info'));
    log(tr('deletedRemovedItems', { n: deletedCount }), 'ok');

    log('Écriture en base : réglages...');
    const settingsRes = await window.LayerPitchSettings.upsertSettings({
      publishedAt: data.publishedAt, implementationSkills: data.implementationSkills,
      noAiCertifiedGlobal: data.noAiCertifiedGlobal, customFonts: data.customFonts,
      waveformStyle: data.waveformStyle, seqMapTheme: data.seqMapTheme,
      allowEmbedding: data.allowEmbedding, sharePreview: data.sharePreview,
    });
    if (!settingsRes.ok) {
      throw new Error('Écriture Postgres échouée pour les réglages — publication arrêtée :\n' + settingsRes.error);
    }
    const socialsRes = await window.LayerPitchSettings.upsertSocials({ socials: data.socials });
    if (!socialsRes.ok) {
      throw new Error('Écriture Postgres échouée pour les réseaux sociaux — publication arrêtée :\n' + socialsRes.error);
    }
    log('Écriture en base : réglages et réseaux sociaux OK.', 'ok');

    log(tr('publicationComplete'), 'ok');
    trackBackstageEvent('publish_success', {});
    hasUnsavedEdits = false;
    clearDraft(); // tout est publié : le brouillon ne sert plus
    rememberPublishedCatalog();
    renderLibrary();
    renderSfxLibrary();
    renderSocials();
    rebuildAllCards();
    renderPacks();
    // Élément déjà acheté, refusé par la base : il est toujours en ligne -- rechargement pour qu'il réapparaisse ici
    // plutôt que de rester invisible dans le Backstage tout en existant (tout le reste vient d'être publié).
    if (retiredDeletes.length) window.LayerPitchNotify.info(tr('deleteRetiredAlert', { list: retiredDeletes.join('\n') }));
    if (blockedDeletes.length) {
      window.LayerPitchNotify.error(tr('deleteBlockedAlert', { list: blockedDeletes.join('\n') }));
      await loadData(true);
    }
  } catch (err) {
    log(tr('errorPrefix', { message: err.message }), 'err');
  } finally {
    document.getElementById('btnPublish').disabled = false;
  }
}

// Retour sur l'onglet précédent après un rafraîchissement (sauf si l'adresse en demande un : ?tab=...).
if (!new URLSearchParams(location.search).get('tab')) restoreBackstageTab();
