// layerpitch-studio-home.js — Accueil de l'espace studio (16/11/2026, feu vert « studio_home », admin seulement jusqu'à ouverture).
// Cadrage : layerpitch-docs/2026-11-16-accueil-studio-cadrage.md. Équivalent studio de l'Accueil du Backstage compositeur
// (src/backstage/48-accueil.js) : rappel du tutoriel Projet, « Que veux-tu faire aujourd'hui ? » (actions du mode Projet),
// fenêtre de tchat du projet au dernier message en date (on y lit ET on y poste), cartes Continuer / Boîte aux lettres /
// Mon équipe et mon palier / Packs achetés / Tes essentiels / Ton activité (seulement si une vitrine existe) / Nouveautés /
// Réglages rapides. Cartes repliables (état gardé dans ce navigateur). Textes : espace « studio » de layerpitch-i18n.js.
//
// Usage : LayerPitchStudioHome.mount(panel, { tr, esc, lang, plan, planName, team, purchases, onOpenTab })
(function () {
  const COLLAPSE_KEY = 'lp_studio_home_collapsed_v1';
  const PREFS_LOCAL = 'lp_studio_home_prefs_v1';
  const LESSONS_DONE_STORAGE = 'layerpitch_lessons_done_v1'; // même clé que le Backstage : les coches des leçons suivent
  // Les 4 leçons « essentielles » du profil studio (voir 46-questions-de-profil.js) ; chacune ouvre le tutoriel Projet public.
  const ESSENTIALS = [
    { id: 'pj-create', page: 'projets', key: 'home_les_create' },
    { id: 'pj-moodboard', page: 'projet', key: 'home_les_board' },
    { id: 'pj-music', page: 'projet', key: 'home_les_music' },
    { id: 'pj-map-walk', page: 'projet', key: 'home_les_map' },
  ];
  const NEWS = []; // { date: 'AAAA-MM-JJ', fr: { title, text }, en: { title, text } } — CHAQUE entrée est validée par Jules-Antoine avant ajout.

  const CSS = `
  .home-greeting h2 { margin-bottom: 2px; font-size: 22px; }
  .home-greeting { margin-bottom: 16px; }
  .home-reminders { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .home-reminder { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--text); padding: 9px 14px; background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 8px; }
  .home-reminder > .home-reminder-text { flex: 1; min-width: 180px; }
  .home-x { background: none; border: none; color: var(--text-dimmer); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
  .home-x:hover { color: var(--text); }
  .home-question { margin-bottom: 18px; padding: 18px 20px; background: var(--bg-card); border: 1px solid var(--border); border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 6px 18px rgba(0,0,0,.10); }
  .home-question h2 { font-size: 16px; margin-bottom: 12px; }
  .home-choices { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
  .home-learn-wrap { position: relative; display: inline-block; }
  .home-learn-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; width: 380px; max-width: 92vw; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.14); padding: 12px; }
  .home-learn-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .home-sell-opt { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 9px 4px; border: none; border-top: 1px solid var(--border); background: none; color: var(--text); font-size: 13px; font-family: inherit; cursor: pointer; }
  .home-sell-opt:first-of-type { border-top: none; }
  .home-sell-opt small { color: var(--text-dimmer); font-size: 11px; }
  .home-sell-opt:hover b { color: var(--accent); }
  .home-need { padding: 8px 0; border-top: 1px solid var(--border); }
  .home-need:first-of-type { border-top: none; }
  .home-need-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .home-need-text { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  .home-need-text small { color: var(--text-dimmer); font-size: 11px; }
  .home-need-done { font-size: 11px; color: var(--seq-map-success); white-space: nowrap; }
  .home-need-lessons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .home-need-lesson { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-dim); cursor: pointer; }
  .home-need-lesson:hover { border-color: var(--accent); color: var(--accent); }
  .home-need-lesson.is-done { color: var(--seq-map-success); }
  .home-card { background: var(--bg-card); border: 1px solid var(--border); border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 6px 18px rgba(0,0,0,.10); }
  .home-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
  .home-fold { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 2px 4px; line-height: 1; flex: none; }
  .home-fold:hover { color: var(--text); }
  .home-card-head h2, .home-card-head h3 { flex: 1; min-width: 0; }
  .home-card.is-collapsed .home-card-body, .home-question.is-collapsed .home-card-body { display: none; }
  .home-question .home-card-head h2 { margin-bottom: 0; }
  .home-card-head h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text); }
  .home-count, .home-sub { font-size: 11px; color: var(--text-dimmer); }
  .home-count { background: #e5484d; color: #fff; border-radius: 9px; padding: 0 7px; line-height: 16px; font-weight: 600; margin: 0; }
  .home-mail-pulse { width: 9px; height: 9px; border-radius: 50%; background: #e5484d; box-shadow: 0 0 0 0 rgba(229,72,77,.6); animation: homeMailPulse 1.8s infinite; flex: none; }
  @keyframes homeMailPulse { 70% { box-shadow: 0 0 0 7px rgba(229,72,77,0); } 100% { box-shadow: 0 0 0 0 rgba(229,72,77,0); } }
  .home-link { background: none; border: none; padding: 0; color: var(--accent); font-size: 12px; cursor: pointer; font-family: inherit; }
  .home-link:hover { text-decoration: underline; }
  .home-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; margin-top: 18px; align-items: start; }
  .home-empty { font-size: 12px; color: var(--text-dimmer); margin-bottom: 8px; }
  .home-mail { margin-bottom: 0; }
  .home-reminder-ico { flex: none; opacity: .85; }
  .home-mail-item { display: flex; gap: 10px; padding: 10px 2px; border-top: 1px solid var(--border); text-decoration: none; color: inherit; cursor: pointer; }
  .home-mail-item:first-of-type { border-top: none; }
  .home-mail-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex: none; background: transparent; }
  .home-mail-item.unread .home-mail-dot { background: var(--accent); }
  .home-mail-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .home-mail-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .home-mail-title { font-size: 13px; font-weight: 600; }
  .home-mail-text { font-size: 12px; color: var(--text-dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; }
  .home-mail-item.expanded .home-mail-text { display: block; -webkit-line-clamp: unset; white-space: pre-wrap; }
  .home-mail-time { font-size: 11px; color: var(--text-dimmer); white-space: nowrap; }
  .home-mail > .home-link { margin-top: 8px; }
  .home-recent { display: flex; flex-direction: column; gap: 6px; }
  .home-recent-item { display: flex; align-items: center; gap: 10px; text-align: left; padding: 6px 0; border: none; background: none; color: var(--text); cursor: pointer; font-size: 13px; font-family: inherit; }
  .home-recent-ico { width: 18px; text-align: center; color: var(--text-dimmer); flex: none; }
  .home-recent-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .home-recent-item small { color: var(--text-dimmer); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .home-recent-item:hover .home-recent-title { color: var(--accent); }
  .home-bar { height: 4px; border-radius: 2px; background: var(--border); margin: 10px 0 6px; overflow: hidden; }
  .home-bar i { display: block; height: 100%; background: var(--accent); }
  .home-progress { font-size: 11px; color: var(--text-dimmer); }
  .home-essential { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 5px 0; background: none; border: none; color: var(--text); font-size: 13px; cursor: pointer; font-family: inherit; }
  .home-essential:hover:not(:disabled) { color: var(--accent); }
  .home-essential:disabled { color: var(--text-dimmer); cursor: default; }
  .home-tick { width: 16px; height: 16px; border: 1px solid var(--border); border-radius: 50%; font-size: 10px; line-height: 14px; text-align: center; color: var(--seq-map-success); flex: none; }
  .home-essential.is-done .home-tick { border-color: var(--seq-map-success); }
  .home-essentials .btn, .home-activity .btn { margin-top: 8px; }
  .home-kpis { display: flex; gap: 20px; }
  .home-kpi { display: flex; flex-direction: column; }
  .home-kpi b { font-size: 26px; font-weight: 600; }
  .home-kpi small { font-size: 11px; color: var(--text-dimmer); }
  .home-spark { height: 60px; margin-top: 8px; }
  .home-news-item { display: flex; flex-direction: column; gap: 1px; padding: 6px 0; border-top: 1px solid var(--border); font-size: 12px; }
  .home-news-item:first-of-type { border-top: none; }
  .home-card.home-news { max-height: 360px; overflow-y: auto; }
  .home-news-item small { color: var(--text-dimmer); font-size: 10px; }
  .home-quick-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 12px; cursor: pointer; }
  .home-quick-row small { display: block; color: var(--text-dimmer); font-size: 10px; }
  .home-quick-row > span:first-child { min-width: 0; }
  .home-quick-row, .home-quick-row b { color: var(--text); }
  .home-quick-row b { font-weight: 600; }
  .home-seg { display: inline-flex; flex-shrink: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .home-seg button { white-space: nowrap; border: none; background: var(--bg); color: var(--text-dim); padding: 3px 10px; font-size: 11px; cursor: pointer; }
  .home-seg button.on { background: var(--accent-soft); color: var(--accent); }
    .home-learn-pop { position: fixed; inset: 0; width: auto; max-width: none; border-radius: 0; overflow-y: auto; z-index: 9000; }
    .home-choices .btn { flex: 1 1 100%; }
.home-root a.btn { text-decoration: none; display: inline-block; }
.home-root .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.home-card-head select { max-width: 60%; }
.home-chat-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.home-chat-bar select { flex: 1; min-width: 0; padding: 6px 8px; font-size: 13px; }
.home-chat-name { font-size: 13px; }
.home-thread { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 2px; margin-bottom: 10px; }
.home-bubble { max-width: 86%; align-self: flex-start; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; font-size: 13px; }
.home-bubble.mine { align-self: flex-end; background: var(--accent-soft); border-color: var(--accent); }
.home-bubble-meta { font-size: 10.5px; color: var(--text-dimmer); margin-bottom: 2px; }
.home-bubble-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.home-compose { display: flex; gap: 8px; align-items: flex-end; }
.home-compose textarea { flex: 1; min-height: 44px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font: inherit; background: var(--bg-card); color: var(--text); resize: vertical; }
.home-actions-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.home-reminder-text { flex: 1; min-width: 180px; }
body.lp-help-off #panel:not(.home-root) .hint { display: none; }

  /* Cadres de l'Accueil : une VRAIE surface par thème (le fond de page peut être n'importe quelle couleur choisie, ou sombre en Nuit),
     donc contour franc + ombre en Jour, surface plus claire que le fond + liseré clair en Nuit — plus besoin d'un aplat de couleur derrière. */
  .home-card, .home-question { background: #ffffff; border: 1px solid rgba(20, 30, 50, 0.18); box-shadow: 0 1px 2px rgba(20, 30, 50, 0.10), 0 10px 28px rgba(20, 30, 50, 0.13); }
  html[data-theme="dark"] .home-card, html[data-theme="dark"] .home-question { background: #262a31; border-color: rgba(255, 255, 255, 0.20); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 12px 30px rgba(0, 0, 0, 0.55); }
  html[data-theme="dark"] .home-bubble { background: #1d2025; }
  html[data-theme="dark"] .home-bubble.mine { background: #1f3550; }
`;
  (function injectCss() { if (document.getElementById('lpStudioHomeCss')) return; const st = document.createElement('style'); st.id = 'lpStudioHomeCss'; st.textContent = CSS; document.head.appendChild(st); })();

  let ctx = null, root = null;
  let prefs = null, prefsDbOk = true;
  let projects = [], projectsLoaded = false;
  let chat = { projectId: null, messages: [], loaded: false, sending: false, error: '' };
  let inboxItems = null, inboxWired = false, mailAll = false;
  let activity = { state: 'idle', visits: 0, hasVitrine: false };
  let learnOpen = false;

  const client = () => window.LayerPitchSupabaseClient.getClient();
  const PJ = () => window.LayerPitchProjects;
  const $ = id => document.getElementById(id);

  // ---- Réglages gardés (compte d'abord, ce navigateur en repli) ----
  function localPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_LOCAL) || '{}') || {}; } catch (e) { return {}; } }
  async function loadPrefs() {
    if (prefs) return prefs;
    let fromDb = null;
    try {
      const { data, error } = await client().from('profiles').select('home_prefs').maybeSingle();
      if (error) prefsDbOk = false; else fromDb = (data && data.home_prefs) || {};
    } catch (e) { prefsDbOk = false; }
    prefs = Object.assign({}, localPrefs(), fromDb || {});
    return prefs;
  }
  async function savePrefs(patch) {
    prefs = Object.assign({}, prefs || {}, patch);
    try { localStorage.setItem(PREFS_LOCAL, JSON.stringify(Object.assign(localPrefs(), patch))); } catch (e) { /* stockage indisponible */ }
    if (prefsDbOk) {
      try { const { error } = await client().rpc('set_my_home_prefs', { p: patch }); if (error) prefsDbOk = false; } catch (e) { prefsDbOk = false; }
    }
  }
  function lessonsDone() { try { return JSON.parse(localStorage.getItem(LESSONS_DONE_STORAGE) || '{}') || {}; } catch (e) { return {}; } }
  function collapsedSet() { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch (e) { return new Set(); } }
  function isCollapsed(id) { return collapsedSet().has(id); }
  function toggleCollapse(id) {
    const s = collapsedSet(); if (s.has(id)) s.delete(id); else s.add(id);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s])); } catch (e) { /* stockage indisponible */ }
    render();
  }
  function applyHelp() { document.body.classList.toggle('lp-help-off', !!(prefs && prefs.help_off)); }

  // ---- Données ----
  async function loadProjects() {
    try {
      const r = await client().rpc('my_projects_latest_messages');
      projects = r.error ? [] : (r.data || []);
    } catch (e) { projects = []; }
    projectsLoaded = true;
    if (!chat.projectId || !projects.some(p => p.id === chat.projectId)) chat.projectId = projects.length ? projects[0].id : null;
  }
  async function loadChat() {
    chat.loaded = false; chat.messages = []; chat.error = '';
    if (!chat.projectId) { chat.loaded = true; return; }
    const r = await PJ().messages(chat.projectId);
    if (r.error) chat.error = r.error; else chat.messages = (r.data || []).slice().reverse();
    chat.loaded = true;
    const newest = chat.messages[chat.messages.length - 1];
    if (newest) { try { localStorage.setItem('layerpitch_project_seen_' + chat.projectId, newest.createdAt); } catch (e) { /* facultatif */ } }
    try { PJ().markSeen(chat.projectId); } catch (e) { /* facultatif */ }
  }
  async function loadActivity() {
    if (activity.state !== 'idle') return;
    activity.state = 'loading';
    try {
      let visits = 0, any = false;
      for (const p of projects.slice(0, 8)) {
        const v = await PJ().vitrines(p.id);
        for (const vit of (v.data || [])) {
          any = true;
          const s = await PJ().vitrineStats(vit.id, 30);
          if (s.data && !s.error) visits += Number(s.data.visits) || 0;
        }
      }
      activity = { state: 'done', visits, hasVitrine: any };
    } catch (e) { activity = { state: 'done', visits: 0, hasVitrine: false }; }
    render();
  }

  // ---- Dessin ----
  const tr = (k, v) => ctx.tr(k, v);
  const esc = s => ctx.esc(s);
  function foldBtn(id) {
    const c = isCollapsed(id); const label = tr(c ? 'home_unfold' : 'home_fold');
    return `<button class="home-fold" type="button" data-fold="${esc(id)}" aria-expanded="${!c}" title="${esc(label)}" aria-label="${esc(label)}">${c ? '▸' : '▾'}</button>`;
  }
  function card(id, title, body, extra, cls) {
    return `<section class="home-card ${cls || ''}${isCollapsed(id) ? ' is-collapsed' : ''}" id="${esc(id)}"><div class="home-card-head"><h3>${esc(title)}</h3>${extra || ''}${foldBtn(id)}</div><div class="home-card-body">${body}</div></section>`;
  }
  const projUrl = (id, tab) => `projet.html?id=${encodeURIComponent(id)}${tab ? '&tab=' + tab : ''}&lang=${ctx.lang}`;
  const latest = () => projects[0] || null;
  function ago(iso) { return window.LayerPitchShell && window.LayerPitchShell.relTime ? window.LayerPitchShell.relTime(iso) : new Date(iso).toLocaleDateString(ctx.lang); }

  function reminderHtml() {
    const done = lessonsDone();
    if ((prefs && prefs.studio_tour_dismissed) || ESSENTIALS.some(l => done[l.id])) return '';
    return `<div class="home-reminders"><div class="home-reminder"><span class="home-reminder-ico" aria-hidden="true">◎</span><span class="home-reminder-text">${esc(tr('home_tourReminder'))}</span><a class="btn primary" href="${esc(lessonUrl(ESSENTIALS[0]))}">${esc(tr('home_tourStart'))}</a><button class="home-x" type="button" data-act="tour-dismiss" title="${esc(tr('home_tourDismiss'))}" aria-label="${esc(tr('home_tourDismiss'))}">×</button></div></div>`;
  }
  function lessonUrl(l) { return `${l.page}.html?tuto&lesson=${encodeURIComponent(l.id)}&lang=${ctx.lang}`; }

  function questionHtml() {
    const p = latest();
    const go = (href, key, extra) => `<a class="btn" href="${esc(href)}"${extra || ''}>${esc(tr(key))}</a>`;
    const board = p ? projUrl(p.id, 'board') : 'projets.html?lang=' + ctx.lang;
    const map = p ? projUrl(p.id, 'map') : 'projets.html?lang=' + ctx.lang;
    const tasks = p ? projUrl(p.id, 'tasks') : null;
    const learnPop = learnOpen ? `<div class="home-learn-pop" role="dialog" aria-label="${esc(tr('home_learnTitle'))}"><div class="home-learn-head"><strong>${esc(tr('home_learnTitle'))}</strong><button class="home-x" type="button" data-act="learn-close" aria-label="${esc(tr('home_learnClose'))}">×</button></div>${learnRows()}</div>` : '';
    const body = `<div class="home-choices">${go('projets.html?lang=' + ctx.lang, 'home_doCreate')}${go('projets.html?lang=' + ctx.lang, 'home_doResume')}${go(board, 'home_doBoard')}${go(map, 'home_doMap')}${tasks ? go(tasks, 'home_doTasks') : ''}${go('studio.html?tab=video&lang=' + ctx.lang, 'home_doVideo')}<span class="home-learn-wrap"><button class="btn" type="button" data-act="learn" aria-haspopup="true" aria-expanded="${learnOpen}">${esc(tr('home_doLearn'))}</button>${learnPop}</span></div>`;
    return `<section class="home-question${isCollapsed('home-question') ? ' is-collapsed' : ''}"><div class="home-card-head"><h2>${esc(tr('home_question'))}</h2>${foldBtn('home-question')}</div><div class="home-card-body">${body}</div></section>`;
  }
  function learnRows() {
    const done = lessonsDone();
    const all = [...ESSENTIALS, { id: 'pj-chat', page: 'projet', key: 'home_les_chat' }, { id: 'pj-map-build', page: 'projet', key: 'home_les_mapbuild' }];
    return all.map(l => `<a class="home-sell-opt" href="${esc(lessonUrl(l))}"><b>${done[l.id] ? '✓ ' : ''}${esc(tr(l.key))}</b></a>`).join('');
  }

  // ---- Fenêtre de tchat (lecture + saisie) ----
  function chatHtml() {
    if (!projectsLoaded) return card('home-chat', tr('home_chatTitle'), `<div class="home-empty">${esc(tr('home_loading'))}</div>`);
    if (!projects.length) return card('home-chat', tr('home_chatTitle'), `<div class="home-empty">${esc(tr('home_chatNone'))}</div><a class="btn primary" href="projets.html?lang=${ctx.lang}">${esc(tr('home_doCreate'))}</a>`);
    const sel = projects.length > 1 ? `<select id="homeChatSel" aria-label="${esc(tr('home_chatPick'))}">${projects.map(p => `<option value="${esc(p.id)}"${p.id === chat.projectId ? ' selected' : ''}>${esc(p.title)}${Number(p.unread) ? ' (' + Number(p.unread) + ')' : ''}</option>`).join('')}</select>` : `<strong class="home-chat-name">${esc((projects[0] || {}).title)}</strong>`;
    const list = !chat.loaded ? `<div class="home-empty">${esc(tr('home_loading'))}</div>`
      : chat.error ? `<div class="home-empty">${esc(chat.error)}</div>`
      : chat.messages.length ? chat.messages.slice(-30).map(m => `<div class="home-bubble${m.mine ? ' mine' : ''}"><div class="home-bubble-meta">${esc(m.authorEmail || '')} · ${esc(new Date(m.createdAt).toLocaleString(ctx.lang))}</div><div class="home-bubble-body">${linkify(m.body || '')}</div></div>`).join('')
      : `<div class="home-empty">${esc(tr('home_chatEmpty'))}</div>`;
    const body = `<div class="home-chat-bar">${sel}<a class="home-link" href="${esc(projUrl(chat.projectId))}">${esc(tr('home_chatOpen'))}</a></div>
      <div class="home-thread" id="homeThread">${list}</div>
      <div class="home-compose"><textarea id="homeMsg" rows="2" placeholder="${esc(tr('home_chatPlaceholder'))}"></textarea><button class="btn primary" id="homeSend" type="button"${chat.sending ? ' disabled' : ''}>${esc(tr('home_chatSend'))}</button></div>
      <div class="msg" id="homeChatMsg"></div>`;
    return card('home-chat', tr('home_chatTitle'), body, '', 'home-chat');
  }
  function linkify(body) {
    return esc(body).replace(/https?:\/\/[^\s<>"']+/g, raw => `<a href="${raw}" target="_blank" rel="noopener noreferrer">${raw}</a>`);
  }
  async function sendMessage() {
    const box = $('homeMsg'); if (!box || chat.sending) return;
    const text = box.value.trim(); if (!text || !chat.projectId) return;
    chat.sending = true; $('homeSend').disabled = true;
    const r = await PJ().post(chat.projectId, text, []);
    chat.sending = false;
    if (r.error) { $('homeSend').disabled = false; const m = $('homeChatMsg'); if (m) { m.textContent = tr('errorPrefix', { message: r.error }); m.className = 'msg err'; } return; }
    await loadChat(); await loadProjects(); render();
    const th = $('homeThread'); if (th) th.scrollTop = th.scrollHeight;
  }

  // ---- Cartes ----
  function mailHtml() {
    const items = inboxItems || [];
    const unread = items.filter(it => it.unread).length;
    const shown = mailAll ? items : items.slice(0, 3);
    const collapsed = isCollapsed('home-mail');
    const extra = `${unread && collapsed ? '<span class="home-mail-pulse" aria-hidden="true"></span>' : ''}${unread ? `<span class="home-count">${esc(tr('home_mailUnread', { n: unread }))}</span>` : ''}`;
    const rows = shown.map((it, i) => `<${it.href ? `a href="${esc(it.href)}"` : 'div'} class="home-mail-item${it.unread ? ' unread' : ''}" data-mail="${i}"><span class="home-mail-dot" aria-hidden="true"></span><span class="home-mail-body"><span class="home-mail-line"><span class="home-mail-title">${esc(it.title)}</span><span class="home-mail-time">${esc(ago(it.createdAt))}</span></span><span class="home-mail-text">${esc(it.text || '')}</span></span></${it.href ? 'a' : 'div'}>`).join('');
    const more = items.length > 3 ? `<button class="home-link" type="button" data-act="mail-toggle">${esc(tr(mailAll ? 'home_mailLess' : 'home_mailMore'))}</button>` : '';
    return card('home-mail', tr('home_mailTitle'), (rows || `<div class="home-empty">${esc(tr('home_mailEmpty'))}</div>`) + more, extra, 'home-mail');
  }
  function continueHtml() {
    const rows = projects.slice(0, 3).map(p => `<a class="home-recent-item" href="${esc(projUrl(p.id))}"><span class="home-recent-ico" aria-hidden="true">▦</span><span class="home-recent-title">${esc(p.title)}</span><small>${esc(tr('home_kindProject'))}</small></a>`).join('');
    return card('home-continue', tr('home_continueTitle'), rows ? `<div class="home-recent">${rows}</div>` : `<div class="home-empty">${esc(tr('home_continueEmpty'))}</div>`);
  }
  function teamHtml() {
    const t = ctx.team;
    const used = t && Array.isArray(t.members) ? 1 + t.members.length : 0;
    const body = `<div class="home-quick-row"><span><b>${esc(tr('home_teamPlan'))}</b><small>${esc(ctx.planName || '')}</small></span></div>
      <div class="home-quick-row"><span><b>${esc(tr('home_teamMembers'))}</b><small>${used ? esc(tr('home_teamCount', { used, max: t.quota == null ? '∞' : t.quota })) : esc(tr('home_teamNone'))}</small></span></div>
      <div class="home-actions-row"><a class="btn" href="studio.html?tab=team&lang=${ctx.lang}">${esc(tr('home_teamInvite'))}</a><a class="btn" href="studio.html?tab=plan&lang=${ctx.lang}">${esc(tr('home_teamPlanOpen'))}</a></div>`;
    return card('home-team', tr('home_teamTitle'), body);
  }
  function packsHtml() {
    const list = (ctx.purchases || []).slice(0, 3);
    const rows = list.map(p => `<a class="home-recent-item" href="studio.html?tab=library&lang=${ctx.lang}"><span class="home-recent-ico" aria-hidden="true">◈</span><span class="home-recent-title">${esc((p.pack && p.pack.title) || '')}</span></a>`).join('');
    return card('home-packs', tr('home_packsTitle'), (rows ? `<div class="home-recent">${rows}</div>` : `<div class="home-empty">${esc(tr('home_packsEmpty'))}</div>`) + `<a class="home-link" href="studio.html?tab=library&lang=${ctx.lang}">${esc(tr('home_packsAll'))}</a>`);
  }
  function essentialsHtml() {
    const done = lessonsDone();
    const n = ESSENTIALS.filter(l => done[l.id]).length;
    const rows = ESSENTIALS.map(l => `<a class="home-essential${done[l.id] ? ' is-done' : ''}" href="${esc(lessonUrl(l))}"><span class="home-tick">${done[l.id] ? '✓' : ''}</span>${esc(tr(l.key))}</a>`).join('');
    return card('home-essentials', tr('home_essentialsTitle'), `${rows}<div class="home-bar"><i style="width:${Math.round(100 * n / ESSENTIALS.length)}%"></i></div><div class="home-progress">${esc(tr('home_essentialsProgress', { done: n, total: ESSENTIALS.length }))}</div>`);
  }
  function activityHtml() {
    if (activity.state !== 'done' || !activity.hasVitrine) return ''; // pas de vitrine : pas de carte
    return card('home-activity', tr('home_activityTitle'), `<div class="home-kpis"><div class="home-kpi"><b>${activity.visits}</b><small>${esc(tr('home_activityVisits'))}</small></div></div>`, `<span class="home-sub">${esc(tr('home_activityDays'))}</span>`);
  }
  function newsHtml() {
    const lang = ctx.lang === 'en' ? 'en' : 'fr';
    const items = NEWS.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
    const body = items.length ? items.map(n => { const t = n[lang] || n.fr; return `<div class="home-news-item"><small>${esc(n.date)}</small><b>${esc(t.title)}</b><span>${esc(t.text)}</span></div>`; }).join('') : `<div class="home-empty">${esc(tr('home_newsEmpty'))}</div>`;
    return card('home-news', tr('home_newsTitle'), body);
  }
  // Cartes que la personne peut masquer (« Personnaliser la page d'accueil ») ; Réglages rapides reste toujours là.
  const CARDS = [['question', 'home_question'], ['chat', 'home_chatTitle'], ['mail', 'home_mailTitle'], ['continue', 'home_continueTitle'], ['team', 'home_teamTitle'], ['packs', 'home_packsTitle'], ['essentials', 'home_essentialsTitle'], ['activity', 'home_activityTitle'], ['news', 'home_newsTitle']];
  const cardOn = id => !((prefs && prefs.studio_cards_hidden) || []).includes(id);
  function quickHtml() {
    const dark = window.LayerPitchAppearance && window.LayerPitchAppearance.getTheme() === 'dark';
    const helpOn = !(prefs && prefs.help_off);
    const theme = window.LayerPitchAppearance ? `<div class="home-quick-row"><span>${esc(tr('home_quickTheme'))}</span><span class="home-seg"><button type="button" data-theme="light" class="${dark ? '' : 'on'}">${esc(tr('home_themeLight'))}</button><button type="button" data-theme="dark" class="${dark ? 'on' : ''}">${esc(tr('home_themeDark'))}</button></span></div>` : '';
    return card('home-quick', tr('home_quickTitle'), `<label class="home-quick-row"><span><b>${esc(tr('home_quickHelp'))}</b><small>${esc(tr('home_quickHelpHint'))}</small></span><input type="checkbox" id="homeHelpToggle" ${helpOn ? 'checked' : ''}></label>${theme}<details class="home-menu"><summary>${esc(tr('home_quickCards'))}</summary><small class="home-more-hint">${esc(tr('home_quickCardsHint'))}</small>${CARDS.map(c => `<label class="home-menu-row"><input type="checkbox" data-card="${c[0]}" ${cardOn(c[0]) ? 'checked' : ''}> ${esc(tr(c[1]))}</label>`).join('')}</details>`);
  }

  function render() {
    if (!root || !root.isConnected) return;
    const keepMsg = ($('homeMsg') || {}).value || '';
    const menuOpen = !!(root.querySelector('.home-menu') && root.querySelector('.home-menu').open);
    root.innerHTML = `<header class="home-greeting"><h2>${esc(tr('home_greeting'))}</h2></header>
      ${reminderHtml()}${cardOn('question') ? questionHtml() : ''}${cardOn('chat') ? chatHtml() : ''}${cardOn('mail') ? mailHtml() : ''}
      <div class="home-cards">${cardOn('continue') ? continueHtml() : ''}${cardOn('essentials') ? essentialsHtml() : ''}${cardOn('team') ? teamHtml() : ''}${cardOn('packs') ? packsHtml() : ''}${cardOn('activity') ? activityHtml() : ''}${cardOn('news') ? newsHtml() : ''}${quickHtml()}</div>`;
    const box = $('homeMsg'); if (box && keepMsg) box.value = keepMsg;
    const menuBox = root.querySelector('.home-menu'); if (menuBox && menuOpen) menuBox.open = true;
    const th = $('homeThread'); if (th) th.scrollTop = th.scrollHeight;
    applyHelp();
  }

  function wire() {
    root.addEventListener('click', e => {
      const fold = e.target.closest('[data-fold]'); if (fold) return toggleCollapse(fold.dataset.fold);
      const theme = e.target.closest('[data-theme]'); if (theme) { window.LayerPitchAppearance.setTheme(theme.dataset.theme); return; }
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'tour-dismiss') savePrefs({ studio_tour_dismissed: true }).then(render);
        else if (a === 'learn') { learnOpen = !learnOpen; render(); }
        else if (a === 'learn-close') { learnOpen = false; render(); }
        else if (a === 'mail-toggle') { mailAll = !mailAll; render(); }
        return;
      }
      if (e.target.id === 'homeSend') return sendMessage();
      const mail = e.target.closest('.home-mail-item');
      if (mail && !mail.matches('a') && !e.target.closest('a')) {
        mail.classList.toggle('expanded');
        if (inboxItems && inboxItems.some(it => it.unread && (it.kind === 'announcement' || it.kind === 'contact')) && window.LayerPitchShell && window.LayerPitchShell.markInboxSeen) window.LayerPitchShell.markInboxSeen();
      }
    });
    root.addEventListener('keydown', e => { if (e.target.id === 'homeMsg' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); } });
    root.addEventListener('change', async e => {
      if (e.target.id === 'homeChatSel') { chat.projectId = e.target.value; render(); await loadChat(); render(); return; }
      if (e.target.dataset && e.target.dataset.card) {
        const hidden = new Set((prefs && prefs.studio_cards_hidden) || []);
        if (e.target.checked) hidden.delete(e.target.dataset.card); else hidden.add(e.target.dataset.card);
        await savePrefs({ studio_cards_hidden: [...hidden] }); render(); return;
      }
      if (e.target.id === 'homeHelpToggle') { await savePrefs({ help_off: !e.target.checked }); applyHelp(); }
    });
    document.addEventListener('click', e => { if (learnOpen && root.isConnected && !e.target.closest('.home-learn-wrap')) { learnOpen = false; render(); } });
    document.addEventListener('lp-appearance-change', () => render());
  }

  let wired = false;
  async function mount(panel, options) {
    ctx = options; root = panel; panel.classList.add('home-root');
    if (!wired) { wired = true; wire(); }
    await loadPrefs();
    render();
    if (!inboxWired && window.LayerPitchShell && window.LayerPitchShell.onInbox) {
      inboxWired = true;
      window.LayerPitchShell.onInbox(items => { inboxItems = items; render(); });
    }
    await loadProjects(); render();
    await loadChat(); render();
    loadActivity();
  }
  function unmount() { if (root) root.classList.remove('home-root'); }
  // L'aide coupée vaut pour tout l'espace studio : appelée au chargement de la page, sans afficher l'Accueil.
  async function applyHelpOnly() { await loadPrefs(); applyHelp(); }

  window.LayerPitchStudioHome = { mount, unmount, applyHelpOnly };
})();
