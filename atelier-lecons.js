/* atelier-lecons.js — partie « atelier » de la leçon guidée « Versioning vidéo » (atelier.html?tuto&lesson=versioning), 21/10.
 *
 * L'atelier vit dans un cadre du Backstage (onglet Vidéo → Atelier) : le Backstage guide jusqu'à l'atelier, ce fichier guide DANS
 * l'atelier (choisir le pack, la vidéo, jouer, enregistrer, versionner), puis rend la main au Backstage (onDone) pour le bloc vidéo.
 * Choisir le pack recharge l'atelier : la leçon reprend alors juste après cette étape (le pack est dans l'adresse).
 *
 * Parcours choisi par Jules-Antoine : partir d'une vidéo SANS son (le gameplay de « Music City » : la rue de Jazz City, puis le club), y poser une première musique en
 * jouant le pack sur la vidéo (capture), enregistrer le montage, puis en faire une deuxième version où chaque morceau est remplacé par un
 * autre du même mode (le statique de la rue par un statique, les couches du club par des couches), et l'écouter en direct (sans rendu vidéo). Moteur partagé layerpitch-guide.js ; faux serveur api/demo-client.js (montages
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
    const STREET = 't-jazz-lo', CLUB = 'bmvidtfhvfa5tt';
    const row = id => document.querySelector(`.track-row-wrapper[data-track-id="${id}"]`); // (la frise de capture porte aussi data-track-id)
    const layerBtn = n => { const r = row(CLUB); return r ? r.querySelectorAll('.vert-layer-btn')[n] : null; };
    const videoAt = s => { const v = $('#videoCaptureEl'); return !!(v && v.currentTime >= s); };
    const steps = [
      { titleKey: 'pvWelcomeTitle', textKey: 'pvWelcomeText' },
      { selector: '#atelierPackSelect', titleKey: 'pvPackTitle', textKey: 'pvPackText', done: () => !!($('#atelierPackSelect') && $('#atelierPackSelect').value) },
      { selector: '.video-capture-trigger-btn', titleKey: 'pvOpenTitle', textKey: 'pvOpenText', clickDone: true },
      { selector: '#videoCaptureDropzone', titleKey: 'pvVideoTitle', textKey: 'pvVideoText', done: () => !!$('#videoCaptureEl'),
        drops: ready() ? [{ kind: 'file', label: KIT.video.label, url: KIT.video.url, name: KIT.video.name }] : [] },
      // Passage 1, la rue : le morceau statique, armé, démarre avec la vidéo.
      { selector: () => row(STREET) && row(STREET).querySelector('.video-capture-arm-track-btn'), titleKey: 'pvArmTitle', textKey: 'pvArmText',
        done: () => !!(row(STREET) && row(STREET).querySelector('.video-capture-arm-track-btn.armed')) },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvRecordTitle', textKey: 'pvRecordText', clickDone: true },
      { selector: '#videoCaptureEl', titleKey: 'pvStreetTitle', textKey: 'pvStreetText', done: () => videoAt(13) },
      // Passage 2, le club : le morceau à couches, une couche par musicien, puis les glaçons au bar.
      { selector: () => row(CLUB) && row(CLUB).querySelector('[data-role="playBtn"]'), titleKey: 'pvClubTitle', textKey: 'pvClubText', clickDone: true },
      { selector: () => layerBtn(1), titleKey: 'pvDrumsTitle', textKey: 'pvDrumsText', clickDone: true },
      { selector: () => layerBtn(2), titleKey: 'pvKeysTitle', textKey: 'pvKeysText', clickDone: true },
      { selector: () => row(CLUB) && row(CLUB).querySelector('.stinger-btn[data-sfx-id="sfx-glacons"]'), titleKey: 'pvIceTitle', textKey: 'pvIceText', clickDone: true },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvStopTitle', textKey: 'pvStopText', clickDone: true },
      { selector: '#videoCaptureTitleInput', titleKey: 'pvNameTitle', textKey: 'pvNameText', done: () => !!($('#videoCaptureTitleInput') && $('#videoCaptureTitleInput').value.trim().length > 2),
        drops: [{ kind: 'text', label: 'Music City : de la rue au club', value: 'Music City : de la rue au club' }] },
      { selector: '#videoCaptureSaveBtn', titleKey: 'pvSaveTitle', textKey: 'pvSaveText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="new"]'), titleKey: 'pvNewTitle', textKey: 'pvNewText', clickDone: true },
      { selector: '#videoCaptureVersioning', titleKey: 'pvPickTitle', textKey: 'pvPickText' },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="listenDraft"]'), titleKey: 'pvListenTitle', textKey: 'pvListenText', clickDone: true },
      { selector: () => document.querySelector('#videoCaptureVersioning [data-act="saveDraft"]'), titleKey: 'pvKeepTitle', textKey: 'pvKeepText', clickDone: true },
      { titleKey: 'pvAtelierEndTitle', textKey: 'pvAtelierEndText', final: true },
    ];
    // Pack déjà choisi (l'atelier vient d'être rechargé sur lui) : on reprend après « choisir le pack ».
    const run = hasPack ? steps.slice(2) : steps.slice(0, 2);
    const G = window.LayerPitchGuide.create({ tr, onLessonDone: ctx.onDone && hasPack ? (() => ctx.onDone()) : undefined });
    return { start: () => { if (!ready()) return false; G.open('lesson', run, 'versioning'); return true; }, guide: G, steps };
  }

  window.LayerPitchAtelierLessons = { init, KIT };
})();
