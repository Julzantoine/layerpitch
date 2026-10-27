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
  const DEMO_USER = { id: 'demo-user', email: 'daniel@orcman-music.example', user_metadata: {}, app_metadata: {} };
  const DEMO_SESSION = { access_token: 'demo', refresh_token: 'demo', expires_in: 86400, token_type: 'bearer', user: DEMO_USER };
  const DEMO_COMPOSER_ID = 'demo-composer';

  // Feux verts ouverts dans le tutoriel : ce dont les leçons ont besoin, rien d'autre (les nouveautés restent fermées).
  const DEMO_FLAGS = ['in_app_lessons', 'audio_fx', 'bulk_drop', 'alt_drag_delete', 'quick_search'];
  // Droits de la matrice : tout ce qui touche à la vente ou au compte payant reste fermé.
  const DEMO_ENTITLEMENTS_ALLOWED = ['versioning'];
  const DEMO_ENTITLEMENTS_DENIED = ['custom_address', 'private_links', 'sell_albums', 'sell_packs', 'subscriber_catalog'];

  // Sur les pages Projets (liste et espace), le compte fictif peut créer des Projets ; ailleurs (Backstage), la fonction reste fermée.
  const onProjectPage = () => !!(window.location && /\/projets?\.html$/.test(window.location.pathname));
  // Leçon « Vérifier le tracking » (25/10, ?tuto&lesson=tracking) : tableau de bord Analytics PRO déjà garni, sur sept jours (chiffres inventés, jamais envoyés nulle part).
  // Même forme que les réponses de get_my_analytics_overview / get_my_analytics_entity (voir api/analytics.js et renderAnalyticsView).
  const analyticsDemo = (() => {
    const DAY = 86400000;
    const buckets = () => { const end = new Date(); end.setHours(0, 0, 0, 0); return [6, 5, 4, 3, 2, 1, 0].map(i => new Date(end.getTime() - i * DAY).toISOString()); };
    const ENTITIES = [
      { type: 'adreel', id: 'main', name: 'Principal (main)', visits: 38, plays: 112, series: [2, 3, 4, 5, 8, 7, 9], mobile: 14, desktop: 24 },
      { type: 'adreel', id: 'music-city', name: 'Music City : pitch musical', visits: 14, plays: 57, series: [0, 0, 1, 1, 6, 3, 3], mobile: 3, desktop: 11 },
      { type: 'pack', id: 'p-cities', name: 'Music City : les quatre villes', visits: 9, plays: 31, series: [0, 1, 1, 2, 1, 2, 2], mobile: 4, desktop: 5 },
    ];
    const overview = () => ({ ok: true, tier: 'pro', locked: false, windowStart: buckets()[0], windowEnd: buckets()[6], retentionDays: 365, bucket: 'day', buckets: buckets(),
      totals: { visits: 61, plays: 200, mobileShare: 31, items: ENTITIES.length },
      series: { visits: [2, 4, 6, 8, 15, 12, 14], plays: [4, 9, 14, 20, 62, 41, 50] },
      entities: ENTITIES.map(e => ({ type: e.type, id: e.id, name: e.name, visits: e.visits, plays: e.plays, series: e.series, lastVisit: new Date(Date.now() - 3 * 3600000).toISOString() })) });
    const entity = (a) => {
      const e = ENTITIES.find(x => x.id === a.p_id) || ENTITIES[0];
      return { ok: true, tier: 'pro', entity: { type: e.type, id: e.id, name: e.name }, bucket: 'day', buckets: buckets(),
        totals: { visits: e.visits, plays: e.plays, mobile: e.mobile, desktop: e.desktop, unknownDevice: 0 },
        series: { visits: e.series, plays: e.series.map(v => v * 3) },
        tracks: [['Jazz Hi Lay. Add.', 0.46, 0.74, 0.08], ['Jazz Hi-Lo Vert. Branch.', 0.27, 0.58, 0.19], ['Jazz Hi Seq. Branch.', 0.17, 0.64, 0.12], ['Jazz Lo Vert. Rand.', 0.10, 0.4, 0.3]]
          .map(([title, share, end, skip]) => { const plays = Math.round(e.plays * share); return { title, plays, reachedEnd: Math.round(plays * end), skipped: Math.round(plays * skip) }; }),
        interactions: [{ name: 'voice_volume_change', count: 18 }, { name: 'seq_branch_select', count: 11 }, { name: 'pool_refresh', count: 7 }],
        fxButtons: [],
        recentSessions: [3, 26, 50].map((h, i) => ({ openedAt: new Date(Date.now() - h * 3600000).toISOString(), device: i === 1 ? 'Mobile' : 'Ordinateur', plays: [6, 2, 9][i] })) };
    };
    return { overview, entity };
  })();
  const demoOfficialTakes = {};
  const RPC_ANSWERS = {
    // Page « Mon compte » du compte fictif (annuaire des compositeurs : visible d'office, mots-clés d'exemple).
    get_my_notification_prefs: () => [{ email_announcements: true, lang: 'fr' }],
    get_my_directory: () => ({ optIn: true, keywords: ['jazz', 'musique interactive', 'RPG', 'adaptatif'], photo: null }),
    directory_status: () => ({ open: true }),
    set_ad_reel_access: a => ({ mode: a.p_mode, token: a.p_mode === 'magic' ? 'tutoriel-lien-magique' : null }), // accès privé simulé (leçon « Diffuser »)
    // Version officielle d'un morceau d'album (leçon « Créer un album », 26/10) : gardée en mémoire le temps de la page, pour que « Écouter »
    // rejoue la version que l'apprenant vient de valider. Rien n'est enregistré.
    set_album_track_default_settings: a => { demoOfficialTakes[a.p_album_id + '|' + a.p_track_id] = a.p_settings; return null; },
    list_album_rights: () => lessonParam() === 'album' ? { declaration: 'sole', ackAt: null, settled: false, sellerShareBps: 10000, holders: [] } : null,
    get_my_analytics_overview: (a) => lessonParam() === 'tracking' ? analyticsDemo.overview(a) : null,
    get_my_analytics_entity: (a) => lessonParam() === 'tracking' ? analyticsDemo.entity(a) : null,
    is_admin: () => false,
    my_feature_flags: () => DEMO_FLAGS.concat(onProjectPage() || /^pj-/.test(lessonParam() || '') ? ['projects'] : [], (lessonParam() === 'adreel' || lessonParam() === 'upload' || isVersioning()) ? ['video_upload', 'versioning'] : []).map(key => ({ key, allowed: true })),
    my_entitlements: () => DEMO_ENTITLEMENTS_ALLOWED.concat(['album', 'upload'].includes(lessonParam()) ? ['sell_albums'] : [], lessonParam() === 'share' ? ['custom_address', 'private_links'] : [], onProjectPage() ? ['projects'] : [], isVersioning() ? ['test_in_game', 'no_watermark'] : []).map(f => ({ feature: f, allowed: true, amount: f === 'projects' ? 5 : null, level: (f === 'versioning' && (lessonParam() === 'adreel' || lessonParam() === 'upload' || isVersioning())) || f === 'test_in_game' ? 'saved' : 'pro', plan: 'pro', source: 'demo' }))
      .concat(DEMO_ENTITLEMENTS_DENIED.filter(f => !((['album', 'upload'].includes(lessonParam()) && f === 'sell_albums') || (lessonParam() === 'share' && (f === 'custom_address' || f === 'private_links')))).map(f => ({ feature: f, allowed: false, amount: null, level: null, plan: 'pro', source: 'demo' }))),
    get_trial_status: () => [{ plan: 'pro', trial_ends_at: null, real_plan: 'pro', preview_active: false }],
    my_billing: () => ({}),
    my_admin_preview: () => null,
    ensure_composer_profile: () => DEMO_COMPOSER_ID,
    my_studio: () => null,
    // Vidéos « envoyées » pendant la leçon d'envoi de fichiers (envoi simulé, gardé en mémoire le temps de la page) + montage d'exemple d'« Alone ».
    list_my_videos: () => ({ videos: (aloneMontageShown() ? ALONE_VIDEOS.map(v => ({ id: v.id, title: v.title, base: TUTO_BASE, file: v.file, originalName: v.file, sizeBytes: 0, durationSec: 30 })) : []).concat(UPLOADED_VIDEOS),
      interrupted: [], quotaGb: null, usedBytes: 0 }),
    upsert_video: a => { const p = (a && a.payload) || {}; UPLOADED_VIDEOS.push({ id: p.id, title: p.title, base: p.base, file: p.file, originalName: p.originalName, kind: 'upload', sizeBytes: p.sizeBytes || 0, durationSeconds: p.durationSeconds || 0, durationSec: p.durationSeconds || 0, updatedAt: new Date().toISOString() }); return null; },
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
  const CAPTURES = new Map(), VERSIONS = new Map(), UPLOADED_VIDEOS = [];
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
  // Les trois Sfx de la leçon Sfx, déjà dans la bibliothèque et dans le morceau pendant la leçon « événements d'effets » (22/10) : on les déclenche par-dessus
  // l'ambiance « groupe dans un coin » pour un vrai bar. Réglages relevés dans le Backstage de Jules-Antoine ; fichiers dans media.layerpitch.com/tuto/SFX/.
  const SFX_BASE = TUTO_BASE + 'SFX/';
  const sfxRow = (id, title, files, spatial) => ({ id, owner_id: 'demo-composer', folder_id: null, title, description_fr: '', description_en: '', rr_mode: 'random', duck_main_track: false,
    base: SFX_BASE, alternatives: files.map(f => ({ file: f, label: f.replace(/\.wav$/, ''), originalFileName: f })), spatial, tag: '', retired_at: null, protected: false });
  const SFX_SPACE = (x, y, mode, points, binaural, durationSec) => ({ x, y, room: 'room', enabled: true, binaural, path: { loop: 'loop', mode, points, durationSec: durationSec || null } });
  const DEMO_SFX = [
    sfxRow('sfx-glacons', 'Glaçons', ['Glaçons 1.wav', 'Glaçons 2.wav', 'Glaçons 3.wav'], SFX_SPACE(1.4, -0.5, 'steps', [{ x: 1.4, y: -0.5 }, { x: -1.4, y: -0.5 }, { x: 1.2, y: 0.7 }, { x: -1, y: 1.4 }, { x: -2, y: -0.1 }, { x: -0.5, y: -1.6 }], false)),
    sfxRow('sfx-verre', 'Se Remplir un Verre', ['Verre 1.wav', 'Verre 2.wav'], SFX_SPACE(1.4, 0.6, 'steps', [{ x: 1.4, y: 0.6 }, { x: -1.4, y: 0.6 }, { x: 1.1, y: -0.7 }, { x: 0.3, y: -1.7 }, { x: -1.9, y: -1.4 }], true)),
    sfxRow('sfx-bar', 'Se balader dans le Bar', ['Ambiance Bar.wav'], SFX_SPACE(1.5, 0.4, 'glide', [{ x: 1.5, y: 0.4 }, { x: -1.7, y: 1.3 }, { x: -1.9, y: -1.2 }, { x: 1.9, y: -1.4 }, { x: 2, y: 1.4 }, { x: -0.9, y: 0.3 }], true, 20)),
  ];
  // Morceaux INTERACTIFS de la série AdReels (25/10) : quatre morceaux de la série « Jazz Hi/Lo » de Jules-Antoine (110 bpm), lignes copiées de sa base (lecture seule) ;
  // fichiers déjà publics dans media.layerpitch.com/audio/<id>/. Couches additives, embranchement vertical, séquentiel à embranchement, aléatoire.
  const DEMO_TRACKS_JAZZ = [{"id":"bmvidtfhvfa5tt","folder_id":null,"title":"Jazz Hi Lay. Add.","description":"","mode":"vertical","loopable":false,"implementation_note":"","no_ai_override":null,"loop_engine":"quantized","bpm":"110","beats_per_bar":4,"loop_grid_unit":"bars","loop_in_beat":"2","loop_out_beat":"34","start_track_beat":"0","max_loops":null,"max_chain_loops":null,"normalize_volume":false,"duration":"21.96","base":"https://media.layerpitch.com/audio/bmvidtfhvfa5tt/","randomize_sections":false,"layers":[{"fx":null,"file":"0-jazz-cb-only-2bts-intro.ogg","gain":1,"label":"Jazz + CB Only 2bts intro","duration":18.99,"localUrl":null,"originalFileName":null},{"fx":null,"file":"1-jazz-drum-only-2bts-intro.ogg","gain":1,"label":"Jazz + Drum Only 2bts intro","duration":21.96,"localUrl":null,"originalFileName":null},{"fx":null,"file":"2-jazz-kb-only-2bts-intro.ogg","gain":1,"label":"Jazz + KB Only 2bts intro","duration":20.48,"localUrl":null,"originalFileName":null}],"intro":null,"outro":null,"loops":[],"sections":[],"created_at":"2026-10-21T18:53:33.878Z","updated_at":"2026-10-22T11:40:52.992Z","owner_id":"demo-composer","fx":null,"fx_triggers":[],"fx_sliders":[],"tags":[],"retired_at":null,"protected":false,"segment_slots":[],"track_sfx":[]},{"id":"bmvidp6unbjfkq","folder_id":null,"title":"Jazz Hi-Lo Vert. Branch.","description":"","mode":"embranchement-vertical","loopable":false,"implementation_note":"","no_ai_override":null,"loop_engine":"simple","bpm":"110","beats_per_bar":4,"loop_grid_unit":"bars","loop_in_beat":"0","loop_out_beat":"16","start_track_beat":"0","max_loops":null,"max_chain_loops":null,"normalize_volume":false,"duration":"0","base":"https://media.layerpitch.com/audio/bmvidp6unbjfkq/","randomize_sections":false,"layers":[],"intro":null,"outro":null,"loops":[{"fx":null,"id":"bmvj7jern3kvzu","bpm":110,"bars":9,"file":"loop0-jazz-lo.ogg","gain":1,"label":"Jazz Lo","cutStyle":"fade","duration":21.96,"isDetour":false,"localUrl":null,"fxActions":null,"isInitial":true,"detourMode":"once","loopInBeat":4,"transition":null,"beatsPerBar":4,"loopOutBeat":36,"autoReturnUnit":"bars","startTrackBeat":0,"switchQuantize":"bar","autoReturnValue":4,"customCutFadeSec":null,"autoReturnEnabled":false,"endLoopButtonLabel":""},{"fx":null,"id":"bmvj7j4g4fcldu","bpm":null,"bars":9,"file":"loop1-jazz-hi.ogg","gain":1,"label":"Jazz Hi","cutStyle":"fade","duration":21.96,"isDetour":false,"localUrl":null,"fxActions":null,"isInitial":false,"detourMode":"once","loopInBeat":4,"transition":null,"beatsPerBar":4,"loopOutBeat":36,"autoReturnUnit":"bars","startTrackBeat":0,"switchQuantize":"beat","autoReturnValue":4,"customCutFadeSec":null,"autoReturnEnabled":false,"endLoopButtonLabel":""}],"sections":[],"created_at":"2026-10-21T18:53:33.924Z","updated_at":"2026-10-22T11:40:53.608Z","owner_id":"demo-composer","fx":null,"fx_triggers":[],"fx_sliders":[],"tags":[],"retired_at":null,"protected":false,"segment_slots":[],"track_sfx":[]},{"id":"bmvidx6a4320my","folder_id":null,"title":"Jazz Hi Seq. Branch.","description":"","mode":"sequential","loopable":false,"implementation_note":"","no_ai_override":null,"loop_engine":"simple","bpm":"110","beats_per_bar":4,"loop_grid_unit":"bars","loop_in_beat":"0","loop_out_beat":"16","start_track_beat":"0","max_loops":null,"max_chain_loops":null,"normalize_volume":false,"duration":"13.03","base":"https://media.layerpitch.com/audio/bmvidx6a4320my/","randomize_sections":false,"layers":[],"intro":null,"outro":null,"loops":[],"sections":[],"created_at":"2026-10-21T18:53:34.060Z","updated_at":"2026-10-22T11:40:52.702Z","owner_id":"demo-composer","fx":null,"fx_triggers":[],"fx_sliders":[],"tags":[],"retired_at":null,"protected":false,"segment_slots":[{"id":"bmvidx6a49ygkq","track_id":"bmvidx6a4320my","label":"Jazz City","avoid_immediate_repeat":true,"references_slot_id":null,"repeat_count":1,"quantization":"beat","cut_style":"custom","description_fr":"","description_en":"","alternatives":[{"bars":4,"file":"slot1-0-jazz-city.ogg","gain":1,"label":"Jazz City","localUrl":null,"volumeDb":0,"originalFileName":"Jazz City_4M_110bpm.wav"},{"bars":4,"file":"slot0-1-alt.ogg","gain":1,"label":"","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Hi Jazz City.2_4M_110bpm.wav"}],"position":0,"created_at":"2026-10-22T11:40:52.702Z","bpm":"110","beats_per_bar":null,"custom_cut_fade_sec":"2","fx":null,"segment_slot_transitions":[{"id":"e79380bf-1149-4aa6-9461-52c6c49baab2","from_slot_id":"bmvidx6a49ygkq","target_slot_id":"bmvjdomcybkydn","label":"","transition":{"fx":null,"bars":1,"file":"slot0-branch0-transition-trans-rock-city-1m.ogg","gain":1,"label":"Trans Rock City 1M","localUrl":null,"durationUnit":"bars","descriptionEn":"","descriptionFr":"","originalFileName":"Jazz Hi_Trans Rock City_1M.wav"},"position":0,"fx_actions":null}]},{"id":"bmvjdomcybkydn","track_id":"bmvidx6a4320my","label":"Rock City","avoid_immediate_repeat":true,"references_slot_id":null,"repeat_count":1,"quantization":"bar","cut_style":"fade","description_fr":"","description_en":"","alternatives":[{"bars":4,"file":"slot1-0-jazz-hi-rock-city.ogg","gain":1,"label":"Jazz Hi Rock City","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Hi_Rock City_4M_110bpm.wav"}],"position":1,"created_at":"2026-10-22T11:40:52.702Z","bpm":"110","beats_per_bar":null,"custom_cut_fade_sec":null,"fx":null,"segment_slot_transitions":[{"id":"1d3b012c-36b9-4ea7-8250-ca38d13be176","from_slot_id":"bmvjdomcybkydn","target_slot_id":"bmvidx6a4p6cyh","label":"","transition":{"fx":null,"bars":1,"file":"slot1-branch0-transition-transition.ogg","gain":1,"label":"","localUrl":null,"durationUnit":"bars","descriptionEn":"","descriptionFr":"","originalFileName":"Jazz Hi_Trans Disco City_1M.wav"},"position":0,"fx_actions":null},{"id":"72d82bb5-c905-46e0-96cf-9f96ca840edb","from_slot_id":"bmvjdomcybkydn","target_slot_id":"bmvidx6a49ygkq","label":"","transition":{"fx":null,"bpm":110,"bars":1,"file":"slot1-branch1-transition-jazz-hi-trans-jazz-city-1m.ogg","gain":1,"label":"Jazz Hi Trans Jazz City 1M","localUrl":null,"durationUnit":"bars","descriptionEn":"","descriptionFr":"","originalFileName":"Jazz Hi_Trans Jazz City_1M.wav"},"position":1,"fx_actions":null},{"id":"79ba74d3-2ada-4f94-8335-9c0efde1eb88","from_slot_id":"bmvjdomcybkydn","target_slot_id":"bmvidx6a4hg0us","label":"","transition":{"fx":null,"bpm":110,"bars":1,"file":"slot1-branch2-transition-transition.ogg","gain":1,"label":"","localUrl":null,"durationUnit":"bars","descriptionEn":"","descriptionFr":"","originalFileName":"Jazz Hi_Trans Synth City_1M.wav"},"position":2,"fx_actions":null}]},{"id":"bmvidx6a4p6cyh","track_id":"bmvidx6a4320my","label":"Disco City","avoid_immediate_repeat":true,"references_slot_id":null,"repeat_count":1,"quantization":"beat","cut_style":"custom","description_fr":"","description_en":"","alternatives":[{"bars":4,"file":"slot0-0-disco-city.ogg","gain":1,"label":"Disco City","localUrl":null,"volumeDb":0,"originalFileName":"Disco City_4M_110bpm.wav"}],"position":2,"created_at":"2026-10-22T11:40:52.702Z","bpm":"110","beats_per_bar":null,"custom_cut_fade_sec":"0.6","fx":null,"segment_slot_transitions":[{"id":"273b417d-e35c-4ebb-9c64-7e2ac686d88d","from_slot_id":"bmvidx6a4p6cyh","target_slot_id":"bmvjdomcybkydn","label":"","transition":{"fx":null,"bpm":110,"bars":1,"file":"slot2-branch0-transition-jazz-hi-trans-rock-city-1m.ogg","gain":1,"label":"Jazz Hi Trans Rock City 1M","localUrl":null,"durationUnit":"bars","descriptionEn":"","descriptionFr":"","originalFileName":"Jazz Hi_Trans Rock City_1M.wav"},"position":0,"fx_actions":null}]},{"id":"bmvidx6a4hg0us","track_id":"bmvidx6a4320my","label":"Synth city","avoid_immediate_repeat":true,"references_slot_id":null,"repeat_count":1,"quantization":"beat","cut_style":"custom","description_fr":"","description_en":"","alternatives":[{"bars":4,"file":"slot2-0-synth-city.ogg","gain":1,"label":"Synth city","localUrl":null,"volumeDb":0,"originalFileName":"Synth city_4M_110bpm.wav"}],"position":3,"created_at":"2026-10-22T11:40:52.702Z","bpm":"110","beats_per_bar":null,"custom_cut_fade_sec":"2","fx":null,"segment_slot_transitions":[{"id":"c07858ef-ecd0-4b49-8772-bd5a42c53e37","from_slot_id":"bmvidx6a4hg0us","target_slot_id":"bmvjdomcybkydn","label":"","transition":{"fx":null,"bpm":110,"bars":1,"file":"slot3-branch0-transition-jazz-hi-trans-rock-city-1m.ogg","gain":1,"label":"Jazz Hi Trans Rock City 1M","localUrl":null,"durationUnit":"bars","descriptionEn":"","descriptionFr":"","originalFileName":"Jazz Hi_Trans Rock City_1M.wav"},"position":0,"fx_actions":null}]}],"track_sfx":[]},{"id":"bmvin15j2vxt4p","folder_id":null,"title":"Jazz Lo Vert. Rand.","description":"","mode":"vertical-random","loopable":false,"implementation_note":"","no_ai_override":null,"loop_engine":"simple","bpm":"120","beats_per_bar":4,"loop_grid_unit":"bars","loop_in_beat":"0","loop_out_beat":"16","start_track_beat":"0","max_loops":null,"max_chain_loops":null,"normalize_volume":false,"duration":"20.48","base":"https://media.layerpitch.com/audio/bmvin15j2vxt4p/","randomize_sections":false,"layers":[],"intro":{"fx":null,"bpm":null,"bars":1,"file":"intro-intro.ogg","gain":1,"label":"Intro","localUrl":null,"timingOwn":true,"beatsPerBar":2,"descriptionEn":"","descriptionFr":"","originalFileName":null},"outro":null,"loops":[],"sections":[{"id":"bmvin15j26mmem","bpm":110,"label":"","pools":[{"fx":null,"id":"bmvin15j59c5sw","label":"Jazz Lo KB","alternatives":[{"file":"section0-pool0-0-jazz-lo-kb-carry-on.ogg","gain":1,"label":"Jazz Lo KB Carry On","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo KB_Carry On_4M_110bpm.wav"},{"file":"section0-pool0-1-jazz-lo-kb-fluid-chords.ogg","gain":1,"label":"Jazz Lo KB Fluid Chords","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo KB_Fluid Chords_4M_110bpm.wav"},{"file":"section0-pool0-2-jazz-lo-kb-journey-s-end.ogg","gain":1,"label":"Jazz Lo KB Journey's End","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo KB_Journey's End_4M_110bpm.wav"},{"file":"section0-pool0-3-jazz-lo-kb-perpetual-sunrise.ogg","gain":1,"label":"Jazz Lo KB Perpetual Sunrise","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo KB_Perpetual Sunrise_4M_110bpm.wav"},{"file":"section0-pool0-4-jazz-lo-kb-simply-said.ogg","gain":1,"label":"Jazz Lo KB Simply Said","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo KB_Simply Said_4M_110bpm.wav"},{"file":"section0-pool0-5-jazz-lo-kb-the-feels.ogg","gain":1,"label":"Jazz Lo KB The Feels","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo KB_The Feels_4M_110bpm.wav"},{"file":null,"gain":1,"label":"Silence","localUrl":null,"volumeDb":0,"originalFileName":null}],"referencesPoolId":null,"avoidImmediateRepeat":true},{"fx":null,"id":"bmvin15j6xxt5u","label":"Jazz Lo DM","alternatives":[{"file":"section0-pool1-0-jazz-lo-dm-dirtroad-1.ogg","gain":1,"label":"Jazz Lo DM DirtRoad 1","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo DM_DirtRoad 1_4M_110bpm.wav"},{"file":"section0-pool1-1-jazz-lo-dm-dirtroad-2.ogg","gain":1,"label":"Jazz Lo DM DirtRoad 2","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo DM_DirtRoad 2_4M_110bpm.wav"},{"file":"section0-pool1-2-jazz-lo-dm-dirtroad-3.ogg","gain":1,"label":"Jazz Lo DM DirtRoad 3","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo DM_DirtRoad 3_4M_110bpm.wav"}],"referencesPoolId":null,"avoidImmediateRepeat":true},{"fx":{"compressor":{"ratio":4,"makeup":2,"threshold":-30}},"id":"bmvin15j6z8zu7","label":"Jazz Lo BS","alternatives":[{"file":"section0-pool2-0-jazz-lo-bs-dirty-south-blender.ogg","gain":1,"label":"Jazz Lo BS Dirty South Blender","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo BS_Dirty South Blender_4M_110bpm.wav"},{"file":"section0-pool2-1-jazz-lo-bs-fog-machine.ogg","gain":1,"label":"Jazz Lo BS Fog Machine","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo BS_Fog Machine_4M_110bpm.wav"},{"file":"section0-pool2-2-jazz-lo-bs-stories-told.ogg","gain":1,"label":"Jazz Lo BS Stories Told","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo BS_Stories Told_4M_110bpm.wav"},{"file":"section0-pool2-3-jazz-lo-bs-straight-up.ogg","gain":1,"label":"Jazz Lo BS Straight Up","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo BS_Straight Up_4M_110bpm.wav"},{"file":"section0-pool2-4-jazz-lo-bs-sweet-summer.ogg","gain":1,"label":"Jazz Lo BS Sweet Summer","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo BS_Sweet Summer_4M_110bpm.wav"},{"file":"section0-pool2-5-jazz-lo-bs-walking-strong.ogg","gain":1,"label":"Jazz Lo BS Walking Strong","localUrl":null,"volumeDb":0,"originalFileName":"Jazz Lo BS_Walking Strong_4M_110bpm.wav"}],"referencesPoolId":null,"avoidImmediateRepeat":true}],"duration":8.73,"maxLoops":null,"loopInBeat":0,"beatsPerBar":4,"loopOutBeat":16,"startTrackBeat":0,"referencesSectionId":null}],"created_at":"2026-10-21T21:44:13.358Z","updated_at":"2026-10-22T11:40:54.187Z","owner_id":"demo-composer","fx":null,"fx_triggers":[],"fx_sliders":[],"tags":[],"retired_at":null,"protected":false,"segment_slots":[],"track_sfx":[]}];
  // Morceaux du pack « 8 bits Comptines » de Jules-Antoine (copiés de sa base en lecture seule, fichiers publics sous media.layerpitch.com/audio/<id>/) : leçon « Vendre des assets audio » (pack, 26/10).
  const DEMO_TRACKS_8BIT = [{"id":"bmruc7dbdxf1i0","folder_id":null,"title":"Les Petits Poissons","description":"","mode":"static","loopable":false,"implementation_note":"","no_ai_override":null,"loop_engine":"simple","bpm":"120","beats_per_bar":4,"loop_grid_unit":"bars","loop_in_beat":"0","loop_out_beat":"16","start_track_beat":"0","max_loops":null,"max_chain_loops":null,"normalize_volume":false,"duration":"98.14","base":"https://media.layerpitch.com/audio/bmruc7dbdxf1i0/","randomize_sections":false,"layers":[{"fx":null,"file":"0-niveau-1.ogg","gain":0.877,"label":"Niveau 1","duration":0,"localUrl":null,"originalFileName":null}],"intro":null,"outro":null,"loops":[],"sections":[],"created_at":"2026-08-31T10:53:12.519Z","updated_at":"2026-10-22T11:40:53.065Z","owner_id":"demo-composer","fx":null,"fx_triggers":[],"fx_sliders":[],"tags":[],"retired_at":null,"protected":false,"segment_slots":[],"track_sfx":[]},{"id":"bmruc9x0htabo1","folder_id":null,"title":"Doucement s'en va le jour","description":"","mode":"static","loopable":false,"implementation_note":"","no_ai_override":null,"loop_engine":"simple","bpm":"120","beats_per_bar":4,"loop_grid_unit":"bars","loop_in_beat":"0","loop_out_beat":"16","start_track_beat":"0","max_loops":null,"max_chain_loops":null,"normalize_volume":false,"duration":"108.54","base":"https://media.layerpitch.com/audio/bmruc9x0htabo1/","randomize_sections":false,"layers":[{"fx":null,"file":"0-niveau-1.ogg","gain":0.864,"label":"Niveau 1","duration":0,"localUrl":null,"originalFileName":null}],"intro":null,"outro":null,"loops":[],"sections":[],"created_at":"2026-08-31T10:53:12.519Z","updated_at":"2026-10-22T11:40:53.345Z","owner_id":"demo-composer","fx":null,"fx_triggers":[],"fx_sliders":[],"tags":[],"retired_at":null,"protected":false,"segment_slots":[],"track_sfx":[]},{"id":"bmruccnxudcuy8","folder_id":null,"title":"Dans la Forêt Lointaine","description":"","mode":"static","loopable":false,"implementation_note":"","no_ai_override":null,"loop_engine":"simple","bpm":"120","beats_per_bar":4,"loop_grid_unit":"bars","loop_in_beat":"0","loop_out_beat":"16","start_track_beat":"0","max_loops":null,"max_chain_loops":null,"normalize_volume":false,"duration":"112.82","base":"https://media.layerpitch.com/audio/bmruccnxudcuy8/","randomize_sections":false,"layers":[{"fx":null,"file":"0-niveau-1.ogg","gain":0.95,"label":"Niveau 1","duration":0,"localUrl":null,"originalFileName":null}],"intro":null,"outro":null,"loops":[],"sections":[],"created_at":"2026-08-31T10:53:12.519Z","updated_at":"2026-10-22T11:40:53.405Z","owner_id":"demo-composer","fx":null,"fx_triggers":[],"fx_sliders":[],"tags":[],"retired_at":null,"protected":false,"segment_slots":[],"track_sfx":[]}];
  // Leçon « C'est quoi un AdReel ? » (23/10, ?tuto&lesson=adreel-intro) : le Main AdReel de Daniel Orcman, DÉJÀ REMPLI (mêmes quatre villes que la leçon suivante).
  // Forme relevée dans la base réelle (voir reshapeAdReel dans api/adreels.js). Textes selon la langue de l'interface.
  const demoMainAdReel = () => {
    let en = false; try { en = localStorage.getItem('layerpitch_lang') === 'en'; } catch (e) { /* stockage indisponible : français */ }
    const T = en ? {
      title: 'Daniel Orcman', subtitle: 'Composer of interactive music for video games',
      bio: 'I write music that reacts to the player: layers that come in with the action, loops that never tire, transitions that follow the gameplay. Four interactive jazz pieces to play with, right here.',
      tracksTitle: 'Four interactive pieces', textTitle: 'My approach',
      text: 'Layers that stack up with the action, a branch that changes direction on the beat, a random draw that never repeats itself: the music adapts without ever breaking. Try it yourself in the player.',
      quote: 'Daniel understood our game in a single listen. The music follows the player like a shadow.', author: 'Joshua, creator of “Music City”', label: 'Main' ,
    } : {
      title: 'Daniel Orcman', subtitle: 'Compositeur de musique interactive pour jeux vidéo',
      bio: 'J’écris une musique qui réagit au joueur : des couches qui entrent avec l’action, des boucles qui ne lassent pas, des transitions qui suivent le gameplay. Quatre morceaux de jazz interactifs, à manipuler ici même.',
      tracksTitle: 'Quatre morceaux interactifs', textTitle: 'Ma façon de travailler',
      text: 'Des couches qui s’empilent avec l’action, un embranchement qui change de direction sur le temps, un tirage au sort qui ne se répète pas : la musique s’adapte sans jamais se casser. Essaie toi-même dans le lecteur.',
      quote: 'Daniel a compris notre jeu en une seule écoute. La musique suit le joueur comme son ombre.', author: 'Joshua, créateur de « Music City »', label: 'Principal (main)',
    };
    const withMedia = lessonParam() !== 'upload'; // leçon d'envoi de fichiers : le Main AdReel n'a ni vidéo ni photo, c'est l'apprenant qui les ajoute
    return { id: 'main', owner_id: DEMO_COMPOSER_ID, folder_id: null, label: T.label, lang: en ? 'en' : 'fr', allow_indexing: true, slug: null, access_mode: 'public',
      profile: { title: T.title, subtitle: T.subtitle, bio: T.bio, contactEmail: 'daniel@orcman-music.example', contactUrl: 'https://orcman-music.example', logo: null, photo: null, tagline: '',
        theme: { font: 'google:Space Grotesk', bgColor: '#1B1035', bgImage: null, titleColor: '#FF3EA5', contentColor: '#D9CFFF', bgImageOpacity: 1, sectionLabelColor: '#7A5FFF', separator: { visible: true, color: '#7A5FFF', thickness: 1 } }, effectivePlan: 'pro' },
      testimonials: [{ text: T.quote, author: T.author, avatar: null }],
      blocks: [{ id: 'b-header', type: 'header' }, { id: 'b-bio', type: 'bio' }, { id: 'b-tracks', type: 'tracks' }, ...(withMedia ? [{ id: 'b-video', type: 'video', videos: [{ url: 'https://youtu.be/vHJAhKIIlWc', title: 'Rescore Trailer DLC ProjectCars', source: 'url', comment: 'Halloween + Motor Racing Brutality = Pure Adrenaline', montageId: null, thumbnail: 'bmrc9ryuilymwc-thumb-0.png', defaultVersion: null, hiddenVersions: [], libraryVideoId: null }] }] : []), { id: 'b-text', type: 'text', align: 'left', title: T.textTitle, content: T.text },
        { id: 'b-testimonials', type: 'testimonials' }, { id: 'b-contact', type: 'contact' }],
      track_overrides: {}, ad_reel_tracks: DEMO_TRACKS_JAZZ.map((t, i) => ({ track_id: t.id, position: i })) };
  };
  // Autres AdReels de Daniel Orcman, pour la leçon « C'est quoi un AdReel ? » (passage « Gérer les AdReels », 26/10) : un AdReel par destinataire, chacun avec une sélection de morceaux.
  const demoOtherAdReels = () => {
    const main = demoMainAdReel();
    const make = (id, label, lang, tracks, title, subtitle) => Object.assign({}, main, { id, label, lang, slug: null,
      profile: Object.assign({}, main.profile, { title: title || main.profile.title, subtitle: subtitle || main.profile.subtitle }),
      blocks: [{ id: id + '-h', type: 'header' }, { id: id + '-b', type: 'bio' }, { id: id + '-t', type: 'tracks' }, { id: id + '-c', type: 'contact' }],
      testimonials: [], ad_reel_tracks: tracks.map((t, i) => ({ track_id: DEMO_TRACKS_JAZZ[t].id, position: i })) });
    const en = main.lang === 'en';
    return [
      make('studio-aurora', en ? 'Studio Aurora: pitch' : 'Studio Aurora : pitch musical', main.lang, [0, 1], null, en ? 'Music for “Aurora Run”' : 'Musique pour « Aurora Run »'),
      make('pixel-forge', en ? 'Pixel Forge: RPG demo' : 'Pixel Forge : démo RPG', main.lang, [2, 3], null, en ? 'Adaptive music for RPGs' : 'Musique adaptative pour RPG'),
      make('music-city', en ? 'Music City: musical pitch' : 'Music City : pitch musical', main.lang, [0, 1, 2, 3], null, en ? 'Four interactive moods for “Music City”' : 'Quatre ambiances interactives pour « Music City »'),
      make('english', 'English version', 'en', [0, 1, 2, 3], null, 'Composer of interactive music for video games'),
    ];
  };
  // AdReel de Joshua « Music City : pitch musical » TEL QU'ON LE LAISSE à la fin de la leçon « Mise en situation » : en-tête et bio repris du Main AdReel, un bloc texte, deux morceaux,
  // apparence NEUTRE (thème par défaut). Point de départ de la leçon « Apparence » (26/10).
  const demoJoshuaAdReel = () => {
    const main = demoMainAdReel(); const en = main.lang === 'en';
    return Object.assign({}, main, { id: 'music-city', label: en ? 'Music City: musical pitch' : 'Music City : pitch musical', slug: null,
      profile: Object.assign({}, main.profile, { theme: { font: 'default', bgColor: '#f6f5f3', bgImage: null, titleColor: '#262521', contentColor: '#262521', bgImageOpacity: 1, sectionLabelColor: '#516dc2' } }),
      blocks: [{ id: 'mc-h', type: 'header' }, { id: 'mc-b', type: 'bio' }, { id: 'mc-x', type: 'text', align: 'left', title: en ? 'Sound direction' : 'Direction sonore', content: en ? 'A common thread through all the cities: the same tempo, a different mood in each city.' : 'Un fil rouge entre toutes les villes : le même tempo, une ambiance différente à chaque ville.' }, { id: 'mc-t', type: 'tracks' }],
      testimonials: [], ad_reel_tracks: [0, 1].map((t, i) => ({ track_id: DEMO_TRACKS_JAZZ[t].id, position: i })) });
  };
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
    if (table === 'ad_reels' && (['adreel-intro', 'adreel', 'upload', 'appearance', 'share', 'shortcuts'].includes(lessonParam()))) return lessonParam() === 'adreel-intro' ? [demoMainAdReel()].concat(demoOtherAdReels()) : (['appearance', 'share'].includes(lessonParam()) ? [demoMainAdReel(), demoJoshuaAdReel()] : [demoMainAdReel()]);
    if (table === 'tracks' && lessonParam() === 'pack' && !projectPage) return DEMO_TRACKS_8BIT.filter(t => t.id !== 'bmruc9x0htabo1'); // « Doucement s'en va le jour » : son fichier audio est introuvable en ligne (404), on ne le propose pas
    if (table === 'tracks' && ['adreel', 'adreel-intro', 'album', 'tracking', 'upload', 'appearance', 'share', 'shortcuts'].includes(lessonParam()) && !projectPage) return lessonParam() === 'share' ? DEMO_TRACKS_JAZZ.map(t => Object.assign({}, t, { protected: true })) : DEMO_TRACKS_JAZZ; // « Diffuser » : morceaux déjà protégés (sinon la demande de protection complique l'étape du mot de passe)
    if (table === 'tracks' && (lessonParam() === 'adreel' || projectPage)) return DEMO_TRACKS;
    if (table === 'tracks' && lessonParam() === 'sfx') return [DEMO_TRACK_JAZZ_SFX];
    if (table === 'tracks' && lessonParam() === 'events') return [Object.assign({}, DEMO_TRACK_JAZZ_SFX, { track_sfx: DEMO_SFX.map((x, i) => ({ sfx_id: x.id, position: i })) })];
    if (table === 'sfx_library' && lessonParam() === 'events') return DEMO_SFX;
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
  // Filtres « eq » retenus pour deux lectures d'une seule ligne : un morceau par son identifiant (getTrack, version automatique d'un
  // album) et la version officielle d'un morceau d'album (album_tracks). Les autres filtres sont ignorés.
  function singleRow(table, eqs) {
    if (table === 'tracks' && eqs.id) { const list = listRows('tracks'); return (list && list.find(t => t.id === eqs.id)) || null; }
    if (table === 'album_tracks' && eqs.album_id && eqs.track_id) { const t = demoOfficialTakes[eqs.album_id + '|' + eqs.track_id]; return t ? { default_settings: t } : null; }
    return TABLE_ROWS[table] || null;
  }
  function makeQuery(table, isWrite, payload) {
    let single = false;
    const eqs = {};
    const q = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const row = TABLE_ROWS[table];
          let result;
          if (isWrite) result = OK(single ? (payload || null) : null);
          else if (single) result = OK(singleRow(table, eqs));
          else result = OK(listRows(table) || (row ? [row] : []));
          return (res, rej) => Promise.resolve(result).then(res, rej);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return q; };
        if (prop === 'eq') return (col, val) => { eqs[col] = val; return q; };
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
    // Copie d'un morceau (Option/Alt + glisser, leçon « Raccourcis clavier », 27/10) : la copie reste dans la page, rien n'est copié pour de vrai.
    functions: { invoke: async (name) => name === 'copy-track-files' ? OK({ ok: true, files: 0 }) : { data: null, error: UNAVAILABLE } },
    storage: { from: () => ({ upload: async () => ({ data: null, error: UNAVAILABLE }), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => OK(null) }) },
  };

  // loadPostgresReadScripts() met ensuite ce client à la place du vrai (window.LayerPitchSupabaseClient.getClient).
  window.LayerPitchDemoClient = demoClient;
})();
