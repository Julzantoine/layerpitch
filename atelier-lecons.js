/* atelier-lecons.js — partie « atelier » de la leçon guidée « Versioning vidéo » (atelier.html?tuto&lesson=versioning), 21/10, refaite le 07/11 puis le 14/11 sur « Joris ».
 *
 * L'atelier vit dans un cadre du Backstage (onglet Vidéo → Atelier) : le Backstage guide jusqu'à l'atelier, ce fichier guide DANS
 * l'atelier (choisir le pack, la vidéo, marqueurs, frise, versionner), puis rend la main au Backstage (onDone) pour le bloc vidéo.
 * Choisir le pack recharge l'atelier : la leçon reprend alors juste après cette étape (le pack est dans l'adresse).
 *
 * Parcours (d'après le montage « Short SIW Test #1 » de Jules-Antoine, 14/11) : la vidéo muette du gameplay de « Joris » (accord de Joris). 1) quatre marqueurs posés d'après l'image :
 * la photocopieuse (~16,8 s), le couloir (~38 s), l'ascenseur (~50,4 s) et la sortie d'ascenseur (~55 s) ; 2) les blocs créés à la souris dans la frise : « Welcome to the Office
 * Dynamic Edition Alt 1 » (3 couches, entrées au départ / photocopieuse / couloir, toutes arrêtées à l'ascenseur), le bruit d'ascenseur, puis « Drone Urbex#1_Joris » à la sortie d'ascenseur ;
 * 3) la version : « Alt 1 » devient « Alt2 » (même mode, trois couches) et le drone n°1 le drone n°2. Rien n'est enregistré (faux serveur api/demo-client.js).
 * Leçon à part « Les pas » (?lesson=versioning-pas, 14/11) : le montage ci-dessus est DÉJÀ PRÊT (chargé d'office à l'ouverture de la vidéo, api/demo-client.js) ; passe additive
 * (Enregistrer → Fusionner) où l'on joue « Stone Walk » à la souris à chaque pas, jusqu'à l'ascenseur (≥ 10 pas), écoute, puis une version qui ajoute le pack « Footsteps » et
 * remplace « Stone Walk » par « Concrete Walk ». Pas de touche du clavier : le lecteur n'en a pas pour les Sfx (à dire à Jules-Antoine).
 * Moteur partagé layerpitch-guide.js.
 */
