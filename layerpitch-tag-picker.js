// layerpitch-tag-picker.js — saisie de tags avec suggestions, façon « compétences LinkedIn » (30/10, annuaire orienté studios).
// Utilisé par Mon compte (allowCreate : un tag inconnu est proposé à la création) et par le filtre de annuaire.html.
//   LayerPitchTagPicker.mount(host, { tags: [{ label, aliases, count }], selected: [label], allowCreate, max, strings, onChange })
//   → { get(), set(labels) }
// key() reproduit directory_tag_key (migration 20261030010000) : même résultat pour « RPG », « rpg » et « R.P.G ».
(function (root) {
  function key(label) {
    return String(label == null ? '' : label).replace(/œ/g, 'oe').replace(/Œ/g, 'oe').replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[\s!"$%&'()*,\-./:;<=>?@[\\\]^_`{|}~’‘“”«»–—…·•]/g, '').toLowerCase();
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS_TEXT = `
    .lp-tags { position: relative; }
    .lp-tags-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .lp-tags-chips:empty { display: none; }
    .lp-tag-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-soft, #e6eef8); color: var(--accent, #2f80c0); border-radius: 999px; padding: 3px 4px 3px 10px; font-size: 12.5px; }
    .lp-tag-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 4px; }
    .lp-tags-input { width: 100%; padding: 8px 10px; border: 1px solid var(--border, #e2e2e6); border-radius: 6px; font: inherit; background: var(--bg-card, #fff); color: var(--text, #24262b); }
    .lp-tags-list { position: absolute; z-index: 30; left: 0; right: 0; margin-top: 2px; max-height: 260px; overflow-y: auto; background: var(--bg-card, #fff); border: 1px solid var(--border, #e2e2e6); border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,.12); }
    .lp-tags-list[hidden] { display: none; }
    .lp-tags-opt { display: flex; justify-content: space-between; gap: 10px; width: 100%; text-align: left; border: 0; background: transparent; color: var(--text, #24262b); font: inherit; font-size: 13px; padding: 7px 10px; cursor: pointer; }
    .lp-tags-opt:hover, .lp-tags-opt.on { background: var(--accent-soft, #e6eef8); }
    .lp-tags-opt small { color: var(--text-dim, #5f636b); }
    .lp-tags-empty { font-size: 12.5px; color: var(--text-dim, #5f636b); padding: 8px 10px; }`;

  function mount(host, opts) {
    if (!document.getElementById('lpTagPickerCss')) {
      const st = document.createElement('style'); st.id = 'lpTagPickerCss'; st.textContent = CSS_TEXT; document.head.appendChild(st);
    }
    const s = opts.strings || {}, max = opts.max || 100;
    const tags = (opts.tags || []).map(t => ({ label: t.label, count: t.count, keys: [t.label].concat(t.aliases || []).map(key) }));
    const byKey = new Map();
    tags.forEach(t => t.keys.forEach(k => byKey.set(k, t)));
    let selected = [], options = [], active = -1;
    const addUnique = label => {
      const k = key(label); if (!k) return false;
      const known = byKey.get(k);
      const final = known ? known.label : String(label).trim().replace(/\s+/g, ' ').slice(0, 30);
      if (selected.some(x => key(x) === key(final))) return false;
      if (selected.length >= max) return false;
      selected.push(final); return true;
    };
    host.innerHTML = `<div class="lp-tags"><div class="lp-tags-chips"></div><input type="text" class="lp-tags-input" autocomplete="off" role="combobox" aria-expanded="false" aria-label="${esc(s.label || s.placeholder || '')}" placeholder="${esc(s.placeholder || '')}"><div class="lp-tags-list" role="listbox" hidden></div></div>`;
    const chips = host.querySelector('.lp-tags-chips'), input = host.querySelector('.lp-tags-input'), list = host.querySelector('.lp-tags-list');
    const changed = () => { drawChips(); if (opts.onChange) opts.onChange(selected.slice()); };
    function drawChips() {
      chips.innerHTML = selected.map((l, i) => `<span class="lp-tag-chip">${esc(l)}<button type="button" data-rm="${i}" aria-label="${esc((s.remove || '×') + ' ' + l)}">×</button></span>`).join('');
      chips.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { selected.splice(Number(b.dataset.rm), 1); changed(); input.focus(); }; });
    }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
    function draw() {
      const q = key(input.value), taken = new Set(selected.map(key));
      const found = tags.filter(t => !taken.has(key(t.label)) && (!q || t.keys.some(k => k.includes(q))));
      // Commence par ce nom d'abord, puis contient ; à égalité, l'ordre reçu (le plus utilisé en tête).
      found.sort((a, b) => Number(b.keys.some(k => k.startsWith(q))) - Number(a.keys.some(k => k.startsWith(q))));
      options = found.slice(0, 30).map(t => ({ label: t.label, count: t.count }));
      const exact = q && byKey.has(q);
      // « Créer » en dernier : Entrée prend d'abord le tag existant (« elec » → Electronic), sinon la liste se remplit de doublons proches.
      if (opts.allowCreate && q && !exact) options.push({ label: input.value.trim().replace(/\s+/g, ' ').slice(0, 30), create: true });
      active = options.length && q ? 0 : -1;
      list.innerHTML = options.length ? options.map((o, i) => `<button type="button" role="option" class="lp-tags-opt${i === active ? ' on' : ''}" data-i="${i}"><span>${esc(o.create ? String(s.create || '{tag}').replace('{tag}', o.label) : o.label)}</span>${o.count ? `<small>${esc(o.count)}</small>` : ''}</button>`).join('')
        : `<div class="lp-tags-empty">${esc(s.none || '')}</div>`;
      list.querySelectorAll('[data-i]').forEach(b => {
        b.onmousedown = e => { e.preventDefault(); pick(options[Number(b.dataset.i)]); };
      });
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    function pick(o) {
      if (!o) return;
      const added = addUnique(o.label);
      input.value = '';
      if (added) changed();
      draw();
      input.focus();
    }
    input.addEventListener('focus', draw);
    input.addEventListener('input', draw);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) draw();
        if (!options.length) return;
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        list.querySelectorAll('[data-i]').forEach((b, i) => { b.classList.toggle('on', i === active); if (i === active && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); });
      } else if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
        if (e.key === 'Enter' && !input.value.trim() && active < 0) return; // Entrée sur un champ vide : rien à ajouter
        e.preventDefault();
        if (active >= 0) pick(options[active]);
      } else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Backspace' && !input.value && selected.length) { selected.pop(); changed(); draw(); }
    });
    function set(labels) { selected = []; (labels || []).forEach(addUnique); drawChips(); }
    set(opts.selected);
    return { get: () => selected.slice(), set: l => { set(l); if (opts.onChange) opts.onChange(selected.slice()); } };
  }

  const api = { key, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LayerPitchTagPicker = api;
})(typeof window !== 'undefined' ? window : this);
