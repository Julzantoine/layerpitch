/* ---------------- Accueil du Backstage (13/11, feu vert « home_dashboard », admin seulement jusqu'à ouverture) ----------------
 * Cadrage validé par Jules-Antoine : layerpitch-docs/2026-11-13-accueil-dashboard-cadrage.md. Page d'arrivée du Backstage (rafraîchissement
 * compris) : salutation, rappels discrets (visite guidée, profil), « Que veux-tu faire aujourd'hui ? », boîte aux lettres (les mêmes
 * messages que la cloche, qui reste un raccourci), puis des cartes : Continuer, Tes essentiels, Ton activité, Nouveautés, Réglages rapides.
 * Les préférences vivent sur le compte (profiles.home_prefs, fonction set_my_home_prefs ; migration 20261113020000) avec repli sur ce
 * navigateur tant que la migration n'est pas appliquée. Jamais en mode tutoriel (?tuto, compte fictif). */
const HOME_PREFS_LOCAL = 'lp_home_prefs_v1'; // repli (navigateur) : mêmes clés que profiles.home_prefs
const HOME_ON_HINT = 'lp_home_on'; // « l'Accueil est ouvert pour moi » : choisit le bon onglet dès le chargement, avant que les feux verts soient connus
const HOME_NEWS = []; // Nouveautés : { date: 'AAAA-MM-JJ', fr: { title, text }, en: { title, text }, tab? } — CHAQUE entrée est validée par Jules-Antoine avant d'être ajoutée
// « J'ai besoin de comprendre… » : chaque besoin = un petit parcours de leçons existantes (celles non ouvertes à la personne sont retirées).
const HOME_NEEDS = [
  { key: 'homeNeedMusic', lessons: ['upload', 'static', 'embranchement', 'additive', 'sfx'] },
  { key: 'homeNeedStudio', lessons: ['adreel-intro', 'adreel', 'appearance', 'share', 'tracking'] },
  { key: 'homeNeedTeam', lessons: ['pj-create', 'pj-chat', 'pj-moodboard', 'pj-music', 'pj-map-walk'] },
  { key: 'homeNeedSell', lessons: ['album', 'pack'] },
];
let homePrefs = null; // null = pas encore lu
let homeDbOk = true; // faux si la colonne / la fonction n'existent pas encore (migration non appliquée) : on garde tout dans ce navigateur
let homePrefsPromise = null;
let homeInboxItems = null;
let homeInboxWired = false;
let homeMailAll = false;
let homeLearnOpen = false;
let homeSellOpen = false;
let homeActivity = { state: 'idle', overview: null, at: 0 };
let homeArrivalDone = false;
let homeAppearanceHost = null;
// « Personnaliser le menu » : la personne masque les entrées de la barre latérale dont elle ne se sert pas (prefs.menu_hidden).
// Jamais masquables : Accueil, Contenu, Apparence. Une entrée déjà cachée par un feu vert n'est pas proposée.
const HOME_MENU_KEEP = ['home', 'content', 'appearance'];
function homeMenuEntries() {
  return [...document.querySelectorAll('.backstage-sidebar a.nav-item, .backstage-sidebar button.nav-item')].map(el => {
    const key = el.dataset.tab || el.id;
    const label = (el.querySelector('[data-i18n]') || el).textContent.trim();
    return { el, key, label, flagHidden: el.hidden && !el.classList.contains('nav-user-hidden') };
  }).filter(e => e.key && !HOME_MENU_KEEP.includes(e.key) && e.label && !e.el.classList.contains('nav-feedback-btn') && !e.flagHidden);
}
function applyHomeMenu() {
  const hidden = homeOpen() ? ((homePrefs && homePrefs.menu_hidden) || []) : [];
  document.querySelectorAll('.backstage-sidebar .nav-item').forEach(el => el.classList.toggle('nav-user-hidden', hidden.includes(el.dataset.tab || el.id)));
}

