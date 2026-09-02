(function() {
// player.js — Moteur de lecture partagé entre index.html et pack.html (LayerPitch)
// Un seul endroit pour le rendu des morceaux et toute la logique audio (bouclage simple + quantifié, stingers, intensité).
// Chargé comme script classique (<script src="player.js"></script>) — fonctionne en file:// comme en https://,
// contrairement aux modules ES qui sont bloqués par les navigateurs en ouverture locale directe.

const ctx = new (window.AudioContext || window.webkitAudioContext)();

// Contournement de l'interrupteur silencieux physique sur iOS Safari : le Web Audio API respecte cet
// interrupteur (contrairement à une balise <audio> classique, qui l'ignore déjà). Un visiteur qui ouvre
// un lien de pitch avec l'interrupteur activé n'entendrait donc rien et croirait le lecteur cassé.
// Technique connue et documentée (utilisée notamment par les librairies unmute-ios-audio et unmute) :
// faire jouer en boucle un très court son silencieux via <audio> force iOS à basculer tout l'audio de la
// page — Web Audio compris — sur le canal "média" plutôt que le canal "sonnerie", qui seul respecte
// l'interrupteur. Contournement non officiel (pas garanti par Apple), mais stable depuis plusieurs années.
// Le fichier est un WAV silencieux de 50ms encodé en base64, généré localement — aucune dépendance externe,
// compatible file://.
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
let iosSilentUnlockDone = false;
function unlockIOSSilentSwitch() {
  if (iosSilentUnlockDone) return;
  iosSilentUnlockDone = true;
  try {
    const el = new Audio(SILENT_WAV_DATA_URI);
    el.loop = true;
    el.setAttribute('x-webkit-airplay', 'deny');
    el.play().catch(() => {});
  } catch (e) { /* best-effort : un échec ici ne doit jamais bloquer la lecture normale */ }
}
// Même endroit que ctx.resume() car les deux répondent au même besoin (débloquer l'audio suite à un
// geste utilisateur) — appeler les deux ensemble évite d'avoir à les dupliquer à chaque point d'appel.
function resumeAudioContext() {
  if (ctx.state === 'suspended') ctx.resume();
  unlockIOSSilentSwitch();
}

// Dupliqué à l'identique dans index.html et pack.html : chaque script a sa propre closure, pas d'accès
// croisé possible. Jamais bloquant, silencieux si Umami n'est pas chargé.
// Le contexte (quel AdReel ou quel Pack a généré l'événement) est déposé sur `window.__lpTrackContext`
// par la page hôte (index.html ou pack.html) dès qu'elle connaît son propre identifiant — permet de
// distinguer dans Umami "le lien envoyé au Studio X" plutôt qu'un compteur global indifférencié.
function trackPublicEvent(name, detail) {
  try {
    if (!window.umami) return;
    const ctx = window.__lpTrackContext || {};
    window.umami.track(name, Object.assign({}, detail, ctx.type ? { [ctx.type]: ctx.id } : {}));
  } catch (e) { /* jamais bloquant */ }
}

// Traductions de l'habillage généré par le moteur (statuts, boutons, libellés de mode...) — pas le
// Traductions de l'habillage généré par le moteur (statuts, boutons, libellés de mode...) — pas le
// contenu des morceaux eux-mêmes (titres, descriptions, labels de couches saisis par le compositeur).
// Vit dans layerpitch-i18n.js (zones "shared" + "player"), chargé avant ce script — édité via l'outil
// dédié, jamais à la main. Ce fichier n'a pas besoin de balayer le DOM après coup : le texte est inséré
// directement dans les gabarits au moment de leur construction, via t('clé').
//
// La langue n'est plus lue depuis localStorage ici : chaque page hôte (index.html, pack.html,
// layerpitch-backstage.html) la détermine elle-même selon son propre contexte (langue de l'AdReel,
// paramètre d'URL du pack, réglage du backstage) et l'impose via setLang() avant de construire quoi
// que ce soit. Évite qu'un visiteur voie une langue différente de celle choisie par le compositeur.
let CURRENT_LANG = 'fr';
function setLang(lang) { CURRENT_LANG = (lang === 'en') ? 'en' : 'fr'; }
// Bibliothèque de Sfx de la page en cours, fournie une fois par la page publique (index.html) avant le
// rendu des morceaux — permet à buildTrackRow/initTrackPlayer de résoudre track.sfxIds (simples id) en
// entrées Sfx complètes (titre, variations, réglage aléatoire/séquentiel) sans threader ce paramètre à
// travers toute la chaîne d'appel (renderTracksBlock -> buildTrackRow -> initTrackPlayer).
let SFX_LIBRARY_BY_ID = {};
function setSfxLibrary(byId) { SFX_LIBRARY_BY_ID = byId || {}; }
/* ---------------- Téléchargement gratuit (zip généré côté navigateur) ----------------
 * Partagée entre pack.html et collection.html (un pack télécharge ses morceaux, une collection ceux de
 * tous ses packs) — un seul endroit pour cette logique plutôt que dupliquée dans les deux pages.
 * Aucune dépendance backend : chaque fichier audio déjà publié est simplement re-téléchargé et regroupé
 * en zip dans le navigateur du visiteur. JSZip n'est chargé qu'au moment du clic, jamais au chargement
 * de la page — un visiteur qui ne télécharge jamais ne paie aucun coût pour cette fonction.
 */
let jsZipLoadPromise = null;
function ensureJSZipLoaded() {
  if (window.JSZip) return Promise.resolve();
  if (!jsZipLoadPromise) {
    jsZipLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('JSZip introuvable (bloqué ou hors ligne)'));
      document.head.appendChild(s);
    });
  }
  return jsZipLoadPromise;
}
function slugifyForFile(s) {
  return (s || 'fichier').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'fichier';
}
// Rassemble tous les fichiers audio publiés d'un morceau, quel que soit son mode — un morceau vertical
// ou séquentiel n'a pas "un" fichier mais plusieurs (couches, variations, intro/segment/outro) ; le
// téléchargement gratuit les inclut tous plutôt que de n'en choisir arbitrairement qu'un seul.
function collectTrackAudioFiles(track) {
  const out = [];
  const push = (label, file) => { if (file) out.push({ label: label || 'Fichier', file }); };
  (track.layers || []).forEach((l, i) => push(l.label || `Couche ${i + 1}`, l.file));
  if (track.intro) push(track.intro.label || 'Intro', track.intro.file);
  (track.sections || []).forEach((sec, si) => {
    if (sec.referencesSectionId) return; // duplique une autre section : mêmes fichiers, déjà inclus via elle
    (sec.pools || []).forEach((p, pi) => (p.alternatives || []).forEach((a, ai) =>
      push(`${sec.label || 'Section ' + (si + 1)} - ${p.label || 'Pool ' + (pi + 1)} - ${a.label || 'Variation ' + (ai + 1)}`, a.file)));
  });
  (track.segmentSlots || []).forEach((sl, si) => (sl.alternatives || []).forEach((a, ai) =>
    push(`${sl.label || 'Emplacement ' + (si + 1)} - ${a.label || 'Variation ' + (ai + 1)}`, a.file)));
  if (track.outro) push(track.outro.label || 'Outro', track.outro.file);
  return out;
}
// zipBaseName : nom du fichier .zip généré (titre du pack, ou de la collection). tracks : liste de
// morceaux déjà résolus (objets complets, pas juste des ids) — dédupliqués par l'appelant si besoin
// (un même morceau pourrait apparaître dans plusieurs packs d'une même collection).
async function downloadTracksAsZip(zipBaseName, tracks) {
  await ensureJSZipLoaded();
  const zip = new JSZip();
  let fileCount = 0;
  for (const track of tracks) {
    const files = collectTrackAudioFiles(track);
    if (!files.length || !track.base) continue;
    const folder = zip.folder(slugifyForFile(track.title));
    for (const f of files) {
      const v = track.publishedAt ? ('?v=' + encodeURIComponent(track.publishedAt)) : '';
      const res = await fetch(track.base + encodeURIComponent(f.file) + v);
      if (!res.ok) continue; // un fichier manquant ne doit pas faire échouer tout le zip
      const blob = await res.blob();
      const ext = (f.file.split('.').pop() || 'ogg').toLowerCase();
      folder.file(`${slugifyForFile(f.label)}.${ext}`, blob);
      fileCount++;
    }
  }
  if (!fileCount) throw new Error('Aucun fichier audio disponible pour ce téléchargement.');
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugifyForFile(zipBaseName)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// Partage d'un lien — utilisé par les pages publiques (bouton "Partager") et par le backstage (AdReel,
// pack, collection). Utilise la Web Share API du navigateur quand elle est disponible (menu natif :
// WhatsApp, Discord, Messages... sur mobile, et de plus en plus sur desktop aussi), sinon copie le lien
// dans le presse-papier. Retourne un statut plutôt que de gérer l'affichage elle-même — chaque appelant
// reste responsable de son propre retour visuel (silencieux si le menu natif s'est ouvert, "Copié" sinon).
async function shareOrCopy(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ url, title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'; // le visiteur a fermé le menu sans choisir
      // Autre échec (rare) : on retente via la copie plutôt que de laisser un clic sans aucun effet.
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch (e) { /* presse-papier bloqué (permissions) : rien de plus à tenter */ }
  }
  return 'unavailable';
}
function currentLang() { return CURRENT_LANG; }
// t('clé', {placeholder: valeur}) — remplace {placeholder} dans la chaîne traduite si fourni.
// Ordre de repli : zone player dans la langue courante -> zone shared dans la langue courante ->
// zone player en français (au cas où l'anglais ne serait pas encore traduit) -> zone shared en français
// -> la clé elle-même (filet de sécurité si layerpitch-i18n.js n'a pas encore chargé ou est incomplet).
function t(key, vars) {
  const I18N = window.LAYERPITCH_I18N || { fr: { shared: {}, player: {} }, en: { shared: {}, player: {} } };
  const dict = I18N[currentLang()] || I18N.fr;
  const dictFr = I18N.fr;
  let str = (dict.player && dict.player[key]) || (dict.shared && dict.shared[key])
    || (dictFr.player && dictFr.player[key]) || (dictFr.shared && dictFr.shared[key]) || key;
  if (vars) Object.keys(vars).forEach(k => { str = str.replace('{' + k + '}', vars[k]); });
  return str;
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}
// Déplie/replie la vue détaillée d'une piste en mesurant sa vraie hauteur en JS plutôt qu'en s'appuyant
// sur l'astuce CSS grid-template-rows 0fr/1fr, qui ne réduisait pas correctement à zéro dans certains
// navigateurs (résidu visible : la description "fuyait" même piste repliée).
function setDetailsExpanded(details, expanded) {
  if (!details) return;
  const inner = details.querySelector('.track-row-details-inner');
  if (expanded) {
    details.classList.add('expanded');
    details.style.maxHeight = (inner ? inner.scrollHeight : 0) + 'px';
  } else {
    details.classList.remove('expanded');
    details.style.maxHeight = '0px';
  }
}
function cumulativeProfiles(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Array.from({ length: n }, (_, j) => (j <= i ? 1 : 0)));
  return out;
}
function section(label, innerHTML) {
  const el = document.createElement('div');
  el.className = 'block';
  el.innerHTML = (label ? `<div class="section-label">${label}</div>` : '') + innerHTML;
  return el;
}
function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function linkify(s) { return escapeHtml(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'); }

/* ---------------- Waveform (fonctions pures, niveau module) ----------------
 * Hissées hors de initTrackPlayer (elles ne dépendaient d'aucune fermeture de piste) pour être
 * réutilisables ailleurs — notamment le lecteur de Sfx, qui a besoin de la même logique de dessin sans
 * dupliquer tout le fichier une troisième fois.
 */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
// maxDurationSec (optionnel) : limite l'analyse aux X premières secondes du buffer plutôt qu'à sa
// totalité — utile pour les blocs Intro/Segment du mode séquentiel, dont le fichier réel déborde
// volontairement au-delà de sa durée musicale nominale (queue de recouvrement crossfade). Sans ce
// paramètre (ou si absent), le comportement est inchangé : buffer analysé dans son intégralité.
function computeWaveformPeaks(buffer, bucketCount, maxDurationSec) {
  const data = buffer.getChannelData(0); // un seul canal suffit pour une représentation visuelle
  const fullLength = data.length;
  const length = (maxDurationSec != null)
    ? Math.max(1, Math.min(fullLength, Math.round(maxDurationSec * buffer.sampleRate)))
    : fullLength;
  const samplesPerBucket = Math.max(1, Math.floor(length / bucketCount));
  const peaks = new Array(bucketCount).fill(0);
  for (let i = 0; i < bucketCount; i++) {
    let max = 0;
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, length);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  // Lissage léger (moyenne pondérée avec les deux voisins immédiats) : atténue les barres isolées trop
  // erratiques d'une frame à l'autre sans aplatir le relief général — le niveau de détail vient du
  // nombre de barres (voir bucketCountForWidth), pas de la précision brute de chacune.
  return peaks.map((v, i) => {
    const prev = i > 0 ? peaks[i - 1] : v;
    const next = i < peaks.length - 1 ? peaks[i + 1] : v;
    return v * 0.6 + prev * 0.2 + next * 0.2;
  });
}
// Nombre de barres calculé à partir de la largeur réellement affichée plutôt qu'un nombre fixe choisi à
// l'aveugle : trop grossier sur un grand format (waveform statique pleine largeur), ou au contraire plus
// de barres que de pixels physiques disponibles sur un petit format (nœud du graphe vertical-random).
const WAVEFORM_BAR_PITCH_PX = 4; // largeur barre + espace visés, en px CSS
function bucketCountForWidth(cssWidthPx) {
  return Math.max(24, Math.min(320, Math.round(cssWidthPx / WAVEFORM_BAR_PITCH_PX)));
}
function drawWaveformCanvas(canvas, peaks, color) {
  if (!canvas || !peaks) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (w < 2 || h < 2) return; // pas encore mis en page (ex. onglet caché) : on retentera au prochain redraw
  canvas.width = w; canvas.height = h;
  const c2d = canvas.getContext('2d');
  c2d.clearRect(0, 0, w, h);
  c2d.fillStyle = color;
  const barCount = peaks.length;
  const slot = w / barCount;
  // Barres aérées (pas collées) avec coins arrondis pour un rendu moins anguleux — repli silencieux sur
  // des rectangles droits si roundRect n'est pas supporté (Safari < 16, très marginal aujourd'hui).
  const barWidth = Math.max(1, slot * 0.62);
  const radius = Math.min(barWidth / 2, 2.5 * dpr);
  const mid = h / 2;
  for (let i = 0; i < barCount; i++) {
    const amp = Math.max(0.04, peaks[i]); // hauteur minimale visible même sur un silence
    const barH = Math.max(2 * dpr, amp * h);
    const x = i * slot + (slot - barWidth) / 2;
    const y = mid - barH / 2;
    if (c2d.roundRect) { c2d.beginPath(); c2d.roundRect(x, y, barWidth, barH, radius); c2d.fill(); }
    else { c2d.fillRect(x, y, barWidth, barH); }
  }
}
// Point d'entrée commun : mesure la largeur une seule fois (bg/fg partagent la même taille), calcule les
// pics une seule fois pour les deux calques plutôt que de dupliquer le travail.
function renderWaveformPair(bgCanvas, fgCanvas, buffer, bgColor, fgColor, maxDurationSec) {
  if (!buffer) return;
  const refCanvas = bgCanvas || fgCanvas;
  if (!refCanvas) return;
  const cssWidth = refCanvas.getBoundingClientRect().width;
  if (cssWidth < 2) return;
  const peaks = computeWaveformPeaks(buffer, bucketCountForWidth(cssWidth), maxDurationSec);
  if (bgCanvas) drawWaveformCanvas(bgCanvas, peaks, bgColor);
  if (fgCanvas) drawWaveformCanvas(fgCanvas, peaks, fgColor);
}

/* ---------------- État partagé entre toutes les pistes de la page (une seule instance par page chargée) ---------------- */
const trackCollapsers = {};
const trackStingerKillers = {};
let activeTrackId = null;

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
function renderTracksBlock(container, tracks, packsByTrackId, globalNoAiCertified) {
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
    el.appendChild(row);
    initTrackPlayer(track, row);
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

function layerHasSource(l) { return !!(l && (l.localFile || l.file)); }

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

// ---------------- Vertical-random : logique pure d'enchaînement des sections ----------------
// Fonction volontairement pure (aucune dépendance à Web Audio, à ctx, ni à quoi que ce soit dans le DOM) —
// elle décide UNIQUEMENT quoi jouer ensuite, jamais comment. Le code Web Audio (incrément 2) ne fera
// qu'appeler decideNext() et traduire son résultat en programmation de sources sonores. Séparée ainsi
// pour pouvoir être testée exhaustivement sans avoir besoin de faire jouer de son réel — voir
// test-section-scheduler.js.
//
// playableSections : tableau de { maxLoops: number|null }, dans l'ordre déclaré par le compositeur,
//   DÉJÀ FILTRÉ aux sections qui ont au moins un fichier chargé (même convention que pickNextSegmentSlot
//   pour le séquentiel, qui saute silencieusement les emplacements vides plutôt que de casser la chaîne).
// options.randomize : brassage complet (true) ou ordre fixe (false) — voir décision du 30/07.
// options.hasIntro / options.hasOutro : présence d'un fichier intro/outro pour ce morceau.
//
// Retour de decideNext() : un descripteur de ce qu'il faut programmer ensuite, ou null si plus rien à
// programmer après le générateur en cours (fin naturelle, comme le séquentiel existant sans outro) :
//   { type: 'intro' }
//   { type: 'section', index, isFirstEverForThisSection }
//   { type: 'outro' }
function createSectionPlaybackScheduler(playableSections, options) {
  const randomize = !!(options && options.randomize);
  const hasIntro = !!(options && options.hasIntro);
  const hasOutro = !!(options && options.hasOutro);
  const n = playableSections.length;

  function buildOrder() {
    const base = Array.from({ length: n }, (_, i) => i);
    if (!randomize) return base;
    // Fisher-Yates : un brassage complet par cycle — chaque section joue exactement une fois par
    // passage, seul l'ORDRE est mélangé (une section dupliquée plusieurs fois dans la liste pèse donc
    // plus lourd, sans jamais être "perdue" — voir discussion du 30/07 sur le choix brassage vs pioche).
    for (let i = base.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = base[i]; base[i] = base[j]; base[j] = tmp;
    }
    return base;
  }

  let order = buildOrder();
  let orderPos = 0;
  let loopsPlayedInSection = 0;
  let chainCyclesCompleted = 0;
  const everStarted = new Array(n).fill(false);
  let introConsumed = !hasIntro;
  let goToEndRequested = false;
  let goToNextRequested = false;

  function requestGoToEnd() { goToEndRequested = true; }
  function requestGoToNextSection() { goToNextRequested = true; }

  function advanceOrder() {
    loopsPlayedInSection = 0;
    orderPos++;
    if (orderPos >= n) {
      orderPos = 0;
      if (randomize) order = buildOrder(); // nouveau brassage à chaque cycle complet
      // Un cycle complet vient de se refermer (retour au début de l'ordre) — c'est la frontière qui
      // compte pour maxChainLoops, indépendamment de la raison de l'avancement (maxLoops d'une section
      // épuisé ou "section suivante" demandée manuellement, les deux passent par advanceOrder()).
      // Lu ici (pas mis en cache à la création) : options.maxChainLoops peut être un getter branché sur
      // une valeur mutable côté appelant (voir playVerticalRandom), pour un changement pris en compte au
      // vol sans recréer le scheduler.
      chainCyclesCompleted++;
      const maxChainLoops = (options && options.maxChainLoops) || null;
      if (maxChainLoops && chainCyclesCompleted >= maxChainLoops) goToEndRequested = true;
    }
  }

  function decideNext() {
    if (!introConsumed) {
      introConsumed = true;
      return { type: 'intro' };
    }
    if (goToEndRequested) {
      goToEndRequested = false;
      // Sans outro définie : rien à programmer après le générateur en cours — il va simplement jusqu'à
      // sa fin réelle (même comportement que le séquentiel existant sans outro).
      return hasOutro ? { type: 'outro' } : null;
    }
    if (n === 0) return null;

    // "Aller vers la section suivante" : la décision en cours (le générateur qui va être programmé MAINTENANT,
    // juste après celui qui joue déjà) saute directement à la section suivante — le générateur déjà en cours
    // de lecture n'est jamais interrompu, seul ce qui vient après change. Vérifié explicitement avec
    // Jules-Antoine : "attend la fin de la section en cours", jamais une répétition en plus.
    if (goToNextRequested) {
      goToNextRequested = false;
      advanceOrder();
    }

    const sectionIndex = order[orderPos];
    const isFirstEverForThisSection = !everStarted[sectionIndex];
    everStarted[sectionIndex] = true;
    loopsPlayedInSection++;

    const maxLoops = playableSections[sectionIndex].maxLoops;
    if (maxLoops && loopsPlayedInSection >= maxLoops) advanceOrder();

    return { type: 'section', index: sectionIndex, isFirstEverForThisSection };
  }

  return { decideNext, requestGoToEnd, requestGoToNextSection };
}

// ---------------- Séquentiel : avancement pur d'un cran dans la chaîne d'emplacements ----------------
// Fonction volontairement pure (aucune closure, aucune dépendance à l'audio) — factorise les deux
// endroits de pickNextSegmentSlot qui avancent currentSlotIndex pour EXACTEMENT la même raison (un
// emplacement vide qu'on saute, ou un repeatCount épuisé) : les deux cas font "avancer d'un cran dans la
// chaîne", point sur lequel on peut détecter un cycle complet (retour à l'emplacement 0) et compter vers
// maxChainLoops. `chainState` est un objet partagé { cyclesCompleted, capReached } muté en place par
// l'appelant, pour rester lisible sans faire de cette fonction un objet à part entière comme le
// scheduler du vertical-random (voir décision du 31/07 — pas nécessaire ici, pickNextSegmentSlot garde
// la responsabilité du choix d'alternative et du saut des emplacements vides, qui dépendent des buffers
// audio réels et ne sont donc pas testables de la même façon). Testée isolément dans
// test-slot-chain-advancer.js.
function advanceChainIndex(index, n, chainState, maxChainLoops) {
  const nextIndex = (index + 1) % n;
  if (nextIndex === 0) {
    chainState.cyclesCompleted = (chainState.cyclesCompleted || 0) + 1;
    if (maxChainLoops && chainState.cyclesCompleted >= maxChainLoops) chainState.capReached = true;
  }
  return nextIndex;
}

function buildTrackRow(track, packsForTrack, globalNoAiCertified, suppressIndividualBadge) {
  packsForTrack = packsForTrack || [];
  // Même logique qu'effectiveNoAiCertified() côté Backstage : une exception explicite par morceau
  // (true/false) prime sur le réglage global, sinon on suit le réglage global. Pas affiché du tout si
  // le badge collectif (tout le catalogue certifié) est déjà montré une fois pour tout le bloc.
  const isNoAiCertified = !suppressIndividualBadge && ((track.noAiOverride === true || track.noAiOverride === false) ? track.noAiOverride : !!globalNoAiCertified);
  const supported = PLAYABLE_MODES.includes(track.mode);
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const isEmbrVert = track.mode === 'embranchement-vertical';
  const loops = !isStatic || !!track.loopable;
  // Même plafond que progressMaxSec() dans initTrackPlayer : vertical-random affiche la longueur du
  // cycle qui boucle de la PREMIÈRE section jouable, pas celle du fichier le plus long de tous les pools
  // de toutes les sections (voir le commentaire détaillé dans initTrackPlayer).
  const displayMaxSec = (() => {
    if (!isVerticalRandom) return track.duration;
    const sections = track.sections || [];
    let firstPlayable = null;
    for (let i = 0; i < sections.length; i++) { if (vrSectionIsPlayable(track, i)) { firstPlayable = resolveVRSection(track, i); break; } }
    if (!firstPlayable) return track.duration;
    const spb = 60 / (firstPlayable.bpm || 120);
    const lIn = (firstPlayable.loopInBeat || 0) * spb;
    const lOut = Math.max(lIn + spb, (firstPlayable.loopOutBeat || (firstPlayable.beatsPerBar || 4) * 4) * spb);
    return lOut || track.duration;
  })();
  const hasFiles = supported && (isVerticalRandom
    ? (track.sections || []).some((s, i) => vrSectionIsPlayable(track, i))
    : isSequential
    ? (track.segmentSlots || []).some(sl => (sl.alternatives || []).some(layerHasSource))
    : isEmbrVert
    ? (track.loops || []).some(layerHasSource)
    : layerHasSource(track.layers[0]) && (isStatic || track.layers.every(layerHasSource)));

  const wrapper = document.createElement('div');
  wrapper.className = 'track-row-wrapper';

  let intensityBlockHtml = '';
  if (track.mode === 'vertical' && supported) {
    const n = track.layers.length;
    const chips = Array.from({ length: n }, (_, i) => {
      const customLabel = (track.layers[i] && track.layers[i].label) ? track.layers[i].label : '';
      const inner = customLabel
        ? `<span class="intensity-chip-num">${i + 1}</span>${escapeHtml(customLabel)}`
        : String(i + 1);
      return `<button type="button" class="intensity-chip${i === 0 ? ' active' : ''}" data-level="${i}">${inner}</button>`;
    }).join('');
    intensityBlockHtml = `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('intensityLabel')}</div>
        <div class="intensity-picker" data-role="slider">${chips}</div>
      </div>
    `;
  }

  // Boutons nommés d'embranchement-vertical : une boucle autonome par bouton (pas un curseur continu,
  // contrairement au vertical classique) — la boucle marquée isInitial est active par défaut. Le bouton
  // de la boucle actuellement audible porte la classe "active" ; celui d'une boucle plus courte que la
  // référence (donc un aller-retour à sens unique, pas une boucle qu'on peut garder) est désactivé
  // pendant qu'elle joue (voir selectEmbrLoop côté moteur) pour éviter un retrigger qui casserait le calage.
  let embrVertBlockHtml = '';
  if (isEmbrVert && supported) {
    const loopsList = track.loops || [];
    const refBars = (loopsList.find(l => l.isInitial) || loopsList[0] || {}).bars;
    const isShortLoop = (l, isRef) => !isRef && refBars != null && l.bars != null && l.bars < refBars;
    // Seuils de dégradation du visuel riche (voir CHANGELOG du 02/09) : 2-4 boucles paires = hauteur
    // pleine (34px, comme .seq-block) ; 5-7 = hauteur interpolée jusqu'à un plancher de 20px, en dessous
    // duquel les barres de drawWaveformCanvas() fusionnent visuellement ; 8+ = repli complet sur le
    // gabarit compact (bouton texte simple, comportement inchangé).
    const peerCount = loopsList.filter(l => !isShortLoop(l, !!l.isInitial)).length;
    const embrRichMode = peerCount <= 7;
    const embrRowH = peerCount <= 4 ? 34 : Math.round(34 - (Math.min(peerCount, 7) - 4) * (14 / 3));
    const buttons = loopsList.map((l, i) => {
      const isRef = !!l.isInitial;
      const isShort = isShortLoop(l, isRef);
      const label = escapeHtml(l.label || t('loopFallback', { n: i + 1 }));
      if (embrRichMode && !isShort) {
        return `<button type="button" class="embr-loop-btn embr-wave-btn${isRef ? ' active' : ''}" data-loop-id="${escapeHtml(l.id || String(i))}" data-loop-idx="${i}" data-short="0"><canvas class="embr-wave-bg" data-role="embrWaveBg-${i}"></canvas><canvas class="embr-wave-fg" data-role="embrWaveFg-${i}"></canvas><span class="embr-wave-label">${label}</span></button>`;
      }
      return `<button type="button" class="embr-loop-btn${isRef ? ' active' : ''}" data-loop-id="${escapeHtml(l.id || String(i))}" data-loop-idx="${i}" data-short="${isShort ? '1' : '0'}">${label}</button>`;
    }).join('');
    embrVertBlockHtml = `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('embrLoopsLabel')}</div>
        <div class="intensity-picker" data-role="embrLoopPicker"${embrRichMode ? ` style="--embr-row-h:${embrRowH}px"` : ''}>${buttons}</div>
      </div>
    `;
  }

  // Panneau "En cours" pour le vertical classique : un vumètre par couche, qui reflète en direct
  // son gain réel — visible pendant le fondu enchaîné quand l'intensité change (façon Wwise Voice Graph).
  let vertGraphHtml = '';
  if (track.mode === 'vertical' && supported) {
    vertGraphHtml = `
      <div class="voice-graph" data-role="vertGraph">
        <div class="voice-graph-label">${t('inProgressLabel')}</div>
        ${track.layers.map((l, i) => `
          <div class="voice-row-wrap">
            <div class="voice-row">
              <span class="voice-row-label">${escapeHtml((l && l.label) || t('layerFallback', { n: i + 1 }))}</span>
              <span class="voice-meter-bar" data-role="vertMeter-${i}"><span class="voice-meter-bar-fill"></span></span>
              <div class="wwise-node-controls">
                <button type="button" class="voice-ctrl-btn" data-voice-action="solo" data-voice-key="layer-${i}" title="${t('soloTitle')}">S</button>
                <button type="button" class="voice-ctrl-btn" data-voice-action="mute" data-voice-key="layer-${i}" title="${t('muteTitle')}">M</button>
              </div>
            </div>
            <div class="voice-volume-row">
              <input type="range" class="voice-volume-slider" data-voice-key="layer-${i}" min="0" max="1.5" step="0.01" value="1" title="${t('volumeTitle')}" aria-label="${t('volumeTitle')}">
              <span class="voice-volume-value" data-role="volumeValue-layer-${i}">100%</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  let voiceGraphHtml = '';
  if (isVerticalRandom && supported) {
    // Nombre de "voix" affichées : le plus grand nombre de pools parmi toutes les sections jouables — une
    // section qui en a moins voit simplement ses voix excédentaires masquées à l'écran au moment de jouer
    // (même mécanisme que les tirages silencieux existants), plutôt que de reconstruire tout le graphe en
    // HTML à chaque changement de section.
    const allSections = track.sections || [];
    const maxPoolCount = Math.max(0, ...allSections.map((s, i) => (resolveVRSection(track, i) || {}).pools?.length || 0));
    const sectionBlocks = allSections.map((sec, i) => `
      <div class="seq-block" data-role="vrBlock-${i}">
        <div class="vr-block-fill" data-role="vrBlockFill-${i}"></div>
        <span class="seq-block-label">${escapeHtml(sec.label || t('sectionFallback', { n: i + 1 }))}</span>
      </div>
    `).join('');
    // Une petite liste déroulante par section, alignée sous chaque bloc — affichée en permanence (pas
    // seulement pour la section active), pour régler section.maxLoops indépendamment de maxChainLoops
    // (qui porte sur la chaîne entière). Désactivée si la section n'a aucun contenu jouable.
    const sectionLoopOptions = [null, 1, 2, 3, 5, 10];
    const sectionLoopRow = allSections.map((sec, i) => {
      const label = sec.label || t('sectionFallback', { n: i + 1 });
      const current = resolveVRSection(track, i).maxLoops || null;
      return `
      <div style="flex:1">
        <select data-role="vrSectionLoop-${i}" title="${escapeHtml(t('sectionLoopCountTitle', { label }))}">
          ${sectionLoopOptions.map(n => `<option value="${n === null ? '' : n}"${current === n ? ' selected' : ''}>${n === null ? '∞' : n}</option>`).join('')}
        </select>
      </div>`;
    }).join('');
    const poolNodes = Array.from({ length: maxPoolCount }, (_, pi) => `
      <div class="wwise-node wwise-node-voice" data-role="wwiseVoice-pool-${pi}">
        <div class="wwise-node-top">
          <div class="wwise-node-label" data-role="voiceCurrent-${pi}">—</div>
          <div class="wwise-node-controls">
            <button type="button" class="voice-ctrl-btn" data-voice-action="solo" data-voice-key="pool-${pi}" title="${t('soloTitle')}">S</button>
            <button type="button" class="voice-ctrl-btn" data-voice-action="mute" data-voice-key="pool-${pi}" title="${t('muteTitle')}">M</button>
          </div>
        </div>
        <div class="voice-volume-row">
          <input type="range" class="voice-volume-slider" data-voice-key="pool-${pi}" min="0" max="1.5" step="0.01" value="1" title="${t('volumeTitle')}" aria-label="${t('volumeTitle')}">
          <span class="voice-volume-value" data-role="volumeValue-pool-${pi}">100%</span>
        </div>
        <span class="wwise-node-wave">
          <canvas class="wwise-wave-bg" data-role="voiceWaveBg-${pi}"></canvas>
          <canvas class="wwise-wave-fg" data-role="voiceWaveFg-${pi}"></canvas>
        </span>
      </div>
    `).join('');
    voiceGraphHtml = `
      <div class="voice-graph" data-role="voiceGraph">
        <div class="voice-graph-label">${t('inProgressLabel')}</div>
        <div class="voice-row">
          <span class="voice-row-label">${t('currentSectionLabel')}</span>
          <span class="voice-row-current" data-role="sectionCurrent">—</span>
        </div>
        ${sectionBlocks ? `<div class="seq-blocks" data-role="vrBlocks">${sectionBlocks}</div>` : ''}
        ${sectionBlocks ? `<div class="seq-blocks" data-role="vrSectionLoopRow" style="margin-top:2px">${sectionLoopRow}</div>` : ''}
        <div class="wwise-graph" data-role="wwiseGraph">
          <svg class="wwise-graph-lines" data-role="wwiseLines"></svg>
          <div class="wwise-col wwise-col-source">
            <div class="wwise-node wwise-node-source" data-role="wwiseSource">${escapeHtml(track.title || t('trackFallback'))}</div>
          </div>
          <div class="wwise-col wwise-col-voices">
            ${poolNodes}
          </div>
          <div class="wwise-col wwise-col-bus">
            <div class="wwise-node wwise-node-bus" data-role="wwiseBus">${t('outputNode')}</div>
          </div>
        </div>
        <div class="actions" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <button type="button" class="voice-refresh-btn" data-role="refreshPool">${t('refreshPool')}</button>
          <button type="button" class="voice-refresh-btn" data-role="goToNextSectionBtn" disabled>${t('goToNextSectionBtn')}</button>
          <button type="button" class="voice-refresh-btn" data-role="goToEndBtn" disabled>${t('goToEndBtn')}</button>
        </div>
      </div>
    `;
  }

  let seqGraphHtml = '';
  if (isSequential && supported) {
    const hasIntro = layerHasSource(track.intro);
    const hasOutro = layerHasSource(track.outro);
    seqGraphHtml = `
      <div class="voice-graph" data-role="seqGraph">
        <div class="voice-graph-label">${t('inProgressLabel')}</div>
        <div class="seq-blocks" data-role="seqBlocks">
          ${hasIntro ? `<div class="seq-block" data-role="seqBlock-intro"><canvas class="seq-block-wave-bg" data-role="seqWaveBg-intro"></canvas><canvas class="seq-block-wave-fg" data-role="seqWaveFg-intro"></canvas><span class="seq-block-label">${t('introLabel')}</span></div>` : ''}
          <div class="seq-block" data-role="seqBlock-segment"><canvas class="seq-block-wave-bg" data-role="seqWaveBg-segment"></canvas><canvas class="seq-block-wave-fg" data-role="seqWaveFg-segment"></canvas><span class="seq-block-label">${t('segmentLabel')}</span></div>
          ${hasOutro ? `<div class="seq-block" data-role="seqBlock-outro"><canvas class="seq-block-wave-bg" data-role="seqWaveBg-outro"></canvas><canvas class="seq-block-wave-fg" data-role="seqWaveFg-outro"></canvas><span class="seq-block-label">${t('outroLabel')}</span></div>` : ''}
        </div>
        <div class="voice-row">
          <span class="voice-meter" data-role="seqMeter"></span>
          <span class="voice-row-current" data-role="seqCurrent">—</span>
        </div>
        <div class="seq-branch-options" data-role="seqBranchOptions"></div>
        <div class="seq-pending-indicator" data-role="seqPendingIndicator" style="display:none">${t('pendingBranchLabel')}</div>
        <button type="button" class="voice-refresh-btn" data-role="goToEndBtn" disabled ${hasOutro ? '' : 'style="display:none"'}>${t('goToEndBtn')}</button>
      </div>
    `;
  }

  // Carte globale des chemins (02/09) : un nœud par emplacement de la chaîne, remplie/mise à jour
  // dynamiquement par updateSeqMap()/drawSeqMapLines() (voir bloc dédié dans initTrackPlayer) -- vide au
  // rendu initial (ni lecture ni structure "toujours révélée" avant l'exécution JS), sauf en mode
  // Backstage (seqMapFullReveal) où elle se remplit dès le chargement des buffers.
  let seqMapHtml = '';
  if (isSequential && supported) {
    seqMapHtml = `
      <div class="seq-map" data-role="seqMap">
        <div class="voice-graph-label">${t('seqMapLabel')}</div>
        <div class="seq-map-graph" data-role="seqMapGraph">
          <div class="seq-map-canvas" data-role="seqMapCanvas">
            <svg class="seq-map-lines" data-role="seqMapLines"></svg>
            <div class="seq-map-nodes" data-role="seqMapNodes"></div>
          </div>
        </div>
      </div>
    `;
  }

  // Sélecteur de boucles : uniquement pour les pistes qui utilisent le moteur quantifié (seul moteur
  // qui connaît la notion de cycle et donc de "nombre de boucles"). Valeur par défaut = celle choisie
  // par le compositeur, modifiable ici par le visiteur — la piste applique le changement au vol.
  // Le vertical-random n'est PAS concerné ici : depuis la fusion des modes, il a son propre sélecteur de
  // cycles de chaîne plus bas (chainLoopCountHtml), lié à maxChainLoops et non à maxLoops.
  const useQuantizedLoopForUI = (loops && track.loopEngine === 'quantized');
  let loopCountHtml = '';
  if (useQuantizedLoopForUI && supported) {
    const options = [null, 1, 2, 3, 5, 10];
    const current = track.maxLoops || null;
    loopCountHtml = `
      <div class="loop-count-block">
        <div class="loop-count-label">${t('loopCountLabel')}</div>
        <select data-role="loopCountSelect">
          ${options.map(n => `<option value="${n === null ? '' : n}"${current === n ? ' selected' : ''}>${n === null ? t('infiniteLoops') : n}</option>`).join('')}
        </select>
      </div>
    `;
  }

  // Sélecteur du nombre de cycles complets de la chaîne avant transition automatique — séquentiel et
  // vertical-random uniquement (voir maxChainLoops, décision du 31/07). Indépendant de section.maxLoops
  // (réglable section par section juste sous les blocs, pour le vertical-random — voir sectionLoopRowHtml).
  let chainLoopCountHtml = '';
  if ((isSequential || isVerticalRandom) && supported) {
    const options = [null, 1, 2, 3, 5, 10];
    const current = track.maxChainLoops || null;
    chainLoopCountHtml = `
      <div class="loop-count-block">
        <div class="loop-count-label">${t('chainLoopCountLabel')}</div>
        <select data-role="chainLoopCountSelect">
          ${options.map(n => `<option value="${n === null ? '' : n}"${current === n ? ' selected' : ''}>${n === null ? t('infiniteLoops') : n}</option>`).join('')}
        </select>
      </div>
    `;
  }

  wrapper.innerHTML = `
    <div class="track-row">
      <button class="play-btn" data-role="playBtn" disabled aria-label="${t('loadingAriaLabel')}">
        <svg data-role="playIcon" class="loading-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-dasharray="28 100"/></svg>
      </button>
      <div class="track-row-title" data-role="titleToggle">
        <span class="name">${escapeHtml(track.title)}</span>
        ${isNoAiCertified ? `<span class="no-ai-badge" title="${t('noAiBadgeTitle')}">${noAiBadgeSvg()}</span>` : ''}
        <span class="mode-tag">${getModeLabel(track.mode, track)}</span>
        ${supported ? `
          <span class="loop-icon" title="${loops ? 'Bouclable' : 'Ne boucle pas'}">
            ${loops
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>'}
          </span>
        ` : ''}
      </div>
    </div>
    <div class="track-row-details" data-role="details">
     <div class="track-row-details-inner">
      <div class="track-desc" data-role="trackDesc">${linkify(track.description || '')}</div>
      ${packsForTrack && packsForTrack.length ? `<div class="pack-link">${packsForTrack.map(p => `<a href="./pack.html?id=${encodeURIComponent(p.id)}">${t('partOfPack', { title: escapeHtml(p.title) })}</a>`).join('<br>')}</div>` : ''}
      ${!supported ? `<span class="placeholder-tag">Mode "${track.mode}" pas encore supporté</span>` :
        !hasFiles ? `<span class="placeholder-tag">Fichiers audio manquants</span>` : (
        (isSequential || isVerticalRandom || isEmbrVert) ? `
          <div class="status" data-role="status">Chargement…</div>
        ` : `
        <div class="status" data-role="status">Chargement…</div>
        <div class="progress-wrap${isStatic ? ' waveform-mode' : ''}" data-role="progressWrap">
          ${isStatic ? `
            <canvas class="waveform-bg" data-role="waveformBg"></canvas>
            <canvas class="waveform-fg" data-role="waveformFg"></canvas>
          ` : `
            <div class="progress-track"></div>
            <div class="progress-fill" data-role="progressFill"></div>
            <div class="progress-head" data-role="progressHead"></div>
          `}
        </div>
        <div class="time-row"><span data-role="timeCurrent">0:00</span><span data-role="timeTotal">${formatTime(displayMaxSec)}</span></div>
        ${(track.sfxIds && track.sfxIds.length) ? `
          <div class="track-sfx-row">
            ${track.sfxIds.map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean).map((sfx, i) => `<button class="stinger-btn" data-stinger="${i}" data-sfx-id="${sfx.id}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml((track.sfxLabelOverrides && track.sfxLabelOverrides[sfx.id]) || sfx.title || ('Sfx ' + (i + 1)))}</button>`).join('')}
          </div>
        ` : ''}
      `)}
      ${intensityBlockHtml}
      ${embrVertBlockHtml}
      ${loopCountHtml}
      ${chainLoopCountHtml}
      ${voiceGraphHtml}
      ${vertGraphHtml}
      ${seqGraphHtml}
      ${seqMapHtml}
      ${(isSequential || isVerticalRandom || isEmbrVert) && track.sfxIds && track.sfxIds.length ? `
        <div class="track-sfx-row">
          ${track.sfxIds.map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean).map((sfx, i) => `<button class="stinger-btn" data-stinger="${i}" data-sfx-id="${sfx.id}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml((track.sfxLabelOverrides && track.sfxLabelOverrides[sfx.id]) || sfx.title || ('Sfx ' + (i + 1)))}</button>`).join('')}
        </div>
      ` : ''}
     </div>
    </div>
  `;

  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    setDetailsExpanded(details, !details.classList.contains('expanded'));
  });

  return wrapper;
}

function initTrackPlayer(track, wrapper) {
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const isEmbrVert = track.mode === 'embranchement-vertical';
  const supported = PLAYABLE_MODES.includes(track.mode);
  // Harmonisation des volumes : décision du compositeur (case à cocher dans le backstage), jamais
  // automatique — sinon un fichier qui sonne différemment de ce qu'il a exporté serait déroutant.
  // Le gain mesuré à la conversion reste stocké dans tous les cas ; ce n'est que son application à la
  // lecture qui dépend de ce réglage.
  function effGain(item) {
    return (track.normalizeVolume && item && item.gain) ? item.gain : 1;
  }
  // Solo/muet par voix (vertical et vertical-random) : plusieurs voix peuvent être soloées en même temps
  // (convention DAW classique) — dès qu'au moins une l'est, tout le reste se tait, quel que soit son
  // propre état muet. "Voix" = une couche (vertical), une couche fixe ou un groupe entier (vertical-random,
  // pas chaque alternative individuellement, puisqu'une seule alternative par groupe sonne à la fois).
  const mutedVoices = new Set();
  const soloedVoices = new Set();
  // Volume par voix (vertical et vertical-random) : réglage continu (slider 0-150%, défaut 100% = volume
  // du fichier source, rien d'atténué au départ) — même clé que Solo/Muet ('layer-i' / 'pool-i'), même
  // principe de vie : en mémoire seulement, jamais persisté, remis à 100% au rechargement de la page.
  const layerVolumes = new Map();
  function getLayerVolume(key) {
    return layerVolumes.has(key) ? layerVolumes.get(key) : 1;
  }
  function voiceGain(key) {
    const soloMute = soloedVoices.size > 0 ? (soloedVoices.has(key) ? 1 : 0) : (mutedVoices.has(key) ? 0 : 1);
    return soloMute * getLayerVolume(key);
  }
  // Recalcule en direct le gain de toutes les sources actuellement en train de sonner (génération en
  // cours et éventuelles queues encore audibles) — sans ça, un solo/muet ne prendrait effet qu'à la
  // prochaine génération programmée, avec un délai pouvant aller jusqu'à la longueur du cycle.
  function refreshVoiceGains() {
    const now = ctx.currentTime;
    const p = profiles[level] || profiles[0];
    activeGenSources.forEach(({ gain, voiceKey, baseGain }) => {
      if (!voiceKey || !gain) return;
      // Vertical classique : le gain dépend de l'intensité courante, qui peut avoir changé depuis que
      // cette génération a été programmée (via le curseur) — on le recalcule plutôt que de se fier à
      // une valeur figée, sinon un changement d'intensité récent serait ignoré par ce recalcul.
      let base = baseGain != null ? baseGain : 1;
      if (voiceKey.indexOf('layer-') === 0) {
        const i = parseInt(voiceKey.slice(6), 10);
        base = (p[i] || 0) * effGain(layersToLoad[i]);
      }
      const target = base * voiceGain(voiceKey);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(target, now + 0.15);
    });
    // Moteur simple (vertical sans moteur quantifié) : les gains vivent dans gains[], pas activeGenSources.
    if (!useQuantizedLoop && gains.length && playing) {
      gains.forEach((g, i) => {
        if (!g) return;
        const base = (p[i] || 0) * effGain(layersToLoad[i]);
        const target = base * voiceGain('layer-' + i);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(target, now + 0.15);
      });
    }
  }
  const hasFiles = supported && (isVerticalRandom
    ? (track.sections || []).some((s, i) => vrSectionIsPlayable(track, i))
    : isSequential
    ? (track.segmentSlots || []).some(sl => (sl.alternatives || []).some(layerHasSource))
    : isEmbrVert
    ? (track.loops || []).some(layerHasSource)
    : layerHasSource(track.layers[0]) && (isStatic || track.layers.every(layerHasSource)));
  if (!hasFiles) return;

  const layersToLoad = (isVerticalRandom || isSequential || isEmbrVert) ? [] : (isStatic ? [track.layers[0]] : track.layers);
  const profiles = (isVerticalRandom || isSequential || isEmbrVert) ? [] : (isStatic ? [[1]] : cumulativeProfiles(track.layers.length));
  const loops = !isStatic || !!track.loopable; // toujours vrai pour vertical-random (isStatic est faux)
  const useQuantizedLoop = !isSequential && !isVerticalRandom && !isEmbrVert && (loops && track.loopEngine === 'quantized');
  // Sfx attachés à ce morceau (ex-"stingers") — résolus depuis la Bibliothèque Sfx partagée, chacun
  // pouvant porter plusieurs variations round robin (contrairement à l'ancien stinger, un seul fichier).
  const attachedSfx = (track.sfxIds || []).map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean);
  const totalSfxFilesToLoad = attachedSfx.reduce((n, sfx) => n + (sfx.alternatives || []).filter(a => a.file || a.localFile).length, 0);
  // Gain maître de CE morceau : tout ce qui sonne pour lui (une seule couche statique, plusieurs couches
  // vertical/vertical-random simultanées, ou les générations successives du moteur séquentiel) route par
  // ici plutôt que directement vers la destination — point d'accroche unique pour le ducking (Phase 4),
  // qui doit baisser TOUT le morceau en cours d'un coup, peu importe son mode de lecture.
  const trackMasterGain = ctx.createGain();
  trackMasterGain.connect(ctx.destination);
  // Ducking : abaisse brièvement le gain maître du morceau pendant qu'un Sfx réglé pour ça est en train
  // de jouer, pour le mettre en valeur, puis remonte — réglage propre à chaque Sfx (duckMainTrack), pas
  // au morceau. Rampes linéaires plutôt qu'un changement instantané, moins désagréable à l'oreille.
  // Baisse plafonnée à 30% (DUCK_LEVEL = 0.7) : la descente reste rapide et nette, mais la remontée
  // démarre dès la moitié du Sfx et s'étale sur une rampe longue — quitte à se terminer après la fin du
  // Sfx lui-même, plutôt que la remontée courte et collée à la toute fin d'avant.
  const DUCK_ATTACK_SEC = 0.08;
  const DUCK_RELEASE_SEC = 1.2;
  const DUCK_LEVEL = 0.7;
  function duckMainTrack(sfxDurationSec) {
    const now = ctx.currentTime;
    trackMasterGain.gain.cancelScheduledValues(now);
    trackMasterGain.gain.setValueAtTime(trackMasterGain.gain.value, now);
    trackMasterGain.gain.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_ATTACK_SEC);
    const restoreAt = now + Math.max(DUCK_ATTACK_SEC, sfxDurationSec / 2);
    trackMasterGain.gain.setValueAtTime(DUCK_LEVEL, restoreAt);
    trackMasterGain.gain.linearRampToValueAtTime(1, restoreAt + DUCK_RELEASE_SEC);
  }

  // Paramètres du moteur quantifié (BPM/mesures + queue de fin superposée) — ignorés si useQuantizedLoop est faux
  const bpm = track.bpm || 120;
  const beatsPerBar = track.beatsPerBar || 4;
  const secondsPerBeat = 60 / bpm;
  const loopInSec = (track.loopInBeat || 0) * secondsPerBeat;
  const loopOutSec = Math.max(loopInSec + secondsPerBeat, (track.loopOutBeat || beatsPerBar * 4) * secondsPerBeat);
  const cycleLength = loopOutSec - loopInSec;
  // Pour vertical-random, track.duration reflète le fichier le PLUS LONG de tout le pool (couches fixes
  // + toutes les alternatives de tous les groupes), pas la longueur du cycle qui boucle réellement —
  // un seul alternative par groupe joue à la fois, souvent bien plus courte que la plus longue du pool.
  // Sans ce plafond, cliquer loin dans la barre programme un bufferOffset au-delà de la longueur réelle
  // des buffers en cours de lecture (silence, plus de boucle). Les autres modes gardent track.duration :
  // toutes leurs couches partagent la même durée par convention, donc pas le même risque.
  // Fonction plutôt que valeur figée : track.duration n'est connu avec certitude qu'une fois le
  // décodage terminé (voir plus bas), donc on le relit à chaque appel plutôt que de le geler trop tôt.
  // Pour vertical-random, la durée affichée est celle du cycle de la section EN COURS (celle qui joue
  // réellement, ou à défaut la première jouable avant tout démarrage) — plus un tempo unique partagé par
  // tout le morceau, chaque section ayant désormais sa propre timeline (30/07).
  function progressMaxSec() {
    if (!isVerticalRandom) return track.duration;
    const origIdx = vrCurrentSectionOriginalIndex >= 0 ? vrCurrentSectionOriginalIndex : (playableSectionOriginalIndex[0] !== undefined ? playableSectionOriginalIndex[0] : -1);
    if (origIdx < 0) return track.duration;
    const section = resolveVRSection(track, origIdx);
    return (section ? sectionTiming(section).loopOutSec : 0) || track.duration;
  }
  // StartTrackPoint : où démarre la toute première lecture (permet de sauter un silence en tête).
  // Ne s'applique qu'au moteur quantifié — le moteur simple garde son comportement natif inchangé.
  const startTrackSec = Math.min((track.startTrackBeat || 0) * secondsPerBeat, loopInSec);

  const playBtn = wrapper.querySelector('[data-role="playBtn"]');
  const playIcon = wrapper.querySelector('[data-role="playIcon"]');
  const details = wrapper.querySelector('[data-role="details"]');
  const statusEl = wrapper.querySelector('[data-role="status"]');
  const wrap = wrapper.querySelector('[data-role="progressWrap"]');
  const fill = wrapper.querySelector('[data-role="progressFill"]');
  const head = wrapper.querySelector('[data-role="progressHead"]');
  // Recale max-height si le contenu change de taille pendant que la piste est dépliée (ex. le statut
  // qui passe de "Chargement…" à "Prêt", ou une waveform qui apparaît) — sinon la hauteur mesurée au
  // moment du dépli deviendrait obsolète et couperait ou laisserait un vide sous le contenu.
  const detailsInnerEl = details.querySelector('.track-row-details-inner');
  if (detailsInnerEl && window.ResizeObserver) {
    new ResizeObserver(() => {
      if (details.classList.contains('expanded')) details.style.maxHeight = detailsInnerEl.scrollHeight + 'px';
    }).observe(detailsInnerEl);
  }
  // Waveform (mode statique uniquement — une seule couche jouée à la fois, donc "la" forme d'onde du
  // morceau a un sens ; ambigu pour vertical/vertical-random où plusieurs couches sonnent ensemble).
  const waveformBg = wrapper.querySelector('[data-role="waveformBg"]');
  const waveformFg = wrapper.querySelector('[data-role="waveformFg"]');
  let waveformBuffer = null;
  function redrawWaveforms() {
    renderWaveformPair(waveformBg, waveformFg, waveformBuffer, cssVar('--border', '#ccc'), cssVar('--accent', '#c9713c'));
  }
  if (waveformBg && waveformFg) {
    // Redessine si le contraste renforcé change (couleurs différentes) ou si le conteneur change de taille
    // (redimensionnement de fenêtre, ou premier dépli depuis l'état replié).
    document.addEventListener('layerpitch-contrast-changed', redrawWaveforms);
    if (window.ResizeObserver) new ResizeObserver(redrawWaveforms).observe(waveformBg);
  }
  const timeCurrent = wrapper.querySelector('[data-role="timeCurrent"]');
  const timeTotal = wrapper.querySelector('[data-role="timeTotal"]');
  const notchDots = [...wrapper.querySelectorAll('.intensity-chip')];
  const embrLoopBtns = [...wrapper.querySelectorAll('.embr-loop-btn')];
  const stingerBtns = [...wrapper.querySelectorAll('.stinger-btn')];
  const loopCountSelect = wrapper.querySelector('[data-role="loopCountSelect"]');
  const chainLoopCountSelect = wrapper.querySelector('[data-role="chainLoopCountSelect"]');
  // Vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07) : le graphe affiche des
  // "emplacements de voix" génériques (pool-0, pool-1, ...), dimensionnés au plus grand nombre de pools
  // parmi toutes les sections — quand la section en cours en a moins, les emplacements excédentaires sont
  // simplement masqués (même mécanisme que les tirages silencieux déjà existants), plutôt que de
  // reconstruire le graphe en HTML à chaque changement de section.
  const vrMaxPoolCount = isVerticalRandom ? Math.max(0, ...(track.sections || []).map((s, i) => (resolveVRSection(track, i) || {}).pools?.length || 0)) : 0;
  const voiceWavePools = Array.from({ length: vrMaxPoolCount }, (_, pi) => ({
    bg: wrapper.querySelector(`[data-role="voiceWaveBg-${pi}"]`),
    fg: wrapper.querySelector(`[data-role="voiceWaveFg-${pi}"]`)
  }));
  const voiceCurrents = Array.from({ length: vrMaxPoolCount }, (_, pi) => wrapper.querySelector(`[data-role="voiceCurrent-${pi}"]`));
  // Dessine la waveform d'une voix vertical-random (alternative piochée dans un pool) — même principe
  // fond/avant-plan que la waveform du mode statique et les blocs du mode séquentiel.
  function drawVoiceWave(els, buffer) {
    if (!els || !els.bg || !els.fg || !buffer) return;
    renderWaveformPair(els.bg, els.fg, buffer, cssVar('--border', '#ccc'), cssVar('--accent', '#c9713c'));
  }
  // Graphe de nœuds façon Wwise (Voice Graph) pour vertical-random : source -> une voix par emplacement
  // de pool -> bus de sortie, reliés par des connecteurs courbes dessinés en SVG. Le nombre d'emplacements
  // est fixe pour un morceau donné (seul le libellé/l'état de chaque emplacement change selon la section
  // en cours et le tirage), donc les connecteurs ne sont redessinés qu'au premier rendu, au
  // redimensionnement, et quand un emplacement apparaît/disparaît (changement de section).
  const wwiseGraphEl = wrapper.querySelector('[data-role="wwiseGraph"]');
  const wwiseLinesEl = wrapper.querySelector('[data-role="wwiseLines"]');
  const wwiseSourceEl = wrapper.querySelector('[data-role="wwiseSource"]');
  const wwiseBusEl = wrapper.querySelector('[data-role="wwiseBus"]');
  const wwisePoolVoiceEls = Array.from({ length: vrMaxPoolCount }, (_, pi) => wrapper.querySelector(`[data-role="wwiseVoice-pool-${pi}"]`));
  const wwiseVoiceEls = wwisePoolVoiceEls;
  function drawWwiseLines() {
    if (!wwiseGraphEl || !wwiseLinesEl || !wwiseSourceEl || !wwiseBusEl) return;
    const rect = wwiseGraphEl.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    wwiseLinesEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    wwiseLinesEl.innerHTML = '';
    const srcRect = wwiseSourceEl.getBoundingClientRect();
    const busRect = wwiseBusEl.getBoundingClientRect();
    const srcPoint = { x: srcRect.right - rect.left, y: srcRect.top + srcRect.height / 2 - rect.top };
    const busPoint = { x: busRect.left - rect.left, y: busRect.top + busRect.height / 2 - rect.top };
    wwiseVoiceEls.forEach(voiceEl => {
      if (!voiceEl || voiceEl.style.display === 'none') return; // voix actuellement silencieuse : pas de connecteur vers du vide
      const vRect = voiceEl.getBoundingClientRect();
      const vLeft = { x: vRect.left - rect.left, y: vRect.top + vRect.height / 2 - rect.top };
      const vRight = { x: vRect.right - rect.left, y: vRect.top + vRect.height / 2 - rect.top };
      const mid1 = (srcPoint.x + vLeft.x) / 2;
      const path1 = document.createElementNS(svgNS, 'path');
      path1.setAttribute('d', `M ${srcPoint.x} ${srcPoint.y} C ${mid1} ${srcPoint.y}, ${mid1} ${vLeft.y}, ${vLeft.x} ${vLeft.y}`);
      path1.setAttribute('class', 'wwise-line');
      wwiseLinesEl.appendChild(path1);
      const mid2 = (vRight.x + busPoint.x) / 2;
      const path2 = document.createElementNS(svgNS, 'path');
      path2.setAttribute('d', `M ${vRight.x} ${vRight.y} C ${mid2} ${vRight.y}, ${mid2} ${busPoint.y}, ${busPoint.x} ${busPoint.y}`);
      path2.setAttribute('class', 'wwise-line');
      wwiseLinesEl.appendChild(path2);
    });
  }
  if (wwiseGraphEl) {
    requestAnimationFrame(drawWwiseLines); // laisse le temps à un premier passage de mise en page
    if (window.ResizeObserver) new ResizeObserver(drawWwiseLines).observe(wwiseGraphEl);
  }
  // Vumètres du mode vertical classique — remplissage en direct sur le vrai gain de chaque couche,
  // visible pendant le fondu enchaîné quand l'intensité change (voir tick() plus bas).
  const vertMeterFills = (track.mode === 'vertical' ? track.layers : []).map((l, i) => wrapper.querySelector(`[data-role="vertMeter-${i}"] .voice-meter-bar-fill`));
  const seqMeterEl = wrapper.querySelector('[data-role="seqMeter"]');
  const seqCurrentEl = wrapper.querySelector('[data-role="seqCurrent"]');
  // Texte affiché par-dessus la description du morceau pendant la lecture séquentielle — mis à jour
  // uniquement quand l'emplacement/transition en cours en déclare un (voir pickStageDescription()) : un
  // champ vide laisse volontairement le texte précédent affiché plutôt que de revenir à la description du
  // morceau (ex. une intro sans texte propre doit laisser voir la description du morceau jusqu'au premier
  // emplacement qui en a un — comportement demandé explicitement le 15/08, obtenu gratuitement par cette
  // règle "ne jamais écraser par du vide" sans cas particulier à coder).
  const trackDescEl = wrapper.querySelector('[data-role="trackDesc"]');
  const seqBranchOptionsEl = wrapper.querySelector('[data-role="seqBranchOptions"]');
  const seqPendingIndicatorEl = wrapper.querySelector('[data-role="seqPendingIndicator"]');
  // Carte globale des chemins (02/09) -- voir updateSeqMap()/drawSeqMapLines() plus bas.
  // Carte globale des chemins (02/09) : .seq-map-graph est la fenêtre défilable (overflow-x:auto),
  // .seq-map-canvas le contenu dimensionné par JS (voir updateSeqMap()), .seq-map-lines/.seq-map-nodes
  // deux calques superposés à l'intérieur de ce contenu. Positions calculées en JS (pas de mesure
  // getBoundingClientRect), donc pas besoin de ResizeObserver ici -- contrairement au graphe Wwise voisin
  // (drawWwiseLines), qui lui mesure le DOM et doit être rappelé au redimensionnement.
  const seqMapGraphEl = wrapper.querySelector('[data-role="seqMapGraph"]');
  const seqMapCanvasEl = wrapper.querySelector('[data-role="seqMapCanvas"]');
  const seqMapLinesEl = wrapper.querySelector('[data-role="seqMapLines"]');
  const seqMapNodesEl = wrapper.querySelector('[data-role="seqMapNodes"]');
  const goToEndBtn = wrapper.querySelector('[data-role="goToEndBtn"]');
  const goToNextSectionBtn = wrapper.querySelector('[data-role="goToNextSectionBtn"]');
  const sectionCurrentEl = wrapper.querySelector('[data-role="sectionCurrent"]');
  const vrBlockEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrBlock-${i}"]`));
  const vrBlockFillEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrBlockFill-${i}"]`));
  const vrSectionLoopSelectEls = (track.sections || []).map((s, i) => wrapper.querySelector(`[data-role="vrSectionLoop-${i}"]`));
  // Référence live vers les objets réellement lus par sectionScheduler.decideNext() à chaque cycle — les
  // muter en place (voir vrSectionLoopSelectEls ci-dessous) fait donc effet au vol, sans recréer le
  // scheduler ni interrompre la lecture en cours (même principe que track.maxLoops pour le moteur quantifié).
  let vrPlayableSectionRefs = [];

  let buffers = [], sources = [], gains = []; // moteur simple
  let activeGenSources = []; // moteur quantifié : [{src, gain}], toutes générations (dont queues) confondues
  // ---- État moteur embranchement-vertical (voir bloc dédié plus bas pour la logique) ----
  let embrLoopBuffers = []; // un buffer par boucle déclarée (même ordre que track.loops), null si manquante
  let embrTransitionBuffers = []; // idem, un buffer de transition optionnel par boucle (24/08), null si absente/pas de fichier
  let embrActiveTransitionSources = []; // sources de transition actuellement en train de sonner -- suivies pour pouvoir les couper sur Stop (voir stopEmbrVertical)
  let embrActiveGenSources = []; // {src, gain, loopIdx} des générations "pairs" (même longueur que la référence) en cours
  let embrActiveLoopIdx = -1; // index (dans track.loops) de la boucle actuellement AUDIBLE
  let embrSchedulerTimer = null;
  let embrNextStartCtxTime = 0;
  let embrDetourTimeout = null; // minuterie du retour auto à la référence après une boucle courte
  let embrDetourSource = null; // {src, gain} du détour en cours, si il y en a un
  let embrDetourBtn = null; // bouton désactivé le temps de ce détour, si il y en a un
  // ---- Ajouts 24/08 : timing de bascule quantifié, minuteur de retour pour les boucles paires, mode
  // "en boucle jusqu'à un bouton" pour les boucles détour (voir bloc moteur dédié plus bas) ----
  let embrReferenceStartCtxTime = 0; // ctx.currentTime du tout premier démarrage de la référence -- horloge de phase pour la quantification
  let embrPendingSwitchTimeout = null; // bascule quantifiée en attente (annulée/remplacée si un nouveau clic arrive avant qu'elle ne s'exécute)
  let embrAutoReturnTimeout = null; // minuterie de retour auto d'une boucle PAIRE (différent de embrDetourTimeout, qui concerne les boucles courtes)
  let embrEndLoopBtnEl = null; // bouton "Mettre fin à la boucle" inséré dynamiquement pendant un détour en mode "en boucle jusqu'à un bouton"
  let embrIntroLockTimeout = null; // verrouillage des boutons pendant le segment Départ→Entrée de la référence au tout premier lancement (29/08) -- voir playEmbrVertical()
  let embrPendingTransitionSwitchTimeout = null; // bascule réelle en attente le temps qu'un fichier de transition finisse de jouer (29/08, voir performEmbrSwitch) -- distinct de embrPendingSwitchTimeout (quantification), les deux peuvent s'enchaîner
  let currentGainNodes = []; // moteur quantifié : gains de la génération la plus récente, par couche (contrôle d'intensité en direct)
  let schedulerTimer = null;
  let voiceGraphTimeouts = [];
  let nextGenStartCtxTime = 0, nextGenBufferOffset = 0;
  // Historique des générations programmées : { ctxStartTime, bufferOffset }. Sert à retrouver la position
  // RÉELLEMENT audible à un instant donné (voir currentPlaybackOffset ci-dessous) — pas simplement "la dernière
  // programmée", qui à cause du lookahead scheduler (jusqu'à 1s d'avance) peut encore être dans le futur au
  // moment où on la lit, ce qui donnait une tête de lecture visuellement en avance sur le son.
  let scheduledGens = [];
  function currentPlaybackOffset() {
    let chosen = null;
    for (const g of scheduledGens) {
      if (g.ctxStartTime <= ctx.currentTime && (!chosen || g.ctxStartTime > chosen.ctxStartTime)) chosen = g;
    }
    if (!chosen) return 0;
    return Math.min(chosen.bufferOffset + (ctx.currentTime - chosen.ctxStartTime), progressMaxSec());
  }
  // Nombre de boucles (moteur quantifié) : loopsPlayed compte les passages programmés par le scheduler
  // récurrent (pas le tout premier, déclenché directement par playQuantized). Une fois track.maxLoops
  // atteint (si non nul), on arrête de programmer de nouvelles générations et on laisse la dernière
  // en cours filer seule jusqu'à sa fin naturelle (l'outro = la queue déjà présente dans le fichier).
  let loopsPlayed = 0;
  let lastGenSources = [];
  let finalGenerationMarkerSrc = null;

  // Spécifique au mode vertical-random (fusionné avec l'ex-"vertical random séquentiel" le 30/07)
  // sectionBuffers[secIdx][poolIdx] = [buffer, buffer, ...] pour chaque alternative jouable de ce pool,
  // secIdx étant l'index DÉCLARÉ de la section (pas résolu) — une section qui duplique une autre
  // (referencesSectionId) pointe directement vers le MÊME tableau que sa source (pas une copie), exactement
  // comme les groupes/emplacements dupliqués des autres modes. L'anti-répétition par pool se garde donc par
  // identifiant canonique (l'id du pool réellement porteur du contenu), pas par index brut.
  let sectionBuffers = [];
  let lastPickedPoolIndex = {}; // lastPickedPoolIndex[canonicalPoolId] = index de la dernière alternative tirée pour ce pool
  // playableSectionOriginalIndex[i] = index RÉEL dans track.sections pour la i-ème section jouable — le
  // scheduler pur (createSectionPlaybackScheduler) ne connaît que des positions 0..N-1 parmi les sections
  // jouables, il faut donc toujours repasser par cette table pour retrouver la vraie section (et ses
  // buffers déjà chargés) à jouer.
  let playableSectionOriginalIndex = [];
  let sectionScheduler = null; // recréé à chaque vrai démarrage (pas une reprise), voir playVerticalRandom
  function canonicalPoolKey(secIdx, poolIdx) {
    const section = resolveVRSection(track, secIdx);
    const pool = (section && section.pools || [])[poolIdx];
    return (pool && pool.referencesPoolId) || (pool && pool.id) || ('s' + secIdx + 'p' + poolIdx);
  }
  function pickPoolAlternativeIndex(secIdx, poolIdx) {
    const section = resolveVRSection(track, secIdx);
    const pool = (section && section.pools || [])[poolIdx];
    const bufs = (sectionBuffers[secIdx] && sectionBuffers[secIdx][poolIdx]) || [];
    const n = bufs.length;
    if (n === 0) return -1;
    const key = canonicalPoolKey(secIdx, poolIdx);
    let idx = Math.floor(Math.random() * n);
    if (pool && pool.avoidImmediateRepeat && n > 1) {
      while (idx === lastPickedPoolIndex[key]) idx = Math.floor(Math.random() * n);
    }
    lastPickedPoolIndex[key] = idx;
    return idx;
  }
  // Minutage d'une section résolue (bpm/mesures/timeline propres à CETTE section — plus un tempo unique
  // partagé par tout le morceau, voir décision du 30/07). Calculé à la demande plutôt que figé une fois,
  // puisque la section "courante" change au fil de la lecture.
  function sectionTiming(section) {
    const spb = 60 / (section.bpm || 120);
    const loopInSec = (section.loopInBeat || 0) * spb;
    const loopOutSec = Math.max(loopInSec + spb, (section.loopOutBeat || (section.beatsPerBar || 4) * 4) * spb);
    const startTrackSec = Math.min((section.startTrackBeat || 0) * spb, loopInSec);
    return { loopInSec, loopOutSec, cycleLength: loopOutSec - loopInSec, startTrackSec };
  }

  // Buffers des Sfx attachés : un tableau de buffers (une entrée par variation round robin) par Sfx,
  // indexé par son id — remplace l'ancien tableau plat "un buffer par stinger".
  let sfxBuffersById = {};
  let sfxLastIndexById = {}; // dernier index tiré par Sfx (anti-répétition aléatoire / avance séquentielle)
  let activeStingerSources = [];

  // introBuffer/outroBuffer : partagés entre séquentiel et vertical-random (même forme de champs, fusion
  // du 30/07) — jamais utilisés par les deux modes à la fois, un morceau n'ayant qu'un seul mode.
  let introBuffer = null, outroBuffer = null;
  // slotBuffers[s] = [buffer, buffer, ...] pour chaque alternative jouable de l'emplacement s — même
  // principe que sectionBuffers du vertical-random (y compris la duplication/référence pour économiser la
  // mémoire, voir canonicalPoolKey plus bas), mais ici l'ORDRE des emplacements compte en plus : ils
  // s'enchaînent dans l'ordre défini par le compositeur (contrairement aux pools d'une même section, qui
  // jouent tous simultanément et n'ont pas de notion d'ordre entre eux).
  let slotBuffers = [];
  // transitionBuffers[s][o] = buffer du fichier de transition déclaré pour le o-ième embranchement sortant
  // de l'emplacement s (nextOptions[o].transition), ou null si aucun n'est défini pour cette paire précise
  // — chaque embranchement a le sien, contrairement à slotBuffers qui est par emplacement (voir schéma
  // "Embranchement séquentiel avec transitions" validé le 02/08).
  let transitionBuffers = [];
  let lastPickedSlotAltIndex = {}; // lastPickedSlotAltIndex[canonicalSlotId] = index de la dernière alternative tirée pour ce pool — partagé entre tous les emplacements qui dupliquent le même pool (ex. structure AABA : les deux "A" évitent la même dernière alternative jouée)
  let currentSlotIndex = 0; // position dans le cycle d'emplacements ; boucle sur elle-même (0,1,...,N-1,0,1,...)
  let currentSlotRepeatsPlayed = 0; // combien de fois l'emplacement courant a déjà rejoué depuis qu'on y est arrivé, pour respecter repeatCount avant de passer au suivant
  // Embranchement séquentiel (optionnel, par emplacement — voir schéma `nextOptions` validé le 31/07,
  // étendu le 02/08 avec `quantization`/`cutStyle`/`transition` par embranchement) : id de l'emplacement
  // choisi par le visiteur, en attente d'être consommé par performSeqBranchCut(). Un nouveau clic écrase
  // la valeur précédente (dernier clic gagne) ; remis à null une fois consommé.
  let pendingNextSegmentId = null;
  // Carte globale des chemins (02/09) : historique des emplacements déjà devenus audibles depuis le
  // (re)démarrage -- rien de tel n'existait avant ce chantier (aucun état de ce genre à réutiliser), voir
  // activateSeqStage() pour l'alimentation. seqMapFullReveal (posé par buildPreviewTrack() côté Backstage
  // uniquement) affiche la carte en entier dès le chargement -- outil de vérification de sa propre
  // structure pendant qu'on la construit ; côté public, révélation progressive comme demandé.
  let seqVisitedSlotIds = new Set();
  const seqMapFullReveal = !!track.seqMapFullReveal;
  let chainState = { cyclesCompleted: 0, capReached: false }; // compteur de cycles complets pour maxChainLoops — voir advanceChainIndex(), remis à zéro à chaque vrai redémarrage (pas une reprise)
  let seqSchedulerTimer = null;
  let seqNextStartCtxTime = 0;
  let seqActiveSources = []; // {src, gain} toutes générations confondues (dont queues en train de finir)
  let seqLastGenSources = [];
  let seqFinalMarkerSrc = null;
  let seqTimeouts = [];
  let goToEndRequested = false;
  // ---- État pour la coupure fine des embranchements séquentiels (voir schéma "quantization"/"cutStyle"/
  // "transition" validé le 02/08) — voir armNextSeqBranchBoundary()/performSeqBranchCut() plus bas. ----
  let forcedNextBlock = null; // bloc à jouer en priorité au prochain decideNextSeqBlock() (la transition injectée par une coupure), consommé et vidé aussitôt lu
  let seqBranchEpoch = 0; // incrémenté à chaque nouveau passage sur un emplacement et à chaque coupure — invalide les chaînes de vérification de frontière héritées d'un passage précédent (voir armNextSeqBranchBoundary)
  // Tempo effectif d'un emplacement séquentiel — même principe que sectionTiming() pour le vertical-random
  // (une seule formule de repli, réutilisée partout plutôt que dupliquée) : slot.bpm/beatsPerBar si réglés
  // sur CET emplacement, sinon le tempo du morceau.
  function slotTiming(slot) {
    return { secondsPerBeat: 60 / ((slot && slot.bpm) || bpm), beatsPerBar: (slot && slot.beatsPerBar) || beatsPerBar };
  }
  function blockSeconds(bars, slot) {
    // slot fourni ET porteur d'un tempo propre (bpm ou beatsPerBar) : grille de CET emplacement.
    // Sinon (pas de slot, ou slot sans réglage propre) : grille du morceau, comportement historique
    // inchangé — même chaîne de repli que le moteur quantifié classique (track.bpm || 120).
    if (slot && (slot.bpm || slot.beatsPerBar)) {
      const timing = slotTiming(slot);
      return (bars || timing.beatsPerBar) * timing.beatsPerBar * timing.secondsPerBeat;
    }
    return (bars || beatsPerBar) * beatsPerBar * secondsPerBeat;
  }
  // Tempo effectif d'un fichier de transition (nextOptions[].transition) — même principe de repli que
  // slotTiming(), mais à un niveau de plus : tempo propre à la transition si réglé, sinon celui de
  // l'emplacement source qu'on quitte, sinon celui du morceau. Distinct de slotTiming() car une transition
  // peut délibérément changer de tempo par rapport à l'emplacement qu'elle quitte (impact, riser...), alors
  // qu'un emplacement hérite normalement du morceau.
  function transitionTiming(tr, sourceSlot) {
    return {
      secondsPerBeat: 60 / ((tr && tr.bpm) || (sourceSlot && sourceSlot.bpm) || bpm),
      beatsPerBar: (tr && tr.beatsPerBar) || (sourceSlot && sourceSlot.beatsPerBar) || beatsPerBar
    };
  }
  // Durée nominale d'un fichier de transition avant que le crossfade-tail classique vers la cible ne prenne
  // le relais (voir schéma "durationUnit" validé le 14/08, complété le 29/08 avec l'unité "temps"). Quatre
  // cas :
  // - `durationUnit` absent (transitions déjà publiées avant ce chantier) : comportement historique
  //   strictement inchangé, blockSeconds() sur le tempo de l'emplacement source — rétrocompatibilité totale.
  // - `durationUnit: 'bars'` : mesures sur le tempo PROPRE de la transition (transitionTiming), pas
  //   forcément celui de l'emplacement source.
  // - `durationUnit: 'beats'` (29/08) : temps individuels sur ce même tempo propre -- pour un réglage plus
  //   fin qu'une mesure entière (ex. un stinger d'1.5 temps). Même `transitionTiming()` que 'bars', sans la
  //   multiplication par beatsPerBar puisqu'on compte déjà des temps, pas des mesures.
  // - `durationUnit: 'seconds'` : durée brute en secondes, aucune notion de tempo.
  function transitionDurationSecFor(opt, sourceSlot) {
    const tr = opt && opt.transition;
    if (!tr) return null;
    if (tr.durationUnit === 'seconds') return tr.durationSeconds != null ? tr.durationSeconds : 0;
    if (tr.durationUnit === 'beats') {
      const timing = transitionTiming(tr, sourceSlot);
      return (tr.durationBeats || 1) * timing.secondsPerBeat;
    }
    if (tr.durationUnit === 'bars') {
      const timing = transitionTiming(tr, sourceSlot);
      return (tr.bars || timing.beatsPerBar) * timing.beatsPerBar * timing.secondsPerBeat;
    }
    return blockSeconds(tr.bars, sourceSlot);
  }
  function canonicalSlotKey(s) {
    const slot = (track.segmentSlots || [])[s];
    return (slot && slot.referencesSlotId) || (slot && slot.id) || ('s' + s);
  }
  // Pour un emplacement qui duplique un autre, ses propres "alternatives" sont vides (le contenu vit chez
  // la source) — on va chercher le bon libellé là où sont réellement les fichiers, plutôt que d'afficher
  // seulement le nom générique de l'emplacement.
  function resolveSlotAlternative(slotIdx, altIdx) {
    const slot = (track.segmentSlots || [])[slotIdx];
    if (!slot) return null;
    if (slot.referencesSlotId) {
      const source = (track.segmentSlots || []).find(sl => sl.id === slot.referencesSlotId);
      return (source && source.alternatives || [])[altIdx] || null;
    }
    return (slot.alternatives || [])[altIdx] || null;
  }
  function pickSlotAlternativeIndex(slotIdx) {
    const bufs = slotBuffers[slotIdx] || [];
    const n = bufs.length;
    if (n === 0) return -1;
    // L'anti-répétition (case à cocher) est réglée sur l'emplacement "porteur" du contenu quand celui-ci
    // est dupliqué ailleurs — dupliquer un pool n'a pas sa propre notion d'anti-répétition indépendante,
    // puisque le pool (et son historique de tirage) est justement partagé.
    const key = canonicalSlotKey(slotIdx);
    const sourceSlot = (track.segmentSlots || []).find(sl => sl.id === key) || (track.segmentSlots || [])[slotIdx];
    let idx = Math.floor(Math.random() * n);
    if (sourceSlot && sourceSlot.avoidImmediateRepeat && n > 1) {
      while (idx === lastPickedSlotAltIndex[key]) idx = Math.floor(Math.random() * n);
    }
    lastPickedSlotAltIndex[key] = idx;
    return idx;
  }
  // Prochain emplacement jouable dans le cycle, en partant de la position courante — saute silencieusement
  // les emplacements sans aucune alternative chargée (ex. tous les fichiers manquants) plutôt que de casser
  // la chaîne. Reste sur le même emplacement jusqu'à épuiser son repeatCount (nombre de répétitions avant
  // de passer au suivant) avant d'avancer dans la chaîne. Renvoie null s'il n'y a strictement aucun
  // emplacement jouable.
  function pickNextSegmentSlot() {
    const slots = track.segmentSlots || [];
    if (!slots.length) return null;
    for (let i = 0; i < slots.length; i++) {
      const slotIdx = currentSlotIndex;
      const altIdx = pickSlotAlternativeIndex(slotIdx);
      if (altIdx < 0) {
        // emplacement totalement vide : on l'ignore, on passe au suivant sans consommer de répétition
        currentSlotIndex = advanceChainIndex(currentSlotIndex, slots.length, chainState, track.maxChainLoops);
        currentSlotRepeatsPlayed = 0;
        continue;
      }
      // Un emplacement à embranchements ne quitte JAMAIS sa position tout seul, quel que soit repeatCount
      // (qui n'a plus de sens ici) — l'avancement automatique n'a plus lieu d'être dès lors que le visiteur
      // peut cliquer pour choisir (validé le 02/08). Seule une coupure fine (performSeqBranchCut(), voir
      // plus bas) peut faire avancer currentSlotIndex pour un tel emplacement.
      if (slots[slotIdx].nextOptions && slots[slotIdx].nextOptions.length) {
        return { slotIdx, altIdx };
      }
      currentSlotRepeatsPlayed++;
      const repeatCount = Math.max(1, slots[slotIdx].repeatCount || 1);
      if (currentSlotRepeatsPlayed >= repeatCount) {
        currentSlotIndex = advanceChainIndex(currentSlotIndex, slots.length, chainState, track.maxChainLoops);
        currentSlotRepeatsPlayed = 0;
      }
      // Un cycle complet de la chaîne vient d'atteindre la limite maxChainLoops (toutes deux causes
      // d'avancement ci-dessus y mènent pareil) : même mécanisme que "Aller vers la fin" manuel, pris en
      // compte au prochain decideNextSeqBlock() — l'emplacement en cours de programmation ici va tout de
      // même jusqu'à son terme, seul ce qui vient après bascule vers l'outro (ou la fin naturelle).
      if (chainState.capReached) { chainState.capReached = false; goToEndRequested = true; }
      return { slotIdx, altIdx };
    }
    return null; // aucun emplacement n'a la moindre alternative chargée
  }
  // Visualisation en blocs (intro / segment en cours / outro), qui se remplissent au rythme de la lecture —
  // demande directe d'un retour compositeur : "montrer un bloc pour le cue de départ qui se remplit en jouant,
  // puis un bloc pour la boucle tirée au sort, puis un bloc pour le cue de fin".
  const seqBlockEls = {
    intro: wrapper.querySelector('[data-role="seqBlock-intro"]'),
    segment: wrapper.querySelector('[data-role="seqBlock-segment"]'),
    outro: wrapper.querySelector('[data-role="seqBlock-outro"]')
  };
  // Chaque bloc affiche la vraie waveform du fichier qui y joue (pas un simple aplat de couleur) — pour
  // l'intro/l'outro le buffer est fixe, pour "segment" il change à chaque tirage et est donc recalculé
  // à chaque nouvelle activation. Même principe fond/avant-plan que la waveform du mode statique.
  const seqWaveEls = {
    intro: { bg: wrapper.querySelector('[data-role="seqWaveBg-intro"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-intro"]') },
    segment: { bg: wrapper.querySelector('[data-role="seqWaveBg-segment"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-segment"]') },
    outro: { bg: wrapper.querySelector('[data-role="seqWaveBg-outro"]'), fg: wrapper.querySelector('[data-role="seqWaveFg-outro"]') }
  };
  // Contrairement au mode statique et vertical-random, ce bloc n'avait jusqu'ici AUCUN redessin au
  // redimensionnement — le canevas restait figé à la taille capturée lors de son tout premier dessin
  // (ex. juste avant qu'une transition de layout ne se termine), d'où une forme d'onde qui semblait
  // "correcte sur une partie, plate ensuite" alors que le son continuait bel et bien. Même principe que
  // waveformBg/waveformFg (mode statique) et voiceWave* (vertical-random) : on retient le dernier buffer
  // dessiné par bloc (+ sa durée de rognage éventuelle) et on redessine dès que le conteneur change de taille.
  const seqLastBuffers = { intro: null, segment: null, outro: null };
  const seqLastCropSec = { intro: null, segment: null, outro: null };
  const seqBlocksContainer = wrapper.querySelector('.seq-blocks');
  if (seqBlocksContainer && window.ResizeObserver) {
    new ResizeObserver(() => {
      Object.keys(seqLastBuffers).forEach(k => { if (seqLastBuffers[k]) drawSeqBlockWave(k, seqLastBuffers[k], seqLastCropSec[k]); });
    }).observe(seqBlocksContainer);
  }
  // maxDurationSec (optionnel) : pour Intro/Segment, dont le fichier réel déborde volontairement au-delà
  // de sa durée musicale nominale (queue de recouvrement crossfade), n'affiche que la portion nominale —
  // la queue technique ne fait pas partie de "la" forme d'onde du bloc du point de vue du visiteur.
  // Pour l'Outro (pas de notion de durée nominale, fin ouverte), ce paramètre vaut simplement la durée
  // réelle du fichier : aucun rognage effectif, comportement inchangé.
  function drawSeqBlockWave(kind, buffer, maxDurationSec) {
    seqLastBuffers[kind] = buffer || seqLastBuffers[kind]; // conservé pour le redessin au resize (voir plus bas)
    seqLastCropSec[kind] = (maxDurationSec != null) ? maxDurationSec : seqLastCropSec[kind];
    const els = seqWaveEls[kind];
    if (!els || !els.bg || !els.fg || !buffer) return;
    renderWaveformPair(els.bg, els.fg, buffer, cssVar('--border', '#ccc'), cssVar('--accent', '#c9713c'), seqLastCropSec[kind]);
  }
  // État du bloc actuellement en cours de lecture, retenu pour permettre le seek (glisser sur sa waveform) :
  // sans ça, impossible de savoir quel buffer/gain relancer, ni à quelle position on se trouve réellement
  // dedans (le curseur visuel seul ne suffit pas — il faut aussi la référence temporelle audio exacte).
  let currentSeqBlockInfo = null; // { kind, buffer, gain, totalSec, virtualZero, terminal, slotIdx }
  function activateSeqStage(kind, remainingSec, totalSec, buffer, gainValue, terminal, slotIdx, gainNode) {
    const order = ['intro', 'segment', 'outro'];
    const idx = order.indexOf(kind);
    // Tout ce qui précède ce stade (hors "segment", qui se remplit à nouveau à chaque tirage plutôt que
    // de passer "fait") est figé plein — reflète la lecture qui vient réellement de passer ce point.
    order.forEach((k, i) => {
      if (i >= idx || k === 'segment') return;
      const block = seqBlockEls[k], els = seqWaveEls[k];
      if (!block) return;
      block.classList.remove('active'); block.classList.add('done');
      if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 0% 0 0)'; }
    });
    const block = seqBlockEls[kind], els = seqWaveEls[kind];
    const startFraction = totalSec > 0 ? Math.max(0, Math.min(1, 1 - (remainingSec / totalSec))) : 0;
    currentSeqBlockInfo = { kind, buffer, gain: gainValue, gainNode: gainNode || null, totalSec, virtualZero: ctx.currentTime - (startFraction * totalSec), terminal: !!terminal, slotIdx: (slotIdx != null ? slotIdx : -1) };
    // Boutons d'embranchement : uniquement pertinents pendant un "segment" (l'intro/l'outro n'ont pas de
    // nextOptions dans le schéma) — masqués/vidés sinon, reconstruits pour l'emplacement qui vient de
    // devenir audible.
    renderSeqBranchOptions(kind === 'segment' && slotIdx != null ? slotIdx : -1);
    // Carte globale (02/09) : un emplacement rejoint l'historique dès qu'il devient audible -- alimente
    // seqVisitedSlotIds (rien de tel n'existait avant ce chantier). Pas de forme d'onde/progression sur le
    // nœud lui-même (retiré le 03/09, voir updateSeqMap()) -- juste rafraîchir quel nœud porte "current".
    if (kind === 'segment' && slotIdx != null && slotIdx >= 0) {
      seqVisitedSlotIds.add(slotIdx);
      updateSeqMap(slotIdx);
    }
    // Chaque nouveau passage sur UN emplacement (y compris une simple répétition du même) a ses propres
    // frontières de temps/mesure à surveiller — l'epoch invalide toute chaîne héritée d'un passage
    // précédent (voir armNextSeqBranchBoundary), pour ne jamais laisser deux chaînes tourner en parallèle.
    if (kind === 'segment' && slotIdx != null && slotIdx >= 0) {
      seqBranchEpoch++;
      const slot = (track.segmentSlots || [])[slotIdx];
      // "immediate" n'a pas besoin de surveillance de frontière : géré directement au clic (voir
      // renderSeqBranchOptions). Seuls "beat"/"bar" ont une frontière à attendre.
      if (slot && slot.nextOptions && slot.nextOptions.length && (slot.quantization || 'bar') !== 'immediate') {
        armNextSeqBranchBoundary(seqBranchEpoch);
      }
    }
    if (block) {
      block.classList.remove('done'); block.classList.add('active');
      if (buffer) drawSeqBlockWave(kind, buffer, totalSec);
      if (els && els.fg) {
        els.fg.style.transition = 'none'; els.fg.style.clipPath = `inset(0 ${(1 - startFraction) * 100}% 0 0)`;
        void els.fg.offsetWidth; // force le reflow avant de relancer la transition, sinon le navigateur la fusionne avec le reset ci-dessus
        if (remainingSec > 0) { els.fg.style.transition = `clip-path ${remainingSec}s linear`; els.fg.style.clipPath = 'inset(0 0% 0 0)'; }
      }
    }
    // Le passage à l'outro clôt définitivement le stade "segment" (plus de nouveau tirage à suivre).
    if (kind === 'outro' && seqBlockEls.segment && seqWaveEls.segment.fg) {
      seqBlockEls.segment.classList.remove('active'); seqBlockEls.segment.classList.add('done');
      seqWaveEls.segment.fg.style.transition = 'none'; seqWaveEls.segment.fg.style.clipPath = 'inset(0 0% 0 0)';
    }
  }
  function resetSeqStages() {
    currentSeqBlockInfo = null;
    Object.keys(seqBlockEls).forEach(k => {
      const block = seqBlockEls[k], els = seqWaveEls[k];
      if (block) block.classList.remove('active', 'done');
      if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 100% 0 0)'; }
    });
  }
  // Boutons d'embranchement séquentiel (optionnel, voir `nextOptions` sur segmentSlots) : reconstruits à
  // chaque fois que l'emplacement audible change, puisque les cibles disponibles dépendent de CET
  // emplacement précis. slotIdx === -1 (intro/outro/arrêt) : rien à montrer, panneau vidé.
  function renderSeqBranchOptions(slotIdx) {
    if (!seqBranchOptionsEl) return;
    const slot = slotIdx >= 0 ? (track.segmentSlots || [])[slotIdx] : null;
    const options = (slot && slot.nextOptions) || [];
    if (!options.length) {
      seqBranchOptionsEl.innerHTML = '';
      if (seqPendingIndicatorEl) seqPendingIndicatorEl.style.display = 'none';
      return;
    }
    seqBranchOptionsEl.innerHTML = options.map((opt, oi) => {
      const targetIdx = (track.segmentSlots || []).findIndex(sl => sl.id === opt.targetId);
      const targetSlot = targetIdx >= 0 ? track.segmentSlots[targetIdx] : null;
      // Repli aligné sur celui déjà utilisé côté éditeur (libraryRender.js, menu de cible) : "Emplacement N"
      // plutôt que l'id technique brut (genId(), ex. "b1a2b3c4d5e") quand ni l'embranchement ni l'emplacement
      // cible n'ont de nom — l'id brut ne reste un ultime recours que pour une cible orpheline (emplacement
      // supprimé depuis), cas déjà géré sans casse ailleurs (performSeqBranchCut sort silencieusement).
      const label = opt.label || (targetSlot && targetSlot.label) || (targetSlot ? t('slotFallback', { n: targetIdx + 1 }) : opt.targetId);
      const isPending = pendingNextSegmentId === opt.targetId;
      // Zoom local (02/09, forme d'onde retirée le même jour sur retour direct de Jules-Antoine en
      // situation réelle -- gardée uniquement sur la carte globale, pas sur ces boutons) : badge si un
      // fichier de transition existe pour CETTE paire précise. transitionBuffers déjà décodé au
      // chargement (voir plus bas dans ce fichier) -- rien à décoder ici, juste à lire l'état existant.
      const hasTransition = !!(transitionBuffers[slotIdx] && transitionBuffers[slotIdx][oi]);
      const badge = hasTransition ? `<span class="seq-branch-transition-badge" title="${escapeHtml(t('branchTransitionBadgeTitle'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 L4 14 h6 l-1 8 9-12 h-6 z"/></svg></span>` : '';
      return `<button type="button" class="seq-branch-btn${isPending ? ' pending' : ''}" data-target-id="${escapeHtml(opt.targetId)}" data-opt-idx="${oi}">${escapeHtml(label)}${badge}</button>`;
    }).join('');
    updateSeqPendingIndicator();
    seqBranchOptionsEl.querySelectorAll('.seq-branch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Dernier clic gagne (validé le 31/07) : un second clic sur une autre option remplace simplement
        // le choix précédent, il n'y a jamais de verrou sur le premier clic.
        pendingNextSegmentId = btn.dataset.targetId;
        seqBranchOptionsEl.querySelectorAll('.seq-branch-btn').forEach(b => b.classList.toggle('pending', b === btn));
        updateSeqPendingIndicator();
        trackPublicEvent('seq_branch_select', { trackId: track.id, targetId: pendingNextSegmentId });
        // "immediate" (validé le 02/08) : pas de frontière à attendre, la coupure se déclenche directement
        // au clic — pour "beat"/"bar", c'est armNextSeqBranchBoundary (armée dès le début de CET emplacement
        // dans activateSeqStage) qui surveille déjà la prochaine frontière et lira ce choix à son tour.
        if (slot && (slot.quantization || 'bar') === 'immediate') performSeqBranchCut();
      });
    });
  }
  function updateSeqPendingIndicator() {
    if (!seqPendingIndicatorEl) return;
    seqPendingIndicatorEl.style.display = pendingNextSegmentId ? '' : 'none';
  }
  // ---- Carte globale des chemins (02/09, réécrite le même jour après un premier passage en grille en
  // flux -- voir CHANGELOG "reprise en flowchart" pour le contexte) : disposition en couches façon
  // flowchart, colonnes = distance (en arêtes AVANT) depuis le premier emplacement découvert, lignes =
  // ordre de première découverte au sein d'une colonne. Positions calculées entièrement en JS (pas de
  // mesure getBoundingClientRect comme drawWwiseLines()) -- un vrai graphe avec boucles a besoin de
  // connaître la colonne de la cible AVANT de choisir comment tracer l'arête (tout droit si elle avance,
  // en boucle si elle revient en arrière), ce que la seule position DOM ne donne pas. Dégradation (nombre
  // de nœuds simultanément visibles) : seuils repris de la même logique que le vertical à embranchement
  // (voir CHANGELOG pour le raisonnement détaillé des valeurs choisies) -- au-delà du plancher, repli sur
  // une simple liste de puces en flux, sans position ni arêtes (même principe que le repli compact déjà
  // utilisé côté embr-vertical). ----
  const SEQ_MAP_FULL_SIZE_MAX = 6, SEQ_MAP_DEGRADE_MAX = 14;
  const SEQ_MAP_COL_GAP = 40, SEQ_MAP_ROW_GAP = 16;
  // Boucles de retour (03/09, retour direct "elles sont tracées un peu aléatoirement") : marge sous TOUTE
  // la grille avant la première boucle, puis un écart entre boucles successives -- voir seqMapDrawEdges.
  const SEQ_MAP_LOOP_MARGIN = 22, SEQ_MAP_LOOP_STAGGER = 18;
  // Ensemble des index d'emplacements à révéler pour l'état courant -- toujours tout en mode
  // seqMapFullReveal (Backstage), sinon déjà-visités + courant + options immédiates depuis le courant
  // (effet de découverte demandé le 1er septembre).
  function seqMapVisibleSlotIndices(currentIdx) {
    const slots = track.segmentSlots || [];
    if (seqMapFullReveal) return slots.map((s, i) => i);
    const visible = new Set(seqVisitedSlotIds);
    if (currentIdx >= 0) {
      visible.add(currentIdx);
      const cur = slots[currentIdx];
      ((cur && cur.nextOptions) || []).forEach(opt => {
        const ti = slots.findIndex(sl => sl.id === opt.targetId);
        if (ti >= 0) visible.add(ti);
      });
    }
    return [...visible];
  }
  // Cibles "en avant" d'un emplacement, restreintes aux emplacements révélés -- embranchement déclaré
  // (nextOptions) ou, à défaut, avancement automatique vers le suivant dans l'ordre du tableau (même
  // approximation volontaire que dans la première version : ne rejoue pas la logique de saut des
  // emplacements vides de pickNextSegmentSlot(), suffisante pour un aperçu topologique).
  function seqMapForwardTargets(idx, revealedSet) {
    const slots = track.segmentSlots || [];
    const slot = slots[idx];
    if (!slot) return [];
    const opts = slot.nextOptions || [];
    if (opts.length) return opts.map(o => slots.findIndex(sl => sl.id === o.targetId)).filter(ti => ti >= 0 && revealedSet.has(ti));
    const nextIdx = (idx + 1) % slots.length;
    return (nextIdx !== idx && revealedSet.has(nextIdx)) ? [nextIdx] : [];
  }
  // Colonne = distance en arêtes AVANT depuis la racine (le premier emplacement découvert encore révélé,
  // ou l'emplacement 0 si rien n'a encore été découvert -- cas Backstage avant toute lecture), par simple
  // parcours en largeur sur le sous-graphe des emplacements révélés. Une arête vers un emplacement déjà
  // affecté à une colonne (boucle/retour) n'avance jamais sa colonne -- c'est justement ce qui la
  // distingue d'une avancée (voir seqMapDrawEdges, tracé en boucle plutôt qu'en ligne droite pour ces
  // arêtes-là). Ligne = position dans sa colonne, dans l'ordre de première découverte
  // (seqVisitedSlotIds étant un Set, son ordre d'itération EST l'ordre d'insertion -- aucun état
  // supplémentaire à tenir pour ça).
  function seqMapComputeLayout(visibleIdx, currentIdx) {
    const revealedSet = new Set(visibleIdx);
    const visitedOrder = [...seqVisitedSlotIds];
    const startIdx = visitedOrder.find(i => revealedSet.has(i));
    const root = startIdx != null ? startIdx : visibleIdx[0];
    const col = {};
    if (root != null) {
      col[root] = 0;
      const queue = [root];
      while (queue.length) {
        const idx = queue.shift();
        seqMapForwardTargets(idx, revealedSet).forEach(ti => {
          if (col[ti] == null) { col[ti] = col[idx] + 1; queue.push(ti); }
        });
      }
    }
    // Emplacement révélé mais jamais atteint par le parcours (composante détachée de la racine -- ne
    // devrait pas arriver en pratique étant donné comment revealedSet est construit, mais ne doit jamais
    // faire planter le rendu) : colonne 0 par défaut plutôt qu'un index manquant.
    visibleIdx.forEach(idx => { if (col[idx] == null) col[idx] = 0; });
    const orderOf = idx => { const p = visitedOrder.indexOf(idx); return p === -1 ? Infinity : p; };
    const byCol = {};
    visibleIdx.slice().sort((a, b) => orderOf(a) - orderOf(b) || a - b).forEach(idx => {
      (byCol[col[idx]] = byCol[col[idx]] || []).push(idx);
    });
    const row = {};
    Object.keys(byCol).forEach(c => byCol[c].forEach((idx, i) => { row[idx] = i; }));
    const maxCol = Math.max(0, ...visibleIdx.map(idx => col[idx]));
    const maxRows = Math.max(1, ...Object.values(byCol).map(arr => arr.length));
    return { col, row, maxCol, maxRows };
  }
  function updateSeqMap(currentIdx) {
    if (!seqMapNodesEl || !seqMapCanvasEl) return;
    const slots = track.segmentSlots || [];
    const visibleIdx = seqMapVisibleSlotIndices(currentIdx);
    if (!visibleIdx.length) {
      seqMapNodesEl.innerHTML = ''; if (seqMapLinesEl) seqMapLinesEl.innerHTML = '';
      seqMapCanvasEl.style.width = ''; seqMapCanvasEl.style.height = '';
      return;
    }
    const n = visibleIdx.length;
    const compact = n > SEQ_MAP_DEGRADE_MAX;
    seqMapNodesEl.classList.toggle('compact', compact);
    if (compact) {
      // Repli : simple liste de puces en flux, aucune position ni arête -- même esprit que le repli
      // compact déjà utilisé côté embr-vertical (au-delà du plancher, la topologie exacte importe moins
      // que rester lisible d'un coup d'œil).
      seqMapCanvasEl.style.width = ''; seqMapCanvasEl.style.height = '';
      if (seqMapLinesEl) seqMapLinesEl.innerHTML = '';
      seqMapNodesEl.innerHTML = visibleIdx.map(idx => {
        const slot = slots[idx] || {};
        const isCurrent = idx === currentIdx;
        const isVisited = seqVisitedSlotIds.has(idx) && !isCurrent;
        const label = slot.label || t('slotFallback', { n: idx + 1 });
        const cls = 'seq-map-node' + (isCurrent ? ' current' : '') + (isVisited ? ' visited' : '');
        const check = isVisited ? '<span class="seq-map-node-check">✓</span>' : '';
        return `<div class="${cls}" data-slot-idx="${idx}"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
      }).join('');
      return;
    }
    const span = SEQ_MAP_DEGRADE_MAX - SEQ_MAP_FULL_SIZE_MAX;
    const over = Math.max(0, Math.min(n, SEQ_MAP_DEGRADE_MAX) - SEQ_MAP_FULL_SIZE_MAX);
    const w = Math.round(96 - over * (36 / span));
    const h = Math.round(40 - over * (12 / span));
    seqMapNodesEl.style.setProperty('--seq-map-node-w', w + 'px');
    seqMapNodesEl.style.setProperty('--seq-map-node-h', h + 'px');
    const layout = seqMapComputeLayout(visibleIdx, currentIdx);
    const colW = w + SEQ_MAP_COL_GAP, rowH = h + SEQ_MAP_ROW_GAP;
    const totalW = (layout.maxCol + 1) * colW - SEQ_MAP_COL_GAP;
    // Marge verticale supplémentaire si des arêtes de retour existent -- chacune plonge volontairement
    // sous TOUTE la grille (voir seqMapDrawEdges), une par une, en s'étalant verticalement pour rester
    // distinctes. Sans cette marge elles seraient coupées par overflow-y:hidden sur .seq-map-graph (bug
    // trouvé en vérification visuelle réelle : la boucle existait bien dans le SVG mais restait invisible,
    // coupée sous le bord de la carte).
    const backEdgeCount = visibleIdx.reduce((n, idx) => n + seqMapForwardTargets(idx, new Set(visibleIdx)).filter(ti => layout.col[ti] <= layout.col[idx]).length, 0);
    const totalH = layout.maxRows * rowH - SEQ_MAP_ROW_GAP + (backEdgeCount > 0 ? SEQ_MAP_LOOP_MARGIN + (backEdgeCount - 1) * SEQ_MAP_LOOP_STAGGER + Math.round(h / 2) + 6 : 0);
    // Taille explicite sur le conteneur défilable (pas sur .seq-map-graph, qui reste la fenêtre visible) --
    // permet un défilement horizontal si le graphe est plus large que la carte, plutôt que l'effondrement
    // en une seule colonne trouvé en situation réelle avec la première version (nœuds superposés, arêtes
    // invisibles derrière eux, voir CHANGELOG).
    seqMapCanvasEl.style.width = totalW + 'px';
    seqMapCanvasEl.style.height = totalH + 'px';
    // Pas de forme d'onde sur les nœuds (retiré le 03/09 sur retour direct de Jules-Antoine en situation
    // réelle -- en plus de ne pas être demandée ici, elle ne reflétait pas fidèlement le fichier : Corridor
    // et Battle s'arrêtaient visiblement à mi-chemin). L'état (courant/visité/pas encore atteint) se lit
    // uniquement via la bordure (voir CSS .seq-map-node.current/.visited) -- aucune donnée audio à charger
    // ni dessiner ici, juste le libellé.
    seqMapNodesEl.innerHTML = visibleIdx.map(idx => {
      const slot = slots[idx] || {};
      const isCurrent = idx === currentIdx;
      const isVisited = seqVisitedSlotIds.has(idx) && !isCurrent;
      const label = slot.label || t('slotFallback', { n: idx + 1 });
      const cls = 'seq-map-node' + (isCurrent ? ' current' : '') + (isVisited ? ' visited' : '');
      const check = isVisited ? '<span class="seq-map-node-check">✓</span>' : '';
      const x = layout.col[idx] * colW, y = layout.row[idx] * rowH;
      return `<div class="${cls}" data-slot-idx="${idx}" style="left:${x}px;top:${y}px"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
    }).join('');
    seqMapDrawEdges(layout, visibleIdx, colW, rowH, w, h, totalW, totalH);
  }
  // Arêtes SVG entre nœuds révélés, positions calculées directement depuis `layout` (pas de mesure DOM).
  // Arête "en avant" (colonne cible > colonne source) : courbe en S classique entre le bord droit de la
  // source et le bord gauche de la cible. Arête "en arrière ou même colonne" (boucle/retour, colonne
  // cible <= colonne source) : réécrite deux fois le 03/09 sur retours directs -- d'abord une courbe (l'
  // ancienne version sortait par la droite avec un décalage fixe, forme différente selon la distance,
  // "tracées un peu aléatoirement"), puis un tracé ORTHOGONAL (droites + angles droits, "plus clair
  // notamment dans les systèmes complexes") : descend tout droit depuis le BAS de la source, traverse à
  // l'horizontale sous TOUTE la grille (pas juste sous la ligne des deux nœuds concernés -- ne risque donc
  // jamais de croiser un nœud intermédiaire), remonte tout droit dans le BAS de la cible. Même tracé
  // prévisible quelle que soit la distance entre les deux nœuds. totalW/totalH reçus tels quels depuis updateSeqMap() (pas recalculés ici) pour que
  // le viewBox du SVG corresponde exactement à .seq-map-canvas, marge des boucles de retour comprise --
  // sinon une boucle qui dépasse la dernière ligne de nœuds serait coupée par overflow-y:hidden (bug
  // trouvé en vérification visuelle réelle).
  function seqMapDrawEdges(layout, visibleIdx, colW, rowH, nodeW, nodeH, totalW, totalH) {
    if (!seqMapLinesEl) return;
    const slots = track.segmentSlots || [];
    seqMapLinesEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    seqMapLinesEl.setAttribute('width', totalW);
    seqMapLinesEl.setAttribute('height', totalH);
    seqMapLinesEl.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const rightOf = idx => ({ x: layout.col[idx] * colW + nodeW, y: layout.row[idx] * rowH + nodeH / 2 });
    const leftOf = idx => ({ x: layout.col[idx] * colW, y: layout.row[idx] * rowH + nodeH / 2 });
    const bottomOf = idx => ({ x: layout.col[idx] * colW + nodeW / 2, y: layout.row[idx] * rowH + nodeH });
    const visibleSet = new Set(visibleIdx);
    const gridBottom = layout.maxRows * rowH - SEQ_MAP_ROW_GAP;
    // Étale chaque boucle de retour un peu plus bas que la précédente (backEdgeIndex incrémenté à chaque
    // arête en arrière rencontrée) -- sans ça, deux boucles de retour finissaient à la même hauteur et se
    // confondaient visuellement. updateSeqMap() réserve la marge verticale correspondante dans totalH,
    // avec les mêmes constantes (SEQ_MAP_LOOP_MARGIN/SEQ_MAP_LOOP_STAGGER).
    let backEdgeIndex = 0;
    const drawEdge = (fromIdx, toIdx, cls, label, hasTransition) => {
      const isBack = layout.col[toIdx] <= layout.col[fromIdx];
      const path = document.createElementNS(svgNS, 'path');
      let d, a, b, mid;
      if (isBack) {
        // Tracé orthogonal (droites + angles droits, 03/09 sur retour direct : "plus clair, notamment
        // dans les systèmes complexes") plutôt qu'une courbe -- descend tout droit, traverse à
        // l'horizontale, remonte tout droit. Aucune ambiguïté de lecture même avec plusieurs boucles
        // imbriquées, contrairement à des courbes qui peuvent se confondre visuellement dans un graphe
        // chargé.
        a = bottomOf(fromIdx); b = bottomOf(toIdx);
        const loopY = gridBottom + SEQ_MAP_LOOP_MARGIN + backEdgeIndex * SEQ_MAP_LOOP_STAGGER;
        backEdgeIndex++;
        d = `M ${a.x} ${a.y} L ${a.x} ${loopY} L ${b.x} ${loopY} L ${b.x} ${b.y}`;
        mid = { x: (a.x + b.x) / 2, y: loopY };
      } else {
        a = rightOf(fromIdx); b = leftOf(toIdx);
        const midX = (a.x + b.x) / 2;
        d = `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
        mid = { x: midX, y: (a.y + b.y) / 2 };
      }
      path.setAttribute('d', d);
      path.setAttribute('class', 'seq-map-edge' + (cls ? ' ' + cls : ''));
      // <title> (infobulle au survol) plutôt qu'un <text> toujours affiché comme dans la version
      // précédente : avec plusieurs embranchements/retours proches, des libellés SVG en permanence
      // visibles se chevauchaient et devenaient illisibles (retour direct en situation réelle, "tout
      // moche, tout recroquevillé") -- même principe que le graphe Wwise du vertical-random, qui n'a
      // lui-même aucun libellé permanent sur ses connecteurs.
      if (label) {
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = label;
        path.appendChild(title);
      }
      seqMapLinesEl.appendChild(path);
      // Repère de transition (03/09, retour direct : le simple changement de teinte du trait "n'est pas
      // très parlant") -- un petit disque au milieu du chemin plutôt qu'une couleur de trait à peine
      // perceptible. Forme ronde délibérément différente des nœuds (rectangulaires) pour ne jamais se
      // confondre avec un emplacement.
      if (hasTransition) {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', String(mid.x));
        dot.setAttribute('cy', String(mid.y));
        dot.setAttribute('r', '5');
        dot.setAttribute('class', 'seq-map-transition-dot');
        const dotTitle = document.createElementNS(svgNS, 'title');
        dotTitle.textContent = t('branchTransitionBadgeTitle');
        dot.appendChild(dotTitle);
        seqMapLinesEl.appendChild(dot);
      }
    };
    visibleIdx.forEach(idx => {
      const slot = slots[idx];
      if (!slot) return;
      const options = slot.nextOptions || [];
      if (options.length) {
        options.forEach((opt, oi) => {
          const targetIdx = slots.findIndex(sl => sl.id === opt.targetId);
          if (targetIdx < 0 || !visibleSet.has(targetIdx)) return; // cible pas encore révélée -- pas d'arête vers du vide
          const hasTransition = !!(transitionBuffers[idx] && transitionBuffers[idx][oi]);
          const label = opt.label || (slots[targetIdx] && slots[targetIdx].label) || '';
          drawEdge(idx, targetIdx, 'branch' + (hasTransition ? ' transition' : ''), label, hasTransition);
        });
      } else {
        const nextIdx = (idx + 1) % slots.length;
        if (nextIdx !== idx && visibleSet.has(nextIdx)) drawEdge(idx, nextIdx, '', '');
      }
    });
  }
  // Surveille la prochaine frontière de temps ("beat") ou de mesure ("bar") de l'emplacement ACTUELLEMENT
  // audible, et déclenche la coupure dès qu'elle est atteinte SI un choix est en attente à ce moment-là —
  // sinon se réarme pour la frontière suivante (l'emplacement continue de se rejouer normalement tant
  // qu'aucun choix n'est fait). myEpoch protège contre les chaînes héritées d'un passage précédent sur cet
  // emplacement (ou un autre) : si l'epoch global a changé entretemps (nouveau passage, coupure survenue
  // par un autre chemin), cette chaîne s'éteint silencieusement au lieu de continuer à tourner en double.
  function armNextSeqBranchBoundary(myEpoch) {
    if (myEpoch !== seqBranchEpoch) return;
    if (!currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment') return;
    const slotIdx = currentSeqBlockInfo.slotIdx;
    const slot = (slotIdx != null && slotIdx >= 0) ? (track.segmentSlots || [])[slotIdx] : null;
    if (!slot || !slot.nextOptions || !slot.nextOptions.length) return;
    const quant = slot.quantization || 'bar';
    const segStart = currentSeqBlockInfo.virtualZero;
    const timing = slotTiming(slot);
    const unitSec = quant === 'beat' ? timing.secondsPerBeat : (timing.beatsPerBar * timing.secondsPerBeat);
    const elapsed = Math.max(0, ctx.currentTime - segStart);
    const stepsElapsed = Math.floor(elapsed / unitSec + 1e-6);
    const cutTime = segStart + (stepsElapsed + 1) * unitSec; // toujours la PROCHAINE frontière, strictement après maintenant
    const delayMs = Math.max(0, (cutTime - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      if (myEpoch !== seqBranchEpoch) return; // périmée pendant l'attente (nouveau passage ou coupure survenue par ailleurs)
      if (pendingNextSegmentId) performSeqBranchCut();
      else armNextSeqBranchBoundary(myEpoch); // rien choisi à cette frontière : on surveille la suivante
    }, delayMs);
    seqTimeouts.push(id);
  }
  // Exécute la coupure : termine net ou en fondu (cutStyle) l'emplacement actuellement audible au point de
  // quantification atteint, annule toute génération déjà programmée mais pas encore audible (voir filtrage
  // de seqActiveSources plus bas), puis bascule vers la cible choisie — via un fichier de transition si l'embranchement
  // en déclare un (rejoue ensuite normalement, chevauchement crossfade-tail classique vers la cible), sinon
  // directement. Schéma "quantization"/"cutStyle"/"transition" validé le 02/08.
  function performSeqBranchCut() {
    const targetId = pendingNextSegmentId;
    pendingNextSegmentId = null;
    updateSeqPendingIndicator();
    if (!currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment' || currentSeqBlockInfo.slotIdx == null || currentSeqBlockInfo.slotIdx < 0 || !targetId) return;
    const sourceSlotIdx = currentSeqBlockInfo.slotIdx;
    const sourceSlot = (track.segmentSlots || [])[sourceSlotIdx];
    if (!sourceSlot) return;
    const targetIdx = (track.segmentSlots || []).findIndex(sl => sl.id === targetId);
    if (targetIdx < 0) return; // cible introuvable (id orphelin, ex. emplacement supprimé depuis) : l'emplacement continue de se rejouer normalement, rien de cassé
    seqBranchEpoch++; // invalide toute chaîne de vérification de frontière encore en vol pour l'emplacement qu'on quitte
    // Un choix de cible précis est plus spécifique qu'une demande générique "aller vers la fin" déjà en
    // attente (les deux boutons coexistent, rien n'empêche de cliquer les deux) — sans ça, decideNextSeqBlock()
    // route vers l'outro dès le prochain calcul et le visiteur n'entend jamais la cible qu'il vient de choisir.
    goToEndRequested = false;
    if (goToEndBtn) { goToEndBtn.disabled = false; goToEndBtn.textContent = t('goToEndBtn'); }
    const cutStyle = sourceSlot.cutStyle || 'fade';
    const now = ctx.currentTime;
    const opt = (sourceSlot.nextOptions || []).find(o => o.targetId === targetId);
    const oi = opt ? sourceSlot.nextOptions.indexOf(opt) : -1;
    const transitionBuf = (oi >= 0 && transitionBuffers[sourceSlotIdx]) ? transitionBuffers[sourceSlotIdx][oi] : null;
    const transitionDurationSec = transitionBuf ? transitionDurationSecFor(opt, sourceSlot) : null;
    // Trois styles de coupure : "hard" (fin nette), "fade" (fondu court fixe, 0.15s — même durée que les
    // autres fondus courts du morceau, solo/muet, embranchement-vertical), "custom" (durée choisie par le
    // compositeur, `sourceSlot.customCutFadeSec`, en secondes réelles — pas en mesures, un fondu de sortie
    // n'a pas besoin d'être quantifié musicalement comme un segment).
    const fadeOutSec = cutStyle === 'custom' ? (sourceSlot.customCutFadeSec != null ? sourceSlot.customCutFadeSec : 0.15) : 0.15;
    if (currentSeqBlockInfo.gainNode) {
      const g = currentSeqBlockInfo.gainNode;
      g.gain.cancelScheduledValues(now);
      if (cutStyle === 'hard') {
        g.gain.setValueAtTime(0, now);
      } else {
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + fadeOutSec);
      }
    }
    // Le scheduler normal programme jusqu'à 1s à l'avance (voir seqSchedulerTick) : au moment d'une coupure,
    // une ou PLUSIEURS générations peuvent déjà être programmées (source.start() déjà appelé sur le
    // contexte audio) sans être encore audibles — un emplacement court peut suffire à en empiler plusieurs
    // dans la même fenêtre. Toutes sont maintenant caduques et doivent être coupées avant leur heure de
    // départ, sinon elles sonnent quand même par-dessus la nouvelle destination : Web Audio ne sait pas
    // qu'elles sont devenues obsolètes tant qu'on ne les arrête pas explicitement une par une. Ne retenir
    // que "la dernière programmée" (ancien seqNextScheduled, une seule référence) ne suffisait pas dès que
    // plus d'une génération future était en attente — bug trouvé le 06/08 (chevauchement audible entre
    // l'ancien et le nouvel emplacement, signalé par Jules-Antoine). La génération ACTUELLEMENT audible
    // (ctxStartTime <= now) n'est jamais concernée ici : elle est déjà en train de s'éteindre via son
    // gainNode juste au-dessus.
    seqActiveSources = seqActiveSources.filter(({ src, ctxStartTime: st }) => {
      if (st > now) { try { src.stop(); } catch (e) {} return false; }
      return true;
    });
    seqTimeouts.forEach(id => clearTimeout(id)); seqTimeouts = [];
    if (transitionBuf) {
      forcedNextBlock = {
        buffer: transitionBuf, label: (opt.transition && opt.transition.label) || t('transitionFallbackLabel'),
        durationSec: transitionDurationSec, terminal: false, kind: 'transition',
        gain: effGain(opt.transition), slotIdx: -1, desc: pickStageDescription(opt.transition)
      };
    }
    // currentSlotIndex pointe maintenant sur la cible : que le bloc immédiatement suivant soit la
    // transition injectée (forcedNextBlock, consommée une seule fois) ou directement la cible (pas de
    // transition définie pour cet embranchement), decideNextSeqBlock() retombera ensuite naturellement sur
    // pickNextSegmentSlot() pour CET emplacement — exactement le même mécanisme qu'un enchaînement normal.
    currentSlotIndex = targetIdx;
    currentSlotRepeatsPlayed = 0;
    seqNextStartCtxTime = now;
    seqSchedulerTick();
  }
  // fillDurationSec : temps restant à animer jusqu'à 100% (pas forcément la durée totale du bloc — après
  // un seek, on reprend au milieu). totalDurationSec : durée nominale complète du bloc, nécessaire pour
  // savoir où se trouve le curseur de seek même après plusieurs reprises successives.
  function scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode, desc) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      pulseMeter(seqMeterEl);
      if (seqCurrentEl) seqCurrentEl.textContent = label;
      // "" (aucun texte propre à cet élément) laisse volontairement le texte déjà affiché tel quel — voir
      // pickStageDescription().
      if (desc && trackDescEl) trackDescEl.innerHTML = linkify(desc);
      if (kind) activateSeqStage(kind, (fillDurationSec != null) ? fillDurationSec : buffer.duration, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode);
    }, delayMs);
    seqTimeouts.push(id);
  }
  function scheduleSeqGeneration(ctxStartTime, buffer, label, kind, fillDurationSec, gainValue, offsetSec, totalDurationSec, terminal, slotIdx, desc) {
    if (!buffer) return;
    const off = offsetSec || 0;
    const total = totalDurationSec != null ? totalDurationSec : ((fillDurationSec != null) ? fillDurationSec + off : buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue != null ? gainValue : 1, ctxStartTime);
    src.connect(g); g.connect(trackMasterGain);
    src.start(ctxStartTime, off);
    seqActiveSources.push({ src, gain: g, ctxStartTime });
    seqLastGenSources = [src];
    // Sans durée explicite (cas de l'outro, qui ne programme rien après elle) : on anime le remplissage
    // sur la durée réelle du fichier décodé, seule longueur connue dans ce cas.
    scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, total, buffer, gainValue, terminal, slotIdx, g, desc);
  }
  // Détermine le prochain bloc à programmer : soit l'outro (si "Aller vers la fin" a été demandé et
  // qu'une outro existe), soit rien du tout (demande faite mais pas d'outro : on laisse filer), soit
  // un segment tiré au sort. `terminal: true` signifie "rien à programmer après ce bloc".
  function decideNextSeqBlock() {
    if (forcedNextBlock) { const b = forcedNextBlock; forcedNextBlock = null; return b; }
    if (goToEndRequested) {
      goToEndRequested = false;
      if (outroBuffer) return { buffer: outroBuffer, label: (track.outro && track.outro.label) || 'Outro', durationSec: null, terminal: true, kind: 'outro', gain: effGain(track.outro), desc: pickStageDescription(track.outro) };
      return null;
    }
    const picked = pickNextSegmentSlot();
    if (!picked) return null;
    const slot = track.segmentSlots[picked.slotIdx];
    const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
    return { buffer: slotBuffers[picked.slotIdx][picked.altIdx], label: (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))), durationSec: blockSeconds(alt && alt.bars, slot), terminal: false, kind: 'segment', gain: effGain(alt), slotIdx: picked.slotIdx, desc: pickStageDescription(slot) };
  }
  function armSeqFinalEnd() {
    const marker = seqLastGenSources[0];
    if (!marker) return;
    seqFinalMarkerSrc = marker;
    marker.onended = () => {
      if (seqFinalMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      seqActiveSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      setStoppedUI();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function seqSchedulerTick() {
    const lookahead = 1.0;
    while (seqNextStartCtxTime < ctx.currentTime + lookahead) {
      const next = decideNextSeqBlock();
      if (!next) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      scheduleSeqGeneration(seqNextStartCtxTime, next.buffer, next.label, next.kind, next.terminal ? null : next.durationSec, next.gain, 0, null, next.terminal, next.slotIdx, next.desc);
      if (next.terminal) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      seqNextStartCtxTime += next.durationSec;
    }
  }
  function stopSequential() {
    seqFinalMarkerSrc = null;
    if (seqSchedulerTimer) { clearInterval(seqSchedulerTimer); seqSchedulerTimer = null; }
    seqActiveSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    seqActiveSources = [];
    seqTimeouts.forEach(id => clearTimeout(id));
    seqTimeouts = [];
    goToEndRequested = false;
    pendingNextSegmentId = null;
    seqBranchEpoch++; // éteint silencieusement toute chaîne de vérification de frontière encore en vol
    forcedNextBlock = null;
    if (seqMeterEl) seqMeterEl.classList.remove('pulse');
    if (seqCurrentEl) seqCurrentEl.textContent = '—';
    // Symétrique à seqCurrentEl ci-dessus : à un vrai arrêt (pas une reprise, voir seekSequential qui ne
    // passe jamais par ici), le texte affiché revient à la description de base du morceau plutôt que de
    // rester figé sur le dernier emplacement/transition entendu.
    if (trackDescEl) trackDescEl.innerHTML = linkify(track.description || '');
    if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
    resetSeqStages();
    renderSeqBranchOptions(-1);
    // Carte globale (02/09) : plus aucun nœud "courant" une fois arrêté -- l'historique (seqVisitedSlotIds)
    // reste volontairement affiché tel quel (ce qui a été découvert cette session le reste), voir
    // playSequential() pour le seul cas où il est vraiment remis à zéro (un vrai redémarrage, pas juste Stop).
    updateSeqMap(-1);
  }
  function playSequential(isContinuation) {
    stopSequential();
    // Un vrai démarrage (pas une reprise après pause/veille) repart du premier emplacement de la chaîne —
    // la reprise, elle, continue le cycle là où il en était plutôt que de tout redémarrer. La carte globale
    // suit la même règle : un vrai redémarrage efface l'historique de découverte, une reprise le conserve.
    if (!isContinuation) { currentSlotIndex = 0; chainState = { cyclesCompleted: 0, capReached: false }; seqVisitedSlotIds = new Set(); }
    const now = ctx.currentTime;
    let firstBuffer, firstLabel, firstDurationSec, firstKind, firstGain, firstDesc, firstSlotIdx = -1;
    if (!isContinuation && introBuffer) {
      // L'intro n'appartient à aucun emplacement — son tempo suit celui du premier emplacement de la
      // chaîne (position 0, point de départ conventionnel), même principe que le vertical-random dont
      // l'intro suit le tempo de la première section jouable.
      const firstSlot = (track.segmentSlots || [])[0];
      firstBuffer = introBuffer; firstLabel = (track.intro && track.intro.label) || 'Intro'; firstDurationSec = blockSeconds(track.intro && track.intro.bars, firstSlot); firstKind = 'intro'; firstGain = effGain(track.intro); firstDesc = pickStageDescription(track.intro);
    } else {
      const picked = pickNextSegmentSlot();
      if (!picked) { if (statusEl) statusEl.textContent = t('noSegmentAvailable'); return; }
      const slot = track.segmentSlots[picked.slotIdx];
      const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
      firstBuffer = slotBuffers[picked.slotIdx][picked.altIdx]; firstLabel = (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))); firstDurationSec = blockSeconds(alt && alt.bars, slot); firstKind = 'segment'; firstGain = effGain(alt); firstSlotIdx = picked.slotIdx; firstDesc = pickStageDescription(slot);
    }
    scheduleSeqGeneration(now, firstBuffer, firstLabel, firstKind, firstDurationSec, firstGain, 0, null, false, firstSlotIdx, firstDesc);
    seqNextStartCtxTime = now + firstDurationSec;
    seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
    if (goToEndBtn) goToEndBtn.disabled = false;
  }
  // Seek dans le bloc actuellement actif (glisser sur sa waveform) : on arrête proprement tout ce qui est
  // programmé (comme un stop classique), puis on relance le MÊME buffer à la nouvelle position, et on
  // reprend la boucle de planification pour la suite comme si de rien n'était — le prochain segment tiré
  // au sort, ou la fin, ne sont pas affectés par le seek.
  function seekSequential(targetSec) {
    if (!currentSeqBlockInfo || !playing) return;
    const { kind, buffer, gain, totalSec, terminal, slotIdx } = currentSeqBlockInfo;
    const off = Math.max(0, Math.min(totalSec - 0.05, targetSec));
    const remaining = totalSec - off;
    // Capturé AVANT stopSequential() (qui remet le libellé affiché à "—") — bug trouvé le 13/08 en
    // réutilisant cette fonction pour la reprise après changement d'onglet : l'audio rejouait bien le bon
    // segment à la bonne position, mais l'étiquette affichée retombait à "—" au lieu de son nom, capturée
    // une fois déjà écrasée par l'arrêt.
    const label = seqCurrentEl ? seqCurrentEl.textContent : '';
    // Même piège que pour `label` juste au-dessus (et déjà corrigé une fois pour lui, le 13/08) : ma propre
    // remise à zéro de trackDescEl dans stopSequential() (ajoutée le 15/08) écraserait le texte affiché par
    // un vrai arrêt alors qu'un seek n'est qu'un redémarrage interne du même bloc. Capturé avant, restauré
    // après, à l'identique.
    const descHtml = trackDescEl ? trackDescEl.innerHTML : '';
    // stopSequential() remet goToEndRequested à false (comportement voulu pour un vrai arrêt) — mais un
    // seek n'est qu'un redémarrage interne du même bloc, pas un arrêt demandé par le visiteur. Si "Aller
    // vers la fin" avait été cliqué et n'était pas encore consommé (bloc courant non terminal), la demande
    // doit survivre au seek, sans quoi le morceau continue de boucler comme si rien n'avait été cliqué.
    // Même logique pour un choix d'embranchement en attente : un seek ne doit pas l'annuler.
    const wasGoToEndRequested = goToEndRequested;
    const wasPendingNextSegmentId = pendingNextSegmentId;
    stopSequential();
    goToEndRequested = wasGoToEndRequested;
    pendingNextSegmentId = wasPendingNextSegmentId;
    if (trackDescEl) trackDescEl.innerHTML = descHtml;
    const now = ctx.currentTime;
    // Important : on transmet TOUJOURS `remaining` (durée réellement restante après le seek), y compris
    // pour un bloc terminal (l'outro). Le passer à null ici (comme le fait le premier appel normal, sans
    // seek, où l'décalage est de toute façon 0) ferait retomber le calcul du remplissage visuel sur
    // buffer.duration — la durée TOTALE du fichier plutôt que ce qu'il en reste après le point de seek —
    // et le curseur se recalerait visuellement comme si la lecture repartait du tout début, alors que
    // l'audio, lui, joue bien depuis la bonne position.
    scheduleSeqGeneration(now, buffer, label, kind, remaining, gain, off, totalSec, terminal, slotIdx);
    if (terminal) {
      armSeqFinalEnd();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('endingWithOutro'); }
    } else {
      seqNextStartCtxTime = now + remaining;
      seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
      // Le bouton doit refléter l'état réel : si la demande est encore en attente (restaurée ci-dessus),
      // il doit rester désactivé avec son texte "en cours de fin", pas se réactiver comme si de rien n'était.
      if (goToEndBtn) {
        if (goToEndRequested) {
          goToEndBtn.disabled = true;
          goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
        } else {
          goToEndBtn.disabled = false;
        }
      }
    }
  }
  let level = 0, playing = false, startedAt = 0, offsetAt = (useQuantizedLoop ? startTrackSec : 0), rafId = null, ready = false;
  let isDraggingSeek = false; // vrai pendant qu'on glisse sur la barre de lecture — tick() ne doit pas écraser la position affichée pendant ce temps

  const PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
  const PAUSE_SVG = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
  // En cas d'échec de chargement : arrête l'icône qui tourne (elle donnerait l'impression que ça continue
  // de charger indéfiniment) et affiche un repère visuel statique d'erreur, cohérent avec le texte de
  // statut déjà présent dans le panneau déplié.
  function setLoadErrorIcon() {
    playIcon.classList.remove('loading-icon');
    playIcon.classList.add('error-icon');
    playIcon.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><circle cx="12" cy="16.7" r="0.9" fill="currentColor" stroke="none"/>';
    playBtn.setAttribute('aria-label', t('loadErrorAriaLabel'));
  }

  function updateStingerAvailability() {
    const expanded = details.classList.contains('expanded');
    setStingerButtonsEnabled(expanded && ready);
  }

  function setStingerButtonsEnabled(enabled) {
    stingerBtns.forEach(b => { b.disabled = !enabled; });
  }
  function killStingers() {
    activeStingerSources.forEach(s => { try { s.stop(); } catch(e){} });
    activeStingerSources = [];
  }
  trackCollapsers[track.id] = () => { setDetailsExpanded(details, false); updateStingerAvailability(); };
  trackStingerKillers[track.id] = killStingers;

  function updateProgressAt(elapsed) {
    if (!wrap) return;
    const pct = (elapsed / progressMaxSec()) * 100;
    if (fill) fill.style.width = pct + '%';
    if (head) head.style.left = pct + '%';
    if (waveformFg) waveformFg.style.clipPath = `inset(0 ${Math.max(0, 100 - pct)}% 0 0)`;
    timeCurrent.textContent = formatTime(elapsed);
  }
  function computeElapsed() {
    return (useQuantizedLoop || isVerticalRandom)
      ? currentPlaybackOffset()
      : (loops ? (ctx.currentTime - startedAt) % track.duration : Math.min(ctx.currentTime - startedAt, track.duration));
  }
  function tick() {
    if (!playing || isSequential || isEmbrVert) return;
    const elapsed = computeElapsed();
    if (isDraggingSeek) { rafId = requestAnimationFrame(tick); return; } // laisse la position glissée visible, ne pas l'écraser
    updateProgressAt(elapsed);
    if (vertMeterFills.length) {
      const gainArr = useQuantizedLoop ? currentGainNodes : gains;
      vertMeterFills.forEach((fillEl, i) => {
        if (!fillEl) return;
        const g = gainArr[i];
        const v = g ? Math.min(1, Math.max(0, g.gain.value)) : 0;
        fillEl.style.width = Math.round(v * 100) + '%';
      });
    }
    if (isVerticalRandom) {
      // Toutes les voix d'une même section redémarrent ensemble à chaque cycle (même scheduler partagé) :
      // une seule fraction de progression suffit à synchroniser le recouvrement de toutes les waveforms —
      // recalculée sur le tempo/timeline de la section EN COURS, plus un cycle unique pour tout le morceau.
      const origIdx = vrCurrentSectionOriginalIndex >= 0 ? vrCurrentSectionOriginalIndex : (playableSectionOriginalIndex[0] !== undefined ? playableSectionOriginalIndex[0] : -1);
      const currentSection = origIdx >= 0 ? resolveVRSection(track, origIdx) : null;
      if (currentSection) {
        const timing = sectionTiming(currentSection);
        const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
        const clip = `inset(0 ${(1 - frac) * 100}% 0 0)`;
        voiceWavePools.forEach(els => { if (els && els.fg) els.fg.style.clipPath = clip; });
        if (!vrIsDraggingSeek && vrBlockFillEls[origIdx]) vrBlockFillEls[origIdx].style.width = (frac * 100) + '%';
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  function setStoppedUI() {
    playIcon.innerHTML = PLAY_SVG;
    if (statusEl) statusEl.textContent = t('pausedStatus');
  }

  /* ---- Moteur simple (bouclage natif, comportement existant inchangé) ---- */
  function stopSimple(keepPosition) {
    if (loops && keepPosition !== false) {
      offsetAt = (ctx.currentTime - startedAt) % track.duration;
    }
    sources.forEach(s => { if (s) { try { s.stop(); } catch(e){} } });
    sources = []; gains = [];
  }
  function playSimple() {
    startedAt = ctx.currentTime - offsetAt;
    const p = profiles[level] || profiles[0];
    for (let i = 0; i < buffers.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      if (loops) { src.loop = true; src.loopStart = 0; src.loopEnd = track.duration; }
      const g = ctx.createGain();
      g.gain.setValueAtTime((p[i] || 0) * effGain(layersToLoad[i]) * voiceGain('layer-' + i), ctx.currentTime);
      src.connect(g); g.connect(trackMasterGain);
      src.start(0, offsetAt % track.duration);
      sources[i] = src; gains[i] = g;
      if (isStatic && !loops) {
        const layerIndex = i;
        src.onended = () => {
          // Si cette source a depuis été remplacée ou arrêtée manuellement (seek, stop, changement de piste),
          // sources[layerIndex] ne pointe plus vers elle -> ce n'est pas une vraie fin naturelle, on ignore.
          if (sources[layerIndex] !== src) return;
          naturalEnd();
        };
      }
    }
  }

  function pulseMeter(el) {
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth; // force le reflow pour pouvoir rejouer l'animation même si elle est déjà active
    el.classList.add('pulse');
  }
  // poolPicks : [{ pi, label, silent, buf }] où pi est la position d'affichage (0..vrMaxPoolCount-1) —
  // PAS l'index du pool dans la section en cours, qui peut varier d'une section à l'autre. Le mappage
  // entre "position d'affichage" et "pool réel de la section courante" est fait par l'appelant.
  function scheduleVoiceGraphUpdate(ctxStartTime, poolPicks, secIdx) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const timeoutId = setTimeout(() => {
      let topologyChanged = false;
      poolPicks.forEach(({ pi, label, silent, buf }) => {
        if (voiceCurrents[pi]) voiceCurrents[pi].textContent = label;
        const nodeEl = wwisePoolVoiceEls[pi];
        if (nodeEl) {
          const wasHidden = nodeEl.style.display === 'none';
          nodeEl.style.display = silent ? 'none' : '';
          if (wasHidden !== !!silent) topologyChanged = true;
        }
        if (!silent && buf) {
          drawVoiceWave(voiceWavePools[pi], buf);
          const fg = voiceWavePools[pi] && voiceWavePools[pi].fg;
          if (fg) { fg.style.transition = 'none'; fg.style.clipPath = 'inset(0 100% 0 0)'; }
        }
      });
      if (topologyChanged) drawWwiseLines();
      // Le libellé "section en cours" et le bloc de progression actif ne doivent changer qu'au moment où
      // cette génération devient réellement AUDIBLE — pas dès qu'elle est programmée. Avec la fenêtre de
      // programmation à l'avance (jusqu'à 1s), plusieurs décisions peuvent s'enchaîner en une seule fois
      // de façon synchrone (ex. une section à très peu de boucles qui avance presque aussitôt) : sans ce
      // délai, l'affichage sauterait déjà à la section suivante avant même que celle-ci ne se fasse
      // entendre, voire "clignoterait" sur une section jamais réellement audible pour le visiteur.
      if (secIdx != null && vrCurrentSectionOriginalIndex !== secIdx) {
        vrCurrentSectionOriginalIndex = secIdx;
        const declaredSection = (track.sections || [])[secIdx];
        if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: secIdx + 1 });
        vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === secIdx); });
      }
    }, delayMs);
    voiceGraphTimeouts.push(timeoutId);
  }

  /* ---- Moteur quantifié classique (vertical/statique avec loopEngine "quantized" — BPM + mesures,
     retrigger avec queue de fin superposée). Le vertical-random a désormais son propre moteur séparé,
     voir plus bas, puisque son minutage varie section par section plutôt que d'être fixe pour tout le
     morceau. ---- */
  function scheduleGeneration(ctxStartTime, bufferOffset) {
    const thisGenSources = [];
    const p = profiles[level] || profiles[0];
    const gensThisRound = [];
    for (let i = 0; i < buffers.length; i++) {
      if (!buffers[i]) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      const g = ctx.createGain();
      const key = 'layer-' + i;
      const base = (p[i] || 0) * effGain(layersToLoad[i]);
      g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
      src.connect(g); g.connect(trackMasterGain);
      src.start(ctxStartTime, bufferOffset);
      activeGenSources.push({ src, gain: g, voiceKey: key, baseGain: base });
      thisGenSources.push(src);
      gensThisRound[i] = g;
    }
    currentGainNodes = gensThisRound;
    lastGenSources = thisGenSources;
    scheduledGens.push({ ctxStartTime, bufferOffset });
    const cutoff = ctx.currentTime - Math.max(cycleLength, 4) * 2;
    if (scheduledGens.length > 6) scheduledGens = scheduledGens.filter(g => g.ctxStartTime >= cutoff);
  }
  function schedulerTick() {
    const lookahead = 1.0;
    while (nextGenStartCtxTime < ctx.currentTime + lookahead) {
      if (track.maxLoops && loopsPlayed >= track.maxLoops) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
        armFinalGenerationEnd();
        return;
      }
      scheduleGeneration(nextGenStartCtxTime, nextGenBufferOffset);
      loopsPlayed++;
      nextGenStartCtxTime += cycleLength;
      nextGenBufferOffset = loopInSec;
    }
  }
  // Une fois la limite de boucles atteinte : on n'interrompt pas la génération en cours (qui contient
  // la queue déjà présente dans le fichier après le point de sortie) — elle continue de jouer seule,
  // sans rien programmer par-dessus. C'est ça, l'outro : pas un fichier séparé, juste l'absence de relance.
  function armFinalGenerationEnd() {
    const marker = lastGenSources[0];
    if (!marker) return;
    finalGenerationMarkerSrc = marker;
    marker.onended = () => {
      if (finalGenerationMarkerSrc !== marker) return; // piste arrêtée/relancée entretemps : on ignore
      activeGenSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      cancelAnimationFrame(rafId);
      offsetAt = startTrackSec;
      updateProgressAt(offsetAt);
      setStoppedUI();
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function stopQuantized() {
    finalGenerationMarkerSrc = null;
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
  }
  function playQuantized(fromOffsetSec) {
    stopQuantized();
    const now = ctx.currentTime;
    scheduleGeneration(now, fromOffsetSec);
    let timeUntilNext;
    if (fromOffsetSec < loopInSec) {
      timeUntilNext = loopOutSec - fromOffsetSec;
    } else {
      const positionInLoop = (fromOffsetSec - loopInSec) % cycleLength;
      timeUntilNext = cycleLength - positionInLoop;
    }
    nextGenStartCtxTime = now + Math.max(0.02, timeUntilNext);
    nextGenBufferOffset = loopInSec;
    schedulerTimer = setInterval(schedulerTick, 200);
  }

  /* ---- Moteur embranchement-vertical : N boucles nommées et autonomes, calées sur le même BPM,
     jouant simultanément en arrière-plan pour les boucles de MÊME longueur que la référence (celle
     marquée isInitial) — bascule entre elles par pure rampe de gain (0.15s, même mécanisme que le
     solo/muet ci-dessus), sans redémarrage audio donc sans décalage. Une boucle plus courte que la
     référence n'est PAS jouée en arrière-plan (aucun verrouillage de phase naturel avec le cycle de
     référence) : au clic, lecture fraîche en fondu d'entrée, puis retour automatique à la référence une
     fois sa durée nominale écoulée (voir schéma validé le 31/07). Réutilise blockSeconds() du moteur
     séquentiel pour rester sur une seule notion de "durée en mesures" dans tout le fichier. ---- */
  const embrReferenceIdx = (() => {
    const ls = track.loops || [];
    const idx = ls.findIndex(l => l && l.isInitial);
    return idx >= 0 ? idx : 0;
  })();
  const embrRefBars = ((track.loops || [])[embrReferenceIdx] || {}).bars;
  // Classification paire/détour explicite (isDetour, 24/08) plutôt qu'une comparaison implicite des
  // mesures -- avec repli sur l'ancienne comparaison si le champ est absent du JSON chargé (morceau publié
  // avant ce changement, pas encore republié depuis). Une fois republié via le backstage, `isDetour` est
  // toujours explicitement présent (migré à la volée côté loadData()) et ce repli ne joue plus.
  const embrPeerIndices = (track.loops || []).map((l, i) => i)
    .filter(i => {
      if (i === embrReferenceIdx) return true;
      const l = track.loops[i];
      return 'isDetour' in l ? !l.isDetour : (l.bars === embrRefBars);
    });
  const EMBR_CROSSFADE_SEC = 0.15; // repli par défaut ("fade" standard, sans réglage personnalisé) -- même durée que refreshVoiceGains()
  // Durée de fondu à utiliser pour la bascule VERS une boucle donnée (24/08) -- remplace la constante fixe
  // EMBR_CROSSFADE_SEC utilisée partout jusqu'ici. "hard" = coupure nette (0s, aucune rampe) ; "custom" =
  // valeur réglée sur cette boucle précise ; "fade" (par défaut) ou réglage absent = repli EMBR_CROSSFADE_SEC,
  // comportement identique à avant ce changement.
  function embrCutFadeSec(loopDef) {
    if (!loopDef) return EMBR_CROSSFADE_SEC;
    if (loopDef.cutStyle === 'hard') return 0;
    if (loopDef.cutStyle === 'custom') return loopDef.customCutFadeSec != null ? loopDef.customCutFadeSec : EMBR_CROSSFADE_SEC;
    return EMBR_CROSSFADE_SEC;
  }
  // Durée nominale du fichier de transition d'une boucle avant que la boucle cible ne commence réellement
  // à monter (29/08, même mécanisme que transitionDurationSecFor() côté branching séquentiel, décision
  // confirmée par Jules-Antoine, complété le 29/08 avec l'unité "temps" pour rester cohérent avec le
  // séquentiel) : `durationUnit` réglé -> mesures ou temps individuels (tempo propre à la transition,
  // repli sur celui de la boucle quittée puis celui du morceau, via transitionTiming()) ou secondes
  // explicites, mêmes conventions que le séquentiel. Rien de réglé -> durée réelle du fichier décodé
  // lui-même plutôt que blockSeconds() : contrairement aux transitions séquentielles (toujours créées avec
  // `bars: 4` par défaut), une transition d'embranchement-vertical n'a par défaut AUCUNE valeur de mesures
  // -- un repli par mesures y donnerait une durée arbitraire (potentiellement plusieurs secondes de silence
  // sur la cible) plutôt que la durée réelle du fichier déposé.
  function embrTransitionDurationSecFor(loopDef, sourceLoopDef, buf) {
    const tr = loopDef && loopDef.transition;
    if (!tr) return 0;
    if (tr.durationUnit === 'seconds') return tr.durationSeconds != null ? tr.durationSeconds : (buf ? buf.duration : 0);
    if (tr.durationUnit === 'beats') {
      const timing = transitionTiming(tr, sourceLoopDef);
      return (tr.durationBeats || 1) * timing.secondsPerBeat;
    }
    if (tr.durationUnit === 'bars') {
      const timing = transitionTiming(tr, sourceLoopDef);
      return (tr.bars || timing.beatsPerBar) * timing.beatsPerBar * timing.secondsPerBeat;
    }
    return buf ? buf.duration : 0;
  }
  // Joue le fichier de transition (24/08) de la boucle CIBLE, s'il en existe un -- en overlay, superposé au
  // fondu de coupure plutôt qu'inséré séquentiellement entre les deux boucles (bien plus simple à
  // synchroniser correctement, et suffisant pour l'usage visé : un whoosh/une texture qui accompagne la
  // bascule plutôt qu'un vrai montage Wwise à embranchements). Suivie dans embrActiveTransitionSources
  // (contrairement à une vraie source "fire-and-forget") uniquement pour pouvoir la couper sur Stop --
  // bug trouvé à la relecture du 24/08 : sans ce suivi, une transition encore audible continuerait de
  // sonner après un Stop, la seule source de ce moteur à ne pas être coupée proprement.
  function playEmbrTransitionIfAny(loopIdx, ctxStartTime) {
    const buf = embrTransitionBuffers[loopIdx];
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(trackMasterGain);
    src.start(ctxStartTime, 0);
    embrActiveTransitionSources.push(src);
    src.onended = () => {
      const i = embrActiveTransitionSources.indexOf(src);
      if (i !== -1) embrActiveTransitionSources.splice(i, 1);
    };
  }
  // Points de boucle (Départ/Entrée/Sortie) de la boucle de référence (24/08) -- optionnels. S'ils sont
  // réglés (Sortie > Entrée), remplacent le calcul de durée de cycle par simple nombre de mesures : la
  // fenêtre de lecture Entrée->Sortie devient le cycle réel, et TOUTE génération (référence et boucles
  // paires, sur leur PROPRE fichier -- verrouillage de phase, décision validée le 24/08) démarre à
  // "Entrée" plutôt qu'au tout début du fichier. Le tout premier lancement démarre en revanche à "Départ"
  // (peut être avant "Entrée"), qui ne joue donc qu'une seule fois -- même principe que le moteur quantifié
  // classique (voir bufferOffset plus haut dans ce fichier). Aucun réglage -> comportement d'origine
  // inchangé (durée = nombre de mesures, démarrage à l'offset 0 pour toutes les générations).
  function embrLoopTiming() {
    const refLoop = (track.loops || [])[embrReferenceIdx] || {};
    const duration = refLoop.duration || 0;
    if (!duration) {
      // Pas encore de fichier probé (ou données publiées avant l'ajout de la durée par boucle) -- seul
      // repère disponible, l'ancien calcul par mesures.
      return { startSec: 0, loopInSec: 0, cycleLength: blockSeconds(embrRefBars) };
    }
    const loopInSec = (refLoop.loopInBeat || 0) * secondsPerBeat;
    // Pas de Sortie explicitement réglée -> le cycle va jusqu'à la fin réelle du fichier plutôt que de
    // retomber sur un calcul par mesures déconnecté de l'audio (24/08, retour visuel : "Mesures" est
    // vestige une fois un fichier chargé, la durée réelle prime toujours).
    const loopOutSec = refLoop.loopOutBeat != null
      ? Math.max(loopInSec + secondsPerBeat, refLoop.loopOutBeat * secondsPerBeat)
      : duration;
    const startSec = Math.min((refLoop.startTrackBeat || 0) * secondsPerBeat, loopInSec);
    return { startSec, loopInSec, cycleLength: loopOutSec - loopInSec };
  }
  function embrCycleLengthSec() { return embrLoopTiming().cycleLength; }
  // Le bouton d'une boucle EST masqué (pas seulement désactivé) tant qu'elle est celle effectivement
  // audible -- inutile d'afficher un bouton vers ce qui joue déjà (retour de Jules-Antoine, 29/08).
  // S'applique aussi bien à une boucle "paire" (embrActiveLoopIdx) qu'à un détour en cours (embrDetourBtn,
  // déjà désactivé par ailleurs -- le masquage remplace ici ce simple grisage). Seulement pendant une
  // lecture réelle (`playing`) : dans l'état "Prêt" avant tout premier clic sur Écouter, la référence est
  // déjà marquée .active par défaut (rendu serveur) mais rien ne joue encore -- son bouton doit rester
  // visible et cliquable comme les autres à ce stade.
  function updateEmbrButtonsUI() {
    embrLoopBtns.forEach(btn => {
      const idx = parseInt(btn.dataset.loopIdx, 10);
      btn.classList.toggle('active', idx === embrActiveLoopIdx);
      // Gabarit riche (2-7 boucles paires, voir buildTrackRow) : jamais masqué, même la boucle
      // actuellement audible -- sa forme d'onde doit rester visible et continuer d'avancer (demande du
      // 02/09). Le masquage display:none n'est conservé que pour le gabarit compact ci-dessous, inchangé.
      if (btn.classList.contains('embr-wave-btn')) { btn.style.display = ''; return; }
      const isCurrentlyAudible = playing && (idx === embrActiveLoopIdx || btn === embrDetourBtn);
      btn.style.display = isCurrentlyAudible ? 'none' : '';
    });
  }
  // Anime la progression continue des lignes riches -- calée UNE SEULE FOIS par (re)démarrage de
  // l'horloge de phase (embrReferenceStartCtxTime vient justement d'être remis à "maintenant" par
  // l'appelant, playEmbrVertical()/resumeEmbrVerticalAfterBackground()), jamais recalculée à chaque
  // bascule : le verrouillage de phase entre boucles paires ne change pas quand on change laquelle est
  // audible (refreshEmbrGains est une pure rampe de gain, voir son commentaire d'en-tête). N'affecte que
  // les boutons en gabarit riche (classe .embr-wave-btn) -- silencieusement ignoré pour les autres.
  function applyEmbrWaveAnimation() {
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return;
    embrLoopBtns.forEach(btn => {
      const fg = btn.querySelector('.embr-wave-fg');
      if (!fg) return;
      fg.style.animationDuration = cycle + 's';
      fg.style.animationDelay = '0s';
      fg.style.animationPlayState = 'running';
    });
  }
  // Repasse toutes les lignes riches en pause (état "Prêt", plus rien ne joue) -- évite une animation qui
  // continue de tourner dans le vide après un Stop.
  function pauseEmbrWaveAnimation() {
    embrLoopBtns.forEach(btn => {
      const fg = btn.querySelector('.embr-wave-fg');
      if (fg) fg.style.animationPlayState = 'paused';
    });
  }
  // Ligne overlay "en surimpression" affichée pendant la lecture d'un fichier de transition (voir
  // playEmbrTransitionIfAny) -- même mécanisme one-shot clip-path que animateMainWaveProgress() du
  // lecteur Sfx (buildSfxPlayer), réutilisé via renderWaveformPair() plutôt que dupliqué. Pendant qu'elle
  // est affichée, les lignes riches de la boucle quittée ET de la boucle ciblée passent "en filigrane"
  // (classe .embr-transition-dim, opacity 0.5 -- sans effet sur un bouton non riche) sans jamais
  // interrompre leur propre animation continue.
  let embrTransitionRowEl = null;
  function removeEmbrTransitionOverlay() {
    if (embrTransitionRowEl) { embrTransitionRowEl.remove(); embrTransitionRowEl = null; }
    embrLoopBtns.forEach(btn => btn.classList.remove('embr-transition-dim'));
  }
  function showEmbrTransitionOverlay(fromIdx, toIdx, buf, durationSec) {
    removeEmbrTransitionOverlay();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker || !buf || !(durationSec > 0)) return;
    const row = document.createElement('div');
    row.className = 'embr-transition-row';
    row.innerHTML = '<canvas class="embr-wave-bg"></canvas><canvas class="embr-wave-fg"></canvas>';
    picker.appendChild(row);
    embrTransitionRowEl = row;
    const bg = row.querySelector('.embr-wave-bg'), fg = row.querySelector('.embr-wave-fg');
    renderWaveformPair(bg, fg, buf, cssVar('--border', '#ccc'), cssVar('--accent', '#c9713c'));
    fg.style.animation = 'none';
    fg.style.transition = 'none';
    fg.style.clipPath = 'inset(0 100% 0 0)';
    void fg.offsetWidth; // force le reflow avant de redémarrer la transition, même truc qu'ailleurs dans ce fichier
    fg.style.transition = `clip-path ${durationSec}s linear`;
    fg.style.clipPath = 'inset(0 0% 0 0)';
    [fromIdx, toIdx].forEach(idx => {
      const btn = embrLoopBtns.find(b => parseInt(b.dataset.loopIdx, 10) === idx);
      if (btn) btn.classList.add('embr-transition-dim');
    });
  }
  // Ligne dédiée à un détour en cours -- deux variantes : one-shot (clip-path fixe sur sa durée nominale,
  // même mécanisme que la ligne de transition ci-dessus) pour un détour minuté, boucle infinie (même
  // mécanisme que applyEmbrWaveAnimation, durée = celle du buffer lui-même) pour un détour "en boucle
  // jusqu'à un bouton" (detourMode === 'loop', src.loop = true côté moteur -- voir startDetour()).
  let embrDetourRowEl = null;
  function removeEmbrDetourWaveRow() {
    if (embrDetourRowEl) { embrDetourRowEl.remove(); embrDetourRowEl = null; }
  }
  function showEmbrDetourWaveRow(buf, durationSec, isLooping) {
    removeEmbrDetourWaveRow();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker || !buf) return;
    const row = document.createElement('div');
    row.className = 'embr-detour-wave-row';
    row.innerHTML = '<canvas class="embr-wave-bg"></canvas><canvas class="embr-wave-fg"></canvas>';
    picker.appendChild(row);
    embrDetourRowEl = row;
    const bg = row.querySelector('.embr-wave-bg'), fg = row.querySelector('.embr-wave-fg');
    renderWaveformPair(bg, fg, buf, cssVar('--border', '#ccc'), cssVar('--accent', '#c9713c'));
    if (isLooping) {
      fg.style.animationDuration = buf.duration + 's';
      fg.style.animationDelay = '0s';
      fg.style.animationPlayState = 'running';
    } else if (durationSec > 0) {
      fg.style.animation = 'none';
      fg.style.transition = 'none';
      fg.style.clipPath = 'inset(0 100% 0 0)';
      void fg.offsetWidth;
      fg.style.transition = `clip-path ${durationSec}s linear`;
      fg.style.clipPath = 'inset(0 0% 0 0)';
    }
  }
  // Programme une génération de toutes les boucles "paires" (même longueur que la référence) en simultané,
  // gain à 1 pour celle actuellement active, 0 pour les autres — même principe que scheduleGeneration()
  // du moteur quantifié classique (retrigger périodique avec queue de fin superposée), généralisé à des
  // buffers indépendants au lieu des couches d'un seul morceau. isFirst (24/08) : seule la toute première
  // génération de la lecture démarre à "Départ" (offset embrLoopTiming().startSec) -- toutes les
  // suivantes démarrent à "Entrée" (embrLoopTiming().loopInSec), même principe que le moteur quantifié
  // classique.
  function scheduleEmbrGeneration(ctxStartTime, isFirst) {
    const timing = embrLoopTiming();
    const bufferOffset = isFirst ? timing.startSec : timing.loopInSec;
    embrPeerIndices.forEach(idx => {
      const buf = embrLoopBuffers[idx];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(idx === embrActiveLoopIdx ? 1 : 0, ctxStartTime);
      src.connect(g); g.connect(trackMasterGain);
      src.start(ctxStartTime, bufferOffset);
      embrActiveGenSources.push({ src, gain: g, loopIdx: idx, ctxStartTime });
    });
    // Purge des générations trop anciennes pour ne plus jamais sonner (même logique de nettoyage que
    // scheduledGens du moteur quantifié) — évite une croissance illimitée du tableau sur une lecture longue.
    const cutoff = ctx.currentTime - Math.max(embrCycleLengthSec(), 4) * 2;
    if (embrActiveGenSources.length > 40) embrActiveGenSources = embrActiveGenSources.filter(g => g.ctxStartTime >= cutoff);
  }
  function embrSchedulerTick() {
    const lookahead = 1.0;
    while (embrNextStartCtxTime < ctx.currentTime + lookahead) {
      scheduleEmbrGeneration(embrNextStartCtxTime, false); // jamais "Départ" ici, uniquement au tout premier lancement (playEmbrVertical)
      embrNextStartCtxTime += embrCycleLengthSec();
    }
  }
  // Recalcule en direct le gain de toutes les sources "paires" actuellement audibles ou en train de finir
  // (queue) — sans ça, un clic ne prendrait effet qu'à la prochaine génération programmée. Reprend
  // exactement le principe de refreshVoiceGains() ci-dessus, avec une seule "voix" active à la fois
  // plutôt que la logique solo/muet à plusieurs voix simultanées.
  // targetIdx : boucle qui doit monter à 1 (-1 si aucune, cas du détour où plus aucune voix paire n'est
  // active). Bascule toujours IMMÉDIATE (29/08) : une éventuelle transition est gérée en amont par
  // l'appelant (performEmbrSwitch), qui attend sa fin avant d'appeler cette fonction -- jamais de délai
  // géré ICI. Un délai géré à ce niveau avait été tenté (24/08→29/08) mais se heurtait au planificateur
  // périodique de générations (scheduleEmbrGeneration), qui ignore tout délai en cours et réinitialise le
  // gain de la cible dès le cycle suivant -- source de silences et de boucles superposées (bug signalé par
  // Jules-Antoine). Voir le commentaire d'en-tête de performEmbrSwitch pour le mécanisme retenu à la place.
  function refreshEmbrGains(targetIdx) {
    const now = ctx.currentTime;
    const activeLoopDef = (track.loops || [])[targetIdx];
    const fadeSec = embrCutFadeSec(activeLoopDef);
    embrActiveGenSources.forEach(({ gain, loopIdx }) => {
      if (!gain) return;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (loopIdx === targetIdx) {
        if (fadeSec <= 0) gain.gain.setValueAtTime(1, now); // "hard" : coupure nette, aucune rampe
        else gain.gain.linearRampToValueAtTime(1, now + fadeSec);
      } else {
        if (fadeSec <= 0) gain.gain.setValueAtTime(0, now);
        else gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      }
    });
  }
  // Reprise après mise en veille (29/08, bug signalé par Jules-Antoine : changer d'onglet relançait le
  // morceau depuis la référence). Contrairement au séquentiel/vertical-random, l'embranchement-vertical
  // n'a pas de notion de "position dans le temps" à laquelle chercher (plusieurs boucles phase-verrouillées
  // tournent en parallèle indéfiniment, pas une seule chronologie linéaire) -- on ne cherche donc pas à
  // retrouver la phase exacte d'avant la mise en veille (potentiellement longue, aucun repère fiable), mais
  // à relancer proprement une nouvelle horloge de phase à partir de maintenant, EN PRÉSERVANT la boucle qui
  // était effectivement active plutôt que de repartir de la référence comme le ferait playEmbrVertical().
  // Cas d'un détour en cours au moment de la mise en veille (embrActiveLoopIdx déjà à -1 à cet instant,
  // pas de boucle "paire" à préserver) : repli sur la référence -- un détour est un aparté ponctuel, pas la
  // boucle de fond que l'auditeur associe au morceau, le perdre au retour d'un onglet resté longtemps en
  // arrière-plan est un compromis acceptable plutôt que de tenter de reconstituer sa position exacte.
  function resumeEmbrVerticalAfterBackground() {
    const preservedIdx = embrActiveLoopIdx >= 0 ? embrActiveLoopIdx : embrReferenceIdx;
    stopEmbrVertical();
    embrActiveLoopIdx = preservedIdx;
    const now = ctx.currentTime;
    embrReferenceStartCtxTime = now;
    scheduleEmbrGeneration(now, true); // fixe déjà le bon gain (1) sur preservedIdx via embrActiveLoopIdx ci-dessus
    embrNextStartCtxTime = now + embrCycleLengthSec();
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    updateEmbrButtonsUI();
    applyEmbrWaveAnimation();
  }
  function playEmbrVertical() {
    stopEmbrVertical();
    embrActiveLoopIdx = embrReferenceIdx;
    const now = ctx.currentTime;
    embrReferenceStartCtxTime = now; // point zéro de l'horloge de phase, utilisé par embrQuantizeDelaySec()
    scheduleEmbrGeneration(now, true); // seul appel avec isFirst=true -- démarre à "Départ", pas "Entrée"
    embrNextStartCtxTime = now + embrCycleLengthSec();
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    updateEmbrButtonsUI();
    applyEmbrWaveAnimation();
    // Verrouillage des boutons pendant le segment Départ→Entrée (29/08, retour visuel) : ce segment ne
    // joue qu'une seule fois au tout premier lancement (voir embrLoopTiming()) et n'a pas de verrouillage
    // de phase établi avec les boucles paires avant d'avoir atteint "Entrée" -- une bascule pendant cette
    // fenêtre serait prématurée. Sans réglage de Départ/Entrée sur la référence, les deux valent 0 et ce
    // verrouillage dure 0s (comportement d'origine inchangé).
    const timing = embrLoopTiming();
    const introSec = timing.loopInSec - timing.startSec;
    if (introSec > 0) {
      embrLoopBtns.forEach(btn => { btn.disabled = true; });
      embrIntroLockTimeout = setTimeout(() => {
        embrIntroLockTimeout = null;
        embrLoopBtns.forEach(btn => { btn.disabled = false; });
      }, introSec * 1000);
    }
  }
  function stopEmbrVertical() {
    if (embrSchedulerTimer) { clearInterval(embrSchedulerTimer); embrSchedulerTimer = null; }
    if (embrDetourTimeout) { clearTimeout(embrDetourTimeout); embrDetourTimeout = null; }
    if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; }
    if (embrPendingSwitchTimeout) { clearTimeout(embrPendingSwitchTimeout); embrPendingSwitchTimeout = null; }
    if (embrPendingTransitionSwitchTimeout) { clearTimeout(embrPendingTransitionSwitchTimeout); embrPendingTransitionSwitchTimeout = null; }
    if (embrIntroLockTimeout) { clearTimeout(embrIntroLockTimeout); embrIntroLockTimeout = null; }
    removeEmbrEndLoopButton();
    removeEmbrDetourWaveRow();
    removeEmbrTransitionOverlay();
    // Le détour d'une boucle courte (voir selectEmbrLoop) n'est jamais poussé dans embrActiveGenSources —
    // ce n'est pas une génération "paire" en arrière-plan, juste une lecture ponctuelle — donc sans cet
    // arrêt explicite, elle continuerait de jouer jusqu'à sa fin naturelle après un Stop (bug trouvé et
    // corrigé le 31/07, voir CHANGELOG).
    if (embrDetourSource) { try { embrDetourSource.src.stop(); } catch (e) {} embrDetourSource = null; }
    if (embrDetourBtn) { embrDetourBtn.disabled = false; embrDetourBtn = null; }
    embrActiveGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    embrActiveGenSources = [];
    // Transitions encore audibles (24/08, bug trouvé à la relecture) -- même raisonnement que le détour
    // ci-dessus : sans cet arrêt explicite, une transition en cours continuerait de sonner après Stop.
    // Itère sur une COPIE (slice()) plutôt que le tableau live : src.stop() peut déclencher onended, qui
    // mute embrActiveTransitionSources pendant l'itération -- sans cette copie, un forEach sur le tableau
    // live sauterait l'élément suivant après chaque suppression en cours de boucle (bug détecté par le
    // test avant même d'atteindre un vrai navigateur, où onended est généralement asynchrone -- mais
    // s'appuyer sur cette hypothèse de timing pour la justesse du code serait fragile).
    embrActiveTransitionSources.slice().forEach(src => { try { src.stop(); } catch (e) {} });
    embrActiveTransitionSources = [];
    embrActiveLoopIdx = -1;
    embrLoopBtns.forEach(btn => { btn.disabled = false; });
    updateEmbrButtonsUI();
    pauseEmbrWaveAnimation();
  }
  // Interrompt en douceur (fondu de EMBR_CROSSFADE_SEC) un détour en cours, sans décider de ce qui doit
  // devenir actif ensuite — à la charge de l'appelant. Réutilisée à la fois pour le retour naturel à la
  // référence (durée nominale écoulée) et pour une interruption volontaire (le visiteur fait un nouveau
  // choix avant la fin du détour précédent) : sans ça, l'ancien détour restait orphelin — jamais coupé,
  // son bouton jamais réactivé (bug trouvé le 31/07, voir CHANGELOG).
  function fadeOutCurrentDetour() {
    if (embrDetourTimeout) { clearTimeout(embrDetourTimeout); embrDetourTimeout = null; }
    removeEmbrEndLoopButton();
    removeEmbrDetourWaveRow();
    if (!embrDetourSource) return;
    const t2 = ctx.currentTime;
    const dg = embrDetourSource.gain;
    // Fondu de sortie propre à CETTE boucle détour (24/08) -- même réglage cutStyle/customCutFadeSec que
    // celui utilisé pour son fondu d'entrée, retrouvé via le bouton désactivé pendant qu'elle joue.
    const leavingIdx = embrDetourBtn ? parseInt(embrDetourBtn.dataset.loopIdx, 10) : -1;
    const leavingLoopDef = leavingIdx >= 0 ? (track.loops || [])[leavingIdx] : null;
    const fadeSec = embrCutFadeSec(leavingLoopDef);
    dg.gain.cancelScheduledValues(t2);
    dg.gain.setValueAtTime(dg.gain.value, t2);
    if (fadeSec <= 0) dg.gain.setValueAtTime(0, t2);
    else dg.gain.linearRampToValueAtTime(0, t2 + fadeSec);
    embrDetourSource = null;
    if (embrDetourBtn) { embrDetourBtn.disabled = false; embrDetourBtn = null; }
  }
  // Durée en secondes d'un minuteur de retour auto (boucle paire), quelle que soit son unité de réglage
  // (temps/mesures/secondes) -- même conversion bpm/beatsPerBar que le reste du moteur quantifié.
  function embrDurationToSeconds(value, unit) {
    const v = value || 0;
    if (unit === 'seconds') return v;
    if (unit === 'beats') return v * (60 / bpm);
    return v * beatsPerBar * (60 / bpm); // 'bars', réglage par défaut
  }
  // Délai (en secondes) avant qu'une bascule demandée ne s'exécute réellement, selon le réglage de
  // quantification de la boucle CIBLE (24/08) -- calculé par rapport à la phase de la référence, seule
  // horloge qui tourne en continu en arrière-plan (y compris pour déclencher un détour, qui n'a pas
  // encore de cycle propre avant de démarrer). 'immediate' (ou absent) -> 0, aucune attente.
  function embrQuantizeDelaySec(quantize) {
    if (quantize !== 'beat' && quantize !== 'bar') return 0;
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return 0;
    const elapsed = ((ctx.currentTime - embrReferenceStartCtxTime) % cycle + cycle) % cycle;
    const beatDuration = 60 / bpm;
    if (quantize === 'beat') {
      const positionInBeat = elapsed % beatDuration;
      return (beatDuration - positionInBeat) % beatDuration;
    }
    const barDuration = beatsPerBar * beatDuration;
    const positionInBar = elapsed % barDuration;
    return (barDuration - positionInBar) % barDuration;
  }
  // Affiche/retire le bouton "Mettre fin à la boucle" inséré dynamiquement à la suite des boutons de
  // boucle habituels, uniquement pendant qu'un détour en mode "en boucle jusqu'à un bouton" est actif
  // (24/08). Un clic dessus redemande la boucle de référence -- en repassant par selectEmbrLoop(), donc en
  // respectant lui aussi le timing de bascule quantifié réglé sur la boucle de référence.
  function removeEmbrEndLoopButton() {
    if (embrEndLoopBtnEl) { embrEndLoopBtnEl.remove(); embrEndLoopBtnEl = null; }
  }
  function showEmbrEndLoopButton(loopDef) {
    removeEmbrEndLoopButton();
    const picker = wrapper.querySelector('[data-role="embrLoopPicker"]');
    if (!picker) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'embr-loop-btn embr-end-loop-btn';
    btn.textContent = (loopDef.endLoopButtonLabel && loopDef.endLoopButtonLabel.trim()) || t('embrEndLoopDefaultLabel');
    btn.addEventListener('click', () => { selectEmbrLoop(embrReferenceIdx); });
    picker.appendChild(btn);
    embrEndLoopBtnEl = btn;
  }
  // Exécute réellement la bascule vers `idx` -- toute la logique qui existait auparavant directement dans
  // selectEmbrLoop(), désormais appelée soit tout de suite (quantification "immédiat"), soit après le
  // délai calculé par embrQuantizeDelaySec() pour "prochain temps"/"prochaine mesure" (24/08).
  function performEmbrSwitch(idx) {
    const buf = embrLoopBuffers[idx];
    if (!buf) return;
    const loopDef = (track.loops || [])[idx];
    // Une bascule "transition en attente" précédente n'a plus lieu d'être si un nouveau choix arrive avant
    // qu'elle ne s'exécute (29/08, corrige un bug réel : le planificateur périodique de générations ignore
    // totalement une bascule en attente et réinitialise le gain de la cible à 1 dès le cycle suivant, quel
    // que soit le délai en cours -- laissé tel quel, ça produisait un silence pendant la transition ET des
    // boucles superposées selon le moment du clic par rapport aux cycles. Correctif : la bascule RÉELLE
    // (embrActiveLoopIdx, gains, UI) n'a plus lieu tant que la transition ne s'est pas terminée -- jusque
    // là, embrActiveLoopIdx reste sur l'ancienne boucle, donc le planificateur continue de la régénérer
    // normalement, sans connaître ni se soucier de la bascule en attente).
    if (embrPendingTransitionSwitchTimeout) { clearTimeout(embrPendingTransitionSwitchTimeout); embrPendingTransitionSwitchTimeout = null; }
    // Une transition affichée pour cette bascule annulée n'a plus lieu d'être -- sans ce retrait
    // inconditionnel, un nouveau choix SANS transition propre laisserait l'ancienne ligne affichée
    // indéfiniment (showEmbrTransitionOverlay() ne serait alors jamais rappelée pour la nettoyer).
    removeEmbrTransitionOverlay();
    if (embrPeerIndices.includes(idx)) {
      if (idx === embrActiveLoopIdx && !embrDetourSource) return; // déjà la voix active, rien à faire --
      // AVANT le nettoyage du minuteur ci-dessous (bug corrigé le 24/08 : un reclic accidentel sur le
      // bouton déjà actif annulait silencieusement son propre minuteur de retour sans jamais le
      // reprogrammer, laissant la boucle active indéfiniment au lieu de revenir comme prévu).
      if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; }
      fadeOutCurrentDetour(); // sans effet si aucun détour n'était en cours
      const sourceLoopDef = (track.loops || [])[embrActiveLoopIdx]; // boucle quittée -- repli de tempo pour la transition
      // Transition (29/08) : jouée tout de suite, EN OVERLAY par-dessus ce qui joue déjà (la boucle
      // quittée continue normalement pendant ce temps -- jamais de silence). La bascule réelle
      // (embrActiveLoopIdx + gains + UI) n'intervient qu'une fois la transition terminée, exactement comme
      // une coupure immédiate ordinaire à cet instant-là -- jamais de gain différé en parallèle du
      // planificateur périodique.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) : 0;
      if (transBuf) playEmbrTransitionIfAny(idx, ctx.currentTime);
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const doSwitch = () => {
        removeEmbrTransitionOverlay();
        embrActiveLoopIdx = idx;
        refreshEmbrGains(idx);
        updateEmbrButtonsUI();
        // Minuteur de retour auto (24/08) -- seulement si réglé sur cette boucle, jamais sur la référence
        // elle-même (revenir "vers" la référence n'aurait pas de sens).
        if (loopDef && !loopDef.isInitial && loopDef.autoReturnEnabled) {
          const sec = embrDurationToSeconds(loopDef.autoReturnValue, loopDef.autoReturnUnit);
          if (sec > 0) {
            embrAutoReturnTimeout = setTimeout(() => {
              embrAutoReturnTimeout = null;
              performEmbrSwitch(embrReferenceIdx); // retour direct, sans quantification supplémentaire -- le délai est déjà exprimé en unités musicales
            }, sec * 1000);
          }
        }
      };
      if (transDelay > 0) embrPendingTransitionSwitchTimeout = setTimeout(() => { embrPendingTransitionSwitchTimeout = null; doSwitch(); }, transDelay * 1000);
      else doSwitch();
    } else {
      // Ce détour précis est déjà celui en cours (son bouton est de toute façon désactivé pendant qu'il
      // joue -- double sécurité si l'appel venait d'ailleurs qu'un clic utilisateur).
      if (embrDetourBtn && parseInt(embrDetourBtn.dataset.loopIdx, 10) === idx) return;
      if (embrAutoReturnTimeout) { clearTimeout(embrAutoReturnTimeout); embrAutoReturnTimeout = null; } // on quitte le groupe des boucles paires -- son minuteur n'a plus lieu d'être
      fadeOutCurrentDetour(); // coupe en douceur un éventuel détour précédent avant d'en démarrer un nouveau
      const btn = embrLoopBtns.find(b => parseInt(b.dataset.loopIdx, 10) === idx);
      if (btn) btn.disabled = true; // pas de retrigger possible tant que le détour joue (validé le 31/07)
      const sourceLoopDef = (track.loops || [])[embrActiveLoopIdx]; // boucle quittée -- repli de tempo pour la transition
      // Transition (29/08) : même principe que la branche "paire" ci-dessus -- jouée en overlay tout de
      // suite, la voix actuellement active continue sans interruption jusqu'à ce que le détour démarre
      // réellement une fois la transition terminée.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) : 0;
      if (transBuf) playEmbrTransitionIfAny(idx, ctx.currentTime);
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const startDetour = () => {
        removeEmbrTransitionOverlay();
        embrActiveLoopIdx = -1; // plus aucune voix "paire" n'est active pendant le détour
        refreshEmbrGains(-1);
        const now = ctx.currentTime;
        const fadeSec = embrCutFadeSec(loopDef);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        if (fadeSec <= 0) g.gain.setValueAtTime(1, now); // "hard" : coupure nette, pas de fondu d'entrée
        else g.gain.linearRampToValueAtTime(1, now + fadeSec);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const loopsUntilButton = loopDef && loopDef.detourMode === 'loop';
        if (loopsUntilButton) { src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration; }
        src.connect(g); g.connect(trackMasterGain);
        src.start(now, 0);
        embrDetourSource = { src, gain: g };
        embrDetourBtn = btn;
        if (loopsUntilButton) {
          // Pas de minuterie de retour ici : ça tourne jusqu'à ce qu'on clique sur "Mettre fin à la boucle"
          // (ou sur le bouton d'une autre boucle, qui interrompt aussi ce détour via fadeOutCurrentDetour()).
          showEmbrEndLoopButton(loopDef);
          showEmbrDetourWaveRow(buf, buf.duration, true);
        } else {
          // Durée propre à CETTE boucle détour si elle a son propre tempo (bpm/beatsPerBar, 24/08) --
          // blockSeconds() accepte déjà un `slot` optionnel avec repli sur le tempo du morceau, exactement
          // le même mécanisme que slotTiming()/sectionTiming() ailleurs dans ce fichier, réutilisé tel quel.
          const durationSec = blockSeconds(loopDef && loopDef.bars, loopDef);
          showEmbrDetourWaveRow(buf, durationSec, false);
          embrDetourTimeout = setTimeout(() => {
            fadeOutCurrentDetour();
            embrActiveLoopIdx = embrReferenceIdx;
            refreshEmbrGains(embrReferenceIdx);
            updateEmbrButtonsUI();
          }, durationSec * 1000);
        }
        updateEmbrButtonsUI();
      };
      if (transDelay > 0) embrPendingTransitionSwitchTimeout = setTimeout(() => { embrPendingTransitionSwitchTimeout = null; startDetour(); }, transDelay * 1000);
      else startDetour();
    }
    trackPublicEvent('embr_loop_select', { trackId: track.id, loopId: loopDef && loopDef.id });
  }
  // Clic sur un bouton nommé : bascule pure (rampe de gain) si la boucle ciblée est "paire" avec la
  // référence (elle tourne déjà en silence en arrière-plan, verrouillée en phase) ; détour ponctuel en
  // aller-retour si elle est plus courte (pas de verrouillage de phase possible, donc pas de lecture en
  // arrière-plan avant sélection — voir commentaire d'en-tête du moteur). Depuis le 24/08, la bascule
  // réelle (performEmbrSwitch) peut être différée selon le réglage de quantification de la boucle CIBLE --
  // un nouveau clic avant l'exécution d'une bascule en attente l'annule et la remplace, plutôt que
  // d'empiler les bascules.
  function selectEmbrLoop(idx) {
    if (!playing) return;
    if (!embrLoopBuffers[idx]) return;
    if (embrPendingSwitchTimeout) { clearTimeout(embrPendingSwitchTimeout); embrPendingSwitchTimeout = null; }
    const loopDef = (track.loops || [])[idx];
    const delaySec = embrQuantizeDelaySec(loopDef && loopDef.switchQuantize);
    if (delaySec <= 0.001) {
      performEmbrSwitch(idx);
    } else {
      embrPendingSwitchTimeout = setTimeout(() => { embrPendingSwitchTimeout = null; performEmbrSwitch(idx); }, delaySec * 1000);
    }
  }
  embrLoopBtns.forEach(btn => {
    btn.addEventListener('click', () => selectEmbrLoop(parseInt(btn.dataset.loopIdx, 10)));
  });

  /* ---- Moteur vertical-random : sections chaînées, chacune avec ses pools simultanés et son propre
     tempo/timeline (30/07). La décision "quoi jouer ensuite" vient entièrement de
     createSectionPlaybackScheduler (logique pure, testée indépendamment — voir test-section-scheduler.js) ;
     ce qui suit ne fait que traduire ses décisions en programmation Web Audio réelle. ---- */
  let vrNextStartCtxTime = 0;
  let vrIsDraggingSeek = false; // pendant un glissement sur le bloc de section actif : le tick() n'écrase pas le remplissage affiché
  let vrSchedulerTimer = null;
  let vrCurrentSectionOriginalIndex = -1; // pour savoir quand la section affichée doit changer (rebuild du graphe)
  function scheduleSectionGeneration(ctxStartTime, secIdx, isFirstEverForThisSection, offsetOverride) {
    const section = resolveVRSection(track, secIdx);
    const timing = sectionTiming(section);
    const bufferOffset = offsetOverride != null ? offsetOverride : (isFirstEverForThisSection ? timing.startTrackSec : timing.loopInSec);
    const pools = section.pools || [];
    const poolPicks = [];
    pools.forEach((pool, poolIdx) => {
      const displaySlot = poolIdx; // les sections d'un même morceau ont chacune leur propre liste de pools,
      // affichée dans les mêmes emplacements visuels 0..N-1 (voir vrMaxPoolCount) — une section avec moins
      // de pools laisse simplement les emplacements suivants masqués.
      const bufs = (sectionBuffers[secIdx] && sectionBuffers[secIdx][poolIdx]) || [];
      const idx = pickPoolAlternativeIndex(secIdx, poolIdx);
      let label = '—', silent = true, pickedBuf = null;
      if (idx >= 0) {
        const alt = (pool.alternatives || [])[idx];
        const buf = bufs[idx];
        silent = !buf;
        pickedBuf = buf;
        label = buf ? ((alt && alt.label) ? alt.label : t('altFallback', { n: idx + 1 })) : t('silenceLabel');
        if (buf) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const g = ctx.createGain();
          const key = 'pool-' + displaySlot;
          const base = effGain(alt);
          g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
          src.connect(g); g.connect(trackMasterGain);
          src.start(ctxStartTime, bufferOffset);
          activeGenSources.push({ src, gain: g, voiceKey: key, baseGain: base });
        }
      }
      poolPicks.push({ pi: displaySlot, label, silent, buf: pickedBuf });
    });
    // Emplacements au-delà du nombre de pools de CETTE section (mais existants pour une autre section
    // du même morceau, donc présents dans le graphe) : masqués, pas juste silencieux.
    for (let pi = pools.length; pi < vrMaxPoolCount; pi++) poolPicks.push({ pi, label: '—', silent: true, buf: null });
    scheduleVoiceGraphUpdate(ctxStartTime, poolPicks, secIdx);
    lastGenSources = activeGenSources.slice(-Math.max(1, pools.length)).map(s => s.src);
    scheduledGens.push({ ctxStartTime, bufferOffset });
    const roughCutoffWindow = 8; // les sections n'ont pas de cycleLength unique commun, fenêtre fixe raisonnable
    const cutoff = ctx.currentTime - roughCutoffWindow;
    if (scheduledGens.length > 12) scheduledGens = scheduledGens.filter(g => g.ctxStartTime >= cutoff);
    return timing;
  }
  function sectionSchedulerTick() {
    const lookahead = 1.0;
    while (vrNextStartCtxTime < ctx.currentTime + lookahead) {
      const next = sectionScheduler.decideNext();
      if (!next) {
        clearInterval(vrSchedulerTimer); vrSchedulerTimer = null;
        armVRFinalEnd();
        return;
      }
      if (next.type === 'intro') {
        if (!introBuffer) continue; // pas de fichier intro chargé : ignoré, on redemande immédiatement la suite
        const src = ctx.createBufferSource();
        src.buffer = introBuffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.intro), vrNextStartCtxTime);
        src.connect(g); g.connect(trackMasterGain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'intro', baseGain: effGain(track.intro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0 });
        // Durée nominale de l'intro : mesures déclarées, au tempo de la PREMIÈRE section jouable (elle
        // seule a un sens ici, l'intro n'appartenant à aucune section) — la partie du fichier qui dépasse
        // cette durée nominale forme la queue de chevauchement, exactement comme en séquentiel.
        const firstPlayableOrigIdx = playableSectionOriginalIndex[0];
        const firstSection = firstPlayableOrigIdx !== undefined ? resolveVRSection(track, firstPlayableOrigIdx) : null;
        const introBpm = (firstSection && firstSection.bpm) || 120;
        const introBeatsPerBar = (firstSection && firstSection.beatsPerBar) || 4;
        const introDurationSec = ((track.intro && track.intro.bars) || introBeatsPerBar) * introBeatsPerBar * (60 / introBpm);
        vrNextStartCtxTime += introDurationSec;
        continue;
      }
      if (next.type === 'outro') {
        if (!outroBuffer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; armVRFinalEnd(); return; }
        const src = ctx.createBufferSource();
        src.buffer = outroBuffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.outro), vrNextStartCtxTime);
        src.connect(g); g.connect(trackMasterGain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'outro', baseGain: effGain(track.outro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0 });
        clearInterval(vrSchedulerTimer); vrSchedulerTimer = null;
        armVRFinalEnd();
        return;
      }
      // next.type === 'section'
      const origIdx = playableSectionOriginalIndex[next.index];
      const timing = scheduleSectionGeneration(vrNextStartCtxTime, origIdx, next.isFirstEverForThisSection);
      vrNextStartCtxTime += next.isFirstEverForThisSection ? (timing.loopOutSec - timing.startTrackSec) : timing.cycleLength;
    }
  }
  function armVRFinalEnd() {
    const marker = lastGenSources[0];
    if (!marker) return;
    finalGenerationMarkerSrc = marker;
    marker.onended = () => {
      if (finalGenerationMarkerSrc !== marker) return;
      activeGenSources = [];
      playing = false;
      playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
      cancelAnimationFrame(rafId);
      updateProgressAt(0);
      setStoppedUI();
      if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('goToEndBtn'); }
      if (goToNextSectionBtn) goToNextSectionBtn.disabled = true;
      if (activeTrackId === track.id) activeTrackId = null;
    };
  }
  function stopVerticalRandom() {
    finalGenerationMarkerSrc = null;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    voiceWavePools.forEach(els => { if (els && els.fg) { els.fg.style.transition = 'none'; els.fg.style.clipPath = 'inset(0 100% 0 0)'; } });
    voiceCurrents.forEach(el => { if (el) el.textContent = '—'; });
    let anyWasHidden = false;
    wwisePoolVoiceEls.forEach(el => { if (el && el.style.display === 'none') { anyWasHidden = true; el.style.display = ''; } });
    if (anyWasHidden) drawWwiseLines();
    if (sectionCurrentEl) sectionCurrentEl.textContent = '—';
    vrBlockEls.forEach(el => { if (el) el.classList.remove('active'); });
    vrBlockFillEls.forEach(el => { if (el) el.style.width = '0%'; });
    vrCurrentSectionOriginalIndex = -1;
  }
  function playVerticalRandom(isContinuation) {
    stopVerticalRandom();
    // Un vrai démarrage (pas une reprise après pause/veille) repart de zéro : nouvel ordre de sections
    // (rebrassé si "randomiser" est coché), intro rejouée si présente. Une reprise continue la chaîne là
    // où elle en était — même convention que playSequential(isContinuation) pour le séquentiel.
    if (!isContinuation || !sectionScheduler) {
      vrPlayableSectionRefs = playableSectionOriginalIndex.map(origIdx => ({ maxLoops: resolveVRSection(track, origIdx).maxLoops }));
      sectionScheduler = createSectionPlaybackScheduler(
        vrPlayableSectionRefs,
        {
          randomize: !!track.randomizeSections, hasIntro: !!introBuffer, hasOutro: !!outroBuffer,
          // Getter plutôt qu'une valeur figée à la création : le sélecteur visiteur mute track.maxChainLoops
          // directement (voir plus bas), donc chaque cycle voit la valeur à jour sans recréer le scheduler.
          get maxChainLoops() { return track.maxChainLoops || null; }
        }
      );
    }
    vrNextStartCtxTime = ctx.currentTime;
    sectionSchedulerTick();
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
    if (goToEndBtn) goToEndBtn.disabled = false;
    if (goToNextSectionBtn) goToNextSectionBtn.disabled = false;
  }
  // Glisser sur le bloc de la section EN COURS (voir vrBlockEls) : recherche à l'intérieur du cycle de
  // CETTE section uniquement, sans faire avancer la chaîne (même esprit que rerollPool) — les autres
  // blocs ne sont pas cliquables, une "position" n'ayant de sens que dans la section qui joue réellement.
  function seekVerticalRandom(fraction) {
    if (!playing || vrCurrentSectionOriginalIndex < 0) return;
    const origIdx = vrCurrentSectionOriginalIndex;
    const section = resolveVRSection(track, origIdx);
    const timing = sectionTiming(section);
    const offset = timing.loopInSec + fraction * timing.cycleLength;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    const now = ctx.currentTime;
    scheduleSectionGeneration(now, origIdx, false, offset);
    const timeUntilNext = timing.cycleLength - (fraction * timing.cycleLength);
    vrNextStartCtxTime = now + Math.max(0.02, timeUntilNext);
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
  }

  function stopAllSources(keepPosition) {
    playing = false;
    playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
    // Annule toute rampe de ducking en cours et revient à 1 immédiatement — sinon une prochaine lecture
    // pourrait démarrer avec un gain maître encore abaissé (ou en cours de remontée programmée dans le
    // futur) si le morceau est arrêté pile pendant qu'un Sfx joue.
    trackMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    trackMasterGain.gain.setValueAtTime(1, ctx.currentTime);
    if (isSequential) {
      stopSequential();
    } else if (isEmbrVert) {
      stopEmbrVertical();
    } else if (isVerticalRandom) {
      // Comme le séquentiel, la reprise après pause/veille passe par l'état déjà conservé du scheduler
      // (sectionScheduler persiste tant que la piste n'est pas complètement relancée) — jamais par
      // offsetAt, qui n'a plus de sens unique sur plusieurs sections potentiellement enchaînées.
      stopVerticalRandom();
    } else if (useQuantizedLoop) {
      if (keepPosition !== false) {
        offsetAt = currentPlaybackOffset();
      }
      stopQuantized();
    } else {
      stopSimple(keepPosition);
    }
    cancelAnimationFrame(rafId);
    vertMeterFills.forEach(el => { if (el) { el.style.transition = 'none'; el.style.width = '0%'; } });
    setStoppedUI();
  }
  function naturalEnd() {
    playing = false;
    playingTrackIds.delete(track.id); releaseWakeLockIfIdle();
    trackMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    trackMasterGain.gain.setValueAtTime(1, ctx.currentTime);
    cancelAnimationFrame(rafId);
    offsetAt = 0;
    updateProgressAt(0);
    setStoppedUI();
    if (activeTrackId === track.id) activeTrackId = null;
  }
  function playThisTrack(reroll, isContinuation) {
    if (activeTrackId && activeTrackId !== track.id) {
      document.dispatchEvent(new CustomEvent('stop-track', { detail: activeTrackId }));
      if (trackStingerKillers[activeTrackId]) trackStingerKillers[activeTrackId]();
    }
    Object.keys(trackCollapsers).forEach(id => {
      if (id !== track.id) trackCollapsers[id]();
    });
    activeTrackId = track.id;
    setDetailsExpanded(details, true);
    updateStingerAvailability();
    resumeAudioContext();
    playing = true;
    playingTrackIds.add(track.id); requestWakeLock();
    if (!isContinuation) trackPublicEvent('track_play', { trackId: track.id, mode: track.mode });
    if (isSequential) {
      playSequential(isContinuation);
    } else if (isEmbrVert) {
      playEmbrVertical();
    } else if (isVerticalRandom) {
      playVerticalRandom(isContinuation);
    } else if (useQuantizedLoop) {
      // Un vrai démarrage à froid réinitialise le budget de boucles (le premier passage compte déjà comme 1) ;
      // un reroll ou une recherche en cours de lecture (isContinuation) ne remet pas le compteur à zéro et ne l'avance pas non plus.
      // Note : on ne peut pas déduire ça de `playing`, qui est déjà retombé à false par le stopAllSources(false)
      // que ces deux appelants font juste avant — d'où ce paramètre explicite plutôt qu'une lecture d'état ambiant.
      if (!isContinuation) loopsPlayed = 1;
      playQuantized(offsetAt % track.duration);
    } else {
      playSimple();
    }
    playIcon.innerHTML = PAUSE_SVG;
    if (statusEl) statusEl.textContent = t('playingStatus');
    tick();
  }

  function rerollPool() {
    if (!isVerticalRandom) return;
    trackPublicEvent('pool_refresh', { trackId: track.id });
    if (!playing || vrCurrentSectionOriginalIndex < 0) {
      Object.keys(lastPickedPoolIndex).forEach(k => { lastPickedPoolIndex[k] = -1; });
      return;
    }
    // Rejoue la MÊME section avec de nouveaux tirages, sans faire avancer la chaîne d'un cran (contrairement
    // à un vrai changement de section) — n'arrête donc que les sources en cours, pas le scheduler pur
    // sous-jacent (sectionScheduler), dont l'état de progression reste intact.
    const origIdx = vrCurrentSectionOriginalIndex;
    if (vrSchedulerTimer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
    const now = ctx.currentTime;
    const timing = scheduleSectionGeneration(now, origIdx, false);
    vrNextStartCtxTime = now + timing.cycleLength;
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
  }

  const titleToggle = wrapper.querySelector('[data-role="titleToggle"]');
  if (titleToggle) titleToggle.addEventListener('click', updateStingerAvailability);
  const refreshPoolBtn = wrapper.querySelector('[data-role="refreshPool"]');
  if (refreshPoolBtn) refreshPoolBtn.addEventListener('click', rerollPool);

  wrapper.querySelectorAll('[data-voice-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.voiceKey;
      const action = btn.dataset.voiceAction;
      const set = action === 'solo' ? soloedVoices : mutedVoices;
      if (set.has(key)) set.delete(key); else set.add(key);
      const active = set.has(key);
      btn.classList.toggle('active', active);
      refreshVoiceGains();
      trackPublicEvent(action === 'solo' ? 'voice_solo_toggle' : 'voice_mute_toggle', { trackId: track.id, voice: key, active });
    });
  });
  // Volume par voix : 'input' pour un retour audio et visuel immédiat pendant le glissement (même
  // rampe courte que refreshVoiceGains partout ailleurs) ; 'change' pour ne tracker que la valeur
  // finale relâchée, pas chaque pas intermédiaire du curseur.
  wrapper.querySelectorAll('.voice-volume-slider').forEach(slider => {
    const key = slider.dataset.voiceKey;
    const valueEl = wrapper.querySelector(`[data-role="volumeValue-${key}"]`);
    slider.addEventListener('input', () => {
      layerVolumes.set(key, parseFloat(slider.value));
      if (valueEl) valueEl.textContent = Math.round(parseFloat(slider.value) * 100) + '%';
      refreshVoiceGains();
    });
    slider.addEventListener('change', () => {
      trackPublicEvent('voice_volume_change', { trackId: track.id, voice: key, value: parseFloat(slider.value) });
    });
  });
  if (goToEndBtn) {
    goToEndBtn.addEventListener('click', () => {
      if (!playing) return;
      if (isVerticalRandom) {
        if (!sectionScheduler) return;
        sectionScheduler.requestGoToEnd();
        goToEndBtn.disabled = true;
        goToEndBtn.textContent = layerHasSource(track.outro) ? t('endingWithOutro') : t('endingLastSegment');
      } else {
        if (goToEndRequested) return;
        goToEndRequested = true;
        goToEndBtn.disabled = true;
        goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
      }
      trackPublicEvent('go_to_end_click', { trackId: track.id });
    });
  }
  if (goToNextSectionBtn) {
    goToNextSectionBtn.addEventListener('click', () => {
      if (!playing || !sectionScheduler) return;
      sectionScheduler.requestGoToNextSection();
      trackPublicEvent('go_to_next_section_click', { trackId: track.id });
    });
  }

  // Glisser sur la waveform du bloc séquentiel actuellement actif pour avancer/reculer dedans — même
  // principe que la barre de lecture des autres modes (position affichée en direct pendant le glisser,
  // seek audio réel seulement au relâchement), mais limité au bloc en cours : impossible de glisser sur
  // un bloc déjà terminé (figé) ou pas encore atteint (son contenu n'est pas encore tiré au sort).
  Object.keys(seqBlockEls).forEach(kind => {
    const block = seqBlockEls[kind];
    const els = seqWaveEls[kind];
    if (!block || !els || !els.fg) return;
    let dragging = false;
    function fractionFromEvent(e) {
      const rect = block.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function isSeekable() { return playing && currentSeqBlockInfo && currentSeqBlockInfo.kind === kind && block.classList.contains('active'); }
    block.addEventListener('pointerdown', (e) => {
      if (!isSeekable()) return;
      dragging = true;
      try { block.setPointerCapture(e.pointerId); } catch (err) {}
      els.fg.style.transition = 'none';
      els.fg.style.clipPath = `inset(0 ${(1 - fractionFromEvent(e)) * 100}% 0 0)`;
    });
    block.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      els.fg.style.clipPath = `inset(0 ${(1 - fractionFromEvent(e)) * 100}% 0 0)`;
    });
    block.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const targetSec = fractionFromEvent(e) * currentSeqBlockInfo.totalSec;
      trackPublicEvent('seq_block_seek', { trackId: track.id, kind });
      seekSequential(targetSec);
    });
    block.addEventListener('pointercancel', () => { dragging = false; });
  });

  document.addEventListener('stop-track', (e) => { if (e.detail === track.id) stopAllSources(); });
  // Reprise après mise en veille de l'écran ou passage en arrière-plan : les minuteurs de programmation
  // et l'horloge audio peuvent avoir été suspendus pendant ce temps, laissant une programmation obsolète
  // qui resterait silencieuse indéfiniment sans ça. On relance proprement depuis la position actuelle
  // plutôt que de laisser un état incohérent qui obligerait à recharger la page.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !playing) return;
    resumeAudioContext();
    // Séquentiel et vertical-random (bug trouvé le 13/08) : le chemin générique ci-dessous arrêtait tout
    // puis relançait la chaîne via un tout nouveau tirage (isContinuation=true préserve la position dans
    // la CHAÎNE, mais le bloc en cours au moment du passage en arrière-plan était perdu, remplacé par un
    // nouveau bloc qui, lui, repart de sa propre position 0 — d'où l'impression de "repartir de zéro").
    // Correctif : réutiliser les mêmes primitives de recherche (seek) déjà éprouvées pour le glissement
    // manuel sur la waveform, qui rejouent précisément le bloc/section EN COURS à sa position réelle
    // plutôt que d'en tirer un nouveau.
    if (isSequential) {
      if (currentSeqBlockInfo) seekSequential(ctx.currentTime - currentSeqBlockInfo.virtualZero);
      return;
    }
    if (isVerticalRandom) {
      if (vrCurrentSectionOriginalIndex >= 0) {
        const section = resolveVRSection(track, vrCurrentSectionOriginalIndex);
        const timing = sectionTiming(section);
        const elapsed = currentPlaybackOffset();
        const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
        seekVerticalRandom(frac);
      }
      return;
    }
    // Embranchement-vertical (29/08, bug signalé par Jules-Antoine : changer d'onglet relançait le morceau
    // depuis la référence) : chemin dédié plutôt que le repli générique ci-dessous, qui appelle
    // playEmbrVertical() sans discernement -- or cette fonction réinitialise TOUJOURS embrActiveLoopIdx sur
    // la référence, perdant la boucle réellement active (ex. "On est repéré !") au profit d'un retour
    // silencieux à la case départ.
    if (isEmbrVert) {
      resumeEmbrVerticalAfterBackground();
      return;
    }
    const resumeFrom = computeElapsed();
    stopAllSources(false);
    offsetAt = resumeFrom;
    playThisTrack(false, true);
  });
  playBtn.addEventListener('click', () => { playing ? stopAllSources() : playThisTrack(true); });

  // Vertical-random (fusionné le 30/07) : pas de recherche par glissement — avec plusieurs sections
  // potentiellement enchaînées dans un ordre mélangé, "une position dans le temps" n'a plus de sens
  // unique à faire glisser vers. La barre reste un indicateur visuel de progression dans la section en
  // cours, juste non interactive pour ce mode.
  if (wrap && !isVerticalRandom) {
    // Glisser-déposer sur la barre de lecture (pas juste un tap) : la position se met à jour en direct
    // pendant le glissement (y compris la waveform), et la vraie recherche audio (arrêt/redémarrage des
    // sources) ne se déclenche qu'au relâchement — sinon on redémarrerait l'audio à chaque pixel parcouru.
    function seekPctFromEvent(e) {
      const rect = wrap.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    wrap.addEventListener('pointerdown', (e) => {
      isDraggingSeek = true;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      updateProgressAt(seekPctFromEvent(e) * progressMaxSec());
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!isDraggingSeek) return;
      updateProgressAt(seekPctFromEvent(e) * progressMaxSec());
    });
    wrap.addEventListener('pointerup', (e) => {
      if (!isDraggingSeek) return;
      isDraggingSeek = false;
      const seekTo = seekPctFromEvent(e) * progressMaxSec();
      if (playing) { stopAllSources(false); offsetAt = seekTo; playThisTrack(false, true); }
      else { offsetAt = seekTo; updateProgressAt(offsetAt); }
    });
    wrap.addEventListener('pointercancel', () => { isDraggingSeek = false; });
  }

  // Glisser sur le bloc de la section EN COURS uniquement (voir seekVerticalRandom) — les autres blocs
  // ne réagissent pas, une "position" n'ayant de sens que dans la section qui joue réellement.
  vrBlockEls.forEach((block, i) => {
    if (!block) return;
    function fractionFromEvent(e) {
      const rect = block.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    block.addEventListener('pointerdown', (e) => {
      if (vrCurrentSectionOriginalIndex !== i) return;
      vrIsDraggingSeek = true;
      try { block.setPointerCapture(e.pointerId); } catch (err) {}
      if (vrBlockFillEls[i]) vrBlockFillEls[i].style.width = (fractionFromEvent(e) * 100) + '%';
    });
    block.addEventListener('pointermove', (e) => {
      if (!vrIsDraggingSeek || vrCurrentSectionOriginalIndex !== i) return;
      if (vrBlockFillEls[i]) vrBlockFillEls[i].style.width = (fractionFromEvent(e) * 100) + '%';
    });
    block.addEventListener('pointerup', (e) => {
      if (!vrIsDraggingSeek || vrCurrentSectionOriginalIndex !== i) { vrIsDraggingSeek = false; return; }
      vrIsDraggingSeek = false;
      seekVerticalRandom(fractionFromEvent(e));
    });
    block.addEventListener('pointercancel', () => { vrIsDraggingSeek = false; });
  });

  notchDots.forEach(dot => {
    dot.addEventListener('click', () => {
      level = parseInt(dot.dataset.level, 10);
      notchDots.forEach(d => d.classList.toggle('active', d === dot));
      trackPublicEvent('intensity_change', { trackId: track.id, level });
      if (!playing) return;
      const p = profiles[level];
      const now = ctx.currentTime;
      const gainsToRamp = useQuantizedLoop ? currentGainNodes : gains;
      gainsToRamp.forEach((g, i) => {
        if (!g) return;
        const layerGain = effGain(layersToLoad[i]);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime((p[i] || 0) * layerGain * voiceGain('layer-' + i), now + 1.4);
      });
    });
  });

  stingerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const sfx = SFX_LIBRARY_BY_ID[btn.dataset.sfxId];
      const bufs = sfx && sfxBuffersById[sfx.id];
      if (!sfx || !bufs || !bufs.length) return;
      // Tirage round robin : aléatoire sans rejouer deux fois de suite la même variation, ou avance
      // séquentielle bouclée — selon le réglage propre à ce Sfx (même logique que le bloc de contenu Sfx).
      const n = bufs.length;
      let idx;
      if (n <= 1) idx = 0;
      else if (sfx.rrMode === 'sequential') {
        idx = ((sfxLastIndexById[sfx.id] != null ? sfxLastIndexById[sfx.id] : -1) + 1) % n;
      } else {
        do { idx = Math.floor(Math.random() * n); } while (idx === sfxLastIndexById[sfx.id]);
      }
      sfxLastIndexById[sfx.id] = idx;
      const buf = bufs[idx];
      if (!buf) return;
      resumeAudioContext();
      if (sfx.duckMainTrack) duckMainTrack(buf.duration);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      activeStingerSources.push(src);
      src.onended = () => { activeStingerSources = activeStingerSources.filter(s => s !== src); };
      trackPublicEvent('stinger_play', { trackId: track.id, sfxId: sfx.id, variationIndex: idx });
    });
  });

  if (loopCountSelect) {
    loopCountSelect.addEventListener('change', () => {
      // Mutation directe de l'objet track lu par schedulerTick à chaque cycle — s'applique donc au vol,
      // y compris en cours de lecture, sans avoir à relancer la piste.
      track.maxLoops = loopCountSelect.value === '' ? null : parseInt(loopCountSelect.value, 10);
      trackPublicEvent('track_loop_change', { trackId: track.id, maxLoops: track.maxLoops });
    });
  }

  if (chainLoopCountSelect) {
    chainLoopCountSelect.addEventListener('change', () => {
      // Mutation directe de track.maxChainLoops : lu au vol par pickNextSegmentSlot (séquentiel) à chaque
      // avancement, et par le getter passé à createSectionPlaybackScheduler (vertical-random) à chaque
      // cycle — dans les deux cas, pas besoin de relancer la piste pour que le changement s'applique.
      track.maxChainLoops = chainLoopCountSelect.value === '' ? null : parseInt(chainLoopCountSelect.value, 10);
      trackPublicEvent('track_chain_loop_change', { trackId: track.id, maxChainLoops: track.maxChainLoops });
    });
  }

  // Boucles par section (vertical-random uniquement) : chaque petit sélecteur mute en place l'objet
  // réellement lu par sectionScheduler.decideNext() (voir vrPlayableSectionRefs) — pas d'effet si la
  // section touchée n'est pas (encore) jouable, la mutation est alors simplement un no-op silencieux.
  vrSectionLoopSelectEls.forEach((sel, origIdx) => {
    if (!sel) return;
    sel.addEventListener('change', () => {
      const value = sel.value === '' ? null : parseInt(sel.value, 10);
      const j = playableSectionOriginalIndex.indexOf(origIdx);
      if (j >= 0 && vrPlayableSectionRefs[j]) vrPlayableSectionRefs[j].maxLoops = value;
      trackPublicEvent('track_section_loop_change', { trackId: track.id, sectionIndex: origIdx, maxLoops: value });
    });
  });

  // Compteurs utilisés pour distinguer un vrai échec de chargement d'une simple propagation encore en
  // cours côté GitHub Pages (fichiers fraîchement publiés, pas encore servis par le CDN — jusqu'à 10
  // minutes, voir docs/infrastructure.md) : si TOUTES les requêtes réseau tentées pour cette piste ont
  // échoué en 404/non-ok, plutôt qu'un mélange d'échecs ordinaires, c'est le signe le plus probable d'une
  // publication toute récente. Ne compte que les vrais fichiers distants (item.localFile ignoré, aperçu
  // local du backstage jamais concerné par ce problème).
  let remoteFetchAttempts = 0;
  let remoteFetchNotFound = 0;
  async function loadArrayBuffer(item) {
    if (item.localFile) return await item.localFile.arrayBuffer();
    remoteFetchAttempts++;
    const v = track.publishedAt ? ('?v=' + encodeURIComponent(track.publishedAt)) : '';
    const res = await fetch(track.base + encodeURIComponent(item.file) + v);
    if (!res.ok) remoteFetchNotFound++;
    return await res.arrayBuffer();
  }
  // Vrai uniquement si CHAQUE requête réseau tentée a échoué — un seul fichier chargé avec succès suffit à
  // écarter l'hypothèse "propagation encore en cours" (ce serait alors un vrai fichier manquant/corrompu).
  function looksLikePropagationDelay() {
    return remoteFetchAttempts > 0 && remoteFetchNotFound === remoteFetchAttempts;
  }
  function loadErrorMessageFor(fallbackKey) {
    return t(looksLikePropagationDelay() ? 'loadErrorPropagating' : fallbackKey);
  }
  // Relais de décodage : Safari (Mac et iOS, donc tout navigateur sur iPhone/iPad puisqu'Apple impose
  // WebKit) ne sait pas décoder l'Ogg Vorbis nativement via decodeAudioData — échec silencieux, capté
  // plus bas par le try/catch ("Erreur de chargement"). On tente d'abord le décodage natif (rapide, ne
  // change rien pour les navigateurs qui le supportent déjà), et seulement s'il échoue, on bascule sur
  // un décodeur Ogg Vorbis en JavaScript/WebAssembly, indépendant du support natif.
  // Volontairement une instance PAR PISTE (pas partagée au niveau du module) : plusieurs pistes chargent
  // leurs fichiers en parallèle au chargement de la page, et un décodeur partagé verrait ses appels
  // .reset()/.decode() de pistes différentes s'entremêler — corruption silencieuse plutôt qu'erreur.
  let vorbisDecoderPromise = null;
  function getVorbisDecoder() {
    if (!vorbisDecoderPromise) {
      vorbisDecoderPromise = (async () => {
        if (!window['ogg-vorbis-decoder']) throw new Error('Décodeur Ogg Vorbis de secours introuvable (bibliothèque non chargée)');
        const decoder = new window['ogg-vorbis-decoder'].OggVorbisDecoder();
        await decoder.ready;
        return decoder;
      })();
    }
    return vorbisDecoderPromise;
  }
  async function decodeAudioDataCompat(arrayBuffer) {
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (nativeError) {
      const decoder = await getVorbisDecoder();
      await decoder.reset();
      const { channelData, samplesDecoded, sampleRate } = await decoder.decode(new Uint8Array(arrayBuffer));
      if (!samplesDecoded || !channelData || !channelData.length) throw nativeError;
      const audioBuffer = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
      for (let ch = 0; ch < channelData.length; ch++) audioBuffer.copyToChannel(channelData[ch], ch);
      return audioBuffer;
    }
  }

  (async () => {
    let loaded = 0;
    let total;
    if (isVerticalRandom) {
      const rawSections = track.sections || [];
      const hasIntro = layerHasSource(track.intro);
      const hasOutro = layerHasSource(track.outro);
      // Total de fichiers à charger : intro/outro + toutes les alternatives ayant un fichier, dans les
      // sections NON dupliquées (une section qui duplique une autre ne charge rien en propre, voir 2e passe).
      const poolAltsWithSource = rawSections.reduce((sum, sec) => {
        if (sec.referencesSectionId) return sum;
        return sum + (sec.pools || []).reduce((s2, p) => s2 + (p.alternatives || []).filter(layerHasSource).length, 0);
      }, 0);
      total = (hasIntro ? 1 : 0) + (hasOutro ? 1 : 0) + poolAltsWithSource + totalSfxFilesToLoad;
      if (hasIntro) {
        try {
          const ab = await loadArrayBuffer(track.intro);
          introBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* intro manquante : la lecture démarrera directement sur la première section */ }
      }
      if (hasOutro) {
        try {
          const ab = await loadArrayBuffer(track.outro);
          outroBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* outro manquante : "Aller vers la fin" laissera simplement filer la section en cours */ }
      }
      // Deux passes, même principe que les groupes/emplacements ailleurs : d'abord les sections avec leur
      // propre contenu, puis celles qui dupliquent (referencesSectionId) pointent vers le MÊME tableau —
      // aucun fichier n'est chargé ni décodé deux fois.
      for (let si = 0; si < rawSections.length; si++) {
        if (rawSections[si].referencesSectionId) continue; // traité en 2e passe
        const pools = rawSections[si].pools || [];
        sectionBuffers[si] = [];
        for (let pi = 0; pi < pools.length; pi++) {
          const alts = pools[pi].alternatives || [];
          // Même longueur que les alternatives déclarées, y compris les slots vides (intentionnels : ils
          // restent un choix possible du tirage, avec pour effet un cycle silencieux pour ce pool).
          sectionBuffers[si][pi] = new Array(alts.length).fill(null);
          lastPickedPoolIndex[canonicalPoolKey(si, pi)] = -1;
          for (let ai = 0; ai < alts.length; ai++) {
            if (!layerHasSource(alts[ai])) continue;
            try {
              const ab = await loadArrayBuffer(alts[ai]);
              sectionBuffers[si][pi][ai] = await decodeAudioDataCompat(ab);
              loaded++;
              if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
            } catch (e) { /* alternative manquante : ce tirage restera silencieux pour ce pool, ne bloque pas le reste */ }
          }
        }
      }
      for (let si = 0; si < rawSections.length; si++) {
        if (!rawSections[si].referencesSectionId) continue;
        const sourceIdx = rawSections.findIndex(s => s.id === rawSections[si].referencesSectionId);
        sectionBuffers[si] = sourceIdx >= 0 ? sectionBuffers[sourceIdx] : [];
      }
      // Sections effectivement jouables : celles qui ont, une fois les duplications résolues, au moins un
      // pool avec au moins un fichier chargé — ordre DÉCLARÉ conservé (même convention que
      // pickNextSegmentSlot pour le séquentiel, qui saute silencieusement les emplacements vides).
      playableSectionOriginalIndex = rawSections.map((s, i) => i).filter(i => (sectionBuffers[i] || []).some(bufs => bufs.some(b => b)));
      if (!playableSectionOriginalIndex.length) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSections'); setLoadErrorIcon(); return; }
    } else if (isSequential) {
      const hasIntro = layerHasSource(track.intro);
      const hasOutro = layerHasSource(track.outro);
      const rawSlots = track.segmentSlots || [];
      const slotAltsWithSource = rawSlots.reduce((sum, sl) => sum + (sl.alternatives || []).filter(layerHasSource).length, 0);
      const transitionsWithSource = rawSlots.reduce((sum, sl) => sum + (sl.nextOptions || []).filter(opt => layerHasSource(opt.transition)).length, 0);
      total = (hasIntro ? 1 : 0) + (hasOutro ? 1 : 0) + slotAltsWithSource + transitionsWithSource + totalSfxFilesToLoad;
      if (hasIntro) {
        try {
          const ab = await loadArrayBuffer(track.intro);
          introBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* intro manquante : la lecture démarrera directement sur un emplacement */ }
      }
      if (hasOutro) {
        try {
          const ab = await loadArrayBuffer(track.outro);
          outroBuffer = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* outro manquante : "Aller vers la fin" laissera simplement filer l'emplacement en cours */ }
      }
      for (let si = 0; si < rawSlots.length; si++) {
        if (rawSlots[si].referencesSlotId) continue; // traité en 2e passe
        const alts = rawSlots[si].alternatives || [];
        // Même longueur que les alternatives déclarées, y compris les slots vides (intentionnel, même
        // convention que les groupes du vertical-random) : ça reste un choix possible du tirage, avec pour
        // effet un cycle silencieux pour cet emplacement — pas un fichier à charger.
        slotBuffers[si] = new Array(alts.length).fill(null);
        lastPickedSlotAltIndex[canonicalSlotKey(si)] = -1;
        for (let ai = 0; ai < alts.length; ai++) {
          if (!layerHasSource(alts[ai])) continue;
          try {
            const ab = await loadArrayBuffer(alts[ai]);
            slotBuffers[si][ai] = await decodeAudioDataCompat(ab);
            loaded++;
            if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
          } catch (e) { /* alternative manquante : ce tirage restera silencieux pour cet emplacement, ne bloque pas le reste */ }
        }
      }
      for (let si = 0; si < rawSlots.length; si++) {
        if (!rawSlots[si].referencesSlotId) continue;
        const sourceIdx = rawSlots.findIndex(sl => sl.id === rawSlots[si].referencesSlotId);
        slotBuffers[si] = sourceIdx >= 0 ? slotBuffers[sourceIdx] : [];
      }
      // Fichiers de transition (optionnels, un par embranchement précis — paire source→cible, PAS par
      // emplacement) : même convention d'indexation que slotBuffers, mais un niveau plus loin puisque
      // c'est nextOptions[oi], pas alternatives[ai], qui porte le fichier. transitionBuffers[si][oi] reste
      // null si aucun fichier n'est déclaré pour cet embranchement précis — la bascule sera alors directe
      // (pas de fichier de transition à jouer) plutôt qu'une erreur de chargement.
      for (let si = 0; si < rawSlots.length; si++) {
        const opts = rawSlots[si].nextOptions || [];
        transitionBuffers[si] = new Array(opts.length).fill(null);
        for (let oi = 0; oi < opts.length; oi++) {
          if (!layerHasSource(opts[oi].transition)) continue;
          try {
            const ab = await loadArrayBuffer(opts[oi].transition);
            transitionBuffers[si][oi] = await decodeAudioDataCompat(ab);
            loaded++;
            if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
          } catch (e) { /* transition manquante : la bascule vers cette cible se fera directement, sans fichier intermédiaire */ }
        }
      }
      if (slotBuffers.every(bufs => bufs.every(b => !b))) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSegments'); setLoadErrorIcon(); return; }
      // Carte globale (02/09) : côté Backstage (seqMapFullReveal), affichée en entier dès le chargement --
      // outil de vérification de sa propre structure, pas besoin d'attendre une première lecture. Côté
      // public, rien à afficher tant que rien n'a joué (révélation progressive, voir updateSeqMap()).
      if (seqMapFullReveal) updateSeqMap(-1);
    } else if (isEmbrVert) {
      const rawLoops = track.loops || [];
      const loopsWithSource = rawLoops.filter(layerHasSource).length;
      const transitionsWithSource = rawLoops.filter(l => layerHasSource(l && l.transition)).length;
      total = loopsWithSource + transitionsWithSource + totalSfxFilesToLoad;
      embrLoopBuffers = new Array(rawLoops.length).fill(null);
      embrTransitionBuffers = new Array(rawLoops.length).fill(null);
      for (let li = 0; li < rawLoops.length; li++) {
        if (!layerHasSource(rawLoops[li])) continue;
        try {
          const ab = await loadArrayBuffer(rawLoops[li]);
          embrLoopBuffers[li] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* boucle manquante : ce bouton restera désactivé, ne bloque pas les autres */ }
      }
      // Fichiers de transition (24/08) -- optionnels, un par boucle. Une transition manquante/en échec ne
      // bloque jamais la boucle elle-même : la bascule se fait juste sans overlay, comme si aucune
      // transition n'avait été réglée (même tolérance que les transitions du séquentiel).
      for (let li = 0; li < rawLoops.length; li++) {
        const trans = rawLoops[li] && rawLoops[li].transition;
        if (!layerHasSource(trans)) continue;
        try {
          const ab = await loadArrayBuffer(trans);
          embrTransitionBuffers[li] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* transition manquante : la bascule vers cette boucle se fera sans overlay */ }
      }
      if (embrLoopBuffers.every(b => !b)) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorNoSegments'); setLoadErrorIcon(); return; }
    } else {
      total = layersToLoad.length + totalSfxFilesToLoad;
      for (let i = 0; i < layersToLoad.length; i++) {
        try {
          const ab = await loadArrayBuffer(layersToLoad[i]);
          buffers[i] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { if (statusEl) statusEl.textContent = loadErrorMessageFor('loadErrorStatus'); setLoadErrorIcon(); return; }
      }
      if (isStatic && buffers[0] && waveformBg) {
        try {
          waveformBuffer = buffers[0];
          redrawWaveforms();
        } catch (e) { /* la waveform est un bonus visuel : un échec ici ne doit jamais bloquer la lecture */ }
      }
    }
    for (const sfx of attachedSfx) {
      const alts = (sfx.alternatives || []).filter(a => a.file || a.localFile);
      sfxBuffersById[sfx.id] = new Array(alts.length).fill(null);
      for (let ai = 0; ai < alts.length; ai++) {
        try {
          // Base propre au Sfx (audio/sfx-{id}/), jamais celle du morceau — un Sfx est une entrée de
          // bibliothèque partagée, potentiellement attachée à plusieurs morceaux à la fois.
          const alt = alts[ai];
          let ab;
          if (alt.localFile) ab = await alt.localFile.arrayBuffer();
          else {
            const v = sfx.publishedAt ? ('?v=' + encodeURIComponent(sfx.publishedAt)) : '';
            const res = await fetch(sfx.base + encodeURIComponent(alt.file) + v);
            ab = await res.arrayBuffer();
          }
          sfxBuffersById[sfx.id][ai] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* une variation manquante ne bloque pas la lecture principale */ }
      }
    }
    // Pour une source locale non encore publiée, la durée réelle n'est connue qu'une fois décodée.
    const allMainBuffers = isVerticalRandom
      ? [introBuffer, outroBuffer, ...sectionBuffers.flat(2)].filter(Boolean)
      : isSequential
      ? [introBuffer, outroBuffer, ...slotBuffers.flat()].filter(Boolean)
      : isEmbrVert
      ? embrLoopBuffers.filter(Boolean)
      : buffers.filter(Boolean);
    const allSfxBuffers = Object.values(sfxBuffersById).flat().filter(Boolean);
    const decodedMax = Math.max(0, ...allMainBuffers.map(b => b.duration), ...allSfxBuffers.map(b => b.duration));
    if (decodedMax > (track.duration || 0)) {
      track.duration = decodedMax;
      if (timeTotal) timeTotal.textContent = formatTime(progressMaxSec());
    }
    if (statusEl) statusEl.textContent = t('readyStatus');
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', t('playAriaLabel'));
    playIcon.classList.remove('loading-icon');
    playIcon.innerHTML = PLAY_SVG;
    ready = true;
    updateStingerAvailability();
  })();
}

/* ---------------- Init ---------------- */



/* ---------------- Accessibilité : contraste renforcé ---------------- */
// Case à cocher côté visiteur (mémorisée sur ce navigateur via localStorage) qui remplace les couleurs
// personnalisées (celles de l'AdReel ou du pack) par une palette à fort contraste, lisible quel que
// soit le choix esthétique du compositeur. Purement client, aucune dépendance backend.
const HIGH_CONTRAST_VARS = {
  '--bg': '#ffffff', '--bg-card': '#ffffff', '--text': '#000000', '--text-title': '#000000',
  '--text-dim': '#1a1a1a', '--text-dimmer': '#3a3a3a', '--border': '#000000',
  '--accent': '#a3390f', '--accent-soft': '#f4d9cb'
};
function setupContrastToggle(toggleId, customBg, customText, customTitleColor) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;
  const root = document.documentElement;
  function apply(on) {
    if (on) {
      Object.keys(HIGH_CONTRAST_VARS).forEach(key => root.style.setProperty(key, HIGH_CONTRAST_VARS[key]));
    } else {
      Object.keys(HIGH_CONTRAST_VARS).forEach(key => root.style.removeProperty(key));
      if (customBg) root.style.setProperty('--bg', customBg);
      if (customText) root.style.setProperty('--text', customText);
      if (customTitleColor) root.style.setProperty('--text-title', customTitleColor);
    }
    document.body.classList.toggle('high-contrast', on);
    document.dispatchEvent(new CustomEvent('layerpitch-contrast-changed'));
  }
  let saved = false;
  try { saved = localStorage.getItem('layerpitch-high-contrast') === '1'; } catch (e) {}
  toggle.checked = saved;
  apply(saved);
  toggle.addEventListener('change', () => {
    apply(toggle.checked);
    try { localStorage.setItem('layerpitch-high-contrast', toggle.checked ? '1' : '0'); } catch (e) {}
  });
}

/* ---------------- Lecteur Sfx (bloc de contenu AdReel) ----------------
 * Même principe visuel que les blocs Intro/Segment/Outro du mode séquentiel (une forme d'onde par
 * variation, cliquable individuellement), mais sans notion de mesures/BPM — juste un jeu de variations
 * interchangeables du même son (round robin), et un bouton "Play" qui en choisit une selon le réglage
 * de la bibliothèque Sfx (aléatoire sans répéter la précédente, ou dans l'ordre).
 */
// Texte bilingue d'un Sfx : descriptionFr/descriptionEn (même pattern que presentationFr/En des packs et
// collections), avec repli sur l'ancien champ unique "description" pour tout Sfx publié avant le passage
// au bilingue (voir migration côté backstage). Résolu ici, dans player.js, puisque c'est le seul endroit
// qui connaît déjà la langue courante (currentLang()/setLang()) sans dépendre de chaque page hôte.
function pickSfxDescription(sfxDef) {
  const fr = sfxDef.descriptionFr != null ? sfxDef.descriptionFr : (sfxDef.description || '');
  const en = sfxDef.descriptionEn || '';
  return (currentLang() === 'en' ? (en || fr) : (fr || en)) || '';
}

// Texte optionnel affiché pendant la lecture séquentielle d'un emplacement (segmentSlots[]), d'une intro/
// outro, ou d'un fichier de transition (nextOptions[].transition) — même pattern bilingue que pickSfxDescription,
// mais sans repli sur un ancien champ unique (nouveau champ, jamais publié avant, pas de migration à gérer).
// Retourne '' (falsy) si l'objet n'a de texte dans aucune langue — le point d'appel (scheduleSeqLabelUpdate)
// interprète ça comme "cet élément ne redéfinit rien" et laisse le texte précédemment affiché tel quel.
function pickStageDescription(obj) {
  if (!obj) return '';
  const fr = obj.descriptionFr || '';
  const en = obj.descriptionEn || '';
  return (currentLang() === 'en' ? (en || fr) : (fr || en)) || '';
}

// Même architecture que le morceau (buildTrackRow/initTrackPlayer) : une ligne compacte (bouton Play +
// titre), un seul repli qui laisse apparaître tout ce qu'il y a à voir — description, la forme d'onde de
// la SEULE variation effectivement jouée (pas les N en même temps comme avant), et les variations RR
// juste en dessous pour en choisir une précise. Pas de second niveau de repli imbriqué.
function buildSfxPlayer(sfxDef) {
  const alts = sfxDef.alternatives || [];
  const description = pickSfxDescription(sfxDef);
  const wrapper = document.createElement('div');
  wrapper.className = 'track-row-wrapper sfx-row-wrapper';
  wrapper.innerHTML = `
    <div class="track-row">
      <button class="play-btn" data-role="playBtn" ${alts.length ? '' : 'disabled'} aria-label="${t('playAriaLabel') || 'Play'}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="track-row-title" data-role="titleToggle">
        <span class="name">${escapeHtml(sfxDef.title || '')}</span>
        <span class="mode-tag">${t('sfxModeTag')}</span>
      </div>
    </div>
    <div class="track-row-details" data-role="details">
      <div class="track-row-details-inner">
        ${description ? `<div class="track-desc">${linkify(description)}</div>` : ''}
        ${alts.length ? `
          <div class="progress-wrap waveform-mode" data-role="mainWaveWrap">
            <canvas class="waveform-bg" data-role="mainWaveBg"></canvas>
            <canvas class="waveform-fg" data-role="mainWaveFg"></canvas>
          </div>
          <div class="sfx-rr-row" data-role="sfxRrRow">
            ${alts.map((a, i) => `
              <button class="sfx-rr-block" type="button" data-ri="${i}" aria-label="${escapeHtml(a.label) || ('Variation ' + (i + 1))}">
                <canvas class="sfx-rr-wave-bg"></canvas>
                <canvas class="sfx-rr-wave-fg"></canvas>
                <span class="sfx-rr-label">${escapeHtml(a.label) || ('#' + (i + 1))}</span>
              </button>
            `).join('')}
          </div>
        ` : `<span class="placeholder-tag">${t('sfxNoFilesYet')}</span>`}
      </div>
    </div>
  `;

  wrapper.querySelector('[data-role="titleToggle"]').addEventListener('click', () => {
    const details = wrapper.querySelector('[data-role="details"]');
    setDetailsExpanded(details, !details.classList.contains('expanded'));
  });

  if (!alts.length) return wrapper; // Sfx sans variation uploadée : titre/description seuls, pas de lecteur

  const rrBlocks = [...wrapper.querySelectorAll('.sfx-rr-block')];
  const playBtn = wrapper.querySelector('[data-role="playBtn"]');
  const mainWaveBg = wrapper.querySelector('[data-role="mainWaveBg"]');
  const mainWaveFg = wrapper.querySelector('[data-role="mainWaveFg"]');
  const details = wrapper.querySelector('[data-role="details"]');
  const buffers = new Array(alts.length).fill(null);
  const loadPromises = new Array(alts.length).fill(null);
  let lastIndex = -1;
  let activeSource = null;
  // Participe au même registre partagé que les morceaux (trackCollapsers/activeTrackId, voir plus haut
  // dans le fichier) : un Sfx joué déplie sa propre ligne et replie tout le reste de la page — morceaux
  // ET autres Sfx confondus — exactement comme playThisTrack() le fait pour un morceau.
  trackCollapsers[sfxDef.id] = () => setDetailsExpanded(details, false);

  // Décodeur dédié à CE lecteur, jamais partagé — même raisonnement que pour chaque piste musicale : des
  // appels .decode() concurrents sur un décodeur Ogg Vorbis partagé s'entremêleraient silencieusement.
  let vorbisDecoderPromise = null;
  function getVorbisDecoder() {
    if (!vorbisDecoderPromise) {
      vorbisDecoderPromise = (async () => {
        if (!window['ogg-vorbis-decoder']) throw new Error('Décodeur Ogg Vorbis de secours introuvable (bibliothèque non chargée)');
        const decoder = new window['ogg-vorbis-decoder'].OggVorbisDecoder();
        await decoder.ready;
        return decoder;
      })();
    }
    return vorbisDecoderPromise;
  }
  async function decodeAudioDataCompat(arrayBuffer) {
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (nativeError) {
      const decoder = await getVorbisDecoder();
      await decoder.reset();
      const { channelData, samplesDecoded, sampleRate } = await decoder.decode(new Uint8Array(arrayBuffer));
      if (!samplesDecoded || !channelData || !channelData.length) throw nativeError;
      const audioBuffer = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
      for (let ch = 0; ch < channelData.length; ch++) audioBuffer.copyToChannel(channelData[ch], ch);
      return audioBuffer;
    }
  }
  function drawRrWave(i) {
    const buf = buffers[i];
    if (!buf) return;
    const block = rrBlocks[i];
    const bg = block.querySelector('.sfx-rr-wave-bg');
    const fg = block.querySelector('.sfx-rr-wave-fg');
    renderWaveformPair(bg, fg, buf, cssVar('--border', '#ccc'), cssVar('--accent', '#c9713c'));
  }
  let currentMainIndex = -1;
  // Forme d'onde principale : reflète uniquement la variation en train de jouer (ou la dernière jouée),
  // jamais toutes les variations à la fois — c'est ce que montrent les blocs RR en dessous, à la demande.
  function drawMainWave(i) {
    const buf = buffers[i];
    if (!buf || !mainWaveBg) return;
    renderWaveformPair(mainWaveBg, mainWaveFg, buf, cssVar('--border', '#ccc'), cssVar('--accent', '#c9713c'));
  }
  // Anime le remplissage de la forme d'onde principale sur la durée réelle du buffer — même mécanisme de
  // transition CSS (clip-path) que le reste du site (cf. activateSeqStage pour le mode séquentiel), plutôt
  // qu'une boucle requestAnimationFrame : un Sfx est un one-shot sans pause/seek, une transition CSS suffit.
  function animateMainWaveProgress(durationSec) {
    if (!mainWaveFg || !(durationSec > 0)) return;
    mainWaveFg.style.transition = 'none';
    mainWaveFg.style.clipPath = 'inset(0 100% 0 0)';
    void mainWaveFg.offsetWidth; // force le reflow, sinon le navigateur fusionne ce reset avec la transition suivante
    mainWaveFg.style.transition = `clip-path ${durationSec}s linear`;
    mainWaveFg.style.clipPath = 'inset(0 0% 0 0)';
  }
  async function loadAlt(i) {
    if (buffers[i]) return buffers[i];
    if (loadPromises[i]) return loadPromises[i];
    loadPromises[i] = (async () => {
      const alt = alts[i];
      if (!alt.file || !sfxDef.base) return null;
      const v = sfxDef.publishedAt ? ('?v=' + encodeURIComponent(sfxDef.publishedAt)) : '';
      const res = await fetch(sfxDef.base + encodeURIComponent(alt.file) + v);
      const ab = await res.arrayBuffer();
      const buf = await decodeAudioDataCompat(ab);
      buffers[i] = buf;
      drawRrWave(i);
      return buf;
    })().catch(e => { console.error('Sfx — échec de chargement d\'une variation :', e); return null; });
    return loadPromises[i];
  }
  // Chargement dès le montage plutôt qu'à la demande : contrairement aux morceaux complets (chargés à
  // l'expansion seulement), un Sfx est un one-shot court — coût réseau marginal, et ça évite un délai
  // perceptible au premier clic sur "Play" ou sur une variation.
  alts.forEach((_, i) => loadAlt(i));

  function pickIndex() {
    const n = alts.length;
    if (n <= 1) return 0;
    if (sfxDef.rrMode === 'sequential') { lastIndex = (lastIndex + 1) % n; return lastIndex; }
    let idx;
    do { idx = Math.floor(Math.random() * n); } while (idx === lastIndex);
    lastIndex = idx;
    return idx;
  }
  async function playIndex(i) {
    const buf = await loadAlt(i);
    if (!buf) return;
    if (activeSource) { try { activeSource.stop(); } catch (e) {} }
    rrBlocks.forEach(b => b.classList.remove('active'));
    rrBlocks[i].classList.add('active');
    currentMainIndex = i;
    drawMainWave(i);
    animateMainWaveProgress(buf.duration);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    activeSource = src;
    src.onended = () => {
      if (activeSource === src) {
        activeSource = null;
        rrBlocks[i].classList.remove('active');
        if (activeTrackId === sfxDef.id) activeTrackId = null;
      }
    };
  }
  rrBlocks.forEach((block, i) => { block.addEventListener('click', () => playIndex(i)); });
  playBtn.addEventListener('click', () => {
    if (activeTrackId && activeTrackId !== sfxDef.id) {
      document.dispatchEvent(new CustomEvent('stop-track', { detail: activeTrackId }));
      if (trackStingerKillers[activeTrackId]) trackStingerKillers[activeTrackId]();
    }
    Object.keys(trackCollapsers).forEach(id => { if (id !== sfxDef.id) trackCollapsers[id](); });
    activeTrackId = sfxDef.id;
    setDetailsExpanded(details, true);
    playIndex(pickIndex());
  });

  // Redessine les formes d'onde déjà chargées si le conteneur change de taille — même principe que
  // partout ailleurs sur le site (mode statique, séquentiel, etc.). Inclut la forme d'onde principale si
  // une variation a déjà été jouée au moins une fois.
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      buffers.forEach((buf, i) => { if (buf) drawRrWave(i); });
      if (currentMainIndex >= 0) drawMainWave(currentMainIndex);
    }).observe(wrapper);
  }

  return wrapper;
}

window.LayerPlayerCore = {
  formatTime,
  cumulativeProfiles,
  section,
  escapeHtml,
  linkify,
  layerHasSource,
  buildTrackRow,
  initTrackPlayer,
  renderTracksBlock,
  buildSfxPlayer,
  setupContrastToggle,
  getModeLabel,
  setLang,
  setSfxLibrary,
  shareOrCopy,
  downloadTracksAsZip,
  createSectionPlaybackScheduler,
  PLAYABLE_MODES
};

})();
