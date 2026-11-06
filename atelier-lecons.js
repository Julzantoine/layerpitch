/* atelier-lecons.js — partie « atelier » de la leçon guidée « Versioning vidéo » (atelier.html?tuto&lesson=versioning), 21/10, refaite le 07/11 sur « Joris ».
 *
 * L'atelier vit dans un cadre du Backstage (onglet Vidéo → Atelier) : le Backstage guide jusqu'à l'atelier, ce fichier guide DANS
 * l'atelier (choisir le pack, la vidéo, marqueurs, frise, passe additive, versionner), puis rend la main au Backstage (onDone).
 * Choisir le pack recharge l'atelier : la leçon reprend alors juste après cette étape (le pack est dans l'adresse).
 *
 * Parcours (demande de Jules-Antoine, 07/11) : la vidéo muette du gameplay de « Joris » (accord de Joris). 1) deux marqueurs posés d'après l'image : 0 s (18h30, début de la
 * musique 1) et ~53,3 s (sortie d'ascenseur, début de la musique 2) ; 2) les blocs créés à la souris dans la frise : « Welcome to the Office » de 0 s à l'ascenseur (~50,3 s),
 * l'ascenseur, puis le drone « rencontre » au 2e marqueur ; 3) une passe additive en temps réel : les pas « Concrete Walk » jusqu'à l'ascenseur ; 4) la version : le drone
 * « rencontre » devient le drone « urbex », les pas « concrete » des pas « stone » (pack « Footsteps » ajouté pendant le Versioning). Rien n'est enregistré (faux serveur
 * api/demo-client.js). TODO Jules-Antoine : la musique 1 sera décomposée en couches additives (aujourd'hui une seule couche) -- ajouter alors une étape par couche.
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
    // Pack « Joris » (api/demo-client.js, lignes de la base de Jules-Antoine) : musique 1 « Welcome to the Office », ascenseur, pas « Concrete Walk » ; les drones servent à la version.
    // Le fichier de « Drone Urbex#2_Joris » est le drone « rencontre », celui de « Drone Urbex#1_Joris » le drone « urbex » (le fichier fait foi). Instants clés de la vidéo
    // muette (en secondes) : image 18h30 = 0 · ascenseur 50,3 · sortie d'ascenseur 53,3 (début de la musique 2).
    const WELCOME = 'bmw3drvaib1os9', RENC = 'bmw3ds8idckeds', URBEX = 'bmw41gclr2m44q', ELEV = 'bmw40wgx1bwy7y', CONC = 'bmw3dfcf4ye93a', STONE = 'bmw3dg2foqzndw', FOOT_PACK = 'p-footsteps';
    const T_START = 0, T_ELEV = 50.29, T_EXIT = 53.34;
    // Montage « à la souris » : pas de capture, on double-clique dans la frise pour poser chaque bloc ; les marqueurs se posent au double-clic sur la règle.
    const lane = sel => document.querySelector(`#videoCaptureTimeline .vct-lane-track${sel}`);
    const layerLane = (n, id) => lane(`[data-addable="layer"][data-add-track-id="${id}"][data-add-level="${n}"]`);
    const sfxLane = id => lane(`[data-addable="sfx"][data-add-sfx-id="${id}"]`);
    const total = () => { const tl = $('#videoCaptureTimeline'); return tl && tl.__vctTotal; };
    const markerTimes = () => { const tl = $('#videoCaptureTimeline'), T = total(); return tl && T ? [...tl.querySelectorAll('.vct-marker')].map(m => parseFloat(m.style.left) / 100 * T) : []; };
    const markerNear = (t, tol) => markerTimes().some(x => Math.abs(x - t) <= tol);
    const blockEnd = el => { const T = total(), bk = el && el.querySelector('.vct-block'); return bk && T ? (parseFloat(bk.style.left) + parseFloat(bk.style.width)) / 100 * T : null; };
    const blockIn = (el, from, to) => { const T = total(); return !!(el && T && [...el.querySelectorAll('.vct-block')].some(bk => { const t = parseFloat(bk.style.left) / 100 * T; return t >= from && t <= to; })); };
    // Passe additive en temps réel : on compte les clics sur le bouton de lecture de « Concrete Walk » PENDANT l'enregistrement (la frise vivante ne montre pas toujours les Sfx).
    const recording = () => !!$('#videoCaptureRecordBtn.recording');
    const concreteBtn = () => { const w = [...document.querySelectorAll('.sfx-row-wrapper')].find(x => { const n = x.querySelector('.name'); return n && n.textContent.trim() === 'Concrete Walk'; }); return w && w.querySelector('[data-role="playBtn"]'); };
    let steps_n = 0;
    const watchSteps = () => document.addEventListener && document.addEventListener('click', ev => { const b = concreteBtn(); if (b && recording() && ev.target.closest && ev.target.closest('.sfx-row-wrapper') === b.closest('.sfx-row-wrapper') && ev.target.closest('[data-role="playBtn"]')) steps_n++; }, true);
    const trackSel = id => document.querySelector(`#videoCaptureVersioning select[data-track="${id}"]`);
    const sfxSel = id => document.querySelector(`#videoCaptureVersioning select[data-sfx="${id}"]`);
    const steps = [
      { titleKey: 'pvWelcomeTitle', textKey: 'pvWelcomeText' },
      { selector: '#atelierPackSelect', titleKey: 'pvPackTitle', textKey: 'pvPackText', done: () => !!($('#atelierPackSelect') && $('#atelierPackSelect').value) },
      { selector: '.video-capture-trigger-btn', titleKey: 'pvOpenTitle', textKey: 'pvOpenText', clickDone: true },
      { selector: '#videoCaptureDropzone', titleKey: 'pvVideoTitle', textKey: 'pvVideoText', done: () => !!$('#videoCaptureEl'),
        drops: ready() ? [{ kind: 'file', label: KIT.video.label, url: KIT.video.url, name: KIT.video.name }] : [] },
      // Marqueurs d'abord, d'après l'image : le début de la musique 1 (horloge 18h30) puis la sortie de l'ascenseur (début de la musique 2).
      { selector: '#videoCaptureTimeline .vct-ruler', titleKey: 'pvMark1Title', textKey: 'pvMark1Text', done: () => markerNear(T_START, 2) },
      { selector: '#videoCaptureTimeline .vct-ruler', titleKey: 'pvMark2Title', textKey: 'pvMark2Text', done: () => markerNear(T_EXIT, 2.5) },
      // Puis les blocs, à la souris.
      { selector: () => layerLane(0, WELCOME), titleKey: 'pvMusic1Title', textKey: 'pvMusic1Text', done: () => blockIn(layerLane(0, WELCOME), 0, 2) },
      { selector: () => layerLane(0, WELCOME), titleKey: 'pvMusic1EndTitle', textKey: 'pvMusic1EndText', done: () => { const e = blockEnd(layerLane(0, WELCOME)); return e != null && e >= 48.5 && e <= 52; } },
      { selector: () => sfxLane(ELEV), titleKey: 'pvElevTitle', textKey: 'pvElevText', done: () => blockIn(sfxLane(ELEV), 48.5, 52) },
      { selector: () => layerLane(0, RENC), titleKey: 'pvMusic2Title', textKey: 'pvMusic2Text', done: () => blockIn(layerLane(0, RENC), 52, 55) },
      // Passe additive en temps réel : les pas jusqu'à l'ascenseur.
      { selector: '#videoCaptureAdditiveLabel', titleKey: 'pvAdditiveTitle', textKey: 'pvAdditiveText', done: () => { const c = $('#videoCaptureAdditiveCheckbox'); return !!(c && c.checked); } },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvRecordTitle', textKey: 'pvRecordText', done: () => { if (recording() && !steps.__rec) { steps.__rec = true; steps_n = 0; } return recording(); } },
      { selector: () => concreteBtn() || $('#videoCaptureRecordBtn'), titleKey: 'pvStepsTitle', textKey: 'pvStepsText', done: () => steps_n >= 10 },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvStopTitle', textKey: 'pvStopText', done: () => !recording() },
      { selector: '#videoCaptureListenBtn', titleKey: 'pvHearTitle', textKey: 'pvHearText', clickDone: true },
      { selector: '#videoCaptureTitleInput', titleKey: 'pvNameTitle', textKey: 'pvNameText', done: () => !!($('#videoCaptureTitleInput') && $('#videoCaptureTitleInput').value.trim().length > 2),
        drops: [{ kind: 'text', label: 'Joris : de 18h30 à l’ascenseur', value: 'Joris : de 18h30 à l’ascenseur' }] },
      { selector: '#videoCaptureSaveBtn', titleKey: 'pvSaveTitle', textKey: 'pvSaveText', clickDone: true },
      // La version : les deux drones, puis les pas « stone » (dans un autre pack, à ajouter).
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="new"]'), titleKey: 'pvNewTitle', textKey: 'pvNewText', clickDone: true },
      { selector: () => trackSel(RENC) || $('#videoCaptureVersioning'), titleKey: 'pvPickTitle', textKey: 'pvPickText', done: () => { const sel = trackSel(RENC); return !!(sel && sel.value === URBEX); } },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-role="addPack"]') || $('#videoCaptureVersioning'), titleKey: 'pvAddPackTitle', textKey: 'pvAddPackText', done: () => !!document.querySelector(`#videoCaptureVersioning [data-role="removePack"][data-pack="${FOOT_PACK}"]`) },
      { selector: () => sfxSel(CONC) || $('#videoCaptureVersioning'), titleKey: 'pvPickStepsTitle', textKey: 'pvPickStepsText', done: () => { const sel = sfxSel(CONC); return !!(sel && sel.value === STONE); } },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="listenDraft"]'), titleKey: 'pvListenTitle', textKey: 'pvListenText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="saveDraft"]'), titleKey: 'pvKeepTitle', textKey: 'pvKeepText', clickDone: true },
      { titleKey: 'pvAtelierEndTitle', textKey: 'pvAtelierEndText', final: true },
    ];
    // Pack déjà choisi (l'atelier vient d'être rechargé sur lui) : on reprend après « choisir le pack ».
    // Sans pack : directement « Choisis le pack » -- l'accueil est déjà fait par la bulle du Backstage, et une bulle sans cible se plaçait au
    // milieu du cadre de l'atelier, souvent hors de l'écran (05/11).
    const run = hasPack ? steps.slice(2) : steps.slice(1, 2);
    const G = window.LayerPitchGuide.create({ tr, onLessonDone: ctx.onDone && hasPack ? (() => ctx.onDone()) : undefined, onOpen: ctx.onOpen, onClose: ctx.onClose });
    return { start: () => { if (!ready()) return false; watchSteps(); G.open('lesson', run, 'versioning'); return true; }, guide: G, steps };
  }

  window.LayerPitchAtelierLessons = { init, KIT };
})();
