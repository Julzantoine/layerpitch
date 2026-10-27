// projet-carte.js — LayerPitch, Carte de niveau d'un Projet (6 octobre ; migration 20261006020000).
// On dessine un niveau (début, lieux, quêtes, boss, PNJ, trésors, parcours), puis on y dépose des sons de la bibliothèque.
//   window.LayerPitchLevelMap.model   : fonctions pures (testées dans test_carte_de_niveau.js) -- aucune dépendance à la page
//   window.LayerPitchLevelMap.mount() : l'éditeur (SVG : éléments déplaçables, parcours, zoom, dépôt de sons), utilisé par projet.html
// Document d'une carte : { nodes: [{ id, type, label, x, y, note, side, anchor, sounds: { main: [ref], combat: [ref] } }],
//                          edges: [{ id, from, to, label, enemy, sounds }] }   ref = { kind: 'track'|'sfx'|'asset', id, title }
// Monde ouvert (27/10, migration 20261027010000) : zones (surfaces dessinées, chacune avec sa musique), modes de déplacement (à pied,
// cheval… avec une musique facultative), image de fond, et sous-cartes (un élément ou une zone « mène à » une autre carte du Projet).
//   zones: [{ id, label, note, shape: 'rect'|'ellipse'|'poly', x, y, w, h, points: [{ x, y }], color, keepMusic, sounds, transition, link }]
//   modes: [{ id, label, speed, sounds, transition }]   background: { kind: 'asset', id, title, x, y, w, h, opacity } | null
//   node.link / zone.link = id d'une autre carte du Projet ; node.radius = rayon du cercle de proximité (balade libre)
(function () {
  const NODE_TYPES = ['start', 'place', 'quest', 'boss', 'npc', 'treasure', 'junction', 'transition']; // junction = point de passage sur un parcours, d'où d'autres itinéraires peuvent partir
  const SLOTS = ['main', 'combat', 'room'];
  const TRANSITION_STYLES = ['crossfade', 'cut', 'fadeout'];
  const SYNCS = ['immediate', 'beat', 'bar', 'bars2', 'bars4'];
  const DEFAULT_TRANSITION = { style: 'crossfade', sec: 2, sync: 'bar' };
  const DEFAULT_ROOM_DB = -14;
  const MAX_SOUNDS = 12;
  const MAX_NODES = 300, MAX_EDGES = 600;
  const GLYPH = { start: '▶', place: '⌂', quest: '!', boss: '☠', npc: '☺', treasure: '◆', junction: '•', transition: '⇢' };
  const ZONE_SHAPES = ['rect', 'ellipse', 'poly'];
  const ZONE_COLORS = ['#2f80c0', '#3c9a5f', '#b8862e', '#b5442e', '#7a5cc0', '#5f6b7a'];
  const MAX_ZONES = 100, MAX_ZONE_POINTS = 64, MAX_MODES = 8;
  const DEFAULT_RADIUS = 90, MIN_RADIUS = 20, MAX_RADIUS = 2000;
  const DEFAULT_SPEED = 140, MIN_SPEED = 20, MAX_SPEED = 1500; // vitesse de la balade libre, en unités de carte par seconde
  // Allures proposées quand on ajoute un mode de déplacement (le nom reste modifiable) : clé de traduction + vitesse.
  const MODE_PRESETS = [{ key: 'walk', speed: 140 }, { key: 'run', speed: 240 }, { key: 'horse', speed: 420 }, { key: 'glider', speed: 320 }, { key: 'boat', speed: 220 }];
  const MAP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  // ---------------------------------------------------------------- Modèle (fonctions pures)
  let idSeq = 0;
  const newId = prefix => prefix + Date.now().toString(36) + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 5);
  const emptyMap = () => ({ nodes: [], edges: [], zones: [], modes: [], background: null, roomTone: null, roomToneDb: DEFAULT_ROOM_DB, defaults: { transition: Object.assign({}, DEFAULT_TRANSITION) } });
  const nodeById = (map, id) => map.nodes.find(n => n.id === id) || null;
  const edgeById = (map, id) => map.edges.find(e => e.id === id) || null;
  const zoneById = (map, id) => (map.zones || []).find(z => z.id === id) || null;
  const modeById = (map, id) => (map.modes || []).find(m => m.id === id) || null;

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
  function splitEdge(map, edgeId, x, y, type) {
    const e = edgeById(map, edgeId), g = e && edgeGeometry(map, e);
    if (!e || !g || map.nodes.length >= MAX_NODES || map.edges.length + 1 > MAX_EDGES) return null;
    const ts = projectOnEdge(map, edgeId, x, y);
    const node = { id: newId('n'), type: type === 'transition' ? 'transition' : 'junction', label: '', x: Math.round(g.p1.x + (g.p2.x - g.p1.x) * ts), y: Math.round(g.p1.y + (g.p2.y - g.p1.y) * ts), note: '', sounds: { main: [], combat: [], room: [] }, transition: null };
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
    if (target && (target.type === 'junction' || target.type === 'transition')) {
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
  // Ce qui peut porter des sons : un élément, un parcours, une zone ou un mode de déplacement.
  const targetOf = (map, t) => (!t ? null : t.kind === 'edge' ? edgeById(map, t.id) : t.kind === 'zone' ? zoneById(map, t.id) : t.kind === 'mode' ? modeById(map, t.id) : nodeById(map, t.id));
  // Une 2e musique (emplacement interne « combat ») est possible sur n'importe quel élément ou parcours (8/10 : une seule musique par
  // défaut, une 2e facultative) ; hasAltMusic : elle existe vraiment (au moins un son posé), donc on peut y basculer pendant la balade.
  function hasCombatSlot(map, t) { return !!targetOf(map, t); }
  function hasAltMusic(map, t) { const item = targetOf(map, t); return !!(item && item.sounds && item.sounds.combat && item.sounds.combat.length); }
  const altNameOf = item => (item && item.altName) || '';
  // Nom de la 2e musique (60 caractères au plus) et son de transition entre les deux musiques (un seul son).
  function setAltName(map, t, name) {
    const item = targetOf(map, t); if (!item) return false;
    const v = String(name == null ? '' : name).trim().slice(0, 60);
    if (v) item.altName = v; else delete item.altName;
    return true;
  }
  function setAltTransition(map, t, ref) {
    const item = targetOf(map, t); if (!item) return false;
    const c = ref ? cleanRef(ref) : null;
    if (ref && !c) return false;
    if (c) item.altTransition = c; else delete item.altTransition;
    return true;
  }
  function clearAlt(map, t) {
    const item = targetOf(map, t); if (!item) return false;
    if (item.sounds) item.sounds.combat = [];
    delete item.altName; delete item.altTransition;
    return true;
  }
  function addSound(map, t, slot, ref) {
    const item = targetOf(map, t);
    if (slot === 'altTransition') return item ? setAltTransition(map, t, ref) && !!item.altTransition : false;
    if (!item || !SLOTS.includes(slot) || !ref || !['track', 'sfx', 'asset'].includes(ref.kind) || !ref.id) return false;
    item.sounds = item.sounds || { main: [], combat: [] };
    const list = item.sounds[slot] = item.sounds[slot] || [];
    if (slot === 'room') list.length = 0; // un seul fond d'ambiance propre à l'élément : le nouveau remplace l'ancien
    if (list.length >= MAX_SOUNDS || list.some(r => r.kind === ref.kind && r.id === ref.id)) return false;
    list.push({ kind: ref.kind, id: String(ref.id), title: String(ref.title || '').slice(0, 120) });
    return true;
  }
  function removeSound(map, t, slot, index) {
    const item = targetOf(map, t);
    if (slot === 'altTransition') { if (!item || !item.altTransition) return false; delete item.altTransition; return true; }
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
  // ---------------------------------------------------------------- Monde ouvert : zones (fonctions pures)
  const snap = v => Math.round(v / 10) * 10;
  const emptySounds = () => ({ main: [], combat: [], room: [] });
  function nextZoneColor(map) {
    const used = (map.zones || []).map(z => z.color);
    return ZONE_COLORS.find(c => !used.includes(c)) || ZONE_COLORS[(map.zones || []).length % ZONE_COLORS.length];
  }
  // Rectangle ou ovale : (x, y) = coin haut-gauche du cadre, w × h = sa taille.
  function addZone(map, shape, x, y, w, h, label) {
    map.zones = map.zones || [];
    if (!['rect', 'ellipse'].includes(shape) || map.zones.length >= MAX_ZONES) return null;
    const zone = { id: newId('z'), label: label || '', note: '', shape, x: snap(x), y: snap(y), w: Math.max(40, snap(w || 320)), h: Math.max(40, snap(h || 200)),
      color: nextZoneColor(map), keepMusic: false, sounds: emptySounds(), transition: null };
    map.zones.push(zone);
    return zone;
  }
  // Forme libre : le contour cliqué point par point (3 points au moins).
  function addPolyZone(map, points, label) {
    map.zones = map.zones || [];
    const pts = (points || []).filter(p => p && Number.isFinite(+p.x) && Number.isFinite(+p.y)).slice(0, MAX_ZONE_POINTS).map(p => ({ x: Math.round(+p.x), y: Math.round(+p.y) }));
    if (pts.length < 3 || map.zones.length >= MAX_ZONES || polyArea(pts) < 100) return null;
    const zone = { id: newId('z'), label: label || '', note: '', shape: 'poly', points: pts, color: nextZoneColor(map), keepMusic: false, sounds: emptySounds(), transition: null };
    map.zones.push(zone);
    return zone;
  }
  function removeZone(map, id) { map.zones = (map.zones || []).filter(z => z.id !== id); }
  function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y); return Math.abs(a / 2); }
  function zoneArea(z) {
    if (z.shape === 'poly') return polyArea(z.points || []);
    return z.shape === 'ellipse' ? Math.PI * (z.w / 2) * (z.h / 2) : z.w * z.h;
  }
  function zoneBounds(z) {
    if (z.shape !== 'poly') return { minX: z.x, minY: z.y, maxX: z.x + z.w, maxY: z.y + z.h };
    const xs = (z.points || []).map(p => p.x), ys = (z.points || []).map(p => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  function zoneCenter(z) { const b = zoneBounds(z); return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; }
  function zoneContains(z, x, y) {
    if (z.shape === 'rect') return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
    if (z.shape === 'ellipse') { const rx = z.w / 2, ry = z.h / 2, dx = (x - z.x - rx) / rx, dy = (y - z.y - ry) / ry; return dx * dx + dy * dy <= 1; }
    const p = z.points || []; let inside = false; // lancer de rayon
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
    }
    return inside;
  }
  // Zones qui contiennent le point, de la plus intérieure (la plus petite) à la plus large : un village dans une forêt passe avant elle.
  function zonesAt(map, x, y) {
    return (map.zones || []).filter(z => zoneContains(z, x, y)).map(z => ({ z, a: zoneArea(z) })).sort((a, b) => a.a - b.a).map(o => o.z);
  }
  function moveZone(z, dx, dy) {
    if (z.shape === 'poly') z.points.forEach(p => { p.x = Math.round(p.x + dx); p.y = Math.round(p.y + dy); });
    else { z.x = Math.round(z.x + dx); z.y = Math.round(z.y + dy); }
  }
  // Coin tiré (nw, ne, sw, se) jusqu'au point (x, y) : le coin opposé reste en place ; 40 de côté au moins.
  function resizeZone(z, corner, x, y) {
    if (z.shape === 'poly') return false;
    const right = z.x + z.w, bottom = z.y + z.h;
    if (corner.includes('w')) { const nx = Math.min(snap(x), right - 40); z.w = right - nx; z.x = nx; } else z.w = Math.max(40, snap(x) - z.x);
    if (corner.includes('n')) { const ny = Math.min(snap(y), bottom - 40); z.h = bottom - ny; z.y = ny; } else z.h = Math.max(40, snap(y) - z.y);
    return true;
  }
  function moveZonePoint(z, i, x, y) { if (z.shape !== 'poly' || !z.points[i]) return false; z.points[i] = { x: snap(x), y: snap(y) }; return true; }
  // Ajouter un point à une forme libre, sur le côté le plus proche de (x, y) ; retirer un point (3 au moins restent).
  function insertZonePoint(z, x, y) {
    if (z.shape !== 'poly' || z.points.length >= MAX_ZONE_POINTS) return -1;
    let best = 0, bestD = Infinity;
    z.points.forEach((p, i) => {
      const q = z.points[(i + 1) % z.points.length], dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / l2)), d = Math.hypot(p.x + dx * t - x, p.y + dy * t - y);
      if (d < bestD) { bestD = d; best = i + 1; }
    });
    z.points.splice(best, 0, { x: snap(x), y: snap(y) });
    return best;
  }
  function removeZonePoint(z, i) { if (z.shape !== 'poly' || z.points.length <= 3 || !z.points[i]) return false; z.points.splice(i, 1); return true; }
  const hasZones = map => !!(map && map.zones && map.zones.length);

  // ---------------------------------------------------------------- Monde ouvert : cercles de proximité, modes de déplacement
  // Un élément « lieu » (pas un point de passage ni une transition) a un cercle : y entrer, c'est arriver à cet élément.
  const hasCircle = n => !!n && n.type !== 'junction' && n.type !== 'transition';
  const radiusOf = n => (Number.isFinite(+n.radius) && n.radius !== null && n.radius !== '' ? Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, +n.radius)) : DEFAULT_RADIUS);
  function setRadius(map, nodeId, r) { const n = nodeById(map, nodeId); if (!hasCircle(n)) return false; n.radius = Math.round(Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Number(r) || DEFAULT_RADIUS))); return true; }
  // Éléments dont le cercle contient le point, du plus proche au plus lointain.
  function circlesAt(map, x, y) {
    return map.nodes.filter(hasCircle).map(n => ({ n, d: Math.hypot(n.x - x, n.y - y) })).filter(o => o.d <= radiusOf(o.n)).sort((a, b) => a.d - b.d).map(o => o.n);
  }
  // Modes de déplacement de la carte ; sans mode créé, un seul « à pied » implicite (id null, sans musique).
  const modesOf = map => ((map && map.modes && map.modes.length) ? map.modes : [{ id: null, label: '', preset: 'walk', speed: DEFAULT_SPEED, sounds: emptySounds(), transition: null }]);
  function addMode(map, label, speed) {
    map.modes = map.modes || [];
    if (map.modes.length >= MAX_MODES) return null;
    const mode = { id: newId('m'), label: String(label || '').slice(0, 60), speed: Math.round(Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(speed) || DEFAULT_SPEED))), sounds: emptySounds(), transition: null };
    map.modes.push(mode);
    return mode;
  }
  // L'allure suivante à proposer (à pied, course, cheval…), d'après les noms déjà pris.
  function nextModePreset(map, labelOf) {
    const taken = (map.modes || []).map(m => (m.label || '').toLowerCase());
    return MODE_PRESETS.find(p => !taken.includes(String(labelOf(p.key)).toLowerCase())) || { key: null, speed: DEFAULT_SPEED };
  }
  function removeMode(map, id) { map.modes = (map.modes || []).filter(m => m.id !== id); }
  const speedOf = (map, modeId) => { const m = modeById(map, modeId) || modesOf(map)[0]; return Math.max(MIN_SPEED, Math.min(MAX_SPEED, +m.speed || DEFAULT_SPEED)); };
  const hasMain = item => !!(item && item.sounds && item.sounds.main && item.sounds.main.length);
  const hasAlt = item => !!(item && item.sounds && item.sounds.combat && item.sounds.combat.length);
  // Qui joue à un point de la balade libre (décision du 27/10) : le cercle d'un élément, puis la musique du mode de déplacement, puis la
  // zone la plus intérieure. Une zone cochée « garder sa musique même en monture » (un village) passe devant le mode. En combat, le
  // premier de cette chaîne qui a une 2e musique ; si aucun n'en a, la musique ordinaire. Rend { kind, id } ou null (rien ne joue).
  function governorAt(map, x, y, modeId, combat) {
    const zones = zonesAt(map, x, y), mode = modeById(map, modeId);
    const chain = circlesAt(map, x, y).map(n => ({ kind: 'node', id: n.id, item: n }));
    // Le mode passe devant les zones, sauf si la zone la plus intérieure qui a une musique demande à la garder.
    const zoneMusic = zones.find(hasMain);
    if (mode && hasMain(mode) && !(zoneMusic && zoneMusic.keepMusic)) chain.push({ kind: 'mode', id: mode.id, item: mode });
    zones.forEach(z => chain.push({ kind: 'zone', id: z.id, item: z }));
    if (combat) { const c = chain.find(o => hasAlt(o.item)); if (c) return { kind: c.kind, id: c.id }; }
    const m = chain.find(o => hasMain(o.item));
    return m ? { kind: m.kind, id: m.id } : null;
  }
  // Fond d'ambiance à un point : celui du cercle d'élément, sinon de la zone la plus intérieure qui en a un, sinon celui de la carte.
  function roomAt(map, x, y) {
    const room = item => (item && item.sounds && item.sounds.room && item.sounds.room[0]) || null;
    const n = circlesAt(map, x, y).find(room); if (n) return room(n);
    const z = zonesAt(map, x, y).find(room); if (z) return room(z);
    return map.roomTone || null;
  }

  // ---------------------------------------------------------------- Sous-cartes
  function setLink(map, t, mapId) {
    const item = t && (t.kind === 'zone' ? zoneById(map, t.id) : t.kind === 'node' ? nodeById(map, t.id) : null);
    if (!item || (mapId && !MAP_ID_RE.test(String(mapId)))) return false;
    if (mapId) item.link = String(mapId); else delete item.link;
    return true;
  }
  // Ce qui mène à une sous-carte à un point de la balade libre : un cercle d'élément relié, sinon la zone reliée la plus intérieure.
  function linkAt(map, x, y, knownIds) {
    const ok = item => !!(item && item.link && (!knownIds || knownIds.includes(item.link)));
    const n = circlesAt(map, x, y).find(ok); if (n) return { kind: 'node', id: n.id, mapId: n.link };
    const z = zonesAt(map, x, y).find(ok); if (z) return { kind: 'zone', id: z.id, mapId: z.link };
    return null;
  }
  // Fil d'Ariane (Monde › Château › Donjon) : entrer dans une carte déjà dans le fil y ramène au lieu de l'empiler (pas de boucle A → B → A).
  //   trail = [{ mapId, from: { kind, id }, at: { x, y } | null }] -- chaque entrée : la carte quittée et d'où l'on en est sorti.
  function trailEnter(trail, currentId, from, at, targetId) {
    const i = trail.findIndex(s => s.mapId === targetId);
    if (i >= 0) return { trail: trail.slice(0, i), back: trail[i] };
    if (targetId === currentId) return { trail: trail.slice(), back: null };
    return { trail: trail.concat([{ mapId: currentId, from: from || null, at: at || null }]), back: null };
  }

  // Bilan d'une carte : combien de sons posés, d'éléments sans son.
  function summary(map) {
    const items = map.nodes.map(n => ({ n, s: n.sounds })).concat(map.edges.map(e => ({ n: e, s: e.sounds })));
    let sounds = 0, silent = 0;
    items.forEach(({ s }) => { const c = ((s && s.main) || []).length + ((s && s.combat) || []).length; sounds += c; if (!c) silent++; });
    (map.zones || []).forEach(z => { sounds += ((z.sounds && z.sounds.main) || []).length + ((z.sounds && z.sounds.combat) || []).length; });
    return { nodes: map.nodes.length, edges: map.edges.length, zones: (map.zones || []).length, sounds, silent };
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
  // 2e musique : nom et son de transition, seulement s'ils existent (une carte sans 2e musique garde exactement sa forme d'avant).
  function altFields(o) {
    const out = {}, name = String((o && o.altName) || '').trim().slice(0, 60), tr0 = cleanRef(o && o.altTransition);
    if (name) out.altName = name;
    if (tr0) out.altTransition = tr0;
    return out;
  }
  // Sous-carte (link) et rayon du cercle de proximité (radius, éléments seulement) : gardés seulement s'ils existent.
  function openWorldFields(o, withRadius) {
    const out = {};
    if (o && o.link && MAP_ID_RE.test(String(o.link))) out.link = String(o.link);
    if (withRadius && o && o.radius != null && Number.isFinite(Number(o.radius))) out.radius = Math.round(Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Number(o.radius))));
    return out;
  }
  function normalize(raw) {
    const map = emptyMap();
    ((raw && raw.nodes) || []).forEach(n => {
      if (!n || !NODE_TYPES.includes(n.type)) return;
      map.nodes.push({ id: String(n.id), type: n.type, label: n.label || '', x: Number(n.x) || 0, y: Number(n.y) || 0, note: n.note || '',
        side: !!n.side, anchor: n.anchor || null, sounds: cleanSounds(n.sounds), transition: cleanTransition(n.transition), ...altFields(n), ...openWorldFields(n, true) });
    });
    ((raw && raw.zones) || []).forEach(z => {
      if (!z || !ZONE_SHAPES.includes(z.shape) || map.zones.length >= MAX_ZONES) return;
      const base = { id: String(z.id), label: String(z.label || '').slice(0, 120), note: String(z.note || '').slice(0, 2000), shape: z.shape,
        color: ZONE_COLORS.includes(z.color) ? z.color : ZONE_COLORS[map.zones.length % ZONE_COLORS.length], keepMusic: !!z.keepMusic,
        sounds: cleanSounds(z.sounds), transition: cleanTransition(z.transition), ...altFields(z), ...openWorldFields(z, false) };
      if (z.shape === 'poly') {
        const pts = (z.points || []).filter(p => p && Number.isFinite(+p.x) && Number.isFinite(+p.y)).slice(0, MAX_ZONE_POINTS).map(p => ({ x: Math.round(+p.x), y: Math.round(+p.y) }));
        if (pts.length < 3) return;
        map.zones.push(Object.assign(base, { points: pts }));
      } else {
        const w = Number(z.w), h = Number(z.h);
        if (!(w > 0 && h > 0)) return;
        map.zones.push(Object.assign(base, { x: Number(z.x) || 0, y: Number(z.y) || 0, w, h }));
      }
    });
    ((raw && raw.modes) || []).forEach(m => {
      if (!m || !m.id || map.modes.length >= MAX_MODES) return;
      map.modes.push({ id: String(m.id), label: String(m.label || '').slice(0, 60), speed: Math.round(Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(m.speed) || DEFAULT_SPEED))),
        sounds: cleanSounds(m.sounds), transition: cleanTransition(m.transition) });
    });
    const bg = raw && raw.background, bgRef = cleanRef(bg);
    if (bgRef && bgRef.kind === 'asset' && Number(bg.w) > 0 && Number(bg.h) > 0) {
      map.background = Object.assign(bgRef, { x: Number(bg.x) || 0, y: Number(bg.y) || 0, w: Number(bg.w), h: Number(bg.h),
        opacity: Number.isFinite(Number(bg.opacity)) && bg.opacity !== null ? Math.max(0.1, Math.min(1, Number(bg.opacity))) : 1 });
    }
    ((raw && raw.edges) || []).forEach(e => {
      if (!e || !nodeById(map, e.from) || !nodeById(map, e.to)) return;
      map.edges.push({ id: String(e.id), from: e.from, to: e.to, label: e.label || '', enemy: !!e.enemy, sounds: cleanSounds(e.sounds), transition: cleanTransition(e.transition), ...altFields(e) });
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
  const itemOf = targetOf;
  function pointOf(map, t) {
    if (t.kind === 'node') { const n = nodeById(map, t.id); return n ? { x: n.x, y: n.y } : null; }
    if (t.kind === 'zone') { const z = zoneById(map, t.id); return z ? zoneCenter(z) : null; }
    if (t.kind === 'mode') return null;
    const e = edgeById(map, t.id), g = e && edgeGeometry(map, e);
    return g ? g.mid : null;
  }
  // Voisins d'une position : un élément touche ses parcours (et les quêtes annexes accrochées à lui) ; un parcours touche ses deux
  // extrémités (et les quêtes accrochées à lui) ; une quête annexe touche ce à quoi elle est accrochée.
  function neighbors(map, t) {
    const out = [], add = x => { if (x && !out.some(o => o.kind === x.kind && o.id === x.id) && itemOf(map, x)) out.push(x.via ? { kind: x.kind, id: x.id, via: x.via } : { kind: x.kind, id: x.id }); };
    if (t.kind === 'node') {
      const n = nodeById(map, t.id); if (!n) return out;
      map.edges.forEach(e => { if (e.from === n.id || e.to === n.id) add({ kind: 'edge', id: e.id }); });
      if (n.anchor) add(n.anchor);
      map.nodes.forEach(q => { if (q.anchor && q.anchor.kind === 'node' && q.anchor.id === n.id) add({ kind: 'node', id: q.id }); });
    } else {
      const e = edgeById(map, t.id); if (!e) return out;
      // Un nœud « Transition » n'est jamais un endroit où l'on s'arrête : on le traverse, et on arrive sur le parcours d'après (via : le
      // nœud franchi, dont le lecteur joue le fichier de transition).
      [e.from, e.to].forEach(id => {
        const end = nodeById(map, id);
        if (end && end.type === 'transition') map.edges.forEach(e2 => { if (e2.id !== e.id && (e2.from === id || e2.to === id)) add({ kind: 'edge', id: e2.id, via: [id] }); });
        else add({ kind: 'node', id });
      });
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
    setEnemy, hasCombatSlot, hasAltMusic, altNameOf, setAltName, setAltTransition, clearAlt, anchorChoices, borderPoint, edgeGeometry, anchorPoint, projectOnEdge, anchorQuestToEdge, splitEdge, summary,
    // Monde ouvert et sous-cartes (27/10)
    ZONE_SHAPES, ZONE_COLORS, MODE_PRESETS, DEFAULT_RADIUS, DEFAULT_SPEED, targetOf, zoneById, modeById, addZone, addPolyZone, removeZone, zoneArea, zoneBounds, zoneCenter, zoneContains, zonesAt,
    moveZone, resizeZone, moveZonePoint, insertZonePoint, removeZonePoint, hasZones, hasCircle, radiusOf, setRadius, circlesAt, modesOf, addMode, nextModePreset, removeMode, speedOf,
    governorAt, roomAt, setLink, linkAt, trailEnter };

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
      .lm-alt { border-left: 3px solid var(--accent-soft, #e4eef8); padding-left: 10px; margin: 8px 0; } .lm-alt input[type=text] { width: 100%; box-sizing: border-box; margin-bottom: 4px; }
      .lm-now .btn.pending { outline: 2px dashed var(--accent); outline-offset: 1px; }
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
      .lm-sep { display: inline-block; width: 1px; height: 22px; background: var(--border); margin: 0 4px; }
      .lm-zone .lm-zshape { fill: var(--lm-zc); fill-opacity: .13; stroke: var(--lm-zc); stroke-width: 2; cursor: move; vector-effect: non-scaling-stroke; }
      .lm-canvas.playing .lm-zone .lm-zshape { cursor: pointer; }
      .lm-zone.sel .lm-zshape { stroke-width: 3.5; stroke-dasharray: 8 4; } .lm-zone.here .lm-zshape { fill-opacity: .3; stroke-width: 3.5; }
      .lm-zone.drop .lm-zshape { stroke: var(--accent); stroke-width: 4; fill-opacity: .25; }
      .lm-zlabel { font-family: var(--font-body); font-size: 13px; font-weight: 600; fill: var(--lm-zc); pointer-events: none; }
      .lm-handle { fill: var(--bg-card, #fff); stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; cursor: nwse-resize; }
      .lm-handle[data-zv] { cursor: grab; } .lm-handle.first { fill: var(--accent); }
      .lm-circle { fill: var(--accent); fill-opacity: .04; stroke: var(--accent); stroke-opacity: .45; stroke-width: 1.4; stroke-dasharray: 5 5; pointer-events: none; vector-effect: non-scaling-stroke; }
      .lm-circle.sel { stroke-opacity: .9; } .lm-circle.here { fill-opacity: .14; stroke-opacity: 1; stroke-dasharray: none; }
      .lm-draw { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; pointer-events: none; }
      .lm-bg { pointer-events: none; } .lm-bg.edit { pointer-events: auto; cursor: move; }
      .lm-bg-frame { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 8 4; vector-effect: non-scaling-stroke; cursor: move; pointer-events: stroke; }
      .lm-bg-missing { fill: var(--border); fill-opacity: .3; pointer-events: none; }
      .lm-door { font-size: 13px; pointer-events: none; }
      .lm-avatar circle { fill: var(--accent); stroke: #fff; stroke-width: 3; } .lm-avatar .lm-avatar-core { fill: #fff; stroke: none; }
      .lm-dest circle { fill: none; stroke: var(--accent); stroke-width: 2; } .lm-dest path { stroke: var(--accent); stroke-width: 2; }
      .lm-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 13px; }
      .lm-crumb { background: none; border: 0; padding: 2px 4px; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
      .lm-swatches { display: flex; gap: 6px; margin: 4px 0 8px; } .lm-swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
      .lm-swatch.on { border-color: var(--text); } .lm-mode { border: 1px solid var(--border); border-radius: 8px; padding: 8px; margin: 6px 0; }
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
  // Place libre la plus proche du centre de la vue (anneaux autour du centre) : les nouveaux éléments ne se posent plus les uns sur les autres.
  function freeSpot(map, cx, cy) {
    const clash = (x, y) => map.nodes.some(n => Math.abs(n.x - x) < 150 && Math.abs(n.y - y) < 56);
    for (let ring = 0; ring < 8; ring++) {
      const steps = ring === 0 ? 1 : ring * 6, rad = ring * 100;
      for (let i = 0; i < steps; i++) {
        const a = (2 * Math.PI * i) / steps - Math.PI / 2;
        const x = Math.round((cx + rad * 1.5 * Math.cos(a)) / 10) * 10, y = Math.round((cy + rad * 0.8 * Math.sin(a)) / 10) * 10;
        if (!clash(x, y)) return { x, y };
      }
    }
    return { x: Math.round(cx / 10) * 10, y: Math.round(cy / 10) * 10 };
  }
  function mount(host, ctx) {
    ensureStyle();
    const tr = ctx.tr;
    const ask = ctx.ask || ((m, v) => askText(m, v, { ok: tr('map_ok'), cancel: tr('map_cancel') }));
    const confirmDlg = ctx.confirm || (m => window.LayerPitchNotify.confirm(m, { okLabel: tr('map_delete'), danger: true }));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const st = { maps: ctx.maps.map(m => ({ id: m.id, title: m.title, data: normalize(m.data) })), current: null, sel: null, view: { x: 0, y: 0, k: 1 }, connecting: false, linkFrom: null,
      libTab: 'track', libQuery: '', status: '', dirty: false, play: false, now: null,
      // Monde ouvert (27/10) : fil d'Ariane des sous-cartes, forme libre en cours de dessin, réglage de l'image de fond, balade libre.
      trail: [], drawing: null, bgEdit: false, avatar: null, dest: null, modeId: null, freeCombat: false, gov: null };
    st.current = st.maps.length ? (st.maps.some(m => m.id === ctx.openId) ? ctx.openId : st.maps[0].id) : null; // openId : carte à ouvrir d'emblée (lien depuis une section)
    let saveTimer = null, saving = false;
    // Lecture (Écouter) : seulement si la page fournit le moteur audio (ctx.audio = { voiceFactory, now, schedule }).
    const audio = ctx.audio && window.LayerPitchLevelMapAudio ? window.LayerPitchLevelMapAudio.createPlayer(Object.assign({}, ctx.audio, { onChange: s => { st.now = s; refreshNow(); drawCanvas(); } })) : null;
    const cur = () => st.maps.find(m => m.id === st.current) || null;
    const curData = () => { const m = cur(); return m ? m.data : null; };
    const mapTitle = id => { const m = st.maps.find(x => x.id === id); return m ? (m.title || tr('map_untitled')) : tr('map_linkMissing'); };
    const savedMapIds = () => st.maps.filter(m => !m.isNew).map(m => m.id);
    const freeWalk = () => st.play && hasZones(curData());

    // Dépôt d'un son : depuis la bibliothèque de gauche (glisser), ou un fichier audio de l'ordinateur (envoyé par la page, qui en fait un
    // objet « fichier du Projet » rangé comme les autres ; la carte n'en garde que la référence).
    const AUDIO_FILE = f => /^audio\//.test(f.type) || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(f.name);
    const dragTypes = ev => [...((ev.dataTransfer && ev.dataTransfer.types) || [])];
    const acceptsSound = ev => dragTypes(ev).includes('application/x-lp-sound') || (!!ctx.uploadSound && dragTypes(ev).includes('Files'));
    // Lit le dépôt SANS attendre (les données ne sont lisibles que pendant l'événement) et appelle fn avec les références : tout de suite pour
    // un son de la bibliothèque, après l'envoi pour des fichiers de l'ordinateur.
    function withDroppedRefs(ev, fn) {
      const raw = ev.dataTransfer.getData('application/x-lp-sound');
      if (raw) { let ref = null; try { ref = JSON.parse(raw); } catch (e) { return; } fn([ref]); return; }
      const files = [...((ev.dataTransfer && ev.dataTransfer.files) || [])].filter(AUDIO_FILE);
      if (!files.length || !ctx.uploadSound) { if (dragTypes(ev).includes('Files')) setStatus(tr('map_dropAudioOnly')); return; }
      (async () => {
        const out = [];
        for (const f of files) {
          setStatus(tr('map_uploading', { name: f.name }));
          const r = await ctx.uploadSound(f);
          if (!r || r.error || !r.ref) { setStatus(tr('map_saveError', { message: (r && r.error) || f.name })); continue; }
          out.push(r.ref);
        }
        if (out.length) { setStatus(tr('map_uploaded', { n: out.length })); fn(out); }
      })();
    }
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
          ${cur() && ctx.canEdit ? `<button class="btn" id="lmRename" type="button">${esc(tr('map_rename'))}</button>${ctx.downloadFiles ? `<button class="btn" id="lmDownload" type="button" title="${esc(tr('map_downloadHint'))}">⬇ ${esc(tr('map_download'))}</button>` : ''}${ctx.linkSections ? `<button class="btn" id="lmLinkSec" type="button" title="${esc(tr('map_linkSectionsHint'))}">🗂 ${esc(tr('map_linkSections'))}${ctx.linkedNames && ctx.linkedNames(cur()) ? ' · ' + esc(ctx.linkedNames(cur())) : ''}</button>` : ''}<button class="btn danger" id="lmDelete" type="button">${esc(tr('map_delete'))}</button>` : ''}
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
          ${st.trail.length ? `<nav class="lm-crumbs" aria-label="${esc(tr('map_crumbs'))}">${st.trail.map((c, i) => `<button type="button" class="lm-crumb" data-crumb="${i}">${esc(mapTitle(c.mapId))}</button><span aria-hidden="true">›</span>`).join('')}<b>${esc(mapTitle(st.current))}</b>${st.play ? '' : `<button type="button" class="btn" id="lmCrumbBack" style="margin-left:auto">↩ ${esc(tr('map_exitTo', { title: mapTitle(st.trail[st.trail.length - 1].mapId) }))}</button>`}</nav>` : ''}
          <div class="lm-now" id="lmNow" hidden></div>
          <div class="lm-toolbar">${audio ? `<button class="btn${st.play ? ' primary' : ''}" id="lmPlay" type="button" title="${esc(tr('map_playBtnHint'))}">${esc(tr(st.play ? 'map_playOn' : 'map_play'))}</button>${st.play ? '' : `<span class="hint lm-keys" style="margin:0 6px 0 -2px">${esc(tr('map_keysHint'))}</span>`}` : ''}${ctx.canEdit && !st.play ? NODE_TYPES.map(t => `<button class="btn" type="button" data-add="${t}" ${t === 'start' && map.nodes.some(n => n.type === 'start') ? 'disabled' : ''}>${GLYPH[t]} ${esc(tr('map_type_' + t))}</button>`).join('') +
            `<button class="btn${st.connecting ? ' primary' : ''}" id="lmConnect" type="button">${esc(tr(st.connecting ? 'map_connecting' : 'map_connect'))}</button>` +
            `<span class="lm-sep"></span><button class="btn" type="button" data-zone="rect" title="${esc(tr('map_zoneRectHint'))}">▭ ${esc(tr('map_zoneRect'))}</button><button class="btn" type="button" data-zone="ellipse" title="${esc(tr('map_zoneEllipseHint'))}">◯ ${esc(tr('map_zoneEllipse'))}</button><button class="btn${st.drawing ? ' primary' : ''}" type="button" data-zone="poly" title="${esc(tr('map_zonePolyHint'))}">✎ ${esc(tr(st.drawing ? 'map_zonePolyDrawing' : 'map_zonePoly'))}</button>` : ''}
            <button class="btn" id="lmZoomOut" type="button" aria-label="${esc(tr('map_zoomOut'))}">−</button><button class="btn" id="lmZoomIn" type="button" aria-label="${esc(tr('map_zoomIn'))}">+</button><button class="btn" id="lmFit" type="button">${esc(tr('map_fit'))}</button></div>
          <div class="lm-canvas${st.connecting || st.drawing ? ' connecting' : ''}${st.play ? ' playing' : ''}" id="lmCanvas" tabindex="0"><svg id="lmSvg" role="img" aria-label="${esc(tr('map_title'))}"></svg></div>
          <p class="hint" style="margin-top:6px">${esc(tr('map_summary', s))}${s.zones ? ' ' + esc(tr('map_summaryZones', s)) : ''}${st.drawing ? ' — ' + esc(tr('map_zonePolyHelp')) : ''}</p>
        </div>
        <div class="lm-panel" id="lmInspPanel"><button type="button" class="lm-collapse" data-collapse="insp" aria-expanded="true"><span class="lm-chev">»</span><span class="lm-vlabel">${esc(tr('map_inspector'))}</span></button><div class="lm-side" id="lmInsp"></div></div></div>`;
    }

    function wireHeader() {
      const pick = host.querySelector('#lmPick');
      if (pick) pick.onchange = () => { if (st.play && audio) { audio.stop(0.3); stopWalk(); st.play = false; st.now = null; } st.current = pick.value; st.trail = []; st.sel = null; st.linkFrom = null; st.drawing = null; st.view = { x: 0, y: 0, k: 1 }; render(); fit(); };
      host.querySelectorAll('[data-crumb]').forEach(b => b.onclick = () => goBackTo(+b.dataset.crumb));
      const cb = host.querySelector('#lmCrumbBack'); if (cb) cb.onclick = () => goBackTo(st.trail.length - 1);
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
      const lks = host.querySelector('#lmLinkSec');
      if (lks) lks.onclick = () => ctx.linkSections(cur()); // relier la carte à des sections du Projet (fait par la page)
      const dlf = host.querySelector('#lmDownload');
      if (dlf) dlf.onclick = () => ctx.downloadFiles(cur()); // zip des fichiers déposés sur la carte (fait par la page)
      const dl = host.querySelector('#lmDelete');
      if (dl) dl.onclick = async () => {
        const m = cur();
        if (!(await confirmDlg(tr('map_deleteConfirm', { title: m.title || tr('map_untitled') })))) return;
        if (!m.isNew) { const r = await ctx.remove(m); if (r && r.error) { setStatus(tr('map_saveError', { message: r.error })); return; } }
        st.maps = st.maps.filter(x => x !== m); st.current = st.maps.length ? st.maps[0].id : null; st.trail = []; st.sel = null; render();
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
      // Tout voir : éléments, zones et image de fond.
      const pad = [];
      map.nodes.forEach(n => { pad.push([n.x - 90, n.y - 60], [n.x + 90, n.y + 60]); });
      (map.zones || []).forEach(z => { const b = zoneBounds(z); pad.push([b.minX - 20, b.minY - 20], [b.maxX + 20, b.maxY + 20]); });
      if (map.background) pad.push([map.background.x, map.background.y], [map.background.x + map.background.w, map.background.y + map.background.h]);
      if (!pad.length) { st.view = { x: 0, y: 0, k: 1 }; return drawCanvas(); }
      const minX = Math.min(...pad.map(p => p[0])), maxX = Math.max(...pad.map(p => p[0])), minY = Math.min(...pad.map(p => p[1])), maxY = Math.max(...pad.map(p => p[1]));
      const w = c.clientWidth || 600, h = c.clientHeight || 400;
      const k = Math.max(0.1, Math.min(1.4, Math.min(w / (maxX - minX), h / (maxY - minY))));
      st.view = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
      drawCanvas();
    }
    function soundCount(item) { return ((item && item.sounds && item.sounds.main) || []).length + ((item && item.sounds && item.sounds.combat) || []).length; }
    function drawCanvas() {
      const map = curData(), svg = host.querySelector('#lmSvg');
      if (!map || !svg) return;
      const COLORS = { start: 'var(--accent)', place: 'var(--text-dim)', quest: 'var(--seq-map-choice)', boss: '#b5442e', npc: 'var(--seq-map-success)', treasure: '#b8862e', junction: 'var(--text-dim)' };
      let out = `<defs><marker id="lmArrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-dim)"/></marker></defs>`;
      out += `<g transform="translate(${st.view.x} ${st.view.y}) scale(${st.view.k})">`;
      out += backgroundSvg(map) + zonesSvg(map) + circlesSvg(map);
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
          ${soundCount(n) ? `<text class="lm-badge" x="${n.x + hx - 4}" y="${n.y - hy + 11}" text-anchor="end">♪${soundCount(n)}</text>` : ''}${n.link ? `<text class="lm-door" x="${n.x + hx + 3}" y="${n.y - hy + 4}">🚪</text>` : ''}</g>`;
      });
      out += drawingSvg() + avatarSvg();
      out += '</g>';
      svg.innerHTML = out;
    }
    // ---- Monde ouvert : image de fond, zones, cercles de proximité, forme libre en cours, personnage de la balade
    const bgUrls = {};
    function backgroundSvg(map) {
      const bg = map.background; if (!bg) return '';
      const url = bgUrls[bg.id];
      if (url === undefined && ctx.imageUrl) { bgUrls[bg.id] = null; Promise.resolve(ctx.imageUrl(bg.id)).then(u => { bgUrls[bg.id] = u || ''; drawCanvas(); }, () => { bgUrls[bg.id] = ''; }); }
      const edit = st.bgEdit && ctx.canEdit && !st.play;
      let out = url ? `<image class="lm-bg${edit ? ' edit' : ''}" data-bg="1" href="${esc(url)}" x="${bg.x}" y="${bg.y}" width="${bg.w}" height="${bg.h}" opacity="${bg.opacity}" preserveAspectRatio="none"/>`
        : `<rect class="lm-bg-missing" x="${bg.x}" y="${bg.y}" width="${bg.w}" height="${bg.h}"/>`;
      if (edit) {
        const hs = 12 / st.view.k;
        out += `<rect class="lm-bg-frame" data-bg="1" x="${bg.x}" y="${bg.y}" width="${bg.w}" height="${bg.h}"/><rect class="lm-handle" data-bgh="se" x="${bg.x + bg.w - hs / 2}" y="${bg.y + bg.h - hs / 2}" width="${hs}" height="${hs}"/>`;
      }
      return out;
    }
    // Zone qui « joue » pendant la balade libre : celle qui gouverne la musique, à défaut la plus intérieure sous le personnage.
    function hereZoneId(map) {
      if (!freeWalk() || !st.avatar) return null;
      if (st.gov && st.gov.kind === 'zone') return st.gov.id;
      const z = zonesAt(map, st.avatar.x, st.avatar.y)[0]; return z ? z.id : null;
    }
    function zonesSvg(map) {
      const zones = (map.zones || []).slice().sort((a, b) => zoneArea(b) - zoneArea(a)); // les grandes dessous, les petites (cliquables) dessus
      const here = hereZoneId(map), k = st.view.k;
      let out = '';
      zones.forEach(z => {
        const sel = st.sel && st.sel.kind === 'zone' && st.sel.id === z.id, b = zoneBounds(z);
        const shape = z.shape === 'rect' ? `<rect class="lm-zshape" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="14"/>`
          : z.shape === 'ellipse' ? `<ellipse class="lm-zshape" cx="${z.x + z.w / 2}" cy="${z.y + z.h / 2}" rx="${z.w / 2}" ry="${z.h / 2}"/>`
          : `<polygon class="lm-zshape" points="${z.points.map(p => p.x + ',' + p.y).join(' ')}"/>`;
        const c = soundCount(z), lx = z.shape === 'ellipse' ? (b.minX + b.maxX) / 2 : b.minX + 14, anchor = z.shape === 'ellipse' ? 'middle' : 'start';
        const ly = z.shape === 'ellipse' ? b.minY + 26 : (z.shape === 'poly' ? zoneCenter(z).y : b.minY + 22);
        const lxx = z.shape === 'poly' ? zoneCenter(z).x : lx, an = z.shape === 'poly' ? 'middle' : anchor;
        out += `<g class="lm-zone${sel ? ' sel' : ''}${here === z.id ? ' here' : ''}" data-zone="${esc(z.id)}" style="--lm-zc:${z.color}">${shape}
          <text class="lm-zlabel" x="${lxx}" y="${ly}" text-anchor="${an}">${esc(z.label || tr('map_zone'))}${c ? ` <tspan class="lm-badge">♪${c}</tspan>` : ''}${z.keepMusic ? ' <tspan class="lm-badge">⌂</tspan>' : ''}${z.link ? ' 🚪' : ''}</text></g>`;
      });
      // Poignées de la zone sélectionnée (coins, ou points de la forme libre)
      const sz = st.sel && st.sel.kind === 'zone' && !st.play && ctx.canEdit ? zoneById(map, st.sel.id) : null;
      if (sz) {
        const hs = 11 / k;
        if (sz.shape === 'poly') sz.points.forEach((p, i) => { out += `<circle class="lm-handle" data-zv="${i}" cx="${p.x}" cy="${p.y}" r="${hs / 1.6}"/>`; });
        else { const b = zoneBounds(sz); [['nw', b.minX, b.minY], ['ne', b.maxX, b.minY], ['sw', b.minX, b.maxY], ['se', b.maxX, b.maxY]].forEach(([c, x, y]) => { out += `<rect class="lm-handle" data-zh="${c}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}"/>`; }); }
      }
      return out;
    }
    // Cercles de proximité : visibles sur une carte qui a des zones (balade libre), ou autour de l'élément sélectionné qui mène à une sous-carte.
    function circlesSvg(map) {
      const show = hasZones(map);
      let out = '';
      map.nodes.forEach(n => {
        if (!hasCircle(n)) return;
        const sel = st.sel && st.sel.kind === 'node' && st.sel.id === n.id;
        if (!show && !(sel && n.link)) return;
        const on = freeWalk() && st.gov && st.gov.kind === 'node' && st.gov.id === n.id;
        out += `<circle class="lm-circle${sel ? ' sel' : ''}${on ? ' here' : ''}" cx="${n.x}" cy="${n.y}" r="${radiusOf(n)}"/>`;
      });
      return out;
    }
    function drawingSvg() {
      const d = st.drawing; if (!d || !d.points.length) return '';
      const pts = d.points.concat(d.hover ? [d.hover] : []);
      return `<polyline class="lm-draw" points="${pts.map(p => p.x + ',' + p.y).join(' ')}"/>` + d.points.map((p, i) => `<circle class="lm-handle${i === 0 ? ' first' : ''}" cx="${p.x}" cy="${p.y}" r="${(i === 0 ? 8 : 5) / st.view.k}"/>`).join('');
    }
    function avatarSvg() {
      if (!freeWalk() || !st.avatar) return '';
      const k = st.view.k, a = st.avatar;
      return (st.dest ? `<g class="lm-dest" transform="translate(${st.dest.x} ${st.dest.y}) scale(${1 / k})"><circle r="7"/><path d="M-4 0H4M0 -4V4"/></g>` : '') +
        `<g id="lmAvatar" class="lm-avatar" transform="translate(${a.x} ${a.y}) scale(${1 / k})"><circle r="12"/><circle class="lm-avatar-core" r="5"/></g>`;
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
        const c = viewCenter(), spot = freeSpot(map, c.x, c.y);
        const node = addNode(map, b.dataset.add, spot.x, spot.y, '');
        if (!node) return;
        st.sel = { kind: 'node', id: node.id }; touch(); render();
      });
      // Zones (monde ouvert) : rectangle et ovale posés au centre de la vue ; forme libre dessinée point par point sur la carte.
      host.querySelectorAll('[data-zone]').forEach(b => { if (b.tagName === 'BUTTON') b.onclick = () => {
        if (b.dataset.zone === 'poly') { st.drawing = st.drawing ? null : { points: [], hover: null }; st.connecting = false; st.linkFrom = null; render(); host.querySelector('#lmCanvas').focus(); return; }
        const c = viewCenter(), w = Math.round(360 / st.view.k), h = Math.round(240 / st.view.k);
        const z = addZone(map, b.dataset.zone, c.x - w / 2, c.y - h / 2, w, h, '');
        if (z) { st.sel = { kind: 'zone', id: z.id }; touch(); render(); }
      }; });
      const det = host.querySelector('#lmSettings'); if (det) det.addEventListener('toggle', () => { st.settingsOpen = det.open; });
      const playBtn = host.querySelector('#lmPlay');
      if (playBtn) playBtn.onclick = () => togglePlay(!st.play);
      const conn = host.querySelector('#lmConnect');
      if (conn) conn.onclick = () => { st.connecting = !st.connecting; st.linkFrom = null; st.drawing = null; render(); };
      host.querySelector('#lmZoomIn').onclick = () => zoomBy(1.2);
      host.querySelector('#lmZoomOut').onclick = () => zoomBy(1 / 1.2);
      host.querySelector('#lmFit').onclick = fit;
      const canvas = host.querySelector('#lmCanvas');
      const toWorld = ev => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left - st.view.x) / st.view.k, y: (ev.clientY - r.top - st.view.y) / st.view.k }; };
      let drag = null;
      const capture = (el, id) => { try { el.setPointerCapture(id); } catch (e) { /* pas de capture (anciens navigateurs, tests) : le glisser marche quand même tant que le pointeur reste sur la carte */ } };
      // Deux appuis rapprochés au même endroit = double-clic (détecté à la main : le dessin remplace les éléments après le premier clic,
      // et Firefox ne signale alors plus l'événement « dblclick »).
      const isDouble = (key, ev) => { const now = Date.now(), last = st.lastDown; st.lastDown = { key, at: now, x: ev.clientX, y: ev.clientY }; return !!(last && last.key === key && now - last.at < 450 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 10); };
      canvas.addEventListener('pointerdown', ev => {
        // Balade libre : un clic donne la destination du personnage ; glisser déplace la vue.
        if (freeWalk()) { drag = { mode: 'walk', sx: ev.clientX, sy: ev.clientY, vx: st.view.x, vy: st.view.y, moved: false }; capture(canvas, ev.pointerId); canvas.focus(); return; }
        // Forme libre en cours : chaque clic pose un point ; cliquer le premier point (ou double-clic, ou Entrée) ferme la forme.
        if (st.drawing && ctx.canEdit) {
          const w = toWorld(ev), p = { x: Math.round(w.x / 10) * 10, y: Math.round(w.y / 10) * 10 }, d = st.drawing, first = d.points[0];
          if (first && d.points.length >= 3 && Math.hypot(first.x - w.x, first.y - w.y) * st.view.k < 12) { finishDrawing(); return; }
          if (isDouble('draw', ev) && d.points.length >= 3) { finishDrawing(); return; }
          const last = d.points[d.points.length - 1];
          if (!last || last.x !== p.x || last.y !== p.y) d.points.push(p);
          drawCanvas(); return;
        }
        if (ctx.canEdit && !st.play) {
          const w = toWorld(ev), bg = map.background;
          if (ev.target.closest('[data-bgh]') && bg) { drag = { mode: 'bgsize', moved: false, ratio: bg.h / bg.w }; capture(canvas, ev.pointerId); return; }
          if (ev.target.closest('[data-bg]') && bg && st.bgEdit) { drag = { mode: 'bg', dx: bg.x - w.x, dy: bg.y - w.y, moved: false }; capture(canvas, ev.pointerId); return; }
          const sz = st.sel && st.sel.kind === 'zone' ? zoneById(map, st.sel.id) : null;
          const zh = ev.target.closest('[data-zh]'), zv = ev.target.closest('[data-zv]');
          if (sz && zh) { drag = { mode: 'zcorner', id: sz.id, corner: zh.dataset.zh, moved: false }; capture(canvas, ev.pointerId); return; }
          if (sz && zv) {
            if (ev.altKey) { if (removeZonePoint(sz, +zv.dataset.zv)) { touch(); drawCanvas(); } return; } // Alt + clic sur un point : le retirer
            drag = { mode: 'zpoint', id: sz.id, i: +zv.dataset.zv, moved: false }; capture(canvas, ev.pointerId); return;
          }
        }
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
          if (n.link && !st.play && isDouble('n:' + id, ev)) { openSubMap({ kind: 'node', id }); return; } // double-clic : entrer dans la sous-carte
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
            // Aucun élément choisi d'abord : un simple clic sur un parcours ne crée rien (on le sélectionne) ; le point de passage se crée
            // par un double-clic, ou en choisissant d'abord l'élément à relier.
            if (!from) { st.sel = { kind: 'edge', id: edgeEl.dataset.edge }; drawCanvas(); renderInspector(); return; }
            if (from && from.type === 'quest') { if (anchorQuestToEdge(map, from.id, edgeEl.dataset.edge, t)) { st.sel = { kind: 'node', id: from.id }; touch(); } st.linkFrom = null; render(); return; }
            const cut = splitEdge(map, edgeEl.dataset.edge, w.x, w.y);
            if (!cut) return;
            const e = addEdge(map, from.id, cut.node.id); st.linkFrom = null; st.sel = e ? { kind: 'edge', id: e.id } : { kind: 'node', id: cut.node.id };
            touch(); render();
            return;
          }
          // Double-clic sur un parcours : détecté ici (deux appuis rapprochés sur le même parcours), car le dessin remplace l'élément
          // après le premier clic et Firefox ne signale alors plus l'événement « dblclick ».
          const now = Date.now(), last = st.lastEdgeDown;
          if (ctx.canEdit && !st.play && last && last.id === edgeEl.dataset.edge && now - last.at < 450 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 10) {
            st.lastEdgeDown = null;
            const w = toWorld(ev), cut = splitEdge(map, edgeEl.dataset.edge, w.x, w.y);
            if (cut) { st.splitAt = now; st.sel = { kind: 'node', id: cut.node.id }; touch(); render(); return; }
          }
          st.lastEdgeDown = { id: edgeEl.dataset.edge, at: now, x: ev.clientX, y: ev.clientY };
          st.sel = { kind: 'edge', id: edgeEl.dataset.edge }; drawCanvas(); renderInspector();
        } else if (ev.target.closest('[data-zone]')) {
          const id = ev.target.closest('[data-zone]').dataset.zone, z = zoneById(map, id), w = toWorld(ev);
          if (!z) return;
          if (z.link && !st.play && isDouble('z:' + id, ev)) { openSubMap({ kind: 'zone', id }); return; }
          // Alt + clic sur le bord d'une forme libre déjà sélectionnée : un point de plus à cet endroit.
          if (ev.altKey && ctx.canEdit && z.shape === 'poly' && st.sel && st.sel.kind === 'zone' && st.sel.id === id) { if (insertZonePoint(z, w.x, w.y) >= 0) { touch(); drawCanvas(); } return; }
          // Une zone déjà sélectionnée se déplace en la glissant ; sinon le premier clic la sélectionne et glisser déplace la vue (un monde
          // ouvert est souvent couvert de zones : sans cela, plus moyen de faire défiler la carte).
          const already = st.sel && st.sel.kind === 'zone' && st.sel.id === id;
          st.sel = { kind: 'zone', id }; st.linkFrom = null;
          if (ctx.canEdit && !st.play && already) drag = { mode: 'zone', id, last: w, moved: false };
          else { drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: st.view.x, vy: st.view.y }; canvas.classList.add('panning'); }
          capture(canvas, ev.pointerId);
          drawCanvas(); renderInspector();
        } else {
          st.sel = null; st.linkFrom = null;
          drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: st.view.x, vy: st.view.y };
          canvas.classList.add('panning'); capture(canvas, ev.pointerId); drawCanvas(); renderInspector();
        }
      });
      canvas.addEventListener('pointermove', ev => {
        if (st.drawing && !drag) { const w = toWorld(ev); st.drawing.hover = { x: Math.round(w.x / 10) * 10, y: Math.round(w.y / 10) * 10 }; drawCanvas(); return; }
        if (!drag) return;
        if (drag.mode === 'pan') { st.view.x = drag.vx + ev.clientX - drag.sx; st.view.y = drag.vy + ev.clientY - drag.sy; drawCanvas(); return; }
        if (drag.mode === 'walk') {
          if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 5) return;
          drag.moved = true; st.view.x = drag.vx + ev.clientX - drag.sx; st.view.y = drag.vy + ev.clientY - drag.sy; drawCanvas(); return;
        }
        const w = toWorld(ev);
        if (drag.mode === 'bg' || drag.mode === 'bgsize') {
          const bg = map.background; if (!bg) return;
          if (drag.mode === 'bg') { bg.x = Math.round(w.x + drag.dx); bg.y = Math.round(w.y + drag.dy); }
          else { bg.w = Math.max(100, Math.round(w.x - bg.x)); bg.h = Math.round(bg.w * drag.ratio); } // garde les proportions de l'image
          drag.moved = true; drawCanvas(); return;
        }
        if (drag.mode === 'zone' || drag.mode === 'zcorner' || drag.mode === 'zpoint') {
          const z = zoneById(map, drag.id); if (!z) return;
          if (drag.mode === 'zone') { moveZone(z, w.x - drag.last.x, w.y - drag.last.y); drag.last = w; }
          else if (drag.mode === 'zcorner') resizeZone(z, drag.corner, w.x, w.y);
          else moveZonePoint(z, drag.i, w.x, w.y);
          drag.moved = true; drawCanvas(); return;
        }
        const n = nodeById(map, drag.id); if (!n) return;
        if (drag.mode === 'anchor') { if (n.anchor && n.anchor.kind === 'edge') { n.anchor.t = Math.round(projectOnEdge(map, n.anchor.id, w.x, w.y) * 1000) / 1000; drag.moved = true; drawCanvas(); } return; }
        n.x = Math.round((w.x + drag.dx) / 10) * 10; n.y = Math.round((w.y + drag.dy) / 10) * 10; drag.moved = true; drawCanvas();
      });
      const end = ev => {
        if (!drag) return;
        if (drag.mode === 'walk' && !drag.moved && ev && ev.type === 'pointerup') setDestination(toWorld(ev));
        if (drag.mode === 'zone' && drag.moved) { const z = zoneById(map, drag.id); if (z && z.shape !== 'poly') { z.x = Math.round(z.x / 10) * 10; z.y = Math.round(z.y / 10) * 10; } }
        if (['node', 'anchor', 'zone', 'zcorner', 'zpoint', 'bg', 'bgsize'].includes(drag.mode) && drag.moved) touch();
        drag = null; canvas.classList.remove('panning');
      };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      // Double-clic sur un parcours : un point de passage y est créé (on peut ensuite en faire partir un autre itinéraire).
      canvas.addEventListener('dblclick', ev => {
        if (!ctx.canEdit || st.play || (st.splitAt && Date.now() - st.splitAt < 700)) return; // déjà fait par la détection ci-dessus
        const edgeEl = ev.target.closest('[data-edge]'); if (!edgeEl) return;
        const w = toWorld(ev), cut = splitEdge(map, edgeEl.dataset.edge, w.x, w.y);
        if (cut) { st.sel = { kind: 'node', id: cut.node.id }; touch(); render(); }
      });
      canvas.addEventListener('wheel', ev => { ev.preventDefault(); zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev); }, { passive: false });
      // Dépôt d'un son sur un élément ou un parcours
      const dropTarget = ev => { const el = ev.target.closest('[data-node],[data-edge],g[data-zone]'); return el ? (el.dataset.node ? { kind: 'node', id: el.dataset.node, el } : el.dataset.edge ? { kind: 'edge', id: el.dataset.edge, el } : { kind: 'zone', id: el.dataset.zone, el }) : null; };
      canvas.addEventListener('dragover', ev => {
        if (!ctx.canEdit || !acceptsSound(ev)) return;
        const t = dropTarget(ev); canvas.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
        if (t) { ev.preventDefault(); t.el.classList.add('drop'); }
      });
      canvas.addEventListener('dragleave', () => canvas.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')));
      canvas.addEventListener('drop', ev => {
        const t = dropTarget(ev); canvas.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
        if (!t || !ctx.canEdit) return;
        ev.preventDefault();
        withDroppedRefs(ev, refs => {
          let any = false;
          for (const ref of refs) if (addSound(map, { kind: t.kind, id: t.id }, 'main', ref)) any = true;
          if (any) { st.sel = { kind: t.kind, id: t.id }; touch(); drawCanvas(); renderInspector(); }
        });
      });
      const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      host.onkeyup = ev => { walkKeys.delete(walkKey(ev)); };
      host.onkeydown = ev => {
        const typing = /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName);
        if (st.drawing && !typing) {
          if (ev.key === 'Enter') { ev.preventDefault(); finishDrawing(); return; }
          if (ev.key === 'Escape') { ev.preventDefault(); st.drawing = null; render(); return; }
          if (ev.key === 'Backspace' || ev.key === 'Delete') { ev.preventDefault(); st.drawing.points.pop(); drawCanvas(); return; }
        }
        // Balade libre : flèches ou ZQSD (WASD) pour piloter, E entrer dans une sous-carte, X en sortir, M changer de déplacement, C combat.
        if (freeWalk() && audio && !typing && !ev.metaKey && !ev.ctrlKey) {
          const k = walkKey(ev);
          if (k) { ev.preventDefault(); walkKeys.add(k); st.dest = null; startWalkLoop(); return; }
          if (ev.key === 'e' || ev.key === 'E') { ev.preventDefault(); enterHere(); return; }
          if (ev.key === 'x' || ev.key === 'X') { ev.preventDefault(); exitSubMap(); return; }
          if (ev.key === 'm' || ev.key === 'M') { ev.preventDefault(); const ms = modesOf(map), i = ms.findIndex(m => m.id === st.modeId); setMode(ms[(i + 1) % ms.length].id); return; }
          if (ev.key === 'c' || ev.key === 'C') { ev.preventDefault(); st.freeCombat = !st.freeCombat; followHere(true); return; }
          if (ev.key === ' ') { ev.preventDefault(); if (st.now && st.now.playing) audio.stop(1); else followHere(true, true); return; }
          if (ev.key === 'Escape') { ev.preventDefault(); togglePlay(false); return; }
          if (/^[0-9]$/.test(ev.key) && st.now && st.now.sequences) { ev.preventDefault(); if (+ev.key >= 1 && +ev.key - 1 < st.now.sequences.labels.length) audio.goToSequence(+ev.key - 1); return; }
          if (/^[0-9]$/.test(ev.key) && st.now && st.now.layers > 1) { ev.preventDefault(); audio.setIntensity(ev.key === '0' ? null : Math.min(st.now.layers - 1, +ev.key - 1)); return; }
          return;
        }
        if (st.play && audio && !typing && st.now && st.now.position && (ev.key === 'e' || ev.key === 'E')) { ev.preventDefault(); enterHere(); return; }
        if (st.play && audio && !typing && st.trail.length && (ev.key === 'x' || ev.key === 'X')) { ev.preventDefault(); exitSubMap(); return; }
        if (st.play && audio && !typing) {
          if (ARROWS[ev.key]) { ev.preventDefault(); const [dx, dy] = ARROWS[ev.key]; const from = st.now && st.now.position; (from ? audio.step(dx, dy) : startFromSelection()).then(next => { const pos = audio.state.position; if (pos) { st.sel = { kind: pos.kind, id: pos.id }; drawCanvas(); renderInspector(); } }); return; }
          if (ev.key === ' ') { ev.preventDefault(); if (st.now && st.now.playing) audio.stop(1); else if (st.now && st.now.position) audio.resume(); else startFromSelection(); return; }
          if (/^[1-9]$/.test(ev.key) && st.now && st.now.sequences) { ev.preventDefault(); if (+ev.key - 1 < st.now.sequences.labels.length) audio.goToSequence(+ev.key - 1); return; } // 1-9 : séquence d'un morceau séquentiel
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
      const k = Math.max(0.1, Math.min(2.2, st.view.k * f)), ratio = k / st.view.k; // 0.1 : un grand monde ouvert tient à l'écran
      st.view = { k, x: px - (px - st.view.x) * ratio, y: py - (py - st.view.y) * ratio };
      drawCanvas();
    }
    function deleteSelection() {
      const map = curData(); if (!map || !st.sel) return;
      if (st.sel.kind === 'node') removeNode(map, st.sel.id); else if (st.sel.kind === 'zone') removeZone(map, st.sel.id); else removeEdge(map, st.sel.id);
      st.sel = null; touch(); render();
    }

    // ---- Inspecteur (élément ou parcours sélectionné)
    function renderInspector() {
      const box = host.querySelector('#lmInsp'), map = curData();
      if (!box || !map) return;
      const item = st.sel ? targetOf(map, st.sel) : null;
      if (!item) { box.innerHTML = `<h2>${esc(tr('map_inspector'))}</h2><p class="hint">${esc(tr(hasZones(map) ? 'map_inspectorEmptyZones' : 'map_inspectorEmpty'))}</p>`; return; }
      const isEdge = st.sel.kind === 'edge', isZone = st.sel.kind === 'zone', dis = ctx.canEdit ? '' : ' disabled';
      let html = `<h2>${esc(isEdge ? tr('map_edge') : isZone ? tr('map_zone') : tr('map_type_' + item.type))}</h2>
        <label>${esc(tr('map_label'))}</label><input type="text" id="lmLabel" value="${esc(item.label)}" maxlength="120"${dis}>`;
      if (isZone) {
        html += `<label>${esc(tr('map_note'))}</label><textarea id="lmNote" maxlength="2000"${dis}>${esc(item.note || '')}</textarea>
          <label>${esc(tr('map_zoneColor'))}</label><div class="lm-swatches">${ZONE_COLORS.map(c => `<button type="button" class="lm-swatch${item.color === c ? ' on' : ''}" data-color="${c}" style="background:${c}" aria-label="${esc(c)}"${dis}></button>`).join('')}</div>
          <label class="choice" style="display:flex;gap:6px;align-items:flex-start"><input type="checkbox" id="lmKeep" ${item.keepMusic ? 'checked' : ''}${dis} style="width:auto;margin-top:3px"> ${esc(tr('map_zoneKeep'))}</label>
          ${item.shape === 'poly' && ctx.canEdit ? `<p class="hint">${esc(tr('map_zonePolyEditHint'))}</p>` : ''}`;
        html += linkHtml(map, item);
      } else if (isEdge) {
        const a = nodeById(map, item.from), b = nodeById(map, item.to);
        html += `<p class="hint">${esc((a && a.label) || '?')} → ${esc((b && b.label) || '?')}</p>
          ${ctx.canEdit ? `<button class="btn" id="lmSplit" type="button" title="${esc(tr('map_splitHint'))}">${esc(tr('map_split'))}</button> <button class="btn" id="lmSplitT" type="button" title="${esc(tr('map_splitTransitionHint'))}">${esc(tr('map_splitTransition'))}</button>` : ''}
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
        if (hasCircle(item) && (hasZones(map) || item.link)) html += `<label>${esc(tr('map_radius', { r: radiusOf(item) }))}</label><input type="range" id="lmRadius" min="20" max="600" step="10" value="${Math.min(600, radiusOf(item))}"${dis}><p class="hint" style="margin-top:0">${esc(tr('map_radiusHint'))}</p>`;
        if (hasCircle(item)) html += linkHtml(map, item);
      }
      const target = { kind: st.sel.kind, id: item.id };
      // Une seule musique ; une 2e facultative (avec son nom et un son de transition entre les deux) ; le fond d'ambiance de l'endroit.
      const listOf = slot => (slot === 'altTransition' ? (item.altTransition ? [item.altTransition] : []) : ((item.sounds && item.sounds[slot]) || []));
      const slotBox = (slot, title, emptyKey) => `<div class="lm-slot" data-slot="${slot}"><h4>${esc(title)}</h4>${listOf(slot).map((r, i) =>
        `<div class="lm-sound"><span>${r.kind === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(r.title)}">${esc(r.title || r.id)}</span>${ctx.canEdit ? `<button class="icon-btn" type="button" data-rm="${slot}:${i}" aria-label="${esc(tr('map_removeSound'))}">✕</button>` : ''}</div>`).join('') || `<p class="hint" style="margin:0">${esc(tr(emptyKey))}</p>`}${slot !== 'altTransition' && slot !== 'room' && listOf(slot).length > 1 ? `<p class="hint" style="margin:4px 0 0">🎲 ${esc(tr('map_randomHint'))}</p>` : ''}</div>`;
      const altKey = st.sel.kind + ':' + item.id, hasAlt = hasAltMusic(map, target) || !!item.altName || !!item.altTransition || st.altOpen === altKey;
      const isTrans = !isEdge && item.type === 'transition';
      if (isTrans) html += `<p class="hint">${esc(tr('map_transitionNodeHint'))}</p>`; else html += slotBox('main', tr('map_slot_main'), 'map_slotEmpty');
      if (isTrans) { /* un nœud « Transition » n'a ni musique ni fond propres */ } else if (hasAlt) {
        html += `<div class="lm-alt"><label>${esc(tr('map_altName'))}</label><input type="text" id="lmAltName" value="${esc(item.altName || '')}" maxlength="60" placeholder="${esc(tr('map_altDefault'))}"${dis}>
          ${slotBox('combat', item.altName || tr('map_altDefault'), 'map_slotEmpty')}${slotBox('altTransition', tr('map_slot_altTransition'), 'map_altTransitionEmpty')}
          ${ctx.canEdit ? `<button class="btn" type="button" id="lmAltRemove">${esc(tr('map_altRemove'))}</button>` : ''}</div>`;
      } else if (ctx.canEdit) html += `<button class="btn" type="button" id="lmAltAdd" style="margin:6px 0;font-size:12px;padding:4px 10px;width:auto;border-style:dashed">＋ ${esc(tr('map_altAdd'))}</button>`;
      if (!isTrans) html += slotBox('room', tr('map_slot_room'), 'map_slotEmpty');
      html += transitionHtml(map, item);
      if (ctx.canEdit) html += `<div class="bar" style="margin-top:10px"><button class="btn danger" id="lmDeleteSel" type="button">${esc(tr(isEdge ? 'map_deleteEdge' : isZone ? 'map_deleteZone' : 'map_deleteNode'))}</button></div>`;
      box.innerHTML = html;
      const on = (id, evt, fn) => { const el = box.querySelector(id); if (el) el.addEventListener(evt, fn); };
      on('#lmLabel', 'input', e => { item.label = e.target.value; touch(); drawCanvas(); });
      on('#lmNote', 'input', e => { item.note = e.target.value; touch(); });
      box.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { item.color = b.dataset.color; touch(); drawCanvas(); renderInspector(); });
      on('#lmKeep', 'change', e => { item.keepMusic = e.target.checked; touch(); drawCanvas(); });
      on('#lmRadius', 'input', e => { setRadius(map, item.id, e.target.value); e.target.previousElementSibling.textContent = tr('map_radius', { r: radiusOf(item) }); drawCanvas(); });
      on('#lmRadius', 'change', () => touch());
      wireLink(box, map, target);
      on('#lmSplit', 'click', () => { const g = edgeGeometry(map, item), cut = g && splitEdge(map, item.id, g.mid.x, g.mid.y); if (cut) { st.sel = { kind: 'node', id: cut.node.id }; touch(); render(); } });
      on('#lmSplitT', 'click', () => { const g = edgeGeometry(map, item), cut = g && splitEdge(map, item.id, g.mid.x, g.mid.y, 'transition'); if (cut) { st.sel = { kind: 'node', id: cut.node.id }; touch(); render(); } });
      on('#lmEnemy', 'change', e => { setEnemy(map, item.id, e.target.checked); touch(); drawCanvas(); renderInspector(); });
      on('#lmSide', 'change', e => { item.side = e.target.checked; if (!item.side) item.anchor = null; touch(); drawCanvas(); renderInspector(); });
      on('#lmAnchor', 'change', e => { const [kind, ...rest] = e.target.value.split(':'); item.anchor = e.target.value ? { kind, id: rest.join(':') } : null; touch(); drawCanvas(); });
      on('#lmDeleteSel', 'click', deleteSelection);
      on('#lmAltAdd', 'click', () => { st.altOpen = altKey; renderInspector(); });
      on('#lmAltName', 'input', e => { setAltName(map, target, e.target.value); touch(); });
      on('#lmAltRemove', 'click', () => { clearAlt(map, target); st.altOpen = null; touch(); drawCanvas(); renderInspector(); });
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const [slot, i] = b.dataset.rm.split(':'); if (removeSound(map, target, slot, Number(i))) { touch(); drawCanvas(); renderInspector(); } });
      box.querySelectorAll('.lm-slot[data-slot]').forEach(sl => {
        sl.addEventListener('dragover', ev => { if (ctx.canEdit && acceptsSound(ev)) { ev.preventDefault(); sl.classList.add('drop'); } });
        sl.addEventListener('dragleave', () => sl.classList.remove('drop'));
        sl.addEventListener('drop', ev => {
          sl.classList.remove('drop'); if (!ctx.canEdit) return; ev.preventDefault();
          withDroppedRefs(ev, refs => {
            let any = false;
            for (const ref of refs) if (addSound(map, target, sl.dataset.slot, ref)) any = true;
            if (any) { touch(); drawCanvas(); renderInspector(); }
          });
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

    // ---- Sous-carte : cet élément ou cette zone mène à une autre carte du Projet (le château dans le monde ouvert)
    function linkHtml(map, item) {
      const dis = ctx.canEdit ? '' : ' disabled', others = st.maps.filter(m => m.id !== st.current && !m.isNew);
      const missing = item.link && !others.some(m => m.id === item.link);
      return `<div class="lm-slot" id="lmLinkBox"><h4>🚪 ${esc(tr('map_link'))}</h4>
        <select id="lmLink"${dis}><option value="">${esc(tr('map_linkNone'))}</option>${others.map(m => `<option value="${esc(m.id)}"${item.link === m.id ? ' selected' : ''}>${esc(m.title || tr('map_untitled'))}</option>`).join('')}
          ${missing ? `<option value="${esc(item.link)}" selected>${esc(tr('map_linkMissing'))}</option>` : ''}${ctx.canEdit ? `<option value="__new">＋ ${esc(tr('map_linkNew'))}</option>` : ''}</select>
        ${item.link && !missing ? `<button class="btn" type="button" id="lmLinkOpen" style="margin-top:6px">${esc(tr('map_linkOpen', { title: mapTitle(item.link) }))} ›</button>` : ''}
        <p class="hint" style="margin:6px 0 0">${esc(tr(missing ? 'map_linkMissingHint' : 'map_linkHint'))}</p></div>`;
    }
    function wireLink(box, map, target) {
      const sel = box.querySelector('#lmLink');
      if (sel && ctx.canEdit) sel.onchange = async () => {
        if (sel.value !== '__new') { setLink(map, target, sel.value || null); touch(); drawCanvas(); renderInspector(); return; }
        // Nouvelle carte créée depuis l'élément : elle porte son nom, est enregistrée tout de suite, puis reliée.
        const item = targetOf(map, target), title = await ask(tr('map_askName'), (item && item.label) || tr('map_defaultName', { n: st.maps.length + 1 }));
        if (title == null) { renderInspector(); return; }
        const data = emptyMap();
        const r = await ctx.save({ id: null, title: title.trim() || tr('map_defaultName', { n: st.maps.length + 1 }), data });
        if (!r || r.error || !r.id) { setStatus(tr('map_saveError', { message: (r && r.error) || '?' })); renderInspector(); return; }
        st.maps.push({ id: r.id, title: title.trim() || tr('map_defaultName', { n: st.maps.length + 1 }), data });
        setLink(map, target, r.id); touch(); render();
      };
      const open = box.querySelector('#lmLinkOpen'); if (open) open.onclick = () => openSubMap(target);
    }

    // ---- Transition d'entrée (propre à l'élément, sinon celle de la carte)
    const optionsHtml = (list, current, key) => list.map(v => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(tr(key + v))}</option>`).join('');
    function transitionHtml(map, item) {
      const isT = item.type === 'transition';
      if (isT && !cleanTransition(item.transition)) { const e0 = resolveTransition(map, item); item.transition = { style: e0.style, sec: e0.sec, sync: e0.sync }; } // un nœud « Transition » a toujours ses propres réglages
      const own = cleanTransition(item.transition), eff = resolveTransition(map, item), dis = ctx.canEdit ? '' : ' disabled';
      const stingerHtml = eff.stinger ? `<div class="lm-sound"><span>${eff.stinger.kind === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(eff.stinger.title)}">${esc(eff.stinger.title || eff.stinger.id)}</span>${ctx.canEdit ? `<button class="icon-btn" type="button" id="lmStingerRm" aria-label="${esc(tr('map_removeSound'))}">✕</button>` : ''}</div>` : `<p class="hint" style="margin:0">${esc(tr('map_stingerEmpty'))}</p>`;
      return `<div class="lm-slot" id="lmTrans"><h4>${esc(tr(isT ? 'map_transitionNodeTitle' : 'map_transition'))}</h4>
        ${isT ? '' : `<label class="choice" style="display:flex;gap:6px;align-items:center;margin:0 0 6px"><input type="checkbox" id="lmTransOwn" ${own ? 'checked' : ''}${dis} style="width:auto"> ${esc(tr('map_transitionOwn'))}</label>`}
        ${own ? `<div class="lm-row"><select id="lmTrStyle"${dis}>${optionsHtml(TRANSITION_STYLES, eff.style, 'map_style_')}</select>
          <input type="number" id="lmTrSec" min="0" max="30" step="0.5" value="${eff.sec}"${dis} aria-label="${esc(tr('map_seconds'))}"> <span class="meta">${esc(tr('map_seconds'))}</span></div>
          <div class="lm-row" style="margin-top:6px"><select id="lmTrSync"${dis} aria-label="${esc(tr('map_sync'))}">${optionsHtml(SYNCS, eff.sync, 'map_sync_')}</select></div>
          <div class="lm-slot" id="lmStinger" style="margin-top:8px"><h4>${esc(tr(isT ? 'map_transitionFile' : 'map_stinger'))}</h4>${stingerHtml}</div>`
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
        zone.addEventListener('dragover', ev => { if (acceptsSound(ev)) { ev.preventDefault(); zone.classList.add('drop'); } });
        zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
        zone.addEventListener('drop', ev => { zone.classList.remove('drop'); ev.preventDefault(); withDroppedRefs(ev, refs => { if (refs[0] && cleanRef(refs[0])) setStinger(refs[0]); }); });
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
          <p class="hint" style="margin-top:6px">${esc(tr('map_syncHint'))}</p></div></div>
        <div class="lm-set" style="margin-top:12px">${backgroundSettingsHtml(map)}${modesSettingsHtml(map)}</div>`;
      wireOpenWorldSettings(box, map);
      if (!ctx.canEdit) return;
      const setRoom = ref => { map.roomTone = ref ? { kind: ref.kind, id: ref.id, title: ref.title } : null; touch(); renderSettings(); if (audio && st.play) { audio.setMap(map); audio.resume(); } };
      const rm = box.querySelector('#lmRoomRm'); if (rm) rm.onclick = () => setRoom(null);
      const zone = box.querySelector('#lmRoomZone');
      // Toute la colonne du fond d'ambiance (titre, zone, niveau) reçoit le dépôt, pas seulement le cadre en pointillés.
      const dropArea = zone.parentElement;
      const accepts = acceptsSound;
      dropArea.addEventListener('dragenter', ev => { if (accepts(ev)) { ev.preventDefault(); zone.classList.add('drop'); } });
      dropArea.addEventListener('dragover', ev => { if (accepts(ev)) { ev.preventDefault(); zone.classList.add('drop'); } });
      dropArea.addEventListener('dragleave', ev => { if (!dropArea.contains(ev.relatedTarget)) zone.classList.remove('drop'); });
      dropArea.addEventListener('drop', ev => { zone.classList.remove('drop'); ev.preventDefault(); withDroppedRefs(ev, refs => { if (refs[0] && cleanRef(refs[0])) setRoom(refs[0]); }); });
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.style.marginTop = '4px'; b.textContent = st.picked ? tr('map_addPickedNamed', { title: st.picked.title || st.picked.id }) : tr('map_addPicked'); b.disabled = !st.picked;
      b.onclick = () => { if (st.picked) setRoom(st.picked); }; zone.appendChild(b);
      const db = box.querySelector('#lmRoomDb');
      db.oninput = () => { map.roomToneDb = Number(db.value); box.querySelector('#lmRoomDb').previousElementSibling.textContent = tr('map_roomToneDb', { db: map.roomToneDb }); if (audio) audio.refreshRoomLevel(); touch(); };
      const setDef = (k, v) => { map.defaults.transition = Object.assign({}, map.defaults.transition, { [k]: v }); touch(); renderInspector(); };
      box.querySelector('#lmDefStyle').onchange = e => setDef('style', e.target.value);
      box.querySelector('#lmDefSec').onchange = e => setDef('sec', Math.max(0, Math.min(30, Number(e.target.value) || 0)));
      box.querySelector('#lmDefSync').onchange = e => setDef('sync', e.target.value);
    }

    // ---- Réglages du monde ouvert : image de fond et modes de déplacement
    function backgroundSettingsHtml(map) {
      const dis = ctx.canEdit ? '' : ' disabled', bg = map.background, imgs = (ctx.images || []);
      return `<div><label>${esc(tr('map_bg'))}</label>
        <div class="lm-row"><select id="lmBgPick"${dis}><option value="">${esc(tr('map_bgNone'))}</option>${imgs.map(i => `<option value="${esc(i.id)}"${bg && bg.id === i.id ? ' selected' : ''}>${esc(i.title)}</option>`).join('')}${bg && !imgs.some(i => i.id === bg.id) ? `<option value="${esc(bg.id)}" selected>${esc(bg.title || bg.id)}</option>` : ''}</select>
          ${ctx.uploadImage && ctx.canEdit ? `<label class="btn" style="margin:0;cursor:pointer">${esc(tr('map_bgUpload'))}<input type="file" id="lmBgFile" accept="image/*" hidden></label>` : ''}</div>
        ${bg ? `<label>${esc(tr('map_bgOpacity', { n: Math.round(bg.opacity * 100) }))}</label><input type="range" id="lmBgOpacity" min="10" max="100" step="5" value="${Math.round(bg.opacity * 100)}"${dis}>
          ${ctx.canEdit ? `<div class="lm-row"><button class="btn${st.bgEdit ? ' primary' : ''}" type="button" id="lmBgEdit">${esc(tr(st.bgEdit ? 'map_bgEditDone' : 'map_bgEdit'))}</button></div>` : ''}` : ''}
        <p class="hint">${esc(tr('map_bgHint'))}</p></div>`;
    }
    function modesSettingsHtml(map) {
      const dis = ctx.canEdit ? '' : ' disabled', modes = map.modes || [];
      return `<div><label>${esc(tr('map_modes'))}</label><p class="hint" style="margin-top:0">${esc(tr('map_modesHint'))}</p>
        ${modes.map(m => `<div class="lm-mode" data-mode="${esc(m.id)}"><div class="lm-row"><input type="text" data-mode-label value="${esc(m.label)}" maxlength="60" placeholder="${esc(tr('map_modeName'))}"${dis} style="flex:1 1 120px">${ctx.canEdit ? `<button class="icon-btn" type="button" data-mode-rm aria-label="${esc(tr('map_modeRemove'))}">✕</button>` : ''}</div>
          <label>${esc(tr('map_modeSpeed', { n: m.speed }))}</label><input type="range" data-mode-speed min="40" max="1000" step="10" value="${m.speed}"${dis}>
          <div class="lm-slot" data-mode-slot><h4>${esc(tr('map_modeMusic'))}</h4>${((m.sounds && m.sounds.main) || []).map((r, i) => `<div class="lm-sound"><span>${r.kind === 'sfx' ? '🔔' : '♪'}</span><span class="lm-t" title="${esc(r.title)}">${esc(r.title || r.id)}</span>${ctx.canEdit ? `<button class="icon-btn" type="button" data-mode-snd="${i}" aria-label="${esc(tr('map_removeSound'))}">✕</button>` : ''}</div>`).join('') || `<p class="hint" style="margin:0">${esc(tr('map_modeMusicEmpty'))}</p>`}</div></div>`).join('')}
        ${ctx.canEdit && modes.length < 8 ? `<button class="btn" type="button" id="lmModeAdd">＋ ${esc(tr('map_modeAdd'))}</button>` : ''}</div>`;
    }
    function wireOpenWorldSettings(box, map) {
      if (!ctx.canEdit) return;
      const changed = () => { touch(); renderSettings(); drawCanvas(); if (freeWalk()) followHere(true); };
      // Image choisie : elle se pose à sa taille réelle (2400 de large au plus), centrée sur la vue, sous tout le reste.
      const placeImage = async (ref) => {
        let w = 1600, h = 1000;
        try {
          const url = ctx.imageUrl ? await ctx.imageUrl(ref.id) : null;
          if (url) { bgUrls[ref.id] = url; const dim = await new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = url; }); if (dim && dim.w) { w = Math.min(2400, dim.w); h = Math.round(w * dim.h / dim.w); } }
        } catch (e) { /* taille par défaut */ }
        const c = viewCenter();
        map.background = { kind: 'asset', id: ref.id, title: ref.title || '', x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h, opacity: 1 };
        st.bgEdit = true; changed(); fit();
      };
      const pick = box.querySelector('#lmBgPick');
      if (pick) pick.onchange = () => {
        if (!pick.value) { map.background = null; st.bgEdit = false; changed(); return; }
        const img = (ctx.images || []).find(i => i.id === pick.value); placeImage({ id: pick.value, title: img ? img.title : '' });
      };
      const file = box.querySelector('#lmBgFile');
      if (file) file.onchange = async () => {
        const f = file.files && file.files[0]; if (!f) return;
        setStatus(tr('map_uploading', { name: f.name }));
        const r = await ctx.uploadImage(f);
        if (!r || r.error || !r.ref) { setStatus(tr('map_saveError', { message: (r && r.error) || f.name })); return; }
        if (!(ctx.images || []).some(i => i.id === r.ref.id)) (ctx.images = ctx.images || []).push({ id: r.ref.id, title: r.ref.title });
        placeImage(r.ref);
      };
      const op = box.querySelector('#lmBgOpacity');
      if (op) { op.oninput = () => { map.background.opacity = Number(op.value) / 100; op.previousElementSibling.textContent = tr('map_bgOpacity', { n: Number(op.value) }); drawCanvas(); }; op.onchange = () => touch(); }
      const be = box.querySelector('#lmBgEdit'); if (be) be.onclick = () => { st.bgEdit = !st.bgEdit; renderSettings(); drawCanvas(); };
      const add = box.querySelector('#lmModeAdd');
      if (add) add.onclick = () => { const p = nextModePreset(map, k => tr('map_mode_' + k)); addMode(map, p.key ? tr('map_mode_' + p.key) : tr('map_modeDefault', { n: (map.modes || []).length + 1 }), p.speed); changed(); };
      box.querySelectorAll('[data-mode]').forEach(row => {
        const mode = modeById(map, row.dataset.mode); if (!mode) return;
        const t = { kind: 'mode', id: mode.id };
        row.querySelector('[data-mode-label]').oninput = e => { mode.label = e.target.value.slice(0, 60); touch(); };
        const sp = row.querySelector('[data-mode-speed]');
        sp.oninput = () => { mode.speed = Number(sp.value); sp.previousElementSibling.textContent = tr('map_modeSpeed', { n: mode.speed }); }; sp.onchange = () => touch();
        const rm = row.querySelector('[data-mode-rm]'); if (rm) rm.onclick = () => { removeMode(map, mode.id); if (st.modeId === mode.id) st.modeId = null; changed(); };
        row.querySelectorAll('[data-mode-snd]').forEach(b => b.onclick = () => { removeSound(map, t, 'main', +b.dataset.modeSnd); changed(); });
        const slot = row.querySelector('[data-mode-slot]');
        slot.addEventListener('dragover', ev => { if (acceptsSound(ev)) { ev.preventDefault(); slot.classList.add('drop'); } });
        slot.addEventListener('dragleave', () => slot.classList.remove('drop'));
        slot.addEventListener('drop', ev => { slot.classList.remove('drop'); ev.preventDefault(); withDroppedRefs(ev, refs => { let any = false; refs.forEach(r => { if (addSound(map, t, 'main', r)) any = true; }); if (any) changed(); }); });
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.style.marginTop = '4px'; b.textContent = tr('map_addPicked'); b.disabled = !st.picked;
        b.onclick = () => { if (st.picked && addSound(map, t, 'main', st.picked)) changed(); }; slot.appendChild(b);
      });
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
      const n = st.now || {}, can = n.position && hasAltMusic(map, n.position), here = n.position && itemOf(map, n.position), altLabel = (here && altNameOf(here)) || tr('map_altDefault');
      if (freeWalk()) { box.innerHTML = freeNowHtml(map, n); wireNow(box, n); return; }
      const door = here && here.link && savedMapIds().includes(here.link);
      box.innerHTML = (n.loading > 0 || n.notReady ? `<span class="lm-wait lm-loading">⏳ ${esc(n.notReady && n.notReady !== true ? tr('map_loadingNamed', { title: n.notReady }) : tr('map_loading'))}</span>` : '') + (n.position
        ? `<span><b>${esc(tr('map_nowAt'))}</b> ${esc(labelOf(map, n.position))}</span><span>♪ ${esc((n.music && n.music.title) || tr('map_nowSilence'))}</span>${n.room ? `<span>🌫 ${esc(n.room.title || n.room.id)}</span>` : ''}
          ${n.pendingAt != null ? `<span class="lm-wait">${esc(tr('map_nowWaiting'))}</span>` : ''}
          ${musicControlsHtml(n)}
          <button class="btn${n.combat ? ' primary' : ''}" type="button" id="lmCombat" ${can ? '' : 'disabled'}>${esc(n.combat ? tr('map_altBack') : tr('map_altGo', { name: altLabel }))}</button>
          ${door ? `<button class="btn" type="button" id="lmEnter">🚪 ${esc(tr('map_enter', { title: mapTitle(here.link) }))}</button>` : ''}${st.trail.length ? `<button class="btn" type="button" id="lmExit">↩ ${esc(tr('map_exit', { title: mapTitle(st.trail[st.trail.length - 1].mapId) }))}</button>` : ''}
          <button class="btn" type="button" id="lmStopPlay">${esc(tr(n.playing ? 'map_pause' : 'map_resume'))}</button>`
        : `<span>${esc(tr('map_playHint'))}</span>`);
      wireNow(box, n);
    }
    // Pendant la balade : ce qui s'entend se pilote d'ici (séquences, couches, nouveau tirage), commun aux deux balades.
    function musicControlsHtml(n) {
      return `${n.canRefreshPool ? `<span class="lm-layers"><button class="btn" type="button" id="lmPool" title="${esc(tr('map_poolHint'))}">🎲 ${esc(tr('map_pool'))}</button></span>` : ''}
          ${n.sequences ? `<span class="lm-layers" id="lmSeqs"><b>${esc(tr('map_sequences'))}</b>${n.sequences.labels.map((lab, i) => `<button class="btn${n.sequences.current === i ? ' primary' : ''}${n.sequences.pending === i ? ' pending' : ''}" type="button" data-seq="${i}" ${n.sequences.reachable.includes(i) ? '' : 'disabled'} title="${esc(tr(n.sequences.reachable.includes(i) ? 'map_seqGo' : 'map_seqNo'))}">${i < 9 ? (i + 1) + ' · ' : ''}${esc(lab)}</button>`).join('')}
            <span class="lm-wait">${esc(tr('map_seqHint'))}</span></span>` : ''}
          ${n.layers > 1 ? `<span class="lm-layers" id="lmLayers"><b>${esc(tr(n.layerKind === 'loops' ? 'map_loops' : 'map_layers'))}</b>
            <button class="btn${n.layerManual ? '' : ' primary'}" type="button" data-layer="auto" title="${esc(tr('map_layerAutoHint'))}">${esc(tr('map_layerAuto'))}</button>${Array.from({ length: n.layers }, (_, i) => `<button class="btn${n.layerManual && n.layerLevel === i ? ' primary' : ''}" type="button" data-layer="${i}" title="${esc(n.layerKind === 'loops' ? ((n.layerLabels && n.layerLabels[i]) || tr('map_loopHint', { n: i + 1 })) : tr('map_layerHint', { n: i + 1 }))}">${n.layerKind === 'loops' && n.layerLabels && n.layerLabels[i] ? esc(n.layerLabels[i].length > 14 ? n.layerLabels[i].slice(0, 13) + '…' : n.layerLabels[i]) : i + 1}</button>`).join('')}
            <span class="lm-wait">${esc(n.layerKind === 'loops' ? ((n.layerLabels && n.layerLabels[n.layerLevel || 0]) || tr('map_loopHint', { n: (n.layerLevel || 0) + 1 })) : tr('map_layerNow', { n: (n.layerLevel || 0) + 1, total: n.layers }))}${n.fallback ? ' · ' + esc(tr(n.layerKind === 'loops' ? 'map_loopFallback' : 'map_layerFallback')) : ''}</span></span>` : ''}`;
    }
    // Balade libre (monde ouvert) : où l'on est, ce qui joue et pourquoi (cercle, déplacement, zone), modes de déplacement, combat, sous-cartes.
    function freeNowHtml(map, n) {
      const a = st.avatar || { x: 0, y: 0 }, circle = circlesAt(map, a.x, a.y)[0], zone = zonesAt(map, a.x, a.y)[0];
      const where = circle ? (circle.label || tr('map_type_' + circle.type)) : zone ? (zone.label || tr('map_zone')) : tr('map_nowOutside');
      const gov = st.gov, govItem = gov && targetOf(map, gov);
      const why = !gov ? '' : gov.kind === 'mode' ? tr('map_whyMode', { name: govItem.label || tr('map_mode_walk') }) : gov.kind === 'node' ? tr('map_whyCircle', { name: govItem.label || tr('map_type_' + govItem.type) }) : tr('map_whyZone', { name: govItem.label || tr('map_zone') });
      const canCombat = !!(governorAt(map, a.x, a.y, st.modeId, true) && hasAltMusic(map, governorAt(map, a.x, a.y, st.modeId, true)));
      const altItem = canCombat ? targetOf(map, governorAt(map, a.x, a.y, st.modeId, true)) : null;
      const link = linkAt(map, a.x, a.y, savedMapIds()), modes = modesOf(map);
      return (n.loading > 0 || n.notReady ? `<span class="lm-wait lm-loading">⏳ ${esc(n.notReady && n.notReady !== true ? tr('map_loadingNamed', { title: n.notReady }) : tr('map_loading'))}</span>` : '') +
        `<span><b>${esc(tr('map_nowAt'))}</b> ${esc(where)}</span><span>♪ ${esc((n.music && n.music.title) || tr('map_nowSilence'))}${why ? ` <span class="lm-wait">(${esc(why)})</span>` : ''}</span>${n.room ? `<span>🌫 ${esc(n.room.title || n.room.id)}</span>` : ''}
        ${n.pendingAt != null ? `<span class="lm-wait">${esc(tr('map_nowWaiting'))}</span>` : ''}
        ${modes.length > 1 ? `<span class="lm-layers"><b>${esc(tr('map_modesNow'))}</b>${modes.map(m => `<button class="btn${m.id === st.modeId ? ' primary' : ''}" type="button" data-walkmode="${esc(m.id)}">${esc(m.label || tr('map_mode_walk'))}${hasMain(m) ? ' ♪' : ''}</button>`).join('')}<span class="lm-wait">${esc(tr('map_modesKey'))}</span></span>` : ''}
        ${musicControlsHtml(n)}
        <button class="btn${st.freeCombat ? ' primary' : ''}" type="button" id="lmCombat" ${canCombat || st.freeCombat ? '' : 'disabled'}>${esc(st.freeCombat ? tr('map_altBack') : tr('map_altGo', { name: (altItem && altNameOf(altItem)) || tr('map_altDefault') }))}</button>
        ${link ? `<button class="btn primary" type="button" id="lmEnter">🚪 ${esc(tr('map_enter', { title: mapTitle(link.mapId) }))}</button>` : ''}${st.trail.length ? `<button class="btn" type="button" id="lmExit">↩ ${esc(tr('map_exit', { title: mapTitle(st.trail[st.trail.length - 1].mapId) }))}</button>` : ''}
        <button class="btn" type="button" id="lmStopPlay">${esc(tr(n.playing ? 'map_pause' : 'map_resume'))}</button>
        <span class="lm-wait" style="flex-basis:100%">${esc(tr('map_freeKeys'))}</span>`;
    }
    function wireNow(box, n) {
      const refocus = () => host.querySelector('#lmCanvas').focus();
      const pool = box.querySelector('#lmPool'); if (pool) pool.onclick = () => { audio.refreshPool(); refocus(); };
      box.querySelectorAll('[data-seq]').forEach(b => { b.onclick = () => { audio.goToSequence(+b.dataset.seq); refocus(); }; });
      box.querySelectorAll('[data-layer]').forEach(b => { b.onclick = () => { audio.setIntensity(b.dataset.layer === 'auto' ? null : +b.dataset.layer); refocus(); }; });
      box.querySelectorAll('[data-walkmode]').forEach(b => { b.onclick = () => { setMode(b.dataset.walkmode || null); refocus(); }; });
      const c = box.querySelector('#lmCombat');
      if (c) c.onclick = () => { if (freeWalk()) { st.freeCombat = !st.freeCombat; followHere(true); } else audio.setCombat(!n.combat); refocus(); };
      const en = box.querySelector('#lmEnter'); if (en) en.onclick = () => { enterHere(); };
      const ex = box.querySelector('#lmExit'); if (ex) ex.onclick = () => { exitSubMap(); };
      const sp = box.querySelector('#lmStopPlay'); if (sp) sp.onclick = () => { if (n.playing) audio.stop(1); else if (freeWalk()) followHere(true, true); else audio.resume(); };
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
      if (!on) { audio.stop(1); stopWalk(); st.now = null; st.avatar = null; st.gov = null; st.freeCombat = false; }
      st.play = !!on; st.connecting = false; st.linkFrom = null; st.drawing = null; st.bgEdit = false;
      render();
      // On se place tout de suite : sur l'élément sélectionné, à défaut sur le Début de la carte (puis flèches, clic, Espace, C).
      // Carte avec des zones : balade libre, le personnage part du Début (ou de l'élément sélectionné).
      if (on) { audio.setMap(curData()); const c = host.querySelector('#lmCanvas'); if (c) c.focus(); if (hasZones(curData())) placeAvatar(null); else startFromSelection(); }
    }

    // ---- Balade libre (monde ouvert, 27/10) : un clic donne une destination, les flèches ou ZQSD pilotent ; la musique suit la règle
    // « cercle d'un élément > mode de déplacement > zone » (model.governorAt), le fond d'ambiance celui de l'endroit (model.roomAt).
    function startPointOf(map) {
      const sel = st.sel && targetOf(map, st.sel), p = sel && st.sel.kind !== 'edge' && st.sel.kind !== 'mode' ? pointOf(map, st.sel) : null;
      if (p) return p;
      const start = map.nodes.find(n => n.type === 'start'); if (start) return { x: start.x, y: start.y };
      if (map.zones && map.zones.length) { const big = map.zones.slice().sort((a, b) => zoneArea(b) - zoneArea(a))[0]; return zoneCenter(big); }
      return viewCenter();
    }
    function placeAvatar(at) {
      const map = curData(); if (!map) return;
      const ms = modesOf(map);
      if (!ms.some(m => m.id === st.modeId)) st.modeId = ms[0].id;
      st.avatar = at ? { x: at.x, y: at.y } : startPointOf(map); st.dest = null;
      keepAvatarVisible(true); followHere(true, true);
    }
    // Recalcule qui joue là où se tient le personnage ; ne redessine que si quelque chose change (appelé à chaque image du déplacement).
    // Le combat reste enclenché jusqu'à ce qu'on l'arrête (bouton ou C) : là où rien n'a de 2e musique, la musique ordinaire joue.
    let freeSig = '';
    function followHere(force, resume) {
      const map = curData(); if (!map || !audio || !st.avatar) return;
      const a = st.avatar, gov = governorAt(map, a.x, a.y, st.modeId, st.freeCombat), room = roomAt(map, a.x, a.y);
      const link = linkAt(map, a.x, a.y, savedMapIds()), circle = circlesAt(map, a.x, a.y)[0], zone = zonesAt(map, a.x, a.y)[0];
      const sig = JSON.stringify([gov, refKey(room), link && link.mapId, circle && circle.id, zone && zone.id, st.modeId, st.freeCombat]);
      const changed = sig !== freeSig || force;
      freeSig = sig; st.gov = gov;
      if (!changed) return;
      if (resume || (st.now && st.now.playing) || !st.now) audio.follow(gov, { combat: st.freeCombat, room });
      drawCanvas(); refreshNow();
    }
    function setMode(id) { st.modeId = id; followHere(true); }
    const walkKeys = new Set();
    const WALK_CODES = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
    const walkKey = ev => WALK_CODES[ev.code] || WALK_CODES[ev.key] || null; // touches physiques : ZQSD sur un clavier français, WASD sinon
    let walkRaf = null, walkLast = 0;
    function setDestination(w) { if (!st.avatar) return; st.dest = { x: w.x, y: w.y }; walkKeys.clear(); startWalkLoop(); drawCanvas(); }
    function stopWalk() { if (walkRaf) cancelAnimationFrame(walkRaf); walkRaf = null; walkKeys.clear(); st.dest = null; }
    function startWalkLoop() {
      if (walkRaf || typeof requestAnimationFrame !== 'function') return;
      walkLast = performance.now();
      const tick = now => {
        walkRaf = null;
        const map = curData(); if (!map || !freeWalk() || !st.avatar) return;
        const dt = Math.min(0.1, Math.max(0, (now - walkLast) / 1000)); walkLast = now;
        const step = speedOf(map, st.modeId) * dt, a = st.avatar;
        let dx = 0, dy = 0;
        if (walkKeys.size) { if (walkKeys.has('up')) dy--; if (walkKeys.has('down')) dy++; if (walkKeys.has('left')) dx--; if (walkKeys.has('right')) dx++; }
        else if (st.dest) { dx = st.dest.x - a.x; dy = st.dest.y - a.y; const d = Math.hypot(dx, dy); if (d <= step) { a.x = st.dest.x; a.y = st.dest.y; st.dest = null; dx = dy = 0; drawCanvas(); } }
        const len = Math.hypot(dx, dy);
        if (len) { a.x += (dx / len) * step; a.y += (dy / len) * step; }
        const el = host.querySelector('#lmAvatar'); if (el) el.setAttribute('transform', `translate(${a.x} ${a.y}) scale(${1 / st.view.k})`);
        if (keepAvatarVisible(false)) drawCanvas();
        followHere(false);
        if (walkKeys.size || st.dest) walkRaf = requestAnimationFrame(tick);
      };
      walkRaf = requestAnimationFrame(tick);
    }
    // La vue suit le personnage quand il s'approche du bord (centre = d'emblée, à l'arrivée sur une carte).
    function keepAvatarVisible(center) {
      const c = host.querySelector('#lmCanvas'); if (!c || !st.avatar) return false;
      const w = c.clientWidth || 600, h = c.clientHeight || 400, k = st.view.k, sx = st.avatar.x * k + st.view.x, sy = st.avatar.y * k + st.view.y, m = 70;
      if (center) { st.view.x = w / 2 - st.avatar.x * k; st.view.y = h / 2 - st.avatar.y * k; return true; }
      let moved = false;
      if (sx < m) { st.view.x += m - sx; moved = true; } else if (sx > w - m) { st.view.x -= sx - (w - m); moved = true; }
      if (sy < m) { st.view.y += m - sy; moved = true; } else if (sy > h - m) { st.view.y -= sy - (h - m); moved = true; }
      return moved;
    }

    // ---- Sous-cartes : entrer (bouton, touche E, double-clic dans l'éditeur), sortir (bouton, touche X, fil d'Ariane)
    function finishDrawing() {
      const map = curData(), d = st.drawing; if (!map || !d) return;
      const z = d.points.length >= 3 ? addPolyZone(map, d.points, '') : null;
      st.drawing = null;
      if (z) { st.sel = { kind: 'zone', id: z.id }; touch(); } else setStatus(tr('map_zonePolyTooSmall'));
      render();
    }
    // Où l'on se trouve, pour y revenir en sortant de la sous-carte.
    function hereForTrail(from) {
      if (freeWalk() && st.avatar) return { from, at: { x: Math.round(st.avatar.x), y: Math.round(st.avatar.y) } };
      return { from, at: null };
    }
    function enterLink(from, mapId) {
      if (!mapId || !savedMapIds().includes(mapId)) { setStatus(tr('map_linkMissing')); return; }
      flush();
      const h = hereForTrail(from), r = trailEnter(st.trail, st.current, h.from, h.at, mapId);
      st.trail = r.trail;
      switchMap(mapId, r.back); // r.back : la carte était déjà dans le fil, on y revient (pas de boucle)
    }
    function openSubMap(target) { const map = curData(), item = map && targetOf(map, target); if (item && item.link) enterLink(target, item.link); }
    function enterHere() {
      const map = curData(); if (!map || !st.play) return;
      if (freeWalk()) { const l = st.avatar && linkAt(map, st.avatar.x, st.avatar.y, savedMapIds()); if (l) enterLink({ kind: l.kind, id: l.id }, l.mapId); return; }
      const pos = st.now && st.now.position, item = pos && targetOf(map, pos);
      if (item && item.link) enterLink({ kind: pos.kind, id: pos.id }, item.link);
    }
    function exitSubMap() { if (st.trail.length) goBackTo(st.trail.length - 1); }
    function goBackTo(i) {
      const back = st.trail[i]; if (!back) return;
      flush();
      st.trail = st.trail.slice(0, i);
      switchMap(back.mapId, back);
    }
    // Change de carte en gardant la musique en cours (le lecteur passe à la nouvelle avec la transition habituelle) ; back : l'endroit
    // d'où l'on était parti dans cette carte (en sortant d'une sous-carte), sinon on arrive à son Début.
    function switchMap(mapId, back) {
      if (!st.maps.some(m => m.id === mapId)) return;
      stopWalk();
      st.current = mapId; st.sel = null; st.linkFrom = null; st.drawing = null; st.bgEdit = false; st.view = { x: 0, y: 0, k: 1 };
      st.avatar = null; st.gov = null; freeSig = '';
      render(); fit();
      const map = curData();
      if (!st.play || !audio) { if (back && back.from && targetOf(map, back.from)) { st.sel = back.from; drawCanvas(); renderInspector(); } return; }
      audio.setMap(map);
      if (hasZones(map)) { placeAvatar(back && back.at ? back.at : (back && back.from && back.from.kind !== 'edge' && targetOf(map, back.from) ? pointOf(map, back.from) : null)); return; }
      const target = back && back.from && targetOf(map, back.from) && back.from.kind !== 'zone' ? back.from : null;
      st.sel = target; startFromSelection().then(() => { const pos = audio.state.position; if (pos) { st.sel = { kind: pos.kind, id: pos.id }; drawCanvas(); renderInspector(); } });
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
        el.addEventListener('click', () => { st.picked = JSON.parse(el.dataset.ref); box.querySelectorAll('.lm-sound').forEach(x => { x.style.outline = x === el ? '2px solid var(--accent)' : ''; }); renderInspector(); renderSettings(); });
      });
    }

    render();
    fit();
    return { flush, state: st, render, audio, destroy() { clearTimeout(saveTimer); stopWalk(); host.onkeydown = null; host.onkeyup = null; if (audio) audio.stop(0.2); } };
  }

  window.LayerPitchLevelMap = { model, mount };
})();
