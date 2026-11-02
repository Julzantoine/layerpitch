/* projet-lecons.js — leçons guidées « Préproduction » de l'espace Projet (projet.html?tuto), 20/10.
 *
 * Utilise le moteur partagé layerpitch-guide.js (le même que les leçons du Backstage). La page projet.html fournit son
 * contexte à init() : { tr, S, $ } (traduction, état de la page, accès aux éléments). Chaque leçon travaille sur le Projet
 * fictif « Music City » (api/demo-projects.js) : rien n'est enregistré, tout repart de zéro au rechargement.
 *
 * Le kit de chaque leçon (textes à déposer, liens) est déclaré en tête : à compléter avec les vrais liens quand ils
 * seront fournis ; une étape qui dépend d'un kit encore vide est sautée (skip).
 */
(function () {
  // Références musicales à déposer dans le Moodboard (une par service, pour montrer la reconnaissance automatique).
  // Format : { label, value (adresse) }. Décidé le 20/10 : un lien YouTube et un lien Spotify ; choisis le 02/11 pour « Music City »
  // (Hi-Fi Rush : tout le monde bat au rythme de la musique ; Persona 5 : jazz urbain de nuit). Image du Moodboard : LESSON_IMAGES.
  const LESSON_LINKS = [
    { label: 'Hi-Fi Rush (YouTube)', value: 'https://www.youtube.com/watch?v=O2i1Vq3Odbg' },
    { label: 'Persona 5 OST (Spotify)', value: 'https://open.spotify.com/album/4pJT0WKggr4xk149X8A6KC' },
  ];
  const LESSON_IMAGES = []; // [{ label, name, url }]

  // Sons d'exemple de la carte : { label, name, url }. Fond d'ambiance général : VIDE tant qu'aucun fichier n'est choisi (étapes sautées).
  // Musique par ville (02/11) : les boucles des quatre villes de « Music City », déclarées dans api/demo-projects.js (CITY_MUSIC).
  const MAP_AMBIANCE = [];
  const MAP_MUSIC = (window.LayerPitchDemoProjects && window.LayerPitchDemoProjects.CITY_MUSIC) || {}; // { jazz, rock, disco, synth }

  const LESSON_THEME_ID = 'preprod';
  // Leçons de cette page, dans l'ordre du menu. Les textes sont dans la zone « projects » de layerpitch-i18n.js.
  const LESSON_LIST = [
    { id: 'pj-create', theme: LESSON_THEME_ID, page: 'projets', titleKey: 'plCreateTitle', descKey: 'plCreateDesc' },
    { id: 'pj-chat', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plChatTitle', descKey: 'plChatDesc' },
    { id: 'pj-moodboard', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plBoardTitle', descKey: 'plBoardDesc' },
    { id: 'pj-music', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plMusicTitle', descKey: 'plMusicDesc' },
    { id: 'pj-map-build', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plMapBuildTitle', descKey: 'plMapBuildDesc' },
    { id: 'pj-map-music', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plMapMusicTitle', descKey: 'plMapMusicDesc' },
    { id: 'pj-map-walk', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plMapWalkTitle', descKey: 'plMapWalkDesc' },
    // « bientôt » tant que les deux vidéos de « Music City » (music-city-gameplay-musique1/2.mp4) ne sont pas en ligne (media.layerpitch.com/tuto/).
    { id: 'pj-annotate', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plAnnTitle', descKey: 'plAnnDesc', soon: true },
  ];

  function init(ctx) {
    const { S, $ } = ctx;
    const hasText = id => !!($(id) && $(id).value.trim().length > 1);
    const secMsgCount = () => (S.secMsgs || []).length;
    // ---- Carte de niveau : retrouver un élément du dessin par son nom (le dessin est refait à chaque geste) ----
    const nodeEls = () => [...document.querySelectorAll('#lmSvg [data-node]')];
    const nodeEl = label => nodeEls().find(g => g.textContent.includes(label)) || null;
    const nodeCount = () => nodeEls().length;
    const edgeCount = () => document.querySelectorAll('#lmSvg [data-edge]').length;
    const isHere = label => { const g = nodeEl(label); return !!(g && g.classList.contains('here')); };
    const linking = () => !!document.querySelector('#lmSvg .link-from');
    // Cible d'un trait à tracer : le premier lieu tant qu'aucun n'est choisi, puis le second.
    const linkTarget = (a, b) => () => (linking() ? nodeEl(b) : nodeEl(a));
    const label = (text) => ({ kind: 'text', label: text, value: text });
    const labelStep = (name, text) => ({ selector: '#lmLabel', titleKey: 'plMapLabelTitle', textKey: 'plMapLabelText', textVars: { name: text }, done: () => !!nodeEl(text), drops: [label(text)] });
    const hasAmbiance = () => MAP_AMBIANCE.length > 0;
    const fileDrops = list => list.map(f => ({ kind: 'file', label: f.label, url: f.url, name: f.name }));
    // Bulles de leçon : même moteur que le Backstage, textes cherchés dans la page, puis dans la zone du Backstage
    // (boutons « Suivant », « Quitter »…) puis en français.
    function tr(key, vars) {
      const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
      const zones = l => [I[l] && I[l].projects, I[l] && I[l].shared, I[l] && I[l].backstage];
      let s = null;
      for (const l of [ctx.lang, 'fr']) { for (const z of zones(l)) { if (z && z[key] != null) { s = z[key]; break; } } if (s != null) break; }
      if (s == null) s = key;
      if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
      return s;
    }
    const lessons = {
      'pj-create': [
        { titleKey: 'plCreateWelcomeTitle', textKey: 'plCreateWelcomeText' },
        { selector: '#newTitle', titleKey: 'plCreateNameTitle', textKey: 'plCreateNameText', done: () => hasText('newTitle'),
          drops: [{ kind: 'text', label: 'Music City', value: 'Music City' }] },
        { selector: '#newDesc', titleKey: 'plCreateDescTitle', textKey: 'plCreateDescText', done: () => hasText('newDesc'),
          drops: [{ kind: 'text', label: 'Jeu d’exploration musicale. Quatre villes, un style par ville, un seul tempo.', value: 'Jeu d’exploration musicale. Quatre villes, un style par ville, un seul tempo.' }] },
        { selector: '#createBtn', titleKey: 'plCreateBtnTitle', textKey: 'plCreateBtnText', clickDone: true, done: () => !!document.querySelector('a.row') },
        { selector: 'a.row', titleKey: 'plCreateDoneTitle', textKey: 'plCreateDoneText', final: true },
      ],
      // Arrivée depuis le Backstage pour une leçon du projet : on ouvre le projet d'exemple, la leçon demandée démarre à l'intérieur.
      'pj-open': [
        { selector: 'a.row', titleKey: 'plOpenTitle', textKey: 'plOpenText', clickDone: true },
      ],
      'pj-chat': [
        { titleKey: 'plChatWelcomeTitle', textKey: 'plChatWelcomeText' },
        { selector: '#newMsg', titleKey: 'plChatWriteTitle', textKey: 'plChatWriteText', done: () => hasText('newMsg'),
          drops: [{ kind: 'text', label: 'On valide la carte jeudi ?', value: 'On valide la carte jeudi ?' }] },
        { selector: '#sendBtn', titleKey: 'plChatSendTitle', textKey: 'plChatSendText', clickDone: true },
        { selector: '#chanSel', titleKey: 'plChatChannelTitle', textKey: 'plChatChannelText', done: () => !!S.chan },
        { selector: '#newMsg', titleKey: 'plChatSectionWriteTitle', textKey: 'plChatSectionWriteText', done: () => hasText('newMsg'),
          drops: [{ kind: 'text', label: 'Ici, on reste feutré : contrebasse et balais.', value: 'Ici, on reste feutré : contrebasse et balais.' }] },
        { selector: '#sendBtn', titleKey: 'plChatSendTitle', textKey: 'plChatSectionSendText', done: () => secMsgCount() > 0 },
        { titleKey: 'plChatDoneTitle', textKey: 'plChatDoneText', final: true },
      ],
      'pj-music': [
        { titleKey: 'plMusicWelcomeTitle', textKey: 'plMusicWelcomeText' },
        { selector: '.tab[data-tab="music"]', titleKey: 'plMusicTabTitle', textKey: 'plMusicTabText', done: () => S.tab === 'music' },
        { selector: () => document.querySelector('#panel .list-row'), titleKey: 'plMusicSharedTitle', textKey: 'plMusicSharedText' },
        { selector: '#myPack', titleKey: 'plMusicPickTitle', textKey: 'plMusicPickText' },
        { selector: '#shareBtn', titleKey: 'plMusicShareTitle', textKey: 'plMusicShareText', clickDone: true, done: () => (S.content.packs || []).some(p => p.mine) },
        { titleKey: 'plMusicDoneTitle', textKey: 'plMusicDoneText', final: true },
      ],
      // Annoter un montage vidéo (21/10, suite de la leçon « Versioning » du Backstage) : onglet Vidéos, choisir la version, noter à un
      // instant (la note retient l'instant ET la version regardée), l'adresser au studio.
      'pj-annotate': [
        { titleKey: 'plAnnWelcomeTitle', textKey: 'plAnnWelcomeText' },
        { selector: '.tab[data-tab="videos"]', titleKey: 'plAnnTabTitle', textKey: 'plAnnTabText', done: () => S.tab === 'videos' },
        { selector: '#montageGrid .lp-video-versions select', titleKey: 'plAnnVersionTitle', textKey: 'plAnnVersionText' },
        { selector: '#montageGrid video', titleKey: 'plAnnPlayTitle', textKey: 'plAnnPlayText' },
        { selector: '#montageGrid [data-act="notes"]', titleKey: 'plAnnOpenTitle', textKey: 'plAnnOpenText',
          done: () => !!document.querySelector('#montageGrid [data-role="noteHere"]') },
        { selector: '#montageGrid [data-role="noteHere"]', titleKey: 'plAnnHereTitle', textKey: 'plAnnHereText',
          done: () => { const l = document.querySelector('#montageGrid [data-role="noteAtLabel"]'); return !!(l && l.textContent.trim()); } },
        { selector: '#montageGrid [data-role="noteBody"]', titleKey: 'plAnnBodyTitle', textKey: 'plAnnBodyText',
          done: () => { const t = document.querySelector('#montageGrid [data-role="noteBody"]'); return !!(t && t.value.trim().length > 3); },
          drops: [label('Ici, le club se remplit trop tôt : attendre que le joueur ait passé la porte.')] },
        { selector: '#montageGrid [data-role="noteTo"]', titleKey: 'plAnnToTitle', textKey: 'plAnnToText' },
        { selector: '#montageGrid [data-role="noteAdd"]', titleKey: 'plAnnAddTitle', textKey: 'plAnnAddText',
          done: () => !!document.querySelector('#montageGrid [data-note]') },
        { titleKey: 'plAnnDoneTitle', textKey: 'plAnnDoneText', final: true },
      ],
      'pj-moodboard': [
        { titleKey: 'plBoardWelcomeTitle', textKey: 'plBoardWelcomeText' },
        { selector: '.tab[data-tab="board"]', titleKey: 'plBoardTabTitle', textKey: 'plBoardTabText', done: () => S.tab === 'board' },
        { selector: '#addKind', titleKey: 'plBoardKindTitle', textKey: 'plBoardKindText', done: () => $('addKind') && $('addKind').value === 'note' },
        { selector: '#fTitle', titleKey: 'plBoardNoteTitleTitle', textKey: 'plBoardNoteTitleText', done: () => hasText('fTitle'),
          drops: [{ kind: 'text', label: 'Le bar du club', value: 'Le bar du club' }] },
        { selector: '#fBody', titleKey: 'plBoardNoteBodyTitle', textKey: 'plBoardNoteBodyText', done: () => hasText('fBody'),
          drops: [{ kind: 'text', label: 'Au bar : les glaçons dans les verres, par-dessus la musique.', value: 'Au bar : les glaçons dans les verres, par-dessus la musique.' }] },
        { selector: '#addBtn', titleKey: 'plBoardAddTitle', textKey: 'plBoardAddText', clickDone: true },
        // Déposer un lien (YouTube, Spotify…) : reconnu automatiquement, lecteur intégré. Sauté tant que le kit est vide.
        { selector: '#grid', titleKey: 'plBoardLinkTitle', textKey: 'plBoardLinkText', skip: () => !LESSON_LINKS.length,
          done: () => (S.content.assets || []).some(a => a.url && LESSON_LINKS.some(l => l.value === a.url)),
          drops: LESSON_LINKS.map(l => ({ kind: 'link', label: l.label, value: l.value })) },
        // Déposer une image : elle devient un objet du Projet et apparaît dans le tableau (sauté tant que le fichier n'est pas fourni).
        { selector: '#grid', titleKey: 'plBoardImageTitle', textKey: 'plBoardImageText', skip: () => !LESSON_IMAGES.length,
          done: () => (S.content.assets || []).some(a => a.kind === 'image'), drops: LESSON_IMAGES.map(f => ({ kind: 'file', label: f.label, url: f.url, name: f.name })) },
        { selector: '#secNav', titleKey: 'plBoardSectionTitle', textKey: 'plBoardSectionText', done: () => !!S.sections && S.sel !== 'all' && S.sel !== 'none' },
        { titleKey: 'plBoardDoneTitle', textKey: 'plBoardDoneText', final: true },
      ],
    };

    lessons['pj-map-build'] = [
      { titleKey: 'plMapWelcomeTitle', textKey: 'plMapWelcomeText' },
      { selector: '.tab[data-tab="map"]', titleKey: 'plMapTabTitle', textKey: 'plMapTabText', done: () => S.tab === 'map' },
      { selector: '#lmNew', titleKey: 'plMapNewTitle', textKey: 'plMapNewText', clickDone: true },
      { selector: '#lmAskOverlay input', titleKey: 'plMapNameTitle', textKey: 'plMapNameText', done: () => { const i = document.querySelector('#lmAskOverlay input'); return !!i && i.value.trim().length > 1; },
        drops: [label('Music City')] },
      { selector: '#lmAskOverlay [type="submit"]', titleKey: 'plMapCreateTitle', textKey: 'plMapCreateText', done: () => !!$('lmSettings') },
      // Ambiance générale : un fond sonore qui tourne sous toute la carte (sauté tant que le fichier n'est pas fourni).
      { selector: '#lmSettings summary', titleKey: 'plMapSettingsTitle', textKey: 'plMapSettingsText', skip: () => !hasAmbiance(), done: () => !!($('lmSettings') && $('lmSettings').open) },
      { selector: '#lmRoomZone', titleKey: 'plMapAmbianceTitle', textKey: 'plMapAmbianceText', skip: () => !hasAmbiance(), done: () => !!document.querySelector('#lmRoomZone .lm-sound'), drops: fileDrops(MAP_AMBIANCE) },
      // Les lieux : le début de niveau est Jazz City ; puis Rock City, le carrefour, qui mène à Disco City (sa boîte de nuit est au niveau 2) et à Synth City.
      { selector: '[data-add="start"]', titleKey: 'plMapStartTitle', textKey: 'plMapStartText', done: () => nodeCount() >= 1 },
      labelStep('start', 'Jazz City'),
      { selector: '[data-add="place"]', titleKey: 'plMapPlaceTitle', textKey: 'plMapPlaceText', done: () => nodeCount() >= 2 },
      labelStep('rock', 'Rock City'),
      { selector: '[data-add="place"]', titleKey: 'plMapPlace2Title', textKey: 'plMapPlace2Text', done: () => nodeCount() >= 3 },
      labelStep('disco', 'Disco City'),
      { selector: '#lmNote', titleKey: 'plMapManorNoteTitle', textKey: 'plMapManorNoteText', done: () => !!($('lmNote') && /niveau 2/i.test($('lmNote').value)),
        drops: [{ kind: 'text', label: 'La boîte de nuit de Disco City : sa carte est au niveau 2.', value: 'La boîte de nuit de Disco City : sa carte est au niveau 2.' }] },
      { selector: '[data-add="place"]', titleKey: 'plMapPlace3Title', textKey: 'plMapPlace3Text', done: () => nodeCount() >= 4 },
      labelStep('synth', 'Synth City'),
      // Les parcours : relier les lieux.
      { selector: '#lmConnect', titleKey: 'plMapConnectTitle', textKey: 'plMapConnectText', done: () => !!($('lmConnect') && $('lmConnect').classList.contains('primary')) },
      { selector: linkTarget('Jazz City', 'Rock City'), titleKey: 'plMapLink1Title', textKey: 'plMapLink1Text', done: () => edgeCount() >= 1 },
      { selector: linkTarget('Rock City', 'Disco City'), titleKey: 'plMapLink2Title', textKey: 'plMapLink2Text', done: () => edgeCount() >= 2 },
      { selector: linkTarget('Rock City', 'Synth City'), titleKey: 'plMapLink3Title', textKey: 'plMapLink3Text', done: () => edgeCount() >= 3 },
      { selector: '#lmConnect', titleKey: 'plMapDisconnectTitle', textKey: 'plMapDisconnectText', done: () => !($('lmConnect') && $('lmConnect').classList.contains('primary')) },
      // Un point de transition sur un parcours : le fichier qui se jouera quand on le traverse.
      { selector: () => document.querySelector('#lmSvg [data-edge]'), titleKey: 'plMapEdgeTitle', textKey: 'plMapEdgeText', done: () => !!$('lmSplitT') },
      { selector: '#lmSplitT', titleKey: 'plMapTransitionTitle', textKey: 'plMapTransitionText', done: () => nodeEls().some(g => g.textContent.includes('⇢')) },
      { titleKey: 'plMapBuildDoneTitle', textKey: 'plMapBuildDoneText', final: true },
    ];
    // Leçons « musique » (glisser la boucle de chaque ville sur son lieu) et « balade » (la carte a déjà sa musique, voir seedMapMusic).
    // L'onglet Carte d'abord : la carte d'exemple s'y ouvre toute seule.
    const mapTabStep = { selector: '.tab[data-tab="map"]', titleKey: 'plMapTabTitle', textKey: 'plMapTabText', done: () => S.tab === 'map' && !!document.querySelector('#lmSvg') };
    lessons['pj-map-music'] = [
      { titleKey: 'plMapMusicWelcomeTitle', textKey: 'plMapMusicWelcomeText' },
      mapTabStep,
      ...['jazz:Jazz City', 'rock:Rock City', 'disco:Disco City', 'synth:Synth City'].map(x => { const [k, name] = x.split(':'); return {
        selector: () => nodeEl(name), titleKey: 'plMapMusicDropTitle', textKey: 'plMapMusicDropText', textVars: { name }, skip: () => !MAP_MUSIC[k],
        done: () => { const g = nodeEl(name); return !!g && /♪/.test(g.textContent); }, drops: MAP_MUSIC[k] ? fileDrops([MAP_MUSIC[k]]) : [] }; }),
      { titleKey: 'plMapMusicDoneTitle', textKey: 'plMapMusicDoneText', final: true },
    ];
    lessons['pj-map-walk'] = [
      { titleKey: 'plMapWalkWelcomeTitle', textKey: 'plMapWalkWelcomeText' },
      mapTabStep,
      { selector: '#lmPlay', titleKey: 'plMapWalkStartTitle', textKey: 'plMapWalkStartText', done: () => !!document.querySelector('#lmCanvas.playing') },
      { selector: () => nodeEl('Jazz City'), titleKey: 'plMapWalkCabinTitle', textKey: 'plMapWalkCabinText', done: () => isHere('Jazz City') },
      { selector: () => nodeEl('Rock City'), titleKey: 'plMapWalkForestTitle', textKey: 'plMapWalkForestText', done: () => isHere('Rock City') },
      { selector: () => nodeEl('Disco City'), titleKey: 'plMapWalkManorTitle', textKey: 'plMapWalkManorText', done: () => isHere('Disco City') },
      { titleKey: 'plMapWalkDoneTitle', textKey: 'plMapWalkDoneText', final: true },
    ];

    // 2e bulle (02/11) : « Ce qu’on va construire », le schéma du résultat final (layerpitch-lesson-previews.js), juste après l’accueil.
    const PV = window.LayerPitchLessonPreviews;
    if (PV) Object.keys(lessons).forEach(id => { if (PV.has(id)) lessons[id].splice(1, 0, PV.step(id)); });

    const G = window.LayerPitchGuide.create({
      tr,
      cardExtras: step => (step.preview && PV ? PV.html(step.preview, tr) : ''),
      textVars: step => step.textVars || {},
      nextLesson: lessonId => {
        const i = LESSON_LIST.findIndex(l => l.id === lessonId), next = i >= 0 ? LESSON_LIST[i + 1] : null;
        return next ? { lesson: next, n: i + 1 + 1 } : null;
      },
      startLesson: id => start(id),
      onLessonDone: id => { try { const d = JSON.parse(localStorage.getItem('layerpitch_lessons_done_v1') || '{}'); d[id] = true; localStorage.setItem('layerpitch_lessons_done_v1', JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } },
    });
    function start(id) {
      const steps = lessons[id];
      const meta = LESSON_LIST.find(l => l.id === id);
      if (!steps || (meta && meta.soon)) return false;
      G.open('lesson', steps, id);
      return true;
    }
    return { start, close: () => G.close(), list: LESSON_LIST, guide: G, tr };
  }

  window.LayerPitchProjetLessons = { init, LESSON_LIST, LESSON_LINKS, LESSON_IMAGES, MAP_AMBIANCE, MAP_MUSIC };
})();