(function () {
  // Vidéo muette du gameplay de « Joris » (copie allégée sans son, déposée le 06/11 dans media.layerpitch.com/tuto/Joris/).
  const KIT = { video: { label: 'joris-gameplay-muette.mp4', name: 'joris-gameplay-muette.mp4', url: 'https://media.layerpitch.com/tuto/Joris/joris-gameplay-muette.mp4' } };
  const ready = () => !!KIT.video.url;

  function init(ctx) {
    // Textes : ceux de la page (zone pack), puis communs, puis ceux des bulles du Backstage (« Suivant », « Quitter »…), puis français.
    const lang = ctx.lang || ((window.LAYERPITCH_I18N && localStorage.getItem('layerpitch_lang') === 'en') ? 'en' : 'fr');
    const tr = (key, vars) => {
      const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
      let s = null;
      for (const l of [lang, 'fr']) { for (const z of ['pack', 'shared', 'backstage']) { const d = I[l] && I[l][z]; if (d && d[key] != null) { s = d[key]; break; } } if (s != null) break; }
      if (s == null) s = key;
      if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
      return s;
    };
    const $ = sel => document.querySelector(sel);
    const hasPack = new URLSearchParams(location.search).has('id');
    // Pack « Joris » (api/demo-client.js, lignes de la base de Jules-Antoine). Instants clés de la vidéo muette (en secondes) : photocopieuse 16,8 · couloir 38 · ascenseur 50,4 (noir) · portes
    // rouges de l'ascenseur 55. Les couches de la musique 1 entrent à la mesure suivante (65 bpm : une mesure dure ~3,7 s), d'où des fenêtres un peu larges.
    const ALT1 = 'bmwb6s3d467w77', ALT2 = 'bmwf5gpcfqqjyd', D1 = 'bmw41gclr2m44q', D2 = 'bmw3ds8idckeds', ELEV = 'bmw40wgx1bwy7y';
    const T_PHOTO = 16.8, T_HALL = 38, T_ELEV = 50.4, T_EXIT = 55;
    // Montage « à la souris » : pas de capture, on double-clique dans la frise pour poser chaque bloc ; les marqueurs se posent au double-clic sur la règle.
    const lane = sel => document.querySelector(`#videoCaptureTimeline .vct-lane-track${sel}`);
    const layerLane = (n, id) => lane(`[data-addable="layer"][data-add-track-id="${id}"][data-add-level="${n}"]`);
    const sfxLane = id => lane(`[data-addable="sfx"][data-add-sfx-id="${id}"]`);
    const total = () => { const tl = $('#videoCaptureTimeline'); return tl && tl.__vctTotal; };
    const markerTimes = () => { const tl = $('#videoCaptureTimeline'), T = total(); return tl && T ? [...tl.querySelectorAll('.vct-marker')].map(m => parseFloat(m.style.left) / 100 * T) : []; };
    const markerNear = (t, tol) => markerTimes().some(x => Math.abs(x - t) <= tol);
    const blockEnd = el => { const T = total(), bk = el && el.querySelector('.vct-block'); return bk && T ? (parseFloat(bk.style.left) + parseFloat(bk.style.width)) / 100 * T : null; };
    const blockIn = (el, from, to) => { const T = total(); return !!(el && T && [...el.querySelectorAll('.vct-block')].some(bk => { const t = parseFloat(bk.style.left) / 100 * T; return t >= from && t <= to; })); };
    const endsAtElevator = () => [0, 1, 2].every(n => { const e = blockEnd(layerLane(n, ALT1)); return e != null && e >= 48.5 && e <= 53; });
    const trackSel = id => document.querySelector(`#videoCaptureVersioning select[data-track="${id}"]`);
    // Leçon « Les pas » : le montage prêt s'ouvre avec la vidéo (atelier : window.__lpTutoMontageId lu à l'ouverture du dialogue vidéo).
    const lessonId = new URLSearchParams(location.search).get('lesson') === 'versioning-pas' ? 'versioning-pas' : 'versioning';
    const PAS = lessonId === 'versioning-pas';
    if (PAS) window.__lpTutoMontageId = 'cap-joris-pas';
    const STONE = 'bmw3dg2foqzndw', CONCRETE = 'bmw3dfcf4ye93a', FOOT_PACK = 'p-footsteps';
    // Passe additive en temps réel : on compte les clics sur le bouton de lecture de « Stone Walk » PENDANT l'enregistrement (la frise vivante ne montre pas toujours les Sfx).
    const recording = () => !!$('#videoCaptureRecordBtn.recording');
    const stoneBtn = () => { const w = [...document.querySelectorAll('.sfx-row-wrapper')].find(x => { const n = x.querySelector('.name'); return n && n.textContent.trim() === 'Stone Walk'; }); return w && w.querySelector('[data-role="playBtn"]'); };
    let stepsN = 0, wasRec = false;
    if (PAS && document.addEventListener) document.addEventListener('click', ev => { const b = stoneBtn(); if (b && recording() && ev.target.closest && ev.target.closest('.sfx-row-wrapper') === b.closest('.sfx-row-wrapper') && ev.target.closest('[data-role="playBtn"]')) stepsN++; }, true);
    const sfxSel = id => document.querySelector(`#videoCaptureVersioning select[data-sfx="${id}"]`);
    const mergeBtn = () => document.querySelector('dialog.video-test-dialog button[data-v="merge"]');
    const stepsPas = [
      { titleKey: 'pvWelcomeTitle', textKey: 'pvpWelcomeText' },
      { selector: '#atelierPackSelect', titleKey: 'pvPackTitle', textKey: 'pvPackText', done: () => !!($('#atelierPackSelect') && $('#atelierPackSelect').value) },
      { selector: '.video-capture-trigger-btn', titleKey: 'pvOpenTitle', textKey: 'pvOpenText', clickDone: true },
      { selector: '#videoCaptureDropzone', titleKey: 'pvVideoTitle', textKey: 'pvpVideoText', done: () => !!$('#videoCaptureEl') && markerTimes().length >= 4,
        drops: ready() ? [{ kind: 'file', label: KIT.video.label, url: KIT.video.url, name: KIT.video.name }] : [] },
      { selector: '#videoCaptureTimeline', titleKey: 'pvpReadyTitle', textKey: 'pvpReadyText' },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvpRecordTitle', textKey: 'pvpRecordText', done: () => !!mergeBtn() || recording() },
      { selector: () => mergeBtn() || $('#videoCaptureRecordBtn'), titleKey: 'pvpMergeTitle', textKey: 'pvpMergeText', done: () => { if (recording() && !wasRec) { wasRec = true; stepsN = 0; } return recording(); } },
      { selector: () => stoneBtn() || $('#videoCaptureRecordBtn'), titleKey: 'pvpStepsTitle', textKey: 'pvpStepsText', done: () => stepsN >= 10 },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvpStopTitle', textKey: 'pvpStopText', done: () => !recording() },
      { selector: '#videoCaptureListenBtn', titleKey: 'pvHearTitle', textKey: 'pvpHearText', clickDone: true },
      { selector: '#videoCaptureSaveStatus', titleKey: 'pvpSaveTitle', textKey: 'pvpSaveText', done: () => !!($('#videoCaptureSaveStatus') && $('#videoCaptureSaveStatus').dataset.state === 'saved') },
      // La version : le pack « Footsteps » (Concrete Walk), puis Stone Walk → Concrete Walk.
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="new"]'), titleKey: 'pvNewTitle', textKey: 'pvpNewText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-role="addPack"]') || $('#videoCaptureVersioning'), titleKey: 'pvpAddPackTitle', textKey: 'pvpAddPackText', done: () => !!document.querySelector(`#videoCaptureVersioning [data-role="removePack"][data-pack="${FOOT_PACK}"]`) },
      { selector: () => sfxSel(STONE) || $('#videoCaptureVersioning'), titleKey: 'pvpPickTitle', textKey: 'pvpPickText', done: () => { const sel = sfxSel(STONE); return !!(sel && sel.value === CONCRETE); } },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="listenDraft"]'), titleKey: 'pvListenTitle', textKey: 'pvpListenText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="saveDraft"]'), titleKey: 'pvKeepTitle', textKey: 'pvKeepText', clickDone: true },
      { titleKey: 'pvpEndTitle', textKey: 'pvpEndText', final: true },
    ];
    const stepsVersioning = [
      { titleKey: 'pvWelcomeTitle', textKey: 'pvWelcomeText' },
      { selector: '#atelierPackSelect', titleKey: 'pvPackTitle', textKey: 'pvPackText', done: () => !!($('#atelierPackSelect') && $('#atelierPackSelect').value) },
      { selector: '.video-capture-trigger-btn', titleKey: 'pvOpenTitle', textKey: 'pvOpenText', clickDone: true },
      { selector: '#videoCaptureDropzone', titleKey: 'pvVideoTitle', textKey: 'pvVideoText', done: () => !!$('#videoCaptureEl'),
        drops: ready() ? [{ kind: 'file', label: KIT.video.label, url: KIT.video.url, name: KIT.video.name }] : [] },
      // Marqueurs d'abord, d'après l'image : ils repèrent les moments où la musique change.
      { selector: '#videoCaptureTimeline .vct-ruler', titleKey: 'pvMarkPhotoTitle', textKey: 'pvMarkPhotoText', done: () => markerNear(T_PHOTO, 2.5) },
      { selector: '#videoCaptureTimeline .vct-ruler', titleKey: 'pvMarkHallTitle', textKey: 'pvMarkHallText', done: () => markerNear(T_HALL, 2.5) },
      { selector: '#videoCaptureTimeline .vct-ruler', titleKey: 'pvMarkElevTitle', textKey: 'pvMarkElevText', done: () => markerNear(T_ELEV, 2.5) },
      { selector: '#videoCaptureTimeline .vct-ruler', titleKey: 'pvMarkExitTitle', textKey: 'pvMarkExitText', done: () => markerNear(T_EXIT, 2.5) },
      // Puis les blocs, à la souris : la musique 1 couche par couche, l'ascenseur, la musique 2.
      { selector: () => layerLane(0, ALT1), titleKey: 'pvLayer1Title', textKey: 'pvLayer1Text', done: () => blockIn(layerLane(0, ALT1), 0, 2) },
      { selector: () => layerLane(1, ALT1), titleKey: 'pvLayer2Title', textKey: 'pvLayer2Text', done: () => blockIn(layerLane(1, ALT1), 14, 21) },
      { selector: () => layerLane(2, ALT1), titleKey: 'pvLayer3Title', textKey: 'pvLayer3Text', done: () => blockIn(layerLane(2, ALT1), 35, 42) },
      { selector: () => layerLane(0, ALT1), titleKey: 'pvEndsTitle', textKey: 'pvEndsText', done: endsAtElevator },
      { selector: () => sfxLane(ELEV), titleKey: 'pvElevTitle', textKey: 'pvElevText', done: () => blockIn(sfxLane(ELEV), 48.5, 52.5) },
      { selector: () => layerLane(0, D1), titleKey: 'pvDroneTitle', textKey: 'pvDroneText', done: () => blockIn(layerLane(0, D1), 52.5, 57) },
      { selector: '#videoCaptureListenBtn', titleKey: 'pvHearTitle', textKey: 'pvHearText', clickDone: true },
      { selector: '#videoCaptureTitleInput', titleKey: 'pvNameTitle', textKey: 'pvNameText', done: () => !!($('#videoCaptureTitleInput') && $('#videoCaptureTitleInput').value.trim().length > 2),
        drops: [{ kind: 'text', label: 'Joris : du bureau à l’ascenseur', value: 'Joris : du bureau à l’ascenseur' }] },
      { selector: '#videoCaptureSaveStatus', titleKey: 'pvSaveTitle', textKey: 'pvSaveText', done: () => !!($('#videoCaptureSaveStatus') && $('#videoCaptureSaveStatus').dataset.state === 'saved') }, // enregistrement automatique (06/11)
      // La version : la musique 1 devient « Alt2 », le drone n°1 le drone n°2.
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="new"]'), titleKey: 'pvNewTitle', textKey: 'pvNewText', clickDone: true },
      { selector: () => trackSel(ALT1) || $('#videoCaptureVersioning'), titleKey: 'pvPickAltTitle', textKey: 'pvPickAltText', done: () => { const sel = trackSel(ALT1); return !!(sel && sel.value === ALT2); } },
      { selector: () => trackSel(D1) || $('#videoCaptureVersioning'), titleKey: 'pvPickDroneTitle', textKey: 'pvPickDroneText', done: () => { const sel = trackSel(D1); return !!(sel && sel.value === D2); } },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="listenDraft"]'), titleKey: 'pvListenTitle', textKey: 'pvListenText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="saveDraft"]'), titleKey: 'pvKeepTitle', textKey: 'pvKeepText', clickDone: true },
      { titleKey: 'pvAtelierEndTitle', textKey: 'pvAtelierEndText', final: true },
    ];
    const steps = PAS ? stepsPas : stepsVersioning;
    // Pack déjà choisi (l'atelier vient d'être rechargé sur lui) : on reprend après « choisir le pack ».
    // Sans pack : directement « Choisis le pack » -- l'accueil est déjà fait par la bulle du Backstage, et une bulle sans cible se plaçait au
    // milieu du cadre de l'atelier, souvent hors de l'écran (05/11).
    const run = hasPack ? steps.slice(2) : steps.slice(1, 2);
    const G = window.LayerPitchGuide.create({ tr, onLessonDone: ctx.onDone && hasPack ? (() => ctx.onDone()) : undefined, onOpen: ctx.onOpen, onClose: ctx.onClose });
    return { start: () => { if (!ready()) return false; G.open('lesson', run, lessonId); return true; }, guide: G, steps };
  }

  window.LayerPitchAtelierLessons = { init, KIT };
})();
