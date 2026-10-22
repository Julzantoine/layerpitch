// api/demo-client.js — LayerPitch, faux serveur local du MODE TUTORIEL (layerpitch-backstage.html?tuto)
//
// Faux client Supabase qui vit uniquement dans la page (window.LayerPitchDemoClient).
// Tous les api/*.js passent par window.LayerPitchSupabaseClient.getClient() (voir api/supabase-client.js), donc ils
// marchent sans aucune modification, mais ne parlent plus à aucun serveur :
//   - compte fictif « Compositeur de démonstration », connecté d'office (aucune vraie session n'est lue ni modifiée) ;
//   - bibliothèque d'exemple vide au départ (l'apprenant dépose ses fichiers dans les leçons) ;
//   - toutes les écritures (rpc, insert, upsert…) sont acceptées puis JETÉES : rien n'est enregistré, rien n'est
//     partagé, tout est remis à zéro au prochain chargement de la page ;
//   - les fonctions serveur (envoi de fichiers, aperçus de liens, invitations…) répondent « indisponible en mode
//     tutoriel » ; les appelants affichent déjà leurs erreurs.
// Chargé par loadPostgresReadScripts() (src/backstage/13-suivi-d-usage.js) uniquement quand l'adresse contient ?tuto.

(function () {
  const DEMO_USER = { id: 'demo-user', email: 'demo@layerpitch.com', user_metadata: {}, app_metadata: {} };
  const DEMO_SESSION = { access_token: 'demo', refresh_token: 'demo', expires_in: 86400, token_type: 'bearer', user: DEMO_USER };
  const DEMO_COMPOSER_ID = 'demo-composer';

  // Feux verts ouverts dans le tutoriel : ce dont les leçons ont besoin, rien d'autre (les nouveautés restent fermées).
  const DEMO_FLAGS = ['in_app_lessons', 'audio_fx', 'bulk_drop', 'alt_drag_delete'];
  // Droits de la matrice : tout ce qui touche à la vente ou au compte payant reste fermé.
  const DEMO_ENTITLEMENTS_ALLOWED = ['versioning'];
  const DEMO_ENTITLEMENTS_DENIED = ['custom_address', 'private_links', 'sell_albums', 'sell_packs', 'subscriber_catalog'];

  // Sur les pages Projets (liste et espace), le compte fictif peut créer des Projets ; ailleurs (Backstage), la fonction reste fermée.
  const onProjectPage = () => !!(window.location && /\/projets?\.html$/.test(window.location.pathname));
  const RPC_ANSWERS = {
    is_admin: () => false,
    my_feature_flags: () => DEMO_FLAGS.concat(onProjectPage() ? ['projects'] : [], (lessonParam() === 'adreel' || isVersioning()) ? ['video_upload', 'versioning'] : []).map(key => ({ key, allowed: true })),
    my_entitlements: () => DEMO_ENTITLEMENTS_ALLOWED.concat(onProjectPage() ? ['projects'] : [], isVersioning() ? ['test_in_game', 'no_watermark'] : []).map(f => ({ feature: f, allowed: true, amount: f === 'projects' ? 5 : null, level: (f === 'versioning' && (lessonParam() === 'adreel' || isVersioning())) || f === 'test_in_game' ? 'saved' : 'pro', plan: 'pro', source: 'demo' }))
      .concat(DEMO_ENTITLEMENTS_DENIED.map(f => ({ feature: f, allowed: false, amount: null, level: null, plan: 'pro', source: 'demo' }))),
    get_trial_status: () => [{ plan: 'pro', trial_ends_at: null, real_plan: 'pro', preview_active: false }],
    my_billing: () => ({}),
    my_admin_preview: () => null,
    ensure_composer_profile: () => DEMO_COMPOSER_ID,
    my_studio: () => null,
    list_my_videos: () => (aloneMontageShown()
      ? { videos: ALONE_VIDEOS.map(v => ({ id: v.id, title: v.title, base: TUTO_BASE, file: v.file, originalName: v.file, sizeBytes: 0, durationSec: 30 })), interrupted: [], quotaGb: null, usedBytes: 0 }
      : { videos: [], interrupted: [], quotaGb: null, usedBytes: 0 }),
    list_my_video_captures: a => (aloneMontageShown() ? [ALONE_CAPTURE] : [...CAPTURES.values()].filter(c => !a || !a.p_pack_id || c.packId === a.p_pack_id)),
    // Musique 1 = l'export direct du montage (ALONE_CAPTURE.lastExportVideoId) ; musique 2 = une version vidéo du montage.
    list_video_capture_versions: a => (aloneMontageShown() ? [{ id: 'ver-2', captureId: ALONE_CAPTURE.id, title: ALONE_VIDEOS[1].versionTitle, lastExportVideoId: ALONE_VIDEOS[1].id }] : [...VERSIONS.values()].filter(v => a && v.captureId === a.p_capture_id)),
    account_deletion_status: () => null,
    // Leçon « Versioning vidéo » (atelier vidéo, atelier.html?tuto&lesson=versioning) : montages et versions gardés EN MÉMOIRE (perdus
    // au rechargement), le compte fictif est le compositeur du pack d'exemple.
    resolve_composer_handle: () => DEMO_COMPOSER_ID,
    team_owns_pack: () => false,
    save_video_capture: a => { CAPTURES.set(a.p_id, { id: a.p_id, packId: a.p_pack_id, title: a.p_title || '', videoFilename: a.p_video_filename || null, events: a.p_events || [], laneOverrides: a.p_lane_overrides || {}, collapsedGroups: a.p_collapsed_groups || {}, lastExportVideoId: null, baseVideoId: null, createdAt: (CAPTURES.get(a.p_id) || {}).createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }); return { ok: true, id: a.p_id, updatedAt: new Date().toISOString() }; },
    get_video_capture: a => CAPTURES.get(a.p_id) || null,
    delete_video_capture: a => { CAPTURES.delete(a.p_id); return null; },
    save_video_capture_version: a => { VERSIONS.set(a.p_id, { id: a.p_id, captureId: a.p_capture_id, title: a.p_title || '', substitutions: a.p_substitutions || {}, lastExportVideoId: null, createdAt: (VERSIONS.get(a.p_id) || {}).createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }); return { ok: true, id: a.p_id }; },
    delete_video_capture_version: a => { VERSIONS.delete(a.p_id); return null; },
    set_video_capture_export: () => ({ removed: [] }),
    set_video_capture_version_export: () => ({ removed: [] }),
    video_capture_base: () => null,
    // Lecteur à versions (AdReel, espace Projet) : le montage d'« Alone », deux exports complets (musique 1, musique 2).
    get_public_video_montage: a => (a.p_capture_id === ALONE_CAPTURE.id ? { id: ALONE_CAPTURE.id, title: ALONE_CAPTURE.title, baseUrl: null, versions: [
      { key: 'original', title: null, url: TUTO_BASE + ALONE_VIDEOS[0].file, kind: 'video', cues: [] },
      { key: 'ver-2', title: ALONE_VIDEOS[1].versionTitle, url: TUTO_BASE + ALONE_VIDEOS[1].file, kind: 'video', cues: [] }] } : null),
    list_video_export_history: () => [],
  };
  const CAPTURES = new Map(), VERSIONS = new Map();
  const isVersioning = () => lessonParam() === 'versioning';
  const onAtelierPage = () => !!(window.location && /\/atelier\.html$/.test(window.location.pathname));
  // Montage d'exemple d'« Alone » déjà publié en deux musiques : leçon AdReel, et partie « bloc vidéo » de la leçon Versioning (Backstage).
  // Dans l'atelier, la leçon Versioning part de zéro (montages gardés en mémoire ci-dessus).
  const aloneMontageShown = () => lessonParam() === 'adreel' || (isVersioning() && !onAtelierPage());
  // Lignes lues « en direct » sur une table (select().maybeSingle()). Toute autre table : liste vide / null.
  const TABLE_ROWS = {
    composer_profiles: { id: DEMO_COMPOSER_ID, handle: 'demo' },
    profiles: { onboarding_completed: true },
  };

  // Bibliothèque d'exemple de la leçon AdReel (?tuto&lesson=adreel) : trois morceaux déjà publiés, lus depuis le stockage public des
  // fichiers d'essai (media.layerpitch.com/tuto/). Les autres leçons partent d'une bibliothèque vide.
  // PROVISOIRE : les morceaux d'essai des leçons ; à remplacer par les morceaux finaux de Jules-Antoine (voir DEMO_TRACKS).
  const TUTO_BASE = 'https://media.layerpitch.com/tuto/';
  const DEMO_TRACKS = [
    ['t-ponton', 'Alone : le ponton (exemple)', '1_RobotAdventure_WetDarkCave_120bpm_30M.wav', 60],
    ['t-lac', 'Alone : le lac ouvert (exemple)', '1_Everything_is_fine_120bpm_18M_intro2M.wav.wav', 36],
    ['t-brouillard', 'Alone : le brouillard (exemple)', '1_BattleLoop_LowIntensity_120bpm_64M.wav', 128],
  ].map(([id, title, file, duration]) => ({ id, owner_id: 'demo-composer', folder_id: null, title, description: '', mode: 'static', loopable: true, loop_engine: 'simple',
    bpm: 120, beats_per_bar: 4, duration, base: TUTO_BASE, layers: [{ label: 'Boucle', file, originalFileName: file, gain: 1, duration }], intro: null, outro: null,
    loops: null, sections: null, segment_slots: [], track_sfx: [], tags: [], fx: null, fx_triggers: [], fx_sliders: [], protected: false, retired_at: null }));
  // Leçons Sfx et événements d'effets (?tuto&lesson=sfx / events) : le morceau « Jazz Lo Static » (statique, boucle quantifiée de la mesure 1 temps 3 à la fin de la mesure 9) déjà dans la
  // bibliothèque, pour y ajouter les Sfx créés pendant la leçon. Fichier dans media.layerpitch.com/tuto/Jazz Lo/.
  const DEMO_TRACK_JAZZ_SFX = { id: 't-jazz-lo', owner_id: 'demo-composer', folder_id: null, title: 'Jazz Lo Static', description: '', mode: 'static', loopable: true, loop_engine: 'quantized',
    bpm: 110, beats_per_bar: 4, loop_in_beat: 2, loop_out_beat: 34, duration: 20.48, base: TUTO_BASE + 'Jazz%20Lo/', layers: [{ label: 'Jazz Lo', file: 'Jazz Lo_2bts Intro_8M_110bpm.wav', originalFileName: 'Jazz Lo_2bts Intro_8M_110bpm.wav', gain: 1, duration: 20.48 }],
    intro: null, outro: null, loops: null, sections: null, segment_slots: [], track_sfx: [], tags: [], fx: null, fx_triggers: [], fx_sliders: [], protected: false, retired_at: null };
  // Pack de la bibliothèque du compositeur fictif (leçon « La musique du projet » : on le partage au Projet).
  const DEMO_PACKS = [{ id: 'p-alone', owner_id: 'demo-composer', title: 'Alone : ambiances du lac (exemple)', illustration: null, illustration_original_name: null, watermark: null,
    watermark_original_name: null, presentation_fr: '', presentation_en: '', buyable: false, buy_url: null, free_download_enabled: false, video_test_mode_enabled: false,
    bg_color: null, text_color: null, font: null, linked_ad_reel_id: null, tags: [], price_eur_cents: null, subscriber_credits: null, catalog_listed: true,
    pack_tracks: DEMO_TRACKS.map((t, i) => ({ track_id: t.id, position: i })), pack_sfx: [] }];
  // Leçon AdReel : la vidéo de gameplay d'« Alone in the Barque » en DEUX versions vidéo (même montage, deux musiques), dans la bibliothèque
  // vidéo du compte fictif. Le bloc vidéo propose alors de choisir la version affichée. FICHIERS À DÉPOSER par Jules-Antoine dans
  // media.layerpitch.com/tuto/ sous ces noms (tant qu'ils manquent, la vidéo ne se lit pas, la leçon se déroule quand même).
  const ALONE_VIDEOS = [
    { id: 'vid-alone-1', title: 'Alone in the Barque : gameplay, musique 1', file: 'alone-gameplay-musique1.mp4', versionTitle: 'Musique 1 : boucle d’origine' },
    { id: 'vid-alone-2', title: 'Alone in the Barque : gameplay, musique 2', file: 'alone-gameplay-musique2.mp4', versionTitle: 'Musique 2 : couches selon la menace' },
  ];
  const ALONE_CAPTURE = { id: 'cap-alone', packId: 'p-alone', title: 'Alone in the Barque : traversée', videoFilename: 'alone-gameplay-muette.mp4', lastExportVideoId: 'vid-alone-1', createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z' };
  const lessonParam = () => { try { return new URLSearchParams(window.location.search).get('lesson'); } catch (e) { return null; } };
  // Morceaux d'exemple : leçon AdReel (Backstage) et pages Projets (leur propre bibliothèque, pour le pack et la carte). Pack : pages Projets.
  const listRows = table => {
    const projectPage = !!(window.location && /\/projets?\.html$/.test(window.location.pathname));
    if (table === 'tracks' && (lessonParam() === 'adreel' || projectPage)) return DEMO_TRACKS;
    if (table === 'tracks' && (lessonParam() === 'sfx' || lessonParam() === 'events')) return [DEMO_TRACK_JAZZ_SFX];
    if (table === 'packs' && projectPage) return DEMO_PACKS;
    // Atelier vidéo (21/10 : l'outil de capture a quitté la page du pack pour l'atelier, ouvert dans le Backstage).
    const packPage = onAtelierPage();
    if (packPage && isVersioning() && table === 'tracks') return DEMO_TRACKS;
    if (packPage && isVersioning() && table === 'packs') return DEMO_PACKS.map(p => Object.assign({}, p, { video_test_mode_enabled: true }));
    return null;
  };

  const OK = (data) => ({ data: data === undefined ? null : data, error: null });
  const UNAVAILABLE = { message: 'Indisponible en mode tutoriel : rien n\'est enregistré.' };

  // Requête chaînable (select/eq/order…) qui se résout au « await » : la liste de la table, ou la ligne unique demandée.
  function makeQuery(table, isWrite, payload) {
    let single = false;
    const q = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const row = TABLE_ROWS[table];
          let result;
          if (isWrite) result = OK(single ? (payload || null) : null);
          else if (single) result = OK(row || null);
          else result = OK(listRows(table) || (row ? [row] : []));
          return (res, rej) => Promise.resolve(result).then(res, rej);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return q; };
        return () => q; // select, eq, in, order, limit, filter… : on ignore, la réponse est de toute façon locale
      },
    });
    return q;
  }

  const listeners = [];
  const auth = {
    getSession: async () => OK({ session: DEMO_SESSION }),
    getUser: async () => OK({ user: DEMO_USER }),
    onAuthStateChange(cb) {
      listeners.push(cb);
      setTimeout(() => { try { cb('INITIAL_SESSION', DEMO_SESSION); } catch (e) { console.warn(e); } }, 0);
      return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
    },
    // Quitter le tutoriel = retour au vrai Backstage (la page de démonstration n'a pas de vraie session à fermer).
    signOut: async () => { window.location.href = window.location.pathname; return { error: null }; },
    signInWithOtp: async () => ({ data: null, error: UNAVAILABLE }),
    verifyOtp: async () => ({ data: null, error: UNAVAILABLE }),
  };

  const demoClient = {
    auth,
    from: (table) => ({
      select: () => makeQuery(table, false),
      insert: (p) => makeQuery(table, true, p),
      upsert: (p) => makeQuery(table, true, p),
      update: (p) => makeQuery(table, true, p),
      delete: () => makeQuery(table, true),
    }),
    rpc: async (name, args) => {
      const answer = RPC_ANSWERS[name];
      return OK(answer ? answer(args || {}) : null);
    },
    // Temps réel (présence, « ça a changé ») : rien à écouter dans un tutoriel à un seul utilisateur.
    channel: () => { const c = { on: () => c, subscribe: () => c, track: () => c, send: () => c, presenceState: () => ({}), unsubscribe() {} }; return c; },
    removeChannel: () => {},
    functions: { invoke: async () => ({ data: null, error: UNAVAILABLE }) },
    storage: { from: () => ({ upload: async () => ({ data: null, error: UNAVAILABLE }), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => OK(null) }) },
  };

  // loadPostgresReadScripts() met ensuite ce client à la place du vrai (window.LayerPitchSupabaseClient.getClient).
  window.LayerPitchDemoClient = demoClient;
})();
