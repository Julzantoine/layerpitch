/* ---------------- Questions de profil + « Tes essentiels » (4/11) ----------------
 * Cadrage : layerpitch-docs/2026-11-04-exemples-precharges-et-profilage-cadrage.md ; base : set_my_onboarding_profile
 * (profiles.onboarding_profile). Feu vert « onboarding_profile » (admin d'abord), avec le menu Tutoriel (in_app_lessons).
 * À la fin de la visite guidée, à la place du double choix « moteur audio / pitch » (tourChoiceStep) : l'arbre de questions
 *   Tu es… Compositeur / Studio / Les deux
 *   Compositeur -> contrats ou début de carrière ? -> (contrats) plusieurs OST ?
 *   Les deux -> quelle voie d'abord ? (Compositeur / Studio), puis la branche choisie.
 * « Passer » toujours visible. Les réponses donnent 4-5 leçons essentielles, en tête du menu Tutoriel (« Tes essentiels »,
 * cochées une fois faites) ; pour « les deux », un bouton « Explorer aussi la voie studio / compositeur ». PAS de lien
 * « refaire le questionnaire » (décision de Jules-Antoine). Comptes déjà inscrits (visite déjà faite) : les questions sont
 * proposées une fois, à la prochaine connexion, seulement une fois les messages de la cloche lus (5/11 : la bulle s'ouvrait
 * par-dessus le message des exemples, qu'on ne pouvait plus lire), avec leur propre titre (pas « Pour finir »). Mode tutoriel (sans compte) : inchangé, double choix comme avant. */
const ESSENTIAL_LESSONS = {
  'composer-starting': ['embranchement', 'additive', 'adreel-intro', 'adreel'],
  'composer-contracts': ['embranchement', 'additive', 'pj-map-music', 'versioning'],
  'composer-contracts-ost': ['embranchement', 'additive', 'pj-map-music', 'versioning', 'album'],
  'studio': ['pj-create', 'pj-moodboard', 'pj-music', 'pj-map-walk'],
};
const ESSENTIALS_VIEW_STORAGE = 'lp_essentials_view'; // voie affichée pour un profil « les deux » (cet ordinateur)
let myOnboardingProfile; // undefined = pas encore lu ; null = jamais proposé ; sinon {role, career, ost, path, skipped, at}

function profileQuizOpen() { return !isTutoMode() && flagOpen('onboarding_profile') && lessonsAccessOpen(); }
function onboardingAnswered(p) { return !!(p && p.role); }
// Voie affichée : celle du rôle ; pour « les deux », celle choisie en premier, ou l'autre si la personne a cliqué « Explorer aussi… ».
function essentialsPath(p) {
  if (!onboardingAnswered(p)) return null;
  if (p.role !== 'both') return p.role;
  let v = null;
  try { v = localStorage.getItem(ESSENTIALS_VIEW_STORAGE); } catch (e) { /* stockage indisponible */ }
  return v === 'composer' || v === 'studio' ? v : (p.path || 'composer');
}
function essentialsKey(p, path) {
  if (path === 'studio') return 'studio';
  if (p.career !== 'contracts') return 'composer-starting';
  return p.ost === 'yes' ? 'composer-contracts-ost' : 'composer-contracts';
}
function myEssentialLessons() {
  const p = myOnboardingProfile;
  const path = essentialsPath(p);
  if (!path) return [];
  return ESSENTIAL_LESSONS[essentialsKey(p, path)].map(id => LESSONS.find(l => l.id === id)).filter(Boolean);
}

async function loadMyOnboardingProfile() {
  if (myOnboardingProfile !== undefined || isTutoMode()) return myOnboardingProfile;
  try {
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().from('profiles').select('onboarding_profile').maybeSingle();
    if (error) { console.warn('onboarding_profile illisible :', error.message || error); return undefined; }
    myOnboardingProfile = (data && data.onboarding_profile) || null;
  } catch (e) { console.warn('onboarding_profile injoignable :', e && e.message); return undefined; }
  return myOnboardingProfile;
}
async function saveMyOnboardingProfile(answers) {
  const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('set_my_onboarding_profile', { p: answers });
  if (error) { window.LayerPitchNotify.error(tr('profileQSaveError', { error: error.message || String(error) })); return null; }
  myOnboardingProfile = data || answers;
  trackBackstageEvent(answers.skipped ? 'profile_quiz_skip' : 'profile_quiz_done', answers.skipped ? {} : { role: answers.role });
  renderTutorialMenu();
  return myOnboardingProfile;
}