function homeOpen() { return !isTutoMode() && flagOpen('home_dashboard'); }
function homeHintOn() { try { return localStorage.getItem(HOME_ON_HINT) === '1'; } catch (e) { return false; } }
function homeLocalPrefs() { try { return JSON.parse(localStorage.getItem(HOME_PREFS_LOCAL) || '{}') || {}; } catch (e) { return {}; } }

async function loadHomePrefs() {
  if (homePrefs) return homePrefs;
  if (homePrefsPromise) return homePrefsPromise;
  homePrefsPromise = (async () => {
    let fromDb = null;
    try {
      const { data, error } = await window.LayerPitchSupabaseClient.getClient().from('profiles').select('home_prefs').maybeSingle();
      if (error) { homeDbOk = false; console.warn('home_prefs illisible (migration pas encore appliquée ?) :', error.message || error); }
      else fromDb = (data && data.home_prefs) || {};
    } catch (e) { homeDbOk = false; }
    // Le compte fait foi ; ce navigateur complète (ce qui n'a pas pu être écrit) sans jamais défaire le compte.
    homePrefs = Object.assign({}, homeLocalPrefs(), fromDb || {});
    homePrefsPromise = null;
    return homePrefs;
  })();
  return homePrefsPromise;
}
// Fusionne des réglages : dans ce navigateur toujours, sur le compte quand c'est possible.
function homeSavePrefs(patch) {
  homePrefs = Object.assign({}, homePrefs || homeLocalPrefs(), patch);
  try { localStorage.setItem(HOME_PREFS_LOCAL, JSON.stringify(homePrefs)); } catch (e) { /* stockage indisponible */ }
  if (!homeDbOk || isTutoMode()) return Promise.resolve();
  return Promise.resolve(window.LayerPitchSupabaseClient.getClient().rpc('set_my_home_prefs', { p: patch }))
    .then(({ data, error }) => { if (error) { homeDbOk = false; console.warn('home_prefs non enregistrées :', error.message || error); } else if (data) homePrefs = Object.assign({}, homePrefs, data); })
    .catch(() => { homeDbOk = false; });
}
// Appelé par la visite guidée quand elle se termine (tourMarkDone, 43-visite-guidee.js).
function homeTourDone() { if (homeOpen()) homeSavePrefs({ tour_done: true }).then(() => renderHome()); }
function homeTourReminderShown() {
  return homeOpen() && flagOpen('in_app_tour') && !tourAlreadyDone() && !(homePrefs && (homePrefs.tour_done || homePrefs.tour_dismissed));
}
function homeProfileReminderShown() {
  return homeOpen() && profileQuizOpen() && myOnboardingProfile !== undefined && !onboardingAnswered(myOnboardingProfile);
}
// Aide contextuelle : un seul interrupteur qui coupe les petits textes sous les champs et les bulles au survol (les avertissements restent).
function applyHomeHelp() { document.body.classList.toggle('lp-help-off', homeOpen() && !!(homePrefs && homePrefs.help_off)); }

// ---- « Continuer » : les 3 derniers éléments touchés (morceau, AdReel) ----
// Relevé quand on quitte l'onglet concerné (Bibliothèque, Contenu) : on retient ce qui y était ouvert.
function homeNoteRecent(kind, id, title) {
  if (!homeOpen() || !homePrefs || !id) return;
  const list = (homePrefs.recent || []).filter(r => !(r.kind === kind && r.id === id));
  list.unshift({ kind, id, title: String(title || '').slice(0, 80), at: new Date().toISOString() });
  const next = list.slice(0, 3);
  if (JSON.stringify(next.map(r => [r.kind, r.id])) === JSON.stringify((homePrefs.recent || []).map(r => [r.kind, r.id]))) return;
  homeSavePrefs({ recent: next });
}
function homeNoteLeavingTab(tab) {
  try {
    if (tab === 'library' && typeof manageLibrarySelectedId !== 'undefined' && manageLibrarySelectedId) {
      const t = library.find(x => x.id === manageLibrarySelectedId);
      if (t) homeNoteRecent('track', t.id, t.title || t.name || t.id);
    }
    if (tab === 'content' && typeof currentAdReelId !== 'undefined') {
      const a = adReels.find(x => x.id === currentAdReelId);
      if (a) homeNoteRecent('adreel', a.id, a.label || a.id);
    }
  } catch (e) { /* jamais bloquant */ }
}
function homeOpenRecent(kind, id) {
  if (kind === 'track') { manageLibrarySelectedId = id; openTab('library'); if (typeof renderLibrary === 'function') renderLibrary(); }
  else if (kind === 'adreel') { if (typeof switchAdReel === 'function') switchAdReel(id); openTab('content'); }
}

