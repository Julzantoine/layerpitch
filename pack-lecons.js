/* pack-lecons.js — leçon guidée « Jouer en direct sur une vidéo » sur la page publique d'un pack (pack.html?id=p-music-city&tuto&lesson=live-play), 05/11.
 *
 * Proposée par Jules-Antoine le 05/11 : la leçon « Versioning vidéo » de l'atelier se fait désormais à la souris (gestes posés au double-clic dans la
 * frise) ; le JEU EN DIRECT a donc sa propre leçon, avec l'outil PUBLIC de la page du pack (case « Tester en jeu » / « Mode Test Gameplay ») :
 * le visiteur ouvre la vidéo muette de « Music City » et joue les morceaux du pack pendant qu'elle défile. Rien n'est enregistré.
 * Cadrage (05/11, ses réponses) : vidéo muette « Music City » ; la rue en « Jazz Lo Static », puis, dans le club, « Jazz Lo Lay. Add. »
 * (contrebasse seule, puis batterie et clavier au bon moment) et les « Glaçons » au bar ; menu Tutoriel, thème AdReels, juste après « Vendre des
 * assets audio » ; ton neutre (compositeurs et studios). Réservée aux admins jusqu'à son feu vert (layerpitch-tuto.js, ADMIN_ONLY_LESSONS,
 * et `adminOnly` de la leçon dans src/backstage/43-visite-guidee.js).
 *
 * Chargé à la demande par src/pack/22-lecon-jeu-en-direct.js (jamais pour un visiteur ordinaire). Moteur partagé layerpitch-guide.js ;
 * faux serveur api/demo-client.js (pack « Music City », case « Tester en jeu » cochée). Chaque étape exige son geste (test `done` ou clic).
 */
(function () {
  const LESSON_ID = 'live-play';
  // Vidéo muette du gameplay, déjà en ligne (même fichier que la leçon Versioning de l'atelier, atelier-lecons.js), présentée dans la fenêtre
  // « Tester en jeu » comme une vidéo de la bibliothèque (src/pack/12-test-en-jeu-lecteur-video.js).
  const KIT = { video: { id: 'tuto-music-city-muette', title: 'Music City : gameplay (vidéo muette)', base: 'https://media.layerpitch.com/tuto/', file: 'music-city-gameplay-muette.mp4' } };
  // Morceaux du pack « Music City » (api/demo-client.js) : la rue, puis le club.
  const STREET = 't-jazz-lo', CLUB = 'bmvzpxrmghud9j';
  const active = () => { try { const q = new URLSearchParams(window.location.search); return q.has('tuto') && q.get('lesson') === LESSON_ID; } catch (e) { return false; } };

  function init(ctx) {
    // Textes : ceux de la page (zone pack), puis communs, puis ceux des bulles du Backstage (« Suivant », « Quitter »…), puis français.
    const lang = (ctx && ctx.lang) === 'en' ? 'en' : 'fr';
    const tr = (key, vars) => {
      const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
      let s = null;
      for (const l of [lang, 'fr']) { for (const z of ['pack', 'shared', 'backstage']) { const d = I[l] && I[l][z]; if (d && d[key] != null) { s = d[key]; break; } } if (s != null) break; }
      if (s == null) s = key;
      if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
      return s;
    };
    const $ = sel => document.querySelector(sel);
    const row = id => document.querySelector(`.track-row-wrapper[data-track-id="${id}"]`);
    const playBtn = id => { const r = row(id); return r ? r.querySelector('[data-role="playBtn"]') : null; };
    const playing = id => { const r = row(id); return !!(r && r.lpControl && r.lpControl.isPlaying()); };
    const layerBtn = n => { const r = row(CLUB); return r ? r.querySelectorAll('.vert-layer-btn')[n] : null; };
    const layerOn = n => { const b = layerBtn(n); return !!(b && b.classList.contains('active')) && playing(CLUB); };
    const video = () => $('#videoTestPanel video');
    const videoAt = s => { const v = video(); return !!(v && v.currentTime >= s); };
    // Instants clés de la vidéo muette (v3, 04/11, en secondes) : porte du club 13,5 · entrée 15,8 · la salle se remplit ~20,3 ·
    // assis au bar ~24 · glaçons 31,4-33,1 · fin 37,7. Les textes les donnent ; seule l'entrée dans le club est attendue (on ne
    // lance pas le club dans la rue).
    const steps = [
      { titleKey: 'lpvWelcomeTitle', textKey: 'lpvWelcomeText' },
      { selector: '.video-test-trigger-btn', titleKey: 'lpvOpenTitle', textKey: 'lpvOpenText', clickDone: true, done: () => !!$('#videoTestDialog[open]') || !!video() },
      { selector: '#videoTestLibraryPick', titleKey: 'lpvVideoTitle', textKey: 'lpvVideoText', done: () => !!video() },
      { selector: '#videoTestPanel video', titleKey: 'lpvPlayTitle', textKey: 'lpvPlayText', done: () => { const v = video(); return !!(v && !v.paused && v.currentTime > 0.2); } },
      // La rue : le morceau statique.
      { selector: () => playBtn(STREET), titleKey: 'lpvStreetTitle', textKey: 'lpvStreetText', done: () => playing(STREET) },
      { selector: '#videoTestPanel video', titleKey: 'lpvWalkTitle', textKey: 'lpvWalkText', done: () => videoAt(13.5) },
      // Le club : le morceau à couches, une couche par moment, puis les glaçons au bar (bouton du Sfx dans le lecteur du morceau : il
      // se joue PAR-DESSUS la musique).
      { selector: () => playBtn(CLUB), titleKey: 'lpvClubTitle', textKey: 'lpvClubText', done: () => playing(CLUB) },
      { selector: () => layerBtn(1), titleKey: 'lpvDrumsTitle', textKey: 'lpvDrumsText', done: () => layerOn(1) },
      { selector: () => layerBtn(2), titleKey: 'lpvKeysTitle', textKey: 'lpvKeysText', done: () => layerOn(2) },
      { selector: () => { const r = row(CLUB); return r && r.querySelector('.stinger-btn[data-sfx-id="sfx-glacons"]'); }, titleKey: 'lpvIceTitle', textKey: 'lpvIceText', clickDone: true },
      { titleKey: 'lpvEndTitle', textKey: 'lpvEndText', final: true },
    ];
    const backstageLesson = id => 'layerpitch-backstage.html?tuto&lesson=' + encodeURIComponent(id) + '&lang=' + lang;
    const G = window.LayerPitchGuide.create({
      tr,
      // Leçon suivante du menu (thème AdReels) : « Intégrer son lecteur interactif sur un site », dans le Backstage.
      nextLesson: () => ({ lesson: { id: 'embed', titleKey: 'leTitle' }, n: parseInt(tr('leTitle'), 10) || 7 }), // numéro lu dans son titre (« 7 · … »)
      startLesson: id => { window.location.href = backstageLesson(id); },
      onLessonDone: id => { try { const d = JSON.parse(localStorage.getItem('layerpitch_lessons_done_v1') || '{}'); d[id] = true; localStorage.setItem('layerpitch_lessons_done_v1', JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } },
    });
    return { start: () => { G.open('lesson', steps, LESSON_ID); return true; }, guide: G, steps };
  }

  window.LayerPitchPackLessons = { init, KIT, active, LESSON_ID, STREET, CLUB };
})();