// ---- L'arbre de questions (bulle de fin de visite) ----
// quiz.only : les questions de la voie compositeur seulement (bouton « Explorer aussi la voie compositeur » d'un profil « les deux »
// qui avait choisi le studio d'abord : ses réponses carrière/OST manquent encore).
let profileQuiz = null;
function profileQuizStep(opts) {
  profileQuiz = { answers: {}, q: opts && opts.only === 'composer' ? 'career' : 'role', done: false, saved: false, only: opts && opts.only };
  return { titleKey: opts && opts.alone ? 'profileQTitleAlone' : 'profileQTitle', textKey: 'profileQIntro', profileQuiz: true };
}
const PROFILE_QUESTIONS = {
  role: { key: 'profileQRole', options: [['composer', 'profileQRoleComposer'], ['studio', 'profileQRoleStudio'], ['both', 'profileQRoleBoth']] },
  path: { key: 'profileQPath', options: [['composer', 'profileQPathComposer'], ['studio', 'profileQPathStudio']] },
  career: { key: 'profileQCareer', options: [['contracts', 'profileQCareerContracts'], ['starting', 'profileQCareerStarting']] },
  ost: { key: 'profileQOst', options: [['yes', 'profileQOstYes'], ['no', 'profileQOstNo']] },
};
// Question suivante après une réponse (null = terminé).
function profileNextQuestion(a, q) {
  if (q === 'role') return a.role === 'composer' ? 'career' : (a.role === 'both' ? 'path' : null);
  if (q === 'path') return a.path === 'composer' ? 'career' : null;
  if (q === 'career') return a.career === 'contracts' ? 'ost' : null;
  return null;
}
function essentialsListHtml(lessons) {
  const done = lessonsDone();
  return `<div class="profile-essentials">${lessons.map(l => `<button type="button" class="btn btn-small${done[l.id] ? '' : ' btn-primary'}" data-profile-lesson="${escapeAttr(l.id)}" ${(l.soon || !lessonPlayable(l) || (l.needs && !flagOpen(l.needs))) ? 'disabled' : ''}>${done[l.id] ? '✓ ' : ''}${escapeHtml(tr(l.titleKey))}</button>`).join('')}</div>`;
}
function profileQuizHtml() {
  const qz = profileQuiz;
  if (!qz) return '';
  qz.shown = true; // la personne a vu les questions : fermer la bulle vaudra « Passer »
  if (qz.done) return `<div class="profile-quiz" data-profile-quiz><div class="tour-text">${escapeHtml(tr('profileQDoneText'))}</div>${essentialsListHtml(myEssentialLessons())}</div>`;
  const q = PROFILE_QUESTIONS[qz.q];
  return `<div class="profile-quiz" data-profile-quiz>
    <div class="profile-quiz-q">${escapeHtml(tr(q.key))}</div>
    <div class="tour-choices">${q.options.map(([v, k]) => `<button class="btn btn-primary" type="button" data-profile-answer="${v}">${escapeHtml(tr(k))}</button>`).join('')}</div>
    <div style="margin-top:8px"><button class="btn btn-small" type="button" data-profile-skip>${escapeHtml(tr('profileQSkip'))}</button></div>
  </div>`;
}
function wireProfileQuiz(card) {
  const box = card.querySelector('[data-profile-quiz]');
  if (!box) return;
  // La bulle gère « Suivant / Terminer » : ici les réponses font avancer, on ne garde que « Fermer ».
  const next = card.querySelector('[data-tour="next"]');
  if (next) next.hidden = true;
  const redraw = () => { box.outerHTML = profileQuizHtml(); wireProfileQuiz(card); };
  box.querySelectorAll('[data-profile-answer]').forEach(b => b.addEventListener('click', async () => {
    const qz = profileQuiz;
    qz.answers[qz.q] = b.dataset.profileAnswer;
    const nq = profileNextQuestion(qz.answers, qz.q);
    if (nq) { qz.q = nq; redraw(); return; }
    // Terminé : « Explorer aussi la voie compositeur » complète la fiche existante (rôle et voie gardés).
    const answers = qz.only === 'composer' ? Object.assign({ role: myOnboardingProfile.role, path: myOnboardingProfile.path }, qz.answers) : qz.answers;
    box.querySelectorAll('button').forEach(x => { x.disabled = true; });
    const saved = await saveMyOnboardingProfile(answers);
    if (!saved) { box.querySelectorAll('button').forEach(x => { x.disabled = false; }); return; }
    if (qz.only === 'composer') { try { localStorage.setItem(ESSENTIALS_VIEW_STORAGE, 'composer'); } catch (e) {} }
    qz.saved = true; qz.done = true; redraw();
  }));
  const skip = box.querySelector('[data-profile-skip]');
  if (skip) skip.addEventListener('click', async () => {
    const qz = profileQuiz;
    profileQuiz = null;
    finishGuide();
    if (qz && !qz.saved && !qz.only) await saveMyOnboardingProfile({ skipped: true });
  });
  box.querySelectorAll('[data-profile-lesson]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.profileLesson;
    profileQuiz = null;
    finishGuide();
    openLessonFromMenu(id);
  }));
}
// Bulle fermée (« Fermer », Échap…) avant d'avoir répondu : vaut « Passer » (questions proposées une seule fois).
function profileQuizClosed() {
  const qz = profileQuiz;
  profileQuiz = null;
  if (qz && qz.shown && !qz.saved && !qz.only && profileQuizOpen()) saveMyOnboardingProfile({ skipped: true });
}
// Lance une leçon comme le menu Tutoriel : dans le vrai compte, nouvelle fenêtre en mode tutoriel (compte fictif).
function openLessonFromMenu(id) {
  const l = LESSONS.find(x => x.id === id);
  if (!isTutoMode() && l && !l.soon) { window.open(lessonTutoUrl(l, id), '_blank', 'noopener'); return; }
  startLesson(id, { restart: true });
}
// Dernière étape de la visite : les questions si jamais proposées ; les essentiels si déjà répondues ; sinon (passées, ou
// fonction fermée) l'ancien double choix.
function tourFinalStep() {
  if (profileQuizOpen() && myOnboardingProfile === null) return profileQuizStep();
  if (profileQuizOpen() && onboardingAnswered(myOnboardingProfile)) {
    profileQuiz = { answers: {}, done: true, saved: true };
    return { titleKey: 'profileQTitle', textKey: 'profileQIntro', profileQuiz: true };
  }
  return tourChoiceStep();
}
// Comptes déjà inscrits (visite déjà faite ou refusée) : les questions seules, une fois, à la prochaine connexion. Elles attendent
// la fin de l'ajout des exemples, puis que les messages de LayerPitch de la cloche soient lus et la cloche refermée : sinon la
// bulle recouvrait le message des exemples, illisible tant qu'elle restait ouverte (retour du 5/11).
function inboxHasUnreadAnnouncement(items) { return (items || []).some(it => it.unread && it.kind === 'announcement'); }
function inboxBellOpen() { const dd = document.getElementById('inboxBellDropdown'); return !!(dd && !dd.hidden); }
function whenInboxRead() {
  const shell = window.LayerPitchShell;
  if (!shell || !shell.onInbox) return Promise.resolve();
  return new Promise(resolve => {
    let items = null, done = false, obs = null;
    const check = () => {
      if (done || items === null || inboxHasUnreadAnnouncement(items) || inboxBellOpen()) return;
      done = true;
      if (obs) obs.disconnect();
      resolve();
    };
    shell.onInbox(list => { items = list; check(); }); // appelé à chaque relève, et quand la cloche marque les messages vus
    const dd = document.getElementById('inboxBellDropdown');
    if (dd && window.MutationObserver) { obs = new MutationObserver(check); obs.observe(dd, { attributes: true, attributeFilter: ['hidden'] }); }
  });
}
let profileQuizOffered = false;
async function offerProfileQuizIfNeeded() {
  if (profileQuizOffered || !profileQuizOpen() || guide) return;
  profileQuizOffered = true;
  if ((await loadMyOnboardingProfile()) !== null || guide) return;
  if (typeof examplesSeedPromise !== 'undefined' && examplesSeedPromise) { try { await examplesSeedPromise; } catch (e) { /* sans exemples, on continue */ } }
  await whenInboxRead();
  setTimeout(() => { if (!guide && myOnboardingProfile === null) openGuide('tour', [profileQuizStep({ alone: true })]); }, 900);
}

