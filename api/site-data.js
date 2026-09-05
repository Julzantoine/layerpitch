// api/site-data.js — LayerPitch, assemblage en lecture seule d'un objet strictement au format
// data.json à partir de Postgres (Décision 5, étape "site public → Postgres", docs/infrastructure.md).
//
// Objectif de ce fichier : permettre à index.html/pack.html/collection.html ET à
// layerpitch-backstage.html (Session B, lecture avant écriture) de charger depuis Postgres
// exactement ce qu'ils chargent aujourd'hui depuis data.json, sans qu'aucun code de rendu n'ait
// besoin de savoir d'où viennent les données.
//
// libraryFolders/sfxFolders/adReelFolders INCLUSES depuis le 1er septembre (absentes à l'origine,
// "non utilisées par le rendu public" — vrai pour index.html/pack.html/collection.html, mais faux
// pour le backstage : son garde-fou existant réinitialise à null tout folderId ne correspondant à
// aucun dossier connu, donc une liste absente y était interprétée comme "tous les dossiers
// supprimés" plutôt que "non demandée" — bug trouvé au premier test réel du backstage sur Postgres,
// voir docs/LAYERPITCH_CHANGELOG.md). Coût nul pour les pages publiques, qui ne lisent jamais ces
// champs.
//
// Nécessite api/tracks.js, api/packs.js, api/collections.js, api/sfx.js, api/settings.js,
// api/adreels.js déjà chargés (voir loadPostgresReadScripts()).
//
// `ownerId` OBLIGATOIRE depuis le 1er septembre (isolation multi-compositeur, préparation de
// l'authentification des testeurs bêta) — sans ce filtre, chaque appel renvoyait le catalogue de
// TOUS les compositeurs mélangés (bibliothèque, packs, AdReels...), sans aucune distinction
// possible entre comptes. Trouvé avant tout incident réel (un seul compositeur existait encore à
// ce moment), mais bloquant dès qu'un second compte a du vrai contenu. Voir docs/LAYERPITCH_CHANGELOG.md.
//
// `settings`/`socials` personnels par compositeur depuis le 1er septembre (n'étaient au départ que
// des tables singleton globales, corrigé une fois la lacune confirmée par Jules-Antoine — voir
// api/settings.js et supabase/migrations/20260901170000_settings_socials_per_composer.sql).
(function () {
  async function loadSiteDataFromPostgres(ownerId) {
    if (!ownerId) throw new Error('loadSiteDataFromPostgres() : ownerId obligatoire (isolation multi-compositeur).');
    const [tracksRes, packsRes, collectionsRes, sfxRes, settingsRes, socialsRes, adReelsRes,
           trackFoldersRes, sfxFoldersRes, adReelFoldersRes] = await Promise.all([
      window.LayerPitchTracks.listTracks({ ownerId }),
      window.LayerPitchPacks.listPacks({ ownerId }),
      window.LayerPitchCollections.listCollections({ ownerId }),
      window.LayerPitchSfx.listSfx({ ownerId }),
      window.LayerPitchSettings.getSettings(ownerId),
      window.LayerPitchSettings.listSocials(ownerId),
      window.LayerPitchAdReels.listAdReels({ ownerId }),
      window.LayerPitchTracks.listTrackFolders({ ownerId }),
      window.LayerPitchSfx.listSfxFolders({ ownerId }),
      window.LayerPitchAdReels.listAdReelFolders({ ownerId }),
    ]);
    const firstError = [tracksRes, packsRes, collectionsRes, sfxRes, settingsRes, socialsRes, adReelsRes,
      trackFoldersRes, sfxFoldersRes, adReelFoldersRes].map(r => r.error).find(Boolean);
    if (firstError) throw new Error('Lecture Postgres échouée : ' + firstError);

    const settings = settingsRes.settings || {};
    return {
      publishedAt: settings.publishedAt != null ? settings.publishedAt : null,
      library: tracksRes.tracks,
      libraryFolders: trackFoldersRes.folders,
      sfxLibrary: sfxRes.sfx,
      sfxFolders: sfxFoldersRes.folders,
      socials: socialsRes.socials,
      packs: packsRes.packs,
      implementationSkills: settings.implementationSkills || { wwise: false, fmod: false, unity: false, unreal: false },
      noAiCertifiedGlobal: !!settings.noAiCertifiedGlobal,
      collections: collectionsRes.collections,
      customFonts: settings.customFonts || [],
      waveformStyle: settings.waveformStyle || 'bars',
      adReels: adReelsRes.adReels,
      adReelFolders: adReelFoldersRes.folders,
    };
  }

  window.LayerPitchSiteData = { loadSiteDataFromPostgres };
})();
