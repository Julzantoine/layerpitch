/* ---------------- Visite guidée et leçons guidées du Backstage (08/10) ---------------- */
// Un seul moteur de bulles, deux usages : le tour du propriétaire (étapes manuelles : « Suivant ») et les leçons (étapes
// qui avancent toutes seules quand l'apprenant fait le geste demandé). Feu vert « in_app_tour » (admin seulement pour
// l'instant). Menu « Tutoriel » dans la barre du haut, à côté de la cloche et du compte.
const TOUR_DONE_STORAGE = 'layerpitch_tour_done_v1';
const LESSONS_DONE_STORAGE = 'layerpitch_lessons_done_v1';
const TOUR_STEPS = [
  { titleKey: 'tourWelcomeTitle', textKey: 'tourWelcomeText' },
  { selector: '.nav-item[data-tab="content"]', titleKey: 'tourContentTitle', textKey: 'tourContentText' },
  { selector: '.nav-item[data-tab="appearance"]', titleKey: 'tourAppearanceTitle', textKey: 'tourAppearanceText' },
  { selector: '.nav-item[data-tab="library"]', titleKey: 'tourLibraryTitle', textKey: 'tourLibraryText' },
  { selector: '.nav-item[data-tab="packs"]', titleKey: 'tourPacksTitle', textKey: 'tourPacksText' },
  { selector: '#btnPublish', titleKey: 'tourPublishTitle', textKey: 'tourPublishText' },
  { selector: '#btnAccountMenu', titleKey: 'tourAccountTitle', textKey: 'tourAccountText' },
];

// Morceau en cours d'édition dans la Bibliothèque musicale (celui sélectionné dans la liste).
function lessonTrack() { return (typeof library !== 'undefined' && library.find(t => t.id === manageLibrarySelectedId)) || null; }
// Fichiers d'exemple de chaque leçon : null tant qu'ils n'existent pas (la bulle dit alors « bientôt disponible »).
const LESSON_SAMPLE_FILES = { static: null };
// Nom du fichier d'exemple cité dans la consigne de dépôt (il porte le tempo : ambiance_120bpm).
const LESSON_SAMPLE_NAMES = { static: 'ambiance_120bpm.wav' };
// done(ctx) : true quand le geste est fait -> la leçon avance seule. clickDone : un clic sur la cible suffit.
// Sans done ni clickDone : étape manuelle (« Suivant »). enter(ctx) : photographie l'état à l'arrivée sur l'étape.
const LESSONS = [
  { id: 'static', titleKey: 'lessonStaticTitle', descKey: 'lessonStaticDesc', steps: [
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'lsModeTitle', textKey: 'lsModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'static'; } },
    { selector: '#libraryDetail [data-role="staticFileCtrl"]', titleKey: 'lsFileTitle', textKey: 'lsFileText', sampleKey: 'static',
      done: () => { const t = lessonTrack(); const l = t && t.layers && t.layers[0]; return !!(l && (l.pendingFile || l.remoteFile)); } },
    { selector: '#libraryDetail input[data-field="loopable"]', titleKey: 'lsLoopTitle', textKey: 'lsLoopText',
      done: () => { const t = lessonTrack(); return !!t && !!t.loopable; } },
    { selector: '#libraryDetail select[data-field="loopEngine"]', titleKey: 'lsEngineTitle', textKey: 'lsEngineText',
      done: () => { const t = lessonTrack(); return !!t && t.loopEngine === 'quantized'; } },
    { selector: '#libraryDetail input[data-field="bpm"]', titleKey: 'lsVerifyTitle', textKey: 'lsVerifyText' },
    { selector: '#libraryDetail [data-role="loopTimelineHost"]', titleKey: 'lsPointsTitle', textKey: 'lsPointsText' },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lsListenTitle', textKey: 'lsListenText', clickDone: true },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lsEndTitle', textKey: 'lsEndText', final: true },
  ] },
  { id: 'additive', titleKey: 'lessonAdditiveTitle', descKey: 'lessonAdditiveDesc', soon: true },
  { id: 'random', titleKey: 'lessonRandomTitle', descKey: 'lessonRandomDesc', soon: true },
  { id: 'sequential', titleKey: 'lessonSequentialTitle', descKey: 'lessonSequentialDesc', soon: true },
  { id: 'branching', titleKey: 'lessonBranchingTitle', descKey: 'lessonBranchingDesc', soon: true },
  { id: 'embranchement', titleKey: 'lessonEmbrTitle', descKey: 'lessonEmbrDesc', soon: true },
];

let guide = null; // { root, kind, lessonId, steps, index, ctx, timer, advancing, clicked }

