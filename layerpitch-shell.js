// layerpitch-shell.js — LayerPitch, barre latérale commune des pages d'espace (28/09, demande de Jules-Antoine :
// « reprendre le concept de backstage partout, avec une hiérarchie allant de gauche à droite »).
//
// Gauche : la barre (toujours la même, organisée par casquette : Compositeur / Studio / Commun ; chacun ne voit que
// ses casquettes). Droite : un fil d'Ariane cliquable (sert de retour) puis la page. Pour l'admin : un bloc « Voir
// en tant que » (casquette, palier compositeur, palier studio, masquer ce qui n'est pas encore ouvert), mémorisé côté
// serveur (migration 20260928110000) et donc actif sur toutes les pages. Sans session : aucune barre (pages
// publiques ou écran de connexion). Téléphone : la barre se replie derrière un bouton « Menu ».
// Ordinateur : la barre se replie en icônes seules (bouton en haut de la barre, choix mémorisé dans le navigateur et
// commun à toutes les pages). Le Backstage garde sa propre barre mais réutilise ce même bouton :
//   LayerPitchShell.collapsible(navElement, { selector: '.nav-item' })
//
// Utilisation (après supabase-js, layerpitch-i18n.js, api/supabase-client.js, api/auth.js) :
//   LayerPitchShell.mount({ active: 'studio.team', crumbs: [{ label, href }, { label }] });
//   LayerPitchShell.mount({ active, crumbs, bare: true })  // page plein écran (lecteur) : ni marge ni fil d'Ariane
//   LayerPitchShell.update({ active, crumbs })        // changement d'onglet sans rechargement
//   LayerPitchShell.onNavigate(url => true|false)     // la page gère elle-même un lien de la barre (même page)
(function () {
  const lang = () => {
    const q = new URLSearchParams(location.search).get('lang');
    let stored = null;
    try { stored = localStorage.getItem('layerpitch_lang'); } catch (e) { /* stockage indisponible */ }
    return (q || stored || 'fr') === 'en' ? 'en' : 'fr';
  };
  function tr(key, vars) {
    const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
    let s = ((I[lang()] || {}).shell || {})[key] || ((I.fr || {}).shell || {})[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const withLang = href => (lang() === 'en' ? href + (href.includes('?') ? '&' : '?') + 'lang=en' : href);

  // Icônes au trait (même esprit que la barre du Backstage).
  const ICONS = {
    backstage: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    sales: '<path d="M17 5.5A7 7 0 1 0 17 18.5M3 10h10M3 14h10"/>',
    purchases: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
    catalog: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    custom: '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7 12 12l8.7-5M12 22V12"/>',
    team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    plan: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    projects: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    invitations: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6"/>',
    albums: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>',
    account: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8"/>',
    appearance: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    pricing: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01"/>',
  };
  const icon = k => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;

  const CSS = `
  body.lp-shell-on { padding: 0 !important; }
  .lp-shell { display: flex; min-height: 100vh; align-items: stretch; }
  .lp-nav { width: 232px; flex: 0 0 232px; background: var(--bg-sidebar, #eef0f3); border-right: 1px solid var(--border, #e2e2e6); padding: 18px 12px 24px;
    position: sticky; top: 0; height: 100vh; overflow-y: auto; box-sizing: border-box; font-family: var(--font-body, 'Inter', system-ui, sans-serif); }
  .lp-nav-brand { display: block; font-family: var(--font-title, 'Space Grotesk', sans-serif); font-weight: 700; font-size: 17px; color: var(--text, #24262b); text-decoration: none; padding: 2px 10px 14px; }
  .lp-nav-section { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-dimmer, #9a9ea6); margin: 16px 10px 6px; font-weight: 600; }
  .lp-nav a.lp-item { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 8px; color: var(--text, #24262b); text-decoration: none; font-size: 13.5px; line-height: 1.25; }
  .lp-nav a.lp-item:hover { background: rgba(47, 128, 192, .08); }
  .lp-nav a.lp-item[aria-current="page"] { background: var(--bg-card, #ffffff); color: var(--accent, #2f80c0); font-weight: 600; box-shadow: 0 0 0 1px var(--border, #e2e2e6); }
  .lp-nav a.lp-item svg { flex: 0 0 auto; opacity: .8; }
  .lp-nav a.lp-sub { padding: 5px 10px 5px 35px; font-size: 12.5px; color: var(--text-dim, #5f636b); }
  .lp-nav a.lp-sub[aria-current="page"] { box-shadow: none; background: transparent; }
  .lp-badge { margin-left: auto; background: var(--accent, #2f80c0); color: #fff; font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 1px 7px; }
  .lp-ap-btn { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; margin-top: 6px; border: 0; border-radius: 8px; background: none; color: var(--text, #24262b); font: inherit; font-size: 13.5px; cursor: pointer; text-align: left; }
  .lp-ap-btn:hover { background: rgba(47, 128, 192, .08); }
  .lp-ap-pop { position: fixed; left: 244px; bottom: 16px; z-index: 1100; width: min(320px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
    background: var(--bg-card, #fff); border: 1px solid var(--border, #e2e2e6); border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.18); padding: 14px; }
  .lp-ap-pop-head { font-weight: 600; font-size: 13px; margin-bottom: 10px; color: var(--text, #24262b); }
  html.lp-sidebar-collapsed .lp-ap-pop { left: 76px; }
  html.lp-sidebar-collapsed .lp-ap-btn span { display: none; }
  @media (max-width: 860px) { .lp-ap-pop { left: 16px; right: 16px; width: auto; } }
  .lp-nav-foot { margin-top: 18px; padding: 10px; border-top: 1px solid var(--border, #e2e2e6); font-size: 12px; color: var(--text-dim, #5f636b); }
  .lp-nav-foot button { background: none; border: 0; padding: 0; color: var(--text-dim, #5f636b); cursor: pointer; font: inherit; text-decoration: underline; }
  .lp-preview { margin: 16px 0 0; padding: 10px; border-radius: 10px; background: var(--bg-card, #ffffff); border: 1px dashed var(--accent, #2f80c0); font-size: 12px; }
  .lp-preview-title { font-weight: 600; color: var(--accent, #2f80c0); margin-bottom: 6px; }
  .lp-preview label { display: block; color: var(--text-dim, #5f636b); margin: 7px 0 3px; font-size: 11.5px; }
  .lp-preview select { width: 100%; font: inherit; padding: 4px 6px; border: 1px solid var(--border, #e2e2e6); border-radius: 6px; background: var(--bg-card, #fff); color: var(--text, #24262b); }
  .lp-preview .lp-check { display: flex; gap: 6px; align-items: flex-start; margin-top: 8px; color: var(--text, #24262b); }
  .lp-preview .lp-check input { margin: 2px 0 0; }
  .lp-deletion { margin: 0 0 14px; padding: 9px 14px; border-radius: 8px; background: rgba(178, 34, 51, .1); border: 1px solid #b23; color: var(--text, #24262b); font-size: 13px; }
  .lp-deletion a { color: #b23; font-weight: 600; }
  .lp-main { flex: 1 1 auto; min-width: 0; padding: 22px 28px 60px; box-sizing: border-box; }
  .lp-crumbs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--text-dim, #5f636b); margin: 0 auto 14px; max-width: var(--lp-page-width, 1040px); min-height: 22px; }
  .lp-crumbs a { color: var(--accent, #2f80c0); text-decoration: none; }
  .lp-crumbs a:hover { text-decoration: underline; }
  .lp-crumbs .lp-back { font-size: 16px; line-height: 1; margin-right: 2px; }
  .lp-crumb-sep { color: var(--text-dimmer, #9a9ea6); }
  .lp-preview-banner { margin-left: auto; font-size: 11.5px; background: #e6eef8; color: var(--accent, #2f80c0); border-radius: 999px; padding: 3px 10px; }
  .lp-menu-btn { display: none; border: 1px solid var(--border, #e2e2e6); background: var(--bg-card, #fff); border-radius: 8px; padding: 5px 10px; font: inherit; font-size: 13px; cursor: pointer; color: var(--text, #24262b); }
  .lp-nav-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
  .lp-nav, .lp-nav a.lp-item { transition: width .15s ease, flex-basis .15s ease, padding .15s ease; }
  @media (min-width: 821px) {
    html.lp-sidebar-collapsed .lp-nav { width: 60px; flex-basis: 60px; padding: 14px 10px 24px; overflow-x: hidden; }
    html.lp-sidebar-collapsed .lp-nav-top { justify-content: center; margin-bottom: 4px; }
    html.lp-sidebar-collapsed .lp-nav-brand,
    html.lp-sidebar-collapsed .lp-nav a.lp-sub,
    html.lp-sidebar-collapsed .lp-preview,
    html.lp-sidebar-collapsed .lp-nav-foot,
    html.lp-sidebar-collapsed .lp-nav a.lp-item > span:not(.lp-badge) { display: none; }
    html.lp-sidebar-collapsed .lp-nav-section { font-size: 0; height: 1px; margin: 12px 4px; background: var(--border, #e2e2e6); }
    html.lp-sidebar-collapsed .lp-nav a.lp-item { justify-content: center; padding: 9px 0; position: relative; }
    html.lp-sidebar-collapsed .lp-nav a.lp-item svg { opacity: 1; }
    html.lp-sidebar-collapsed .lp-badge { position: absolute; top: 2px; right: 2px; margin: 0; font-size: 9px; padding: 0 5px; }
  }
  .lp-crumbs .lp-bell-host { margin-left: auto; }
  .lp-preview-banner + .lp-bell-host { margin-left: 8px; }
  .lp-bell-host { position: relative; }
  .lp-bell-floating { position: fixed; top: 10px; right: 14px; z-index: 900; }
  .lp-bell { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px;
    border: 1px solid var(--border, #e2e2e6); background: var(--bg-card, #fff); color: var(--text-dim, #5f636b); cursor: pointer; }
  .lp-bell:hover, .lp-bell[aria-expanded="true"] { color: var(--accent, #2f80c0); border-color: var(--accent, #2f80c0); }
  .lp-bell-badge { position: absolute; top: -6px; right: -7px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 999px; background: var(--accent, #2f80c0);
    color: #fff; font-size: 10px; font-weight: 700; line-height: 17px; text-align: center; box-sizing: border-box; }
  .lp-bell-panel { position: absolute; right: 0; top: 40px; width: min(380px, calc(100vw - 32px)); max-height: 70vh; overflow-y: auto; background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e2e2e6); border-radius: 12px; box-shadow: 0 12px 32px rgba(20, 22, 30, .16); z-index: 1200; text-align: left; }
  .lp-bell-head { font-weight: 600; font-size: 13px; padding: 12px 14px; border-bottom: 1px solid var(--border, #e2e2e6); color: var(--text, #24262b); }
  .lp-bell-item { display: block; padding: 10px 14px 10px 26px; border-bottom: 1px solid var(--border, #e2e2e6); color: var(--text, #24262b); text-decoration: none; position: relative; }
  a.lp-bell-item:hover { background: rgba(47, 128, 192, .06); }
  .lp-crumbs a.lp-bell-item, .lp-crumbs a.lp-bell-item:hover { color: var(--text, #24262b); text-decoration: none; }
  .lp-bell-item.unread::before { content: ''; position: absolute; left: 11px; top: 16px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent, #2f80c0); }
  .lp-bell-item-title { font-size: 13px; font-weight: 600; line-height: 1.35; }
  .lp-bell-item-text { font-size: 12.5px; color: var(--text-dim, #5f636b); margin-top: 2px; line-height: 1.4; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  div.lp-bell-item:has(.lp-bell-item-text) { cursor: pointer; }
  .lp-bell-item-text { white-space: pre-line; }
  .lp-bell-item-text a { color: var(--accent, #2f80c0); }
  .lp-bell-item-text.expanded { display: block; -webkit-line-clamp: unset; overflow: visible; }
  .lp-bell-item-time { font-size: 11px; color: var(--text-dimmer, #9a9ea6); margin-top: 4px; }
  .lp-bell-empty { padding: 18px 14px; font-size: 13px; color: var(--text-dim, #5f636b); text-align: center; }
  .lp-shell.lp-bare .lp-main { padding: 0; }
  .lp-shell.lp-bare .lp-crumbs { display: none; }
  @media (max-width: 820px) {
    .lp-shell.lp-bare .lp-crumbs { display: flex; padding: 8px 12px 0; margin: 0; }
    .lp-nav { position: fixed; left: 0; top: 0; z-index: 1000; transform: translateX(-100%); transition: transform .2s ease; box-shadow: 0 0 40px rgba(0,0,0,.18); }
    .lp-shell.lp-open .lp-nav { transform: none; }
    .lp-main { padding: 14px 16px 50px; }
    .lp-menu-btn { display: inline-block; }
  }`;

  // Barre repliée (28/09, demande de Jules-Antoine) : un seul réglage pour toutes les pages, Backstage compris. La classe
  // est posée sur <html> dès le chargement du script, avant l'affichage, pour éviter que la barre saute. Sans effet sur
  // téléphone (la barre y est déjà cachée derrière « Menu »).
  const COLLAPSE_KEY = 'layerpitch_sidebar_collapsed';
  function isCollapsed() { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; } }
  function setCollapsed(on) {
    try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch (e) { /* stockage indisponible : le temps de la page */ }
    document.documentElement.classList.toggle('lp-sidebar-collapsed', on);
    document.querySelectorAll('.lp-collapse-btn').forEach(syncCollapseBtn);
  }
  document.documentElement.classList.toggle('lp-sidebar-collapsed', isCollapsed());
  // Le réglage suit d'un onglet à l'autre.
  window.addEventListener('storage', e => { if (e.key === COLLAPSE_KEY) setCollapsed(e.newValue === '1'); });

  const COLLAPSE_CSS = `
  .lp-collapse-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; flex: 0 0 auto;
    border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--text-dim, #5f636b); cursor: pointer; }
  .lp-collapse-btn:hover { background: rgba(47, 128, 192, .08); border-color: var(--border, #e2e2e6); color: var(--accent, #2f80c0); }
  .lp-collapse-btn svg { transition: transform .15s ease; }
  html.lp-sidebar-collapsed .lp-collapse-btn svg { transform: rotate(180deg); }
  @media (max-width: 820px) { .lp-collapse-btn { display: none; } }`;
  function syncCollapseBtn(b) {
    const label = tr(isCollapsed() ? 'expand' : 'collapse');
    b.title = label; b.setAttribute('aria-label', label); b.setAttribute('aria-expanded', String(!isCollapsed()));
  }
  function collapseButton() {
    if (!document.getElementById('lpCollapseCss')) {
      const st = document.createElement('style'); st.id = 'lpCollapseCss'; st.textContent = COLLAPSE_CSS; document.head.appendChild(st);
    }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lp-collapse-btn';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>';
    b.addEventListener('click', () => setCollapsed(!isCollapsed()));
    syncCollapseBtn(b);
    return b;
  }
  // Barre repliée : le libellé caché d'une rubrique apparaît en infobulle au survol (calculé au moment du survol, pour
  // suivre la langue affichée ; une infobulle déjà prévue par la page n'est jamais remplacée).
  function wireCollapsedTooltips(nav, selector) {
    nav.addEventListener('mouseover', e => {
      const it = e.target.closest(selector); if (!it || !nav.contains(it)) return;
      if (isCollapsed()) {
        if (!it.title || it.dataset.lpAutoTitle) { it.title = it.textContent.replace(/\s+/g, ' ').trim(); it.dataset.lpAutoTitle = '1'; }
      } else if (it.dataset.lpAutoTitle) { it.removeAttribute('title'); delete it.dataset.lpAutoTitle; }
    });
  }
  // Pour une page qui a sa propre barre (Backstage) : ajoute le bouton en haut de la barre et les infobulles. La page
  // fournit elle-même l'apparence repliée (règles sous html.lp-sidebar-collapsed).
  function collapsible(nav, { selector } = {}) {
    if (!nav || nav.querySelector(':scope > .lp-collapse-btn')) return;
    const b = collapseButton(); b.classList.add('lp-collapse-btn-own');
    nav.insertBefore(b, nav.firstChild);
    wireCollapsedTooltips(nav, selector || 'a, button');
  }

  // ---- Centre de notifications commun (28/09 soir) ----
  // Une seule cloche partout : pages d'espace (barre commune, en haut à droite) ET Backstage (sa cloche d'en-tête lit les
  // mêmes données via LayerPitchShell.startInbox / onInbox). Sources : annonces LayerPitch, messages reçus par le
  // formulaire de contact des AdReels, nouveautés des Projets depuis ta dernière visite (messages, notes qui te sont
  // adressées, modifications des autres : my_project_updates, migration 20260928190000), invitations en attente.
  // Vérifié toutes les minutes (et au retour sur l'onglet) ; ce qui arrive entretemps fait apparaître une pastille et un
  // petit bandeau (LayerPitchNotify). Rien n'est lu directement dans les tables des Projets : tout passe par les RPC.
  const INBOX_POLL_MS = 60 * 1000;
  const inbox = { items: [], started: false, known: null, listeners: [], timer: null };
  function i18nOf(ns, key, vars) {
    const I = window.LAYERPITCH_I18N || {};
    let s = ((I[lang()] || {})[ns] || {})[key] || ((I.fr || {})[ns] || {})[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k] == null ? '' : vars[k]); });
    return s;
  }
  function relTime(iso) {
    try {
      const diff = Math.round((new Date(iso).getTime() - Date.now()) / 1000), abs = Math.abs(diff);
      const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
      if (abs < 60) return rtf.format(0, 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      if (abs < 30 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
      return new Date(iso).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'fr-FR');
    } catch (e) { return ''; }
  }
  // Invitations en attente (co-ayants droit, équipe, Projets) : la liste des co-ayants droit contient aussi les invitations
  // déjà traitées ; équipe et Projets : seulement celles en attente.
  async function countInvitations(client) {
    const counts = await Promise.all([client.rpc('my_rights_invitations'), client.rpc('my_team_invitations'), client.rpc('my_project_invitations'), client.rpc('my_album_invitations')]);
    return counts.reduce((n, r) => n + (Array.isArray(r.data) ? r.data.filter(x => !x.status || x.status === 'pending' || x.status === 'invited').length : 0), 0);
  }
  // Résumé d'un Projet : « 3 nouveaux messages · 2 modifications · 1 note pour toi » + le détail le plus récent.
  function projectItem(u) {
    const parts = [];
    if (u.newMessages) parts.push(tr('inboxMessages', { n: u.newMessages }));
    if (u.addressedNotes) parts.push(tr('inboxNotes', { n: u.addressedNotes }));
    if (u.changes) parts.push(tr('inboxChanges', { n: u.changes }));
    const c = (u.lastChanges || [])[0];
    const detail = u.lastMessage && (!c || u.lastMessage.createdAt >= c.createdAt)
      ? `${u.lastMessage.authorEmail || ''} : « ${u.lastMessage.excerpt || '📎'} »`
      : c ? `${c.actorEmail || ''} ${i18nOf('projects', 'act_' + c.kind, { title: (c.payload && (c.payload.title || c.payload.label || c.payload.email)) || '' })}` : '';
    return { key: 'project:' + u.projectId + ':' + u.latestAt, kind: 'project', unread: true, createdAt: u.latestAt, projectTitle: u.title,
      title: tr('inboxProjectTitle', { title: u.title, what: parts.join(' · ') }), text: detail, href: 'projet.html?id=' + encodeURIComponent(u.projectId) };
  }
  // Canal de section suivi avec du neuf : « Projet · # Section : 2 nouveaux messages » + le dernier message ; mène au canal.
  function sectionItem(u) {
    return { key: 'section:' + u.sectionId + ':' + u.latestAt, kind: 'project', unread: true, createdAt: u.latestAt, projectTitle: u.title,
      title: tr('inboxSectionTitle', { title: u.title, section: u.sectionTitle, n: u.unread }),
      text: u.lastMessage ? `${u.lastMessage.authorEmail || ''} : « ${u.lastMessage.excerpt || '📎'} »` : '',
      href: 'projet.html?id=' + encodeURIComponent(u.projectId) + '&channel=' + encodeURIComponent(u.sectionId) };
  }
  async function fetchInbox() {
    const client = window.LayerPitchSupabaseClient.getClient();
    const [ann, reads, contact, updates, invitations, sectionUpdates] = await Promise.all([
      client.from('admin_messages').select('id, body, title, created_at').order('created_at', { ascending: false }).limit(20),
      client.from('admin_message_reads').select('message_id'),
      client.from('contact_messages').select('id, ad_reel_label, sender_name, sender_email, created_at, seen_at').order('created_at', { ascending: false }).limit(20),
      client.rpc('my_project_updates'),
      countInvitations(client).catch(() => 0),
      client.rpc('my_section_updates'), // canaux de section suivis (migration 20261007070000) ; absent ou fermé = liste vide
    ]);
    const seen = new Set((reads.data || []).map(r => r.message_id));
    const L = lang();
    const list = [];
    (ann.data || []).forEach(m => list.push({ key: 'ann:' + m.id, kind: 'announcement', createdAt: m.created_at, unread: !seen.has(m.id),
      title: (m.title && (m.title[L] || m.title.fr)) || i18nOf('backstage', 'inboxAnnouncementTitle'), text: (m.body && (m.body[L] || m.body.fr)) || '' }));
    (contact.data || []).forEach(m => list.push({ key: 'contact:' + m.id, kind: 'contact', createdAt: m.created_at, unread: !m.seen_at,
      title: i18nOf('backstage', 'inboxContactTitle', { name: m.sender_name }), text: i18nOf('backstage', 'inboxContactBody', { adreel: m.ad_reel_label, email: m.sender_email }) }));
    (Array.isArray(updates.data) ? updates.data : []).forEach(u => list.push(projectItem(u)));
    (Array.isArray(sectionUpdates && sectionUpdates.data) ? sectionUpdates.data : []).forEach(u => list.push(sectionItem(u)));
    if (invitations) list.push({ key: 'invitations:' + invitations, kind: 'invitation', unread: true, createdAt: new Date().toISOString(),
      title: tr('inboxInvitations', { n: invitations }), text: '', href: 'invitation.html' });
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list.slice(0, 30);
  }
  // Début d'un texte pour le petit bandeau d'arrivée : une ligne, coupé proprement sur un mot.
  function toastExcerpt(text, max) {
    max = max || 120;
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max), sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
  }
  // Ouvre la cloche : celle du Backstage (#btnInboxBell, déjà ouverte = on ne la referme pas) ou celle des autres pages.
  function openBell() {
    const bk = document.getElementById('btnInboxBell');
    if (bk) { const dd = document.getElementById('inboxBellDropdown'); if (dd && dd.hidden) bk.click(); return; }
    if (!inbox.open) { const b = document.getElementById('lpBell'); if (b) b.click(); }
  }
  async function refreshInbox() {
    try {
      const { session } = await window.LayerPitchAuth.getSession();
      if (!session) return;
      const list = await fetchInbox();
      // Petit bandeau pour ce qui vient d'arriver (pas au premier chargement de la page).
      if (inbox.known && window.LayerPitchNotify) {
        // Seules les annonces de LayerPitch ouvrent une carte (8/10, décision de Jules-Antoine) : les autres notifications (messages de contact, Projets, invitations) restent dans la cloche, sans pop-up.
        const fresh = list.filter(it => it.kind === 'announcement' && it.unread && !inbox.known.has(it.key));
        // Carte sous la cloche : le titre et le début du message seulement (une annonce longue montrée en entier faisait un bandeau plus haut que l'écran) ; un clic ouvre la cloche, où le message est en entier.
        if (fresh.length) {
          const one = fresh.length === 1 ? fresh[0] : null;
          window.LayerPitchNotify.inbox({
            title: one ? one.title : tr('inboxSeveral', { n: fresh.length }),
            text: one && one.text ? toastExcerpt(one.text) : '',
            anchor: '#btnInboxBell, #lpBell',
            onClick: openBell,
          });
        }
      }
      inbox.known = new Set(list.map(it => it.key));
      inbox.items = list;
      inbox.listeners.forEach(fn => { try { fn(list); } catch (e) { console.warn(e); } });
    } catch (e) { console.warn('notifications indisponibles', e); }
  }
  function startInbox() {
    if (inbox.started) return; inbox.started = true;
    refreshInbox();
    inbox.timer = setInterval(() => { if (!document.hidden) refreshInbox(); }, INBOX_POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshInbox(); });
  }
  function onInbox(fn) { inbox.listeners.push(fn); if (inbox.items.length || inbox.known) fn(inbox.items); }
  // Ouvrir la cloche vaut lecture des annonces et des messages de contact (les Projets, eux, sont lus en y allant).
  async function markInboxSeen() {
    const client = window.LayerPitchSupabaseClient.getClient();
    const has = k => inbox.items.some(it => it.unread && it.kind === k);
    await Promise.all([has('announcement') ? client.rpc('mark_admin_messages_seen') : null, has('contact') ? client.rpc('mark_contact_messages_seen') : null]);
    inbox.items.forEach(it => { if (it.kind === 'announcement' || it.kind === 'contact') it.unread = false; });
    inbox.listeners.forEach(fn => { try { fn(inbox.items); } catch (e) {} });
  }
  const BELL_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  function renderBell() {
    const host = document.getElementById('lpBellHost'); if (!host) return;
    const list = inbox.items;
    const unread = list.filter(it => it.unread).length;
    const open = inbox.open;
    host.innerHTML = `<button type="button" class="lp-bell" id="lpBell" aria-haspopup="true" aria-expanded="${open ? 'true' : 'false'}" title="${esc(tr('inboxTitle'))}">${BELL_ICON}${unread ? `<span class="lp-bell-badge">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
      ${open ? `<div class="lp-bell-panel" role="dialog" aria-label="${esc(tr('inboxTitle'))}"><div class="lp-bell-head">${esc(tr('inboxTitle'))}</div>
        ${list.length ? list.map(it => `<${it.href ? `a href="${esc(withLang(it.href))}"` : 'div'} class="lp-bell-item${it.unread ? ' unread' : ''}">
          <div class="lp-bell-item-title">${esc(it.title)}</div>${it.text ? `<div class="lp-bell-item-text">${linkify(it.text)}</div>` : ''}
          <div class="lp-bell-item-time">${esc(relTime(it.createdAt))}</div></${it.href ? 'a' : 'div'}>`).join('') : `<div class="lp-bell-empty">${esc(tr('inboxEmpty'))}</div>`}
      </div>` : ''}`;
    host.querySelector('#lpBell').onclick = e => {
      e.stopPropagation(); inbox.open = !inbox.open; renderBell();
      if (inbox.open && list.some(it => it.unread && (it.kind === 'announcement' || it.kind === 'contact'))) markInboxSeen();
    };
  }
  // Texte cliquable (8/10) : les adresses http(s) d'une annonce deviennent des liens (comme dans la cloche du Backstage).
  function linkify(t) { return esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
  // Un clic sur un message l'ouvre en entier (ou le referme) ; un clic sur un lien suit le lien, et une entrée qui est elle-même un lien garde son rôle.
  document.addEventListener('click', e => {
    const item = e.target.closest && e.target.closest('#lpBellHost div.lp-bell-item');
    if (!item || e.target.closest('a')) return;
    const text = item.querySelector('.lp-bell-item-text');
    if (text) text.classList.toggle('expanded');
  });
  document.addEventListener('click', e => { if (inbox.open && !e.target.closest('#lpBellHost')) { inbox.open = false; renderBell(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && inbox.open) { inbox.open = false; renderBell(); } });

  // Fenêtre « Apparence » (jour / nuit, couleur de fond, image de fond) : réglage local et commun à toutes les pages,
  // dessiné par layerpitch-appearance.js.
  function closeAppearance() { const p = document.getElementById('lpApPop'); if (p) p.remove(); }
  function toggleAppearance() {
    if (document.getElementById('lpApPop')) { closeAppearance(); return; }
    const pop = document.createElement('div'); pop.className = 'lp-ap-pop'; pop.id = 'lpApPop'; pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<div class="lp-ap-pop-head">${esc(tr('appearance'))}</div><div id="lpApHost"></div>`;
    document.body.appendChild(pop);
    window.LayerPitchAppearance.mountPanel(pop.querySelector('#lpApHost'));
  }
  // composedPath : le panneau se redessine au clic, l'élément cliqué n'est alors plus dans la page au moment du test.
  document.addEventListener('click', e => { if (!e.composedPath().some(n => n.id === 'lpApPop' || n.id === 'lpApBtn')) closeAppearance(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAppearance(); });

  let state = { active: null, crumbs: [], ctx: null, navHandler: null };

  // Session probable (jeton Supabase présent) : on pose la mise en page tout de suite pour éviter un saut à l'affichage.
  function hasStoredSession() {
    try { return Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)); } catch (e) { return false; }
  }

  function wrap() {
    if (document.querySelector('.lp-shell')) return;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const shell = document.createElement('div'); shell.className = 'lp-shell';
    const nav = document.createElement('nav'); nav.className = 'lp-nav'; nav.setAttribute('aria-label', tr('navLabel'));
    const main = document.createElement('div'); main.className = 'lp-main';
    const crumbs = document.createElement('div'); crumbs.className = 'lp-crumbs';
    main.appendChild(crumbs);
    // Le contenu de la page (hors scripts) passe à droite de la barre.
    [...document.body.childNodes].forEach(n => { if (!(n.nodeType === 1 && n.tagName === 'SCRIPT')) main.appendChild(n); });
    shell.appendChild(nav); shell.appendChild(main);
    wireCollapsedTooltips(nav, 'a.lp-item');
    if (state.bare) shell.classList.add('lp-bare');
    document.body.insertBefore(shell, document.body.firstChild);
    document.body.classList.add('lp-shell-on');
    const pageWidth = getComputedStyle(document.querySelector('.lp-main .page') || main).maxWidth;
    if (pageWidth && pageWidth !== 'none') main.style.setProperty('--lp-page-width', pageWidth);
    // Téléphone : un clic à côté de la barre ouverte la referme.
    main.addEventListener('click', e => { if (shell.classList.contains('lp-open') && !e.target.closest('#lpMenuBtn')) shell.classList.remove('lp-open'); });
  }
  function unwrap() {
    const shell = document.querySelector('.lp-shell'); if (!shell) return;
    const main = shell.querySelector('.lp-main');
    [...main.childNodes].forEach(n => { if (!n.classList || !n.classList.contains('lp-crumbs')) document.body.insertBefore(n, shell); });
    shell.remove(); document.body.classList.remove('lp-shell-on');
  }

  async function loadContext() {
    const client = window.LayerPitchSupabaseClient.getClient();
    const A = window.LayerPitchAuth;
    const [{ composerId }, { studioId }, flagsRes, adminRes, preview] = await Promise.all([
      A.getMyComposerId(), A.getMyStudioId(), client.rpc('my_feature_flags'), client.rpc('is_admin'), A.getAdminPreview(),
    ]);
    // Suppression de compte demandée (29/09) : bandeau « suppression prévue le … » sur toutes les pages, avec lien pour annuler.
    let deletion = null;
    try { const d = await client.rpc('account_deletion_status'); if (d.data && d.data.scheduledFor) deletion = d.data.scheduledFor; } catch (e) { /* facultatif */ }
    const flags = {};
    (flagsRes.data || []).forEach(f => { flags[f.key] = !!f.allowed; });
    const ctx = { composerId, studioId, flags, isAdmin: !!adminRes.data, preview, invitations: 0, deletion };
    // Invitations en attente : pastille sur « Invitations ».
    try { ctx.invitations = await countInvitations(client); } catch (e) { /* compteur facultatif */ }
    return ctx;
  }

  function items(ctx) {
    const sections = [];
    const studioSpace = !!ctx.flags.studio_space;
    const composer = [];
    if (ctx.composerId) {
      composer.push({ id: 'backstage', icon: 'backstage', href: 'layerpitch-backstage.html' });
      composer.push({ id: 'account.sales', icon: 'sales', href: 'mon-compte.html?section=sales', label: 'sales' });
      sections.push({ label: 'sectionComposer', items: composer });
    }
    if (ctx.studioId) {
      const studio = studioSpace ? [
        { id: 'studio.library', icon: 'purchases', href: 'studio.html?tab=library' },
        { id: 'studio.custom', icon: 'custom', href: 'studio.html?tab=custom' },
        { id: 'studio.team', icon: 'team', href: 'studio.html?tab=team' },
        { id: 'studio.plan', icon: 'plan', href: 'studio.html?tab=plan' },
      ] : [
        { id: 'studio.library', icon: 'purchases', href: 'library.html' },
      ];
      // Vente d'OST par un studio (29/09) : même feu vert que la vente d'albums (admin seulement pendant la bêta).
      if (studioSpace && ctx.flags.sell_albums) studio.splice(3, 0, { id: 'studio.albums', icon: 'albums', href: 'studio.html?tab=albums' });
      if (!ctx.composerId) studio.push({ id: 'account.sales', icon: 'sales', href: 'mon-compte.html?section=sales', label: 'salesStudio' });
      sections.push({ label: 'sectionStudio', items: studio });
    }
    const common = [];
    // Shop public (29/09) : packs et OST adaptive ; remplace l'ancienne entrée « Catalogue ». Feu vert « shop » (admin seulement pendant la bêta).
    if (ctx.flags.shop) common.push({ id: 'shop', icon: 'catalog', href: 'shop.html' });
    if (ctx.flags.projects) common.push({ id: 'projects', icon: 'projects', href: 'projets.html' });
    common.push({ id: 'invitations', icon: 'invitations', href: 'invitation.html', badge: ctx.invitations });
    if (ctx.isAdmin && !(ctx.preview && ctx.preview.hideUnreleased)) common.push({ id: 'albums', icon: 'albums', href: 'mes-albums.html' });
    common.push({ id: 'account', icon: 'account', href: 'mon-compte.html', children: [
      { id: 'account.profile', href: 'mon-compte.html?section=profile' },
      { id: 'account.subscription', href: 'mon-compte.html?section=subscription' },
      { id: 'account.billing', href: 'mon-compte.html?section=billing' },
      { id: 'account.documents', href: 'mon-compte.html?section=documents' },
    ] });
    sections.push({ label: 'sectionCommon', items: common });
    return sections;
  }

  function renderNav() {
    const nav = document.querySelector('.lp-nav'); if (!nav || !state.ctx) return;
    const ctx = state.ctx;
    const isActive = id => state.active === id || (state.active || '').startsWith(id + '.');
    const link = (it, sub) => `<a class="lp-item${sub ? ' lp-sub' : ''}" href="${esc(withLang(it.href))}"${state.active === it.id || (!sub && !it.children && isActive(it.id)) ? ' aria-current="page"' : ''}>
        ${sub ? '' : icon(it.icon)}<span>${esc(tr(it.label || 'item_' + it.id))}</span>${it.badge ? `<span class="lp-badge">${esc(it.badge)}</span>` : ''}</a>`;
    let html = `<div class="lp-nav-top"><a class="lp-nav-brand" href="${esc(withLang(ctx.composerId ? 'layerpitch-backstage.html' : 'mon-compte.html'))}">LayerPitch</a></div>`;
    for (const s of items(ctx)) {
      html += `<div class="lp-nav-section">${esc(tr(s.label))}</div>`;
      for (const it of s.items) {
        html += link(it, false);
        if (it.children && isActive(it.id)) html += it.children.map(c => link(c, true)).join('');
      }
    }
    html += `<a class="lp-item" href="${esc(withLang('tarifs.html'))}" style="margin-top:6px"${state.active === 'pricing' ? ' aria-current="page"' : ''}>${icon('pricing')}<span>${esc(tr('item_pricing'))}</span></a>`;
    if (ctx.isAdmin) html += previewHtml(ctx.preview || {});
    if (window.LayerPitchAppearance) html += `<button type="button" class="lp-ap-btn" id="lpApBtn" title="${esc(tr('appearance'))}">${icon('appearance')}<span>${esc(tr('appearance'))}</span></button>`;
    html += `<div class="lp-nav-foot"><button type="button" id="lpSignOut">${esc(tr('signOut'))}</button></div>`;
    nav.innerHTML = html;
    nav.querySelector('.lp-nav-top').appendChild(collapseButton());
    nav.querySelectorAll('a.lp-item').forEach(a => a.addEventListener('click', e => {
      const url = new URL(a.href);
      if (state.navHandler && url.pathname === location.pathname && state.navHandler(url) === true) {
        e.preventDefault(); document.querySelector('.lp-shell').classList.remove('lp-open');
      }
    }));
    const apBtn = nav.querySelector('#lpApBtn');
    if (apBtn) apBtn.onclick = e => { e.stopPropagation(); toggleAppearance(); };
    const so = nav.querySelector('#lpSignOut');
    if (so) so.onclick = async () => { await window.LayerPitchAuth.signOut(); location.href = withLang('mon-compte.html'); };
    wirePreview(nav);
  }

  function previewHtml(p) {
    const opt = (v, label, cur) => `<option value="${v}"${(cur || '') === v ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="lp-preview">
      <div class="lp-preview-title">${esc(tr('previewTitle'))}</div>
      <label for="lpPrevRole">${esc(tr('previewRole'))}</label>
      <select id="lpPrevRole">${opt('', tr('previewRoleAll'), p.role)}${opt('composer', tr('previewRoleComposer'), p.role)}${opt('studio', tr('previewRoleStudio'), p.role)}${opt('fan', tr('previewRoleFan'), p.role)}</select>
      <label for="lpPrevComposer">${esc(tr('previewComposerTier'))}</label>
      <select id="lpPrevComposer">${opt('', tr('previewAdmin'), p.composerTier)}${opt('free', 'Rookie', p.composerTier)}${opt('starter', 'Warrior', p.composerTier)}${opt('pro', 'Boss', p.composerTier)}</select>
      <label for="lpPrevStudio">${esc(tr('previewStudioPlan'))}</label>
      <select id="lpPrevStudio">${opt('', tr('previewAdmin'), p.studioPlan)}${opt('solodev', 'SoloDev', p.studioPlan)}${opt('indie', 'Indie', p.studioPlan)}${opt('aa', 'AA', p.studioPlan)}${opt('aaa', 'AAA', p.studioPlan)}</select>
      <label class="lp-check"><input type="checkbox" id="lpPrevHide"${p.hideUnreleased ? ' checked' : ''}> <span>${esc(tr('previewHideUnreleased'))}</span></label>
    </div>`;
  }
  function wirePreview(nav) {
    const ids = ['lpPrevRole', 'lpPrevComposer', 'lpPrevStudio', 'lpPrevHide'];
    if (!nav.querySelector('#lpPrevRole')) return;
    const apply = async () => {
      ids.forEach(id => { nav.querySelector('#' + id).disabled = true; });
      const { ok, error } = await window.LayerPitchAuth.setAdminPreview({
        role: nav.querySelector('#lpPrevRole').value, composerTier: nav.querySelector('#lpPrevComposer').value,
        studioPlan: nav.querySelector('#lpPrevStudio').value, hideUnreleased: nav.querySelector('#lpPrevHide').checked,
      });
      if (!ok) { if (window.LayerPitchNotify) window.LayerPitchNotify.error(tr('previewError') + ' ' + error); else console.error(tr('previewError'), error); ids.forEach(id => { nav.querySelector('#' + id).disabled = false; }); return; }
      // Tout ce qui dépend de la casquette et du palier est évalué à des dizaines d'endroits : on recharge.
      location.reload();
    };
    ids.forEach(id => nav.querySelector('#' + id).addEventListener('change', apply));
  }

  function previewLabel(p) {
    if (!p) return '';
    const parts = [];
    if (p.role) parts.push(tr('previewRole' + p.role.charAt(0).toUpperCase() + p.role.slice(1)));
    if (p.composerTier) parts.push({ free: 'Rookie', starter: 'Warrior', pro: 'Boss' }[p.composerTier]);
    if (p.studioPlan) parts.push({ solodev: 'SoloDev', indie: 'Indie', aa: 'AA', aaa: 'AAA' }[p.studioPlan]);
    if (p.hideUnreleased) parts.push(tr('previewHiddenShort'));
    return parts.length ? tr('previewBanner', { what: parts.join(' · ') }) : '';
  }

  function renderCrumbs() {
    const bar = document.querySelector('.lp-crumbs'); if (!bar) return;
    // Un lien (ou la flèche de retour) qui ramènerait sur la page affichée n'est pas proposé : il ne ferait rien.
    const samePage = href => {
      const u = new URL(href, location.href); u.searchParams.delete('lang');
      const cur = new URL(location.href); cur.searchParams.delete('lang');
      return u.pathname === cur.pathname && u.search === cur.search;
    };
    const c = (state.crumbs || []).map(x => (x.href && samePage(x.href) ? { label: x.label } : x));
    const back = c.length > 1 && c[c.length - 2].href ? c[c.length - 2].href : null;
    bar.innerHTML = `<button type="button" class="lp-menu-btn" id="lpMenuBtn">☰ ${esc(tr('menu'))}</button>`
      + (back ? `<a class="lp-back" href="${esc(withLang(back))}" aria-label="${esc(tr('back'))}">←</a>` : '')
      + c.map((x, i) => (i ? '<span class="lp-crumb-sep">›</span>' : '') + (x.href && i < c.length - 1 ? `<a href="${esc(withLang(x.href))}">${esc(x.label)}</a>` : `<span>${esc(x.label)}</span>`)).join('')
      + (state.ctx && state.ctx.isAdmin && previewLabel(state.ctx.preview) ? `<span class="lp-preview-banner">${esc(previewLabel(state.ctx.preview))}</span>` : '')
      + (state.bare ? '' : '<span class="lp-bell-host" id="lpBellHost"></span>');
    bar.querySelector('#lpMenuBtn').onclick = () => document.querySelector('.lp-shell').classList.toggle('lp-open');
    // Page plein écran (lecteur) : pas de fil d'Ariane sur ordinateur, la cloche flotte en haut à droite.
    if (state.bare && state.ctx && !document.getElementById('lpBellHost')) {
      const host = document.createElement('span'); host.className = 'lp-bell-host lp-bell-floating'; host.id = 'lpBellHost';
      document.querySelector('.lp-main').appendChild(host);
    }
    if (state.ctx) renderBell();
    // Bandeau de suppression programmée, juste sous le fil d'Ariane.
    const oldBanner = document.getElementById('lpDeletionBanner'); if (oldBanner) oldBanner.remove();
    if (state.ctx && state.ctx.deletion && !state.bare) {
      const b = document.createElement('div'); b.className = 'lp-deletion'; b.id = 'lpDeletionBanner';
      // « Annuler » annule VRAIMENT la suppression (30/09) : jusque-là c'était un lien vers Mon compte → Profil, qui ne faisait
      // rien quand on y était déjà, et le bandeau restait.
      b.innerHTML = `<span data-role="delText">${esc(tr('deletionBanner', { date: new Date(state.ctx.deletion).toLocaleDateString(lang()) }))}</span> <a href="#" data-role="delCancel">${esc(tr('deletionCancel'))}</a>`;
      b.querySelector('[data-role="delCancel"]').addEventListener('click', async e => {
        e.preventDefault();
        e.target.style.pointerEvents = 'none';
        const r = await window.LayerPitchAuth.cancelAccountDeletion();
        if (r.ok) { location.reload(); return; }
        e.target.style.pointerEvents = '';
        b.querySelector('[data-role="delText"]').textContent = tr('deletionCancelError', { error: r.error });
      });
      bar.after(b);
    }
  }

  async function mount({ active, crumbs, bare } = {}) {
    state.active = active || null; state.crumbs = crumbs || []; state.bare = !!bare;
    if (hasStoredSession()) { wrap(); renderCrumbs(); }
    const { session } = await window.LayerPitchAuth.getSession();
    if (!session) { unwrap(); return null; }
    wrap();
    state.ctx = await loadContext();
    renderNav(); renderCrumbs();
    onInbox(renderBell); startInbox();
    return state.ctx;
  }
  function update({ active, crumbs } = {}) {
    if (active !== undefined) state.active = active;
    if (crumbs !== undefined) state.crumbs = crumbs;
    renderNav(); renderCrumbs();
  }
  function onNavigate(fn) { state.navHandler = fn; }

  window.LayerPitchShell = { mount, update, onNavigate, tr, collapsible, isCollapsed, setCollapsed, startInbox, onInbox, refreshInbox, markInboxSeen, relTime };
})();
