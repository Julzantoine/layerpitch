// ---- Spatialisation d'un Sfx : matrice "salle + auditeur au centre" (23/09) ----
// Idée de Jules-Antoine (façon vue "stage" de Damage 2/Heavyocity) : le compositeur place un Sfx (ex. des
// bruits de pas) dans une salle, à une position relative à l'auditeur qui reste au centre ; LayerPitch fait
// le travail de volume, pan, atténuation des aigus et reverb. sfxDef.spatial = { enabled, room, x, y, binaural }
// (x = mètres vers la droite, y = mètres vers l'avant, l'auditeur est en (0,0) et regarde vers l'avant).
// Quatre salles seulement, sans réglage de taille en direct (choix de Jules-Antoine) : chacune est une
// réponse impulsionnelle FABRIQUÉE ICI, pas un fichier -- premières réflexions calculées d'après la
// géométrie de la salle (méthode des sources-images) + queue diffuse dont la durée dépend de la fréquence
// (les aigus s'éteignent plus vite, comme dans une vraie salle). Avantage : rien à héberger, aucune licence
// à vérifier ; limite connue : la réponse ne dépend pas de la position de la source, seuls la part de reverb
// et le volume direct en dépendent (à départager à l'oreille avec de vraies réponses impulsionnelles si le
// rendu ne suffit pas).
const SPATIAL_ROOMS = {
  //           largeur, profondeur, hauteur (m) | RT60 graves/médiums/aigus (s) | niveau de reverb | pré-délai (s) | absorption de l'air
  room:      { dims: [5, 4, 2.8],   rt60: [0.55, 0.42, 0.26], wet: 0.45, preDelay: 0.004, airK: 0.08 },
  hall:      { dims: [26, 17, 10],  rt60: [2.3, 1.8, 1.0],    wet: 0.30, preDelay: 0.020, airK: 0.08 },
  cathedral: { dims: [50, 24, 26],  rt60: [7.0, 5.5, 2.8],    wet: 0.22, preDelay: 0.040, airK: 0.08 },
  // Plein air : pas de murs, donc pas de queue -- seulement la distance (volume + aigus absorbés plus vite).
  outside:   { dims: null,          rt60: null,               wet: 0,    preDelay: 0,     airK: 0.15 }
};
const SPATIAL_OUTSIDE_FIELD = 50; // côté (m) du terrain affiché pour "plein air"
function spatialFieldHalfExtent(roomKey) {
  const r = SPATIAL_ROOMS[roomKey] || SPATIAL_ROOMS.room;
  return r.dims ? [r.dims[0] / 2, r.dims[1] / 2] : [SPATIAL_OUTSIDE_FIELD / 2, SPATIAL_OUTSIDE_FIELD / 2];
}
function normalizeSpatial(sp) {
  const room = SPATIAL_ROOMS[sp && sp.room] ? sp.room : 'room';
  const [hx, hy] = spatialFieldHalfExtent(room);
  const clamp = (v, h) => Math.max(-h, Math.min(h, Number.isFinite(+v) ? +v : 0));
  // Trajectoire (23/09) : 'glide' = le son se déplace le long du chemin PENDANT sa lecture ; 'steps' = chaque
  // déclenchement se joue au point suivant (des pas qui avancent). Sans au moins 2 points, retombe sur 'fixed'.
  const P = sp && sp.path;
  const pts = (P && Array.isArray(P.points) ? P.points : []).slice(0, SPATIAL_MAX_PATH_POINTS).map(q => ({ x: clamp(q && q.x, hx), y: clamp(q && q.y, hy) }));
  const mode = (P && (P.mode === 'glide' || P.mode === 'steps') && pts.length >= 2) ? P.mode : 'fixed';
  const loop = P && ['loop', 'pingpong', 'random', 'stop'].indexOf(P.loop) >= 0 ? P.loop : 'loop';
  const durationSec = P && +P.durationSec > 0 ? +P.durationSec : null;
  // Niveau de reverb (dB, par rapport au réglage de la salle) et brillance de la queue (-1 sombre .. +1 clair) :
  // inspirés des curseurs "Brightness"/niveau de retour de FabFilter Pro-R et du filtrage de la reverb de
  // Cinematic Rooms (LiquidSonics) -- la reverb d'un Sfx doit pouvoir se doser sans changer de salle.
  const num = (v, lo, hi, d) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d;
  return { enabled: !!(sp && sp.enabled), room, x: clamp(sp && sp.x, hx), y: clamp(sp && sp.y, hy), binaural: !!(sp && sp.binaural),
    reverbDb: num(sp && sp.reverbDb, -18, 6, 0), brightness: num(sp && sp.brightness, -1, 1, 0),
    path: { mode, points: pts, loop, durationSec } };
}
const SPATIAL_MAX_PATH_POINTS = 16;
// Prochain point d'un trajet "pas à pas" : l'état (où on en est) est gardé par définition de Sfx, dans un
// WeakMap, pour que le bloc Sfx d'un AdReel et les boutons Sfx d'un morceau avancent chacun de leur côté.
const _spatialStepState = new WeakMap();
function pickSpatialStepIndex(key, n, loop) {
  const st = _spatialStepState.get(key) || { next: 0, dir: 1, last: -1 };
  let idx;
  if (n <= 1) idx = 0;
  else if (loop === 'random') { do { idx = Math.floor(Math.random() * n); } while (idx === st.last); }
  else if (loop === 'pingpong') {
    idx = Math.max(0, Math.min(n - 1, st.next));
    let np = idx + st.dir;
    if (np >= n || np < 0) { st.dir *= -1; np = idx + st.dir; }
    st.next = np;
  }
  else if (loop === 'stop') { idx = Math.min(st.next, n - 1); st.next++; }
  else { idx = st.next % n; st.next++; }
  st.last = idx;
  _spatialStepState.set(key, st);
  return idx;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Réponse impulsionnelle stéréo d'une salle : (1) premières réflexions par sources-images (boîte à
// chaussures, ordre <= 4, gain = (coef. de réflexion)^ordre / distance, délai = distance / 343 m/s, réparties
// gauche/droite selon leur direction), (2) queue diffuse = bruit indépendant à gauche et à droite, découpé en
// 3 bandes (graves/médiums/aigus) qui s'éteignent chacune à leur propre RT60. Déterministe (graine fixe par
// salle) : une même salle sonne pareil à chaque visite.
const _roomImpulseCache = new Map();
function buildRoomImpulse(ctx, roomKey) {
  const room = SPATIAL_ROOMS[roomKey];
  if (!room || !room.dims) return null;
  const key = ctx.sampleRate + ':' + roomKey;
  if (_roomImpulseCache.has(key)) return _roomImpulseCache.get(key);
  const sr = ctx.sampleRate;
  const [W, D, H] = room.dims;
  const [rtLo, rtMid, rtHi] = room.rt60;
  const len = Math.ceil(sr * Math.min(rtLo * 1.05, 8));
  const buffer = ctx.createBuffer(2, len, sr);
  const chan = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const rand = mulberry32(roomKey.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));

  // -- Queue diffuse --
  const aLo = Math.exp(-2 * Math.PI * 300 / sr), aHi = Math.exp(-2 * Math.PI * 4000 / sr);
  const ramp = 0.03 + room.preDelay; // la densité monte progressivement, comme dans une vraie salle
  let tailEnergy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const out = chan[ch];
    let lpLo = 0, lpHi = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const n = (rand() + rand() + rand() - 1.5) * 2;
      lpLo = (1 - aLo) * n + aLo * lpLo;
      lpHi = (1 - aHi) * n + aHi * lpHi;
      const lo = lpLo, mid = lpHi - lpLo, hi = n - lpHi;
      const eLo = Math.pow(10, -3 * t / rtLo), eMid = Math.pow(10, -3 * t / rtMid), eHi = Math.pow(10, -3 * t / rtHi);
      const gate = t < room.preDelay ? 0 : Math.min(1, (t - room.preDelay) / ramp);
      const v = (lo * 3 * eLo + mid * 1.3 * eMid + hi * eHi) * gate;
      out[i] = v;
      tailEnergy += v * v;
    }
  }

  // -- Premières réflexions (sources-images d'une boîte, auditeur au centre, source nominale à mi-distance) --
  const V = W * D * H, S = 2 * (W * D + D * H + W * H);
  const alpha = Math.min(0.9, 0.161 * V / (S * rtMid)); // absorption moyenne des parois (formule de Sabine)
  const refl = Math.sqrt(1 - alpha);
  const earH = Math.min(1.6, H * 0.6);
  const L = [W / 2, D / 2, earH];
  const src = [W / 2 + Math.min(W * 0.12, 3), D / 2 + Math.min(D * 0.18, 4), Math.min(1.2, H * 0.4)];
  const d0 = Math.hypot(src[0] - L[0], src[1] - L[1], src[2] - L[2]);
  const early = [[], []];
  let earlyEnergy = 0;
  const N = 3;
  for (let nx = -N; nx <= N; nx++) for (let ny = -N; ny <= N; ny++) for (let nz = -N; nz <= N; nz++) {
    for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) for (let r = 0; r < 2; r++) {
      const order = Math.abs(2 * nx - p) + Math.abs(2 * ny - q) + Math.abs(2 * nz - r);
      if (order < 1 || order > 4) continue;
      const ix = (1 - 2 * p) * src[0] + 2 * nx * W, iy = (1 - 2 * q) * src[1] + 2 * ny * D, iz = (1 - 2 * r) * src[2] + 2 * nz * H;
      const dx = ix - L[0], dy = iy - L[1], dz = iz - L[2];
      const dist = Math.hypot(dx, dy, dz);
      const delay = dist / 343;
      const idx = delay * sr;
      if (delay < room.preDelay * 0.25 || idx >= len - 2) continue;
      const g = Math.pow(refl, order) * (d0 / dist);
      const pan = Math.max(-1, Math.min(1, dx / Math.max(1e-6, Math.hypot(dx, dy))));
      const gL = Math.cos((pan + 1) * Math.PI / 4), gR = Math.sin((pan + 1) * Math.PI / 4);
      const i0 = Math.floor(idx), fr = idx - i0;
      [[0, gL], [1, gR]].forEach(([ch, gc]) => {
        early[ch].push([i0, g * gc * (1 - fr)], [i0 + 1, g * gc * fr]);
      });
    }
  }
  early.forEach(list => list.forEach(([, v]) => { earlyEnergy += v * v; }));
  // Les premières réflexions pèsent ~25 % de l'énergie de la queue : assez pour donner la "taille" de la
  // pièce, pas assez pour un rendu métallique de peigne.
  const earlyScale = earlyEnergy > 0 ? Math.sqrt(0.25 * tailEnergy / earlyEnergy) : 0;
  for (let ch = 0; ch < 2; ch++) early[ch].forEach(([i, v]) => { chan[ch][i] += v * earlyScale; });

  _roomImpulseCache.set(key, buffer);
  return buffer;
}
// Un seul convolueur PAR SALLE et par contexte audio, partagé par tous les Sfx qui y sont placés : chaque
// source lui envoie un niveau (le "send"), comme sur une vraie console -- un convolueur par source (un par
// pas, par exemple) serait bien trop lourd pour le processeur.
const _roomBuses = new WeakMap();
function getRoomBus(ctx, roomKey) {
  let byRoom = _roomBuses.get(ctx);
  if (!byRoom) { byRoom = new Map(); _roomBuses.set(ctx, byRoom); }
  if (byRoom.has(roomKey)) return byRoom.get(roomKey);
  const ir = buildRoomImpulse(ctx, roomKey);
  if (!ir) { byRoom.set(roomKey, null); return null; }
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = ir;
  convolver.connect(ctx.destination);
  const bus = { convolver };
  byRoom.set(roomKey, bus);
  return bus;
}
// Chaîne d'une source placée dans une salle. Direct : passe-bas (l'air absorbe les aigus avec la distance)
// -> PannerNode (pan + volume en 1/distance) -> sortie. Reverb : prélèvement AVANT le panner (donc sans
// atténuation de distance ni pan : la queue de la salle est la même où que soit la source) -> bus de la
// salle. Résultat physiquement juste : plus la source s'éloigne, plus la part de reverb domine.
// opts (trajectoires, 23/09) : { duration (s, durée du son -- pour "glide"), stepKey (clé de l'état "pas à pas"),
// startTime }. Sans opts : position fixe, comme à l'étape 1.
function buildSpatialVoice(ctx, spatial, opts) {
  opts = opts || {};
  const sp = normalizeSpatial(spatial);
  const room = SPATIAL_ROOMS[sp.room];
  const path = sp.path;
  let pos = { x: sp.x, y: sp.y };
  let stepIndex = null;
  if (path.mode === 'steps') {
    // stepIndex imposé (outil vidéo : le point réellement joué pendant la prise) ou tiré selon la boucle du chemin
    stepIndex = opts.stepIndex != null ? (opts.stepIndex % path.points.length) : pickSpatialStepIndex(opts.stepKey || sp, path.points.length, path.loop);
    pos = path.points[stepIndex];
  }
  else if (path.mode === 'glide') pos = path.points[0];
  sp.x = pos.x; sp.y = pos.y;
  const cutoffAt = d => Math.max(1500, Math.min(ctx.sampleRate / 2 - 100, 20000 / (1 + d * room.airK)));
  const input = ctx.createGain();
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  const dist = Math.hypot(sp.x, sp.y);
  air.Q.value = 0.5;
  // Glissement : les positions du panner et le passe-bas suivent le chemin (vitesse constante), sur la durée
  // du trajet (réglée, sinon celle du son). Le passe-bas n'a pas de .value posé ici : une courbe ne peut pas
  // chevaucher un évènement déjà programmé sur le même paramètre.
  let glide = null;
  if (path.mode === 'glide') {
    const pts = path.points;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1];
    const dur = path.durationSec || opts.duration || 2;
    if (total > 1e-6 && dur > 0) glide = { pts, cum, total, dur };
  }
  if (glide) {
    const at = (a) => { // position à la distance parcourue a
      let i = 1; while (i < glide.cum.length - 1 && glide.cum[i] < a) i++;
      const seg = glide.cum[i] - glide.cum[i - 1] || 1, f = Math.max(0, Math.min(1, (a - glide.cum[i - 1]) / seg));
      return { x: glide.pts[i - 1].x + (glide.pts[i].x - glide.pts[i - 1].x) * f, y: glide.pts[i - 1].y + (glide.pts[i].y - glide.pts[i - 1].y) * f };
    };
    const curve = new Float32Array(48);
    for (let k = 0; k < 48; k++) { const q = at(glide.total * k / 47); curve[k] = cutoffAt(Math.hypot(q.x, q.y)); }
    glide.at = at; glide.curve = curve;
    glide.t0 = opts.startTime != null ? opts.startTime : ctx.currentTime;
    air.frequency.setValueCurveAtTime(curve, glide.t0, glide.dur);
  } else {
    air.frequency.value = cutoffAt(dist);
  }
  const panner = ctx.createPanner();
  panner.panningModel = sp.binaural ? 'HRTF' : 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.rolloffFactor = 1;
  if (panner.positionX) {
    panner.positionX.value = sp.x; panner.positionY.value = 0; panner.positionZ.value = -sp.y;
    if (glide) {
      panner.positionX.setValueAtTime(glide.pts[0].x, glide.t0); panner.positionZ.setValueAtTime(-glide.pts[0].y, glide.t0);
      for (let i = 1; i < glide.pts.length; i++) {
        const tt = glide.t0 + glide.dur * glide.cum[i] / glide.total;
        panner.positionX.linearRampToValueAtTime(glide.pts[i].x, tt); panner.positionZ.linearRampToValueAtTime(-glide.pts[i].y, tt);
      }
    }
  }
  else if (panner.setPosition) panner.setPosition(sp.x, 0, -sp.y); // anciens Safari : position de départ seulement
  input.connect(air); air.connect(panner); panner.connect(ctx.destination);
  const nodes = [input, air, panner];
  const bus = room.wet > 0 ? getRoomBus(ctx, sp.room) : null;
  let sendNode = null;
  if (bus) {
    const send = ctx.createGain();
    sendNode = send;
    send.gain.value = room.wet * Math.pow(10, sp.reverbDb / 20);
    const tone = ctx.createBiquadFilter(); // brillance de la reverb : passe-bas de 5 kHz (sombre) à pleine bande (clair)
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(ctx.sampleRate / 2 - 100, 20000 * Math.pow(2, Math.min(0, sp.brightness) * 2));
    tone.Q.value = 0.5;
    input.connect(tone); tone.connect(send); send.connect(bus.convolver);
    nodes.push(tone, send);
  }
  // Un curseur de paramètre (24/09) peut déplacer une source EN COURS DE LECTURE ou changer sa reverb : seules les
  // sources à position fixe le permettent (un chemin "pas à pas" ou "glissement" décide lui-même de la position).
  // atTime : changement programmé (rendu hors-ligne de l'outil vidéo) ; sinon "maintenant".
  const [halfX, halfY] = spatialFieldHalfExtent(sp.room);
  const fixed = path.mode === 'fixed';
  return { input, nodes, distance: dist, stepIndex, fixed, pathMode: path.mode, glideDuration: glide ? glide.dur : null, startX: sp.x, startY: sp.y,
    setBinaural(b) { panner.panningModel = b ? 'HRTF' : 'equalpower'; },
    setPosition(x, y, rampSec, atTime) {
      if (!fixed) return;
      x = Math.max(-halfX, Math.min(halfX, +x || 0)); y = Math.max(-halfY, Math.min(halfY, +y || 0));
      const t0 = atTime != null ? atTime : ctx.currentTime, tc = Math.max(0.001, (rampSec || 0) / 3);
      if (panner.positionX) { panner.positionX.setTargetAtTime(x, t0, tc); panner.positionZ.setTargetAtTime(-y, t0, tc); }
      else if (panner.setPosition) panner.setPosition(x, 0, -y);
      air.frequency.setTargetAtTime(cutoffAt(Math.hypot(x, y)), t0, tc);
    },
    setReverbDb(db, rampSec, atTime) {
      if (!sendNode) return;
      const t0 = atTime != null ? atTime : ctx.currentTime, tc = Math.max(0.001, (rampSec || 0) / 3);
      sendNode.gain.setTargetAtTime(room.wet * Math.pow(10, Math.max(-18, Math.min(6, +db || 0)) / 20), t0, tc);
    },
    dispose() { nodes.forEach(n => { try { n.disconnect(); } catch (e) {} }); } };
}
// ---- Orientation de la tête de l'auditeur ("tourner la tête", 23/09) ----
// Un seul auditeur par contexte audio (ctx.listener) : tourner sa direction fait pivoter TOUS les Sfx placés
// autour de lui, y compris ceux qui jouent déjà -- aucun ambisonique nécessaire pour nos sources séparées.
// yaw en degrés : 0 = face à l'avant de la matrice, +90 = tête tournée vers la droite (sens horaire vu du dessus).
let _listenerYawDeg = 0;
function applyListenerYaw(audioCtx, deg, atTime) {
  const r = deg * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r);
  const L = audioCtx.listener;
  if (L.forwardX) {
    const t = atTime != null ? atTime : audioCtx.currentTime; // atTime : rendu hors-ligne (outil vidéo)
    // Petite constante de temps : évite les craquements quand on fait glisser le curseur
    L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(0, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
    L.upX.setTargetAtTime(0, t, 0.02); L.upY.setTargetAtTime(1, t, 0.02); L.upZ.setTargetAtTime(0, t, 0.02);
  } else if (L.setOrientation) L.setOrientation(fx, 0, fz, 0, 1, 0); // anciens Safari
}
function setListenerYaw(deg) {
  deg = ((((+deg || 0) % 360) + 540) % 360) - 180;
  _listenerYawDeg = deg;
  try { applyListenerYaw(ctx, deg); } catch (e) {}
  // Évènement DOM : l'éditeur du Backstage y branche la rotation du triangle "auditeur", et l'outil vidéo
  // pourra y enregistrer le geste en direct (mode "write") sans toucher au moteur.
  try { document.dispatchEvent(new CustomEvent('layerpitch-head-yaw', { detail: deg })); } catch (e) {}
}
function getListenerYaw() { return _listenerYawDeg; }
// Rangée de contrôle de l'orientation, ajoutée aux lecteurs de Sfx spatialisés (curseur + recentrage).
function buildHeadTurnControl() {
  const row = document.createElement('div');
  row.className = 'head-turn-row';
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;font-size:0.85em;flex-wrap:wrap';
  row.innerHTML = `
    <label style="margin:0">${t('headTurnLabel')}</label>
    <input type="range" min="-180" max="180" step="1" value="${Math.round(_listenerYawDeg)}" style="flex:1;min-width:120px;max-width:260px" aria-label="${t('headTurnLabel')}">
    <span data-role="yawVal" style="min-width:3.2em;text-align:right"></span>
    <button type="button" class="btn btn-small" data-role="yawReset">${t('headTurnReset')}</button>`;
  const slider = row.querySelector('input'), val = row.querySelector('[data-role="yawVal"]');
  const paint = deg => { val.textContent = Math.round(deg) + '°'; slider.value = Math.round(deg); };
  paint(_listenerYawDeg);
  slider.addEventListener('input', () => setListenerYaw(+slider.value));
  row.querySelector('[data-role="yawReset"]').addEventListener('click', () => setListenerYaw(0));
  document.addEventListener('layerpitch-head-yaw', e => paint(e.detail));
  return row;
}
// ---- Matrice de spatialisation PUBLIQUE (24/09) ----
// Vue de dessus de la salle d'un Sfx spatialisé, pour le visiteur : l'auditeur (triangle, qu'on fait tourner pour
// tourner la tête), la source (point) ou la trajectoire (points numérotés / chemin), le point « qui joue » en bleu,
// et le rendu 3D (casque). MANIPULABLE : on glisse la source (ou un point de la trajectoire) et on entend le
// changement, même pendant que le son joue ; tout est local au visiteur (voir _sfxVisitorState). Le compositeur choisit
// dans le Backstage (spatial.publicMode) : 'free' = manipulable (défaut), 'frozen' = visible mais figée (aucun
// réglage pour le visiteur), 'hidden' = pas de matrice. Le curseur d'orientation de la tête est posé À CÔTÉ de la
// matrice (colonne de droite, sous elle sur un petit écran).
function buildSpatialMatrixView(sfxDef) {
  const wrap = document.createElement('div');
  wrap.className = 'sfx-space-view';
  const publicMode = sfxDef.spatial.publicMode || 'free';
  const sp0 = normalizeSpatial(sfxDef.spatial);
  const room = sp0.room;
  const [hx, hy] = spatialFieldHalfExtent(room);
  const W = 320, PAD = 14, ppm = (W / 2 - PAD) / hx, H = Math.round(2 * hy * ppm + 2 * PAD), cx = W / 2, cy = H / 2;
  const interactive = publicMode === 'free';
  const X = v => cx + v * ppm, Y = v => cy - v * ppm;
  const gridStep = Math.max(hx, hy) <= 5 ? 1 : (Math.max(hx, hy) <= 15 ? 2 : 5);
  let grid = '';
  for (let m = gridStep; m <= Math.max(hx, hy) + 1e-6; m += gridStep) {
    if (m <= hx + 1e-6) grid += `<line x1="${X(m)}" y1="${Y(hy)}" x2="${X(m)}" y2="${Y(-hy)}"/><line x1="${X(-m)}" y1="${Y(hy)}" x2="${X(-m)}" y2="${Y(-hy)}"/>`;
    if (m <= hy + 1e-6) grid += `<line x1="${X(-hx)}" y1="${Y(m)}" x2="${X(hx)}" y2="${Y(m)}"/><line x1="${X(-hx)}" y1="${Y(-m)}" x2="${X(hx)}" y2="${Y(-m)}"/>`;
  }
  wrap.innerHTML = `
    <div class="sfx-space-title">${t('sfxSpaceViewLabel')}</div>
    <div class="sfx-space-layout">
    <div class="sfx-space-map">
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;touch-action:none;display:block;border:1px solid var(--border, #ccc);border-radius:8px;${interactive ? 'cursor:crosshair' : ''}" role="img" aria-label="${escapeHtml(t('sfxSpaceViewLabel'))}">
      <rect x="${X(-hx)}" y="${Y(hy)}" width="${2 * hx * ppm}" height="${2 * hy * ppm}" fill="none" stroke="var(--text-dimmer, #888)" stroke-width="1.5"/>
      <g stroke="var(--border, #ccc)" stroke-width="0.5">${grid}</g>
      <line x1="${X(-hx)}" y1="${cy}" x2="${X(hx)}" y2="${cy}" stroke="var(--border, #ccc)" stroke-width="0.8" stroke-dasharray="3 3"/>
      <line x1="${cx}" y1="${Y(hy)}" x2="${cx}" y2="${Y(-hy)}" stroke="var(--border, #ccc)" stroke-width="0.8" stroke-dasharray="3 3"/>
      <g data-role="dynamic"></g>
      <g data-role="listener"><circle cx="${cx}" cy="${cy}" r="18" fill="transparent" stroke="var(--border, #ccc)" stroke-dasharray="2 3"/><polygon points="${cx},${cy - 11} ${cx - 8},${cy + 8} ${cx + 8},${cy + 8}" fill="var(--text-dimmer, #888)"><title>${escapeHtml(t('sfxSpaceListenerLabel'))}</title></polygon></g>
      <text x="${X(-hx) + 4}" y="${Y(-hy) - 5}" font-size="10" fill="var(--text-dimmer, #888)">${{ room: 'Room', hall: 'Hall', cathedral: 'Cathedral', outside: 'Outside' }[room]} · ${gridStep} m</text>
    </svg>
    <div class="sfx-space-readout" data-role="readout"></div>
    </div>
    ${interactive ? `<div class="sfx-space-side" data-role="side">
      <label class="sfx-space-bin"><input type="checkbox" data-role="binaural"> ${t('sfxSpaceBinauralPublic')}</label>
      <div class="sfx-space-controls"><button type="button" class="btn btn-small" data-role="reset">${t('sfxSpaceViewReset')}</button></div>
      <div class="sfx-space-hint">${t('sfxSpaceViewHint')}</div>
    </div>` : ''}
    </div>`;
  const svg = wrap.querySelector('svg'), dyn = wrap.querySelector('[data-role="dynamic"]'), listener = wrap.querySelector('[data-role="listener"]');
  const readout = wrap.querySelector('[data-role="readout"]'), bin = wrap.querySelector('[data-role="binaural"]') || { checked: false, addEventListener() {} }, resetBtn = wrap.querySelector('[data-role="reset"]');
  // Orientation de la tête : dans la colonne de droite, À CÔTÉ de la matrice (seulement quand elle est manipulable).
  if (interactive) wrap.querySelector('[data-role="side"]').insertBefore(buildHeadTurnControl(), wrap.querySelector('.sfx-space-bin'));
  const round1 = v => Math.round(v * 10) / 10;
  const state = () => sfxSpatialWithVisitor(sfxDef); // réglage courant (compositeur + visiteur)
  const playing = { idx: -1, glide: false, glidePos: null, token: 0, pulse: 0 };
  function current() { const n = normalizeSpatial(state()); return n; }
  function paintListener() { listener.setAttribute('transform', `rotate(${getListenerYaw()} ${cx} ${cy})`); }
  function paint() {
    const n = current(), path = n.path, isPath = path.mode === 'steps' || path.mode === 'glide';
    let html = '';
    if (!isPath) {
      html += `<line x1="${cx}" y1="${cy}" x2="${X(n.x)}" y2="${Y(n.y)}" stroke="var(--accent, #c9713c)" stroke-width="1" stroke-dasharray="2 3"/>`;
      if (playing.pulse) html += `<circle cx="${X(n.x)}" cy="${Y(n.y)}" r="15" fill="none" stroke="var(--accent, #c9713c)" stroke-width="2" opacity="0.45"/>`;
      html += `<circle cx="${X(n.x)}" cy="${Y(n.y)}" r="9" fill="var(--accent, #c9713c)" stroke="#fff" stroke-width="2" style="cursor:${interactive ? 'grab' : 'default'}"/>`;
      readout.textContent = t('sfxSpaceViewReadout', { x: round1(n.x), y: round1(n.y), d: round1(Math.hypot(n.x, n.y)) });
    } else {
      const pts = path.points;
      html += `<polyline points="${pts.map(q => X(q.x) + ',' + Y(q.y)).join(' ')}" fill="none" stroke="var(--accent, #c9713c)" stroke-width="1.5" stroke-dasharray="${path.mode === 'steps' ? '3 4' : '0'}"/>`;
      html += pts.map((q, i) => { const on = i === playing.idx; return `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="8" fill="${on ? 'var(--accent, #c9713c)' : 'var(--bg, #fff)'}" stroke="var(--accent, #c9713c)" stroke-width="2"/><text x="${X(q.x)}" y="${Y(q.y) + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${on ? '#fff' : 'var(--accent, #c9713c)'}" style="pointer-events:none">${i + 1}</text>`; }).join('');
      if (playing.glide && playing.glidePos) html += `<circle cx="${X(playing.glidePos.x)}" cy="${Y(playing.glidePos.y)}" r="7" fill="var(--accent, #c9713c)" stroke="#fff" stroke-width="2" style="pointer-events:none"/>`;
      readout.textContent = t(path.mode === 'steps' ? 'sfxSpaceViewSteps' : 'sfxSpaceViewGlide', { n: pts.length });
    }
    dyn.innerHTML = html;
    bin.checked = !!n.binaural;
    paintListener();
  }
  // Mise à jour EN DIRECT des sons déjà en train de jouer (sources à position fixe).
  function pushToPlayingVoices() {
    const n = current();
    (_activeSpatialVoices.get(sfxDef.id) || new Set()).forEach(v => { v.setPosition(n.x, n.y, 0.05); v.setBinaural(n.binaural); });
  }
  function visitorState() {
    let vs = _sfxVisitorState.get(sfxDef.id);
    if (!vs) { vs = {}; _sfxVisitorState.set(sfxDef.id, vs); }
    return vs;
  }
  bin.addEventListener('change', () => { visitorState().binaural = bin.checked; pushToPlayingVoices(); paint(); });
  if (resetBtn) resetBtn.addEventListener('click', () => { _sfxVisitorState.delete(sfxDef.id); pushToPlayingVoices(); paint(); });
  if (interactive) {
    const pos = ev => {
      const r = svg.getBoundingClientRect(), k = W / r.width, px = (ev.clientX - r.left) * k, py = (ev.clientY - r.top) * k;
      return { px, py, x: round1(Math.max(-hx, Math.min(hx, (px - cx) / ppm))), y: round1(Math.max(-hy, Math.min(hy, -(py - cy) / ppm))) };
    };
    let drag = null;
    svg.addEventListener('pointerdown', ev => {
      const p = pos(ev), n = current(), isPath = n.path.mode === 'steps' || n.path.mode === 'glide';
      if (Math.hypot(p.px - cx, p.py - cy) <= 22) { drag = { kind: 'yaw' }; } // le triangle : on tourne la tête
      else if (!isPath) { const vs = visitorState(); vs.x = p.x; vs.y = p.y; drag = { kind: 'source' }; }
      else {
        let hit = -1, best = 16;
        n.path.points.forEach((q, i) => { const d = Math.hypot(X(q.x) - p.px, Y(q.y) - p.py); if (d < best) { best = d; hit = i; } });
        if (hit < 0) return;
        const vs = visitorState();
        if (!vs.points) vs.points = n.path.points.map(q => ({ x: q.x, y: q.y }));
        drag = { kind: 'point', idx: hit };
      }
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      onMove(ev);
    });
    function onMove(ev) {
      if (!drag) return;
      const p = pos(ev);
      if (drag.kind === 'yaw') { setListenerYaw(Math.atan2(p.px - cx, -(p.py - cy)) * 180 / Math.PI); }
      else if (drag.kind === 'source') { const vs = visitorState(); vs.x = p.x; vs.y = p.y; pushToPlayingVoices(); paint(); }
      else { visitorState().points[drag.idx] = { x: p.x, y: p.y }; paint(); }
    }
    svg.addEventListener('pointermove', onMove);
    const end = () => { drag = null; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }
  // Tête de l'auditeur (curseur d'orientation ou glisser le triangle) + son qui joue.
  document.addEventListener('layerpitch-head-yaw', () => { if (wrap.isConnected) paintListener(); });
  document.addEventListener('layerpitch-sfx-spatial', e => {
    if (!wrap.isConnected || e.detail.sfxId !== sfxDef.id) return;
    const token = ++playing.token, dur = Math.max(0.2, e.detail.glideDuration || e.detail.duration || 1);
    if (e.detail.mode === 'steps' && e.detail.stepIndex != null) {
      playing.idx = e.detail.stepIndex; playing.glide = false; paint();
      setTimeout(() => { if (playing.token === token) { playing.idx = -1; paint(); } }, Math.max(300, (e.detail.duration || 1) * 1000));
    } else if (e.detail.mode === 'glide') {
      playing.idx = -1; playing.glide = true;
      const pts = current().path.points; const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const total = cum[cum.length - 1] || 1, t0 = performance.now();
      const step = () => {
        if (playing.token !== token || !wrap.isConnected) return;
        const f = (performance.now() - t0) / 1000 / dur;
        if (f >= 1) { playing.glide = false; playing.glidePos = null; paint(); return; }
        const a = f * total; let i = 1; while (i < cum.length - 1 && cum[i] < a) i++;
        const sg = cum[i] - cum[i - 1] || 1, ff = Math.max(0, Math.min(1, (a - cum[i - 1]) / sg));
        playing.glidePos = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * ff, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * ff };
        paint(); requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      playing.pulse = 1; paint();
      setTimeout(() => { if (playing.token === token) { playing.pulse = 0; paint(); } }, Math.max(300, (e.detail.duration || 1) * 1000));
    }
  });
  paint();
  return wrap;
}
// Branche une source de Sfx à la sortie : directement, ou à travers sa chaîne spatiale si le compositeur
// en a réglé une. addEventListener('ended') et non .onended : les appelants posent déjà leur propre
// gestionnaire (leçon des fuites de chaîne d'effets, voir buildLayerFxChain).
// Réglages du VISITEUR sur la matrice publique (24/09) : position de la source, points d'un chemin, rendu 3D. Par
// identifiant de Sfx (partagés entre le lecteur de Sfx d'un AdReel et les boutons Sfx d'un morceau), en mémoire
// seulement : rien n'est enregistré, tout revient à l'état du compositeur au rechargement de la page.
const _sfxVisitorState = new Map(); // sfxId -> { x, y, binaural, points }
const _activeSpatialVoices = new Map(); // sfxId -> Set(voix spatiales en cours de lecture)
function sfxSpatialWithVisitor(sfxDef) {
  const sp = sfxDef.spatial, vs = _sfxVisitorState.get(sfxDef.id);
  if (!vs) return sp;
  const out = Object.assign({}, sp);
  if (vs.x != null && vs.y != null) { out.x = vs.x; out.y = vs.y; }
  if (vs.binaural != null) out.binaural = vs.binaural;
  if (vs.points) out.path = Object.assign({}, sp.path, { points: vs.points });
  return out;
}
function connectSfxSource(src, sfxDef, spatialOverride, startTime) {
  const sp0 = sfxDef && sfxDef.spatial;
  if (!sp0 || !sp0.enabled) { src.connect(ctx.destination); return null; }
  try {
    // Ordre de priorité : réglage du compositeur < ce que le visiteur a fait à la matrice < curseur de paramètre du
    // compositeur (spatialOverride : position / reverb imposées au moment où le son démarre).
    const sp = sfxSpatialWithVisitor(sfxDef);
    const spUsed = spatialOverride ? fxSpatialWithOverride(sp, spatialOverride) : sp;
    const voice = buildSpatialVoice(ctx, spUsed, {
      duration: src.buffer ? src.buffer.duration / ((src.playbackRate && src.playbackRate.value) || 1) : 0,
      stepKey: sfxDef, startTime
    });
    src.connect(voice.input);
    voice.__spUsed = JSON.parse(JSON.stringify(spUsed)); // réglage réellement joué (capture vidéo, journal de prise)
    if (takeRecordingEnabled) journalSpatialVoice(voice, spUsed);
    // Voix en cours de lecture : la matrice publique les déplace / change leur rendu en direct.
    let vset = _activeSpatialVoices.get(sfxDef.id);
    if (!vset) { vset = new Set(); _activeSpatialVoices.set(sfxDef.id, vset); }
    vset.add(voice);
    src.addEventListener('ended', () => { vset.delete(voice); setTimeout(() => voice.dispose(), 250); });
    // Évènement DOM (24/09) : l'éditeur de la matrice (Backstage) y montre en bleu le point « en train de jouer »
    // (pas à pas) ou une pastille qui suit le chemin (glissement).
    try {
      document.dispatchEvent(new CustomEvent('layerpitch-sfx-spatial', { detail: {
        sfxId: sfxDef.id, mode: voice.pathMode, stepIndex: voice.stepIndex, glideDuration: voice.glideDuration, x: voice.startX, y: voice.startY,
        duration: src.buffer ? src.buffer.duration / ((src.playbackRate && src.playbackRate.value) || 1) : 0 } }));
    } catch (e) {}
    return voice;
  } catch (e) {
    console.error('Spatialisation Sfx — repli sur la sortie directe :', e);
    try { src.disconnect(); } catch (e2) {}
    src.connect(ctx.destination);
    return null;
  }
}
// Bitcrusher via ScriptProcessorNode (déprécié mais universellement supporté) plutôt qu'un AudioWorklet :
// un AudioWorklet ne fonctionne pas en contexte file:// (contrainte non négociable de l'outil, voir
// docs/architecture.md), un ScriptProcessorNode si. Combine quantification de bits (résolution réduite)
// et échantillonnage-blocage (réduction de fréquence d'échantillonnage perçue).
// node.params (23/09, triggers d'effets) : réglages lus à CHAQUE bloc, donc modifiables en direct --
// enabled=false : recopie pure de l'entrée (un trigger peut ainsi l'activer/le couper sans reconstruire).
// Rendu hors-ligne (outil vidéo "Test in game", 23/09) : blocs de 256 échantillons au lieu de 4096 -- la latence
// propre à un ScriptProcessor (un bloc) passe de ~85 ms à ~5 ms, donc une voix bitcrushée/pitchée reste calée
// sur les autres dans le mixage exporté, et un changement programmé (node.schedule) tombe à quelques ms près.
function isOfflineAudioContext(c) { return typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext; }
// Latence des nœuds à ScriptProcessor (23/09, MESURÉE : 185,8 ms pour un bloc de 4096 à 44,1 kHz, soit exactement
// 2 blocs -- Chrome double-tamponne entrée et sortie). Une voix passant par un bitcrusher ou un pitch-shift arrivait
// donc en retard sur les autres voix du même morceau, donc désynchronisée alors que les couches sont censées
// rester calées à l'échantillon près. Deux remèdes combinés : (1) des blocs plus petits -- 1024 en direct (~46 ms),
// 256 en rendu hors-ligne (~11 ms) ; (2) toutes les autres voix d'un morceau qui utilise ces effets reçoivent un
// DelayNode de même durée (withLatencyComp) -- tout reste aligné, pour un retard d'ensemble de ~46 ms seulement sur
// ces morceaux-là. Formule vérifiée sur Chrome ; Firefox/Safari non mesurés.
function fxSpBlockSize(c) { return isOfflineAudioContext(c) ? 256 : 1024; }
function fxSpLatencySec(c) { return 2 * fxSpBlockSize(c) / c.sampleRate; }
// Ce morceau peut-il faire passer une voix par un ScriptProcessor (bitcrusher/pitch-shift, de base ou via un trigger) ?
function trackNeedsLatencyComp(track) {
  if (!track) return false;
  const spFx = fx => !!(fx && (fx.bitcrush || (fx.pitch && fx.pitch.mode !== 'rate')));
  const anyFx = arr => (arr || []).some(x => x && spFx(x.fx));
  if (anyFx(track.layers) || anyFx(track.loops) || anyFx(track.segmentSlots)) return true;
  if (spFx(track.intro && track.intro.fx) || spFx(track.outro && track.outro.fx)) return true;
  if ((track.sections || []).some(sec => sec && anyFx(sec.pools))) return true;
  if ((track.fxTriggers || []).some(d => d && d.fx && (d.fx.bitcrush || (d.fx.pitch && d.fx.pitch.mode !== 'rate')))) return true;
  return ((track.fxSliders || []).some(d => d && (d.bindings || []).some(b => b && (b.param === 'bitcrush.bits' || b.param === 'bitcrush.reduction' || b.param === 'pitch.semitones'))));
}
// Ajoute à une chaîne d'effets (ou en crée une réduite au seul retard) le DelayNode de compensation, sauf si la
// chaîne contient déjà un ScriptProcessor (qui apporte naturellement le même retard).
function withLatencyComp(c, chain) {
  if (chain && chain.nodes && (chain.nodes.bitcrush || chain.nodes.pitchShift)) return chain;
  const d = c.createDelay(0.5);
  d.delayTime.value = fxSpLatencySec(c);
  if (!chain) return { input: d, output: d, nodes: { latencyComp: d } };
  chain.output.connect(d);
  chain.output = d;
  chain.nodes.latencyComp = d;
  return chain;
}
// Réglages en vigueur à l'instant t d'un nœud à ScriptProcessor : node.schedule = [{t, params}] trié, rempli par
// applyFxToChain en mode programmé ; sans planning, les réglages vivants (node.params) comme avant.
function fxNodeParamsAt(node, t) {
  const sch = node.schedule;
  if (!sch || !sch.length) return node.params;
  let p = node.params;
  for (let i = 0; i < sch.length; i++) { if (sch[i].t <= t) p = sch[i].params; else break; }
  return p;
}
function buildBitcrushNode(ctx, bits, reduction) {
  const node = ctx.createScriptProcessor(fxSpBlockSize(ctx), 2, 2);
  node.params = { enabled: true, bits: bits || 8, reduction: reduction || 1 };
  let sampleCounter = 0;
  const held = [0, 0];
  node.onaudioprocess = (e) => {
    const chCount = e.outputBuffer.numberOfChannels;
    const frames = e.outputBuffer.length;
    const p = fxNodeParamsAt(node, e.playbackTime);
    if (!p.enabled) {
      for (let ch = 0; ch < chCount; ch++) e.outputBuffer.getChannelData(ch).set(e.inputBuffer.getChannelData(ch));
      return;
    }
    const step = Math.pow(0.5, Math.max(1, Math.min(16, p.bits || 8)));
    const red = Math.max(1, Math.min(50, Math.round(p.reduction || 1)));
    for (let i = 0; i < frames; i++) {
      const hold = (sampleCounter % red) === 0;
      for (let ch = 0; ch < chCount; ch++) {
        const inData = e.inputBuffer.getChannelData(ch);
        if (hold) held[ch] = Math.round(inData[i] / step) * step;
        e.outputBuffer.getChannelData(ch)[i] = held[ch];
      }
      sampleCounter++;
    }
  };
  return node;
}
// Pitch-shift granulaire (chantier 2, 22/09) — deux "grains" en lecture superposée dans un buffer
// circulaire alimenté en continu, fenêtrés en Hann et décalés d'une demi-fenêtre : la fenêtre de chacun
// avance à un rythme FIXE (horloge de sortie, indépendante du pitch) tandis que sa position de LECTURE
// avance à `pitchRatio` échantillons par échantillon de sortie — c'est ce découplage qui change la
// hauteur sans changer la durée. Chaque grain se repositionne "grainSize échantillons dans le passé" au
// moment précis où sa fenêtre repasse par zéro (quasi silencieuse à cet instant, ce qui masque le saut).
// Technique granulaire classique (façon PSOLA simplifié), pas un vrai vocodeur de phase : justesse de
// hauteur vérifiée numériquement (écart <6% sur ±1 octave, voir session du 22/09), mais plus d'artefacts
// qu'une librairie dédiée sur de grands écarts — qualité perçue non validée à l'oreille, à confirmer par
// une vraie écoute avant de le considérer prêt pour une démo (cf. le même type de réserve déjà posée sur
// l'ambisonic dans `docs/extensions-roadmap.md`, en moins critique ici).
// node.params (23/09) : semitones lu à chaque bloc ; enabled=false -> recopie pure (latence nulle), tout en
// continuant d'alimenter le buffer circulaire et de recaler les têtes de lecture pour qu'une activation en
// direct démarre proprement.
function buildPitchShiftNode(ctx, semitones) {
  const grainSize = 2048;
  const numChannels = 2;
  const node = ctx.createScriptProcessor(fxSpBlockSize(ctx), numChannels, numChannels);
  node.params = { enabled: true, semitones: semitones || 0 };
  const bufLen = grainSize * 4;
  const state = [];
  for (let ch = 0; ch < numChannels; ch++) {
    state.push({ buffer: new Float32Array(bufLen), writePos: 0, outputPhase: 0, windowPhase: [0, 0.5], readPos: [-grainSize, -grainSize / 2] });
  }
  function hann(x) { return 0.5 * (1 - Math.cos(2 * Math.PI * x)); }
  node.onaudioprocess = (e) => {
    const chCount = e.outputBuffer.numberOfChannels;
    const frames = e.outputBuffer.length;
    const p = fxNodeParamsAt(node, e.playbackTime);
    const pitchRatio = Math.pow(2, (p.semitones || 0) / 12);
    for (let ch = 0; ch < chCount; ch++) {
      const st = state[ch];
      const inData = e.inputBuffer.getChannelData(ch);
      const outData = e.outputBuffer.getChannelData(ch);
      if (!p.enabled) {
        for (let i = 0; i < frames; i++) { st.buffer[st.writePos % bufLen] = inData[i]; st.writePos++; outData[i] = inData[i]; }
        st.readPos[0] = st.writePos - grainSize; st.readPos[1] = st.writePos - grainSize / 2;
        continue;
      }
      for (let i = 0; i < frames; i++) {
        st.buffer[st.writePos % bufLen] = inData[i];
        st.writePos++;
        st.outputPhase = (st.outputPhase + 1 / grainSize) % 1;
        let out = 0, winSum = 0;
        for (let g = 0; g < 2; g++) {
          const prevPhase = st.windowPhase[g];
          const newPhase = (st.outputPhase + g * 0.5) % 1;
          if (newPhase < prevPhase) st.readPos[g] = st.writePos - grainSize;
          st.windowPhase[g] = newPhase;
          const win = hann(newPhase);
          const idx = Math.floor(st.readPos[g]);
          const frac = st.readPos[g] - idx;
          const i0 = ((idx % bufLen) + bufLen) % bufLen;
          const i1 = (i0 + 1) % bufLen;
          const smp = st.buffer[i0] * (1 - frac) + st.buffer[i1] * frac;
          out += smp * win;
          winSum += win;
          st.readPos[g] += pitchRatio;
        }
        outData[i] = winSum > 0.0001 ? out / winSum : 0;
      }
    }
  };
  return node;
}
// Coupures Low cut / High cut : cascade de filtres Butterworth (réponse plate, sans résonance). Q linéaires classiques
// de chaque étage pour 2, 4 et 8 pôles, convertis en dB (le Q d'un passe-haut/passe-bas Web Audio s'exprime en dB).
const FX_CUT_STAGES = 4;
const FX_CUT_Q_DB = (() => {
  const db = q => 20 * Math.log10(q);
  return { 12: [0.7071].map(db), 24: [0.5412, 1.3066].map(db), 48: [0.5098, 0.6013, 0.8999, 2.5629].map(db) };
})();
function fxCutSlope(c) { const v = +(c && c.slope); return v === 12 || v === 48 ? v : 24; }
// Applique une configuration fx (complète, déjà fusionnée avec les triggers actifs) à une chaîne DÉJÀ
// construite -- point d'entrée unique pour la construction initiale (rampSec=0) ET pour les changements en
// direct (trigger activé/coupé, rampSec>0). Un effet absent de `fx` est ramené à son état NEUTRE (filtre
// ouvert, wet à 0, bitcrusher/pitch en recopie, volume à 0 dB) plutôt que retiré : la topologie de la chaîne
// ne change jamais en cours de lecture, seuls des paramètres bougent. Rampes via setTargetAtTime (lissées,
// pas de clic) ; filtre/effets à type discret (type de filtre) appliqués tout de suite.
// atTime (23/09, outil vidéo) : changement PROGRAMMÉ à un instant précis de la ligne de temps d'un contexte
// hors-ligne, au lieu d'un changement "maintenant". Les rampes repartent alors de la valeur que l'automation a
// déjà à cet instant (pas de param.value, qui ne reflèterait pas l'automation d'un contexte qui ne tourne pas).
function applyFxToChain(ctx, chain, fx, rampSec, atTime) {
  fx = fx || {};
  // Journal de prise : chaque changement d'effet d'une voix est consigné (heure du contexte, réglage, rampe).
  if (chain.__lpFxLog) chain.__lpFxLog.push([atTime != null ? atTime : ctx.currentTime, JSON.parse(JSON.stringify(fx)), rampSec || 0]);
  const n = chain.nodes;
  const sched = atTime != null;
  const now = sched ? atTime : ctx.currentTime;
  const ramp = rampSec || 0;
  function set(param, v, rampOverride) {
    const r = rampOverride != null ? rampOverride : ramp;
    if (!sched) param.cancelScheduledValues(now);
    if (!(r > 0)) param.setValueAtTime(v, now);
    else { if (!sched) param.setValueAtTime(param.value, now); param.setTargetAtTime(v, now, Math.max(0.001, r / 3)); }
  }
  function setNodeParams(node, params) {
    if (sched) { (node.schedule = node.schedule || []).push({ t: now, params: Object.assign({}, params) }); }
    else Object.assign(node.params, params);
  }
  // Low cut / High cut (24/09, remplace l'ancien filtre unique) : deux coupures indépendantes, chacune en cascade de
  // 1, 2 ou 4 biquads Butterworth (12 / 24 / 48 dB par octave). Les 4 étages existent toujours (topologie fixe) ;
  // ceux qu'une pente plus douce n'utilise pas sont ramenés à leur état neutre (grave à 10 Hz / aigu à Nyquist).
  ['lowcut', 'highcut'].forEach(k => {
    if (!n[k]) return;
    const c = fx[k];
    const qs = c ? FX_CUT_Q_DB[fxCutSlope(c)] : [];
    const neutral = k === 'lowcut' ? 10 : ctx.sampleRate / 2;
    const freq = c ? Math.min(Math.max(+c.frequency || (k === 'lowcut' ? 150 : 3000), 10), ctx.sampleRate / 2) : neutral;
    n[k].forEach((f, i) => {
      const on = i < qs.length;
      set(f.frequency, on ? freq : neutral);
      set(f.Q, on ? qs[i] : 0);
    });
  });
  if (n.delay) {
    const c = fx.delay;
    const wetAmount = c ? (c.wet != null ? c.wet : 0.25) : 0;
    if (c) {
      set(n.delay.delayNode.delayTime, Math.min(Math.max(c.time || 0.3, 0.01), 2));
      set(n.delay.feedback.gain, Math.min(Math.max(c.feedback != null ? c.feedback : 0.35, 0), 0.9));
    }
    set(n.delay.wet.gain, wetAmount);
    set(n.delay.dry.gain, 1 - wetAmount);
  }
  if (n.reverb) {
    const c = fx.reverb;
    const wetAmount = c ? (c.wet != null ? c.wet : 0.3) : 0;
    if (c) {
      const decay = Math.min(Math.max(c.decay || 2, 0.1), 10);
      if (!sched && n.reverb.decay !== decay) { try { n.reverb.convolver.buffer = getOrBuildImpulseResponse(ctx, decay); n.reverb.decay = decay; } catch (e) {} }
    }
    set(n.reverb.wet.gain, wetAmount);
    set(n.reverb.dry.gain, 1 - wetAmount);
  }
  if (n.bitcrush) {
    const c = fx.bitcrush;
    setNodeParams(n.bitcrush, { enabled: !!c, bits: c ? (c.bits || 8) : n.bitcrush.params.bits, reduction: c ? (c.reduction || 1) : n.bitcrush.params.reduction });
  }
  if (n.pitchShift) {
    const c = fx.pitch;
    setNodeParams(n.pitchShift, { enabled: !!(c && c.mode === 'shift'), semitones: c ? (c.semitones || 0) : n.pitchShift.params.semitones });
  }
  if (n.volume) {
    const c = fx.volume;
    set(n.volume.gain, c && Number.isFinite(c.db) ? Math.pow(10, Math.min(Math.max(c.db, -60), 12) / 20) : 1);
  }
}
// includeBitcrush (défaut vrai) : un ScriptProcessorNode continue de traiter du silence tant qu'il reste
// connecté, contrairement à un filtre/reverb/écho natifs (coût négligeable une fois la source arrêtée,
// laissés tels quels au ramasse-miettes). Chaque appelant qui active un fx potentiellement bitcrush doit
// donc prévoir sa propre déconnexion explicite au bon moment (voir stopSimple() et le src.onended de
// scheduleGeneration() dans player.js) — includeBitcrush=false reste disponible pour un futur appelant
// qui ne pourrait pas garantir ce nettoyage, plutôt que de risquer une fuite silencieuse.
//
// startTime (chantier 2, 22/09) : un fondu de filtre doit démarrer sa rampe au moment RÉEL où la source
// devient audible, pas au moment où cette fonction est appelée -- pour les moteurs programmés à l'avance
// (jusqu'à 1s de lookahead), ces deux instants diffèrent. `src` n'est plus utilisé ici (le pitch "vitesse"
// est un réglage de morceau, voir applyTrackPitchRate()) -- gardé pour la signature.
//
// forceKeys (23/09, triggers d'effets) : effets à construire même s'ils sont absents de `fx` (à leur état
// neutre) -- un trigger qui active plus tard un bitcrusher sur une voix qui n'en avait pas a besoin que le
// nœud existe déjà, la topologie ne pouvant pas changer en cours de lecture. Sans forceKeys, comportement
// strictement inchangé (une chaîne par voix ne contient que ce que sa configuration demande).
function buildLayerFxChain(ctx, fx, src, startTime, includeBitcrush, forceKeys) {
  fx = fx || {};
  const force = forceKeys || [];
  const wants = k => !!fx[k] || force.indexOf(k) >= 0;
  if (!wants('lowcut') && !wants('highcut') && !wants('reverb') && !wants('delay') && !wants('bitcrush') && !wants('pitch') && !wants('volume')) return null;
  const nodes = {};
  const input = ctx.createGain(); // point d'entrée neutre (gain 1), toujours présent même chaîne courte
  let chainEnd = input;
  const when = startTime != null ? startTime : ctx.currentTime;

  // Pitch "shift" : vrai changement de hauteur, durée inchangée -- voir buildPitchShiftNode.
  if (wants('pitch') && (!fx.pitch || fx.pitch.mode === 'shift')) {
    const shifter = buildPitchShiftNode(ctx, fx.pitch ? fx.pitch.semitones : 0);
    chainEnd.connect(shifter);
    chainEnd = shifter;
    nodes.pitchShift = shifter;
  }

  // Low cut avant High cut : ordre sans importance pour deux filtres linéaires, fixé pour rester déterministe.
  ['lowcut', 'highcut'].forEach(k => {
    if (!wants(k)) return;
    nodes[k] = [];
    for (let i = 0; i < FX_CUT_STAGES; i++) {
      const f = ctx.createBiquadFilter();
      f.type = k === 'lowcut' ? 'highpass' : 'lowpass';
      chainEnd.connect(f);
      chainEnd = f;
      nodes[k].push(f);
    }
  });

  if (wants('bitcrush') && includeBitcrush !== false) {
    const crusher = buildBitcrushNode(ctx, fx.bitcrush ? fx.bitcrush.bits : 8, fx.bitcrush ? fx.bitcrush.reduction : 1);
    chainEnd.connect(crusher);
    chainEnd = crusher;
    nodes.bitcrush = crusher;
  }

  if (wants('delay')) {
    const wetOut = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const delayNode = ctx.createDelay(2.0);
    const feedback = ctx.createGain();
    chainEnd.connect(dry); dry.connect(wetOut);
    chainEnd.connect(delayNode);
    delayNode.connect(feedback); feedback.connect(delayNode); // boucle de feedback de l'écho
    delayNode.connect(wet); wet.connect(wetOut);
    chainEnd = wetOut;
    nodes.delay = { delayNode, feedback, wet, dry };
  }

  if (wants('reverb')) {
    const wetOut = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.normalize = true;
    const decay = Math.min(Math.max((fx.reverb && fx.reverb.decay) || 2, 0.1), 10);
    convolver.buffer = getOrBuildImpulseResponse(ctx, decay);
    chainEnd.connect(dry); dry.connect(wetOut);
    chainEnd.connect(convolver); convolver.connect(wet); wet.connect(wetOut);
    chainEnd = wetOut;
    nodes.reverb = { convolver, wet, dry, decay };
  }

  // Volume (correction de niveau a posteriori, 23/09) : fader de sortie de la chaîne, placé APRÈS tous les
  // autres effets -- sémantique "curseur de console" : il règle le niveau final de la voix, sans changer
  // la façon dont un bitcrusher ou une reverb réagissent au signal qui les précède.
  if (wants('volume')) {
    const vol = ctx.createGain();
    chainEnd.connect(vol);
    chainEnd = vol;
    nodes.volume = vol;
  }

  const chain = { input, output: chainEnd, nodes };
  applyFxToChain(ctx, chain, fx, 0);
  // Fondu d'entrée de la coupure (chantier 2) : après l'application initiale, depuis la fréquence de départ.
  ['lowcut', 'highcut'].forEach(k => {
    const c = fx[k];
    if (!nodes[k] || !c || c.fadeFromFrequency == null || !(c.fadeDurationSec > 0)) return;
    const qs = FX_CUT_Q_DB[fxCutSlope(c)];
    nodes[k].forEach((f, i) => {
      if (i >= qs.length) return;
      f.frequency.cancelScheduledValues(0);
      f.frequency.setValueAtTime(c.fadeFromFrequency, when);
      f.frequency.linearRampToValueAtTime(c.frequency || (k === 'lowcut' ? 150 : 3000), when + c.fadeDurationSec);
    });
  });
  return chain;
}