function tourTargetVisible(el) {
  if (!el || el.hidden || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function tourMarkDone() { try { localStorage.setItem(TOUR_DONE_STORAGE, '1'); } catch (e) { /* stockage indisponible */ } }
function tourAlreadyDone() { try { return localStorage.getItem(TOUR_DONE_STORAGE) === '1'; } catch (e) { return false; } }
function lessonsDone() { try { return JSON.parse(localStorage.getItem(LESSONS_DONE_STORAGE) || '{}') || {}; } catch (e) { return {}; } }
function lessonMarkDone(id) { try { const d = lessonsDone(); d[id] = true; localStorage.setItem(LESSONS_DONE_STORAGE, JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } }

function closeBackstageTour() {
  if (!guide) return;
  if (guide.timer) clearInterval(guide.timer);
  guide.root.remove();
  window.removeEventListener('resize', renderGuideStep);
  document.removeEventListener('keydown', guideKeydown, true);
  document.removeEventListener('click', guideClickCapture, true);
  if (guide.kind === 'tour') tourMarkDone();
  guide = null;
  renderTutorialMenu();
}
function guideKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeBackstageTour(); }
}
function guideClickCapture(e) {
  if (!guide) return;
  const step = guide.steps[guide.index];
  if (step && step.clickDone && step.selector && e.target.closest && e.target.closest(step.selector)) guide.clicked = true;
}
function guideStepTarget(step) { return step.selector ? document.querySelector(step.selector) : null; }
function guideGo(delta) {
  if (!guide) return;
  const next = guide.index + delta;
  if (next < 0) return;
  if (next >= guide.steps.length) { finishGuide(); return; }
  guide.index = next; guide.clicked = false; guide.advancing = false;
  const step = guide.steps[next];
  if (step.enter) step.enter(guide.ctx);
  renderGuideStep();
}
function finishGuide() {
  if (guide && guide.kind === 'lesson') lessonMarkDone(guide.lessonId);
  closeBackstageTour();
}
function guideStepIsDone(step) {
  if (step.done) { try { return !!step.done(guide.ctx); } catch (e) { return false; } }
  if (step.clickDone) return guide.clicked;
  return false;
}
function guideTick() {
  if (!guide) return;
  const step = guide.steps[guide.index];
  if (guide.kind === 'lesson' && !guide.advancing && guideStepIsDone(step)) {
    guide.advancing = true;
    setTimeout(() => guideGo(1), 450); // laisse voir le résultat du geste avant la bulle suivante
    return;
  }
  renderGuideStep(true);
}
function renderGuideStep(positionOnly) {
  if (!guide) return;
  const step = guide.steps[guide.index];
  const target = guideStepTarget(step);
  const visible = tourTargetVisible(target);
  const spot = guide.root.querySelector('.tour-spot');
  const card = guide.root.querySelector('.tour-card');
  const auto = guide.kind === 'lesson' && (step.done || step.clickDone);
  const last = guide.index === guide.steps.length - 1;
  const key = guide.index + ':' + (visible ? 'v' : 'h');
  if (!positionOnly || guide.cardKey !== key) {
    guide.cardKey = key;
    const sample = step.sampleKey ? LESSON_SAMPLE_FILES[step.sampleKey] : undefined;
    const sampleHtml = step.sampleKey
      ? (sample ? `<a class="tour-sample" href="${escapeAttr(sample)}" download>${escapeHtml(tr('lessonSampleDownload'))}</a>`
        : `<div class="tour-sample tour-sample-soon">${escapeHtml(tr('lessonSampleSoon'))}</div>`)
      : '';
    card.innerHTML = `
      <div class="tour-count">${guide.index + 1} / ${guide.steps.length}</div>
      <div class="tour-title">${escapeHtml(tr(step.titleKey))}</div>
      <div class="tour-text">${escapeHtml(tr(step.textKey, { file: LESSON_SAMPLE_NAMES[guide.lessonId] || '' }))}</div>
      ${sampleHtml}
      ${auto ? `<div class="tour-waiting">${escapeHtml(tr('lessonDoIt'))}</div>` : ''}
      <div class="tour-actions">
        <button class="btn btn-small" type="button" data-tour="skip">${escapeHtml(tr(last ? 'tourClose' : (guide.kind === 'lesson' ? 'lessonQuit' : 'tourSkip')))}</button>
        <span style="flex:1"></span>
        ${guide.index > 0 && !auto && !step.final ? `<button class="btn btn-small" type="button" data-tour="prev">${escapeHtml(tr('tourPrev'))}</button>` : ''}
        ${auto ? `<button class="btn btn-small" type="button" data-tour="next">${escapeHtml(tr('lessonSkipStep'))}</button>`
          : `<button class="btn btn-small btn-primary" type="button" data-tour="next">${escapeHtml(tr(last ? 'tourFinish' : 'tourNext'))}</button>`}
      </div>`;
    card.querySelector('[data-tour="skip"]').onclick = closeBackstageTour;
    card.querySelector('[data-tour="next"]').onclick = () => guideGo(1);
    const prev = card.querySelector('[data-tour="prev"]');
    if (prev) prev.onclick = () => guideGo(-1);
  }
  const margin = 12;
  if (visible) {
    const r = target.getBoundingClientRect();
    spot.style.display = 'block';
    spot.style.top = (r.top - 4) + 'px'; spot.style.left = (r.left - 4) + 'px';
    spot.style.width = (r.width + 8) + 'px'; spot.style.height = (r.height + 8) + 'px';
    // Pendant une leçon, la cible doit rester cliquable : le voile laisse passer les clics (pointer-events), la carte non.
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = r.right + margin, top = r.top;
    if (left + cw > window.innerWidth - margin) { left = Math.min(r.left, window.innerWidth - cw - margin); top = r.bottom + margin; }
    if (top + ch > window.innerHeight - margin) top = Math.max(margin, r.top - ch - margin);
    card.style.left = Math.max(margin, left) + 'px'; card.style.top = Math.max(margin, top) + 'px';
    card.style.transform = 'none';
  } else {
    spot.style.display = 'none';
    card.style.left = '50%'; card.style.top = '50%'; card.style.transform = 'translate(-50%, -50%)';
  }
}
function openGuide(kind, steps, lessonId) {
  if (guide) closeBackstageTour();
  if (!steps.length) return;
  const root = document.createElement('div');
  root.className = 'tour-root' + (kind === 'lesson' ? ' tour-root-lesson' : '');
  root.setAttribute('role', 'dialog');
  root.innerHTML = '<div class="tour-spot"></div><div class="tour-card"></div>';
  document.body.appendChild(root);
  guide = { root, kind, lessonId, steps, index: 0, ctx: {}, timer: null, advancing: false, clicked: false, cardKey: '' };
  if (steps[0].enter) steps[0].enter(guide.ctx);
  window.addEventListener('resize', renderGuideStep);
  document.addEventListener('keydown', guideKeydown, true);
  document.addEventListener('click', guideClickCapture, true);
  renderGuideStep();
  if (kind === 'lesson') guide.timer = setInterval(guideTick, 250);
  else guide.timer = setInterval(() => renderGuideStep(true), 400); // suit la cible si l'écran se redessine
}
function startBackstageTour() {
  if (guide) return;
  openGuide('tour', TOUR_STEPS.filter(s => !s.selector || tourTargetVisible(document.querySelector(s.selector))));
}
function startLesson(id) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson || !lesson.steps) return;
  openGuide('lesson', lesson.steps, id);
  // Saute les étapes déjà faites au départ (par ex. bibliothèque déjà ouverte).
  const skipDone = () => { while (guide && guide.index < guide.steps.length - 1 && guide.steps[guide.index].done && guideStepIsDone(guide.steps[guide.index])) guideGo(1); };
  skipDone();
}