// ---- Activité (30 jours) ----
async function loadHomeActivity() {
  if (!homeOpen() || !window.LayerPitchAnalytics) return;
  if (homeActivity.state === 'loading' || (homeActivity.state === 'done' && Date.now() - homeActivity.at < 300000)) return;
  homeActivity.state = 'loading';
  try {
    await loadPostgresReadScripts();
    const { overview, error } = await window.LayerPitchAnalytics.getMyAnalyticsOverview({ from: new Date(Date.now() - 30 * 864e5).toISOString(), to: null, bucket: 'day' });
    homeActivity = error || !overview ? { state: 'error', overview: null, at: Date.now() } : { state: 'done', overview, at: Date.now() };
  } catch (e) { homeActivity = { state: 'error', overview: null, at: Date.now() }; }
  renderHome();
}

// ---- Dessin ----
function homeLessonOk(l) { return !!l && lessonsAccessOpen() && lessonOpenToMe(l) && !l.soon && !(l.needs && !flagOpen(l.needs)); }
function homeNeedLessons(need) { return need.lessons.map(id => LESSONS.find(l => l.id === id)).filter(homeLessonOk); }
function homeCard(cls, title, body, extra) {
  return `<section class="home-card ${cls}"><div class="home-card-head"><h3>${escapeHtml(title)}</h3>${extra || ''}</div>${body}</section>`;
}
function homeRemindersHtml() {
  const rows = [];
  if (homeTourReminderShown()) rows.push(`<div class="home-reminder" data-home-reminder="tour"><span class="home-reminder-ico" aria-hidden="true">◎</span><span class="home-reminder-text">${escapeHtml(tr('homeTourReminder'))}</span><button class="btn btn-small btn-primary" type="button" data-home-act="tour-start">${escapeHtml(tr('homeTourStart'))}</button><button class="home-x" type="button" data-home-act="tour-dismiss" title="${escapeAttr(tr('homeTourDismiss'))}" aria-label="${escapeAttr(tr('homeTourDismiss'))}">×</button></div>`);
  if (homeProfileReminderShown()) rows.push(`<div class="home-reminder" data-home-reminder="profile"><span class="home-reminder-ico" aria-hidden="true">☺</span><span class="home-reminder-text">${escapeHtml(tr('homeProfileReminder'))}</span><button class="btn btn-small btn-primary" type="button" data-home-act="profile-start">${escapeHtml(tr('homeProfileStart'))}</button></div>`);
  return rows.length ? `<div class="home-reminders">${rows.join('')}</div>` : '';
}
function homeQuestionHtml() {
  const learnOk = HOME_NEEDS.some(n => homeNeedLessons(n).length);
  const btn = (act, key) => `<button class="btn" type="button" data-home-do="${act}">${escapeHtml(tr(key))}</button>`;
  const learn = learnOk ? `<span class="home-learn-wrap"><button class="btn" type="button" data-home-do="learn" aria-haspopup="true" aria-expanded="${homeLearnOpen}">${escapeHtml(tr('homeDoLearn'))}</button>${homeLearnOpen ? homeLearnHtml() : ''}</span>` : '';
  const albumsOk = !!document.getElementById('navItemAlbums') && !document.getElementById('navItemAlbums').hidden;
  const sellPop = `<div class="home-learn-pop home-sell-pop" role="dialog" aria-label="${escapeAttr(tr('homeSellTitle'))}"><div class="home-learn-head"><strong>${escapeHtml(tr('homeSellTitle'))}</strong><button class="home-x" type="button" data-home-do="learn-close" aria-label="${escapeAttr(tr('homeLearnClose'))}">×</button></div><button type="button" class="home-sell-opt" data-home-do="sell-packs"><b>${escapeHtml(tr('homeSellPacks'))}</b><small>${escapeHtml(tr('homeSellPacksHint'))}</small></button>${albumsOk ? `<button type="button" class="home-sell-opt" data-home-do="sell-albums"><b>${escapeHtml(tr('homeSellAlbums'))}</b><small>${escapeHtml(tr('homeSellAlbumsHint'))}</small></button>` : ''}</div>`;
  const sell = `<span class="home-learn-wrap"><button class="btn" type="button" data-home-do="sell" aria-haspopup="true" aria-expanded="${homeSellOpen}">${escapeHtml(tr('homeDoSell'))}</button>${homeSellOpen ? sellPop : ''}</span>`;
  return `<section class="home-question"><h2>${escapeHtml(tr('homeQuestion'))}</h2><div class="home-choices">${btn('import', 'homeDoImport')}${btn('sfx', 'homeDoSfx')}${btn('video', 'homeDoVideo')}${btn('share', 'homeDoShare')}${btn('team', 'homeDoTeam')}${sell}${btn('tour', 'homeDoTour')}${learn}</div></section>`;
}
function homeLearnHtml() {
  const done = lessonsDone();
  const rows = HOME_NEEDS.map(n => {
    const ls = homeNeedLessons(n);
    if (!ls.length) return '';
    const todo = ls.find(l => !done[l.id]);
    const count = ls.length === 1 ? tr('homeNeedLessons1') : tr('homeNeedLessons', { n: ls.length });
    return `<div class="home-need"><div class="home-need-head"><div class="home-need-text"><b>${escapeHtml(tr(n.key))}</b><small>${escapeHtml(count)}</small></div>${todo ? `<button class="btn btn-small btn-primary" type="button" data-home-lesson="${escapeAttr(todo.id)}">${escapeHtml(tr('homeNeedStart'))}</button>` : `<span class="home-need-done">✓ ${escapeHtml(tr('homeNeedDone'))}</span>`}</div>
      <div class="home-need-lessons">${ls.map(l => `<button type="button" class="home-need-lesson${done[l.id] ? ' is-done' : ''}" data-home-lesson="${escapeAttr(l.id)}">${done[l.id] ? '✓ ' : ''}${escapeHtml(tr(l.titleKey))}</button>`).join('')}</div></div>`;
  }).join('');
  return `<div class="home-learn-pop" role="dialog" aria-label="${escapeAttr(tr('homeLearnTitle'))}"><div class="home-learn-head"><strong>${escapeHtml(tr('homeLearnTitle'))}</strong><button class="home-x" type="button" data-home-do="learn-close" aria-label="${escapeAttr(tr('homeLearnClose'))}">×</button></div>${rows}</div>`;
}
function homeMailHtml() {
  const items = homeInboxItems || [];
  const unread = items.filter(it => it.unread).length;
  const shown = homeMailAll ? items : items.slice(0, 3);
  const head = unread ? `<span class="home-count">${escapeHtml(tr('homeMailUnread', { n: unread }))}</span>` : '';
  const rows = shown.map((it, i) => `<${it.href ? `a href="${escapeAttr(it.href)}"` : 'div'} class="home-mail-item${it.unread ? ' unread' : ''}" data-home-mail="${i}">
      <span class="home-mail-dot" aria-hidden="true"></span>
      <span class="home-mail-body"><span class="home-mail-line"><span class="home-mail-title">${escapeHtml(it.title)}</span><span class="home-mail-time">${formatRelativeTime(it.createdAt)}</span></span><span class="home-mail-text">${escapeHtmlLinkify(it.text || '')}</span></span>
    </${it.href ? 'a' : 'div'}>`).join('');
  const more = items.length > 3 ? `<button class="home-link" type="button" data-home-do="mail-toggle">${escapeHtml(tr(homeMailAll ? 'homeMailLess' : 'homeMailMore'))}</button>` : '';
  return `<section class="home-card home-mail" id="homeMail"><div class="home-card-head"><h3>${escapeHtml(tr('homeMailTitle'))}</h3>${head}</div>${rows || `<div class="home-empty">${escapeHtml(tr('homeMailEmpty'))}</div>`}${more}</section>`;
}
function homeContinueHtml() {
  const list = (homePrefs && homePrefs.recent) || [];
  const kindKey = { track: 'homeContinueTrack', adreel: 'homeContinueAdreel', pack: 'homeContinuePack' };
  const body = list.length
    ? `<div class="home-recent">${list.map(r => `<button type="button" class="home-recent-item" data-home-recent="${escapeAttr(r.kind)}" data-id="${escapeAttr(r.id)}"><span class="home-recent-ico" aria-hidden="true">${{ track: '♪', adreel: '▦', pack: '◈' }[r.kind] || '♪'}</span><span class="home-recent-title">${escapeHtml(r.title || r.id)}</span><small>${escapeHtml(tr(kindKey[r.kind] || 'homeContinueTrack'))}</small></button>`).join('')}</div>`
    : `<div class="home-empty">${escapeHtml(tr('homeContinueEmpty'))}</div>`;
  return homeCard('home-continue', tr('homeContinueTitle'), body);
}
function homeEssentialsHtml() {
  if (!lessonsAccessOpen()) return '';
  const all = `<button class="btn btn-small" type="button" data-home-do="all-tutorials">${escapeHtml(tr('homeEssentialsAll'))}</button>`;
  if (!profileQuizOpen() || !onboardingAnswered(myOnboardingProfile)) {
    const invite = profileQuizOpen() && myOnboardingProfile !== undefined
      ? `<div class="home-empty">${escapeHtml(tr('homeEssentialsInvite'))}</div><button class="btn btn-small btn-primary" type="button" data-home-act="profile-start">${escapeHtml(tr('homeProfileStart'))}</button> `
      : '';
    return homeCard('home-essentials', tr('homeEssentialsTitle'), invite + all);
  }
  const lessons = myEssentialLessons();
  const done = lessonsDone();
  const n = lessons.filter(l => done[l.id]).length;
  const rows = lessons.map(l => `<button type="button" class="home-essential${done[l.id] ? ' is-done' : ''}" data-home-lesson="${escapeAttr(l.id)}" ${(l.soon || !lessonPlayable(l) || (l.needs && !flagOpen(l.needs))) ? 'disabled' : ''}><span class="home-tick">${done[l.id] ? '✓' : ''}</span>${escapeHtml(tr(l.titleKey))}</button>`).join('');
  return homeCard('home-essentials', tr('homeEssentialsTitle'), `${rows}<div class="home-bar"><i style="width:${lessons.length ? Math.round(100 * n / lessons.length) : 0}%"></i></div><div class="home-progress">${escapeHtml(tr('homeEssentialsProgress', { done: n, total: lessons.length }))} · <button class="home-link" type="button" data-home-do="all-tutorials">${escapeHtml(tr('homeEssentialsAll'))}</button></div>`);
}
function homeActivityHtml() {
  const o = homeActivity.overview;
  let body;
  if (homeActivity.state === 'error') body = `<div class="home-empty">${escapeHtml(tr('homeActivityError'))}</div>`;
  else if (!o) body = `<div class="home-empty">${escapeHtml(tr('homeActivityLoading'))}</div>`;
  else if (o.tier === 'free' || o.locked) {
    body = `<div class="home-kpis"><div class="home-kpi"><b>${analyticsBlur('128')}</b><small>${escapeHtml(tr('homeActivityVisits'))}</small></div><div class="home-kpi"><b>${analyticsBlur('347')}</b><small>${escapeHtml(tr('homeActivityPlays'))}</small></div></div><div class="home-empty">${escapeHtml(tr('homeActivityFree'))}</div>`;
  } else if (!o.totals || !o.totals.visits) {
    body = `<div class="home-empty">${escapeHtml(tr('homeActivityEmpty'))}</div><button class="btn btn-small" type="button" data-home-do="copy-link">${escapeHtml(tr('homeActivityCopy'))}</button>`;
  } else {
    const plays = o.tier === 'pro' ? o.totals.plays : '—';
    const spark = typeof analyticsBuildChart === 'function' && o.series && o.series.visits ? `<div class="home-spark">${analyticsBuildChart(o.series.visits, o.buckets, o.bucket, { compact: true })}</div>` : '';
    body = `<div class="home-kpis"><div class="home-kpi"><b>${o.totals.visits}</b><small>${escapeHtml(tr('homeActivityVisits'))}</small></div><div class="home-kpi"><b>${plays}</b><small>${escapeHtml(tr('homeActivityPlays'))}</small></div></div>${spark}`;
  }
  const detail = `<button class="btn btn-small" type="button" data-home-do="analytics">${escapeHtml(tr('homeActivityDetail'))}</button>`;
  return homeCard('home-activity', tr('homeActivityTitle'), body + (o && !(o.tier === 'free' || o.locked) && o.totals && o.totals.visits ? detail : ''), `<span class="home-sub">${escapeHtml(tr('homeActivityDays'))}</span>`);
}
function homeNewsHtml() {
  const lang = currentLang() === 'en' ? 'en' : 'fr';
  const items = HOME_NEWS.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  const body = items.length
    ? items.map(n => { const t = n[lang] || n.fr; return `<div class="home-news-item"><small>${escapeHtml(n.date)}</small><b>${escapeHtml(t.title)}</b><span>${escapeHtml(t.text)}</span></div>`; }).join('')
    : `<div class="home-empty">${escapeHtml(tr('homeNewsEmpty'))}</div>`;
  return homeCard('home-news', tr('homeNewsTitle'), body);
}
function homeQuickHtml() {
  const dark = window.LayerPitchAppearance && window.LayerPitchAppearance.getTheme() === 'dark';
  const helpOn = !(homePrefs && homePrefs.help_off);
  const theme = window.LayerPitchAppearance ? `<div class="home-quick-row"><span>${escapeHtml(tr('homeQuickTheme'))}</span><span class="home-seg"><button type="button" data-home-theme="light" class="${dark ? '' : 'on'}">${escapeHtml(tr('homeThemeLight'))}</button><button type="button" data-home-theme="dark" class="${dark ? 'on' : ''}">${escapeHtml(tr('homeThemeDark'))}</button></span></div>` : '';
  const body = `<label class="home-quick-row"><span><b>${escapeHtml(tr('homeQuickHelp'))}</b><small>${escapeHtml(tr('homeQuickHelpHint'))}</small></span><input type="checkbox" id="homeHelpToggle" ${helpOn ? 'checked' : ''}></label>${theme}
    <details class="home-menu"><summary>${escapeHtml(tr('homeQuickMenu'))}</summary><small class="home-more-hint">${escapeHtml(tr('homeQuickMenuHint'))}</small>${homeMenuEntries().map(e => `<label class="home-menu-row"><input type="checkbox" data-home-menu="${escapeAttr(e.key)}" ${((homePrefs && homePrefs.menu_hidden) || []).includes(e.key) ? '' : 'checked'}> ${escapeHtml(e.label)}</label>`).join('')}</details>
    <details class="home-more"><summary>${escapeHtml(tr('homeQuickMore'))}</summary><small class="home-more-hint">${escapeHtml(tr('homeQuickMoreHint'))}</small><div id="homeMoreHost"></div></details>`;
  return homeCard('home-quick', tr('homeQuickTitle'), body);
}
function renderHome() {
  const root = document.getElementById('homeRoot');
  if (!root || !homeOpen()) return;
  if (!homePrefs) homePrefs = Object.assign({}, homeLocalPrefs());
  const moreOpen = !!(root.querySelector('.home-more') && root.querySelector('.home-more').open);
  const menuOpen = !!(root.querySelector('.home-menu') && root.querySelector('.home-menu').open);
  root.innerHTML = `<header class="home-greeting"><h2>${escapeHtml(tr('homeGreeting'))}</h2><div class="sub">${escapeHtml(tr('homeGreetingSub'))}</div></header>
    ${homeRemindersHtml()}${homeQuestionHtml()}${homeMailHtml()}
    <div class="home-cards">${homeContinueHtml()}${homeEssentialsHtml()}${homeActivityHtml()}${homeNewsHtml()}${homeQuickHtml()}</div>`;
  // Le panneau « Apparence du backstage » (fond, filigrane) vit ici désormais : on le replace dans la carte Réglages rapides.
  const host = document.getElementById('homeMoreHost');
  if (host && homeAppearanceHost) host.appendChild(homeAppearanceHost);
  const more = root.querySelector('.home-more');
  if (more && moreOpen) more.open = true;
  const menuBox = root.querySelector('.home-menu');
  if (menuBox && menuOpen) menuBox.open = true;
  applyHomeMenu();
}

