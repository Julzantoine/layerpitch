// projet-carte.js — LayerPitch, Carte de niveau d'un Projet (6 octobre ; migration 20261006020000).
// On dessine un niveau (début, lieux, quêtes, boss, PNJ, trésors, parcours), puis on y dépose des sons de la bibliothèque.
//   window.LayerPitchLevelMap.model   : fonctions pures (testées dans test_carte_de_niveau.js) -- aucune dépendance à la page
//   window.LayerPitchLevelMap.mount() : l'éditeur (SVG : éléments déplaçables, parcours, zoom, dépôt de sons), utilisé par projet.html
// Document d'une carte : { nodes: [{ id, type, label, x, y, note, side, anchor, sounds: { main: [ref], combat: [ref] } }],
//                          edges: [{ id, from, to, label, enemy, sounds }] }   ref = { kind: 'track'|'sfx'|'asset', id, title }
(function () {
  const NODE_TYPES = ['start', 'place', 'quest', 'boss', 'npc', 'treasure', 'junction']; // junction = point de passage sur un parcours, d'où d'autres itinéraires peuvent partir
  const SLOTS = ['main', 'combat', 'room'];
  const TRANSITION_STYLES = ['crossfade', 'cut', 'fadeout'];
  const SYNCS = ['immediate', 'beat', 'bar', 'bars2', 'bars4'];
  const DEFAULT_TRANSITION = { style: 'crossfade', sec: 2, sync: 'bar' };
  const DEFAULT_ROOM_DB = -14;
  const MAX_SOUNDS = 12;
  const MAX_NODES = 300, MAX_EDGES = 600;
  const GLYPH = { start: '▶', place: '⌂', quest: '!', boss: '☠', npc: '☺', treasure: '◆', junction: '•' };

  // ---------------------------------------------------------------- Modèle (fonctions pures)
  let idSeq = 0;
  const newId = prefix => prefix + Date.now().toString(36) + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 5);
  const emptyMap = () => ({ nodes: [], edges: [], roomTone: null, roomToneDb: DEFAULT_ROOM_DB, defaults: { transition: Object.assign({}, DEFAULT_TRANSITION) } });
  const nodeById = (map, id) => map.nodes.find(n => n.id === id) || null;
  const edgeById = (map, id) => map.edges.find(e => e.id === id) || null;

  function addNode(map, type, x, y, label) {
    if (!NODE_TYPES.includes(type) || map.nodes.length >= MAX_NODES) return null;
    if (type === 'start' && map.nodes.some(n => n.type === 'start')) return null; // un seul début de niveau
    const node = { id: newId('n'), type, label: label || '', x: Math.round(x), y: Math.round(y), note: '', sounds: { main: [], combat: [], room: [] }, transition: null };
    if (type === 'quest') { node.side = false; node.anchor = null; }
    map.nodes.push(node);
    return node;
  }
  function addEdge(map, from, to) {
    if (from === to || !nodeById(map, from) || !nodeById(map, to) || map.edges.length >= MAX_EDGES) return null;
    if (map.edges.some(e => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return null; // un parcours par paire
    const edge = { id: newId('e'), from, to, label: '', enemy: false, sounds: { main: [], combat: [], room: [] }, transition: null };
    map.edges.push(edge);
    return edge;
  }
  // Point de passage sur un parcours (7/10, « générer un nœud sur un itinéraire pour en faire partir un autre, comme un embranchement ») :
  // le parcours A → B devient A → P → B, P étant un nouvel élément « point de passage » posé là où l'on a cliqué. Les deux moitiés
  // reprennent les réglages du parcours d'origine (sons, ennemi, transition) ; les quêtes qui y étaient accrochées suivent la bonne moitié.
  function splitEdge(map, edgeId, x, y) {
    const e = edgeById(map, edgeId), g = e && edgeGeometry(map, e);
    if (!e || !g || map.nodes.length >= MAX_NODES || map.edges.length + 1 > MAX_EDGES) return null;
    const ts = projectOnEdge(map, edgeId, x, y);
    const node = { id: newId('n'), type: 'junction', label: '', x: Math.round(g.p1.x + (g.p2.x - g.p1.x) * ts), y: Math.round(g.p1.y + (g.p2.y - g.p1.y) * ts), note: '', sounds: { main: [], combat: [], room: [] }, transition: null };
    const clone = o => JSON.parse(JSON.stringify(o));
    const half = (from, to, label) => ({ id: newId('e'), from, to, label, enemy: !!e.enemy, sounds: clone(e.sounds || { main: [], combat: [], room: [] }), transition: e.transition ? clone(e.transition) : null });
    const e1 = half(e.from, node.id, e.label || ''), e2 = half(node.id, e.to, '');
    map.nodes.push(node);
    const at = map.edges.indexOf(e);
    map.edges.splice(at, 1, e1, e2);
    map.nodes.forEach(n => {
      if (n.anchor && n.anchor.kind === 'edge' && n.anchor.id === edgeId) {
        const t0 = clampT(n.anchor.t);
        n.anchor = t0 <= ts ? { kind: 'edge', id: e1.id, t: Math.round(clampT(t0 / ts) * 1000) / 1000 } : { kind: 'edge', id: e2.id, t: Math.round(clampT((t0 - ts) / (1 - ts)) * 1000) / 1000 };
      }
    });
    return { node, edges: [e1, e2] };
  }
  function removeNode(map, id) {
    // Un point de passage qui n'a que deux parcours disparaît en les réunissant (A → P → B redevient A → B).
    const target = nodeById(map, id);
    if (target && target.type === 'junction') {
      const inc = map.edges.filter(e => e.from === id || e.to === id);
      if (inc.length === 2) {
        const other = e => (e.from === id ? e.to : e.from);
        const a = other(inc[0]), b = other(inc[1]);
        const exists = map.edges.some(e => e !== inc[0] && e !== inc[1] && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));
        if (a !== b && !exists) {
          const first = inc[0].to === id ? inc[0] : inc[1], second = first === inc[0] ? inc[1] : inc[0]; // first : arrive en P ; second : repart de P
          const merged = { id: newId('e'), from: other(first), to: other(second), label: first.label || second.label || '', enemy: !!(first.enemy || second.enemy), sounds: first.sounds, transition: first.transition || null };
          if (second.from !== id) { merged.from = other(second); merged.to = other(first); } // les deux arrivent en P : l'ordre n'a pas d'importance
          map.edges.splice(map.edges.indexOf(inc[0]), 1, merged);
          map.edges.splice(map.edges.indexOf(inc[1]), 1);
          map.nodes = map.nodes.filter(n => n.id !== id);
          map.nodes.forEach(n => { if (n.anchor && ((n.anchor.kind === 'node' && n.anchor.id === id) || (n.anchor.kind === 'edge' && (n.anchor.id === inc[0].id || n.anchor.id === inc[1].id)))) n.anchor = null; });
          return;
        }
      }
    }
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
    if (slot === 'room') list.length = 0; // un seul fond d'ambiance propre à l'élément : le nouveau remplace l'ancien
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
  const SIZE = { start: { hx: 56, hy: 34 }, other: { hx: 62, hy: 22 }, junction: { hx: 10, hy: 10 } };
  const halfSize = n => (n.type === 'start' ? SIZE.start : (n.type === 'junction' ? SIZE.junction : SIZE.other));
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
    if (!g) return null;
    // Point choisi sur le parcours (anchor.t, de 0 = départ à 1 = arrivée) ; à défaut, le milieu.
    const t = clampT(anchor.t);
    return { x: g.p1.x + (g.p2.x - g.p1.x) * t, y: g.p1.y + (g.p2.y - g.p1.y) * t };
  }
  const clampT = t => (Number.isFinite(+t) && t !== null && t !== undefined ? Math.min(0.95, Math.max(0.05, +t)) : 0.5);
  // Où, le long d'un parcours, se projette un point (x, y) du plan : t de 0 à 1 (borné pour ne pas coller aux éléments).
  function projectOnEdge(map, edgeId, x, y) {
    const e = edgeById(map, edgeId), g = e && edgeGeometry(map, e);
    if (!g) return 0.5;
    const dx = g.p2.x - g.p1.x, dy = g.p2.y - g.p1.y, len2 = dx * dx + dy * dy;
    return len2 ? clampT(((x - g.p1.x) * dx + (y - g.p1.y) * dy) / len2) : 0.5;
  }
  // Accroche une quête à un point d'un parcours (« générer un point sur un itinéraire pour y relier quelque chose ») : la quête
  // devient annexe, rattachée à ce point précis.
  function anchorQuestToEdge(map, nodeId, edgeId, t) {
    const n = nodeById(map, nodeId), e = edgeById(map, edgeId);
    if (!n || !e || n.type !== 'quest') return false;
    n.side = true;
    n.anchor = { kind: 'edge', id: edgeId, t: Math.round(clampT(t) * 1000) / 1000 };
    return true;
  }
  // Bilan d'une carte : combien de sons posés, d'éléments sans son.
  function summary(map) {
    const items = map.nodes.map(n => ({ n, s: n.sounds })).concat(map.edges.map(e => ({ n: e, s: e.sounds })));
    let sounds = 0, silent = 0;
    items.forEach(({ s }) => { const c = ((s && s.main) || []).length + ((s && s.combat) || []).length; sounds += c; if (!c) silent++; });
    return { nodes: map.nodes.length, edges: map.edges.length, sounds, silent };
  }
  // Remet une carte reçue du serveur dans la forme attendue (champs absents, sons manquants).
  function cleanRef(r) {
    return r && ['track', 'sfx', 'asset'].includes(r.kind) && r.id ? { kind: r.kind, id: String(r.id), title: String(r.title || '').slice(0, 120) } : null;
  }
  function cleanTransition(t) {
    if (!t || typeof t !== 'object') return null;
    const out = {};
    if (TRANSITION_STYLES.includes(t.style)) out.style = t.style;
    if (SYNCS.includes(t.sync)) out.sync = t.sync;
    if (Number.isFinite(Number(t.sec)) && t.sec !== '' && t.sec !== null) out.sec = Math.max(0, Math.min(30, Number(t.sec)));
    const st = cleanRef(t.stinger); if (st) out.stinger = st;
    return Object.keys(out).length ? out : null;
  }
  function cleanSounds(s) {
    const out = { main: [], combat: [], room: [] };
    SLOTS.forEach(k => { out[k] = ((s && s[k]) || []).map(cleanRef).filter(Boolean).slice(0, k === 'room' ? 1 : MAX_SOUNDS); });
    return out;
  }
  // Remet une carte reçue du serveur dans la forme attendue (champs absents, sons manquants).
  function normalize(raw) {
    const map = emptyMap();
    ((raw && raw.nodes) || []).forEach(n => {
      if (!n || !NODE_TYPES.includes(n.type)) return;
      map.nodes.push({ id: String(n.id), type: n.type, label: n.label || '', x: Number(n.x) || 0, y: Number(n.y) || 0, note: n.note || '',
        side: !!n.side, anchor: n.anchor || null, sounds: cleanSounds(n.sounds), transition: cleanTransition(n.transition) });
    });
    ((raw && raw.edges) || []).forEach(e => {
      if (!e || !nodeById(map, e.from) || !nodeById(map, e.to)) return;
      map.edges.push({ id: String(e.id), from: e.from, to: e.to, label: e.label || '', enemy: !!e.enemy, sounds: cleanSounds(e.sounds), transition: cleanTransition(e.transition) });
    });
    map.roomTone = cleanRef(raw && raw.roomTone);
    if (raw && Number.isFinite(Number(raw.roomToneDb))) map.roomToneDb = Math.max(-60, Math.min(0, Number(raw.roomToneDb)));
    const dt = cleanTransition(raw && raw.defaults && raw.defaults.transition) || {};
    delete dt.stinger;
    map.defaults.transition = Object.assign({}, DEFAULT_TRANSITION, dt);
    return map;
  }

  // ---------------------------------------------------------------- Lecture : navigation et réglages résolus (fonctions pures)
  // Réglage de transition EFFECTIF pour entrer dans un élément ou un parcours : le sien, complété par celui de la carte.
  function resolveTransition(map, item) {
    const d = (map.defaults && map.defaults.transition) || DEFAULT_TRANSITION, o = cleanTransition(item && item.transition) || {};
    return { style: o.style || d.style || DEFAULT_TRANSITION.style, sec: o.sec != null ? o.sec : (d.sec != null ? d.sec : DEFAULT_TRANSITION.sec),
      sync: o.sync || d.sync || DEFAULT_TRANSITION.sync, stinger: o.stinger || null };
  }
  // Fond d'ambiance : celui de l'élément s'il en a un, sinon celui de la carte.
  function resolveRoom(map, item) {
    return (item && item.sounds && item.sounds.room && item.sounds.room[0]) || map.roomTone || null;
  }
  const dbToGain = db => Math.pow(10, Math.max(-60, Math.min(0, Number(db) || 0)) / 20);
  const itemOf = (map, t) => (t.kind === 'edge' ? edgeById(map, t.id) : nodeById(map, t.id));
  function pointOf(map, t) {
    if (t.kind === 'node') { const n = nodeById(map, t.id); return n ? { x: n.x, y: n.y } : null; }
    const e = edgeById(map, t.id), g = e && edgeGeometry(map, e);
    return g ? g.mid : null;
  }
  // Voisins d'une position : un élément touche ses parcours (et les quêtes annexes accrochées à lui) ; un parcours touche ses deux
  // extrémités (et les quêtes accrochées à lui) ; une quête annexe touche ce à quoi elle est accrochée.
  function neighbors(map, t) {
    const out = [], add = x => { if (x && !out.some(o => o.kind === x.kind && o.id === x.id) && itemOf(map, x)) out.push({ kind: x.kind, id: x.id }); };
    if (t.kind === 'node') {
      const n = nodeById(map, t.id); if (!n) return out;
      map.edges.forEach(e => { if (e.from === n.id || e.to === n.id) add({ kind: 'edge', id: e.id }); });
      if (n.anchor) add(n.anchor);
      map.nodes.forEach(q => { if (q.anchor && q.anchor.kind === 'node' && q.anchor.id === n.id) add({ kind: 'node', id: q.id }); });
    } else {
      const e = edgeById(map, t.id); if (!e) return out;
      add({ kind: 'node', id: e.from }); add({ kind: 'node', id: e.to });
      map.nodes.forEach(q => { if (q.anchor && q.anchor.kind === 'edge' && q.anchor.id === e.id) add({ kind: 'node', id: q.id }); });
    }
    return out;
  }
  // Flèche du clavier : le voisin le plus proche de la direction demandée (dans un cône d'environ ±70°), sinon rien.
  function stepToward(map, t, dx, dy) {
    const from = pointOf(map, t); if (!from) return null;
    const len = Math.hypot(dx, dy) || 1;
    let best = null;
    neighbors(map, t).forEach(c => {
      const p = pointOf(map, c); if (!p) return;
      const vx = p.x - from.x, vy = p.y - from.y, d = Math.hypot(vx, vy) || 1e-9;
      const cos = (vx * dx + vy * dy) / (d * len);
      if (cos < 0.34) return;
      const score = cos * 1000 - d * 0.01;
      if (!best || score > best.score) best = { target: c, score };
    });
    return best ? best.target : null;
  }
  // Un son parmi plusieurs (alternatives) : tirage au hasard sans rejouer deux fois de suite le même.
  function pickVariant(list, lastKey, rng) {
    const refs = (list || []).filter(Boolean);
    if (!refs.length) return null;
    const pool = refs.length > 1 ? refs.filter(r => r.kind + ':' + r.id !== lastKey) : refs;
    return pool[Math.floor((rng || Math.random)() * pool.length) % pool.length];
  }
  const refKey = r => (r ? r.kind + ':' + r.id : null);

  const model = { NODE_TYPES, SLOTS, GLYPH, MAX_SOUNDS, TRANSITION_STYLES, SYNCS, DEFAULT_TRANSITION, DEFAULT_ROOM_DB, emptyMap, normalize, cleanRef, cleanTransition,
    resolveTransition, resolveRoom, dbToGain, neighbors, stepToward, pickVariant, refKey, pointOf, nodeById, edgeById, addNode, addEdge, removeNode, removeEdge, addSound, removeSound,
    setEnemy, hasCombatSlot, anchorChoices, borderPoint, edgeGeometry, anchorPoint, projectOnEdge, anchorQuestToEdge, splitEdge, summary };

  // ---------------------------------------------------------------- Éditeur
  const STYLE_ID = 'lpLevelMapStyle';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .lm-wrap { display: grid; grid-template-columns: 230px minmax(0, 1fr) 270px; gap: 12px; align-items: start; }
      .lm-wrap.lib-c { grid-template-columns: 38px minmax(0, 1fr) 270px; } .lm-wrap.insp-c { grid-template-columns: 230px minmax(0, 1fr) 38px; } .lm-wrap.lib-c.insp-c { grid-template-columns: 38px minmax(0, 1fr) 38px; }
      @media (max-width: 1100px) { .lm-wrap, .lm-wrap.lib-c, .lm-wrap.insp-c, .lm-wrap.lib-c.insp-c { grid-template-columns: minmax(0, 1fr); } }
      .lm-panel { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .lm-collapse { display: flex; align-items: center; gap: 8px; font: inherit; font-size: 12px; background: var(--bg-card); color: var(--text-dim); border: 1px solid var(--border); border-radius: 8px; padding: 5px 9px; cursor: pointer; }
      .lm-collapse:hover { border-color: var(--accent); color: var(--accent); } .lm-collapse:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .lm-chev { font-weight: 700; } .lm-vlabel { white-space: nowrap; }
      .lm-wrap.lib-c #lmLibPanel > .lm-side, .lm-wrap.insp-c #lmInspPanel > .lm-side { display: none; }
      .lm-wrap.lib-c #lmLibPanel > .lm-collapse, .lm-wrap.insp-c #lmInspPanel > .lm-collapse { flex-direction: column; padding: 10px 0; justify-content: flex-start; align-items: center; }
      .lm-wrap.lib-c #lmLibPanel .lm-vlabel, .lm-wrap.insp-c #lmInspPanel .lm-vlabel { writing-mode: vertical-rl; }
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
      .lm-anchor-dot { fill: var(--bg, #fff); stroke: var(--seq-map-choice, #b8862e); stroke-width: 2.4; cursor: ew-resize; }
      .lm-anchor-dot:hover { fill: var(--seq-map-choice, #b8862e); }
      .lm-anchor { stroke: var(--text-dimmer); stroke-width: 1.6; stroke-dasharray: 4 4; fill: none; pointer-events: none; }
      .lm-sound { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; margin: 4px 0; font-size: 12.5px; background: var(--bg); }
      .lm-sound[draggable="true"] { cursor: grab; } .lm-sound .lm-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lm-slot { border: 1px dashed var(--border); border-radius: 8px; padding: 8px; margin: 6px 0; } .lm-slot.drop { border-color: var(--accent); background: var(--accent-soft); }
      .lm-slot h4 { margin: 0 0 4px; font-size: 12px; color: var(--text-dim); font-weight: 600; }
      .lm-tabs { display: flex; gap: 4px; margin: 6px 0; } .lm-tabs button { flex: 1; font-size: 11.5px; padding: 4px 6px; }
      .lm-node.here .lm-shape { stroke: var(--accent); stroke-width: 5; } .lm-edge.here .lm-line { stroke: var(--accent); stroke-width: 4.5; }
      .lm-canvas.playing { cursor: pointer; } .lm-canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .lm-now[hidden] { display: none; } /* sans cette règle, la barre vide restait visible hors du mode « se balader » */
      .lm-now { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 10px; padding: 8px 12px; margin-bottom: 8px; font-size: 12.5px; }
      .lm-layers { display: inline-flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; } .lm-layers .btn { padding: 3px 10px; min-width: 32px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lm-now b { font-weight: 600; } .lm-now .lm-wait { color: var(--text-dim); font-family: var(--font-mono); font-size: 11.5px; }
      .lm-set { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 18px; }
      .lm-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; } .lm-row input[type="number"] { width: 80px; } .lm-row select { width: auto; flex: 1 1 130px; }
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
      libTab: 'track', libQuery: '', status: '', dirty: false, play: false, now: null };
    st.current = st.maps.length ? st.maps[0].id : null;
    let saveTimer = null, saving = false;
    // Lecture (Écouter) : seulement si la page fournit le moteur audio (ctx.audio = { voiceFactory, now, schedule }).
    const audio = ctx.audio && window.LayerPitchLevelMapAudio ? window.LayerPitchLevelMapAudio.createPlayer(Object.assign({}, ctx.audio, { onChange: s => { st.now = s; refreshNow(); drawCanvas(); } })) : null;
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
      if (map) { if (audio) audio.setMap(map); wireEditor(map); drawCanvas(); renderInspector(); renderLibrary(); renderSettings(); refreshNow(); }
    }
    function editorHtml(map) {
      const s = summary(map);
      return `<details class="card" id="lmSettings" style="padding:10px 16px"${st.settingsOpen ? ' open' : ''}><summary style="cursor:pointer;font-weight:600">${esc(tr('map_settings'))}</summary><div id="lmSettingsBody"></div></details>
        <div class="lm-wrap">
        <div class="lm-panel" id="lmLibPanel"><button type="button" class="lm-collapse" data-collapse="lib" aria-expanded="true"><span class="lm-chev">«</span><span class="lm-vlabel">${esc(tr('map_library'))}</span></button><div class="lm-side" id="lmLib"></div></div>
        <div>
          <div class="lm-now" id="lmNow" hidden></div>
          <div class="lm-toolbar">${audio ? `<button class="btn${st.play ? ' primary' : ''}" id="lmPlay" type="button">${esc(tr(st.play ? 'map_playOn' : 'map_play'))}</button>` : ''}${ctx.canEdit && !st.play ? NODE_TYPES.map(t => `<button class="btn" type="button" data-add="${t}" ${t === 'start' && map.nodes.some(n => n.type === 'start') ? 'disabled' : ''}>${GLYPH[t]} ${esc(tr('map_type_' + t))}</button>`).join('') +
            `<button class="btn${st.connecting ? ' primary' : ''}" id="lmConnect" type="button">${esc(tr(st.connecting ? 'map_connecting' : 'map_connect'))}</button>` : ''}
            <button class="btn" id="lmZoomOut" type="button" aria-label="${esc(tr('map_zoomOut'))}">−</button><button class="btn" id="lmZoomIn" type="button" aria-label="${esc(tr('map_zoomIn'))}">+</button><button class="btn" id="lmFit" type="button">${esc(tr('map_fit'))}</button></div>
          <div class="lm-canvas${st.connecting ? ' connecting' : ''}${st.play ? ' playing' : ''}" id="lmCanvas" tabindex="0"><svg id="lmSvg" role="img" aria-label="${esc(tr('map_title'))}"></svg></div>
          <p class="hint" style="margin-top:6px">${esc(tr('map_summary', s))}</p>
        </div>
        <div class="lm-panel" id="lmInspPanel"><button type="button" class="lm-collapse" data-collapse="insp" aria-expanded="true"><span class="lm-chev">»</span><span class="lm-vlabel">${esc(tr('map_inspector'))}</span></button><div class="lm-side" id="lmInsp"></div></div></div>`;
    }

    function wireHeader() {
      const pick = host.querySelector('#lmPick');
      if (pick) pick.onchange = () => { if (st.play && audio) { audio.stop(0.3); st.play = false; st.now = null; } st.current = pick.value; st.sel = null; st.linkFrom = null; st.view = { x: 0, y: 0, k: 1 }; render(); fit(); };
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
      const COLORS = { start: 'var(--accent)', place: 'var(--text-dim)', quest: 'var(--seq-map-choice)', boss: '#b5442e', npc: 'var(--seq-map-success)', treasure: '#b8862e', junction: 'var(--text-dim)' };
      let out = `<defs><marker id="lmArrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-dim)"/></marker></defs>`;
      out += `<g transform="translate(${st.view.x} ${st.view.y}) scale(${st.view.k})">`;
      map.nodes.forEach(n => {
        if (n.anchor) { const p = anchorPoint(map, n.anchor); if (p) out += `<line class="lm-anchor" x1="${n.x}" y1="${n.y}" x2="${p.x}" y2="${p.y}"/>${n.anchor.kind === 'edge' ? `<circle class="lm-anchor-dot" data-anchor-dot="${n.id}" cx="${p.x}" cy="${p.y}" r="6"/>` : ''}`; }
      });
      map.edges.forEach(e => {
        const g = edgeGeometry(map, e); if (!g) return;
        const sel = st.sel && st.sel.kind === 'edge' && st.sel.id === e.id;
        const here = hereIs('edge', e.id);
        const label = e.label || '';
        out += `<g class="lm-edge${sel ? ' sel' : ''}${here ? ' here' : ''}" data-edge="${esc(e.id)}"><path class="lm-hit" d="M${g.p1.x} ${g.p1.y}L${g.p2.x} ${g.p2.y}"/><path class="lm-line" d="M${g.p1.x} ${g.p1.y}L${g.p2.x} ${g.p2.y}" marker-end="url(#lmArrow)"/>
          <text x="${g.mid.x}" y="${g.mid.y - 8}" text-anchor="middle">${esc(label)}${e.enemy ? ` <tspan class="lm-star">✱</tspan>` : ''}${soundCount(e) ? ` <tspan class="lm-badge" fill="var(--accent)">♪${soundCount(e)}</tspan>` : ''}</text></g>`;
      });
      map.nodes.forEach(n => {
        const sel = st.sel && st.sel.kind === 'node' && st.sel.id === n.id;
        const { hx, hy } = halfSize(n);
        if (n.type === 'junction') { // point de passage : un petit rond, nom facultatif dessous
          out += `<g class="lm-node lm-junction${sel ? ' sel' : ''}${hereIs('node', n.id) ? ' here' : ''}${st.linkFrom === n.id ? ' link-from' : ''}" data-node="${esc(n.id)}" style="--lm-color:${COLORS.junction}"><circle class="lm-shape" cx="${n.x}" cy="${n.y}" r="${hx}"/>${n.label ? `<text x="${n.x}" y="${n.y + hy + 14}" text-anchor="middle">${esc(n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label)}</text>` : ''}${soundCount(n) ? `<text class="lm-badge" x="${n.x + hx + 2}" y="${n.y - hy}" text-anchor="start">♪${soundCount(n)}</text>` : ''}</g>`;
          return;
        }
        const shape = n.type === 'start' ? `<polygon class="lm-shape" points="${n.x},${n.y - hy} ${n.x + hx},${n.y} ${n.x},${n.y + hy} ${n.x - hx},${n.y}"/>`
          : `<rect class="lm-shape" x="${n.x - hx}" y="${n.y - hy}" width="${hx * 2}" height="${hy * 2}" rx="${n.type === 'quest' ? 20 : 6}"${n.type === 'boss' ? ' stroke-width="3.5"' : ''}/>`;
        const full = n.label || tr('map_type_' + n.type), max = n.type === 'start' ? 9 : 16;
        const text = full.length > max ? full.slice(0, max - 1) + '…' : full;
        out += `<g class="lm-node${sel ? ' sel' : ''}${hereIs('node', n.id) ? ' here' : ''}${st.linkFrom === n.id ? ' link-from' : ''}" data-node="${esc(n.id)}" style="--lm-color:${COLORS[n.type]}">${shape}
          <text class="lm-glyph" x="${n.x - hx + 12}" y="${n.y + 4.5}" text-anchor="middle">${GLYPH[n.type]}</text>
          <text x="${n.x + 6}" y="${n.y + 4.5}" text-anchor="middle">${esc(text)}</text>${n.side ? `<text class="lm-badge" x="${n.x}" y="${n.y - hy - 4}" text-anchor="middle">${esc(tr('map_sideTag'))}</text>` : ''}
          ${soundCount(n) ? `<text class="lm-badge" x="${n.x + hx - 4}" y="${n.y - hy + 11}" text-anchor="end">♪${soundCount(n)}</text>` : ''}</g>`;
      });
      out += '</g>';
      svg.innerHTML = out;
    }

    // Panneaux « Sons » (gauche) et « Détail / Parcours » (droite) repliables pour gagner de la place (7/10) ; le choix est retenu.
    const PANEL_KEY = { lib: 'lp_map_lib_collapsed', insp: 'lp_map_insp_collapsed' };
    const panelCollapsed = k => { try { return localStorage.getItem(PANEL_KEY[k]) === '1'; } catch (e) { return false; } };
    const setPanelCollapsed = (k, on) => { try { localStorage.setItem(PANEL_KEY[k], on ? '1' : '0'); } catch (e) { /* stockage indisponible : le repli vaut pour cette visite */ } };
    function applyPanels() {
      const wrap = host.querySelector('.lm-wrap'); if (!wrap) return;
      ['lib', 'insp'].forEach(k => {
        const on = st['collapsed_' + k] != null ? st['collapsed_' + k] : panelCollapsed(k);
        wrap.classList.toggle(k + '-c', !!on);
        const b = wrap.querySelector('[data-collapse="' + k + '"]');
        if (b) { b.setAttribute('aria-expanded', String(!on)); b.querySelector('.lm-chev').textContent = k === 'lib' ? (on ? '»' : '«') : (on ? '«' : '»'); b.title = tr(on ? 'map_expand' : 'map_collapse'); }
      });
    }
    function wireEditor(map) {
      host.querySelectorAll('[data-collapse]').forEach(b => b.onclick = () => {
        const k = b.dataset.collapse, now = !(st['collapsed_' + k] != null ? st['collapsed_' + k] : panelCollapsed(k));
        st['collapsed_' + k] = now; setPanelCollapsed(k, now); applyPanels(); drawCanvas();
      });
      applyPanels();
      host.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
        const c = viewCenter(), jitter = (map.nodes.length % 6) * 22;
        const node = addNode(map, b.dataset.add, Math.round((c.x + jitter) / 10) * 10, Math.round((c.y + jitter) / 10) * 10, '');
        if (!node) return;
        st.sel = { kind: 'node', id: node.id }; touch(); render();
      });
      const det = host.querySelector('#lmSettings'); if (det) det.addEventListener('toggle', () => { st.settingsOpen = det.open; });
      const playBtn = host.querySelector('#lmPlay');
      if (playBtn) playBtn.onclick = () => togglePlay(!st.play);
      const conn = host.querySelector('#lmConnect');
      if (conn) conn.onclick = () => { st.connecting = !st.connecting; st.linkFrom = null; render(); };
      host.querySelector('#lmZoomIn').onclick = () => zoomBy(1.2);
      host.querySelector('#lmZoomOut').onclick = () => zoomBy(1 / 1.2);
      host.querySelector('#lmFit').onclick = fit;
      const canvas = host.querySelector('#lmCanvas');
      const toWorld = ev => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left - st.view.x) / st.view.k, y: (ev.clientY - r.top - st.view.y) / st.view.k }; };
      let drag = null;
      const capture = (el, id) => { try { el.setPointerCapture(id); } catch (e) { /* pas de capture (anciens navigateurs, tests) : le glisser marche quand même tant que le pointeur reste sur la carte */ } };
      canvas.addEventListener('pointerdown', ev => {
        const dotEl = ev.target.closest('[data-anchor-dot]');
        if (dotEl && ctx.canEdit && !st.play) { // glisser le point d'accroche d'une quête le long de son parcours
          const q = nodeById(map, dotEl.dataset.anchorDot);
          if (q && q.anchor && q.anchor.kind === 'edge') { drag = { mode: 'anchor', id: q.id, moved: false }; capture(canvas, ev.pointerId); st.sel = { kind: 'node', id: q.id }; renderInspector(); return; }
        }
        const nodeEl = ev.target.closest('[data-node]'), edgeEl = ev.target.closest('[data-edge]');
        if (st.play && audio && (nodeEl || edgeEl)) { // Écouter : un clic place sur l'élément ou le parcours et joue son son
          const target = nodeEl ? { kind: 'node', id: nodeEl.dataset.node } : { kind: 'edge', id: edgeEl.dataset.edge };
          st.sel = target; audio.goTo(target); drawCanvas(); renderInspector(); canvas.focus(); return;
        }
        if (nodeEl) {
          const id = nodeEl.dataset.node, n = nodeById(map, id);
          if (st.connecting && ctx.canEdit) {
            if (!st.linkFrom) { st.linkFrom = id; drawCanvas(); }
            else { const e = addEdge(map, st.linkFrom, id); st.linkFrom = null; if (e) { st.sel = { kind: 'edge', id: e.id }; touch(); } render(); }
            return;
          }
          st.sel = { kind: 'node', id };
          if (ctx.canEdit) { const w = toWorld(ev); drag = { mode: 'node', id, dx: n.x - w.x, dy: n.y - w.y, moved: false }; capture(canvas, ev.pointerId); }
          drawCanvas(); renderInspector();
        } else if (edgeEl) {
          if (st.connecting && ctx.canEdit) {
            // Relier + un parcours : un point de passage est créé là où l'on clique, et un itinéraire part de lui ou y arrive.
            //   - une quête cliquée d'abord : elle s'accroche à cet endroit du parcours (quête annexe) ;
            //   - un autre élément cliqué d'abord : un parcours le relie au nouveau point de passage ;
            //   - le parcours cliqué d'abord : le point de passage est créé, puis on clique l'élément à atteindre.
            const w = toWorld(ev), t = projectOnEdge(map, edgeEl.dataset.edge, w.x, w.y), from = st.linkFrom && nodeById(map, st.linkFrom);
            if (from && from.type === 'quest') { if (anchorQuestToEdge(map, from.id, edgeEl.dataset.edge, t)) { st.sel = { kind: 'node', id: from.id }; touch(); } st.linkFrom = null; render(); return; }
            const cut = splitEdge(map, edgeEl.dataset.edge, w.x, w.y);
            if (!cut) return;
            if (from) { const e = addEdge(map, from.id, cut.node.id); st.linkFrom = null; st.sel = e ? { kind: 'edge', id: e.id } : { kind: 'node', id: cut.node.id }; }
            else { st.linkFrom = cut.node.id; st.sel = { kind: 'node', id: cut.node.id }; }
            touch(); render();
            return;
          }
          st.sel = { kind: 'edge', id: edgeEl.dataset.edge }; drawCanvas(); renderInspector();
        } else {
          st.sel = null; st.linkFrom = null;
          drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: st.view.x, vy: st.view.y };
          canvas.classList.add('panning'); capture(canvas, ev.pointerId); drawCanvas(); renderInspector();
        }
      });
      canvas.addEventListener('pointermove', ev => {
        if (!drag) return;
        if (drag.mode === 'pan') { st.view.x = drag.vx + ev.clientX - drag.sx; st.view.y = drag.vy + ev.clientY - drag.sy; drawCanvas(); return; }
        const n = nodeById(map, drag.id); if (!n) return;
        const w = toWorld(ev);
        if (drag.mode === 'anchor') { if (n.anchor && n.anchor.kind === 'edge') { n.anchor.t = Math.round(projectOnEdge(map, n.anchor.id, w.x, w.y) * 1000) / 1000; drag.moved = true; drawCanvas(); } return; }
        n.x = Math.round((w.x + drag.dx) / 10) * 10; n.y = Math.round((w.y + drag.dy) / 10) * 10; drag.moved = true; drawCanvas();
      });
      const end = () => { if (!drag) return; if ((drag.mode === 'node' || drag.mode === 'anchor') && drag.moved) touch(); drag = null; canvas.classList.remove('panning'); };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      // Double-clic sur un parcours : un point de passage y est créé (on peut ensuite en faire partir un autre itinéraire).
      canvas.addEventListener('dblclick', ev => {
        if (!ctx.canEdit || st.play) return;
        const edgeEl = ev.target.closest('[data-edge]'); if (!edgeEl) return;
        const w = toWorld(ev), cut = splitEdge(map, edgeEl.dataset.edge, w.x, w.y);
        if (cut) { st.sel = { kind: 'node', id: cut.node.id }; touch(); render(); }
      });
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
      const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      host.onkeydown = ev => {
        const typing = /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName);
        if (st.play && audio && !typing) {
          if (ARROWS[ev.key]) { ev.preventDefault(); const [dx, dy] = ARROWS[ev.key]; const from = st.now && st.now.position; (from ? audio.step(dx, dy) : startFromSelection()).then(next => { const pos = audio.state.position; if (pos) { st.sel = { kind: pos.kind, id: pos.id }; drawCanvas(); renderInspector(); } }); return; }
          if (ev.key === ' ') { ev.preventDefault(); if (st.now && st.now.playing) audio.stop(1); else if (st.now && st.now.position) audio.resume(); else startFromSelection(); return; }
          if (/^[0-9]$/.test(ev.key) && st.now && st.now.layers > 1) { ev.preventDefault(); audio.setIntensity(ev.key === '0' ? null : Math.min(st.now.layers - 1, +ev.key - 1)); return; } // 1-9 : couche ; 0 : automatique
          if (ev.key === 'c' || ev.key === 'C') { ev.preventDefault(); audio.setCombat(!(st.now && st.now.combat)); return; }
          if (ev.key === 'Escape') { ev.preventDefault(); togglePlay(false); return; }
        }
        if ((ev.key === 'Delete' || ev.key === 'Backspace') && st.sel && ctx.canEdit && !/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) { ev.preventDefault(); deleteSelection(); }
        if (ev.key === 'Escape' && !st.play) { st.linkFrom = null; st.connecting = false; render(); }
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
          ${ctx.canEdit ? `<button class="btn" id="lmSplit" type="button" title="${esc(tr('map_splitHint'))}">${esc(tr('map_split'))}</button>` : ''}
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
      const slots = (hasCombatSlot(map, target) ? ['main', 'combat'] : ['main']).concat(['room']);
      slots.forEach(slot => {
        html += `<div class="lm-slot" data-slot="${slot}"><h4>${esc(tr('map_slot_' + slot))}</h4>${((item.sounds && item.sounds[slot]) || []).map((r, i) =>
          `<div class="lm-sound"><span>${r.kind === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(r.title)}">${esc(r.title || r.id)}</span>${ctx.canEdit ? `<button class="icon-btn" type="button" data-rm="${slot}:${i}" aria-label="${esc(tr('map_removeSound'))}">✕</button>` : ''}</div>`).join('') || `<p class="hint" style="margin:0">${esc(tr('map_slotEmpty'))}</p>`}</div>`;
      });
      html += transitionHtml(map, item);
      if (item.sounds && item.sounds.combat && item.sounds.combat.length && !slots.includes('combat')) html += `<p class="hint">${esc(tr('map_combatKept', { n: item.sounds.combat.length }))}</p>`;
      if (ctx.canEdit) html += `<div class="bar" style="margin-top:10px"><button class="btn danger" id="lmDeleteSel" type="button">${esc(tr(isEdge ? 'map_deleteEdge' : 'map_deleteNode'))}</button></div>`;
      box.innerHTML = html;
      const on = (id, evt, fn) => { const el = box.querySelector(id); if (el) el.addEventListener(evt, fn); };
      on('#lmLabel', 'input', e => { item.label = e.target.value; touch(); drawCanvas(); });
      on('#lmNote', 'input', e => { item.note = e.target.value; touch(); });
      on('#lmSplit', 'click', () => { const g = edgeGeometry(map, item), cut = g && splitEdge(map, item.id, g.mid.x, g.mid.y); if (cut) { st.sel = { kind: 'node', id: cut.node.id }; touch(); render(); } });
      on('#lmEnemy', 'change', e => { setEnemy(map, item.id, e.target.checked); touch(); drawCanvas(); renderInspector(); });
      on('#lmSide', 'change', e => { item.side = e.target.checked; if (!item.side) item.anchor = null; touch(); drawCanvas(); renderInspector(); });
      on('#lmAnchor', 'change', e => { const [kind, ...rest] = e.target.value.split(':'); item.anchor = e.target.value ? { kind, id: rest.join(':') } : null; touch(); drawCanvas(); });
      on('#lmDeleteSel', 'click', deleteSelection);
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const [slot, i] = b.dataset.rm.split(':'); if (removeSound(map, target, slot, Number(i))) { touch(); drawCanvas(); renderInspector(); } });
      box.querySelectorAll('.lm-slot[data-slot]').forEach(sl => {
        sl.addEventListener('dragover', ev => { if (ctx.canEdit && [...(ev.dataTransfer.types || [])].includes('application/x-lp-sound')) { ev.preventDefault(); sl.classList.add('drop'); } });
        sl.addEventListener('dragleave', () => sl.classList.remove('drop'));
        sl.addEventListener('drop', ev => {
          sl.classList.remove('drop'); if (!ctx.canEdit) return; ev.preventDefault();
          let ref = null; try { ref = JSON.parse(ev.dataTransfer.getData('application/x-lp-sound')); } catch (e) { return; }
          if (addSound(map, target, sl.dataset.slot, ref)) { touch(); drawCanvas(); renderInspector(); }
        });
      });
      wireTransition(box, map, item);
      // Repli sans glisser (tactile, clavier) : le son sélectionné dans la bibliothèque s'ajoute avec le bouton de chaque emplacement.
      box.querySelectorAll('.lm-slot[data-slot]').forEach(sl => {
        if (!ctx.canEdit) return;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.style.marginTop = '4px'; b.textContent = tr('map_addPicked'); b.disabled = !st.picked;
        b.onclick = () => { if (st.picked && addSound(map, target, sl.dataset.slot, st.picked)) { touch(); drawCanvas(); renderInspector(); } };
        sl.appendChild(b);
      });
    }

    // ---- Transition d'entrée (propre à l'élément, sinon celle de la carte)
    const optionsHtml = (list, current, key) => list.map(v => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(tr(key + v))}</option>`).join('');
    function transitionHtml(map, item) {
      const own = cleanTransition(item.transition), eff = resolveTransition(map, item), dis = ctx.canEdit ? '' : ' disabled';
      const stingerHtml = eff.stinger ? `<div class="lm-sound"><span>${eff.stinger.kind === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(eff.stinger.title)}">${esc(eff.stinger.title || eff.stinger.id)}</span>${ctx.canEdit ? `<button class="icon-btn" type="button" id="lmStingerRm" aria-label="${esc(tr('map_removeSound'))}">✕</button>` : ''}</div>` : `<p class="hint" style="margin:0">${esc(tr('map_stingerEmpty'))}</p>`;
      return `<div class="lm-slot" id="lmTrans"><h4>${esc(tr('map_transition'))}</h4>
        <label class="choice" style="display:flex;gap:6px;align-items:center;margin:0 0 6px"><input type="checkbox" id="lmTransOwn" ${own ? 'checked' : ''}${dis} style="width:auto"> ${esc(tr('map_transitionOwn'))}</label>
        ${own ? `<div class="lm-row"><select id="lmTrStyle"${dis}>${optionsHtml(TRANSITION_STYLES, eff.style, 'map_style_')}</select>
          <input type="number" id="lmTrSec" min="0" max="30" step="0.5" value="${eff.sec}"${dis} aria-label="${esc(tr('map_seconds'))}"> <span class="meta">${esc(tr('map_seconds'))}</span></div>
          <div class="lm-row" style="margin-top:6px"><select id="lmTrSync"${dis} aria-label="${esc(tr('map_sync'))}">${optionsHtml(SYNCS, eff.sync, 'map_sync_')}</select></div>
          <div class="lm-slot" id="lmStinger" style="margin-top:8px"><h4>${esc(tr('map_stinger'))}</h4>${stingerHtml}</div>`
        : `<p class="hint" style="margin:0">${esc(tr('map_transitionDefault', { style: tr('map_style_' + eff.style), sec: eff.sec, sync: tr('map_sync_' + eff.sync) }))}</p>`}</div>`;
    }
    function wireTransition(box, map, item) {
      if (!ctx.canEdit) return;
      const own = box.querySelector('#lmTransOwn');
      if (own) own.addEventListener('change', () => {
        if (own.checked) { const eff = resolveTransition(map, item); item.transition = { style: eff.style, sec: eff.sec, sync: eff.sync }; } else item.transition = null;
        touch(); renderInspector();
      });
      const set = (k, v) => { item.transition = Object.assign({}, item.transition || {}, { [k]: v }); touch(); };
      const style = box.querySelector('#lmTrStyle'); if (style) style.onchange = () => set('style', style.value);
      const sec = box.querySelector('#lmTrSec'); if (sec) sec.onchange = () => set('sec', Math.max(0, Math.min(30, Number(sec.value) || 0)));
      const sync = box.querySelector('#lmTrSync'); if (sync) sync.onchange = () => set('sync', sync.value);
      const rm = box.querySelector('#lmStingerRm'); if (rm) rm.onclick = () => { const t = Object.assign({}, item.transition); delete t.stinger; item.transition = t; touch(); renderInspector(); };
      const zone = box.querySelector('#lmStinger');
      if (zone) {
        const setStinger = ref => { item.transition = Object.assign({}, item.transition || {}, { stinger: { kind: ref.kind, id: ref.id, title: ref.title } }); touch(); renderInspector(); };
        zone.addEventListener('dragover', ev => { if ([...(ev.dataTransfer.types || [])].includes('application/x-lp-sound')) { ev.preventDefault(); zone.classList.add('drop'); } });
        zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
        zone.addEventListener('drop', ev => { zone.classList.remove('drop'); ev.preventDefault(); let ref = null; try { ref = JSON.parse(ev.dataTransfer.getData('application/x-lp-sound')); } catch (e) { return; } if (cleanRef(ref)) setStinger(ref); });
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.style.marginTop = '4px'; b.textContent = tr('map_addPicked'); b.disabled = !st.picked;
        b.onclick = () => { if (st.picked) setStinger(st.picked); };
        zone.appendChild(b);
      }
    }

    // ---- Réglages de la carte : fond d'ambiance (room tone) et transition par défaut
    function renderSettings() {
      const box = host.querySelector('#lmSettingsBody'), map = curData();
      if (!box || !map) return;
      const dis = ctx.canEdit ? '' : ' disabled', d = map.defaults.transition;
      const room = map.roomTone;
      box.innerHTML = `<div class="lm-set">
        <div><label>${esc(tr('map_roomTone'))}</label>
          <div class="lm-slot" id="lmRoomZone">${room ? `<div class="lm-sound"><span>${room.kind === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(room.title)}">${esc(room.title || room.id)}</span>${ctx.canEdit ? `<button class="icon-btn" type="button" id="lmRoomRm" aria-label="${esc(tr('map_removeSound'))}">✕</button>` : ''}</div>` : `<p class="hint" style="margin:0">${esc(tr('map_roomToneEmpty'))}</p>`}</div>
          <label>${esc(tr('map_roomToneDb', { db: map.roomToneDb }))}</label><input type="range" id="lmRoomDb" min="-40" max="0" step="1" value="${map.roomToneDb}"${dis}>
          <p class="hint">${esc(tr('map_roomToneHint'))}</p></div>
        <div><label>${esc(tr('map_defaultTransition'))}</label>
          <div class="lm-row"><select id="lmDefStyle"${dis}>${optionsHtml(TRANSITION_STYLES, d.style, 'map_style_')}</select><input type="number" id="lmDefSec" min="0" max="30" step="0.5" value="${d.sec}"${dis} aria-label="${esc(tr('map_seconds'))}"> <span class="meta">${esc(tr('map_seconds'))}</span></div>
          <div class="lm-row" style="margin-top:6px"><select id="lmDefSync"${dis} aria-label="${esc(tr('map_sync'))}">${optionsHtml(SYNCS, d.sync, 'map_sync_')}</select></div>
          <p class="hint" style="margin-top:6px">${esc(tr('map_syncHint'))}</p></div></div>`;
      if (!ctx.canEdit) return;
      const setRoom = ref => { map.roomTone = ref ? { kind: ref.kind, id: ref.id, title: ref.title } : null; touch(); renderSettings(); if (audio && st.play) { audio.setMap(map); audio.resume(); } };
      const rm = box.querySelector('#lmRoomRm'); if (rm) rm.onclick = () => setRoom(null);
      const zone = box.querySelector('#lmRoomZone');
      zone.addEventListener('dragover', ev => { if ([...(ev.dataTransfer.types || [])].includes('application/x-lp-sound')) { ev.preventDefault(); zone.classList.add('drop'); } });
      zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
      zone.addEventListener('drop', ev => { zone.classList.remove('drop'); ev.preventDefault(); let ref = null; try { ref = JSON.parse(ev.dataTransfer.getData('application/x-lp-sound')); } catch (e) { return; } if (cleanRef(ref)) setRoom(ref); });
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.style.marginTop = '4px'; b.textContent = tr('map_addPicked'); b.disabled = !st.picked;
      b.onclick = () => { if (st.picked) setRoom(st.picked); }; zone.appendChild(b);
      const db = box.querySelector('#lmRoomDb');
      db.oninput = () => { map.roomToneDb = Number(db.value); box.querySelector('#lmRoomDb').previousElementSibling.textContent = tr('map_roomToneDb', { db: map.roomToneDb }); if (audio) audio.refreshRoomLevel(); touch(); };
      const setDef = (k, v) => { map.defaults.transition = Object.assign({}, map.defaults.transition, { [k]: v }); touch(); renderInspector(); };
      box.querySelector('#lmDefStyle').onchange = e => setDef('style', e.target.value);
      box.querySelector('#lmDefSec').onchange = e => setDef('sec', Math.max(0, Math.min(30, Number(e.target.value) || 0)));
      box.querySelector('#lmDefSync').onchange = e => setDef('sync', e.target.value);
    }

    // ---- Écouter : se placer sur la carte, déclencher les sons
    const hereIs = (kind, id) => !!(st.play && st.now && st.now.position && st.now.position.kind === kind && st.now.position.id === id);
    function labelOf(map, pos) {
      if (!pos) return '';
      if (pos.kind === 'node') { const n = nodeById(map, pos.id); return n ? (n.label || tr('map_type_' + n.type)) : ''; }
      const e = edgeById(map, pos.id); if (!e) return '';
      return e.label || ((nodeById(map, e.from) || {}).label || '?') + ' → ' + ((nodeById(map, e.to) || {}).label || '?');
    }
    function refreshNow() {
      const box = host.querySelector('#lmNow'), map = curData();
      if (!box) return;
      if (!st.play || !map || !audio) { box.hidden = true; return; }
      box.hidden = false;
      const n = st.now || {}, can = n.position && hasCombatSlot(map, n.position);
      box.innerHTML = n.position
        ? `<span><b>${esc(tr('map_nowAt'))}</b> ${esc(labelOf(map, n.position))}</span><span>♪ ${esc((n.music && n.music.title) || tr('map_nowSilence'))}</span>${n.room ? `<span>🌫 ${esc(n.room.title || n.room.id)}</span>` : ''}
          ${n.pendingAt != null ? `<span class="lm-wait">${esc(tr('map_nowWaiting'))}</span>` : ''}
          ${n.layers > 1 ? `<span class="lm-layers" id="lmLayers"><b>${esc(tr(n.layerKind === 'loops' ? 'map_loops' : 'map_layers'))}</b>
            <button class="btn${n.layerManual ? '' : ' primary'}" type="button" data-layer="auto" title="${esc(tr('map_layerAutoHint'))}">${esc(tr('map_layerAuto'))}</button>${Array.from({ length: n.layers }, (_, i) => `<button class="btn${n.layerManual && n.layerLevel === i ? ' primary' : ''}" type="button" data-layer="${i}" title="${esc(n.layerKind === 'loops' ? ((n.layerLabels && n.layerLabels[i]) || tr('map_loopHint', { n: i + 1 })) : tr('map_layerHint', { n: i + 1 }))}">${n.layerKind === 'loops' && n.layerLabels && n.layerLabels[i] ? esc(n.layerLabels[i].length > 14 ? n.layerLabels[i].slice(0, 13) + '…' : n.layerLabels[i]) : i + 1}</button>`).join('')}
            <span class="lm-wait">${esc(n.layerKind === 'loops' ? ((n.layerLabels && n.layerLabels[n.layerLevel || 0]) || tr('map_loopHint', { n: (n.layerLevel || 0) + 1 })) : tr('map_layerNow', { n: (n.layerLevel || 0) + 1, total: n.layers }))}${n.fallback ? ' · ' + esc(tr(n.layerKind === 'loops' ? 'map_loopFallback' : 'map_layerFallback')) : ''}</span></span>` : ''}
          <button class="btn${n.combat ? ' primary' : ''}" type="button" id="lmCombat" ${can ? '' : 'disabled'}>${esc(tr(n.combat ? 'map_combatOn' : 'map_combat'))}</button>
          <button class="btn" type="button" id="lmStopPlay">${esc(tr(n.playing ? 'map_pause' : 'map_resume'))}</button>`
        : `<span>${esc(tr('map_playHint'))}</span>`;
      box.querySelectorAll('[data-layer]').forEach(b => { b.onclick = () => { audio.setIntensity(b.dataset.layer === 'auto' ? null : +b.dataset.layer); host.querySelector('#lmCanvas').focus(); }; });
      const c = box.querySelector('#lmCombat'); if (c) c.onclick = () => { audio.setCombat(!n.combat); host.querySelector('#lmCanvas').focus(); };
      const sp = box.querySelector('#lmStopPlay'); if (sp) sp.onclick = () => { if (n.playing) audio.stop(1); else audio.resume(); };
    }
    function startFromSelection() {
      const map = curData(); if (!map) return Promise.resolve(null);
      const target = st.sel || (map.nodes.find(x => x.type === 'start') ? { kind: 'node', id: map.nodes.find(x => x.type === 'start').id } : map.nodes[0] ? { kind: 'node', id: map.nodes[0].id } : null);
      if (!target) return Promise.resolve(null);
      st.sel = target; drawCanvas(); renderInspector();
      return audio.goTo(target);
    }
    function togglePlay(on) {
      if (!audio) return;
      if (!on) { audio.stop(1); st.now = null; }
      st.play = !!on; st.connecting = false; st.linkFrom = null;
      render();
      // On se place tout de suite : sur l'élément sélectionné, à défaut sur le Début de la carte (puis flèches, clic, Espace, C).
      if (on) { audio.setMap(curData()); const c = host.querySelector('#lmCanvas'); if (c) c.focus(); startFromSelection(); }
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
    return { flush, state: st, render, audio, destroy() { clearTimeout(saveTimer); host.onkeydown = null; if (audio) audio.stop(0.2); } };
  }

  window.LayerPitchLevelMap = { model, mount };
})();
