/* ---------------- Journal de prise (Adaptive OST, Figer -- 25/09) ----------------
 * Quand l'enregistrement des prises est activé (setTakeRecording(true) : page fan, onglet Albums -- JAMAIS sur les
 * pages publiques, où rien de tout ceci ne s'exécute), le lecteur note tout ce qu'il fait réellement jouer : chaque
 * fichier (instant, position de départ, boucle, vitesse), chaque mouvement de volume (intensité, bascules, fondus,
 * muet/solo, duck), chaque changement d'effet, chaque Sfx et sa place dans la salle, la tête de l'auditeur. Le rendu
 * (LayerCaptureRender.renderTake) rejoue ce journal note pour note avec le même moteur : une version figée est
 * EXACTEMENT ce qui a été entendu -- tirages au sort, embranchements et queues de fin compris -- sans rejouer les
 * gestes ni rendre le hasard reproductible (voir layerpitch-docs/adaptive-ost-albums-page-fan.md).
 * Mécanisme : une fois activé, chaque nœud créé par le contexte audio (source, gain) consigne ses commandes avec leur
 * heure du contexte audio ; chaque moteur signale ensuite quelle source, quel gain et quelle chaîne d'effets forment
 * une voix (journalVoice). Les heures sont converties en "temps d'écoute" (pauses retirées) à la lecture du journal. */
let takeRecordingEnabled = false;
const trackTakeReaders = {};
const _bufferUrls = new WeakMap(); // AudioBuffer décodé -> URL de son fichier publié (rendu hors-ligne)
const _arrayBufferUrls = new WeakMap(); // octets téléchargés -> URL, le temps du décodage
const _takeYawLog = [];
let _hrtfWarmPanner = null; // panoramique binaural créé au chargement, pour que le navigateur charge ses données HRTF d'avance // [heure du contexte, orientation] -- la tête est commune à toute la page
const TAKE_PARAM_METHODS = { setValueAtTime: 'set', linearRampToValueAtTime: 'lin', exponentialRampToValueAtTime: 'exp', setTargetAtTime: 'tgt', cancelScheduledValues: 'cancel', cancelAndHoldAtTime: 'hold' };
function journalParam(param) {
  if (!param || param.__lpLog) return;
  const log = { init: param.value, auto: [] };
  param.__lpLog = log;
  Object.keys(TAKE_PARAM_METHODS).forEach(m => {
    const orig = param[m];
    if (typeof orig !== 'function') return;
    const tag = TAKE_PARAM_METHODS[m];
    param[m] = function () {
      const a = arguments;
      if (tag === 'cancel' || tag === 'hold') log.auto.push([tag, a[0]]);
      else if (tag === 'tgt') log.auto.push([tag, a[1], a[0], a[2]]);
      else log.auto.push([tag, a[1], a[0]]);
      return orig.apply(param, a);
    };
  });
  // Affectation directe (param.value = x) : équivaut à un setValueAtTime immédiat.
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(param), 'value');
  if (desc && desc.get && desc.set) {
    try {
      Object.defineProperty(param, 'value', { configurable: true, get() { return desc.get.call(param); }, set(v) { log.auto.push(['set', ctx.currentTime, v]); desc.set.call(param, v); } });
    } catch (e) { /* navigateur qui refuse : seules les affectations directes échappent au journal */ }
  }
}
function journalSourceNode(src) {
  const info = { starts: [], stops: [] };
  src.__lpInfo = info;
  journalParam(src.playbackRate);
  const start0 = src.start, stop0 = src.stop;
  src.start = function (when, offset, duration) {
    info.starts.push({ when: Math.max(when || 0, ctx.currentTime), offset: offset || 0, duration: duration != null ? duration : null,
      loop: src.loop ? [src.loopStart, src.loopEnd] : null, url: src.buffer ? (_bufferUrls.get(src.buffer) || null) : null });
    return start0.apply(src, arguments);
  };
  src.stop = function (when) { info.stops.push([ctx.currentTime, Math.max(when || 0, ctx.currentTime)]); return stop0.apply(src, arguments); };
}
// Voix spatiale d'un Sfx : réglage réellement utilisé au démarrage (compositeur + matrice du visiteur + curseur), point
// de trajectoire tiré, puis chaque déplacement en direct (matrice, curseur) et chaque bascule du rendu 3D.
function journalSpatialVoice(voice, spUsed) {
  const log = { sp: JSON.parse(JSON.stringify(spUsed)), stepIndex: voice.stepIndex, calls: [] };
  voice.__lpSpatial = log;
  const setPosition0 = voice.setPosition, setReverbDb0 = voice.setReverbDb, setBinaural0 = voice.setBinaural;
  voice.setPosition = function (x, y, rampSec, atTime) { log.calls.push([atTime != null ? atTime : ctx.currentTime, 'pos', x, y, rampSec || 0]); return setPosition0.apply(voice, arguments); };
  voice.setReverbDb = function (db, rampSec, atTime) { log.calls.push([atTime != null ? atTime : ctx.currentTime, 'rev', db, rampSec || 0]); return setReverbDb0.apply(voice, arguments); };
  voice.setBinaural = function (b) { log.calls.push([ctx.currentTime, 'bin', !!b]); return setBinaural0.apply(voice, arguments); };
}
function setTakeRecording(on) {
  on = !!on;
  if (on && !ctx.__lpJournaled) {
    // Posé une seule fois et pour de bon : tout nœud créé ensuite consigne ses commandes (coût négligeable).
    ctx.__lpJournaled = true;
    const createGain0 = ctx.createGain.bind(ctx), createSource0 = ctx.createBufferSource.bind(ctx);
    ctx.createGain = function () { const n = createGain0(); if (takeRecordingEnabled) journalParam(n.gain); return n; };
    ctx.createBufferSource = function () { const n = createSource0(); if (takeRecordingEnabled) journalSourceNode(n); return n; };
    document.addEventListener('layerpitch-head-yaw', e => { if (takeRecordingEnabled) _takeYawLog.push([ctx.currentTime, +e.detail || 0]); });
  }
  takeRecordingEnabled = on;
}
// Décodage d'un fichier audio pour la lecture d'une version figée (lecteur d'album, 25/09) : natif d'abord, puis le
// décodeur Ogg Vorbis de secours (Safari ne sait pas décoder l'Ogg nativement) -- même relais que celui de chaque
// morceau (voir decodeAudioDataCompat dans initTrackPlayer), avec sa propre instance de décodeur.
let _takeVorbisDecoder = null;
async function decodeAudioCompat(arrayBuffer) {
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (nativeError) {
    if (!window['ogg-vorbis-decoder']) throw nativeError;
    if (!_takeVorbisDecoder) _takeVorbisDecoder = (async () => { const d = new window['ogg-vorbis-decoder'].OggVorbisDecoder(); await d.ready; return d; })();
    const decoder = await _takeVorbisDecoder;
    await decoder.reset();
    const { channelData, samplesDecoded, sampleRate } = await decoder.decode(new Uint8Array(arrayBuffer));
    if (!samplesDecoded || !channelData || !channelData.length) throw nativeError;
    const audioBuffer = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
    for (let ch = 0; ch < channelData.length; ch++) audioBuffer.copyToChannel(channelData[ch], ch);
    return audioBuffer;
  }
}
// Dernière prise d'un morceau (celle en cours, ou la dernière écoute terminée), en données pures (JSON) -- null si
// l'enregistrement n'est pas activé ou si le morceau n'a jamais été joué depuis.
function getTrackTake(trackId) {
  const read = trackTakeReaders[trackId];
  return read ? read() : null;
}