// ---- Menu « Tutoriel » (barre du haut) ----
function renderTutorialMenu() {
  const list = document.getElementById('tutorialMenuList');
  if (!list) return;
  const done = lessonsDone();
  const tick = '<svg class="account-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  list.innerHTML = `
    <button class="account-menu-item" type="button" data-tutorial="tour">
      <span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr('accountMenuTour'))}</b><small>${escapeHtml(tr('tutorialTourDesc'))}</small></span></span>
      ${tourAlreadyDone() ? tick : ''}
    </button>
    <div class="account-menu-sep"></div>
    <div class="tutorial-menu-heading">${escapeHtml(tr('tutorialLessonsHeading'))}</div>
    ${LESSONS.map(l => `
      <button class="account-menu-item" type="button" data-tutorial="${l.id}" ${l.soon ? 'disabled' : ''}>
        <span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr(l.titleKey))}</b><small>${escapeHtml(tr(l.descKey))}</small></span></span>
        ${l.soon ? `<span class="nav-badge">${escapeHtml(tr('comingSoonBadge'))}</span>` : (done[l.id] ? tick : '')}
      </button>`).join('')}`;
}
function initTutorialMenuUi() {
  const btn = document.getElementById('btnTutorialMenu');
  const dropdown = document.getElementById('tutorialMenuDropdown');
  if (!btn || !dropdown) return;
  const closeMenu = () => { dropdown.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    if (willOpen) renderTutorialMenu();
    dropdown.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) document.dispatchEvent(new CustomEvent('lp-header-menu-open', { detail: 'tutorial' }));
  });
  document.addEventListener('lp-header-menu-open', (e) => { if (e.detail !== 'tutorial' && !dropdown.hidden) closeMenu(); });
  document.addEventListener('click', (e) => { if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('[data-tutorial]');
    if (!item || item.disabled) return;
    closeMenu();
    const id = item.dataset.tutorial;
    if (id === 'tour') startBackstageTour(); else startLesson(id);
  });
}
// Appelée une fois les feux verts connus (fin de renderAdminOnlyPanels) : montre le menu et lance la visite la toute
// première fois, sans jamais la relancer ensuite.
function syncBackstageTour() {
  const open = flagOpen('in_app_tour');
  const menuItem = document.getElementById('accountMenuTour');
  if (menuItem) menuItem.hidden = !open;
  const wrap = document.getElementById('tutorialMenuWrap');
  if (wrap) wrap.hidden = !open;
  if (open) renderTutorialMenu();
  if (open && !tourAlreadyDone() && !guide) setTimeout(startBackstageTour, 600);
}
(function wireTourMenu() {
  const item = document.getElementById('accountMenuTour');
  if (item) item.addEventListener('click', () => {
    const dd = document.getElementById('accountMenuDropdown');
    if (dd) dd.hidden = true;
    startBackstageTour();
  });
  initTutorialMenuUi();
})();