// ---- « Tes essentiels » en tête du menu Tutoriel ----
function essentialsMenuHtml(tick) {
  if (!profileQuizOpen()) return '';
  const p = myOnboardingProfile;
  if (!onboardingAnswered(p)) return '';
  const lessons = myEssentialLessons();
  const done = lessonsDone();
  const path = essentialsPath(p);
  const other = path === 'studio' ? 'composer' : 'studio';
  return `<div class="tutorial-menu-heading">${escapeHtml(tr('essentialsHeading'))}</div>
    ${lessons.map(l => `<button class="account-menu-item tutorial-menu-lesson" type="button" data-tutorial="${l.id}" ${(l.soon || !lessonPlayable(l) || (l.needs && !flagOpen(l.needs))) ? 'disabled' : ''}>
      <span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr(l.titleKey))}</b><small>${escapeHtml(tr(l.descKey))}</small></span></span>
      ${!lessonOpenToMe(l) ? `<span class="nav-badge">${escapeHtml(tr('comingSoonBadge'))}</span>` : (done[l.id] ? tick : '')}
    </button>`).join('')}
    ${p.role === 'both' ? `<button class="account-menu-item" type="button" data-essentials-switch="${other}"><span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr(other === 'studio' ? 'essentialsAlsoStudio' : 'essentialsAlsoComposer'))}</b></span></span></button>` : ''}
    <div class="account-menu-sep"></div>`;
}
// « Explorer aussi la voie … » : la voie compositeur sans réponses carrière/OST ouvre d'abord ces deux questions.
function switchEssentialsPath(path) {
  const p = myOnboardingProfile;
  if (!p || p.role !== 'both') return;
  if (path === 'composer' && !p.career) { if (!guide) openGuide('tour', [profileQuizStep({ only: 'composer', alone: true })]); return; }
  try { localStorage.setItem(ESSENTIALS_VIEW_STORAGE, path); } catch (e) { /* le temps de la page seulement */ }
  trackBackstageEvent('essentials_switch', { path });
  renderTutorialMenu();
}
