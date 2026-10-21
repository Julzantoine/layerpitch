/* atelier-lecons.js — partie « atelier » de la leçon guidée « Versioning vidéo » (atelier.html?tuto&lesson=versioning), 21/10.
 *
 * L'atelier vit dans un cadre du Backstage (onglet Vidéo → Atelier) : le Backstage guide jusqu'à l'atelier, ce fichier guide DANS
 * l'atelier (choisir le pack, la vidéo, jouer, enregistrer, versionner), puis rend la main au Backstage (onDone) pour le bloc vidéo.
 * Choisir le pack recharge l'atelier : la leçon reprend alors juste après cette étape (le pack est dans l'adresse).
 *
 * Parcours choisi par Jules-Antoine : partir d'une vidéo SANS son (le gameplay d'« Alone in the Barque »), y poser une première musique en
 * jouant le pack sur la vidéo (capture), enregistrer le montage, puis en faire une deuxième version avec une autre musique de même
 * structure, et l'écouter en direct (sans rendu vidéo). Moteur partagé layerpitch-guide.js ; faux serveur api/demo-client.js (montages
 * et versions gardés en mémoire, rien n'est enregistré). Tant que la vidéo muette n'est pas fournie (KIT.video vide), la leçon reste
 * « bientôt » dans le menu du Backstage.
 */
(function () {
  // Vidéo muette du gameplay (fichier à déposer par Jules-Antoine dans media.layerpitch.com/tuto/).
  const KIT = { video: { label: 'alone-gameplay-muette.mp4', name: 'alone-gameplay-muette.mp4', url: 'https://media.layerpitch.com/tuto/alone-gameplay-muette.mp4' } };
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
    const steps = [
      { titleKey: 'pvWelcomeTitle', textKey: 'pvWelcomeText' },
      { selector: '#atelierPackSelect', titleKey: 'pvPackTitle', textKey: 'pvPackText', done: () => !!($('#atelierPackSelect') && $('#atelierPackSelect').value) },
      { selector: '.video-capture-trigger-btn', titleKey: 'pvOpenTitle', textKey: 'pvOpenText', clickDone: true },
      { selector: '#videoCaptureDropzone', titleKey: 'pvVideoTitle', textKey: 'pvVideoText', done: () => !!$('#videoCaptureEl'),
        drops: ready() ? [{ kind: 'file', label: KIT.video.label, url: KIT.video.url, name: KIT.video.name }] : [] },
      { selector: '.video-capture-arm-track-btn', titleKey: 'pvArmTitle', textKey: 'pvArmText', done: () => !!$('.video-capture-arm-track-btn.armed') },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvRecordTitle', textKey: 'pvRecordText', clickDone: true },
      { selector: () => document.querySelector('[data-track-id] [data-role="playBtn"]'), titleKey: 'pvPlayTitle', textKey: 'pvPlayText' },
      { selector: '#videoCaptureRecordBtn', titleKey: 'pvStopTitle', textKey: 'pvStopText', clickDone: true },
      { selector: '#videoCaptureTitleInput', titleKey: 'pvNameTitle', textKey: 'pvNameText', done: () => !!($('#videoCaptureTitleInput') && $('#videoCaptureTitleInput').value.trim().length > 2),
        drops: [{ kind: 'text', label: 'Alone : traversée, musique 1', value: 'Alone : traversée, musique 1' }] },
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
