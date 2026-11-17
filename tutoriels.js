// tutoriels.js — LayerPitch, page « Tous les tutoriels » (tutoriels.html, 17/11).
// Catalogue public des leçons du mode tutoriel (?tuto). Les leçons elles-mêmes vivent dans src/backstage/43-visite-guidee.js (tableau LESSONS) :
// cette liste n'en garde que ce qu'il faut pour les AFFICHER et les OUVRIR. test_tutoriels_hub.js compare les deux pour qu'elles ne dérivent pas.
// Thèmes ouverts à tous = LESSON_THEMES_OPEN du Backstage ; les autres restent grisés « bientôt » ; les leçons `adminOnly` ne sont pas montrées.
(function () {
  const THEMES = [
    { id: 'engine', titleKey: 'lessonThemeEngine', open: true },
    { id: 'pitch', titleKey: 'lessonThemePitch', open: true },
    { id: 'preprod', titleKey: 'lessonThemePreprod', open: false },
  ];
  // [id, thème, clé du titre, clé de la description, réservée aux admins]
  const LESSONS = [
    ['static', 'engine', 'lessonStaticTitle', 'lessonStaticDesc'],
    ['embranchement', 'engine', 'lessonEmbrTitle', 'lessonEmbrDesc'],
    ['additive', 'engine', 'lessonAdditiveTitle', 'lessonAdditiveDesc'],
    ['random', 'engine', 'lessonRandomTitle', 'lessonRandomDesc'],
    ['sequential', 'engine', 'lessonSequentialTitle', 'lessonSequentialDesc'],
    ['branching', 'engine', 'lessonBranchingTitle', 'lessonBranchingDesc'],
    ['sfx', 'engine', 'lessonSfxTitle', 'lessonSfxDesc'],
    ['events', 'engine', 'lessonEventsTitle', 'lessonEventsDesc'],
    ['hybrid-seq', 'engine', 'lessonHybridSeqTitle', 'lessonHybridSeqDesc'],
    ['hybrid', 'engine', 'lessonHybridTitle', 'lessonHybridDesc'],
    ['adreel-intro', 'pitch', 'liTitle', 'liDesc'],
    ['adreel', 'pitch', 'laTitle', 'laDesc'],
    ['appearance', 'pitch', 'aprTitle', 'aprDesc'],
    ['share', 'pitch', 'shrTitle', 'shrDesc'],
    ['tracking', 'pitch', 'ltTitle', 'ltDesc'],
    ['pack', 'pitch', 'lpTitle', 'lpDesc'],
    ['live-play', 'pitch', 'lpvTitle', 'lpvDesc', true],
    ['embed', 'pitch', 'leTitle', 'leDesc'],
    ['album', 'pitch', 'albTitle', 'albDesc'],
    ['upload', 'pitch', 'luTitle', 'luDesc'],
    ['pj-create', 'preprod', 'plCreateTitle', 'plCreateDesc'],
    ['pj-chat', 'preprod', 'plChatTitle', 'plChatDesc'],
    ['pj-moodboard', 'preprod', 'plBoardTitle', 'plBoardDesc'],
    ['pj-music', 'preprod', 'plMusicTitle', 'plMusicDesc'],
    ['pj-map-build', 'preprod', 'plMapBuildTitle', 'plMapBuildDesc'],
    ['pj-map-music', 'preprod', 'plMapMusicTitle', 'plMapMusicDesc'],
    ['pj-map-walk', 'preprod', 'plMapWalkTitle', 'plMapWalkDesc'],
    ['versioning', 'preprod', 'lvTitle', 'lvDesc', true],
    ['versioning-adreel', 'preprod', 'lvaTitle', 'lvaDesc', true],
    ['versioning-pas', 'preprod', 'lvpTitle', 'lvpDesc', true],
    ['pj-annotate', 'preprod', 'plAnnTitle', 'plAnnDesc', true],
    ['pj-vitrine', 'preprod', 'plVitTitle', 'plVitDesc', true],
    ['pj-vitrine-look', 'preprod', 'plLookTitle', 'plLookDesc', true],
  ].map(a => ({ id: a[0], theme: a[1], titleKey: a[2], descKey: a[3], adminOnly: !!a[4] }));
  const DONE_STORAGE = 'layerpitch_lessons_done_v1'; // même clé que le menu du Backstage : les leçons faites s'y retrouvent cochées

  function init(opts) {
    const lang = opts.lang, tr = opts.tr, esc = opts.esc, root = opts.root;
    let done = {};
    try { done = JSON.parse(localStorage.getItem(DONE_STORAGE) || '{}') || {}; } catch (e) { done = {}; }
    const url = l => './layerpitch-backstage.html?tuto&lesson=' + encodeURIComponent(l.id) + '&lang=' + lang;
    root.innerHTML = THEMES.map(th => {
      const items = LESSONS.filter(l => l.theme === th.id && !l.adminOnly);
      const [main, ...rest] = tr(th.titleKey).split(' : ');
      const rows = items.length ? items.map(l => {
        const body = `<div class="row-main"><div class="row-title">${esc(tr(l.titleKey))}</div><div class="row-sub">${esc(tr(l.descKey))}</div></div>`;
        if (!th.open) return `<div class="row is-soon">${body}<span class="pill">${esc(tr('soonBadge'))}</span></div>`;
        return `<a class="row" href="${esc(url(l))}" data-lesson="${esc(l.id)}">${body}${done[l.id] ? `<span class="pill">${esc(tr('doneBadge'))}</span>` : `<span class="btn">${esc(tr('start'))}</span>`}</a>`;
      }).join('') : `<p class="hint">${esc(tr('themeSoon'))}</p>`;
      return `<section class="card"><h2>${esc(main)}</h2>${rest.length ? `<p class="hint">${esc(rest.join(' : ').replace(/^./, c => c.toUpperCase()))}</p>` : ''}${rows}</section>`;
    }).join('');
  }
  window.LayerPitchTutorialsHub = { THEMES, LESSONS, init };
})();
