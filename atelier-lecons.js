/* atelier-lecons.js — partie « atelier » de la leçon guidée « Versioning vidéo » (atelier.html?tuto&lesson=versioning), 21/10.
 *
 * L'atelier vit dans un cadre du Backstage (onglet Vidéo → Atelier) : le Backstage guide jusqu'à l'atelier, ce fichier guide DANS
 * l'atelier (choisir le pack, la vidéo, jouer, enregistrer, versionner), puis rend la main au Backstage (onDone) pour le bloc vidéo.
 * Choisir le pack recharge l'atelier : la leçon reprend alors juste après cette étape (le pack est dans l'adresse).
 *
 * Parcours choisi par Jules-Antoine : partir d'une vidéo SANS son (le gameplay de « Music City » : la rue de Jazz City, puis le club), y poser une première musique en
 * jouant le pack sur la vidéo (capture), enregistrer le montage, puis en faire une deuxième version où le morceau est remplacé par un
 * autre du même mode (« Jazz Lo Lay. Add. » par « Jazz Hi Lay. Add. », 05/11), et l'écouter en direct (sans rendu vidéo). Moteur partagé layerpitch-guide.js ; faux serveur api/demo-client.js (montages
 * et versions gardés en mémoire, rien n'est enregistré). Sans vidéo muette (KIT.video vide), la leçon ne démarre pas ; la vidéo est
 * en ligne depuis le 04/11.
 */