// Empêche l'écran de se verrouiller pendant qu'une piste joue (sinon le tél s'éteint "comme si de rien
// n'était" pendant une écoute) — best-effort, l'API n'existe pas partout, et le verrou se relâche de
// toute façon automatiquement si l'onglet passe en arrière-plan (voir la reprise après veille plus bas).
const playingTrackIds = new Set(); // pas activeTrackId : celui-ci n'est jamais effacé sur une simple pause manuelle
let wakeLock = null;
async function requestWakeLock() {
  if (!navigator.wakeLock || wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
  catch (e) { /* refusé ou indisponible : tant pis, ce n'est qu'un confort */ }
}
function releaseWakeLockIfIdle() {
  if (wakeLock && playingTrackIds.size === 0) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
if (navigator.wakeLock) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && playingTrackIds.size > 0) requestWakeLock();
  });
}

// Icône graphique discrète (bouclier + coche), réutilisée pour le badge collectif et le badge par
// morceau — un symbole plutôt qu'un texte, pour rester discret sur la page publique.
function noAiBadgeSvg() {
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z"/><path d="M8.5 12.2l2.4 2.4 4.8-4.8"/></svg>`;
}
// Icône info générique (cercle + "i") — même mécanisme de bulle d'aide native que noAiBadgeSvg ci-dessus
// (icône dans un <span title="...">, survol/clic géré par le navigateur) : réutilisée pour tout libellé
// public qui a besoin d'une explication au survol, sans introduire de nouveau composant de tooltip.
function infoBadgeSvg() {
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.6" r="0.6" fill="currentColor" stroke="none"/></svg>`;
}
// elementColors (optionnel, Chantier Apparence par élément, palier Pro, 05/09) : { waveform: {playedColor,
// unplayedColor}, progressBar: {playedColor, unplayedColor} } -- résolu côté page hôte (index.html) à
// partir de block.elementAppearance, jamais recalculé ici. Absent = comportement inchangé (couleurs
// cssVar('--border')/cssVar('--accent') existantes), appliqué uniformément à TOUTES les pistes de ce
// bloc (réglage par élément = par bloc, pas par morceau individuel).
function renderTracksBlock(container, tracks, packsByTrackId, globalNoAiCertified, elementColors) {
  // Si TOUT le lot rendu ici est certifié (que ce soit via le réglage global ou une exception explicite
  // par morceau), un seul badge discret à côté du titre "Musique" suffit — pas la peine de répéter la
  // même icône sur chaque ligne. Sinon, chaque morceau certifié garde son propre badge individuel.
  const effectiveCertified = (track) => (track.noAiOverride === true || track.noAiOverride === false) ? track.noAiOverride : !!globalNoAiCertified;
  const allCertified = !!(tracks && tracks.length && tracks.every(effectiveCertified));
  const titleHtml = allCertified
    ? `${t('musicSection')} <span class="no-ai-badge no-ai-badge-collective" title="${t('noAiBadgeAllTitle')}">${noAiBadgeSvg()}</span>`
    : t('musicSection');
  const el = section(titleHtml, '');
  container.appendChild(el);
  if (!tracks || tracks.length === 0) {
    el.innerHTML += `<div class="empty">${t('noTracksPublished')}</div>`;
    return;
  }

  tracks.forEach(track => {
    const packsForTrack = (packsByTrackId && packsByTrackId[track.id]) || [];
    const row = buildTrackRow(track, packsForTrack, globalNoAiCertified, allCertified);
    // Repère purement décoratif (aucun effet sur la lecture) -- permet à un outil externe de retrouver
    // quelle ligne correspond à quel morceau sans deviner par l'ordre du DOM (mode Capture, pack.html).
    row.dataset.trackId = track.id;
    el.appendChild(row);
    initTrackPlayer(track, row, elementColors);
  });
}