// ---- Actions ----
function homeStartProfileQuiz() { if (!guide && profileQuizOpen()) openGuide('tour', [profileQuizStep({ alone: true })]); }
function homeCloseLearn() { if (!homeLearnOpen && !homeSellOpen) return; homeLearnOpen = false; homeSellOpen = false; renderHome(); }
function homeFocusMailbox() {
  openTab('home');
  homeMailAll = true;
  renderHome();
  const el = document.getElementById('homeMail');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
// La cloche de la barre du haut mène à la boîte aux lettres de l'Accueil (14-connexion-abonnement-admin.js) : true = clic traité.
function homeBellIntercept() {
  if (!homeOpen()) return false;
  homeFocusMailbox();
  return true;
}
function homeDo(act) {
  switch (act) {
    case 'import': openTab('library'); break;
    case 'sfx': openTab('sfxLibrary'); break;
    case 'tour': startBackstageTour(); break;
    case 'sell-packs': homeSellOpen = false; openTab('packs'); break;
    case 'sell-albums': homeSellOpen = false; openTab('albums'); break;
    case 'video': openTab('videoLibrary'); break;
    case 'share': openTab('content'); break;
    case 'team': { const a = document.getElementById('navLinkProjects'); if (a && a.href) window.location.href = a.getAttribute('href'); break; }
    case 'learn': homeLearnOpen = !homeLearnOpen; homeSellOpen = false; renderHome(); return;
    case 'sell': homeSellOpen = !homeSellOpen; homeLearnOpen = false; renderHome(); return;
    case 'learn-close': homeCloseLearn(); return;
    case 'analytics': openTab('analytics'); break;
    case 'all-tutorials': { const b = document.getElementById('btnTutorialMenu'); if (b) b.click(); break; }
    case 'mail-toggle': homeMailAll = !homeMailAll; renderHome(); return;
    case 'copy-link': {
      const url = (document.getElementById('adReelUrlBox') || {}).textContent;
      if (url && navigator.clipboard) navigator.clipboard.writeText(url).then(() => window.LayerPitchNotify && window.LayerPitchNotify.success && window.LayerPitchNotify.success(tr('copyLink'))).catch(() => {});
      return;
    }
    default: return;
  }
  trackBackstageEvent('home_do', { act });
}
(function wireHome() {
  const root = document.getElementById('homeRoot');
  if (!root) return;
  root.addEventListener('click', e => {
    const lesson = e.target.closest('[data-home-lesson]');
    if (lesson && !lesson.disabled) { homeLearnOpen = false; trackBackstageEvent('home_lesson', { id: lesson.dataset.homeLesson }); openLessonFromMenu(lesson.dataset.homeLesson); renderHome(); return; }
    const recent = e.target.closest('[data-home-recent]');
    if (recent) { homeOpenRecent(recent.dataset.homeRecent, recent.dataset.id); return; }
    const theme = e.target.closest('[data-home-theme]');
    if (theme) { window.LayerPitchAppearance.setTheme(theme.dataset.homeTheme); return; }
    const act = e.target.closest('[data-home-act]');
    if (act) {
      const a = act.dataset.homeAct;
      if (a === 'tour-start') startBackstageTour();
      else if (a === 'tour-dismiss') homeSavePrefs({ tour_dismissed: true }).then(() => renderHome());
      else if (a === 'profile-start') homeStartProfileQuiz();
      return;
    }
    const doBtn = e.target.closest('[data-home-do]');
    if (doBtn) { homeDo(doBtn.dataset.homeDo); return; }
    const mail = e.target.closest('.home-mail-item');
    if (mail && !mail.matches('a') && !e.target.closest('a')) {
      mail.classList.toggle('expanded');
      // Lu en grand dans l'Accueil = lu : même relève que la cloche (annonces et messages de contact).
      if (homeInboxItems && homeInboxItems.some(it => it.unread && (it.kind === 'announcement' || it.kind === 'contact')) && window.LayerPitchShell) {
        loadPostgresReadScripts().then(() => window.LayerPitchShell.markInboxSeen());
      }
    }
  });
  root.addEventListener('change', e => {
    if (e.target.dataset && e.target.dataset.homeMenu) {
      const hidden = new Set((homePrefs && homePrefs.menu_hidden) || []);
      if (e.target.checked) hidden.delete(e.target.dataset.homeMenu); else hidden.add(e.target.dataset.homeMenu);
      homeSavePrefs({ menu_hidden: [...hidden] }); applyHomeMenu(); return;
    }
    if (e.target.id === 'homeHelpToggle') { homeSavePrefs({ help_off: !e.target.checked }); applyHomeHelp(); }
  });
  // Une bulle « J'ai besoin de comprendre » se referme d'un clic ailleurs ou d'Échap.
  document.addEventListener('click', e => { if ((homeLearnOpen || homeSellOpen) && !e.target.closest('.home-learn-wrap')) homeCloseLearn(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') homeCloseLearn(); });
  // Réglages d'apparence changés ailleurs (autre onglet, autre panneau) : les boutons Jour/Nuit suivent.
  document.addEventListener('lp-appearance-change', () => renderHome());
  window.addEventListener('storage', e => { if (e.key === LESSONS_DONE_STORAGE) renderHome(); });
})();

// Appelée une fois les feux verts connus (fin de renderAdminOnlyPanels, via syncBackstageTour) : montre l'onglet, charge ce qu'il faut, arrive sur l'Accueil.
function syncHome() {
  const open = homeOpen();
  const nav = document.getElementById('navItemHome');
  if (nav) nav.hidden = !open;
  try { localStorage.setItem(HOME_ON_HINT, open ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  const panel = document.getElementById('homePanel');
  if (!open) {
    document.body.classList.remove('lp-help-off'); applyHomeMenu();
    if (panel && panel.classList.contains('active')) openTab('content'); // feu vert refermé alors qu'on était sur l'Accueil
    return;
  }
  const host = document.getElementById('backstageAppearanceHost');
  if (host && !homeAppearanceHost) {
    homeAppearanceHost = host;
    const fs = host.closest('fieldset');
    if (fs) fs.hidden = true; // le cadre « Apparence du backstage » a déménagé dans l'Accueil
  }
  if (!homeInboxWired && window.LayerPitchShell && window.LayerPitchShell.onInbox) {
    homeInboxWired = true;
    window.LayerPitchShell.onInbox(items => { homeInboxItems = items; renderHome(); });
  }
  loadHomePrefs().then(() => { applyHomeHelp(); renderHome(); });
  applyHomeMenu();
  loadMyOnboardingProfile().then(() => renderHome());
  loadHomeActivity();
  renderHome();
  // Toujours l'Accueil à l'arrivée (rafraîchissement compris), sauf si l'adresse demande un onglet (?tab=…).
  if (!homeArrivalDone) {
    homeArrivalDone = true;
    const active = document.querySelector('.backstage-panel.active');
    if (!new URLSearchParams(location.search).get('tab') && (!active || active.dataset.panel === 'content')) openTab('home');
  }
}
