// projet-carte.js — LayerPitch, Carte de niveau d'un Projet (6 octobre ; migration 20261006020000).
// On dessine un niveau (début, lieux, quêtes, boss, PNJ, trésors, parcours), puis on y dépose des sons de la bibliothèque.
//   window.LayerPitchLevelMap.model   : fonctions pures (testées dans test_carte_de_niveau.js) -- aucune dépendance à la page
//   window.LayerPitchLevelMap.mount() : l'éditeur (SVG : éléments déplaçables, parcours, zoom, dépôt de sons), utilisé par projet.html
// Document d'une carte : { nodes: [{ id, type, label, x, y, note, side, anchor, sounds: { main: [ref], combat: [ref] } }],
//                          edges: [{ id, from, to, label, enemy, sounds }] }   ref = { kind: 'track'|'sfx'|'asset', id, title }
(function () {
  const NODE_TYPES = ['start', 'place', 'quest', 'boss', 'npc', 'treasure'];
  const SLOTS = ['main', 'combat'];
  const MAX_SOUNDS = 12;
  const MAX_NODES = 300, MAX_EDGES = 600;
  const GLYPH = { start: '▶', place: '⌂', quest: '!', boss: '☠', npc: '☺', treasure: '◆' };

  // ---------------------------------------------------------------- Modèle (fonctions pures)
  let idSeq = 0;
  const newId = prefix => prefix + Date.now().toString(36) + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 5);
  const emptyMap = () => ({ nodes: [], edges: [] });
  const nodeById = (map, id) => map.nodes.find(n => n.id === id) || null;
  const edgeById = (map, id) => map.edges.find(e => e.id === id) || null;

  function addNode(map, type, x, y, label) {
    if (!NODE_TYPES.includes(type) || map.nodes.length >= MAX_NODES) return null;
    if (type === 'start' && map.nodes.some(n => n.type === 'start')) return null; // un seul début de niveau
    const node = { id: newId('n'), type, label: label || '', x: Math.round(x), y: Math.round(y), note: '', sounds: { main: [], combat: [] } };
    if (type === 'quest') { node.side = false; node.anchor = null; }
    map.nodes.push(node);
    return node;
  }
  function addEdge(map, from, to) {
    if (from === to || !nodeById(map, from) || !nodeById(map, to) || map.edges.length >= MAX_EDGES) return null;
    if (map.edges.some(e => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return null; // un parcours par paire
    const edge = { id: newId('e'), from, to, label: '', enemy: false, sounds: { main: [], combat: [] } };
    map.edges.push(edge);
    return edge;
  }
  function removeNode(map, id) {
    const gone = map.edges.filter(e => e.from === id || e.to === id).map(e => e.id);
    map.edges = map.edges.filter(e => e.from !== id && e.to !== id);
    map.nodes = map.nodes.filter(n => n.id !== id);
    // Une quête annexe accrochée à ce qui disparaît (l'élément ou ses parcours) redevient libre.
    map.nodes.forEach(n => { if (n.anchor && ((n.anchor.kind === 'node' && n.anchor.id === id) || (n.anchor.kind === 'edge' && gone.includes(n.anchor.id)))) { n.anchor = null; } });
  }
  function removeEdge(map, id) {
    map.edges = map.edges.filter(e => e.id !== id);
    map.nodes.forEach(n => { if (n.anchor && n.anchor.kind === 'edge' && n.anchor.id === id) n.anchor = null; });
  }
  const targetOf = (map, t) => (t.kind === 'edge' ? edgeById(map, t.id) : nodeById(map, t.id));
  // L'emplacement « combat » : un boss, ou un parcours où un ennemi est possible.
  function hasCombatSlot(map, t) {
    const item = targetOf(map, t);
    if (!item) return false;
    return t.kind === 'edge' ? !!item.enemy : item.type === 'boss';
  }
  function addSound(map, t, slot, ref) {
    const item = targetOf(map, t);
    if (!item || !SLOTS.includes(slot) || !ref || !['track', 'sfx', 'asset'].includes(ref.kind) || !ref.id) return false;
    if (slot === 'combat' && !hasCombatSlot(map, t)) return false;
    item.sounds = item.sounds || { main: [], combat: [] };
    const list = item.sounds[slot] = item.sounds[slot] || [];
    if (list.length >= MAX_SOUNDS || list.some(r => r.kind === ref.kind && r.id === ref.id)) return false;
    list.push({ kind: ref.kind, id: String(ref.id), title: String(ref.title || '').slice(0, 120) });
    return true;
  }
  function removeSound(map, t, slot, index) {
    const item = targetOf(map, t);
    if (!item || !item.sounds || !item.sounds[slot] || !item.sounds[slot][index]) return false;
    item.sounds[slot].splice(index, 1);
    return true;
  }
  // Retirer l'étoile d'un parcours : les sons « combat » n'ont plus d'emplacement, on les garde pour ne rien perdre en cas de remise de l'étoile.
  function setEnemy(map, edgeId, on) { const e = edgeById(map, edgeId); if (e) e.enemy = !!on; return !!e; }
  // Qui peut accueillir une quête annexe : n'importe quel autre élément ou parcours.
  function anchorChoices(map, exceptNodeId) {
    return map.nodes.filter(n => n.id !== exceptNodeId).map(n => ({ kind: 'node', id: n.id, label: n.label || n.type }))
      .concat(map.edges.map(e => ({ kind: 'edge', id: e.id, label: (e.label || ((nodeById(map, e.from) || {}).label || '?') + ' → ' + ((nodeById(map, e.to) || {}).label || '?')) })));
  }
  const SIZE = { start: { hx: 56, hy: 34 }, other: { hx: 62, hy: 22 } };
  const halfSize = n => (n.type === 'start' ? SIZE.start : SIZE.other);
  // Point où un trait partant du centre d'un élément vers (tx, ty) sort de sa forme.
  function borderPoint(n, tx, ty) {
    const { hx, hy } = halfSize(n);
    const dx = tx - n.x, dy = ty - n.y;
    if (!dx && !dy) return { x: n.x, y: n.y };
    const t = n.type === 'start' ? 1 / (Math.abs(dx) / hx + Math.abs(dy) / hy) : Math.min(hx / (Math.abs(dx) || 1e-9), hy / (Math.abs(dy) || 1e-9));
    return { x: n.x + dx * t, y: n.y + dy * t };
  }
  function edgeGeometry(map, e) {
    const a = nodeById(map, e.from), b = nodeById(map, e.to);
    if (!a || !b) return null;
    const p1 = borderPoint(a, b.x, b.y), p2 = borderPoint(b, a.x, a.y);
    return { p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  }
  function anchorPoint(map, anchor) {
    if (!anchor) return null;
    if (anchor.kind === 'node') { const n = nodeById(map, anchor.id); return n ? { x: n.x, y: n.y } : null; }
    const e = edgeById(map, anchor.id); const g = e && edgeGeometry(map, e);
    return g ? g.mid : null;
  }
  // Bilan d'une carte : combien de sons posés, d'éléments sans son.
  function summary(map) {
    const items = map.nodes.map(n => ({ n, s: n.sounds })).concat(map.edges.map(e => ({ n: e, s: e.sounds })));
    let sounds = 0, silent = 0;
    items.forEach(({ s }) => { const c = ((s && s.main) || []).length + ((s && s.combat) || []).length; sounds += c; if (!c) silent++; });
    return { nodes: map.nodes.length, edges: map.edges.length, sounds, silent };
  }
  // Remet une carte reçue du serveur dans la forme attendue (champs absents, sons manquants).
  function normalize(raw) {
    const map = emptyMap();
    ((raw && raw.nodes) || []).forEach(n => {
      if (!n || !NODE_TYPES.includes(n.type)) return;
      map.nodes.push({ id: String(n.id), type: n.type, label: n.label || '', x: Number(n.x) || 0, y: Number(n.y) || 0, note: n.note || '',
        side: !!n.side, anchor: n.anchor || null, sounds: { main: ((n.sounds && n.sounds.main) || []).slice(), combat: ((n.sounds && n.sounds.combat) || []).slice() } });
    });
    ((raw && raw.edges) || []).forEach(e => {
      if (!e || !nodeById(map, e.from) || !nodeById(map, e.to)) return;
      map.edges.push({ id: String(e.id), from: e.from, to: e.to, label: e.label || '', enemy: !!e.enemy, sounds: { main: ((e.sounds && e.sounds.main) || []).slice(), combat: ((e.sounds && e.sounds.combat) || []).slice() } });
    });
    return map;
  }
  const model = { NODE_TYPES, SLOTS, GLYPH, MAX_SOUNDS, emptyMap, normalize, nodeById, edgeById, addNode, addEdge, removeNode, removeEdge, addSound, removeSound,
    setEnemy, hasCombatSlot, anchorChoices, borderPoint, edgeGeometry, anchorPoint, summary };

  // ---------------------------------------------------------------- Éditeur
  const STYLE_ID = 'lpLevelMapStyle';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .lm-wrap { display: grid; grid-template-columns: 230px minmax(0, 1fr) 270px; gap: 12px; align-items: start; }
      @media (max-width: 1100px) { .lm-wrap { grid-template-columns: minmax(0, 1fr); } }
      .lm-side { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; max-height: 640px; overflow: auto; }
      .lm-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
      .lm-canvas { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; height: 600px; overflow: hidden; position: relative; touch-action: none; cursor: grab;
        background-image: radial-gradient(var(--border) 1px, transparent 1px); background-size: 24px 24px; }
      .lm-canvas.panning { cursor: grabbing; } .lm-canvas.connecting { cursor: crosshair; }
      .lm-canvas svg { width: 100%; height: 100%; display: block; }
      .lm-node { cursor: move; } .lm-node .lm-shape { fill: var(--bg-card); stroke: var(--lm-color, var(--text-dim)); stroke-width: 2; }
      .lm-node.sel .lm-shape { stroke-width: 4; } .lm-node.link-from .lm-shape { stroke-dasharray: 5 3; }
      .lm-node.drop .lm-shape, .lm-edge.drop .lm-line { stroke: var(--accent); stroke-width: 4; }
      .lm-node text { font-family: var(--font-body); font-size: 12.5px; fill: var(--text); pointer-events: none; }
      .lm-node .lm-glyph { font-size: 13px; fill: var(--lm-color, var(--text-dim)); font-weight: 700; }
      .lm-node .lm-badge { font-size: 10.5px; fill: var(--accent); font-family: var(--font-mono); }
      .lm-edge .lm-line { stroke: var(--text-dim); stroke-width: 2.2; fill: none; } .lm-edge.sel .lm-line { stroke: var(--accent); stroke-width: 3.6; }
      .lm-edge .lm-hit { stroke: transparent; stroke-width: 18; fill: none; cursor: pointer; }
      .lm-edge text { font-size: 11.5px; fill: var(--text-dim); font-family: var(--font-body); pointer-events: none; } .lm-edge .lm-star { fill: #b5442e; font-weight: 700; font-size: 14px; }
      .lm-anchor { stroke: var(--text-dimmer); stroke-width: 1.6; stroke-dasharray: 4 4; fill: none; pointer-events: none; }
      .lm-sound { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; margin: 4px 0; font-size: 12.5px; background: var(--bg); }
      .lm-sound[draggable="true"] { cursor: grab; } .lm-sound .lm-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lm-slot { border: 1px dashed var(--border); border-radius: 8px; padding: 8px; margin: 6px 0; } .lm-slot.drop { border-color: var(--accent); background: var(--accent-soft); }
      .lm-slot h4 { margin: 0 0 4px; font-size: 12px; color: var(--text-dim); font-weight: 600; }
      .lm-tabs { display: flex; gap: 4px; margin: 6px 0; } .lm-tabs button { flex: 1; font-size: 11.5px; padding: 4px 6px; }
      .lm-status { font-size: 11.5px; color: var(--text-dimmer); font-family: var(--font-mono); }
    `;
    document.head.appendChild(s);
  }

  // Petite fenêtre « nom de la carte » (pas de prompt() natif : voir layerpitch-notify.js). Rend le texte, ou null si annulé.
  function askText(message, initial, labels) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'lmAskOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:grid;place-items:center;z-index:9999;padding:16px';
      overlay.innerHTML = `<form style="background:var(--bg-card,#fff);color:var(--text,#24262b);border:1px solid var(--border,#e2e2e6);border-radius:10px;padding:18px;width:380px;max-width:100%;box-shadow:0 12px 32px rgba(0,0,0,.22)">
        <label style="display:block;margin:0 0 8px;font-size:13px"></label><input type="text" maxlength="120" style="width:100%;padding:8px 10px;border:1px solid var(--border,#e2e2e6);border-radius:6px;font:inherit">
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button type="button" class="btn" data-c></button><button type="submit" class="btn primary"></button></div></form>`;
      const form = overlay.querySelector('form'), input = form.querySelector('input');
      form.querySelector('label').textContent = message; input.value = initial || '';
      form.querySelector('[data-c]').textContent = (labels && labels.cancel) || 'Annuler'; form.querySelector('[type=submit]').textContent = (labels && labels.ok) || 'OK';
      const done = v => { overlay.remove(); resolve(v); };
      form.onsubmit = e => { e.preventDefault(); done(input.value); };
      form.querySelector('[data-c]').onclick = () => done(null);
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
      overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(null); });
      document.body.appendChild(overlay); input.focus(); input.select();
    });
  }

  // ctx : { tr(key, vars), maps: [{ id, title, data }], libraries: { track: [{id, title, hint}], sfx: [...], asset: [...] },
  //         save(map) -> Promise<{ id } | { error }>, remove(map) -> Promise, canEdit }
  function mount(host, ctx) {
    ensureStyle();
    const tr = ctx.tr;
    const ask = ctx.ask || ((m, v) => askText(m, v, { ok: tr('map_ok'), cancel: tr('map_cancel') }));
    const confirmDlg = ctx.confirm || (m => window.LayerPitchNotify.confirm(m, { okLabel: tr('map_delete'), danger: true }));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const st = { maps: ctx.maps.map(m => ({ id: m.id, title: m.title, data: normalize(m.data) })), current: null, sel: null, view: { x: 0, y: 0, k: 1 }, connecting: false, linkFrom: null,
      libTab: 'track', libQuery: '', status: '', dirty: false };
    st.current = st.maps.length ? st.maps[0].id : null;
    let saveTimer = null, saving = false;
    const cur = () => st.maps.find(m => m.id === st.current) || null;
    const curData = () => { const m = cur(); return m ? m.data : null; };

    function setStatus(text) { st.status = text; const el = host.querySelector('.lm-status'); if (el) el.textContent = text; }
    function touch() {
      st.dirty = true; setStatus(tr('map_saving'));
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 700);
    }
    async function flush() {
      const m = cur();
      if (!m || saving || !ctx.canEdit) return;
      if (!st.dirty) return;
      saving = true; st.dirty = false;
      const r = await ctx.save({ id: m.isNew ? null : m.id, title: m.title, data: m.data });
      saving = false;
      if (r && r.error) { st.dirty = true; setStatus(tr('map_saveError', { message: r.error })); return; }
      if (r && r.id && m.isNew) { const was = m.id; m.id = r.id; m.isNew = false; if (st.current === was) st.current = r.id; }
      setStatus(st.dirty ? tr('map_saving') : tr('map_saved'));
      if (st.dirty) flush();
    }

    // ---- Rendu général
    function render() {
      const map = curData();
      host.innerHTML = `<div class="card"><h2>${esc(tr('map_title'))}</h2><p class="hint">${esc(tr('map_intro'))}</p>
        <div class="lm-toolbar">
          <select id="lmPick" style="max-width:240px">${st.maps.map(m => `<option value="${esc(m.id)}"${m.id === st.current ? ' selected' : ''}>${esc(m.title || tr('map_untitled'))}</option>`).join('')}</select>
          ${ctx.canEdit ? `<button class="btn" id="lmNew" type="button">${esc(tr('map_new'))}</button>` : ''}
          ${cur() && ctx.canEdit ? `<button class="btn" id="lmRename" type="button">${esc(tr('map_rename'))}</button><button class="btn danger" id="lmDelete" type="button">${esc(tr('map_delete'))}</button>` : ''}
          <span class="lm-status">${esc(st.status)}</span>
        </div></div>
        ${map ? editorHtml(map) : `<div class="card"><div class="empty">${esc(tr('map_none'))}</div></div>`}`;
      wireHeader();
      if (map) { wireEditor(map); drawCanvas(); renderInspector(); renderLibrary(); }
    }
    function editorHtml(map) {
      const s = summary(map);
      return `<div class="lm-wrap">
        <div class="lm-side" id="lmLib"></div>
        <div>
          <div class="lm-toolbar">${ctx.canEdit ? NODE_TYPES.map(t => `<button class="btn" type="button" data-add="${t}" ${t === 'start' && map.nodes.some(n => n.type === 'start') ? 'disabled' : ''}>${GLYPH[t]} ${esc(tr('map_type_' + t))}</button>`).join('') +
            `<button class="btn${st.connecting ? ' primary' : ''}" id="lmConnect" type="button">${esc(tr(st.connecting ? 'map_connecting' : 'map_connect'))}</button>` : ''}
            <button class="btn" id="lmZoomOut" type="button" aria-label="${esc(tr('map_zoomOut'))}">−</button><button class="btn" id="lmZoomIn" type="button" aria-label="${esc(tr('map_zoomIn'))}">+</button><button class="btn" id="lmFit" type="button">${esc(tr('map_fit'))}</button></div>
          <div class="lm-canvas${st.connecting ? ' connecting' : ''}" id="lmCanvas"><svg id="lmSvg" role="img" aria-label="${esc(tr('map_title'))}"></svg></div>
          <p class="hint" style="margin-top:6px">${esc(tr('map_summary', s))}</p>
        </div>
        <div class="lm-side" id="lmInsp"></div></div>`;
    }

    function wireHeader() {
      const pick = host.querySelector('#lmPick');
      if (pick) pick.onchange = () => { st.current = pick.value; st.sel = null; st.linkFrom = null; st.view = { x: 0, y: 0, k: 1 }; render(); fit(); };
      const nw = host.querySelector('#lmNew');
      if (nw) nw.onclick = async () => {
        const title = await ask(tr('map_askName'), tr('map_defaultName', { n: st.maps.length + 1 }));
        if (title == null) return;
        const m = { id: 'tmp' + newId(''), title: title.trim() || tr('map_defaultName', { n: st.maps.length + 1 }), data: emptyMap(), isNew: true };
        st.maps.push(m); st.current = m.id; st.sel = null; st.dirty = true; render();
        const r = await ctx.save({ id: null, title: m.title, data: m.data });
        if (r && r.error) { setStatus(tr('map_saveError', { message: r.error })); return; }
        const was = m.id; m.id = r.id; m.isNew = false; if (st.current === was) st.current = r.id; st.dirty = false; render();
      };
      const rn = host.querySelector('#lmRename');
      if (rn) rn.onclick = async () => { const m = cur(); const t = await ask(tr('map_askName'), m.title); if (t == null) return; m.title = t.trim(); touch(); render(); };
      const dl = host.querySelector('#lmDelete');
      if (dl) dl.onclick = async () => {
        const m = cur();
        if (!(await confirmDlg(tr('map_deleteConfirm', { title: m.title || tr('map_untitled') })))) return;
        if (!m.isNew) { const r = await ctx.remove(m); if (r && r.error) { setStatus(tr('map_saveError', { message: r.error })); return; } }
        st.maps = st.maps.filter(x => x !== m); st.current = st.maps.length ? st.maps[0].id : null; st.sel = null; render();
      };
    }

    // ---- Canevas
    function viewCenter() {
      const c = host.querySelector('#lmCanvas'); const w = c ? c.clientWidth : 600, h = c ? c.clientHeight : 400;
      return { x: (w / 2 - st.view.x) / st.view.k, y: (h / 2 - st.view.y) / st.view.k };
    }
    function fit() {
      const map = curData(), c = host.querySelector('#lmCanvas');
      if (!map || !c) return;
      if (!map.nodes.length) { st.view = { x: 0, y: 0, k: 1 }; return drawCanvas(); }
      const xs = map.nodes.map(n => n.x), ys = map.nodes.map(n => n.y);
      const minX = Math.min(...xs) - 90, maxX = Math.max(...xs) + 90, minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
      const w = c.clientWidth || 600, h = c.clientHeight || 400;
      const k = Math.max(0.4, Math.min(1.4, Math.min(w / (maxX - minX), h / (maxY - minY))));
      st.view = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
      drawCanvas();
    }
    function soundCount(item) { return ((item.sounds && item.sounds.main) || []).length + ((item.sounds && item.sounds.combat) || []).length; }
    function drawCanvas() {
      const map = curData(), svg = host.querySelector('#lmSvg');
      if (!map || !svg) return;
      const COLORS = { start: 'var(--accent)', place: 'var(--text-dim)', quest: 'var(--seq-map-choice)', boss: '#b5442e', npc: 'var(--seq-map-success)', treasure: '#b8862e' };
      let out = `<defs><marker id="lmArrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-dim)"/></marker></defs>`;
      out += `<g transform="translate(${st.view.x} ${st.view.y}) scale(${st.view.k})">`;
      map.nodes.forEach(n => {
        if (n.anchor) { const p = anchorPoint(map, n.anchor); if (p) out += `<line class="lm-anchor" x1="${n.x}" y1="${n.y}" x2="${p.x}" y2="${p.y}"/>`; }
      });
      map.edges.forEach(e => {
        const g = edgeGeometry(map, e); if (!g) return;
        const sel = st.sel && st.sel.kind === 'edge' && st.sel.id === e.id;
        const label = e.label || '';
        out += `<g class="lm-edge${sel ? ' sel' : ''}" data-edge="${esc(e.id)}"><path class="lm-hit" d="M${g.p1.x} ${g.p1.y}L${g.p2.x} ${g.p2.y}"/><path class="lm-line" d="M${g.p1.x} ${g.p1.y}L${g.p2.x} ${g.p2.y}" marker-end="url(#lmArrow)"/>
          <text x="${g.mid.x}" y="${g.mid.y - 8}" text-anchor="middle">${esc(label)}${e.enemy ? ` <tspan class="lm-star">✱</tspan>` : ''}${soundCount(e) ? ` <tspan class="lm-badge" fill="var(--accent)">♪${soundCount(e)}</tspan>` : ''}</text></g>`;
      });
      map.nodes.forEach(n => {
        const sel = st.sel && st.sel.kind === 'node' && st.sel.id === n.id;
        const { hx, hy } = halfSize(n);
        const shape = n.type === 'start' ? `<polygon class="lm-shape" points="${n.x},${n.y - hy} ${n.x + hx},${n.y} ${n.x},${n.y + hy} ${n.x - hx},${n.y}"/>`
          : `<rect class="lm-shape" x="${n.x - hx}" y="${n.y - hy}" width="${hx * 2}" height="${hy * 2}" rx="${n.type === 'quest' ? 20 : 6}"${n.type === 'boss' ? ' stroke-width="3.5"' : ''}/>`;
        const full = n.label || tr('map_type_' + n.type), max = n.type === 'start' ? 9 : 16;
        const text = full.length > max ? full.slice(0, max - 1) + '…' : full;
        out += `<g class="lm-node${sel ? ' sel' : ''}${st.linkFrom === n.id ? ' link-from' : ''}" data-node="${esc(n.id)}" style="--lm-color:${COLORS[n.type]}">${shape}
          <text class="lm-glyph" x="${n.x - hx + 12}" y="${n.y + 4.5}" text-anchor="middle">${GLYPH[n.type]}</text>
          <text x="${n.x + 6}" y="${n.y + 4.5}" text-anchor="middle">${esc(text)}</text>${n.side ? `<text class="lm-badge" x="${n.x}" y="${n.y - hy - 4}" text-anchor="middle">${esc(tr('map_sideTag'))}</text>` : ''}
          ${soundCount(n) ? `<text class="lm-badge" x="${n.x + hx - 4}" y="${n.y - hy + 11}" text-anchor="end">♪${soundCount(n)}</text>` : ''}</g>`;
      });
      out += '</g>';
      svg.innerHTML = out;
    }

    function wireEditor(map) {
      host.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
        const c = viewCenter(), jitter = (map.nodes.length % 6) * 22;
        const node = addNode(map, b.dataset.add, Math.round((c.x + jitter) / 10) * 10, Math.round((c.y + jitter) / 10) * 10, '');
        if (!node) return;
        st.sel = { kind: 'node', id: node.id }; touch(); render();
      });
      const conn = host.querySelector('#lmConnect');
      if (conn) conn.onclick = () => { st.connecting = !st.connecting; st.linkFrom = null; render(); };
      host.querySelector('#lmZoomIn').onclick = () => zoomBy(1.2);
      host.querySelector('#lmZoomOut').onclick = () => zoomBy(1 / 1.2);
      host.querySelector('#lmFit').onclick = fit;
      const canvas = host.querySelector('#lmCanvas');
      const toWorld = ev => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left - st.view.x) / st.view.k, y: (ev.clientY - r.top - st.view.y) / st.view.k }; };
      let drag = null;
      canvas.addEventListener('pointerdown', ev => {
        const nodeEl = ev.target.closest('[data-node]'), edgeEl = ev.target.closest('[data-edge]');
        if (nodeEl) {
          const id = nodeEl.dataset.node, n = nodeById(map, id);
          if (st.connecting && ctx.canEdit) {
            if (!st.linkFrom) { st.linkFrom = id; drawCanvas(); }
            else { const e = addEdge(map, st.linkFrom, id); st.linkFrom = null; if (e) { st.sel = { kind: 'edge', id: e.id }; touch(); } render(); }
            return;
          }
          st.sel = { kind: 'node', id };
          if (ctx.canEdit) { const w = toWorld(ev); drag = { mode: 'node', id, dx: n.x - w.x, dy: n.y - w.y, moved: false }; canvas.setPointerCapture(ev.pointerId); }
          drawCanvas(); renderInspector();
        } else if (edgeEl) {
          st.sel = { kind: 'edge', id: edgeEl.dataset.edge }; drawCanvas(); renderInspector();
        } else {
          st.sel = null; st.linkFrom = null;
          drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: st.view.x, vy: st.view.y };
          canvas.classList.add('panning'); canvas.setPointerCapture(ev.pointerId); drawCanvas(); renderInspector();
        }
      });
      canvas.addEventListener('pointermove', ev => {
        if (!drag) return;
        if (drag.mode === 'pan') { st.view.x = drag.vx + ev.clientX - drag.sx; st.view.y = drag.vy + ev.clientY - drag.sy; drawCanvas(); return; }
        const n = nodeById(map, drag.id); if (!n) return;
        const w = toWorld(ev);
        n.x = Math.round((w.x + drag.dx) / 10) * 10; n.y = Math.round((w.y + drag.dy) / 10) * 10; drag.moved = true; drawCanvas();
      });
      const end = () => { if (!drag) return; if (drag.mode === 'node' && drag.moved) touch(); drag = null; canvas.classList.remove('panning'); };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('wheel', ev => { ev.preventDefault(); zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev); }, { passive: false });
      // Dépôt d'un son sur un élément ou un parcours
      const dropTarget = ev => { const el = ev.target.closest('[data-node],[data-edge]'); return el ? (el.dataset.node ? { kind: 'node', id: el.dataset.node, el } : { kind: 'edge', id: el.dataset.edge, el }) : null; };
      canvas.addEventListener('dragover', ev => {
        if (!ctx.canEdit || ![...(ev.dataTransfer.types || [])].includes('application/x-lp-sound')) return;
        const t = dropTarget(ev); canvas.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
        if (t) { ev.preventDefault(); t.el.classList.add('drop'); }
      });
      canvas.addEventListener('dragleave', () => canvas.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')));
      canvas.addEventListener('drop', ev => {
        const t = dropTarget(ev); canvas.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
        if (!t || !ctx.canEdit) return;
        ev.preventDefault();
        let ref = null; try { ref = JSON.parse(ev.dataTransfer.getData('application/x-lp-sound')); } catch (e) { return; }
        if (addSound(map, { kind: t.kind, id: t.id }, 'main', ref)) { st.sel = { kind: t.kind, id: t.id }; touch(); drawCanvas(); renderInspector(); }
      });
      host.onkeydown = ev => {
        if ((ev.key === 'Delete' || ev.key === 'Backspace') && st.sel && ctx.canEdit && !/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) { ev.preventDefault(); deleteSelection(); }
        if (ev.key === 'Escape') { st.linkFrom = null; st.connecting = false; render(); }
      };
    }
    function zoomBy(f, ev) {
      const c = host.querySelector('#lmCanvas'); if (!c) return;
      const r = c.getBoundingClientRect();
      const px = ev ? ev.clientX - r.left : r.width / 2, py = ev ? ev.clientY - r.top : r.height / 2;
      const k = Math.max(0.35, Math.min(2.2, st.view.k * f)), ratio = k / st.view.k;
      st.view = { k, x: px - (px - st.view.x) * ratio, y: py - (py - st.view.y) * ratio };
      drawCanvas();
    }
    function deleteSelection() {
      const map = curData(); if (!map || !st.sel) return;
      if (st.sel.kind === 'node') removeNode(map, st.sel.id); else removeEdge(map, st.sel.id);
      st.sel = null; touch(); render();
    }

    // ---- Inspecteur (élément ou parcours sélectionné)
    function renderInspector() {
      const box = host.querySelector('#lmInsp'), map = curData();
      if (!box || !map) return;
      const item = st.sel ? (st.sel.kind === 'edge' ? edgeById(map, st.sel.id) : nodeById(map, st.sel.id)) : null;
      if (!item) { box.innerHTML = `<h2>${esc(tr('map_inspector'))}</h2><p class="hint">${esc(tr('map_inspectorEmpty'))}</p>`; return; }
      const isEdge = st.sel.kind === 'edge', dis = ctx.canEdit ? '' : ' disabled';
      let html = `<h2>${esc(isEdge ? tr('map_edge') : tr('map_type_' + item.type))}</h2>
        <label>${esc(tr('map_label'))}</label><input type="text" id="lmLabel" value="${esc(item.label)}" maxlength="120"${dis}>`;
      if (isEdge) {
        const a = nodeById(map, item.from), b = nodeById(map, item.to);
        html += `<p class="hint">${esc((a && a.label) || '?')} → ${esc((b && b.label) || '?')}</p>
          <label class="choice" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="lmEnemy" ${item.enemy ? 'checked' : ''}${dis} style="width:auto"> ${esc(tr('map_enemy'))}</label>`;
      } else {
        html += `<label>${esc(tr('map_note'))}</label><textarea id="lmNote" maxlength="2000"${dis}>${esc(item.note)}</textarea>`;
        if (item.type === 'quest') {
          const choices = anchorChoices(map, item.id);
          html += `<label class="choice" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="lmSide" ${item.side ? 'checked' : ''}${dis} style="width:auto"> ${esc(tr('map_side'))}</label>
            ${item.side ? `<label>${esc(tr('map_anchor'))}</label><select id="lmAnchor"${dis}><option value="">${esc(tr('map_anchorNone'))}</option>${choices.map(c => {
              const v = c.kind + ':' + c.id, on = item.anchor && item.anchor.kind === c.kind && item.anchor.id === c.id;
              return `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc((c.kind === 'edge' ? '↔ ' : '') + c.label)}</option>`;
            }).join('')}</select>` : ''}`;
        }
      }
      const target = { kind: st.sel.kind, id: item.id };
      const slots = hasCombatSlot(map, target) ? ['main', 'combat'] : ['main'];
      slots.forEach(slot => {
        html += `<div class="lm-slot" data-slot="${slot}"><h4>${esc(tr('map_slot_' + slot))}</h4>${((item.sounds && item.sounds[slot]) || []).map((r, i) =>
          `<div class="lm-sound"><span>${r.kind === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(r.title)}">${esc(r.title || r.id)}</span>${ctx.canEdit ? `<button class="icon-btn" type="button" data-rm="${slot}:${i}" aria-label="${esc(tr('map_removeSound'))}">✕</button>` : ''}</div>`).join('') || `<p class="hint" style="margin:0">${esc(tr('map_slotEmpty'))}</p>`}</div>`;
      });
      if (item.sounds && item.sounds.combat && item.sounds.combat.length && !slots.includes('combat')) html += `<p class="hint">${esc(tr('map_combatKept', { n: item.sounds.combat.length }))}</p>`;
      if (ctx.canEdit) html += `<div class="bar" style="margin-top:10px"><button class="btn danger" id="lmDeleteSel" type="button">${esc(tr(isEdge ? 'map_deleteEdge' : 'map_deleteNode'))}</button></div>`;
      box.innerHTML = html;
      const on = (id, evt, fn) => { const el = box.querySelector(id); if (el) el.addEventListener(evt, fn); };
      on('#lmLabel', 'input', e => { item.label = e.target.value; touch(); drawCanvas(); });
      on('#lmNote', 'input', e => { item.note = e.target.value; touch(); });
      on('#lmEnemy', 'change', e => { setEnemy(map, item.id, e.target.checked); touch(); drawCanvas(); renderInspector(); });
      on('#lmSide', 'change', e => { item.side = e.target.checked; if (!item.side) item.anchor = null; touch(); drawCanvas(); renderInspector(); });
      on('#lmAnchor', 'change', e => { const [kind, ...rest] = e.target.value.split(':'); item.anchor = e.target.value ? { kind, id: rest.join(':') } : null; touch(); drawCanvas(); });
      on('#lmDeleteSel', 'click', deleteSelection);
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const [slot, i] = b.dataset.rm.split(':'); if (removeSound(map, target, slot, Number(i))) { touch(); drawCanvas(); renderInspector(); } });
      box.querySelectorAll('.lm-slot').forEach(sl => {
        sl.addEventListener('dragover', ev => { if (ctx.canEdit && [...(ev.dataTransfer.types || [])].includes('application/x-lp-sound')) { ev.preventDefault(); sl.classList.add('drop'); } });
        sl.addEventListener('dragleave', () => sl.classList.remove('drop'));
        sl.addEventListener('drop', ev => {
          sl.classList.remove('drop'); if (!ctx.canEdit) return; ev.preventDefault();
          let ref = null; try { ref = JSON.parse(ev.dataTransfer.getData('application/x-lp-sound')); } catch (e) { return; }
          if (addSound(map, target, sl.dataset.slot, ref)) { touch(); drawCanvas(); renderInspector(); }
        });
      });
      // Repli sans glisser (tactile, clavier) : le son sélectionné dans la bibliothèque s'ajoute avec le bouton de chaque emplacement.
      box.querySelectorAll('.lm-slot').forEach(sl => {
        if (!ctx.canEdit) return;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.style.marginTop = '4px'; b.textContent = tr('map_addPicked'); b.disabled = !st.picked;
        b.onclick = () => { if (st.picked && addSound(map, target, sl.dataset.slot, st.picked)) { touch(); drawCanvas(); renderInspector(); } };
        sl.appendChild(b);
      });
    }

    // ---- Bibliothèque de sons (à gauche)
    function renderLibrary() {
      const box = host.querySelector('#lmLib');
      if (!box) return;
      const libs = ctx.libraries || {};
      const kinds = ['track', 'sfx', 'asset'].filter(k => (libs[k] || []).length || k === st.libTab);
      const list = (libs[st.libTab] || []).filter(x => !st.libQuery || (x.title || '').toLowerCase().includes(st.libQuery.toLowerCase()));
      box.innerHTML = `<h2>${esc(tr('map_library'))}</h2><p class="hint">${esc(tr('map_libraryHint'))}</p>
        <div class="lm-tabs">${['track', 'sfx', 'asset'].map(k => `<button class="btn${st.libTab === k ? ' primary' : ''}" type="button" data-lt="${k}">${esc(tr('map_lib_' + k))}</button>`).join('')}</div>
        <input type="search" id="lmSearch" placeholder="${esc(tr('map_search'))}" value="${esc(st.libQuery)}">
        ${list.length ? list.slice(0, 200).map(x => `<div class="lm-sound" draggable="${ctx.canEdit}" data-ref="${esc(JSON.stringify({ kind: st.libTab, id: x.id, title: x.title }))}"><span>${st.libTab === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(x.title)}">${esc(x.title)}</span>${x.hint ? `<span class="meta">${esc(x.hint)}</span>` : ''}</div>`).join('') : `<p class="hint">${esc(tr(kinds.length ? 'map_libEmpty' : 'map_libNone'))}</p>`}`;
      box.querySelectorAll('[data-lt]').forEach(b => b.onclick = () => { st.libTab = b.dataset.lt; renderLibrary(); });
      const search = box.querySelector('#lmSearch');
      search.oninput = () => { st.libQuery = search.value; const pos = search.selectionStart; renderLibrary(); const s2 = host.querySelector('#lmSearch'); s2.focus(); s2.setSelectionRange(pos, pos); };
      box.querySelectorAll('[data-ref]').forEach(el => {
        el.addEventListener('dragstart', ev => { ev.dataTransfer.setData('application/x-lp-sound', el.dataset.ref); ev.dataTransfer.effectAllowed = 'copy'; });
        el.addEventListener('click', () => { st.picked = JSON.parse(el.dataset.ref); box.querySelectorAll('.lm-sound').forEach(x => { x.style.outline = x === el ? '2px solid var(--accent)' : ''; }); renderInspector(); });
      });
    }

    render();
    fit();
    return { flush, state: st, render, destroy() { clearTimeout(saveTimer); host.onkeydown = null; } };
  }

  window.LayerPitchLevelMap = { model, mount };
})();
