/* projet-lecons.js — leçons guidées « Préproduction » de l'espace Projet (projet.html?tuto), 20/10.
 *
 * Utilise le moteur partagé layerpitch-guide.js (le même que les leçons du Backstage). La page projet.html fournit son
 * contexte à init() : { tr, S, $ } (traduction, état de la page, accès aux éléments). Chaque leçon travaille sur le Projet
 * fictif « Alone in the Barque » (api/demo-projects.js) : rien n'est enregistré, tout repart de zéro au rechargement.
 *
 * Le kit de chaque leçon (textes à déposer, liens) est déclaré en tête : à compléter avec les vrais liens quand ils
 * seront fournis ; une étape qui dépend d'un kit encore vide est sautée (skip).
 */
(function () {
  // Références musicales à déposer dans le Moodboard (une par service, pour montrer la reconnaissance automatique).
  // Format : { label, value (adresse) }. VIDE tant que les liens ne sont pas fournis : l'étape « dépose un lien » est sautée.
  // Décidé le 20/10 : un lien YouTube et un lien Spotify. Image du Moodboard (fichier d'exemple à fournir) : LESSON_IMAGES.
  const LESSON_LINKS = [];
  const LESSON_IMAGES = []; // [{ label, name, url }]

  // Sons d'exemple de la carte (fichiers à fournir) : { label, name, url }. VIDES tant que les fichiers ne sont pas là : les étapes qui
  // en dépendent sont sautées, et les leçons « musique » et « balade » restent marquées « bientôt » dans le menu du Backstage.
  const MAP_AMBIANCE = [];   // fond d'ambiance général de la carte (forêt la nuit, eau, vent…)
  const MAP_MUSIC = {};      // musique par lieu : { cabane: {label,name,url}, foret: …, manoir: …, scierie: … }

  const LESSON_THEME_ID = 'preprod';
  // Leçons de cette page, dans l'ordre du menu. Les textes sont dans la zone « projects » de layerpitch-i18n.js.
  const LESSON_LIST = [
    { id: 'pj-create', theme: LESSON_THEME_ID, page: 'projets', titleKey: 'plCreateTitle', descKey: 'plCreateDesc' },
    { id: 'pj-chat', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plChatTitle', descKey: 'plChatDesc' },
    { id: 'pj-moodboard', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plBoardTitle', descKey: 'plBoardDesc' },
    { id: 'pj-map-build', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plMapBuildTitle', descKey: 'plMapBuildDesc' },
    { id: 'pj-map-music', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plMapMusicTitle', descKey: 'plMapMusicDesc', soon: true },
    { id: 'pj-map-walk', theme: LESSON_THEME_ID, page: 'projet', titleKey: 'plMapWalkTitle', descKey: 'plMapWalkDesc', soon: true },
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
          drops: [{ kind: 'text', label: 'Alone in the Barque', value: 'Alone in the Barque' }] },
        { selector: '#newDesc', titleKey: 'plCreateDescTitle', textKey: 'plCreateDescText', done: () => hasText('newDesc'),
          drops: [{ kind: 'text', label: 'Jeu d’horreur lacustre. Quatre zones, une menace qui se rapproche, le silence comme récompense.', value: 'Jeu d’horreur lacustre. Quatre zones, une menace qui se rapproche, le silence comme récompense.' }] },
        { selector: '#createBtn', titleKey: 'plCreateBtnTitle', textKey: 'plCreateBtnText', clickDone: true, done: () => !!document.querySelector('a.row') },
        { selector: 'a.row', titleKey: 'plCreateDoneTitle', textKey: 'plCreateDoneText', final: true },
      ],
      'pj-chat': [
        { titleKey: 'plChatWelcomeTitle', textKey: 'plChatWelcomeText' },
        { selector: '#newMsg', titleKey: 'plChatWriteTitle', textKey: 'plChatWriteText', done: () => hasText('newMsg'),
          drops: [{ kind: 'text', label: 'On valide la carte jeudi ?', value: 'On valide la carte jeudi ?' }] },
        { selector: '#sendBtn', titleKey: 'plChatSendTitle', textKey: 'plChatSendText', clickDone: true },
        { selector: '#chanSel', titleKey: 'plChatChannelTitle', textKey: 'plChatChannelText', done: () => !!S.chan },
        { selector: '#newMsg', titleKey: 'plChatSectionWriteTitle', textKey: 'plChatSectionWriteText', done: () => hasText('newMsg'),
          drops: [{ kind: 'text', label: 'Ici, seulement le feu de bois et un piano.', value: 'Ici, seulement le feu de bois et un piano.' }] },
        { selector: '#sendBtn', titleKey: 'plChatSendTitle', textKey: 'plChatSectionSendText', done: () => secMsgCount() > 0 },
        { titleKey: 'plChatDoneTitle', textKey: 'plChatDoneText', final: true },
      ],
      'pj-moodboard': [
        { titleKey: 'plBoardWelcomeTitle', textKey: 'plBoardWelcomeText' },
        { selector: '.tab[data-tab="board"]', titleKey: 'plBoardTabTitle', textKey: 'plBoardTabText', done: () => S.tab === 'board' },
        { selector: '#addKind', titleKey: 'plBoardKindTitle', textKey: 'plBoardKindText', done: () => $('addKind') && $('addKind').value === 'note' },
        { selector: '#fTitle', titleKey: 'plBoardNoteTitleTitle', textKey: 'plBoardNoteTitleText', done: () => hasText('fTitle'),
          drops: [{ kind: 'text', label: 'Silence à la cabane', value: 'Silence à la cabane' }] },
        { selector: '#fBody', titleKey: 'plBoardNoteBodyTitle', textKey: 'plBoardNoteBodyText', done: () => hasText('fBody'),
          drops: [{ kind: 'text', label: 'Refuge : feu de bois et un accord de piano, rien d’autre.', value: 'Refuge : feu de bois et un accord de piano, rien d’autre.' }] },
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
        drops: [label('Alone in the Barque')] },
      { selector: '#lmAskOverlay [type="submit"]', titleKey: 'plMapCreateTitle', textKey: 'plMapCreateText', done: () => !!$('lmSettings') },
      // Ambiance générale : un fond sonore qui tourne sous toute la carte (sauté tant que le fichier n'est pas fourni).
      { selector: '#lmSettings summary', titleKey: 'plMapSettingsTitle', textKey: 'plMapSettingsText', skip: () => !hasAmbiance(), done: () => !!($('lmSettings') && $('lmSettings').open) },
      { selector: '#lmRoomZone', titleKey: 'plMapAmbianceTitle', textKey: 'plMapAmbianceText', skip: () => !hasAmbiance(), done: () => !!document.querySelector('#lmRoomZone .lm-sound'), drops: fileDrops(MAP_AMBIANCE) },
      // Les lieux : le début de niveau est la cabane ; autour, la forêt, le manoir (sa carte est au niveau 2) et une scierie.
      { selector: '[data-add="start"]', titleKey: 'plMapStartTitle', textKey: 'plMapStartText', done: () => nodeCount() >= 1 },
      labelStep('start', 'La cabane'),
      { selector: '[data-add="place"]', titleKey: 'plMapPlaceTitle', textKey: 'plMapPlaceText', done: () => nodeCount() >= 2 },
      labelStep('forest', 'La forêt'),
      { selector: '[data-add="place"]', titleKey: 'plMapPlace2Title', textKey: 'plMapPlace2Text', done: () => nodeCount() >= 3 },
      labelStep('manor', 'Le manoir'),
      { selector: '#lmNote', titleKey: 'plMapManorNoteTitle', textKey: 'plMapManorNoteText', done: () => !!($('lmNote') && /niveau 2/i.test($('lmNote').value)),
        drops: [{ kind: 'text', label: 'Entrée du manoir : sa carte est au niveau 2.', value: 'Entrée du manoir : sa carte est au niveau 2.' }] },
      { selector: '[data-add="place"]', titleKey: 'plMapPlace3Title', textKey: 'plMapPlace3Text', done: () => nodeCount() >= 4 },
      labelStep('mill', 'La scierie'),
      // Les parcours : relier les lieux.
      { selector: '#lmConnect', titleKey: 'plMapConnectTitle', textKey: 'plMapConnectText', done: () => !!($('lmConnect') && $('lmConnect').classList.contains('primary')) },
      { selector: linkTarget('La cabane', 'La forêt'), titleKey: 'plMapLink1Title', textKey: 'plMapLink1Text', done: () => edgeCount() >= 1 },
      { selector: linkTarget('La forêt', 'Le manoir'), titleKey: 'plMapLink2Title', textKey: 'plMapLink2Text', done: () => edgeCount() >= 2 },
      { selector: linkTarget('La forêt', 'La scierie'), titleKey: 'plMapLink3Title', textKey: 'plMapLink3Text', done: () => edgeCount() >= 3 },
      { selector: '#lmConnect', titleKey: 'plMapDisconnectTitle', textKey: 'plMapDisconnectText', done: () => !($('lmConnect') && $('lmConnect').classList.contains('primary')) },
      // Un point de transition sur un parcours : le fichier qui se jouera quand on le traverse.
      { selector: () => document.querySelector('#lmSvg [data-edge]'), titleKey: 'plMapEdgeTitle', textKey: 'plMapEdgeText', done: () => !!$('lmSplitT') },
      { selector: '#lmSplitT', titleKey: 'plMapTransitionTitle', textKey: 'plMapTransitionText', done: () => nodeEls().some(g => g.textContent.includes('⇢')) },
      { titleKey: 'plMapBuildDoneTitle', textKey: 'plMapBuildDoneText', final: true },
    ];
    // Leçons « musique » et « balade » : prêtes à recevoir leurs fichiers (kit MAP_MUSIC), marquées « bientôt » en attendant.
    lessons['pj-map-music'] = [
      { titleKey: 'plMapMusicWelcomeTitle', textKey: 'plMapMusicWelcomeText' },
      ...['cabane:La cabane', 'foret:La forêt', 'manoir:Le manoir', 'scierie:La scierie'].map(x => { const [k, name] = x.split(':'); return {
        selector: () => nodeEl(name), titleKey: 'plMapMusicDropTitle', textKey: 'plMapMusicDropText', textVars: { name }, skip: () => !MAP_MUSIC[k],
        done: () => { const g = nodeEl(name); return !!g && /♪/.test(g.textContent); }, drops: MAP_MUSIC[k] ? fileDrops([MAP_MUSIC[k]]) : [] }; }),
      { titleKey: 'plMapMusicDoneTitle', textKey: 'plMapMusicDoneText', final: true },
    ];
    lessons['pj-map-walk'] = [
      { titleKey: 'plMapWalkWelcomeTitle', textKey: 'plMapWalkWelcomeText' },
      { selector: '#lmPlay', titleKey: 'plMapWalkStartTitle', textKey: 'plMapWalkStartText', done: () => !!document.querySelector('#lmCanvas.playing') },
      { selector: () => nodeEl('La cabane'), titleKey: 'plMapWalkCabinTitle', textKey: 'plMapWalkCabinText', done: () => isHere('La cabane') },
      { selector: () => nodeEl('La forêt'), titleKey: 'plMapWalkForestTitle', textKey: 'plMapWalkForestText', done: () => isHere('La forêt') },
      { selector: () => nodeEl('Le manoir'), titleKey: 'plMapWalkManorTitle', textKey: 'plMapWalkManorText', done: () => isHere('Le manoir') },
      { titleKey: 'plMapWalkDoneTitle', textKey: 'plMapWalkDoneText', final: true },
    ];

    const G = window.LayerPitchGuide.create({
      tr,
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