// track (optionnel) : permet d'affiner le libellé du mode séquentiel selon que le morceau a
// réellement au moins un embranchement configuré (segmentSlots[].nextOptions) — l'embranchement y
// étant une fonctionnalité optionnelle par emplacement, contrairement à embranchement-vertical où la
// bascule entre boucles nommées est la nature même du mode, donc toujours mentionnée. Sans `track`
// (repli), le libellé de base "séquentiel" est utilisé — ne devrait arriver qu'en dehors du rendu
// normal d'une piste (aucun appelant connu actuellement dans ce cas).
function getModeLabel(mode, track) {
  const hasSeqBranching = !!(track && (track.segmentSlots || []).some(sl => sl.nextOptions && sl.nextOptions.length));
  const map = {
    static: t('modeStatic'),
    vertical: t('modeVertical'),
    'vertical-random': t('modeVerticalRandom'),
    sequential: hasSeqBranching ? t('modeSequentialBranching') : t('modeSequential'),
    'embranchement-vertical': t('modeEmbranchementVertical')
  };
  return map[mode] || mode;
}
const PLAYABLE_MODES = ['static', 'vertical', 'vertical-random', 'sequential', 'embranchement-vertical'];

function layerHasSource(l) { return !!(l && (l.localFile || l.localUrl || l.file)); }

// Résout une section vertical-random qui duplique une autre (referencesSectionId) vers sa section
// source réelle — pools ET tempo/timeline viennent tous de la source (mêmes fichiers, même minutage),
// seul le libellé affiché reste celui de la section dupliquée elle-même. Même principe que
// canonicalPoolKey/canonicalSlotKey utilisés ailleurs pour les autres duplications.
function resolveVRSection(track, idx) {
  const sections = track.sections || [];
  const sec = sections[idx];
  if (!sec) return null;
  if (sec.referencesSectionId) {
    const src = sections.find(s => s.id === sec.referencesSectionId);
    return src || sec;
  }
  return sec;
}
function vrSectionIsPlayable(track, idx) {
  const r = resolveVRSection(track, idx);
  return !!(r && (r.pools || []).some(p => (p.alternatives || []).some(layerHasSource)));
}