(function () {
  // Vidéo muette du gameplay (fichier à déposer par Jules-Antoine dans media.layerpitch.com/tuto/).
  const KIT = { video: { label: 'music-city-gameplay-muette.mp4', name: 'music-city-gameplay-muette.mp4', url: 'https://media.layerpitch.com/tuto/music-city-gameplay-muette.mp4' } };
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
    // Morceaux du pack « Music City » (api/demo-client.js) et instants clés de la vidéo muette (04/11, en secondes) :
    // porte du club 13,5 · entrée 15,8 · fondu puis la salle se remplit 19,3-20,3 · assis au bar ~24 · glaçons 31,4-33,1 · fin 37,7.
    // Un seul morceau d'un bout à l'autre (05/11) : « Jazz Lo Lay. Add. » démarre sur sa contrebasse, les couches arrivent quand la salle se remplit ;
    // la version le remplace par « Jazz Hi Lay. Add. » (même mode, trois couches aussi).
    const LO = 'bmvzpxrmghud9j', HI = 'bmvidtfhvfa5tt', STREET = 'bmvzsfnd1c3n9o';
    const row = id => document.querySelector(`.track-row-wrapper[data-track-id="${id}"]`); // (la frise de capture porte aussi data-track-id)
    const layerBtn = n => { const r = row(LO); return r ? r.querySelectorAll('.vert-layer-btn')[n] : null; };
    const videoAt = s => { const v = $('#videoCaptureEl'); return !!(v && v.currentTime >= s); };
    // Montage « à la souris » (05/11, demande de Jules-Antoine : « pas en temps réel, ce serait galère ») : pas de capture, on double-clique
    // dans la frise pour poser le départ de la contrebasse (début), de la batterie (~9 s), du clavier (~18 s), les glaçons (32 s) et le
    // verre (~34 s) ; les couches entrent à la mesure suivante (frise). Chaque bloc doit tomber dans sa fenêtre de temps (il se glisse ensuite si besoin). Le jeu en direct a sa propre leçon (page pack).
    const lane = sel => document.querySelector(`#videoCaptureTimeline .vct-lane-track${sel}`);
    const layerLane = (n, id) => lane(`[data-addable="layer"][data-add-track-id="${id || LO}"][data-add-level="${n}"]`);
    const sfxLane = id => lane(`[data-addable="sfx"][data-add-sfx-id="${id}"]`);
    // Fin du bloc de la rue (en secondes), pour l'étape « jusqu'à la porte du club ».
    const blockEnd = el => {
      const tl = $('#videoCaptureTimeline'), total = tl && tl.__vctTotal, bk = el && el.querySelector('.vct-block');
      return bk && total ? (parseFloat(bk.style.left) + parseFloat(bk.style.width)) / 100 * total : null;
    };
    const blockIn = (el, from, to) => {
      const tl = $('#videoCaptureTimeline'), total = tl && tl.__vctTotal;
      return !!(el && total && [...el.querySelectorAll('.vct-block')].some(bk => { const t = parseFloat(bk.style.left) / 100 * total; return t >= from && t <= to; }));
    };
    const swapSel = () => document.querySelector(`#videoCaptureVersioning select[data-track="${LO}"]`);
    const steps = [
      { titleKey: 'pvWelcomeTitle', textKey: 'pvWelcomeText' },
      { selector: '#atelierPackSelect', titleKey: 'pvPackTitle', textKey: 'pvPackText', done: () => !!($('#atelierPackSelect') && $('#atelierPackSelect').value) },
      { selector: '.video-capture-trigger-btn', titleKey: 'pvOpenTitle', textKey: 'pvOpenText', clickDone: true },
      { selector: '#videoCaptureDropzone', titleKey: 'pvVideoTitle', textKey: 'pvVideoText', done: () => !!$('#videoCaptureEl'),
        drops: ready() ? [{ kind: 'file', label: KIT.video.label, url: KIT.video.url, name: KIT.video.name }] : [] },
      // Montage à la souris (05/11) : sans capture, tout se pose dans la frise au double-clic -- la contrebasse dès le début, les autres
      // couches à leur moment, puis les bruitages ; on écoute, puis on enregistre.
      // La rue d'abord (05/11) : l'ambiance « Street+Footsteps », doucement, de 0 s jusqu'à l'entrée dans le club (~16 s).
      { selector: () => layerLane(0, STREET), titleKey: 'pvStreetTitle', textKey: 'pvStreetText', done: () => blockIn(layerLane(0, STREET), 0, 2) },
      { selector: () => layerLane(0, STREET), titleKey: 'pvStreetEndTitle', textKey: 'pvStreetEndText', done: () => { const e = blockEnd(layerLane(0, STREET)); return e != null && e >= 13.5 && e <= 18; } },
      { selector: () => layerLane(0), titleKey: 'pvBassTitle', textKey: 'pvBassText', done: () => blockIn(layerLane(0), 0, 3) },
      { selector: () => layerLane(1), titleKey: 'pvDrumsTitle', textKey: 'pvDrumsText', done: () => blockIn(layerLane(1), 6.5, 11.5) },
      { selector: () => layerLane(2), titleKey: 'pvKeysTitle', textKey: 'pvKeysText', done: () => blockIn(layerLane(2), 15, 20) },
      { selector: () => sfxLane('sfx-glacons'), titleKey: 'pvIceTitle', textKey: 'pvIceText', done: () => blockIn(sfxLane('sfx-glacons'), 30.5, 33.5) },
      { selector: () => sfxLane('sfx-verre'), titleKey: 'pvGlassTitle', textKey: 'pvGlassText', done: () => blockIn(sfxLane('sfx-verre'), 32.5, 38) },
      { selector: '#videoCaptureListenBtn', titleKey: 'pvHearTitle', textKey: 'pvHearText', clickDone: true },
      { selector: '#videoCaptureTitleInput', titleKey: 'pvNameTitle', textKey: 'pvNameText', done: () => !!($('#videoCaptureTitleInput') && $('#videoCaptureTitleInput').value.trim().length > 2),
        drops: [{ kind: 'text', label: 'Music City : de la rue au club', value: 'Music City : de la rue au club' }] },
      { selector: '#videoCaptureSaveBtn', titleKey: 'pvSaveTitle', textKey: 'pvSaveText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="new"]'), titleKey: 'pvNewTitle', textKey: 'pvNewText', clickDone: true },
      { selector: () => swapSel() || $('#videoCaptureVersioning'), titleKey: 'pvPickTitle', textKey: 'pvPickText', done: () => { const sel = swapSel(); return !!(sel && sel.value === HI); } },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="listenDraft"]'), titleKey: 'pvListenTitle', textKey: 'pvListenText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="saveDraft"]'), titleKey: 'pvKeepTitle', textKey: 'pvKeepText', clickDone: true },
      { titleKey: 'pvAtelierEndTitle', textKey: 'pvAtelierEndText', final: true },
    ];
    // Pack déjà choisi (l'atelier vient d'être rechargé sur lui) : on reprend après « choisir le pack ».
    // Sans pack : directement « Choisis le pack » -- l'accueil est déjà fait par la bulle du Backstage, et une bulle sans cible se plaçait au
    // milieu du cadre de l'atelier, souvent hors de l'écran (05/11).
    const run = hasPack ? steps.slice(2) : steps.slice(1, 2);
    const G = window.LayerPitchGuide.create({ tr, onLessonDone: ctx.onDone && hasPack ? (() => ctx.onDone()) : undefined, onOpen: ctx.onOpen, onClose: ctx.onClose });
    return { start: () => { if (!ready()) return false; G.open('lesson', run, 'versioning'); return true; }, guide: G, steps };
  }

  window.LayerPitchAtelierLessons = { init, KIT };
})();
