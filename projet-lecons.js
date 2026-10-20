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
  const LESSON_LINKS = [];

  const LESSON_THEME_ID = 'preprod';
  // Leçons de cette page, dans l'ordre du menu. Les textes sont dans la zone « projects » de layerpitch-i18n.js.
  const LESSON_LIST = [
    { id: 'pj-chat', theme: LESSON_THEME_ID, titleKey: 'plChatTitle', descKey: 'plChatDesc' },
    { id: 'pj-moodboard', theme: LESSON_THEME_ID, titleKey: 'plBoardTitle', descKey: 'plBoardDesc' },
  ];

  function init(ctx) {
    const { S, $ } = ctx;
    const hasText = id => !!($(id) && $(id).value.trim().length > 1);
    const secMsgCount = () => (S.secMsgs || []).length;
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
        { selector: '#secNav', titleKey: 'plBoardSectionTitle', textKey: 'plBoardSectionText', done: () => !!S.sections && S.sel !== 'all' && S.sel !== 'none' },
        { titleKey: 'plBoardDoneTitle', textKey: 'plBoardDoneText', final: true },
      ],
    };

    const G = window.LayerPitchGuide.create({
      tr,
      nextLesson: lessonId => {
        const i = LESSON_LIST.findIndex(l => l.id === lessonId), next = i >= 0 ? LESSON_LIST[i + 1] : null;
        return next ? { lesson: next, n: i + 1 + 1 } : null;
      },
      startLesson: id => start(id),
      onLessonDone: id => { try { const d = JSON.parse(localStorage.getItem('layerpitch_lessons_done_v1') || '{}'); d[id] = true; localStorage.setItem('layerpitch_lessons_done_v1', JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } },
    });
    function start(id) {
      const steps = lessons[id];
      if (!steps) return false;
      G.open('lesson', steps, id);
      return true;
    }
    return { start, close: () => G.close(), list: LESSON_LIST, guide: G, tr };
  }

  window.LayerPitchProjetLessons = { init, LESSON_LIST, LESSON_LINKS };
})();
