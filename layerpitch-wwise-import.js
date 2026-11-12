/* layerpitch-wwise-import.js — lecture d'un projet Wwise (fichiers .wwu, XML) et transcription en brouillon LayerPitch.
   Fonctions pures, sans accès disque ni réseau : une liste { path, text } entre, un modèle + un brouillon + un rapport sortent.
   Même principe que layerpitch-import-engine.js (une seule copie, utilisable par le Backstage, le CLI et le futur serveur MCP).
   Première étape (09/11) : lecture de la musique interactive (segments, pistes, courbes RTPC), des paramètres de jeu et des
   événements. Tout ce qui est deviné ou approché est marqué dans `notes` — le rapport ne ment jamais par omission. */
(function (root) {
'use strict';

// ---- Mini lecteur XML (les .wwu sont du XML bien formé, sans CDATA ni espaces de noms) ----
function parseXml(text) {
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const rootNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [rootNode];
  let m;
  while ((m = re.exec(text))) {
    if (m[5] !== undefined) { stack[stack.length - 1].text += decode(m[5]); continue; }
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    m[3].replace(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k] = decode(a !== undefined ? a : b); return ''; });
    const node = { tag: m[2], attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return rootNode.children[0] || null;
}
const kids = (n, tag) => (n ? n.children.filter(c => c.tag === tag) : []);
const kid = (n, tag) => kids(n, tag)[0] || null;
function* iter(n) { if (!n) return; yield n; for (const c of n.children) yield* iter(c); }
function props(n) {
  const out = {};
  for (const p of kids(kid(n, 'PropertyList'), 'Property')) out[p.attrs.Name] = p.attrs.Value;
  return out;
}
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

// ---- Courbes : points { x, y } triés ----
function curvePoints(curveNode) {
  return kids(kid(curveNode, 'PointList'), 'Point').map(p => ({ x: num(kid(p, 'XPos') && kid(p, 'XPos').text, 0), y: num(kid(p, 'YPos') && kid(p, 'YPos').text, 0) })).sort((a, b) => a.x - b.x);
}

// ---- Lecture du projet ----
// files : [{ path: 'Interactive Music Hierarchy/Battle.wwu', text: '<?xml…' }, …]
function readWwiseProject(files) {
  const model = { gameParameters: [], switchGroups: [], stateGroups: [], segments: [], containers: [], events: [], notes: [] };
  const byId = {}; // ID -> { kind, name }
  const docs = [];
  for (const f of files) {
    if (!/\.wwu$/i.test(f.path)) continue;
    let doc = null;
    try { doc = parseXml(f.text); } catch (e) { model.notes.push('Fichier illisible : ' + f.path); }
    if (doc) docs.push({ path: f.path, doc });
  }
  for (const { doc } of docs) for (const n of iter(doc)) if (n.attrs.ID && n.attrs.Name !== undefined) byId[n.attrs.ID] = { tag: n.tag, name: n.attrs.Name };
  const nameOf = ref => { const o = ref && kid(ref, 'ObjectRef'); return o ? (o.attrs.Name || (byId[o.attrs.ID] || {}).name || '?') : ''; };
  const refTo = (n, refName) => { const r = kids(kid(n, 'ReferenceList'), 'Reference').find(x => x.attrs.Name === refName); return r ? nameOf(r) : ''; };

  for (const { doc } of docs) for (const n of iter(doc)) {
    const p = props(n);
    if (n.tag === 'GameParameter') model.gameParameters.push({ name: n.attrs.Name, min: num(p.Min, 0), max: num(p.Max, 100), initial: num(p.InitialValue, 0), slewUp: num(p.SlewRateUp, 0), slewDown: num(p.SlewRateDown, 0), ramping: p.RTPCRamping === '1' });
    else if (n.tag === 'SwitchGroup') model.switchGroups.push({ name: n.attrs.Name, switches: kids(kid(n, 'ChildrenList'), 'Switch').map(s => s.attrs.Name) });
    else if (n.tag === 'StateGroup') model.stateGroups.push({ name: n.attrs.Name, states: kids(kid(n, 'ChildrenList'), 'State').map(s => s.attrs.Name) });
    else if (n.tag === 'MusicSegment') model.segments.push(readSegment(n, p));
    else if (n.tag === 'MusicPlaylistContainer' || n.tag === 'MusicSwitchContainer') model.containers.push(readContainer(n));
    else if (n.tag === 'Event') model.events.push(readEvent(n));
  }

  function readSegment(n, p) {
    const seg = { name: n.attrs.Name, durationMs: num(p.EndPosition, null), tempo: null, tracks: [], cues: [], tempoNote: null };
    for (const c of iter(n)) {
      const cp = props(c);
      if (c.tag === 'MusicCue') seg.cues.push({ name: c.attrs.Name, timeMs: num(cp.TimeMs, 0), type: cp.CueType === '1' ? 'exit' : (c.attrs.Name === 'Entry Cue' ? 'entry' : 'custom') });
    }
    for (const t of kids(kid(n, 'ChildrenList'), 'MusicTrack')) {
      const src = kid(kid(t, 'ChildrenList'), 'AudioFileSource');
      const track = { name: t.attrs.Name, file: src ? (kid(src, 'AudioFile') || { text: '' }).text.trim() : '', rtpcs: [], clipCurves: [] };
      for (const r of iter(t)) {
        if (r.tag === 'RTPC') {
          const rp = props(r);
          const gp = kid(kid(r, 'ReferenceList') && kids(kid(r, 'ReferenceList'), 'Reference').find(x => x.attrs.Name === 'ControlInput') || null, 'ObjectRef');
          const curve = kid(kid(r, 'Curve'), 'PointList') ? kid(r, 'Curve') : [...iter(r)].find(x => x.tag === 'Curve');
          track.rtpcs.push({ property: rp.PropertyName, parameter: gp ? (gp.attrs.Name || (byId[gp.attrs.ID] || {}).name) : '?', points: curve ? curvePoints(curve) : [] });
        } else if (r.tag === 'PropertyCurve') {
          const curve = [...iter(r)].find(x => x.tag === 'Curve');
          track.clipCurves.push({ property: r.attrs.PropertyName, points: curve ? curvePoints(curve) : [] });
        }
      }
      seg.tracks.push(track);
    }
    // Tempo : propriétés de grille du segment (absentes ici -> à lire dans les noms de fichiers, voir layerpitch-import-engine.js)
    if (p.Tempo) seg.tempo = num(p.Tempo, null);
    else seg.tempoNote = 'Tempo non réglé dans le projet : hérité des parents (« Override Parent » décoché), donc valeur par défaut de Wwise, 120 bpm en 4/4, grille de 4 mesures (confirmé dans Wwise le 09/11). Ce n\'est PAS forcément le vrai tempo de la musique.';
    return seg;
  }
  function readContainer(n) {
    const c = { kind: n.tag === 'MusicSwitchContainer' ? 'switch' : 'playlist', name: n.attrs.Name, loops: null, segments: [] };
    for (const r of iter(n)) {
      if (r.tag === 'MusicPlaylistItem') {
        const rp = props(r);
        if (rp.LoopCount !== undefined && c.loops === null) c.loops = num(rp.LoopCount, 1); // 0 = infini dans Wwise
        const seg = refTo(r, 'Segment');
        if (seg) c.segments.push(seg);
      }
    }
    return c;
  }
  function readEvent(n) {
    const ev = { name: n.attrs.Name, actions: [] };
    for (const a of iter(n)) if (a.tag === 'Action') {
      const ap = props(a);
      ev.actions.push({ type: num(ap.ActionType, 0), delaySec: num(ap.Delay, 0), fadeSec: num(ap.FadeTime, 0), lowpass: ap.Lowpass !== undefined ? num(ap.Lowpass, null) : null, target: refTo(a, 'Target') });
    }
    return ev;
  }

  // Rattache pistes et conteneurs : un segment référencé par un conteneur lui est contenu (objets enfants du conteneur)
  return model;
}

// ---- Codes d'action du .wwu. Absent = Play (valeur par défaut, non écrite). 2, 26, 27 CONFIRMÉS le 09/11 en recoupant, par leur ShortID, les
// actions d'un .wwu avec celles de la banque compilée .bnk du même projet, dont les codes sont ceux du SDK (Stop 0x01, Play 0x04, SetLPF 0x0E,
// ResetLPF 0x0F). 3 et 4 (pause, reprise) : déduits des projets d'exemple d'Audiokinetic, NON confirmés -> signalés. ----
const ACTION_NAMES = { 1: 'play', 2: 'stop', 3: 'pause', 4: 'resume', 26: 'setLowpass', 27: 'resetLowpass' };
const ACTION_GUESSED = { 1: true, 3: true, 4: true };

// ---- Conversions ----
// Filtre passe-bas Wwise (0 = ouvert, 100 = très fermé) -> fréquence de coupure. APPROXIMATION logarithmique de 20 kHz à ~ 100 Hz :
// la vraie correspondance de Wwise n'est pas une formule publique simple, à affiner à l'oreille.
function wwiseLowpassToHz(v) { return Math.round(20000 * Math.pow(100 / 20000, Math.min(100, Math.max(0, v)) / 100)); }
// Premier x où le volume d'une courbe RTPC sort du silence (> -96 dB) ; null si jamais, 0 si dès le début.
function curveAudibleFrom(points) {
  if (!points.length) return null;
  for (let i = 0; i < points.length; i++) if (points[i].y > -96) return i === 0 ? points[0].x : (points[i - 1].y <= -96 ? points[i - 1].x + (points[i].x - points[i - 1].x) * ((-96 - points[i - 1].y) / (points[i].y - points[i - 1].y)) : points[i].x);
  return null;
}
function curveFullFrom(points) { // premier x où la courbe atteint (presque) le volume plein (> -3 dB)
  const i = points.findIndex(p => p.y > -3); return i < 0 ? null : points[i].x;
}
function curveSilentFrom(points) { // premier x (après avoir été audible) où la courbe retombe sous -96 dB
  let was = false;
  for (let i = 0; i < points.length; i++) { if (points[i].y > -96) was = true; else if (was) return points[i - 1].x + (points[i].x - points[i - 1].x) * ((-96 - points[i - 1].y) / (points[i].y - points[i - 1].y)); }
  return null;
}


// ---- Liaisons au format des curseurs LayerPitch : { target, param, from, to, curve:[{x,y}] }, x = position du curseur (0..1), y = avancement
// entre `from` (curseur à 0 %) et `to` (100 %). Les dB sont bornés à -60..+12 (échelle de LayerPitch) ; -200 dB de Wwise = silence = -60.
function unitX(g, x) { return Math.max(0, Math.min(1, (x - g.min) / ((g.max - g.min) || 1))); }
function curveFrom(points, g, valueToProgress) {
  const out = []; points.forEach(p => { const x = Math.round(unitX(g, p.x) * 1000) / 1000, y = Math.round(valueToProgress(p.y) * 1000) / 1000; if (!out.length || x > out[out.length - 1].x || y !== out[out.length - 1].y) out.push({ x, y }); });
  return out.length >= 2 ? out : null;
}
function volumeBinding(li, points, g) {
  const db = points.map(p => { let y = Math.max(-60, Math.min(12, Math.round(p.y * 10) / 10)); return { x: p.x, y: Math.abs(y) < 0.5 ? 0 : y }; });
  const from = Math.min.apply(null, db.map(p => p.y)), to = Math.max.apply(null, db.map(p => p.y));
  if (!(to > from)) return null;
  const curve = curveFrom(db, g, y => (y - from) / (to - from));
  return curve ? { target: { type: 'layer', li }, param: 'volume.db', from, to, curve } : null;
}
function lowpassBinding(li, points, g) {
  const hz = points.map(p => ({ x: p.x, y: wwiseLowpassToHz(p.y) }));
  const from = Math.min.apply(null, hz.map(p => p.y)), to = Math.max.apply(null, hz.map(p => p.y));
  if (!(to > from)) return null;
  const curve = curveFrom(hz, g, y => Math.log(y / from) / Math.log(to / from));
  return curve ? { target: { type: 'layer', li }, param: 'highcut.frequency', from, to, curve } : null;
}

// ---- Brouillon LayerPitch : un morceau vertical par conteneur de lecture ----
function draftFromModel(model) {
  const out = { tracks: [], notes: [], unmapped: [] };
  const segByName = Object.fromEntries(model.segments.map(s => [s.name, s]));
  const paramByName = Object.fromEntries(model.gameParameters.map(g => [g.name, g]));
  const norm = (param, x) => { const g = paramByName[param] || { min: 0, max: 100 }; return Math.round(((x - g.min) / ((g.max - g.min) || 1)) * 1000) / 1000; };

  for (const c of model.containers) {
    const seg = segByName[c.segments[0]];
    if (!seg) { out.notes.push(`Conteneur « ${c.name} » : segment introuvable.`); continue; }
    if (c.kind === 'switch') out.unmapped.push(`Music Switch Container « ${c.name} » : pas encore transcrit (sera embranchement ou séquentiel).`);
    const track = { title: c.name, mode: 'vertical', segment: seg.name, durationSec: seg.durationMs != null ? seg.durationMs / 1000 : null, loop: c.loops === 0 ? 'infini' : c.loops, layers: [], fxSliders: [], fxTriggers: [] };
    const sliderBy = {};
    const getSlider = pn => sliderBy[pn] || (sliderBy[pn] = (track.fxSliders.push({ id: 'sl_' + pn, label: pn, parameter: pn, range: [(paramByName[pn] || {}).min, (paramByName[pn] || {}).max], defaultValue: 0, smoothSec: (paramByName[pn] || {}).ramping && paramByName[pn].slewUp ? Math.round(((paramByName[pn].max - paramByName[pn].min) / paramByName[pn].slewUp) * 100) / 100 : 0, bindings: [], thresholds: [] }), track.fxSliders[track.fxSliders.length - 1]));
    seg.tracks.forEach((t, li) => {
      const layer = { label: t.name, file: t.file };
      for (const r of t.rtpcs) {
        const sl = getSlider(r.parameter);
        if (r.property === 'Volume') {
          const from = curveAudibleFrom(r.points), to = curveSilentFrom(r.points);
          const full = curveFullFrom(r.points);
          layer.volumeByParameter = { parameter: r.parameter, audibleFrom: from == null ? null : norm(r.parameter, from), fullAt: full == null ? null : norm(r.parameter, full), silentFrom: to == null ? null : norm(r.parameter, to), rawCurve: r.points };
          const b = volumeBinding(li, r.points, paramByName[r.parameter] || { min: 0, max: 100 }); if (b) sl.bindings.push(b);
        } else if (r.property === 'Lowpass') {
          const b = lowpassBinding(li, r.points, paramByName[r.parameter] || { min: 0, max: 100 }); if (b) sl.bindings.push(b);
        } else out.unmapped.push(`RTPC « ${r.property} » sur la piste « ${t.name} » (${r.parameter}) : propriété non transcrite.`);
      }
      track.layers.push(layer);
    });
    // Zones d'intensité : seuils d'apparition des couches pilotées par un même paramètre en volume
    for (const sl of track.fxSliders) {
      const appear = track.layers.filter(l => l.volumeByParameter && l.volumeByParameter.parameter === sl.parameter && l.volumeByParameter.audibleFrom != null);
      if (appear.length) sl.intensityAppearAt = appear.map(l => ({ layer: l.label, at: l.volumeByParameter.audibleFrom }));
    }
    for (const cue of seg.cues) if (cue.type === 'exit') track.exitCueSec = cue.timeMs / 1000;
    if (seg.tempoNote) out.notes.push(`« ${seg.name} » : ${seg.tempoNote} Si le vrai tempo est connu, le saisir ou le lire dans le nom des fichiers.`);
    out.tracks.push(track);
  }

  // Segments hors conteneur : morceaux d'une seule piste (utilisés par des événements)
  const contained = new Set(model.containers.flatMap(c => c.segments));
  const loose = model.segments.filter(s => !contained.has(s.name));
  out.looseSegments = loose.map(s => { const ex = s.cues.find(c => c.type === 'exit'); if (ex && s.durationMs != null && Math.abs(ex.timeMs - s.durationMs) > 1) out.notes.push(`« ${s.name} » : fin du segment à ${s.durationMs / 1000} s mais Exit Cue à ${ex.timeMs / 1000} s ; retenu : Exit Cue (la durée jouée du clip).`); return { name: s.name, durationSec: ex ? ex.timeMs / 1000 : (s.durationMs != null ? s.durationMs / 1000 : null), files: s.tracks.map(t => t.file), clipCurves: s.tracks.flatMap(t => t.clipCurves.map(c => c.property)) }; });

  // Événements -> événements LayerPitch (étapes à retardement)
  for (const ev of model.events) {
    const steps = ev.actions.map(a => {
      const kind = a.type === 0 ? 'play' : (ACTION_NAMES[a.type] || ('action#' + a.type));
      return { action: kind, target: a.target, delaySec: a.delaySec, fadeSec: a.fadeSec, ...(a.lowpass != null ? { lowpassHz: wwiseLowpassToHz(a.lowpass), wwiseLowpass: a.lowpass } : {}), guessed: !!ACTION_GUESSED[a.type] };
    });
    out.events = (out.events || []).concat([{ name: ev.name, steps }]);
    if (steps.some(s => s.guessed)) out.notes.push(`Événement « ${ev.name} » : codes d'action ${[...new Set(ev.actions.map(a => a.type).filter(t => ACTION_GUESSED[t]))].join(', ')} non confirmés (déduits) ; les autres codes sont confirmés par la banque compilée.`);
  }
  if (model.switchGroups.some(g => g.switches.length)) out.notes.push('Switches présents (' + model.switchGroups.map(g => g.name).join(', ') + ') : non utilisés par la musique ici, non transcrits.');
  out.notes.push('Conversion du filtre passe-bas Wwise (0 à 100) vers une fréquence : approximation logarithmique 20 kHz → ~100 Hz, à écouter et ajuster.');
  return out;
}


// ---- Morceau LayerPitch (même forme que le Backstage : voir src/backstage/20b-actions-bibliotheque-morceaux.js) ----
// Renvoie { tracks: [{ track, audioFiles, meta }], notes }. `track` est prêt à être relu ; les fichiers audio ne sont PAS envoyés ici
// (remoteFile/pendingFile vides) : `audioFiles` dit quel fichier va dans quelle couche. `meta` garde ce qui n'a pas de champ (tempo, durée).
const slug = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// options.initialValues : { nomDuParamètre: valeur dans l'unité de Wwise } pour forcer la valeur de départ d'un curseur (le .wwu n'écrit pas la
// valeur initiale quand elle est celle par défaut ; elle ne se lit alors pas dans les fichiers).
function buildLayerPitchTracks(model, draft, options) {
  const initial = (options && options.initialValues) || {};
  const out = { tracks: [], notes: draft.notes.slice() };
  const params = Object.fromEntries(model.gameParameters.map(g => [g.name, g]));
  for (const d of draft.tracks) {
    const layers = d.layers.map((l, i) => ({ id: 'wl-' + slug(d.title) + '-' + (i + 1), label: l.label, remoteFile: null, pendingFile: null }));
    const fxSliders = d.fxSliders.filter(sl => sl.bindings.length).map(sl => ({
      id: 'sl-' + slug(sl.parameter), label: sl.parameter, visible: true,
      defaultValue: Math.max(0, Math.min(1, (((sl.parameter in initial ? +initial[sl.parameter] : ((params[sl.parameter] || {}).initial)) || 0) - sl.range[0]) / ((sl.range[1] - sl.range[0]) || 1))),
      smoothSec: sl.smoothSec, bindings: sl.bindings, thresholds: []
    }));
    const loopSec = d.durationSec, bpm = 120;
    const track = { id: 'wt-' + slug(d.title), title: d.title, description: '', mode: 'vertical', duration: loopSec || 0, base: '', loopable: d.loop === 'infini', startTrackBeat: 0, maxLoops: null, maxChainLoops: null,
      normalizeVolume: false, layers, stingers: [], sfxIds: [], folderId: null, fxSliders, fxTriggers: [] };
    // Événements dont la cible est ce morceau : l'effet de filtre devient un événement LayerPitch (étapes + extinction automatique).
    for (const e of draft.events || []) {
      const setLp = e.steps.find(s => s.action === 'setLowpass' && (s.target === d.segment || s.target === d.title));
      if (!setLp) continue;
      const reset = e.steps.find(s => s.action === 'resetLowpass' && s.target === setLp.target);
      track.fxTriggers.push({ id: 'ev-' + slug(e.name), label: e.name, target: { type: 'track' }, fx: { highcut: { frequency: setLp.lowpassHz, slope: 24 } }, visible: true, showEffects: true, fadeSec: setLp.fadeSec || 0, steps: [],
        relations: reset ? { autoOffSec: reset.delaySec - setLp.delaySec } : {} });
      if (reset && reset.fadeSec !== setLp.fadeSec) out.notes.push(`Événement « ${e.name} » : fondu d'entrée ${setLp.fadeSec} s mais de sortie ${reset.fadeSec} s dans Wwise ; LayerPitch n'a qu'un fondu : ${setLp.fadeSec} s retenu.`);
      const other = e.steps.filter(s => s !== setLp && s !== reset);
      if (other.length) out.notes.push(`Événement « ${e.name} » : ${other.map(s => s.action + ' « ' + s.target + ' » à +' + s.delaySec + ' s').join(', ')} non transcrit (un événement LayerPitch règle des effets ; il ne lance pas de son).`);
    }
    out.tracks.push({ track, audioFiles: d.layers.map((l, i) => ({ layer: layers[i].id, file: l.file })), meta: { source: 'wwise', tempoBpm: bpm, timeSignature: '4/4', tempoIsWwiseDefault: true, exitCueSec: d.exitCueSec == null ? null : d.exitCueSec, loopSec } });
  }
  for (const s of draft.looseSegments || []) out.notes.push(`Segment « ${s.name} » (${s.files.join(', ')}, ${s.durationSec} s) : pas de morceau créé ; il sert d'événement (battement de cœur) et reste à placer comme Sfx.`);
  for (const sl of out.tracks.flatMap(t => t.track.fxSliders)) if (sl.defaultValue === 0 && /health|vie|sante/i.test(sl.label)) out.notes.push(`Curseur « ${sl.label} » : valeur initiale non écrite dans le projet (défaut de Wwise, lu comme 0) : « vie vide » au démarrage (filtre fermé, battement audible). Pour démarrer à 100 % : --initial ${sl.label}=100.`);
  return out;
}

// ---- Rapport texte (Markdown) ----
function reportMarkdown(model, draft) {
  const L = [];
  const pct = v => v == null ? '—' : Math.round(v * 100) + ' %';
  L.push('# Rapport de transcription Wwise → LayerPitch', '');
  L.push(`Paramètres de jeu : ${model.gameParameters.map(g => `${g.name} (${g.min}–${g.max})`).join(', ') || 'aucun'}`);
  L.push(`Segments : ${model.segments.length} · Conteneurs de lecture : ${model.containers.length} · Événements : ${model.events.length}`, '');
  for (const t of draft.tracks) {
    L.push(`## Morceau « ${t.title} » → mode vertical`, '');
    L.push(`Segment « ${t.segment} », ${t.durationSec != null ? t.durationSec.toFixed(2) + ' s' : 'durée inconnue'}, boucle ${t.loop}${t.exitCueSec != null ? `, Exit Cue à ${t.exitCueSec.toFixed(2)} s` : ''}.`, '');
    L.push('| # | Couche | Fichier | Piloté par | Commence à monter | Plein volume | Disparaît à |', '|---|---|---|---|---|---|---|');
    t.layers.forEach((l, i) => { const v = l.volumeByParameter; L.push(`| ${i + 1} | ${l.label} | ${l.file} | ${v ? v.parameter : '(toujours audible)'} | ${v ? pct(v.audibleFrom) : '—'} | ${v ? pct(v.fullAt) : '—'} | ${v ? pct(v.silentFrom) : '—'} |`); });
    L.push('');
    for (const sl of t.fxSliders) {
      L.push(`Curseur « ${sl.label} » (${sl.range[0]}–${sl.range[1]}), lissage ${sl.smoothSec} s, ${sl.bindings.length} liaison(s) : ` + [...new Set(sl.bindings.map(b => b.param))].join(', '));
    }
    L.push('');
  }
  if (draft.looseSegments.length) { L.push('## Segments utilisés par les événements', ''); for (const s of draft.looseSegments) L.push(`- « ${s.name} » ${s.durationSec != null ? s.durationSec.toFixed(2) + ' s' : ''} — ${s.files.join(', ')}${s.clipCurves.length ? ' — courbes de clip : ' + [...new Set(s.clipCurves)].join(', ') : ''}`); L.push(''); }
  for (const e of draft.events || []) {
    L.push(`## Événement « ${e.name} »`, '', '| Départ | Action | Cible | Fondu | Détail |', '|---|---|---|---|---|');
    for (const s of e.steps) L.push(`| +${s.delaySec} s | ${s.action}${s.guessed ? ' (?)' : ''} | ${s.target} | ${s.fadeSec} s | ${s.lowpassHz ? 'passe-bas → ' + s.lowpassHz + ' Hz (Wwise ' + s.wwiseLowpass + ')' : ''} |`);
    L.push('');
  }
  if (draft.unmapped.length) { L.push('## Non transcrit', ''); draft.unmapped.forEach(u => L.push('- ' + u)); L.push(''); }
  L.push('## Remarques et approximations', ''); draft.notes.forEach(n => L.push('- ' + n));
  return L.join('\n');
}

const api = { parseXml, readWwiseProject, draftFromModel, buildLayerPitchTracks, reportMarkdown, wwiseLowpassToHz };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LayerPitchWwiseImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
