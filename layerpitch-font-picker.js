// layerpitch-font-picker.js — aperçu des polices dans les menus de choix de police (14/11).
// Pourquoi : le menu déroulant NATIF de macOS/Chrome ignore le style des <option> (toutes les polices s'affichent
// en police système). Ce script remplace l'ouverture du menu natif par un menu maison, où chaque nom est dans sa
// propre police. Le <select> d'origine reste la source de vérité : on change sa valeur puis on déclenche « change »,
// donc tout le code existant (écouteurs, enregistrement) fonctionne sans modification.
// Un « menu de polices » = un <select> dont une option a la valeur google:… ou custom:… (style de police posé sur l'option).
(function () {
  const CSS = `
    .lp-fontmenu { position: fixed; z-index: 100000; max-height: 340px; overflow-y: auto; padding: 4px 0; background: var(--bg, #fff); color: var(--text, #24262b); border: 1px solid var(--border, #e2e2e6); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); font-size: 15px; }
    .lp-fontmenu-group { padding: 8px 12px 3px; font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: .04em; text-transform: uppercase; color: var(--text-dim, #5f636b); }
    .lp-fontmenu-opt { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 6px 12px; cursor: pointer; }
    .lp-fontmenu-opt:hover, .lp-fontmenu-opt:focus { background: var(--accent-soft, #e6eef8); outline: none; }
    .lp-fontmenu-opt .lp-fontmenu-tick { width: 14px; flex: none; font-size: 12px; }`;
  let menu = null, owner = null;

  const isFontSelect = el => el && el.tagName === 'SELECT' && !el.multiple &&
    Array.prototype.some.call(el.options, o => /^(google|custom):/.test(o.value));

  function close() {
    if (menu) { menu.remove(); menu = null; }
    if (owner) { const o = owner; owner = null; try { o.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function open(sel) {
    close();
    if (!document.getElementById('lpFontMenuCss')) {
      const st = document.createElement('style'); st.id = 'lpFontMenuCss'; st.textContent = CSS; document.head.appendChild(st);
    }
    owner = sel;
    menu = document.createElement('div');
    menu.className = 'lp-fontmenu';
    menu.setAttribute('role', 'listbox');
    const addOpt = o => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lp-fontmenu-opt'; b.setAttribute('role', 'option');
      b.dataset.value = o.value;
      if (o.style && o.style.fontFamily) b.style.fontFamily = o.style.fontFamily;
      const tick = document.createElement('span'); tick.className = 'lp-fontmenu-tick'; tick.textContent = o.value === sel.value ? '✓' : '';
      const label = document.createElement('span'); label.textContent = o.textContent;
      b.append(tick, label);
      menu.appendChild(b);
    };
    Array.prototype.forEach.call(sel.children, ch => {
      if (ch.tagName === 'OPTGROUP') {
        const g = document.createElement('div'); g.className = 'lp-fontmenu-group'; g.textContent = ch.label; menu.appendChild(g);
        Array.prototype.forEach.call(ch.children, addOpt);
      } else if (ch.tagName === 'OPTION') addOpt(ch);
    });
    document.body.appendChild(menu);
    const r = sel.getBoundingClientRect();
    menu.style.minWidth = Math.max(r.width, 240) + 'px';
    const below = window.innerHeight - r.bottom, h = Math.min(340, menu.scrollHeight);
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (below >= h + 8 || below >= r.top ? r.bottom + 2 : Math.max(8, r.top - h - 2)) + 'px';
    if (below < h + 8 && below < r.top) menu.style.maxHeight = Math.min(340, r.top - 12) + 'px'; else menu.style.maxHeight = Math.min(340, below - 12) + 'px';
    const cur = menu.querySelector('.lp-fontmenu-opt[data-value="' + CSS_escape(sel.value) + '"]') || menu.querySelector('.lp-fontmenu-opt');
    if (cur) { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: 'nearest' }); }
  }
  const CSS_escape = v => String(v).replace(/["\\]/g, '\\$&');

  function choose(btn) {
    const sel = owner; const v = btn.dataset.value;
    if (menu) { menu.remove(); menu = null; }
    owner = null;
    if (!sel) return;
    if (sel.value !== v) {
      sel.value = v;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    try { sel.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  // Ouverture : on empêche le menu natif (mousedown) et on ouvre le nôtre.
  document.addEventListener('mousedown', e => {
    if (menu && menu.contains(e.target)) return;
    const sel = e.target && e.target.closest && e.target.closest('select');
    if (sel && isFontSelect(sel) && !sel.disabled) { e.preventDefault(); open(sel); return; }
    if (menu) close();
  }, true);
  document.addEventListener('click', e => {
    const b = menu && e.target.closest && e.target.closest('.lp-fontmenu-opt');
    if (b && menu.contains(b)) choose(b);
  }, true);
  document.addEventListener('keydown', e => {
    if (menu) {
      const items = Array.prototype.slice.call(menu.querySelectorAll('.lp-fontmenu-opt'));
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (items[Math.min(items.length - 1, i + 1)] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[Math.max(0, i - 1)] || items[0]).focus(); }
      else if (e.key === 'Tab') close();
      return;
    }
    const sel = e.target;
    if (isFontSelect(sel) && !sel.disabled && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); open(sel); }
  }, true);
  window.addEventListener('resize', () => { if (menu) close(); });
  window.addEventListener('scroll', e => { if (menu && !menu.contains(e.target)) close(); }, true);
})();
