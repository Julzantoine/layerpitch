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
    pricing: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01"/>',
  };
  const icon = k => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;

  const CSS = `
  body.lp-shell-on { padding: 0 !important; }
  .lp-shell { display: flex; min-height: 100vh; align-items: stretch; }
  .lp-nav { width: 232px; flex: 0 0 232px; background: #eef0f3; border-right: 1px solid var(--border, #e2e2e6); padding: 18px 12px 24px;
    position: sticky; top: 0; height: 100vh; overflow-y: auto; box-sizing: border-box; font-family: var(--font-body, 'Inter', system-ui, sans-serif); }
  .lp-nav-brand { display: block; font-family: var(--font-title, 'Space Grotesk', sans-serif); font-weight: 700; font-size: 17px; color: var(--text, #24262b); text-decoration: none; padding: 2px 10px 14px; }
  .lp-nav-section { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-dimmer, #9a9ea6); margin: 16px 10px 6px; font-weight: 600; }
  .lp-nav a.lp-item { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 8px; color: var(--text, #24262b); text-decoration: none; font-size: 13.5px; line-height: 1.25; }
  .lp-nav a.lp-item:hover { background: rgba(47, 128, 192, .08); }
  .lp-nav a.lp-item[aria-current="page"] { background: #ffffff; color: var(--accent, #2f80c0); font-weight: 600; box-shadow: 0 0 0 1px var(--border, #e2e2e6); }
  .lp-nav a.lp-item svg { flex: 0 0 auto; opacity: .8; }
  .lp-nav a.lp-sub { padding: 5px 10px 5px 35px; font-size: 12.5px; color: var(--text-dim, #5f636b); }
  .lp-nav a.lp-sub[aria-current="page"] { box-shadow: none; background: transparent; }
  .lp-badge { margin-left: auto; background: var(--accent, #2f80c0); color: #fff; font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 1px 7px; }
  .lp-nav-foot { margin-top: 18px; padding: 10px; border-top: 1px solid var(--border, #e2e2e6); font-size: 12px; color: var(--text-dim, #5f636b); }
  .lp-nav-foot button { background: none; border: 0; padding: 0; color: var(--text-dim, #5f636b); cursor: pointer; font: inherit; text-decoration: underline; }
  .lp-preview { margin: 16px 0 0; padding: 10px; border-radius: 10px; background: #ffffff; border: 1px dashed var(--accent, #2f80c0); font-size: 12px; }
  .lp-preview-title { font-weight: 600; color: var(--accent, #2f80c0); margin-bottom: 6px; }
  .lp-preview label { display: block; color: var(--text-dim, #5f636b); margin: 7px 0 3px; font-size: 11.5px; }
  .lp-preview select { width: 100%; font: inherit; padding: 4px 6px; border: 1px solid var(--border, #e2e2e6); border-radius: 6px; background: #fff; color: var(--text, #24262b); }
  .lp-preview .lp-check { display: flex; gap: 6px; align-items: flex-start; margin-top: 8px; color: var(--text, #24262b); }
  .lp-preview .lp-check input { margin: 2px 0 0; }
  .lp-main { flex: 1 1 auto; min-width: 0; padding: 22px 28px 60px; box-sizing: border-box; }
  .lp-crumbs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--text-dim, #5f636b); margin: 0 auto 14px; max-width: var(--lp-page-width, 1040px); min-height: 22px; }
  .lp-crumbs a { color: var(--accent, #2f80c0); text-decoration: none; }
  .lp-crumbs a:hover { text-decoration: underline; }
  .lp-crumbs .lp-back { font-size: 16px; line-height: 1; margin-right: 2px; }
  .lp-crumb-sep { color: var(--text-dimmer, #9a9ea6); }
  .lp-preview-banner { margin-left: auto; font-size: 11.5px; background: #e6eef8; color: var(--accent, #2f80c0); border-radius: 999px; padding: 3px 10px; }
  .lp-menu-btn { display: none; border: 1px solid var(--border, #e2e2e6); background: #fff; border-radius: 8px; padding: 5px 10px; font: inherit; font-size: 13px; cursor: pointer; color: var(--text, #24262b); }
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
    const flags = {};
    (flagsRes.data || []).forEach(f => { flags[f.key] = !!f.allowed; });
    const ctx = { composerId, studioId, flags, isAdmin: !!adminRes.data, preview, invitations: 0 };
    // Invitations en attente (co-ayants droit, équipe, Projets) : pastille sur « Invitations ».
    try {
      const counts = await Promise.all([
        client.rpc('my_rights_invitations'), client.rpc('my_team_invitations'), client.rpc('my_project_invitations'),
      ]);
      // Co-ayants droit : la liste contient aussi les invitations déjà traitées ; équipe et Projets : seulement celles en attente.
      ctx.invitations = counts.reduce((n, r) => n + (Array.isArray(r.data) ? r.data.filter(x => !x.status || x.status === 'pending' || x.status === 'invited').length : 0), 0);
    } catch (e) { /* compteur facultatif */ }
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
        { id: 'catalog', icon: 'catalog', href: 'catalogue.html' },
        { id: 'studio.custom', icon: 'custom', href: 'studio.html?tab=custom' },
        { id: 'studio.team', icon: 'team', href: 'studio.html?tab=team' },
        { id: 'studio.plan', icon: 'plan', href: 'studio.html?tab=plan' },
      ] : [
        { id: 'studio.library', icon: 'purchases', href: 'library.html' },
        { id: 'catalog', icon: 'catalog', href: 'catalogue.html' },
      ];
      if (!ctx.composerId) studio.push({ id: 'account.sales', icon: 'sales', href: 'mon-compte.html?section=sales', label: 'salesStudio' });
      sections.push({ label: 'sectionStudio', items: studio });
    }
    const common = [];
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
    html += `<div class="lp-nav-foot"><button type="button" id="lpSignOut">${esc(tr('signOut'))}</button></div>`;
    nav.innerHTML = html;
    nav.querySelector('.lp-nav-top').appendChild(collapseButton());
    nav.querySelectorAll('a.lp-item').forEach(a => a.addEventListener('click', e => {
      const url = new URL(a.href);
      if (state.navHandler && url.pathname === location.pathname && state.navHandler(url) === true) {
        e.preventDefault(); document.querySelector('.lp-shell').classList.remove('lp-open');
      }
    }));
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
      + (state.ctx && state.ctx.isAdmin && previewLabel(state.ctx.preview) ? `<span class="lp-preview-banner">${esc(previewLabel(state.ctx.preview))}</span>` : '');
    bar.querySelector('#lpMenuBtn').onclick = () => document.querySelector('.lp-shell').classList.toggle('lp-open');
  }

  async function mount({ active, crumbs, bare } = {}) {
    state.active = active || null; state.crumbs = crumbs || []; state.bare = !!bare;
    if (hasStoredSession()) { wrap(); renderCrumbs(); }
    const { session } = await window.LayerPitchAuth.getSession();
    if (!session) { unwrap(); return null; }
    wrap();
    state.ctx = await loadContext();
    renderNav(); renderCrumbs();
    return state.ctx;
  }
  function update({ active, crumbs } = {}) {
    if (active !== undefined) state.active = active;
    if (crumbs !== undefined) state.crumbs = crumbs;
    renderNav(); renderCrumbs();
  }
  function onNavigate(fn) { state.navHandler = fn; }

  window.LayerPitchShell = { mount, update, onNavigate, tr, collapsible, isCollapsed, setCollapsed };
})();
