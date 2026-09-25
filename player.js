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

// Appareil approximatif (mobile/desktop uniquement, simplification actée pour le tableau de bord
// analytique compositeur, grille du 4 septembre) -- seuil 768px, cohérent avec le point de bascule
// déjà utilisé ailleurs dans le produit pour distinguer mobile/desktop.
function lpDeviceType() {
  try { return (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ? 'mobile' : 'desktop'; }
  catch (e) { return null; }
}

// Dupliqué à l'identique dans index.html et pack.html : chaque script a sa propre closure, pas d'accès
// croisé possible. Jamais bloquant, silencieux si Umami n'est pas chargé.
// Le contexte (quel AdReel ou quel Pack a généré l'événement) est déposé sur `window.__lpTrackContext`
// par la page hôte (index.html ou pack.html) dès qu'elle connaît son propre identifiant — permet de
// distinguer dans Umami "le lien envoyé au Studio X" plutôt qu'un compteur global indifférencié.
// Repères de capture (outil vidéo « Test in game », 25/09) : TOUT ce que l'outil vidéo enregistre passe par cet
// évènement DOM -- les évènements de télémétrie ci-dessous (trackPublicEvent) ET des repères propres à la capture,
// jamais envoyés aux statistiques (démarrage de chaque génération d'une boucle, vraie bascule d'un embranchement,
// reprise après pause...). Chaque repère donne l'instant EXACT (heure du contexte audio) où le son a lieu : `at`, fourni
// par le moteur quand il programme le son (futur) ou l'annonce après coup (passé), sinon l'heure courante.
// `at` : heure EXACTE du contexte audio où le son a lieu (horloge du son, pas celle de la page ni de la vidéo) -- l'outil
// vidéo s'en sert pour caler tous les sons entre eux à l'échantillon près, puis les replace d'un bloc sur la vidéo.
function captureMark(name, detail) {
  try {
    const d = Object.assign({}, detail || {});
    if (d.at == null) d.at = ctx.currentTime;
    document.dispatchEvent(new CustomEvent('layerpitch-capture-mark', { detail: { name, detail: d } }));
  } catch (e) { /* jamais bloquant */ }
}
// captureExtra : détails utiles à la seule capture vidéo (jamais envoyés aux statistiques).
function trackPublicEvent(name, detail, captureExtra) {
  captureMark(name, captureExtra ? Object.assign({}, detail, captureExtra) : detail);
  try {
    if (!window.umami) return;
    const ctx = window.__lpTrackContext || {};
    // ownerId (identité du compositeur) ajouté le 4 septembre, à part du couple type/id ci-dessus :
    // un id d'AdReel/Pack seul ('main' notamment) n'est unique que PAR compositeur, pas globalement.
    // Umami lui-même ne sert plus qu'à la vue globale plateforme de Jules-Antoine (chantier du 5
    // septembre, tableau de bord compositeur basculé sur un système Postgres propriétaire, voir
    // logAnalyticsEvent ci-dessous) -- conservé ici pour une éventuelle inspection manuelle par
    // compositeur dans son propre tableau de bord Umami, bénéfice mineur mais inoffensif.
    window.umami.track(name, Object.assign({}, detail, ctx.type ? { [ctx.type]: ctx.id } : {}, ctx.ownerId ? { ownerId: ctx.ownerId } : {}));
  } catch (e) { /* jamais bloquant */ }
  // Tableau de bord analytique compositeur (chantier du 5 septembre, système Postgres propriétaire --
  // supabase/migrations/20260905010000_composer_analytics_events.sql) : distinct d'Umami ci-dessus.
  // Silencieux si api/analytics.js n'est pas chargé (chemin historique sans handle, data.json
  // statique) ou si le type de contexte n'est ni 'adreel' ni 'pack' (collections hors périmètre) --
  // jamais bloquant pour la lecture, mêmes garanties que trackPublicEvent lui-même.
  try {
    const ctx = window.__lpTrackContext || {};
    if (window.LayerPitchAnalytics && (ctx.type === 'adreel' || ctx.type === 'pack' || ctx.type === 'collection') && ctx.sessionId) {
      window.LayerPitchAnalytics.logAnalyticsEvent(ctx.type, ctx.id, ctx.sessionId, name, detail, lpDeviceType(), ctx.ownerId || null);
    }
  } catch (e) { /* jamais bloquant */ }
}

// Même `window.__lpTrackContext` que trackPublicEvent ci-dessus, réutilisé ici pour porter l'AdReel
// d'origine sur les liens vers pack.html générés depuis un AdReel (bouton "Retour" dynamique du pack —
// voir pack.html) : un pack intégré dans plusieurs AdReels différents doit renvoyer vers celui par
// lequel le visiteur est réellement arrivé, pas vers un `linkedAdReelId` fixe configuré une fois pour
// toutes en backstage.
//
// `u` (handle du compositeur) ajouté le 4 septembre, trouvé manquant en corrigeant le bouton
// "Retour" de pack.html : sans lui, le lien généré depuis l'AdReel d'un compositeur non-défaut
// (`?u=<handle>`) perdait cette identité au clic sur un pack -- pack.html serait retombé sur
// DEFAULT_OWNER_ID (le compte de Jules-Antoine) faute de handle, exactement le même bug que celui
// documenté dans docs/infrastructure.md pour les liens "← Retour" génériques. `location.search` ici
// reflète l'URL de la page qui a chargé player.js (index.html), pas un contexte propre à ce fichier.
function adReelFromParam() {
  const ctx = window.__lpTrackContext || {};
  if (ctx.type !== 'adreel' || !ctx.id) return '';
  const handle = new URLSearchParams(location.search).get('u');
  return `&from=${encodeURIComponent(ctx.id)}` + (handle ? `&u=${encodeURIComponent(handle)}` : '');
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
// Style de forme d'onde (Chantier Apparence, palier Pro, 05/09) : réglage global par compositeur (pas
// par bloc, pas par AdReel), résolu une fois par la page hôte (index.html/pack.html/collection.html,
// palier Pro effectif + réglage global du compositeur) et imposé via setWaveformStyle() avant tout rendu
// de piste -- même principe que setLang() ci-dessus. Free/Starter n'appellent jamais cette fonction avec
// autre chose que 'bars' (voir resolveEffectiveWaveformStyle plus bas pour le repli d'espace, séparé).
const WAVEFORM_STYLES = ['bars', 'mirror', 'dots', 'layers'];
let CURRENT_WAVEFORM_STYLE = 'bars';
function setWaveformStyle(style) { CURRENT_WAVEFORM_STYLE = WAVEFORM_STYLES.includes(style) ? style : 'bars'; }
function currentWaveformStyle() { return CURRENT_WAVEFORM_STYLE; }
// Thème (Clair/Sombre) de la carte des chemins (Chantier Apparence, palier Pro, 06/09) : même principe
// que le style de forme d'onde ci-dessus -- réglage global par compositeur, résolu une fois par la page
// hôte et imposé via setSeqMapTheme() avant tout rendu de piste séquentielle. Free/Starter n'appellent
// jamais cette fonction avec autre chose que 'light'.
const SEQ_MAP_THEMES = ['light', 'dark'];
let CURRENT_SEQ_MAP_THEME = 'light';
function setSeqMapTheme(theme) { CURRENT_SEQ_MAP_THEME = SEQ_MAP_THEMES.includes(theme) ? theme : 'light'; }
function currentSeqMapTheme() { return CURRENT_SEQ_MAP_THEME; }
// Densité de la carte des chemins (10/09, retour direct : la maquette montrée était "agréable à
// regarder", le vrai composant "tristounet" en comparaison) -- PAS un réglage de palier (contrairement
// au thème ci-dessus) : un simple choix de mise en page par TYPE de page, posé une fois par la page
// hôte avant tout rendu. 'compact' (par défaut, comportement historique) n'est plus utilisé par le
// Backstage depuis le 24/09 (grille jugée « toute moche » dans l'aperçu : il prend 'roomy' comme les pages
// publiques, la carte se réduisant seule à la largeur du panneau). 'roomy' (pages publiques) vise l'inverse : cartes nettement plus
// grandes et aérées, quitte à afficher moins d'étapes d'un coup d'œil -- voir updateSeqMap() pour le
// calcul de taille, qui devient sensible à la largeur réelle disponible en mode 'roomy' (pas seulement
// au nombre d'emplacements comme en 'compact').
const SEQ_MAP_DENSITIES = ['compact', 'roomy'];
let CURRENT_SEQ_MAP_DENSITY = 'compact';
function setSeqMapDensity(density) { CURRENT_SEQ_MAP_DENSITY = SEQ_MAP_DENSITIES.includes(density) ? density : 'compact'; }
function currentSeqMapDensity() { return CURRENT_SEQ_MAP_DENSITY; }
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
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
// Nombre de colonnes calculé à partir de la largeur réellement affichée plutôt qu'un nombre fixe choisi
// à l'aveugle : trop grossier sur un grand format (waveform statique pleine largeur), ou au contraire
// plus de colonnes que de pixels physiques disponibles sur un petit format (nœud du graphe
// vertical-random). Miroir plein/Vagues superposées (styles "lissés") visent un contour continu plutôt
// que des colonnes visibles : ils ont besoin d'un pas bien plus fin que Barres/Pointillé pour ne pas
// paraître anguleux une fois lissés au dessin (voir traceSmoothCurveThrough plus bas) — computeWaveformPeaks
// n'a pas besoin de changer pour ça, seul le bucketCount qu'on lui demande diffère selon le style.
const WAVEFORM_BAR_PITCH_PX = 4; // largeur colonne + espace visés, en px CSS (Barres/Pointillé)
const WAVEFORM_SMOOTH_PITCH_PX = 1.5; // pas visé, en px CSS (Miroir plein/Vagues superposées)
function bucketCountForWidth(cssWidthPx, style) {
  const smooth = style === 'mirror' || style === 'layers';
  const pitch = smooth ? WAVEFORM_SMOOTH_PITCH_PX : WAVEFORM_BAR_PITCH_PX;
  const maxBuckets = smooth ? 800 : 320;
  return Math.max(24, Math.min(maxBuckets, Math.round(cssWidthPx / pitch)));
}
// Style Barres (existant depuis toujours, jamais renommé côté appelants) : reste le style par défaut et
// le repli de tous les autres — aucune régression pour les AdReels déjà publiés qui n'auront pas choisi
// de style explicitement (voir resolveEffectiveWaveformStyle).
function drawBarsWaveform(canvas, peaks, color) {
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
// Style Pointillé : chaque colonne devient une pile de petits points de part et d'autre de l'axe
// central, leur nombre reflétant l'intensité — plutôt qu'un rectangle plein. Même grille de colonnes que
// Barres (slot), donc tout aussi lisible aux petits formats (pas de seuil de repli, contrairement à
// Miroir plein/Vagues superposées ci-dessous).
function drawDotsWaveform(canvas, peaks, color) {
  if (!canvas || !peaks) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (w < 2 || h < 2) return;
  canvas.width = w; canvas.height = h;
  const c2d = canvas.getContext('2d');
  c2d.clearRect(0, 0, w, h);
  c2d.fillStyle = color;
  const colCount = peaks.length;
  const slot = w / colCount;
  const mid = h / 2;
  const dotRadius = Math.max(1, Math.min(slot * 0.28, 2.2 * dpr));
  const dotPitch = dotRadius * 2.4; // espace entre centres de deux points empilés successifs
  const maxDots = Math.max(1, Math.floor(mid / dotPitch));
  for (let i = 0; i < colCount; i++) {
    const amp = Math.max(0.04, peaks[i]);
    const count = Math.max(1, Math.round(amp * maxDots));
    const x = i * slot + slot / 2;
    for (let d = 0; d < count; d++) {
      const offset = (d + 0.5) * dotPitch;
      c2d.beginPath(); c2d.arc(x, mid - offset, dotRadius, 0, Math.PI * 2); c2d.fill();
      c2d.beginPath(); c2d.arc(x, mid + offset, dotRadius, 0, Math.PI * 2); c2d.fill();
    }
  }
}
// Trace une courbe lissée à travers `pts` (au moins 2 points), en supposant que le point courant du
// tracé est déjà pts[0] (le moveTo/lineTo initial reste à la charge de l'appelant) — partagé entre
// Miroir plein et Vagues superposées, qui construisent des polygones différents autour de la même
// technique de lissage (courbe quadratique passant par le milieu de chaque paire de points consécutifs).
function traceSmoothCurveThrough(c2d, pts) {
  const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    c2d.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
  }
  if (n > 1) c2d.quadraticCurveTo(pts[n - 2].x, pts[n - 2].y, pts[n - 1].x, pts[n - 1].y);
}
// Style Miroir plein : contour plein et continu, symétrique au-dessus/en dessous de l'axe central (rendu
// classique des DAW pro). h - y donne exactement le point miroir d'un point (x, y) puisque l'axe central
// est à h/2 — pas besoin de recalculer une seconde courbe, juste de réutiliser celle du haut retournée.
function drawMirrorWaveform(canvas, peaks, color) {
  if (!canvas || !peaks || peaks.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (w < 2 || h < 2) return;
  canvas.width = w; canvas.height = h;
  const c2d = canvas.getContext('2d');
  c2d.clearRect(0, 0, w, h);
  const mid = h / 2;
  const n = peaks.length;
  const top = peaks.map((v, i) => ({ x: (i / (n - 1)) * w, y: mid - (Math.max(0.04, v) * h) / 2 }));
  // Même contour reflété sous l'axe central, parcouru de droite à gauche pour fermer le tracé sans lever
  // le stylet : bottom[0] tombe verticalement sous top[n-1] (fin du haut), bottom[n-1] sous top[0].
  const bottom = top.map(p => ({ x: p.x, y: h - p.y })).reverse();
  c2d.fillStyle = color;
  c2d.beginPath();
  c2d.moveTo(top[0].x, top[0].y);
  traceSmoothCurveThrough(c2d, top);
  c2d.lineTo(bottom[0].x, bottom[0].y);
  traceSmoothCurveThrough(c2d, bottom);
  c2d.closePath();
  c2d.fill();
}
// Style Vagues superposées ("Layers") : plusieurs courbes arrondies semi-transparentes empilées, chacune
// une version réduite des mêmes pics (pas de hasard/bruit ajouté — dérivées des pics réels, comme les
// trois autres styles). Une seule couleur reçue (voir en-tête de fichier drawWaveformCanvas) : la
// distinction entre couches se fait par opacité (globalAlpha), jamais par teinte, pour rester compatible
// avec les couleurs "jouée"/"à jouer" par élément (chantier séparé) quel que soit celui codé en premier.
function drawLayersWaveform(canvas, peaks, color) {
  if (!canvas || !peaks || peaks.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (w < 2 || h < 2) return;
  canvas.width = w; canvas.height = h;
  const c2d = canvas.getContext('2d');
  c2d.clearRect(0, 0, w, h);
  const n = peaks.length;
  const layers = [
    { scale: 0.55, baseline: h * 0.92, alpha: 0.35 },
    { scale: 0.78, baseline: h * 0.85, alpha: 0.55 },
    { scale: 1.00, baseline: h * 0.78, alpha: 0.90 }
  ];
  c2d.fillStyle = color;
  layers.forEach(layer => {
    const top = peaks.map((v, i) => {
      const amp = Math.max(0.04, v) * layer.scale;
      return { x: (i / (n - 1)) * w, y: layer.baseline - amp * layer.baseline };
    });
    c2d.globalAlpha = layer.alpha;
    c2d.beginPath();
    c2d.moveTo(top[0].x, layer.baseline);
    c2d.lineTo(top[0].x, top[0].y);
    traceSmoothCurveThrough(c2d, top);
    c2d.lineTo(top[n - 1].x, layer.baseline);
    c2d.closePath();
    c2d.fill();
  });
  c2d.globalAlpha = 1;
}
const WAVEFORM_DRAWERS = { bars: drawBarsWaveform, mirror: drawMirrorWaveform, dots: drawDotsWaveform, layers: drawLayersWaveform };
// Hauteur CSS (px) en dessous de laquelle Miroir plein/Vagues superposées redeviennent illisibles (contour
// trop fin, courbes qui se chevauchent) : repli silencieux sur Barres plutôt qu'un rendu cassé dans un
// petit espace. Barres/Pointillé n'ont pas ce problème (même grille de colonnes aux deux tailles) et ne
// sont jamais repliés. Seuil choisi en observant les hauteurs réellement utilisées par le lecteur (voir
// docs/LAYERPITCH_CHANGELOG.md) : le plancher des boutons de boucle en embranchement-vertical (20px, 5-7
// boucles) et le nœud vertical-random (30px) tombent sous ce seuil ; le bloc séquentiel (34px) et les
// lecteurs principal/Sfx (40-44px) restent au-dessus.
const WAVEFORM_TALL_STYLE_MIN_HEIGHT_CSS_PX = 32;
const WAVEFORM_TALL_STYLES = new Set(['mirror', 'layers']);
// Pure (ne touche à aucun canvas) : résout le style réellement à dessiner pour une hauteur donnée, en
// appliquant le repli d'espace ci-dessus. Exportée séparément pour rester testable sans canvas réel.
function resolveEffectiveWaveformStyle(style, heightCssPx) {
  const requested = WAVEFORM_DRAWERS[style] ? style : 'bars';
  if (WAVEFORM_TALL_STYLES.has(requested) && heightCssPx > 0 && heightCssPx < WAVEFORM_TALL_STYLE_MIN_HEIGHT_CSS_PX) return 'bars';
  return requested;
}
function drawWaveformCanvas(canvas, peaks, color, style) {
  if (!canvas || !peaks) return;
  const heightCssPx = canvas.getBoundingClientRect().height;
  const effectiveStyle = resolveEffectiveWaveformStyle(style, heightCssPx);
  (WAVEFORM_DRAWERS[effectiveStyle] || drawBarsWaveform)(canvas, peaks, color);
}
// Point d'entrée commun : mesure la largeur une seule fois (bg/fg partagent la même taille), calcule les
// pics une seule fois pour les deux calques plutôt que de dupliquer le travail. Style lu depuis
// currentWaveformStyle() (réglage global imposé par la page hôte via setWaveformStyle()) -- aucun appelant
// n'a besoin de connaître le style choisi, exactement comme aucun n'a besoin de connaître la langue.
function renderWaveformPair(bgCanvas, fgCanvas, buffer, bgColor, fgColor, maxDurationSec) {
  if (!buffer) return;
  const refCanvas = bgCanvas || fgCanvas;
  if (!refCanvas) return;
  const cssWidth = refCanvas.getBoundingClientRect().width;
  if (cssWidth < 2) return;
  const style = currentWaveformStyle();
  const peaks = computeWaveformPeaks(buffer, bucketCountForWidth(cssWidth, style), maxDurationSec);
  if (bgCanvas) drawWaveformCanvas(bgCanvas, peaks, bgColor, style);
  if (fgCanvas) drawWaveformCanvas(fgCanvas, peaks, fgColor, style);
}

/* ---------------- État partagé entre toutes les pistes de la page (une seule instance par page chargée) ---------------- */
const trackCollapsers = {};
const trackStingerKillers = {};
let activeTrackId = null;

/* ---------------- Constantes de volume partagées avec le rendu hors-ligne (outil vidéo, 25/09) ----------------
 * Le rendu d'une capture reproduit les mêmes rampes que le lecteur : elles vivent ici, une seule fois. */
// Ducking : abaisse brièvement le gain maître du morceau pendant qu'un Sfx réglé pour ça est en train de jouer, puis
// remonte. Baisse plafonnée à 30 % (DUCK_LEVEL = 0.7) : descente rapide et nette, remontée qui démarre dès la moitié
// du Sfx et s'étale sur une rampe longue.
const DUCK_ATTACK_SEC = 0.08;
const DUCK_RELEASE_SEC = 1.2;
const DUCK_LEVEL = 0.7;
const INTENSITY_RAMP_SEC = 1.4; // changement d'intensité (mode vertical)
const VOICE_RAMP_SEC = 0.15; // muet / solo / volume d'une voix
// Départ d'un moteur (lecture, reprise, saut, nouveau tirage) : TOUTES ses voix sont programmées sur un même instant, un
// peu après l'appui (25/09). Lancées « maintenant » une par une, elles partaient en fait décalées de quelques ms entre
// elles (le temps de préparer les suivantes, l'horloge audio avançait : léger flou rythmique au démarrage).
const ENGINE_START_LEAD_SEC = 0.03;
function startSoon() { return ctx.currentTime + ENGINE_START_LEAD_SEC; }
const SFX_START_LEAD_SEC = 0.02; // départ d'un Sfx de morceau : instant précis, juste après l'appui (voir le bouton Sfx)
const EMBR_CROSSFADE_SEC = 0.15; // repli par défaut ("fade" standard, sans réglage personnalisé) -- même durée que les voix
// Durée de fondu à utiliser pour la bascule VERS une boucle d'embranchement (24/08). "hard" = coupure nette (0s,
// aucune rampe) ; "custom" = valeur réglée sur cette boucle précise ; "fade" (par défaut) ou réglage absent =
// EMBR_CROSSFADE_SEC.
function embrCutFadeSec(loopDef) {
  if (!loopDef) return EMBR_CROSSFADE_SEC;
  if (loopDef.cutStyle === 'hard') return 0;
  if (loopDef.cutStyle === 'custom') return loopDef.customCutFadeSec != null ? loopDef.customCutFadeSec : EMBR_CROSSFADE_SEC;
  return EMBR_CROSSFADE_SEC;
}

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

// Style des boutons de triggers d'effets, injecté une seule fois par le lecteur lui-même plutôt que copié
// dans index.html/pack.html/collection.html (chacun a sa propre feuille de style, déjà dupliquée) -- ne
// s'appuie que sur les variables CSS déjà définies par toutes les pages hôtes (--accent, --border...).
function ensureFxTriggerStyle() {
  if (document.getElementById('lp-fx-trigger-style')) return;
  const st = document.createElement('style');
  st.id = 'lp-fx-trigger-style';
  st.textContent = `
    .fx-trigger-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .fx-trigger-btn { font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 6px 12px; border-radius: 999px;
      border: 1px solid var(--border, #ccc); background: transparent; color: var(--text-dim, #555); cursor: pointer; }
    .fx-trigger-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .fx-trigger-btn.active { background: var(--accent); border-color: var(--accent); color: var(--bg, #fff); }
    .fx-trigger-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .fx-trigger-btn.fx-locked { opacity: 0.4; cursor: not-allowed; border-style: dashed; }
    .fx-slider-row { display: flex; flex-direction: column; gap: 8px; }
    .fx-slider { display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-dim, #555); }
    .fx-slider span { min-width: 110px; }
    .fx-slider input[type=range] { flex: 1; max-width: 260px; accent-color: var(--accent); }
    .fx-slider input[type=range]:disabled { opacity: 0.4; }
    .fx-slider output { min-width: 3.2em; text-align: right; }
  `;
  document.head.appendChild(st);
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
  if (isSequential && supported && (track.segmentSlots || []).length > 1) {
    seqMapHtml = `
      <div class="seq-map${currentSeqMapTheme() === 'dark' ? ' seq-map-dark' : ''}${currentSeqMapDensity() === 'roomy' ? ' seq-map-roomy' : ''}" data-role="seqMap">
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

  // Boutons de triggers d'effets (23/09) : uniquement ceux que le compositeur a choisi d'exposer (visible),
  // ou tous dans l'aperçu du Backstage (seqMapFullReveal, même drapeau que la carte des chemins) pour qu'il
  // puisse les essayer avant de les publier. Désactivés jusqu'à ce que la ligne soit dépliée et prête
  // (même règle que les boutons Sfx, voir setStingerButtonsEnabled). Un trigger sans cible valide n'apparaît pas.
  let fxTriggersHtml = '';
  const publicFxTriggers = supported ? (track.fxTriggers || []).filter(d => d && d.id && d.fx && d.target && (d.visible || track.seqMapFullReveal)) : [];
  if (publicFxTriggers.length) {
    ensureFxTriggerStyle();
    fxTriggersHtml = `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('fxTriggersRowLabel')}</div>
        <div class="fx-trigger-row">
          ${publicFxTriggers.map((d, i) => `<button type="button" class="fx-trigger-btn" data-fx-trigger="${escapeHtml(d.id)}" aria-pressed="false" disabled>${escapeHtml(d.label || t('fxTriggerFallbackLabel', { n: i + 1 }))}</button>`).join('')}
        </div>
      </div>
    `;
  }

  // Curseurs de paramètre (24/09) : même règle de visibilité que les boutons d'effet (visible, ou tous dans l'aperçu
  // du Backstage), désactivés jusqu'à ce que la ligne soit prête.
  const publicFxSliders = supported ? fxSlidersValid(track).filter(sl => sl.visible || track.seqMapFullReveal) : [];
  if (publicFxSliders.length) {
    ensureFxTriggerStyle();
    fxTriggersHtml += `
      <div class="track-intensity-block">
        <div class="track-intensity-label">${t('fxSlidersRowLabel')}</div>
        <div class="fx-slider-row">
          ${publicFxSliders.map((sl, i) => `<label class="fx-slider"><span>${escapeHtml(sl.label || t('fxSliderFallbackLabel', { n: i + 1 }))}</span><input type="range" min="0" max="100" step="1" value="${Math.round(sl.def * 100)}" data-fx-slider="${escapeHtml(sl.id)}" disabled><output>${Math.round(sl.def * 100)}%</output></label>`).join('')}
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
      ${track.tags ? `<div class="track-tags">${track.tags.split(',').map(s => s.trim()).filter(Boolean).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      ${packsForTrack && packsForTrack.length ? `<div class="pack-link">${packsForTrack.map(p => `<a href="./pack.html?id=${encodeURIComponent(p.id)}${adReelFromParam()}">${t('partOfPack', { title: escapeHtml(p.title) })}</a>`).join('<br>')}</div>` : ''}
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
            <div class="progress-track" data-role="progressTrack"></div>
            <div class="progress-fill" data-role="progressFill"></div>
            <div class="progress-head" data-role="progressHead"></div>
          `}
        </div>
        <div class="time-row"><span data-role="timeCurrent">0:00</span><span data-role="timeTotal">${formatTime(displayMaxSec)}</span></div>
        ${(track.sfxIds && track.sfxIds.length) ? `
          <div class="track-intensity-block">
            <div class="track-intensity-label">${t('sfxRowLabel')}</div>
            <div class="track-sfx-row">
              ${track.sfxIds.map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean).map((sfx, i) => `<button class="stinger-btn" data-stinger="${i}" data-sfx-id="${sfx.id}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml((track.sfxLabelOverrides && track.sfxLabelOverrides[sfx.id]) || sfx.title || ('Sfx ' + (i + 1)))}</button>`).join('')}
            </div>
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
      ${fxTriggersHtml}
      ${(isSequential || isVerticalRandom || isEmbrVert) && track.sfxIds && track.sfxIds.length ? `
        <div class="track-intensity-block">
          <div class="track-intensity-label">${t('sfxRowLabel')}</div>
          <div class="track-sfx-row">
            ${track.sfxIds.map(id => SFX_LIBRARY_BY_ID[id]).filter(Boolean).map((sfx, i) => `<button class="stinger-btn" data-stinger="${i}" data-sfx-id="${sfx.id}" disabled><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${escapeHtml((track.sfxLabelOverrides && track.sfxLabelOverrides[sfx.id]) || sfx.title || ('Sfx ' + (i + 1)))}</button>`).join('')}
          </div>
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

// Résout la paire de couleurs bg/fg à utiliser pour la forme d'onde d'un morceau, à partir d'un éventuel
// réglage par élément (Chantier Apparence, palier Pro, réglage par élément, 05/09) -- pure (aucun DOM/
// canvas), donc testable directement sans les limites de jsdom sur le rendu canvas réel. Repli sur les
// couleurs générales existantes (cssVar) si non réglé, exactement comme avant ce chantier -- compatible
// avec N'IMPORTE QUEL style choisi par ailleurs (Chantier Apparence "style de forme d'onde") puisqu'un
// style ne fait jamais que redessiner avec la couleur reçue, quelle qu'elle soit.
function resolveWaveformColors(elementColors) {
  return {
    bg: (elementColors && elementColors.waveform && elementColors.waveform.unplayedColor) || cssVar('--border', '#ccc'),
    fg: (elementColors && elementColors.waveform && elementColors.waveform.playedColor) || cssVar('--accent', '#c9713c')
  };
}
// ---- Effets par couche (filtre/reverb/écho/bitcrusher) — chantier "effets dynamiques" (22/09) ----
// Réglages fixes posés par le compositeur (layer.fx dans data.json/Postgres), pas encore automatisés ni
// déclenchables en direct — ça viendra dans un second temps (cascades de triggers, cf. discussion
// produit), qui réutilisera cette même chaîne plutôt que d'en construire une autre. buildLayerFxChain
// renvoie { input, output, nodes } avec des références NOMMÉES à chaque nœud créé (nodes.lowcut, nodes.highcut,
// nodes.delay, ...) plutôt que des closures anonymes : ça ne sert à rien aujourd'hui, mais évite une
// réécriture le jour où un contrôle en direct (ex. depuis un futur Espace Projet) devra retrouver ces
// nœuds pour les piloter plutôt que reconstruire toute la chaîne.
const _impulseResponseCache = new Map();
function getOrBuildImpulseResponse(ctx, decaySeconds) {
  const decay = Math.min(Math.max(decaySeconds || 2, 0.1), 10);
  const key = ctx.sampleRate + ':' + decay;
  if (_impulseResponseCache.has(key)) return _impulseResponseCache.get(key);
  // Reverb synthétique (bruit blanc + décroissance exponentielle) plutôt qu'un fichier de réponse
  // impulsionnelle à héberger : évite d'ajouter un nouveau type d'asset/upload pour ce chantier, qualité
  // suffisante pour l'usage démo/pitch visé ici.
  // Bruit TIRÉ D'UNE GRAINE fixe (25/09) plutôt que Math.random() : même réponse à chaque chargement et dans le rendu
  // hors-ligne d'une version figée, qui retrouve ainsi exactement la reverb entendue (même texture de bruit).
  const length = Math.max(1, Math.floor(ctx.sampleRate * decay));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rand = mulberry32((key + ':' + ch).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
    for (let i = 0; i < length; i++) data[i] = (rand() * 2 - 1) * Math.pow(1 - i / length, 2);
  }
  _impulseResponseCache.set(key, buffer);
  return buffer;
}
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
// ---- Aides pour le rendu hors-ligne (outil vidéo "Test in game", 23/09) ----
// Mêmes règles que initTrackPlayer (registre de triggers) mais sans état vivant : l'export rejoue une prise
// enregistrée sur un OfflineAudioContext en réutilisant EXACTEMENT les mêmes chaînes d'effets et la même
// fusion des triggers que le lecteur -- c'est ce qui garantit que le son exporté est celui qu'on teste en jeu.
function fxTargetKeyFromTarget(target) {
  if (!target) return null;
  // 'track' (24/09, décision de Jules-Antoine) : le trigger / la liaison agit sur TOUT le morceau, quelle que soit la
  // section ou le moment -- plus de bouton « par section » (usine à gaz). Les cibles précises (couche, boucle,
  // emplacement, pool) restent comprises pour les données déjà créées, mais l'éditeur ne les propose plus.
  if (target.type === 'track') return 'track';
  if (target.type === 'layer') return 'layer:' + (target.li || 0);
  if (target.type === 'loop') return 'loop:' + target.li;
  if (target.type === 'slot') return 'slot:' + target.si;
  if (target.type === 'pool') return 'pool:' + target.si + ':' + target.pi;
  return null;
}
// fx de base porté par une cible ('layer:i', 'loop:i', 'slot:i', 'pool:s:p', 'intro', 'outro') -- même
// source que les buildTargetFxChain de initTrackPlayer.
function baseFxForTarget(track, key) {
  if (!track || !key) return null;
  const p = key.split(':');
  if (p[0] === 'layer') { const l = (track.layers || [])[+p[1]]; return l && l.fx || null; }
  if (p[0] === 'loop') { const l = (track.loops || [])[+p[1]]; return l && l.fx || null; }
  if (p[0] === 'slot') { const l = (track.segmentSlots || [])[+p[1]]; return l && l.fx || null; }
  if (p[0] === 'pool') { const sec = (track.sections || [])[+p[1]]; const pl = sec && (sec.pools || [])[+p[2]]; return pl && pl.fx || null; }
  if (p[0] === 'intro') return track.intro && track.intro.fx || null;
  if (p[0] === 'outro') return track.outro && track.outro.fx || null;
  return null;
}
// Fusion d'un fx de base avec les triggers ACTIFS de sa cible, dans l'ordre d'activation (le dernier activé
// l'emporte, clé par clé).
function mergeTriggerFx(baseFx, activeTriggerDefs) {
  const out = baseFx ? Object.assign({}, baseFx) : {};
  (activeTriggerDefs || []).forEach(d => { Object.keys(d.fx || {}).forEach(k => { out[k] = Object.assign({}, out[k], d.fx[k]); }); });
  return out;
}
// ---- Règles entre triggers (24/09) ----
// trigger.relations = { activates:[{triggerId, delaySec}], cuts:[triggerId], requires:[triggerId], autoOffSec }.
//   Active aussi (cascade) : quand ce trigger s'active, les triggers listés s'activent à leur tour, chacun après
//     son délai ; quand il se coupe, ceux qu'il avait activés se coupent (sauf s'ils ont été repris à la main).
//   Coupe (exclusion)      : quand ce trigger s'active, les triggers listés sont coupés.
//   Nécessite (condition)  : ce trigger ne peut être activé QUE tant que les triggers listés sont actifs ; si l'un
//     d'eux se coupe, celui-ci se coupe aussi. Ne bride que le VISITEUR (source 'visitor') : une bascule ou une
//     cascade -- décisions du compositeur -- passe outre.
//   Se coupe seul : autoOffSec secondes après son activation.
// Fonction PURE : ne connaît ni l'audio ni l'horloge. Le lecteur lui fournit un vrai temps (setTimeout) et applique
// les effets dans hooks.apply ; l'outil vidéo lui fournit un temps SIMULÉ (simulateTriggerRules) pour que le son
// exporté suive exactement les mêmes règles qu'en jeu.
// hooks : { schedule(delaySec, fn) -> handle, cancel(handle), apply(id, active, cause) }
function createTriggerRuleEngine(defs, hooks) {
  const byId = new Map();
  (defs || []).forEach(d => { if (d && d.id) byId.set(d.id, d); });
  const active = [];             // dans l'ordre d'activation
  const cascadedBy = new Map();  // id -> Set des triggers dont la cascade le maintient actif
  const timers = new Map();      // id -> [handles] (coupure auto + cascades en attente ÉMISES par id)
  let depth = 0;
  const rel = id => (byId.get(id) && byId.get(id).relations) || {};
  const isActive = id => active.indexOf(id) >= 0;
  const requiresMet = id => (rel(id).requires || []).every(r => isActive(r));
  function addTimer(owner, h) { (timers.get(owner) || timers.set(owner, []).get(owner)).push(h); }
  function clearTimers(owner) { (timers.get(owner) || []).forEach(h => hooks.cancel(h)); timers.delete(owner); }
  function activate(id, source) {
    if (isActive(id) || depth > 25) return; // 25 : garde-fou contre une boucle de cascades mal configurée
    depth++;
    active.push(id);
    hooks.apply(id, true, source);
    const r = rel(id);
    (r.cuts || []).forEach(x => { if (x !== id && isActive(x)) deactivate(x, 'cut'); });
    (r.activates || []).forEach(a => {
      if (!a || a.triggerId === id || !byId.has(a.triggerId)) return;
      const fire = () => {
        if (!isActive(id)) return; // la source s'est coupée avant l'échéance : la cascade n'a plus lieu
        if (isActive(a.triggerId)) return; // déjà actif (à la main) : reste indépendant de cette cascade
        let set = cascadedBy.get(a.triggerId);
        if (!set) { set = new Set(); cascadedBy.set(a.triggerId, set); }
        set.add(id);
        activate(a.triggerId, 'cascade');
      };
      const d = +a.delaySec > 0 ? +a.delaySec : 0;
      if (d > 0) addTimer(id, hooks.schedule(d, fire)); else fire();
    });
    if (+r.autoOffSec > 0) addTimer(id, hooks.schedule(+r.autoOffSec, () => { if (isActive(id)) deactivate(id, 'auto'); }));
    depth--;
  }
  function deactivate(id, cause) {
    const i = active.indexOf(id);
    if (i < 0) return;
    active.splice(i, 1);
    clearTimers(id);
    cascadedBy.delete(id);
    hooks.apply(id, false, cause);
    (rel(id).activates || []).forEach(a => {
      const set = a && cascadedBy.get(a.triggerId);
      if (set && set.has(id)) {
        set.delete(id);
        if (!set.size) { cascadedBy.delete(a.triggerId); if (isActive(a.triggerId)) deactivate(a.triggerId, 'cascade-off'); }
      }
    });
    active.slice().forEach(x => { if ((rel(x).requires || []).indexOf(id) >= 0) deactivate(x, 'requires-lost'); });
  }
  return {
    // source : 'visitor' (bouton public) | 'composer' (bascule) | 'cascade'. Renvoie false si la demande est refusée
    // (condition « Nécessite » non remplie pour un visiteur), true sinon (y compris si rien ne change).
    request(id, want, source) {
      if (!byId.has(id)) return false;
      source = source || 'composer';
      if (want) {
        if (isActive(id)) return true;
        if (source === 'visitor' && !requiresMet(id)) return false;
        cascadedBy.delete(id);
        activate(id, source);
      } else {
        if (!isActive(id)) return true;
        deactivate(id, source);
      }
      return true;
    },
    isActive,
    activeList: () => active.slice(),
    canActivate: id => isActive(id) || requiresMet(id),
    missingRequirements: id => (rel(id).requires || []).filter(r => !isActive(r)),
    reset() {
      [...timers.keys()].forEach(clearTimers);
      active.splice(0).forEach(id => hooks.apply(id, false, 'reset'));
      cascadedBy.clear();
    }
  };
}
// Rejoue une suite de demandes datées [{t, id, active, source}] avec un temps SIMULÉ (aucune horloge réelle) et
// renvoie tous les changements d'état résultants [{t, id, active}], cascades temporisées et coupures automatiques
// comprises. Utilisé par l'export de l'outil vidéo (capture-render.js).
function simulateTriggerRules(defs, requests) {
  const queue = [];
  let now = 0, seq = 0;
  const changes = [];
  const engine = createTriggerRuleEngine(defs, {
    schedule: (d, fn) => { const h = { t: now + d, fn, seq: seq++, dead: false }; queue.push(h); return h; },
    cancel: h => { h.dead = true; },
    apply: (id, on) => changes.push({ t: now, id, active: on })
  });
  (requests || []).forEach(r => queue.push({ t: r.t, seq: seq++, dead: false, fn: () => engine.request(r.id, r.active, r.source) }));
  while (queue.length) {
    queue.sort((a, b) => (a.t - b.t) || (a.seq - b.seq));
    const h = queue.shift();
    if (h.dead) continue;
    now = h.t;
    h.fn();
  }
  return changes;
}
// ---- Curseurs de paramètre (24/09) -- l'équivalent d'un RTPC de Wwise / d'un "game parameter" de FMOD ----
// track.fxSliders = [{ id, label, defaultValue (0..1), smoothSec, visible,
//   bindings:[{ target:{type,li|si|pi}, param:'highcut.frequency'|..., from, to }],
//   thresholds:[{ at (0..1), mode:'below'|'above', triggerId }] }]
// Un curseur public de 0 à 100 % : chaque liaison convertit sa valeur en un réglage d'effet sur une cible (couche,
// boucle, emplacement, pool) -- de `from` (curseur à 0) à `to` (curseur à 100 %), exponentiellement pour une
// fréquence -- et les seuils activent/coupent des triggers ("santé < 25 % => Low life"). Le réglage est LISSÉ (smoothSec,
// le « seek speed » de FMOD) : rien ne change brutalement. Fonctions pures, partagées avec l'export de l'outil vidéo.
const FX_SLIDER_PARAMS = {
  'lowcut.frequency': { fx: 'lowcut', key: 'frequency', log: true, min: 20, max: 20000 },
  'highcut.frequency': { fx: 'highcut', key: 'frequency', log: true, min: 20, max: 20000 },
  'volume.db': { fx: 'volume', key: 'db', min: -60, max: 12 },
  'reverb.wet': { fx: 'reverb', key: 'wet', min: 0, max: 1 },
  'delay.wet': { fx: 'delay', key: 'wet', min: 0, max: 1 },
  'delay.feedback': { fx: 'delay', key: 'feedback', min: 0, max: 0.9 },
  'bitcrush.bits': { fx: 'bitcrush', key: 'bits', min: 1, max: 16, round: true },
  'bitcrush.reduction': { fx: 'bitcrush', key: 'reduction', min: 1, max: 50, round: true },
  'pitch.semitones': { fx: 'pitch', key: 'semitones', min: -24, max: 24 },
  // Pitch en mode « vitesse » (25/09) : règle la vitesse de TOUT le morceau (change aussi la durée) -- pas un réglage de
  // chaîne d'effets par voix (rate:true) : il alimente le rapport de vitesse du lecteur, voir fxSliderRateSemitones.
  'pitch.speed': { fx: 'pitch', key: 'semitones', min: -24, max: 24, rate: true },
  // Paramètres de spatialisation d'un Sfx attaché au morceau (kind 'sfx' : la cible est un Sfx, pas une voix) --
  // position en mètres (x vers la droite, y vers l'avant), OU distance/angle polaires (0° = devant, +90° = à droite),
  // et niveau de reverb. Valables pour les Sfx à position fixe.
  'spatial.x': { kind: 'sfx', key: 'x', min: -50, max: 50 },
  'spatial.y': { kind: 'sfx', key: 'y', min: -50, max: 50 },
  'spatial.distance': { kind: 'sfx', key: 'distance', min: 0, max: 50 },
  'spatial.angle': { kind: 'sfx', key: 'angle', min: -180, max: 180 },
  'spatial.reverbDb': { kind: 'sfx', key: 'reverbDb', min: -18, max: 6 }
};
// Courbe libre d'une liaison (24/09) : points {x, y} de 0 à 1 -- x = position du curseur, y = avancement entre la
// valeur « à 0 % » et la valeur « à 100 % » -- reliés par des segments. Sans courbe : la droite (0,0) -> (1,1).
function fxCurveSanitize(raw) {
  if (!Array.isArray(raw)) return null;
  const c = v => Math.max(0, Math.min(1, +v));
  const pts = raw.filter(q => q && Number.isFinite(+q.x) && Number.isFinite(+q.y)).map(q => ({ x: c(q.x), y: c(q.y) })).sort((a, b) => a.x - b.x);
  if (pts.length < 2) return null;
  pts[0].x = 0; pts[pts.length - 1].x = 1; // les extrémités sont toujours aux bords du curseur
  return pts;
}
function fxCurveEval(curve, v) {
  if (!curve || curve.length < 2) return v;
  if (v <= curve[0].x) return curve[0].y;
  for (let i = 1; i < curve.length; i++) {
    if (v <= curve[i].x) {
      const a = curve[i - 1], b = curve[i], span = b.x - a.x;
      return span > 1e-9 ? a.y + (b.y - a.y) * (v - a.x) / span : b.y;
    }
  }
  return curve[curve.length - 1].y;
}
function fxSliderTargetKey(target) {
  if (target && target.type === 'sfx' && target.id) return 'sfx:' + target.id;
  return fxTargetKeyFromTarget(target);
}
// Valeurs par défaut des autres réglages d'un effet que le curseur fait apparaître sans qu'il soit configuré ailleurs.
const FX_SLIDER_DEFAULT_FX = { lowcut: { slope: 24 }, highcut: { slope: 24 }, reverb: { decay: 2 }, delay: { time: 0.3, feedback: 0.35 }, bitcrush: { bits: 16, reduction: 1 }, pitch: { mode: 'shift' }, volume: {} };
function fxSlidersValid(track) {
  const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0));
  return ((track && track.fxSliders) || []).filter(d => d && d.id).map(d => ({
    id: d.id, label: d.label || '', visible: !!d.visible,
    def: clamp01(d.defaultValue),
    smoothSec: Number.isFinite(+d.smoothSec) && +d.smoothSec >= 0 ? +d.smoothSec : 0.15,
    bindings: (d.bindings || []).filter(b => {
      if (!b || !FX_SLIDER_PARAMS[b.param] || !Number.isFinite(+b.from) || !Number.isFinite(+b.to)) return false;
      const key = fxSliderTargetKey(b.target);
      // Un paramètre de spatialisation ne se lie qu'à un Sfx, un paramètre d'effet qu'à une voix.
      return !!key && ((FX_SLIDER_PARAMS[b.param].kind === 'sfx') === (key.indexOf('sfx:') === 0));
    }).map(b => ({ key: fxSliderTargetKey(b.target), param: b.param, from: +b.from, to: +b.to, curve: fxCurveSanitize(b.curve) })),
    thresholds: (d.thresholds || []).filter(x => x && x.triggerId && Number.isFinite(+x.at)).map(x => ({ at: clamp01(x.at), mode: x.mode === 'above' ? 'above' : 'below', triggerId: x.triggerId }))
  })).filter(sl => sl.bindings.length || sl.thresholds.length);
}
function fxSliderBindingValue(b, v0) {
  const meta = FX_SLIDER_PARAMS[b.param];
  const v = b.curve ? fxCurveEval(b.curve, v0) : v0; // courbe libre éventuelle, puis interpolation from -> to
  let p = (meta.log && b.from > 0 && b.to > 0) ? b.from * Math.pow(b.to / b.from, v) : b.from + (b.to - b.from) * v;
  p = Math.max(meta.min, Math.min(meta.max, p));
  return meta.round ? Math.round(p) : p;
}
// Réglages imposés à UNE cible par les curseurs, valeurs = getter (id -> 0..1) : { effet: { paramètre: valeur } }.
function fxSliderOverrides(sliders, valueOf, targetKey) {
  const out = {};
  sliders.forEach(sl => sl.bindings.forEach(b => {
    if (b.key !== targetKey && b.key !== 'track') return; // une liaison « tout le morceau » vise chaque voix
    const meta = FX_SLIDER_PARAMS[b.param];
    if (meta.rate) return; // la vitesse du morceau n'est pas un réglage de voix
    (out[meta.fx] = out[meta.fx] || {})[meta.key] = fxSliderBindingValue(b, valueOf(sl.id));
  }));
  return out;
}
// Réglages imposés à UN Sfx par les curseurs : { x?, y?, distance?, angle?, reverbDb? } (null si aucune liaison).
function fxSliderSfxOverrides(sliders, valueOf, sfxId) {
  let out = null;
  sliders.forEach(sl => sl.bindings.forEach(b => {
    if (b.key !== 'sfx:' + sfxId) return;
    (out = out || {})[FX_SLIDER_PARAMS[b.param].key] = fxSliderBindingValue(b, valueOf(sl.id));
  }));
  return out;
}
// Position/reverb finales d'un Sfx : réglage de base + réglages des curseurs (cartésien d'abord, puis polaire).
function fxSpatialWithOverride(sp, ov) {
  const out = Object.assign({}, sp);
  if (!ov) return out;
  if (ov.x != null) out.x = ov.x;
  if (ov.y != null) out.y = ov.y;
  if (ov.distance != null || ov.angle != null) {
    const bx = +out.x || 0, by = +out.y || 0;
    const d = ov.distance != null ? ov.distance : Math.hypot(bx, by);
    const a = ov.angle != null ? ov.angle * Math.PI / 180 : Math.atan2(bx, by);
    out.x = d * Math.sin(a); out.y = d * Math.cos(a);
  }
  if (ov.reverbDb != null) out.reverbDb = ov.reverbDb;
  return out;
}
function fxSliderForceKeys(sliders, targetKey) {
  const keys = new Set();
  sliders.forEach(sl => sl.bindings.forEach(b => { if ((b.key === targetKey || b.key === 'track') && !FX_SLIDER_PARAMS[b.param].rate) keys.add(FX_SLIDER_PARAMS[b.param].fx); }));
  return [...keys];
}
// Vitesse du morceau imposée par les curseurs (25/09) : demi-tons de la dernière liaison « pitch.speed » sur tout le morceau,
// ou null si aucune. Fonction pure, partagée avec l'export de l'outil vidéo.
function fxSliderRateSemitones(sliders, valueOf) {
  let out = null;
  sliders.forEach(sl => sl.bindings.forEach(b => {
    if (b.key !== 'track' || !FX_SLIDER_PARAMS[b.param].rate) return;
    out = fxSliderBindingValue(b, valueOf(sl.id));
  }));
  return out;
}
// Rapport de vitesse EFFECTIF d'un morceau (25/09) : réglage de base (track.fx.pitch, mode « vitesse » implicite) ; par-dessus,
// les triggers actifs qui portent un pitch en mode « rate » (dans l'ordre d'activation, le dernier l'emporte) ; par-dessus, un
// curseur « pitch.speed ». activeDefs = définitions des triggers ACTIFS visant tout le morceau. Pure : le lecteur et l'export
// vidéo l'appellent avec leur propre état.
function fxTrackRatio(track, activeDefs, sliders, valueOf) {
  const base = track && track.fx && track.fx.pitch && track.fx.pitch.mode !== 'shift' ? track.fx.pitch : null;
  let st = base ? (base.semitones || 0) : 0, on = !!base;
  (activeDefs || []).forEach(d => { const q = d && d.fx && d.fx.pitch; if (q && q.mode === 'rate') { st = q.semitones || 0; on = true; } });
  const sv = sliders && sliders.length ? fxSliderRateSemitones(sliders, valueOf) : null;
  if (sv != null) { st = sv; on = true; }
  return on ? Math.pow(2, st / 12) : 1;
}
// Applique les réglages des curseurs PAR-DESSUS un fx déjà fusionné (base + triggers).
function applyFxSliderOverrides(fx, overrides) {
  const out = Object.assign({}, fx);
  Object.keys(overrides).forEach(k => { out[k] = Object.assign({}, FX_SLIDER_DEFAULT_FX[k], out[k], overrides[k]); });
  return out;
}
// État voulu des triggers reliés par les seuils d'un curseur pour la valeur v.
function fxSliderThresholdWants(sl, v) {
  return sl.thresholds.map(x => ({ triggerId: x.triggerId, want: x.mode === 'above' ? v >= x.at : v < x.at }));
}
// Un ScriptProcessorNode (bitcrusher ET pitch-shift "shift", chantier 2) continue de tourner tant qu'il
// reste connecté -- un seul point de nettoyage pour les deux plutôt que de dupliquer la même paire de
// lignes à chacun des neuf appels concernés (voir les commentaires "onended" plus bas dans ce fichier).
function disconnectLeakyFxNodes(fxChain) {
  if (!fxChain) return;
  if (fxChain.nodes.bitcrush) { try { fxChain.nodes.bitcrush.disconnect(); } catch (e) {} }
  if (fxChain.nodes.pitchShift) { try { fxChain.nodes.pitchShift.disconnect(); } catch (e) {} }
}
function fxChainHasLeakyNode(fxChain) {
  return !!(fxChain && (fxChain.nodes.bitcrush || fxChain.nodes.pitchShift));
}
function initTrackPlayer(track, wrapper, elementColors) {
  const { bg: waveBgColor, fg: waveFgColor } = resolveWaveformColors(elementColors);
  const isStatic = track.mode === 'static';
  const isVerticalRandom = track.mode === 'vertical-random';
  const isSequential = track.mode === 'sequential';
  const isEmbrVert = track.mode === 'embranchement-vertical';
  const supported = PLAYABLE_MODES.includes(track.mode);
  // Pitch "vitesse" (chantier 2, 22/09) — réglage de MORCEAU ENTIER, jamais par couche/boucle/emplacement/
  // pool : change la durée de lecture en plus de la hauteur, donc tout ce qui doit rester ensemble (couches
  // simultanées d'un vertical, boucles jumelles d'un embranchement-vertical, pools d'une même section)
  // doit bouger à EXACTEMENT la même vitesse, sous peine de dérive relative. Le pitch "traditionnel"
  // (fx.pitch.mode==='shift' porté par couche/boucle/emplacement/pool, voir buildLayerFxChain) ne change
  // pas la durée -- lui n'a pas ce problème, reste réglable indépendamment par élément.
  // Admin-only pour l'instant (voir fxBlockHtml, currentUserIsAdmin côté backstage) : correctif appliqué
  // aux boucles de planification "au fil de l'eau" des 4 moteurs (vérifié), PAS encore aux chemins de
  // reprise après pause/veille ni au seek pendant qu'un pitch est actif -- portée volontairement réduite
  // tant que ce n'est pas testé en conditions réelles, pas un oubli silencieux.
  // 25/09 : devenu VARIABLE -- un trigger ou un curseur peut changer la vitesse du morceau en cours de lecture (voir
  // refreshTrackRate plus bas). Les moteurs programmés le lisent à chaque génération : le changement s'applique à la prochaine
  // boucle / au prochain segment ; le moteur simple (bouclage natif) le suit en direct.
  const trackBaseRatio = (track.fx && track.fx.pitch && track.fx.pitch.mode !== 'shift') ? Math.pow(2, (track.fx.pitch.semitones || 0) / 12) : 1;
  let trackPitchRatio = trackBaseRatio;
  // Applique le pitch de morceau entier à UNE source -- appelé à chaque création de BufferSource, quel
  // que soit le moteur. No-op si aucun pitch actif (trackPitchRatio===1), donc sans coût pour l'immense
  // majorité des morceaux qui n'utilisent pas ce réglage.
  // allowFade : seul le moteur simple (bouclage natif, aucun planificateur JS) peut faire glisser le ratio
  // en cours de lecture. Les moteurs programmés recréent une source à chaque génération et calculent leurs
  // durées avec le ratio CIBLE : une rampe y recommencerait à chaque cycle et fausserait le minutage --
  // le fondu y est donc ignoré (ratio cible constant), voir trackPitchFxHtml() côté Backstage.
  function applyTrackPitchRate(src, startTime, allowFade) {
    if (trackPitchRatio === 1) return;
    const p = track.fx && track.fx.pitch || {};
    const when = startTime != null ? startTime : ctx.currentTime;
    if (allowFade && trackPitchRatio === trackBaseRatio && p.fadeFromSemitones != null && p.fadeDurationSec > 0) {
      src.playbackRate.setValueAtTime(Math.pow(2, p.fadeFromSemitones / 12), when);
      src.playbackRate.linearRampToValueAtTime(trackPitchRatio, when + p.fadeDurationSec);
    } else {
      src.playbackRate.value = trackPitchRatio;
    }
  }
  /* ---- Triggers d'effets (23/09) ----
     track.fxTriggers[] : { id, label, target:{type:'layer'|'loop'|'slot'|'pool', li|si|pi}, fx:{...},
     visible, fadeSec? }. Un trigger ACTIF fusionne son `fx` PAR-DESSUS celui de sa cible (clé par clé) ;
     inactif, la cible retrouve sa configuration de base. Deux façons de l'actionner : un bouton public
     (visible=true, choisi par le compositeur) ou une option de branchement / une boucle qui porte
     fxActions:[{triggerId, active}] (séquentiel : nextOptions[] ; embranchement-vertical : loops[]).
     Les chaînes d'effets vivantes de chaque cible sont tenues dans un registre pour pouvoir être
     modifiées EN DIRECT (applyFxToChain) -- seules les cibles visées par au moins un trigger y sont
     inscrites et construites avec tous les effets que ces triggers peuvent toucher (forceKeys), pour
     qu'aucune reconstruction ne soit jamais nécessaire en cours de lecture. */
  const fxTriggerDefs = new Map();
  const fxTriggerTargetKey = new Map();
  function fxTargetKeyOf(target) {
    if (!target) return null;
    if (target.type === 'track') return 'track';
    if (target.type === 'layer') return 'layer:' + (target.li || 0);
    if (target.type === 'loop') return 'loop:' + target.li;
    if (target.type === 'slot') return 'slot:' + target.si;
    if (target.type === 'pool') return 'pool:' + target.si + ':' + target.pi;
    return null;
  }
  (track.fxTriggers || []).forEach(d => {
    const key = d && d.id && d.fx ? fxTargetKeyOf(d.target) : null;
    if (key) { fxTriggerDefs.set(d.id, d); fxTriggerTargetKey.set(d.id, key); }
  });
  const fxActiveTriggerIds = []; // dans l'ordre d'activation : le dernier activé l'emporte sur un même paramètre
  const fxChainsByTarget = new Map();
  // Curseurs de paramètre (24/09) : leurs effets liés font partie des « clés forcées » (nœuds construits d'emblée) et
  // leurs valeurs s'appliquent PAR-DESSUS base + triggers.
  const fxSliders = fxSlidersValid(track);
  const fxSliderValues = new Map(fxSliders.map(sl => [sl.id, sl.def]));
  const fxSliderValueOf = id => (fxSliderValues.has(id) ? fxSliderValues.get(id) : 0);
  function fxForceKeysFor(targetKey) {
    const keys = new Set(fxSliderForceKeys(fxSliders, targetKey));
    fxTriggerDefs.forEach((d, id) => { const k = fxTriggerTargetKey.get(id); if (k === targetKey || k === 'track') Object.keys(d.fx).forEach(x => { if (x === 'pitch' && d.fx.pitch && d.fx.pitch.mode === 'rate') return; keys.add(x); }); });
    return [...keys];
  }
  // Chaînes vivantes concernées par une clé de cible : 'track' = TOUTES les voix du morceau.
  function fxChainsFor(key) {
    if (key !== 'track') return [...(fxChainsByTarget.get(key) || [])];
    const all = [];
    fxChainsByTarget.forEach(set => set.forEach(ch => all.push(ch)));
    return all;
  }
  function fxEffectiveFor(targetKey, baseFx) {
    let out = baseFx ? Object.assign({}, baseFx) : {};
    fxActiveTriggerIds.forEach(id => {
      const tk = fxTriggerTargetKey.get(id);
      if (tk !== targetKey && tk !== 'track') return;
      const d = fxTriggerDefs.get(id);
      Object.keys(d.fx).forEach(k => { out[k] = Object.assign({}, out[k], d.fx[k]); });
    });
    if (fxSliders.length) out = applyFxSliderOverrides(out, fxSliderOverrides(fxSliders, fxSliderValueOf, targetKey));
    return out;
  }
  // Compensation de latence (voir withLatencyComp) : calculée une fois par morceau.
  const fxNeedsComp = trackNeedsLatencyComp(track);
  // Journal de prise : la chaîne retient de quoi être reconstruite à l'identique au rendu (réglage de départ, effets
  // forcés, compensation de latence) et consignera chacun de ses changements (voir applyFxToChain).
  function journalChain(out, fx, force) {
    if (takeRecordingEnabled && out) { out.__lpMeta = { fx: fx ? JSON.parse(JSON.stringify(fx)) : null, force: force.slice(), comp: !!fxNeedsComp }; out.__lpFxLog = []; }
    return out;
  }
  function buildTargetFxChain(targetKey, baseFx, src, startTime) {
    const force = (fxTriggerDefs.size || fxSliders.length) ? fxForceKeysFor(targetKey) : [];
    if (!force.length) {
      const plain = buildLayerFxChain(ctx, baseFx, src, startTime);
      return journalChain(fxNeedsComp ? withLatencyComp(ctx, plain) : plain, baseFx, force);
    }
    const effective0 = fxEffectiveFor(targetKey, baseFx);
    const chain = buildLayerFxChain(ctx, effective0, src, startTime, undefined, force);
    if (chain) {
      chain.baseFx = baseFx; chain.targetKey = targetKey;
      let set = fxChainsByTarget.get(targetKey);
      if (!set) { set = new Set(); fxChainsByTarget.set(targetKey, set); }
      set.add(chain);
      // addEventListener (pas .onended) : plusieurs gestionnaires de fin coexistent déjà sur ces sources
      // (nettoyage du bitcrusher, marqueurs de fin de morceau) -- jamais d'écrasement possible.
      src.addEventListener('ended', () => { set.delete(chain); });
    }
    return journalChain(fxNeedsComp ? withLatencyComp(ctx, chain) : chain, effective0, force);
  }
  const fxTriggerBtns = [...wrapper.querySelectorAll('[data-fx-trigger]')];
  // Boutons : état enfoncé + état « bloqué » (condition « Nécessite » non remplie) -- grisé mais visible, avec en
  // infobulle ce qui le débloque. Recalculé après CHAQUE changement d'état, la condition d'un bouton dépendant de
  // l'état des autres.
  function updateFxTriggerButtons() {
    fxTriggerBtns.forEach(b => {
      const id = b.dataset.fxTrigger;
      const on = fxRules.isActive(id);
      const locked = !fxRules.canActivate(id);
      b.classList.toggle('active', on);
      b.classList.toggle('fx-locked', locked);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (locked) {
        b.setAttribute('aria-disabled', 'true');
        b.title = t('fxLockedHint', { names: fxRules.missingRequirements(id).map(r => (fxTriggerDefs.get(r) && fxTriggerDefs.get(r).label) || t('fxTriggerFallbackLabel', { n: [...fxTriggerDefs.keys()].indexOf(r) + 1 })).join(', ') });
      } else { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); }
    });
  }
  // Application d'un changement d'état DÉJÀ décidé par le moteur de règles (voir createTriggerRuleEngine) : met à jour
  // la liste des triggers actifs (ordre d'activation = priorité de fusion), reprogramme les chaînes vivantes.
  let fxRampOverride = null;
  function applyFxTriggerState(id, active) {
    const d = fxTriggerDefs.get(id);
    if (!d) return;
    const i = fxActiveTriggerIds.indexOf(id);
    if (active && i < 0) fxActiveTriggerIds.push(id);
    else if (!active && i >= 0) fxActiveTriggerIds.splice(i, 1);
    else return;
    const chains = fxChainsFor(fxTriggerTargetKey.get(id));
    // Fondu d'ENTRÉE (fadeSec) et fondu de SORTIE, au retour à la normale (fadeOutSec ; vide = même durée que l'entrée) --
    // demande de Jules-Antoine (24/09).
    const fadeIn = d.fadeSec != null ? d.fadeSec : 0.1;
    const ramp = fxRampOverride != null ? fxRampOverride : (active ? fadeIn : (d.fadeOutSec != null ? d.fadeOutSec : fadeIn));
    chains.forEach(ch => applyFxToChain(ctx, ch, fxEffectiveFor(ch.targetKey, ch.baseFx), ramp));
    refreshTrackRate(ramp);
    updateFxTriggerButtons();
  }
  // Vitesse du morceau (25/09) : recalculée après chaque changement de trigger ou de curseur (voir fxTrackRatio). Moteurs
  // programmés : seule la variable change -- chaque nouvelle génération (boucle / segment) la lira, les sons déjà programmés
  // gardent leur vitesse jusqu'au bout, donc tout reste synchrone. Moteur simple (bouclage natif) : les sources en cours
  // glissent vers la nouvelle vitesse et l'origine de la position est recalée pour que la tête de lecture ne saute pas.
  function fxComputeTrackRatio() {
    const defs = fxActiveTriggerIds.map(id => (fxTriggerTargetKey.get(id) === 'track' ? fxTriggerDefs.get(id) : null)).filter(Boolean);
    return fxTrackRatio(track, defs, fxSliders, fxSliderValueOf);
  }
  function refreshTrackRate(rampSec) {
    const next = fxComputeTrackRatio();
    if (!(next > 0) || Math.abs(next - trackPitchRatio) < 1e-9) return;
    const prev = trackPitchRatio;
    trackPitchRatio = next;
    const simple = !(useQuantizedLoop || isVerticalRandom || isSequential || isEmbrVert);
    if (!playing || !simple) return;
    const now = ctx.currentTime;
    startedAt = now - ((now - startedAt) * prev) / next;
    const tc = Math.max(0.005, (rampSec || 0.1) / 3);
    sources.forEach(sn => {
      if (!sn) return;
      sn.playbackRate.cancelScheduledValues(now);
      sn.playbackRate.setValueAtTime(sn.playbackRate.value, now);
      sn.playbackRate.setTargetAtTime(next, now, tc);
    });
  }
  const fxRules = createTriggerRuleEngine([...fxTriggerDefs.values()], {
    schedule: (d, fn) => setTimeout(fn, d * 1000),
    cancel: h => clearTimeout(h),
    apply: (id, active) => applyFxTriggerState(id, active)
  });
  function setFxTrigger(id, active, rampSec, source) {
    fxRampOverride = rampSec != null ? rampSec : null;
    try { return fxRules.request(id, active, source || 'composer'); } finally { fxRampOverride = null; }
  }
  // Activations liées à un embranchement (décision du compositeur) : passent par les mêmes règles (cascade,
  // exclusion, coupure auto) mais ne sont pas bridées par « Nécessite ».
  function applyFxActions(actions) {
    if (Array.isArray(actions)) actions.forEach(a => { if (a && a.triggerId) setFxTrigger(a.triggerId, a.active !== false, null, 'composer'); });
  }
  // Un vrai démarrage à froid repart de l'état de base : sans ça, un bouton "low life" resté enfoncé (ou une
  // bascule qui l'avait activé) survivrait à un arrêt alors que le morceau repart du début. Annule aussi les
  // cascades et coupures automatiques encore en attente.
  function resetFxTriggers() {
    fxRampOverride = 0.05;
    try { fxRules.reset(); } finally { fxRampOverride = null; }
    updateFxTriggerButtons();
    resetFxSliders();
  }
  // ---- Curseurs (24/09) : exécution ----
  const fxSliderInputs = [...wrapper.querySelectorAll('[data-fx-slider]')];
  const fxSliderLastWant = new Map(); // triggerId -> dernier état voulu par un seuil (ne redemande que sur franchissement)
  function paintFxSlider(id) {
    fxSliderInputs.forEach(inp => {
      if (inp.dataset.fxSlider !== id) return;
      inp.value = Math.round(fxSliderValueOf(id) * 100);
      const out = inp.parentElement && inp.parentElement.querySelector('output');
      if (out) out.textContent = Math.round(fxSliderValueOf(id) * 100) + '%';
    });
  }
  function evalFxSliderThresholds(sl, force) {
    fxSliderThresholdWants(sl, fxSliderValueOf(sl.id)).forEach(w => {
      if (!force && fxSliderLastWant.get(sl.id + '|' + w.triggerId) === w.want) return;
      fxSliderLastWant.set(sl.id + '|' + w.triggerId, w.want);
      fxRules.request(w.triggerId, w.want, 'composer'); // décision du compositeur : ne subit pas « Nécessite »
    });
  }
  function applyFxSliderToChains(sl, rampSec) {
    const keys = new Set(sl.bindings.map(b => b.key));
    keys.forEach(key => {
      fxChainsFor(key).forEach(ch => applyFxToChain(ctx, ch, fxEffectiveFor(ch.targetKey, ch.baseFx), rampSec));
    });
  }
  // Sfx spatialisés en cours de lecture dans CE morceau : un curseur lié à leur position/reverb les déplace en direct.
  const activeSfxVoices = new Map(); // sfxId -> Set(voix spatiales)
  function fxSfxOverrideFor(sfxId) { return fxSliders.length ? fxSliderSfxOverrides(fxSliders, fxSliderValueOf, sfxId) : null; }
  function applyFxSliderToSfx(sl, rampSec) {
    new Set(sl.bindings.filter(b => b.key.indexOf('sfx:') === 0).map(b => b.key.slice(4))).forEach(sfxId => {
      const sfx = SFX_LIBRARY_BY_ID[sfxId];
      const voices = activeSfxVoices.get(sfxId);
      if (!sfx || !sfx.spatial || !voices) return;
      const sp = fxSpatialWithOverride(sfx.spatial, fxSfxOverrideFor(sfxId));
      voices.forEach(v => { v.setPosition(sp.x, sp.y, rampSec); v.setReverbDb(sp.reverbDb, rampSec); });
    });
  }
  function setFxSlider(id, value, emit) {
    const sl = fxSliders.find(x => x.id === id);
    if (!sl) return;
    fxSliderValues.set(id, Math.max(0, Math.min(1, value)));
    applyFxSliderToChains(sl, sl.smoothSec);
    applyFxSliderToSfx(sl, sl.smoothSec);
    refreshTrackRate(sl.smoothSec);
    evalFxSliderThresholds(sl, false);
    paintFxSlider(id);
    // Évènement DOM (pas de la télémétrie : un curseur émet des dizaines de valeurs par seconde) -- l'outil vidéo
    // l'enregistre pendant une prise, comme "tourner la tête".
    if (emit) { try { document.dispatchEvent(new CustomEvent('layerpitch-fx-slider', { detail: { trackId: track.id, sliderId: id, value: fxSliderValueOf(id) } })); } catch (e) {} }
  }
  function resetFxSliders() {
    fxSliders.forEach(sl => {
      fxSliderValues.set(sl.id, sl.def);
      applyFxSliderToChains(sl, 0.05);
      paintFxSlider(sl.id);
    });
    refreshTrackRate(0.05);
    fxSliderLastWant.clear();
    fxSliders.forEach(sl => evalFxSliderThresholds(sl, true));
  }
  fxSliderInputs.forEach(inp => inp.addEventListener('input', () => setFxSlider(inp.dataset.fxSlider, (+inp.value) / 100, true)));
  fxTriggerBtns.forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.fxTrigger;
    const willBeActive = !fxRules.isActive(id);
    const accepted = setFxTrigger(id, willBeActive, null, 'visitor');
    if (!accepted) return; // bouton bloqué : rien ne se passe, rien n'est enregistré
    // Seuls les appuis de bouton sont un geste du visiteur (les activations liées à un embranchement se déduisent
    // des bascules, déjà capturées) -- l'outil vidéo les enregistre et les rejoue.
    trackPublicEvent('fx_trigger', { trackId: track.id, triggerId: id, active: willBeActive });
  }));
  updateFxTriggerButtons();
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
      gain.gain.linearRampToValueAtTime(target, now + VOICE_RAMP_SEC);
    });
    // Moteur simple (vertical sans moteur quantifié) : les gains vivent dans gains[], pas activeGenSources.
    if (!useQuantizedLoop && gains.length && playing) {
      gains.forEach((g, i) => {
        if (!g) return;
        const base = (p[i] || 0) * effGain(layersToLoad[i]);
        const target = base * voiceGain('layer-' + i);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(target, now + VOICE_RAMP_SEC);
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
  const totalSfxFilesToLoad = attachedSfx.reduce((n, sfx) => n + (sfx.alternatives || []).filter(a => a.file || a.localFile || a.localUrl).length, 0);
  // Gain maître de CE morceau : tout ce qui sonne pour lui (une seule couche statique, plusieurs couches
  // vertical/vertical-random simultanées, ou les générations successives du moteur séquentiel) route par
  // ici plutôt que directement vers la destination — point d'accroche unique pour le ducking (Phase 4),
  // qui doit baisser TOUT le morceau en cours d'un coup, peu importe son mode de lecture.
  const trackMasterGain = ctx.createGain();
  trackMasterGain.connect(ctx.destination);

  // ---- Journal de prise de CE morceau (voir setTakeRecording plus haut) ----
  // Une prise commence à chaque vrai démarrage (pas une reprise après pause, un saut dans la frise ou un retour de
  // veille : ceux-là continuent la même prise, et le journal note simplement ce qui a été rejoué). Pendant une pause,
  // le temps d'écoute s'arrête. Chaque moteur signale ses voix via journalVoice / journalSfxVoice juste avant de les
  // lancer ; tout le reste (volumes, vitesse, effets) est consigné par les nœuds eux-mêmes.
  let take = null;
  function startTake() {
    if (!takeRecordingEnabled) { take = null; return; }
    journalParam(trackMasterGain.gain); // morceau initialisé avant l'activation : on rattrape son gain maître
    take = {
      startCtx: ctx.currentTime, pauses: [], pausedAt: null, voices: [], sfx: [], recordedAt: new Date().toISOString(),
      master0: trackMasterGain.gain.value, masterFrom: trackMasterGain.gain.__lpLog ? trackMasterGain.gain.__lpLog.auto.length : 0,
      yaw0: getListenerYaw(), yawFrom: _takeYawLog.length
    };
  }
  function pauseTake() { if (take && take.pausedAt == null) take.pausedAt = ctx.currentTime; }
  function resumeTake() {
    if (!take) return;
    take.resumable = false;
    if (take.pausedAt != null) { take.pauses.push([take.pausedAt, ctx.currentTime]); take.pausedAt = null; }
  }
  function journalVoice(src, g, chain) {
    if (take && take.pausedAt == null && src && src.__lpInfo) take.voices.push({ src, g, chain });
  }
  function journalSfxVoice(src, spatialVoice) {
    if (take && take.pausedAt == null && src && src.__lpInfo) take.sfx.push({ src, voice: spatialVoice || null });
  }
  trackTakeReaders[track.id] = () => {
    const J = take;
    if (!J) return null;
    const endCtx = J.pausedAt != null ? J.pausedAt : ctx.currentTime;
    // Heure du contexte audio -> temps d'écoute : on retire les pauses déjà closes, et un instant tombé PENDANT une
    // pause (ou après la pause en cours) se ramène au moment où elle a commencé.
    const pauses = J.pausedAt != null ? J.pauses.concat([[J.pausedAt, Infinity]]) : J.pauses;
    const tt = c => {
      let t = c - J.startCtx;
      pauses.forEach(([a, b]) => { if (c >= b) t -= (b - a); else if (c > a) t -= (c - a); });
      return Math.round(t * 1e6) / 1e6;
    };
    const param = log => (log ? { init: log.init, auto: log.auto.map(e => [e[0], tt(e[1])].concat(e.slice(2))) } : null);
    // Plusieurs stop() : le dernier appel l'emporte, sauf si la source s'était déjà arrêtée avant qu'il arrive.
    const stopOf = info => {
      let s = null;
      info.stops.forEach(([call, when]) => { if (s == null || call < s) s = when; });
      return s == null ? null : tt(s);
    };
    const base = src => {
      const info = src.__lpInfo, st = info.starts[0];
      return { url: st.url, start: tt(st.when), offset: st.offset, dur: st.duration, loop: st.loop, stop: stopOf(info), rate: param(src.playbackRate.__lpLog) };
    };
    const started = x => x.src.__lpInfo && x.src.__lpInfo.starts.length;
    const voices = J.voices.filter(started).map(({ src, g, chain }) => Object.assign(base(src), {
      gain: g ? param(g.gain.__lpLog) : null,
      fx: chain && chain.__lpMeta ? chain.__lpMeta : null,
      fxLog: chain && chain.__lpFxLog ? chain.__lpFxLog.map(([c, fx, r]) => [tt(c), fx, r]) : []
    }));
    const sfx = J.sfx.filter(started).map(({ src, voice }) => {
      const sp = voice && voice.__lpSpatial;
      return Object.assign(base(src), { spatial: sp ? { sp: sp.sp, stepIndex: sp.stepIndex, calls: sp.calls.map(c => [tt(c[0])].concat(c.slice(1))) } : null });
    });
    const masterLog = trackMasterGain.gain.__lpLog;
    const all = voices.concat(sfx);
    return JSON.parse(JSON.stringify({
      v: 1, kind: 'layerpitch-take', trackId: track.id, publishedAt: track.publishedAt || null, recordedAt: J.recordedAt,
      duration: tt(endCtx), complete: J.pausedAt != null, missing: all.filter(x => !x.url).length,
      // Retard propre aux effets à ScriptProcessor (bitcrusher, pitch-shift) EN DIRECT : le rendu hors-ligne, plus rapide,
      // en a un plus court -- il ajoute la différence pour que ces voix restent calées comme à l'écoute (Sfx compris).
      fxLatencySec: fxSpLatencySec(ctx),
      sampleRate: ctx.sampleRate, // le rendu se fait à la même fréquence : mêmes fichiers décodés, mêmes réverbérations
      voices, sfx,
      // Gain maître : commandes passées pendant une pause (autre morceau lancé, remise à 1 d'un arrêt) écartées -- rien
      // ne sonnait, et elles changeraient une prise déjà close.
      master: { init: J.master0, auto: masterLog ? masterLog.auto.slice(J.masterFrom).filter(e => !pauses.some(([a, b]) => e[1] > a + 1e-6 && e[1] < b)).map(e => [e[0], tt(e[1])].concat(e.slice(2))) : [] },
      yaw: [[0, J.yaw0]].concat(_takeYawLog.slice(J.yawFrom).filter(([c]) => c >= J.startCtx && c <= endCtx).map(([c, y]) => [tt(c), y]))
    }));
  };
  // Ducking : abaisse brièvement le gain maître du morceau pendant qu'un Sfx réglé pour ça est en train
  // de jouer, pour le mettre en valeur, puis remonte — réglage propre à chaque Sfx (duckMainTrack), pas
  // au morceau. Rampes linéaires plutôt qu'un changement instantané, moins désagréable à l'oreille.
  // Baisse plafonnée à 30% (DUCK_LEVEL = 0.7) : la descente reste rapide et nette, mais la remontée
  // démarre dès la moitié du Sfx et s'étale sur une rampe longue — quitte à se terminer après la fin du
  // Sfx lui-même, plutôt que la remontée courte et collée à la toute fin d'avant.
  function duckMainTrack(sfxDurationSec, atTime) {
    const now = atTime != null ? atTime : ctx.currentTime;
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
  const progressTrackEl = wrapper.querySelector('[data-role="progressTrack"]');
  const fill = wrapper.querySelector('[data-role="progressFill"]');
  const head = wrapper.querySelector('[data-role="progressHead"]');
  // Barre de progression "à deux états" (Chantier Apparence par élément, palier Pro, 05/09) : simple
  // barre CSS (pas un canvas), donc appliquée une seule fois en style inline plutôt que reconstruite à
  // chaque tick -- même repli que la forme d'onde si non réglée (couleurs générales inchangées).
  if (elementColors && elementColors.progressBar) {
    if (progressTrackEl && elementColors.progressBar.unplayedColor) progressTrackEl.style.background = elementColors.progressBar.unplayedColor;
    if (elementColors.progressBar.playedColor) {
      if (fill) fill.style.background = elementColors.progressBar.playedColor;
      if (head) head.style.background = elementColors.progressBar.playedColor;
    }
  }
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
    renderWaveformPair(waveformBg, waveformFg, waveformBuffer, waveBgColor, waveFgColor);
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
    renderWaveformPair(els.bg, els.fg, buffer, waveBgColor, waveFgColor);
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
  const seqPendingIndicatorEl = wrapper.querySelector('[data-role="seqPendingIndicator"]');
  // Carte globale des chemins (02/09) -- voir updateSeqMap()/drawSeqMapLines() plus bas.
  // Carte globale des chemins (02/09) : .seq-map-graph est la fenêtre défilable (overflow-x:auto),
  // .seq-map-canvas le contenu dimensionné par JS (voir updateSeqMap()), .seq-map-lines/.seq-map-nodes
  // deux calques superposés à l'intérieur de ce contenu. Positions calculées en JS, sans mesure DOM en
  // mode 'compact' (pas besoin de ResizeObserver, contrairement au graphe Wwise voisin/drawWwiseLines) --
  // MAIS le mode 'roomy' (10/09, pages publiques) mesure bel et bien seqMapGraphEl.clientWidth pour
  // s'adapter à la largeur réelle disponible (voir updateSeqMap()), donc redessiné au redimensionnement
  // comme le graphe Wwise, dans ce mode uniquement -- en 'compact', la taille ne dépend que du nombre
  // d'emplacements, ce ResizeObserver n'aurait rien à faire.
  const seqMapGraphEl = wrapper.querySelector('[data-role="seqMapGraph"]');
  // seqMapLastRoomyWidth : garde-fou contre une boucle de ResizeObserver observée en usage réel (Clarity,
  // 17/09) -- en mode 'roomy', updateSeqMap() dimensionne .seq-map-canvas selon seqMapGraphEl.clientWidth ;
  // si ce canvas devient plus large que l'espace dispo, la barre de défilement horizontale qui apparaît
  // (.seq-map-graph a overflow-x:auto) grignote sa hauteur, ce que la même ResizeObserver détecte aussi
  // (elle observe toute la content-box, pas juste la largeur) et redéclenche updateSeqMap() -- alors même
  // que la largeur, seule dimension qui nous intéresse ici, n'a pas changé. On ne relance donc que si elle
  // a effectivement bougé.
  let seqMapLastRoomyWidth = -1;
  if (seqMapGraphEl && window.ResizeObserver && currentSeqMapDensity() === 'roomy') {
    new ResizeObserver(() => {
      const w = seqMapGraphEl.clientWidth;
      if (w === seqMapLastRoomyWidth) return;
      seqMapLastRoomyWidth = w;
      updateSeqMap(seqMapLastCurrentIdx);
    }).observe(seqMapGraphEl);
  }
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

  let buffers = [], sources = [], gains = [], layerFxChains = []; // moteur simple
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
    return Math.min(chosen.bufferOffset + (ctx.currentTime - chosen.ctxStartTime) * (chosen.ratio || trackPitchRatio), progressMaxSec());
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
  // Boule de transition "en train de jouer" (05/09, retour direct : "est-ce que la boule qui symbolise la
  // transition peut se colorer lorsqu'elle joue ?") -- currentTransitionEdge identifie l'arête source->cible
  // dont le fichier de transition est actuellement audible (posé/retiré par activateSeqStage(), voir plus
  // bas), null le reste du temps. seqMapLastCurrentIdx retient le dernier index passé à updateSeqMap() pour
  // pouvoir la redessiner à l'identique (même nœud "current") au moment où une transition démarre/se termine,
  // sans devoir faire remonter cet index jusqu'ici depuis performSeqBranchCut().
  let currentTransitionEdge = null;
  let seqMapLastCurrentIdx = -1;
  // Amorçage à chaud de la disposition "à ressorts" (mode 'roomy', 10/09) -- positions du dernier calcul,
  // par emplacement, réutilisées comme point de départ du suivant plutôt que recalculées de zéro à chaque
  // updateSeqMap() (révélation progressive publique : la carte s'étend en douceur au lieu de sauter à
  // chaque nouvel emplacement révélé). Voir seqMapForceLayout().
  let seqMapForcePositions = {};
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
    renderWaveformPair(els.bg, els.fg, buffer, waveBgColor, waveFgColor, seqLastCropSec[kind]);
  }
  // État du bloc actuellement en cours de lecture, retenu pour permettre le seek (glisser sur sa waveform) :
  // sans ça, impossible de savoir quel buffer/gain relancer, ni à quelle position on se trouve réellement
  // dedans (le curseur visuel seul ne suffit pas — il faut aussi la référence temporelle audio exacte).
  let currentSeqBlockInfo = null; // { kind, buffer, gain, totalSec, virtualZero, terminal, slotIdx }
  // startCtxTime : instant AUDIO où ce bloc a démarré (25/09) -- origine exacte de la grille des mesures/temps des
  // coupures (armNextSeqBranchBoundary). Avant, l'heure de ce rappel (un minuteur, quelques ms en retard) servait
  // d'origine : les coupures tombaient quelques ms après la vraie barre de mesure.
  function activateSeqStage(kind, remainingSec, totalSec, buffer, gainValue, terminal, slotIdx, gainNode, fromSlotIdx, toSlotIdx, startCtxTime) {
    // Boule de transition en train de jouer (05/09) : posée uniquement pendant le stade "transition" lui-même,
    // retirée dès que n'importe quel autre stade devient audible (le seul qui suit systématiquement une
    // transition est le "segment" cible, mais un stop/seek peut aussi couper court -- dans tous les cas, plus
    // de transition en cours dès qu'on n'est plus sur "transition").
    if (kind === 'transition') {
      currentTransitionEdge = (fromSlotIdx != null && toSlotIdx != null) ? { from: fromSlotIdx, to: toSlotIdx } : null;
      updateSeqMap(seqMapLastCurrentIdx);
    } else if (currentTransitionEdge) {
      currentTransitionEdge = null;
    }
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
    currentSeqBlockInfo = { kind, buffer, gain: gainValue, gainNode: gainNode || null, totalSec, virtualZero: (startCtxTime != null ? startCtxTime : ctx.currentTime) - (startFraction * totalSec), terminal: !!terminal, slotIdx: (slotIdx != null ? slotIdx : -1) };
    // L'indicateur "en attente" reste pertinent quelle que soit la façon dont le choix a été fait (bouton,
    // retiré le 05/09 -- ou nœud de la carte globale) -- rafraîchi à chaque nouveau stade audible.
    updateSeqPendingIndicator();
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
      // handleSeqBranchChoice). Seuls "beat"/"bar" ont une frontière à attendre.
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
  // Choix d'un embranchement : appelé depuis un clic sur un nœud cliquable de la carte globale (voir
  // updateSeqMap()) -- seule façon de choisir désormais (les boutons de destination .seq-branch-btn ont
  // été retirés le 05/09, retour direct : "plus besoin des boutons de destination non plus, la carte se
  // suffit également à elle-même" -- la carte couvrait déjà exactement les mêmes cibles).
  function handleSeqBranchChoice(targetId, currentSlot) {
    // Dernier clic gagne (validé le 31/07) : un second clic sur une autre option remplace simplement le
    // choix précédent, il n'y a jamais de verrou sur le premier clic.
    pendingNextSegmentId = targetId;
    if (seqMapNodesEl) seqMapNodesEl.querySelectorAll('.seq-map-node').forEach(n => n.classList.toggle('pending', n.dataset.slotId === targetId));
    updateSeqPendingIndicator();
    trackPublicEvent('seq_branch_select', { trackId: track.id, targetId });
    // "immediate" (validé le 02/08) : pas de frontière à attendre, la coupure se déclenche directement au
    // clic — pour "beat"/"bar", c'est armNextSeqBranchBoundary (armée dès le début de CET emplacement dans
    // activateSeqStage) qui surveille déjà la prochaine frontière et lira ce choix à son tour.
    if (currentSlot && (currentSlot.quantization || 'bar') === 'immediate') performSeqBranchCut();
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
  // Écarts entre colonnes/lignes, et marges des boucles de retour, dépendants de la densité (10/09) --
  // fonctions plutôt que constantes fixes car currentSeqMapDensity() peut différer d'une page hôte à
  // l'autre (Backstage vs public) mais jamais PENDANT la vie d'une page (posé une fois par la page hôte
  // avant tout rendu, comme currentSeqMapTheme()) -- lues à chaque appel plutôt que figées une fois pour
  // ne pas dupliquer cette logique entre updateSeqMap() et seqMapDrawEdges(), qui en ont toutes deux besoin.
  function seqMapColGap() { return currentSeqMapDensity() === 'roomy' ? 56 : 40; }
  function seqMapRowGap() { return currentSeqMapDensity() === 'roomy' ? 24 : 16; }
  // Boucles de retour (03/09, retour direct "elles sont tracées un peu aléatoirement") : marge sous TOUTE
  // la grille avant la première boucle, puis un écart entre boucles successives -- voir seqMapDrawEdges.
  function seqMapLoopMargin() { return currentSeqMapDensity() === 'roomy' ? 32 : 22; }
  function seqMapLoopStagger() { return currentSeqMapDensity() === 'roomy' ? 26 : 18; }
  // Taille des nœuds en mode 'roomy' (pages publiques, 10/09) : "pleine" taille visée quand la place ne
  // manque pas, jamais dépassée même sur un très grand écran (un unique nœud géant serait absurde) --
  // plancher en dessous duquel .seq-map-graph prend le relais en défilement horizontal plutôt que des
  // cartes ratatinées. Largeur de repli si le conteneur n'est pas encore mesurable (ex. carte construite
  // avant d'être visible/dépliée, clientWidth encore à 0) : une largeur de carte plausible, pas 0.
  const SEQ_MAP_ROOMY_FULL_W = 148, SEQ_MAP_ROOMY_FULL_H = 56; // 24/09 : 168x64 -> 148x56 (« un peu surdimensionnée », Jules-Antoine)
  const SEQ_MAP_ROOMY_MIN_W = 112, SEQ_MAP_ROOMY_MIN_H = 46;
  const SEQ_MAP_ROOMY_FALLBACK_WIDTH = 640;
  // Une couleur par case (10/09, retour direct : "essayons une par case ?") -- identité stable de
  // l'emplacement (dérivée de son index dans segmentSlots, pas de l'ordre de révélation qui change en
  // cours de lecture), pas un indicateur d'état -- les états (courant/visité/sélectionnable) restent
  // portés par la bordure existante, cette couleur-ci n'apparaît qu'en filet sur le bord gauche (voir
  // CSS .seq-map-roomy .seq-map-node) pour ne jamais entrer en conflit visuel avec eux. Palette reprise
  // de l'ancienne palette des boucles de retour (retirée le 07/09, réutilisée ici pour un usage différent
  // -- identité de case, pas type d'arête).
  const SEQ_MAP_NODE_PALETTE = ['#4e79a7', '#59a14f', '#b07aa1', '#e15759', '#499894', '#d4a72c'];
  // Point sur le pourtour d'un nœud rectangulaire (centré en `from`, largeur/hauteur nodeW/nodeH), à
  // l'intersection avec le segment reliant `from` à `to` -- utilisé uniquement par la disposition "à
  // ressorts" ci-dessous (seqMapForceLayout), où les nœuds ne sont plus alignés en grille et une arête
  // peut arriver de n'importe quelle direction (contrairement à rightOf/leftOf/bottomOf, qui supposent un
  // flux strictement gauche-à-droite/haut-en-bas).
  function seqMapEdgePoint(from, to, nodeW, nodeH) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!dx && !dy) return { x: from.x, y: from.y };
    const halfW = nodeW / 2, halfH = nodeH / 2;
    const scale = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  }
  // Disposition "à ressorts" (10/09 -- la disposition en triangle qui la précédait, limitée à 3
  // emplacements, ne réglait qu'un cas précis ; retour direct : "essaie de résoudre la mise en
  // visualisation" pour des suites d'embranchements générées au hasard, avec ou sans retours). Algorithme
  // général type Fruchterman-Reingold : tous les nœuds se repoussent entre eux (jamais superposés, jamais
  // entassés), chaque arête tire ses deux extrémités l'une vers l'autre (jamais trop éloignées), relaxé
  // sur plusieurs itérations jusqu'à un arrangement stable -- se généralise naturellement au triangle pour
  // 3 nœuds mutuellement reliés, sans avoir besoin d'un cas particulier dédié. Les arêtes se tracent en
  // lignes directes entre pourtours de nœuds (seqMapEdgePoint), plus jamais en U sous la grille (qui n'a
  // plus de sens dès que les nœuds ne sont plus alignés en colonnes/lignes strictes) -- voir seqMapDrawEdges.
  //
  // Amorçage à chaud (seedPositions = seqMapForcePositions, persisté par instance de piste) : un
  // emplacement déjà positionné à l'appel précédent repart de LÀ, pas d'un point neutre -- sans ça, chaque
  // nouvel emplacement révélé (lecture publique, révélation progressive) aurait fait sauter TOUTE la
  // disposition existante au lieu de l'étendre en douceur. Un emplacement jamais vu est amorcé sur la
  // grille classique (layout.col/row) à l'échelle `k`, pas au hasard -- garde une tendance de lecture
  // gauche-à-droite cohérente avec le reste de la carte, la simulation affine ensuite depuis ce point de
  // départ plutôt que d'ignorer complètement la topologie.
  function seqMapForceLayout(visibleIdx, layout, w, h, seedPositions) {
    const k = Math.max(w, h) * 1.6; // distance "au repos" visée entre deux nœuds reliés par une arête (1,9 avant le 24/09 : carte trop grande)
    const pos = {};
    visibleIdx.forEach(idx => {
      pos[idx] = seedPositions[idx] ? { x: seedPositions[idx].x, y: seedPositions[idx].y } : { x: (layout.col[idx] || 0) * k, y: (layout.row[idx] || 0) * k };
      // Départ légèrement décalé (24/09) : deux nœuds de même colonne/ligne (ex. deux emplacements seulement, reliés dans les
      // deux sens) partaient exactement au même point -- direction de répulsion nulle, ils restaient superposés pour toujours.
      if (!seedPositions[idx]) { pos[idx].x += Math.cos(idx * 2.4) * 2; pos[idx].y += Math.sin(idx * 2.4) * 2; }
    });
    const visibleSet = new Set(visibleIdx);
    const edges = [];
    visibleIdx.forEach(idx => {
      seqMapForwardTargets(idx, visibleSet).forEach(ti => { if (ti !== idx) edges.push({ from: idx, to: ti }); });
    });
    const n = visibleIdx.length;
    let temp = k / 2;
    for (let iter = 0; iter < 220; iter++) {
      const disp = {};
      visibleIdx.forEach(idx => { disp[idx] = { x: 0, y: 0 }; });
      // Répulsion : chaque PAIRE de nœuds s'écarte, proportionnellement à k²/distance (classique
      // Fruchterman-Reingold) -- c'est ce terme, appliqué à TOUTE paire (pas seulement les nœuds reliés),
      // qui garantit qu'aucun couple ne finit jamais superposé ni collé, contrairement à la grille où deux
      // nœuds non reliés directement pouvaient partager la même colonne sans aucune force les séparant.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = visibleIdx[i], b = visibleIdx[j];
          const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const force = (k * k) / dist;
          const ux = dx / dist, uy = dy / dist;
          disp[a].x += ux * force; disp[a].y += uy * force;
          disp[b].x -= ux * force; disp[b].y -= uy * force;
        }
      }
      // Attraction : chaque arête rapproche ses deux extrémités, proportionnellement à distance²/k --
      // équilibre la répulsion ci-dessus pour que les nœuds RELIÉS restent proches malgré tout.
      edges.forEach(e => {
        const dx = pos[e.from].x - pos[e.to].x, dy = pos[e.from].y - pos[e.to].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (dist * dist) / k;
        const ux = dx / dist, uy = dy / dist;
        disp[e.from].x -= ux * force; disp[e.from].y -= uy * force;
        disp[e.to].x += ux * force; disp[e.to].y += uy * force;
      });
      // Déplacement limité par la "température" (refroidie à chaque itération, recuit simulé classique) --
      // grands pas au début (échappe vite un mauvais point de départ), pas de plus en plus fins ensuite
      // (converge sans osciller indéfiniment autour de l'équilibre).
      visibleIdx.forEach(idx => {
        const dx = disp[idx].x, dy = disp[idx].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const lim = Math.min(dist, temp);
        pos[idx].x += (dx / dist) * lim;
        pos[idx].y += (dy / dist) * lim;
      });
      temp *= 0.965;
    }
    visibleIdx.forEach(idx => { seedPositions[idx] = { x: pos[idx].x, y: pos[idx].y }; });
    // Normalise en coordonnées positives (coin haut-gauche de chaque nœud), avec une marge constante --
    // même principe que l'ancienne disposition en triangle qu'elle remplace.
    // Marge égale des quatre côtés autour de la BOÎTE ENGLOBANTE des nœuds (24/09, « toujours mal centrée ») : avant, la marge
    // de gauche/haut se calculait depuis le CENTRE du premier nœud (- w/2) alors que celle de droite/bas partait de son bord,
    // ce qui décalait tout le graphe vers la gauche et le haut dans son cadre.
    const pad = Math.max(w, h) * 0.35;
    const lefts = visibleIdx.map(idx => pos[idx].x - w / 2), tops = visibleIdx.map(idx => pos[idx].y - h / 2);
    const minL = Math.min(...lefts), minT = Math.min(...tops);
    const positions = {};
    let maxRight = 0, maxBottom = 0;
    visibleIdx.forEach(idx => {
      const p = { x: pos[idx].x - w / 2 - minL + pad, y: pos[idx].y - h / 2 - minT + pad };
      positions[idx] = p;
      maxRight = Math.max(maxRight, p.x + w);
      maxBottom = Math.max(maxBottom, p.y + h);
    });
    return { positions, totalW: maxRight + pad, totalH: maxBottom + pad };
  }
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
    seqMapLastCurrentIdx = currentIdx;
    const slots = track.segmentSlots || [];
    const visibleIdx = seqMapVisibleSlotIndices(currentIdx);
    if (!visibleIdx.length) {
      seqMapNodesEl.innerHTML = ''; if (seqMapLinesEl) seqMapLinesEl.innerHTML = '';
      seqMapCanvasEl.style.width = ''; seqMapCanvasEl.style.height = '';
      return;
    }
    // Nœuds cliquables (04/09) : uniquement ceux qui sont une vraie option depuis l'emplacement COURANT,
    // jamais un nœud "visité" par ailleurs qui n'est pas une option depuis ici -- on ne clique pas sur
    // l'historique, seulement sur ce qui est réellement proposé maintenant. Rien de sélectionnable hors
    // lecture (currentIdx < 0, ex. état "Prêt").
    const currentSlot = currentIdx >= 0 ? (slots[currentIdx] || null) : null;
    const selectableIds = new Set(((currentSlot && currentSlot.nextOptions) || []).map(o => o.targetId));
    const nodeStateCls = (idx, slot) => {
      const isCurrent = idx === currentIdx;
      const isVisited = seqVisitedSlotIds.has(idx) && !isCurrent;
      const isSelectable = selectableIds.has(slot.id);
      const isPending = pendingNextSegmentId === slot.id;
      return (isCurrent ? ' current' : '') + (isVisited ? ' visited' : '') + (isSelectable ? ' selectable' : '') + (isPending ? ' pending' : '');
    };
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
        const label = slot.label || t('slotFallback', { n: idx + 1 });
        const cls = 'seq-map-node' + nodeStateCls(idx, slot);
        const check = (seqVisitedSlotIds.has(idx) && idx !== currentIdx) ? '<span class="seq-map-node-check">✓</span>' : '';
        return `<div class="${cls}" data-slot-idx="${idx}" data-slot-id="${escapeHtml(slot.id || '')}"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
      }).join('');
      attachSeqMapNodeClicks(currentSlot);
      return;
    }
    const layout = seqMapComputeLayout(visibleIdx, currentIdx);
    const roomy = currentSeqMapDensity() === 'roomy';
    let w, h;
    if (roomy) {
      // Mode 'roomy' (pages publiques, 10/09, retour direct : la maquette montrée était "agréable à
      // regarder", le vrai composant "tristounet" en comparaison, et devait pouvoir "s'adapter à la
      // fois à la taille de l'écran et au nombre d'embranchements") : contrairement au mode 'compact'
      // ci-dessous, la taille des nœuds dépend de la largeur RÉELLEMENT disponible -- seule mesure
      // DOM (clientWidth) de toute cette carte, dérogation volontaire au principe "tout en JS pur" du
      // commentaire plus haut, nécessaire ici car "s'adapter à l'écran" ne peut pas se déduire de la
      // seule topologie du graphe.
      const availableWidth = (seqMapGraphEl && seqMapGraphEl.clientWidth) || SEQ_MAP_ROOMY_FALLBACK_WIDTH;
      const cols = layout.maxCol + 1;
      const idealW = (availableWidth - (cols - 1) * seqMapColGap()) / cols;
      w = Math.max(SEQ_MAP_ROOMY_MIN_W, Math.min(SEQ_MAP_ROOMY_FULL_W, Math.round(idealW)));
      h = Math.max(SEQ_MAP_ROOMY_MIN_H, Math.round(SEQ_MAP_ROOMY_FULL_H * (w / SEQ_MAP_ROOMY_FULL_W)));
    } else {
      const span = SEQ_MAP_DEGRADE_MAX - SEQ_MAP_FULL_SIZE_MAX;
      const over = Math.max(0, Math.min(n, SEQ_MAP_DEGRADE_MAX) - SEQ_MAP_FULL_SIZE_MAX);
      w = Math.round(96 - over * (36 / span));
      h = Math.round(40 - over * (12 / span));
    }
    seqMapNodesEl.style.setProperty('--seq-map-node-w', w + 'px');
    seqMapNodesEl.style.setProperty('--seq-map-node-h', h + 'px');
    // Police proportionnelle uniquement en mode 'roomy' -- en 'compact', 10px fixe reste approprié même
    // au node le plus large (96px, taille "pleine" de ce mode), jamais aussi grand qu'un node 'roomy'.
    if (roomy) seqMapNodesEl.style.setProperty('--seq-map-node-font', Math.max(12, Math.round(w / 9)) + 'px');
    // Disposition "à ressorts" (10/09) en mode 'roomy' -- voir seqMapForceLayout ci-dessus pour le
    // pourquoi. Sinon (mode 'compact'), grille habituelle (colonnes/lignes déjà calculées par
    // seqMapComputeLayout) convertie en positions ABSOLUES une fois pour toutes ici -- seqMapDrawEdges ne
    // connaît plus que ces positions, ce qui lui permet de tracer des arêtes correctement quelle que soit
    // la disposition (grille ou ressorts) sans savoir laquelle des deux l'a produite.
    let positions, totalW, totalH;
    if (roomy) {
      ({ positions, totalW, totalH } = seqMapForceLayout(visibleIdx, layout, w, h, seqMapForcePositions));
    } else {
      const colGap = seqMapColGap(), rowGap = seqMapRowGap();
      const colW = w + colGap, rowH = h + rowGap;
      positions = {};
      visibleIdx.forEach(idx => { positions[idx] = { x: layout.col[idx] * colW, y: layout.row[idx] * rowH }; });
      totalW = (layout.maxCol + 1) * colW - colGap;
      // Marge verticale supplémentaire si des arêtes de retour existent -- chacune plonge volontairement
      // sous TOUTE la grille (voir seqMapDrawEdges), une par une, en s'étalant verticalement pour rester
      // distinctes. Sans cette marge elles seraient coupées par overflow-y:hidden sur .seq-map-graph (bug
      // trouvé en vérification visuelle réelle : la boucle existait bien dans le SVG mais restait invisible,
      // coupée sous le bord de la carte).
      const backEdgeCount = visibleIdx.reduce((n, idx) => n + seqMapForwardTargets(idx, new Set(visibleIdx)).filter(ti => layout.col[ti] <= layout.col[idx]).length, 0);
      totalH = layout.maxRows * rowH - rowGap + (backEdgeCount > 0 ? seqMapLoopMargin() + (backEdgeCount - 1) * seqMapLoopStagger() + Math.round(h / 2) + 6 : 0);
    }
    // Taille explicite sur le conteneur défilable (pas sur .seq-map-graph, qui reste la fenêtre visible) --
    // permet un défilement horizontal si le graphe est plus large que la carte, plutôt que l'effondrement
    // en une seule colonne trouvé en situation réelle avec la première version (nœuds superposés, arêtes
    // invisibles derrière eux, voir CHANGELOG).
    seqMapCanvasEl.style.width = totalW + 'px';
    seqMapCanvasEl.style.height = totalH + 'px';
    // Centré dans la carte (24/09, « toujours mal centrée ») : le canvas est dimensionné sur le graphe seul, plus petit
    // que la carte ; sans marges automatiques il restait collé à gauche. Sans effet s'il déborde (défilement).
    seqMapCanvasEl.style.marginLeft = 'auto';
    seqMapCanvasEl.style.marginRight = 'auto';
    // Ajusté à la largeur disponible (24/09, carte de l'aperçu du Backstage, panneau étroit) : en 'roomy', un graphe de plusieurs
    // nœuds dépasse la carte et obligeait à faire défiler horizontalement -- il est réduit d'un bloc (nœuds, flèches, texte)
    // jusqu'à 60 % au plus ; en dessous, le défilement reste le repli.
    if (roomy && seqMapGraphEl) {
      const cs = getComputedStyle(seqMapGraphEl);
      const avail = seqMapGraphEl.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const k = avail > 0 && totalW > avail ? Math.max(0.6, avail / totalW) : 1;
      seqMapCanvasEl.style.zoom = k < 1 ? String(k) : '';
    }
    // Pas de forme d'onde sur les nœuds (retiré le 03/09 sur retour direct de Jules-Antoine en situation
    // réelle -- en plus de ne pas être demandée ici, elle ne reflétait pas fidèlement le fichier : Corridor
    // et Battle s'arrêtaient visiblement à mi-chemin). L'état (courant/visité/pas encore atteint) se lit
    // uniquement via la bordure (voir CSS .seq-map-node.current/.visited) -- aucune donnée audio à charger
    // ni dessiner ici, juste le libellé. Couleur par case (10/09) : identité stable de l'emplacement (voir
    // SEQ_MAP_NODE_PALETTE) posée en filet CSS, uniquement consommée en 'roomy' -- inoffensive ailleurs.
    seqMapNodesEl.innerHTML = visibleIdx.map(idx => {
      const slot = slots[idx] || {};
      const label = slot.label || t('slotFallback', { n: idx + 1 });
      const cls = 'seq-map-node' + nodeStateCls(idx, slot);
      const check = (seqVisitedSlotIds.has(idx) && idx !== currentIdx) ? '<span class="seq-map-node-check">✓</span>' : '';
      const accent = roomy ? SEQ_MAP_NODE_PALETTE[idx % SEQ_MAP_NODE_PALETTE.length] : null;
      const style = `left:${positions[idx].x}px;top:${positions[idx].y}px` + (accent ? `;--seq-map-node-accent:${accent}` : '');
      return `<div class="${cls}" data-slot-idx="${idx}" data-slot-id="${escapeHtml(slot.id || '')}" style="${style}"><span class="seq-map-node-label">${escapeHtml(label)}</span>${check}</div>`;
    }).join('');
    seqMapDrawEdges(layout, visibleIdx, positions, w, h, totalW, totalH, roomy);
    attachSeqMapNodeClicks(currentSlot);
  }
  // Attache le clic sur les nœuds sélectionnables -- rappelée à chaque reconstruction de seqMapNodesEl,
  // son innerHTML étant entièrement remplacé à chaque appel d'updateSeqMap() (donc les écouteurs d'un
  // passage précédent n'existent plus).
  function attachSeqMapNodeClicks(currentSlot) {
    seqMapNodesEl.querySelectorAll('.seq-map-node.selectable').forEach(el => {
      el.addEventListener('click', () => handleSeqBranchChoice(el.dataset.slotId, currentSlot));
    });
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
  function seqMapDrawEdges(layout, visibleIdx, positions, nodeW, nodeH, totalW, totalH, freeform) {
    if (!seqMapLinesEl) return;
    const slots = track.segmentSlots || [];
    seqMapLinesEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    seqMapLinesEl.setAttribute('width', totalW);
    seqMapLinesEl.setAttribute('height', totalH);
    seqMapLinesEl.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    // Coordonnées dérivées de `positions` (calculées une fois par updateSeqMap(), grille ou triangle
    // selon le cas -- voir seqMapForceLayout) plutôt que recalculées ici depuis colonne/ligne :
    // cette fonction n'a plus besoin de savoir QUELLE disposition a produit ces positions.
    const centerOf = idx => ({ x: positions[idx].x + nodeW / 2, y: positions[idx].y + nodeH / 2 });
    const rightOf = idx => ({ x: positions[idx].x + nodeW, y: positions[idx].y + nodeH / 2 });
    const leftOf = idx => ({ x: positions[idx].x, y: positions[idx].y + nodeH / 2 });
    const bottomOf = (idx, offsetX) => ({ x: positions[idx].x + nodeW / 2 + (offsetX || 0), y: positions[idx].y + nodeH });
    const visibleSet = new Set(visibleIdx);
    // gridBottom (mode grille uniquement, voir plus bas) : bas du nœud le plus bas parmi ceux visibles --
    // équivalent de l'ancien layout.maxRows*rowH, mais dérivé des positions réelles, pas du nombre de
    // lignes de la grille (qui n'a plus de sens uniforme si une future disposition n'était plus en grille).
    const gridBottom = Math.max(0, ...visibleIdx.map(idx => positions[idx].y)) + nodeH;
    // Flèches de sens (03/09, retour direct : "ajoute une flèche pour bien expliciter le sens de
    // lecture") -- une définition <marker> par couleur utilisée (le gris par défaut des arêtes "en avant",
    // plus une par couleur de la palette des boucles de retour ci-dessous), réutilisées par toutes les
    // arêtes de cette couleur via marker-end. Redéfinies à chaque appel (innerHTML vidé juste au-dessus) --
    // coût négligeable, une poignée d'éléments SVG.
    const defs = document.createElementNS(svgNS, 'defs');
    seqMapLinesEl.appendChild(defs);
    const markerIds = {};
    function ensureArrowMarker(color, key) {
      if (markerIds[key]) return markerIds[key];
      const id = 'seqMapArrow-' + key;
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '8.5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto-start-reverse');
      const arrowPath = document.createElementNS(svgNS, 'path');
      arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      arrowPath.setAttribute('fill', color);
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
      markerIds[key] = id;
      return id;
    }
    // Couleur unique pour toutes les boucles de retour (07/09, retour direct de Jules-Antoine : "plus
    // besoin des couleurs sur les trajets de retour" une fois leur tracé fiabilisé -- voir écartement
    // minimal ci-dessous) -- même teinte neutre que les arêtes "en avant", les boucles se distinguent
    // déjà par leur tracé en U et leur étalement vertical/horizontal, pas besoin d'un code couleur en
    // plus. Remplace la palette aléatoire par paire source/cible utilisée jusqu'ici.
    const SEQ_MAP_LOOP_COLOR = cssVar('--text-dimmer', '#a8a399');
    // Étale chaque boucle de retour un peu plus bas que la précédente (backEdgeIndex incrémenté à chaque
    // arête en arrière rencontrée) -- sans ça, deux boucles de retour finissaient à la même hauteur et se
    // confondaient visuellement. updateSeqMap() réserve la marge verticale correspondante dans totalH,
    // avec les mêmes fonctions (seqMapLoopMargin()/seqMapLoopStagger()).
    //
    // Ancrages horizontaux (06/09, suite au fouillis signalé par Jules-Antoine sur un morceau à
    // plusieurs boucles) : quand plusieurs boucles de retour partagent le même nœud en départ ou en
    // arrivée, les ancrer toutes au centre du nœud les faisait converger exactement au même point --
    // réparties ici le long du bas du nœud, une par boucle. Calculé en une passe préalable (avant tout
    // tracé) car le nombre d'arêtes partageant un nœud n'est connu qu'une fois toutes les arêtes
    // recensées.
    // Tout ce bloc de précalcul (ancrages/écartement des boucles de retour en grille) ne concerne QUE le
    // tracé orthogonal en U du mode grille -- inutile et sauté en disposition "à ressorts" (roomy), qui
    // trace des lignes directes entre pourtours de nœuds (voir seqMapEdgePoint) sans jamais avoir besoin
    // de plonger sous la grille.
    const backEdgeAnchors = new Map();
    if (!freeform) {
      const backEdgePairs = [];
      visibleIdx.forEach(idx => {
        if (!slots[idx]) return;
        seqMapForwardTargets(idx, visibleSet).forEach(ti => {
          if (layout.col[ti] <= layout.col[idx]) backEdgePairs.push({ from: idx, to: ti });
        });
      });
      const ANCHOR_SPACING = 12;
      const fromTotals = {}, toTotals = {}, fromSeen = {}, toSeen = {};
      backEdgePairs.forEach(e => {
        fromTotals[e.from] = (fromTotals[e.from] || 0) + 1;
        toTotals[e.to] = (toTotals[e.to] || 0) + 1;
      });
      function spreadOffset(seenMap, totalsMap, key) {
        const total = totalsMap[key] || 1;
        const seen = seenMap[key] || 0;
        seenMap[key] = seen + 1;
        return total > 1 ? (seen - (total - 1) / 2) * ANCHOR_SPACING : 0;
      }
      backEdgePairs.forEach(e => {
        const anchor = {
          fromOffset: spreadOffset(fromSeen, fromTotals, e.from),
          toOffset: spreadOffset(toSeen, toTotals, e.to),
        };
        // Deux nœuds de la MÊME colonne (07/09, retour direct de Jules-Antoine après avoir réordonné des
        // embranchements : "c'est tout écrasé") : leur centre partage le même x, donc la boucle qui les
        // relie s'effondrait en un simple trait vertical (largeur nulle) au lieu d'un rectangle, quel que
        // soit l'écartement ci-dessus (qui ne sépare que des arêtes partageant un même nœud, pas deux
        // nœuds distincts alignés par hasard). Écartement minimal forcé dans ce cas précis -- ce bloc ne
        // s'exécute qu'en mode 'compact' (voir `if (!freeform)` plus haut) : en 'roomy', la disposition à
        // ressorts est le VRAI correctif (deux nœuds qui n'ont plus de raison de partager le même x) ;
        // cet écartement minimal reste le filet de sécurité pour le Backstage, qui reste en grille.
        if (layout.col[e.from] === layout.col[e.to]) {
          const minGap = Math.max(ANCHOR_SPACING * 2, nodeW * 0.5);
          if (Math.abs(anchor.fromOffset - anchor.toOffset) < minGap) {
            anchor.fromOffset -= minGap / 2;
            anchor.toOffset += minGap / 2;
          }
        }
        backEdgeAnchors.set(e.from + '>' + e.to, anchor);
      });
    }
    let backEdgeIndex = 0;
    const drawEdge = (fromIdx, toIdx, cls, label, hasTransition) => {
      const isBack = layout.col[toIdx] <= layout.col[fromIdx];
      const path = document.createElementNS(svgNS, 'path');
      let d, a, b, mid, markerId;
      if (freeform) {
        // Disposition "à ressorts" (10/09) : plus de notion "en avant"/"en arrière" pour le TRACÉ -- une
        // simple ligne courbe entre les pourtours des deux nœuds, dans n'importe quelle direction. isBack (calculé
        // plus haut) ne sert plus qu'à choisir la couleur (neutre "boucle" ou neutre "en avant" -- déjà
        // la même teinte depuis le 07/09, gardé séparé ici seulement pour rester cohérent avec le reste
        // du fichier si l'un des deux devait un jour redevenir distinct). Léger arc plutôt qu'une droite
        // pure : une paire de nœuds reliée dans les deux sens (aller ET retour) doit rester lisible comme
        // deux arêtes distinctes, pas une seule ligne se chevauchant elle-même.
        const cA = centerOf(fromIdx), cB = centerOf(toIdx);
        a = seqMapEdgePoint(cA, cB, nodeW, nodeH);
        b = seqMapEdgePoint(cB, cA, nodeW, nodeH);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const bow = Math.max(10, nodeW * 0.12);
        const mx = (a.x + b.x) / 2 + (-dy / len) * bow, my = (a.y + b.y) / 2 + (dx / len) * bow;
        d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
        mid = { x: mx, y: my };
        const color = isBack ? SEQ_MAP_LOOP_COLOR : cssVar('--text-dimmer', '#a8a399');
        path.style.stroke = color;
        markerId = ensureArrowMarker(color, isBack ? 'loop' : 'default');
      } else if (isBack) {
        // Tracé orthogonal (droites + angles droits, 03/09 sur retour direct : "plus clair, notamment
        // dans les systèmes complexes") plutôt qu'une courbe -- descend tout droit, traverse à
        // l'horizontale, remonte tout droit. Aucune ambiguïté de lecture même avec plusieurs boucles
        // imbriquées, contrairement à des courbes qui peuvent se confondre visuellement dans un graphe
        // chargé.
        const anchor = backEdgeAnchors.get(fromIdx + '>' + toIdx) || {};
        a = bottomOf(fromIdx, anchor.fromOffset); b = bottomOf(toIdx, anchor.toOffset);
        const loopY = gridBottom + seqMapLoopMargin() + backEdgeIndex * seqMapLoopStagger();
        backEdgeIndex++;
        d = `M ${a.x} ${a.y} L ${a.x} ${loopY} L ${b.x} ${loopY} L ${b.x} ${b.y}`;
        mid = { x: (a.x + b.x) / 2, y: loopY };
        path.style.stroke = SEQ_MAP_LOOP_COLOR;
        markerId = ensureArrowMarker(SEQ_MAP_LOOP_COLOR, 'loop');
      } else {
        a = rightOf(fromIdx); b = leftOf(toIdx);
        const midX = (a.x + b.x) / 2;
        d = `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
        mid = { x: midX, y: (a.y + b.y) / 2 };
        markerId = ensureArrowMarker(cssVar('--text-dimmer', '#a8a399'), 'default');
      }
      path.setAttribute('d', d);
      path.setAttribute('class', 'seq-map-edge' + (cls ? ' ' + cls : ''));
      path.setAttribute('marker-end', `url(#${markerId})`);
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
      // Repère de transition (03/09) : un disque au milieu du chemin -- couleur retirée du liseré lui-même
      // sur retour direct ("oublie la couleur du liseré bleu"), gardée uniquement sur ce disque, agrandi
      // ("un peu plus visible") pour rester le seul indicateur de transition sur cette arête.
      if (hasTransition) {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', String(mid.x));
        dot.setAttribute('cy', String(mid.y));
        dot.setAttribute('r', '6.5');
        // "Est-ce que la boule peut se colorer lorsqu'elle joue ?" (05/09, retour direct) : classe .playing
        // posée seulement pendant que CE fichier de transition précis est audible (currentTransitionEdge,
        // voir activateSeqStage()) -- distingue "cette arête a une transition" (toujours visible, disque de
        // base) de "cette transition est en train de jouer là, maintenant" (le reste du temps, aucune arête
        // n'est concernée).
        const isPlaying = !!(currentTransitionEdge && currentTransitionEdge.from === fromIdx && currentTransitionEdge.to === toIdx);
        dot.setAttribute('class', 'seq-map-transition-dot' + (isPlaying ? ' playing' : ''));
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
  // afterTime : chercher la frontière qui suit cet instant (au lieu de « maintenant ») -- le minuteur se réveille un peu
  // AVANT la frontière (ENGINE_START_LEAD_SEC) pour programmer la coupure pile dessus, à l'échantillon près.
  function armNextSeqBranchBoundary(myEpoch, afterTime) {
    if (myEpoch !== seqBranchEpoch) return;
    if (!currentSeqBlockInfo || currentSeqBlockInfo.kind !== 'segment') return;
    const slotIdx = currentSeqBlockInfo.slotIdx;
    const slot = (slotIdx != null && slotIdx >= 0) ? (track.segmentSlots || [])[slotIdx] : null;
    if (!slot || !slot.nextOptions || !slot.nextOptions.length) return;
    const quant = slot.quantization || 'bar';
    const segStart = currentSeqBlockInfo.virtualZero;
    const timing = slotTiming(slot);
    const unitSec = quant === 'beat' ? timing.secondsPerBeat : (timing.beatsPerBar * timing.secondsPerBeat);
    const elapsed = Math.max(0, (afterTime != null ? afterTime : ctx.currentTime) - segStart);
    const stepsElapsed = Math.floor(elapsed / unitSec + 1e-6);
    const cutTime = segStart + (stepsElapsed + 1) * unitSec; // toujours la PROCHAINE frontière, strictement après maintenant
    const delayMs = Math.max(0, (cutTime - ENGINE_START_LEAD_SEC - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      if (myEpoch !== seqBranchEpoch) return; // périmée pendant l'attente (nouveau passage ou coupure survenue par ailleurs)
      if (pendingNextSegmentId) performSeqBranchCut(cutTime);
      else armNextSeqBranchBoundary(myEpoch, cutTime); // rien choisi à cette frontière : on surveille la suivante
    }, delayMs);
    seqTimeouts.push(id);
  }
  // Exécute la coupure : termine net ou en fondu (cutStyle) l'emplacement actuellement audible au point de
  // quantification atteint, annule toute génération déjà programmée mais pas encore audible (voir filtrage
  // de seqActiveSources plus bas), puis bascule vers la cible choisie — via un fichier de transition si l'embranchement
  // en déclare un (rejoue ensuite normalement, chevauchement crossfade-tail classique vers la cible), sinon
  // directement. Schéma "quantization"/"cutStyle"/"transition" validé le 02/08.
  // atTime : instant exact de la coupure (frontière de mesure / de temps) ; sans lui (quantification « immédiate »), juste
  // après l'appui.
  function performSeqBranchCut(atTime) {
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
    const now = atTime != null ? Math.max(atTime, ctx.currentTime) : startSoon(); // coupure pile sur la frontière (voir armNextSeqBranchBoundary)
    const opt = (sourceSlot.nextOptions || []).find(o => o.targetId === targetId);
    const oi = opt ? sourceSlot.nextOptions.indexOf(opt) : -1;
    applyFxActions(opt && opt.fxActions); // triggers d'effets liés à cette bascule (23/09)
    const transitionBuf = (oi >= 0 && transitionBuffers[sourceSlotIdx]) ? transitionBuffers[sourceSlotIdx][oi] : null;
    const transitionDurationSec = transitionBuf ? transitionDurationSecFor(opt, sourceSlot) : null;
    // Trois styles de coupure : "hard" (fin nette), "fade" (fondu court fixe, 0.15s — même durée que les
    // autres fondus courts du morceau, solo/muet, embranchement-vertical), "custom" (durée choisie par le
    // compositeur, `sourceSlot.customCutFadeSec`, en secondes réelles — pas en mesures, un fondu de sortie
    // n'a pas besoin d'être quantifié musicalement comme un segment).
    const fadeOutSec = cutStyle === 'custom' ? (sourceSlot.customCutFadeSec != null ? sourceSlot.customCutFadeSec : 0.15) : 0.15;
    // Repère de capture : le bloc suivant (transition ou cible) part sur une COUPURE -- l'outil vidéo éteint alors le
    // bloc quitté comme ici (net ou en fondu), au lieu de le laisser finir sa queue comme dans un enchaînement normal.
    seqPendingCut = { hard: cutStyle === 'hard', fadeSec: cutStyle === 'hard' ? 0 : fadeOutSec };
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
      if (st > ctx.currentTime) { try { src.stop(); } catch (e) {} return false; } // pas encore audible : annulé
      return true;
    });
    seqTimeouts.forEach(id => clearTimeout(id)); seqTimeouts = [];
    if (transitionBuf) {
      // Repère pour le mode Capture (pack.html, 2026-09-15), même principe que seq_slot_start : contrairement
      // à une génération normale (programmée jusqu'à 1s à l'avance), une coupure part quasi immédiatement --
      // pas de décalage d'anticipation à corriger ici.
      seqOutcomeByBuffer.set(transitionBuf, { name: 'seq_transition_start', detail: { trackId: track.id, fromSlotId: sourceSlot.id, targetId } });
      forcedNextBlock = {
        buffer: transitionBuf, label: (opt.transition && opt.transition.label) || t('transitionFallbackLabel'),
        durationSec: transitionDurationSec, terminal: false, kind: 'transition',
        gain: effGain(opt.transition), slotIdx: -1, desc: pickStageDescription(opt.transition),
        // Identité de l'arête (05/09, boule "en train de jouer") -- portée par le bloc plutôt que déduite
        // plus tard : au moment où ce bloc devient réellement audible (voir activateSeqStage), currentSlotIndex
        // pointe déjà sur la cible (posé juste en dessous), donc source/cible ne sont plus récupérables autrement.
        fromSlotIdx: sourceSlotIdx, toSlotIdx: targetIdx
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
  function scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode, desc, fromSlotIdx, toSlotIdx) {
    const delayMs = Math.max(0, (ctxStartTime - ctx.currentTime) * 1000);
    const id = setTimeout(() => {
      pulseMeter(seqMeterEl);
      if (seqCurrentEl) seqCurrentEl.textContent = label;
      // "" (aucun texte propre à cet élément) laisse volontairement le texte déjà affiché tel quel — voir
      // pickStageDescription().
      if (desc && trackDescEl) trackDescEl.innerHTML = linkify(desc);
      if (kind) activateSeqStage(kind, (fillDurationSec != null) ? fillDurationSec : buffer.duration, totalDurationSec, buffer, gainValue, terminal, slotIdx, gainNode, fromSlotIdx, toSlotIdx, ctxStartTime);
    }, delayMs);
    seqTimeouts.push(id);
  }
  // Repères de capture du séquentiel (25/09) : quel évènement annoncer quand un fichier devient audible (renseigné par
  // celui qui choisit le bloc, relu par scheduleSeqGeneration -- aussi pour une reprise en cours de fichier), et la
  // coupure en attente d'être signalée par le prochain bloc.
  const seqOutcomeByBuffer = new Map();
  let seqPendingCut = null;
  function scheduleSeqGeneration(ctxStartTime, buffer, label, kind, fillDurationSec, gainValue, offsetSec, totalDurationSec, terminal, slotIdx, desc, fromSlotIdx, toSlotIdx) {
    if (!buffer) return;
    const off = offsetSec || 0;
    const total = totalDurationSec != null ? totalDurationSec : ((fillDurationSec != null) ? fillDurationSec + off : buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    applyTrackPitchRate(src, ctxStartTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue != null ? gainValue : 1, ctxStartTime);
    // fx : porté par l'emplacement (segmentSlot) pour un segment -- même chaîne quel que soit le tirage
    // qui le remplit, cf. la logique retenue pour vertical-random (pool) -- ou par intro/outro directement
    // pour ces deux cas particuliers, qui n'ont qu'un seul fichier chacun.
    const fxSource = kind === 'segment' ? (slotIdx != null ? (track.segmentSlots || [])[slotIdx] : null)
      : kind === 'intro' ? track.intro : kind === 'outro' ? track.outro : null;
    const fxChain = buildTargetFxChain(kind === 'segment' && slotIdx != null ? 'slot:' + slotIdx : kind, fxSource && fxSource.fx, src, ctxStartTime);
    if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
    g.connect(trackMasterGain);
    // Chaque bloc rejoue une fois sans boucle -- onended est un point de nettoyage fiable pour le
    // bitcrusher, comme pour les autres moteurs. armSeqFinalEnd() (bloc terminal) CHAÎNE sur ce handler
    // plutôt que de l'écraser -- voir son commentaire.
    if (fxChainHasLeakyNode(fxChain)) {
      src.onended = () => { disconnectLeakyFxNodes(fxChain); };
    }
    journalVoice(src, g, fxChain);
    src.start(ctxStartTime, off);
    seqActiveSources.push({ src, gain: g, ctxStartTime });
    // Télémétrie + repère de capture du bloc, émis au moment où il devient AUDIBLE (pas quand il est programmé,
    // jusqu'à 1 s plus tôt) : un bloc programmé puis annulé par une coupure (seqTimeouts vidé) n'est jamais annoncé.
    // Un bloc repris en cours de fichier (saut dans la frise, reprise après pause) n'est qu'un repère de capture :
    // il ne compte pas une deuxième fois dans les statistiques.
    const outcome = seqOutcomeByBuffer.get(buffer);
    const cut = off > 0 ? null : seqPendingCut;
    if (off <= 0) seqPendingCut = null;
    if (outcome) {
      const emitId = setTimeout(() => {
        const detail = Object.assign({}, outcome.detail, cut ? { cut } : {});
        if (off > 0) captureMark(outcome.name, Object.assign(detail, { offset: off, resumed: true, at: ctxStartTime }));
        else trackPublicEvent(outcome.name, detail, { at: ctxStartTime });
      }, Math.max(0, (ctxStartTime - ctx.currentTime) * 1000));
      seqTimeouts.push(emitId);
    }
    seqLastGenSources = [src];
    // Sans durée explicite (cas de l'outro, qui ne programme rien après elle) : on anime le remplissage
    // sur la durée réelle du fichier décodé, seule longueur connue dans ce cas.
    scheduleSeqLabelUpdate(ctxStartTime, label, kind, fillDurationSec, total, buffer, gainValue, terminal, slotIdx, g, desc, fromSlotIdx, toSlotIdx);
  }
  // Détermine le prochain bloc à programmer : soit l'outro (si "Aller vers la fin" a été demandé et
  // qu'une outro existe), soit rien du tout (demande faite mais pas d'outro : on laisse filer), soit
  // un segment tiré au sort. `terminal: true` signifie "rien à programmer après ce bloc".
  function decideNextSeqBlock() {
    if (forcedNextBlock) { const b = forcedNextBlock; forcedNextBlock = null; return b; }
    if (goToEndRequested) {
      goToEndRequested = false;
      if (outroBuffer) {
        // Repère pour le mode Capture -- l'outro est terminale (rien après), donc sa durée réelle n'a pas
        // besoin d'être anticipée par materializeLayerSegments : elle va jusqu'à la fin de la prise.
        seqOutcomeByBuffer.set(outroBuffer, { name: 'seq_outro_start', detail: { trackId: track.id } });
        return { buffer: outroBuffer, label: (track.outro && track.outro.label) || 'Outro', durationSec: null, terminal: true, kind: 'outro', gain: effGain(track.outro), desc: pickStageDescription(track.outro) };
      }
      return null;
    }
    const picked = pickNextSegmentSlot();
    if (!picked) return null;
    const slot = track.segmentSlots[picked.slotIdx];
    const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
    // Repère générique pour le mode Capture (pack.html, 2026-09-15) : contrairement à seq_branch_select
    // (qui ne fire que sur un clic manuel d'embranchement), ce point de passage voit TOUJOURS un nouveau
    // segment, qu'il vienne d'un enchaînement automatique ou d'une coupure -- même principe que
    // embr_loop_select pour l'embranchement-vertical. altIndex précise quelle variation a été tirée au
    // sort, indispensable pour rejouer fidèlement ce qui a vraiment été entendu. Purement une nouvelle
    // ligne d'analytics, silencieuse si personne ne l'écoute -- aucun effet sur la lecture elle-même.
    // Note : programmé jusqu'à `lookahead` (1s) avant de devenir réellement audible (voir seqSchedulerTick
    // plus bas), donc légèrement en avance sur le son perçu -- acceptable pour une capture, pas pour un
    // minutage sample-accurate.
    seqOutcomeByBuffer.set(slotBuffers[picked.slotIdx][picked.altIdx], { name: 'seq_slot_start', detail: { trackId: track.id, slotId: slot.id, altIndex: picked.altIdx } });
    return { buffer: slotBuffers[picked.slotIdx][picked.altIdx], label: (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))), durationSec: blockSeconds(alt && alt.bars, slot), terminal: false, kind: 'segment', gain: effGain(alt), slotIdx: picked.slotIdx, desc: pickStageDescription(slot) };
  }
  function armSeqFinalEnd() {
    const marker = seqLastGenSources[0];
    if (!marker) return;
    seqFinalMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé par scheduleSeqGeneration (nettoyage du bitcrusher, voir
    // plus haut) plutôt que de l'écraser -- affecter .onended REMPLACE tout gestionnaire précédent, pas
    // un addEventListener -- l'écraser aurait fait fuir le ScriptProcessorNode du bloc terminal.
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
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
      scheduleSeqGeneration(seqNextStartCtxTime, next.buffer, next.label, next.kind, next.terminal ? null : next.durationSec, next.gain, 0, null, next.terminal, next.slotIdx, next.desc, next.fromSlotIdx, next.toSlotIdx);
      if (next.terminal) {
        clearInterval(seqSchedulerTimer); seqSchedulerTimer = null;
        armSeqFinalEnd();
        return;
      }
      seqNextStartCtxTime += next.durationSec / trackPitchRatio;
    }
  }
  function stopSequential() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
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
    updateSeqPendingIndicator();
    // Carte globale (02/09) : plus aucun nœud "courant" une fois arrêté -- l'historique (seqVisitedSlotIds)
    // reste volontairement affiché tel quel (ce qui a été découvert cette session le reste), voir
    // playSequential() pour le seul cas où il est vraiment remis à zéro (un vrai redémarrage, pas juste Stop).
    // Idem pour la boule de transition (05/09) : plus rien n'est audible à l'arrêt, jamais "en train de jouer".
    currentTransitionEdge = null;
    updateSeqMap(-1);
  }
  function playSequential(isContinuation) {
    stopSequential();
    // Un vrai démarrage (pas une reprise après pause/veille) repart du premier emplacement de la chaîne —
    // la reprise, elle, continue le cycle là où il en était plutôt que de tout redémarrer. La carte globale
    // suit la même règle : un vrai redémarrage efface l'historique de découverte, une reprise le conserve.
    if (!isContinuation) { currentSlotIndex = 0; chainState = { cyclesCompleted: 0, capReached: false }; seqVisitedSlotIds = new Set(); }
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    let firstBuffer, firstLabel, firstDurationSec, firstKind, firstGain, firstDesc, firstSlotIdx = -1;
    if (!isContinuation && introBuffer) {
      // L'intro n'appartient à aucun emplacement — son tempo suit celui du premier emplacement de la
      // chaîne (position 0, point de départ conventionnel), même principe que le vertical-random dont
      // l'intro suit le tempo de la première section jouable.
      const firstSlot = (track.segmentSlots || [])[0];
      firstBuffer = introBuffer; firstLabel = (track.intro && track.intro.label) || 'Intro'; firstDurationSec = blockSeconds(track.intro && track.intro.bars, firstSlot); firstKind = 'intro'; firstGain = effGain(track.intro); firstDesc = pickStageDescription(track.intro);
      // Repère pour le mode Capture -- l'intro ne passe jamais par decideNextSeqBlock() (voir son
      // commentaire pour seq_slot_start), donc pas couverte par ce repère-là : son propre événement.
      seqOutcomeByBuffer.set(introBuffer, { name: 'seq_intro_start', detail: { trackId: track.id } });
    } else {
      const picked = pickNextSegmentSlot();
      if (!picked) { if (statusEl) statusEl.textContent = t('noSegmentAvailable'); return; }
      const slot = track.segmentSlots[picked.slotIdx];
      const alt = resolveSlotAlternative(picked.slotIdx, picked.altIdx);
      // Même repère que dans decideNextSeqBlock() ci-dessus, pour le tout premier segment (celui-ci ne
      // passe jamais par decideNextSeqBlock() -- voir le commentaire là-bas pour le raisonnement complet).
      seqOutcomeByBuffer.set(slotBuffers[picked.slotIdx][picked.altIdx], { name: 'seq_slot_start', detail: { trackId: track.id, slotId: slot.id, altIndex: picked.altIdx } });
      firstBuffer = slotBuffers[picked.slotIdx][picked.altIdx]; firstLabel = (alt && alt.label) || (slot.label || ('Emplacement ' + (picked.slotIdx + 1))); firstDurationSec = blockSeconds(alt && alt.bars, slot); firstKind = 'segment'; firstGain = effGain(alt); firstSlotIdx = picked.slotIdx; firstDesc = pickStageDescription(slot);
    }
    scheduleSeqGeneration(now, firstBuffer, firstLabel, firstKind, firstDurationSec, firstGain, 0, null, false, firstSlotIdx, firstDesc);
    seqNextStartCtxTime = now + firstDurationSec / trackPitchRatio;
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
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
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
      seqNextStartCtxTime = now + remaining / trackPitchRatio;
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
    fxTriggerBtns.forEach(b => { b.disabled = !enabled; });
    fxSliderInputs.forEach(i => { i.disabled = !enabled; });
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
      : (loops ? ((ctx.currentTime - startedAt) * trackPitchRatio) % track.duration : Math.min((ctx.currentTime - startedAt) * trackPitchRatio, track.duration));
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
    pauseTake(); // pause, arrêt ou fin naturelle : le temps d'écoute de la prise s'arrête là
    playIcon.innerHTML = PLAY_SVG;
    if (statusEl) statusEl.textContent = t('pausedStatus');
  }

  /* ---- Moteur simple (bouclage natif, comportement existant inchangé) ---- */
  function stopSimple(keepPosition) {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    if (keepPosition !== false) {
      offsetAt = computeElapsed();
    }
    sources.forEach(s => { if (s) { try { s.stop(); } catch(e){} } });
    // Un ScriptProcessorNode fx (bitcrusher/pitch-shift) continue de traiter du silence tant qu'il reste
    // connecté -- déconnexion explicite ici, contrairement aux autres nœuds fx (coût négligeable une fois
    // la source arrêtée, laissés au ramasse-miettes comme le reste du graphe).
    layerFxChains.forEach(chain => disconnectLeakyFxNodes(chain));
    sources = []; gains = []; layerFxChains = [];
  }
  function playSimple() {
    const nowStart = startSoon(); // toutes les couches sur un même instant (voir startSoon)
    startedAt = nowStart - offsetAt / trackPitchRatio;
    const p = profiles[level] || profiles[0];
    // Repère de capture : toutes les couches démarrent ici, à cette position du fichier, en boucle ou non, au niveau
    // d'intensité en cours (le visiteur a pu le choisir avant d'appuyer sur Lecture).
    captureMark('layer_run', { trackId: track.id, offset: offsetAt % track.duration, loop: loops ? [0, track.duration] : null, level, at: nowStart });
    for (let i = 0; i < buffers.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      if (loops) { src.loop = true; src.loopStart = 0; src.loopEnd = track.duration; }
      // Moteur simple : le bouclage natif (loopStart/loopEnd, en temps de BUFFER) reste correct quel que
      // soit playbackRate -- pas besoin de diviser une durée programmée par ailleurs, contrairement aux
      // moteurs qui calculent eux-mêmes "dans x secondes réelles" en JS (voir plus bas dans ce fichier).
      applyTrackPitchRate(src, nowStart, true);
      const g = ctx.createGain();
      g.gain.setValueAtTime((p[i] || 0) * effGain(layersToLoad[i]) * voiceGain('layer-' + i), nowStart);
      const fxChain = buildTargetFxChain('layer:' + i, layersToLoad[i] && layersToLoad[i].fx, src, nowStart);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      journalVoice(src, g, fxChain);
      src.start(nowStart, offsetAt % track.duration);
      sources[i] = src; gains[i] = g; layerFxChains[i] = fxChain;
      if (isStatic && !loops) {
        const layerIndex = i;
        src.onended = () => {
          // Un morceau statique non bouclable finit ici SANS jamais passer par stopSimple() -- sans ce
          // nettoyage propre, un fx à ScriptProcessorNode (s'il y en a un) continuerait de tourner
          // indéfiniment après une fin naturelle (trouvé le 22/09, en écho au même souci déjà réglé pour
          // le moteur quantifié -- même risque, chemin de code différent, pas détecté au premier passage).
          disconnectLeakyFxNodes(fxChain);
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
    // Repère de capture : une nouvelle génération de toutes les couches (moteur quantifié), depuis bufferOffset, au niveau
    // d'intensité en cours -- programmée jusqu'à 1 s plus tôt (at = son instant de départ). Une génération programmée puis annulée par un
    // arrêt est effacée par le repère voices_stop qui la précède.
    captureMark('layer_gen', { trackId: track.id, bufferOffset, level, at: ctxStartTime });
    const thisGenSources = [];
    const p = profiles[level] || profiles[0];
    const gensThisRound = [];
    for (let i = 0; i < buffers.length; i++) {
      if (!buffers[i]) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      applyTrackPitchRate(src, ctxStartTime);
      const g = ctx.createGain();
      const key = 'layer-' + i;
      const base = (p[i] || 0) * effGain(layersToLoad[i]);
      g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
      const fxChain = buildTargetFxChain('layer:' + i, layersToLoad[i] && layersToLoad[i].fx, src, ctxStartTime);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      // Ce moteur régénère une chaîne à chaque nouvelle génération sans jamais les déconnecter -- sans
      // conséquence pour les nœuds fx natifs (filtre/reverb/écho, coût quasi nul une fois la source
      // arrêtée), mais un bitcrusher (ScriptProcessorNode) continuerait de traiter du silence en boucle
      // indéfiniment si on le laissait connecté. src.onended se déclenche de façon fiable à la fin
      // naturelle de CETTE génération (chaque source ici joue une fois, sans loop -- la suivante prend le
      // relais) et aussi si stopSimple()-équivalent l'arrête manuellement (.stop() déclenche onended) --
      // point de nettoyage correct dans les deux cas, jamais de fuite à accumuler sur une session longue.
      if (fxChainHasLeakyNode(fxChain)) {
        src.onended = () => { disconnectLeakyFxNodes(fxChain); };
      }
      journalVoice(src, g, fxChain);
      src.start(ctxStartTime, bufferOffset);
      activeGenSources.push({ src, gain: g, voiceKey: key, baseGain: base });
      thisGenSources.push(src);
      gensThisRound[i] = g;
    }
    currentGainNodes = gensThisRound;
    lastGenSources = thisGenSources;
    scheduledGens.push({ ctxStartTime, bufferOffset, ratio: trackPitchRatio });
    const cutoff = ctx.currentTime - Math.max(cycleLength / trackPitchRatio, 4) * 2;
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
      // /trackPitchRatio : cycleLength reste la durée MUSICALE nominale (réutilisée telle quelle ailleurs,
      // ex. affichage) -- seul l'avancement du planificateur en temps RÉEL doit en tenir compte, puisqu'un
      // buffer joué à trackPitchRatio défile trackPitchRatio fois plus vite que sa durée nominale.
      nextGenStartCtxTime += cycleLength / trackPitchRatio;
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
    // Chaîne sur un éventuel onended déjà posé par scheduleGeneration (nettoyage du bitcrusher) plutôt
    // que de l'écraser -- même risque et même correctif que armSeqFinalEnd()/armVRFinalEnd().
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
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
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
    finalGenerationMarkerSrc = null;
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    activeGenSources.forEach(({ src }) => { try { src.stop(); } catch(e){} });
    activeGenSources = [];
    voiceGraphTimeouts.forEach(id => clearTimeout(id));
    voiceGraphTimeouts = [];
  }
  function playQuantized(fromOffsetSec) {
    stopQuantized();
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    scheduleGeneration(now, fromOffsetSec);
    let timeUntilNext;
    if (fromOffsetSec < loopInSec) {
      timeUntilNext = loopOutSec - fromOffsetSec;
    } else {
      const positionInLoop = (fromOffsetSec - loopInSec) % cycleLength;
      timeUntilNext = cycleLength - positionInLoop;
    }
    nextGenStartCtxTime = now + Math.max(0.02, timeUntilNext / trackPitchRatio);
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
    applyTrackPitchRate(src, ctxStartTime);
    // Un morceau qui utilise bitcrusher/pitch-shift retarde ses voix d'effet : la transition (overlay) suit le même retard.
    if (fxNeedsComp) { const comp = withLatencyComp(ctx, null); src.connect(comp.input); comp.output.connect(trackMasterGain); }
    else src.connect(trackMasterGain);
    journalVoice(src, null, fxNeedsComp ? { __lpMeta: { fx: null, force: [], comp: true } } : null);
    src.start(ctxStartTime, 0);
    embrMark('embr_transition', { loopId: ((track.loops || [])[loopIdx] || {}).id, at: ctxStartTime });
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
  // startPosSec (25/09, seek par clic sur la forme d'onde) : position dans le cycle à laquelle l'animation
  // reprend (délai négatif). L'animation est toujours REDÉMARRÉE (animation: none + reflow) plutôt que
  // simplement relancée -- sinon elle repartirait de là où elle avait été mise en pause, désynchronisée
  // de l'audio, et un clip-path posé pendant un glisser resterait masqué par l'animation.
  function applyEmbrWaveAnimation(startPosSec) {
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return;
    embrLoopBtns.forEach(btn => {
      const fg = btn.querySelector('.embr-wave-fg');
      if (!fg) return;
      fg.style.animation = 'none';
      fg.style.clipPath = '';
      void fg.offsetWidth;
      fg.style.animation = '';
      fg.style.animationDuration = cycle + 's';
      fg.style.animationDelay = (-(startPosSec || 0)) + 's';
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
    renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
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
    renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
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
  function scheduleEmbrGeneration(ctxStartTime, isFirst, offsetOverride) {
    const timing = embrLoopTiming();
    const bufferOffset = offsetOverride != null ? offsetOverride : (isFirst ? timing.startSec : timing.loopInSec);
    // Repère de capture : nouvelle génération des boucles jumelles (toutes démarrent ensemble, seule la boucle active
    // est audible).
    captureMark('embr_gen', { trackId: track.id, bufferOffset, at: ctxStartTime,
      active: embrActiveLoopIdx >= 0 ? ((track.loops || [])[embrActiveLoopIdx] || {}).id : null,
      peers: embrPeerIndices.map(i => ((track.loops || [])[i] || {}).id) });
    embrPeerIndices.forEach(idx => {
      const buf = embrLoopBuffers[idx];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      applyTrackPitchRate(src, ctxStartTime);
      const g = ctx.createGain();
      g.gain.setValueAtTime(idx === embrActiveLoopIdx ? 1 : 0, ctxStartTime);
      const loopDef = (track.loops || [])[idx];
      const fxChain = buildTargetFxChain('loop:' + idx, loopDef && loopDef.fx, src, ctxStartTime);
      if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
      g.connect(trackMasterGain);
      // Même raisonnement que scheduleGeneration() (moteur quantifié) : cette génération rejoue une fois
      // sans boucle, son onended est donc un point de nettoyage fiable pour le bitcrusher.
      if (fxChainHasLeakyNode(fxChain)) {
        src.onended = () => { disconnectLeakyFxNodes(fxChain); };
      }
      journalVoice(src, g, fxChain);
      src.start(ctxStartTime, bufferOffset);
      embrActiveGenSources.push({ src, gain: g, loopIdx: idx, ctxStartTime });
    });
    // Purge des générations trop anciennes pour ne plus jamais sonner (même logique de nettoyage que
    // scheduledGens du moteur quantifié) — évite une croissance illimitée du tableau sur une lecture longue.
    const cutoff = ctx.currentTime - Math.max(embrCycleLengthSec() / trackPitchRatio, 4) * 2;
    if (embrActiveGenSources.length > 40) embrActiveGenSources = embrActiveGenSources.filter(g => g.ctxStartTime >= cutoff);
  }
  function embrSchedulerTick() {
    const lookahead = 1.0;
    while (embrNextStartCtxTime < ctx.currentTime + lookahead) {
      scheduleEmbrGeneration(embrNextStartCtxTime, false); // jamais "Départ" ici, uniquement au tout premier lancement (playEmbrVertical)
      embrNextStartCtxTime += embrCycleLengthSec() / trackPitchRatio;
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
    embrMark('embr_gains', { loopId: activeLoopDef ? activeLoopDef.id : null, fadeSec });
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
  // Fondu de sortie IMMÉDIAT d'une boucle "paire" quittée, déclenché dès qu'une transition démarre plutôt
  // que d'attendre la fin de celle-ci (05/09, retour direct : "la boucle continue de jouer pendant la
  // transition, je ne veux plus ça"). Avant ce correctif, la boucle quittée restait à plein volume pendant
  // toute la durée de la transition -- gain remis à 0 seulement par refreshEmbrGains() une fois la
  // transition terminée (voir performEmbrSwitch) -- d'où un mélange boucle+transition entendu par
  // Jules-Antoine. Même principe que performSeqBranchCut() côté séquentiel (le bloc quitté y est fondu
  // tout de suite, la transition suivant en bloc distinct) : ici la boucle ducke sur son propre
  // cutStyle/customCutFadeSec (embrCutFadeSec, "fondu de sortie propre à CETTE boucle", même repli que
  // fadeOutCurrentDetour) pendant que le fichier de transition joue seul par-dessus. Ne touche que la
  // source `sourceIdx` -- les autres boucles paires sont déjà à gain 0, refreshEmbrGains() s'occupera de
  // faire monter la cible une fois la transition terminée.
  function duckEmbrSourceLoop(sourceIdx, sourceLoopDef) {
    if (sourceIdx < 0) return; // aucune boucle paire active à ce moment (détour en cours, déjà géré par fadeOutCurrentDetour())
    const now = ctx.currentTime;
    const fadeSec = embrCutFadeSec(sourceLoopDef);
    embrMark('embr_duck', { loopId: sourceLoopDef ? sourceLoopDef.id : null, fadeSec });
    embrActiveGenSources.forEach(({ gain, loopIdx }) => {
      if (!gain || loopIdx !== sourceIdx) return;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (fadeSec <= 0) gain.gain.setValueAtTime(0, now);
      else gain.gain.linearRampToValueAtTime(0, now + fadeSec);
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
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrReferenceStartCtxTime = now;
    scheduleEmbrGeneration(now, true); // fixe déjà le bon gain (1) sur preservedIdx via embrActiveLoopIdx ci-dessus
    embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    updateEmbrButtonsUI();
    applyEmbrWaveAnimation();
  }
  // Seek (25/09, demande directe : "on ne peut pas cliquer dans la barre de lecture pour faire avancer la
  // tête de lecture") : `fraction` = position dans le cycle Entrée->Sortie, la même échelle que le
  // remplissage animé des lignes riches. Toutes les boucles paires restant verrouillées en phase, on les
  // relance TOUTES au même point -- la boucle audible reste la même, seule la position change. Contrairement
  // à resumeEmbrVerticalAfterBackground(), on ne passe pas par stopEmbrVertical() : un minuteur de retour
  // auto en cours doit survivre au seek (même raisonnement que seekSequential()). L'horloge de phase est
  // recalée pour que la quantification des bascules suivantes (embrQuantizeDelaySec) reste juste.
  function seekEmbrVertical(fraction) {
    const timing = embrLoopTiming();
    const cycle = timing.cycleLength;
    if (!(cycle > 0) || embrActiveLoopIdx < 0) return;
    const posSec = Math.max(0, Math.min(1, fraction)) * cycle;
    if (embrSchedulerTimer) { clearInterval(embrSchedulerTimer); embrSchedulerTimer = null; }
    // Repère de capture : seules les générations des boucles jumelles s'arrêtent (transition ou détour éventuels continuent).
    captureMark('voices_stop', { trackId: track.id, scope: 'embr_gens' });
    embrActiveGenSources.forEach(({ src }) => { try { src.stop(); } catch (e) {} });
    embrActiveGenSources = [];
    // Un seek pendant le segment Départ->Entrée du premier lancement saute directement dans le cycle :
    // le verrouillage des boutons propre à ce segment n'a plus lieu d'être.
    if (embrIntroLockTimeout) {
      clearTimeout(embrIntroLockTimeout); embrIntroLockTimeout = null;
      embrLoopBtns.forEach(btn => { btn.disabled = false; });
    }
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrReferenceStartCtxTime = now - posSec / trackPitchRatio;
    scheduleEmbrGeneration(now, false, timing.loopInSec + posSec);
    embrNextStartCtxTime = now + (cycle - posSec) / trackPitchRatio;
    embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
    applyEmbrWaveAnimation(posSec);
  }
  function playEmbrVertical() {
    stopEmbrVertical();
    embrActiveLoopIdx = embrReferenceIdx;
    applyFxActions(((track.loops || [])[embrReferenceIdx] || {}).fxActions); // état de départ = celui de la boucle de référence
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    embrReferenceStartCtxTime = now; // point zéro de l'horloge de phase, utilisé par embrQuantizeDelaySec()
    scheduleEmbrGeneration(now, true); // seul appel avec isFirst=true -- démarre à "Départ", pas "Entrée"
    embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
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
      }, introSec * 1000 / trackPitchRatio);
    }
  }
  function stopEmbrVertical() {
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
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
    embrMark('embr_detour_out', { loopId: leavingLoopDef ? leavingLoopDef.id : null, fadeSec });
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
    // Durées converties en temps RÉEL (÷ trackPitchRatio) : elapsed vient de ctx.currentTime, alors que
    // le cycle et le temps musical sont exprimés en temps nominal du fichier (pitch "vitesse", 23/09).
    const cycle = embrCycleLengthSec() / trackPitchRatio;
    if (!(cycle > 0)) return 0;
    const elapsed = ((ctx.currentTime - embrReferenceStartCtxTime) % cycle + cycle) % cycle;
    const beatDuration = 60 / bpm / trackPitchRatio;
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
  // Repères de capture de l'embranchement-vertical (25/09) : chaque commande de volume réellement donnée par le moteur
  // (bascule entre boucles jumelles, baisse de la boucle quittée pendant une transition, entrée/sortie d'un détour,
  // départ d'une transition) est annoncée à l'outil vidéo au moment où elle a lieu, avec la clé de la bascule qui l'a
  // provoquée (k) et celle de sa bascule « parente » (pk : un retour automatique suit la bascule qui l'a armé). Déplacer
  // une bascule sur la frise déplace ainsi tout ce qu'elle a déclenché, et rien d'autre.
  let embrSwitchSeq = 0, embrMarkKey = null, embrMarkParentKey = null, embrPendingParentKey = null;
  function embrMark(name, detail) {
    captureMark(name, Object.assign({ trackId: track.id }, embrMarkKey ? { k: embrMarkKey } : {}, embrMarkParentKey ? { pk: embrMarkParentKey } : {}, detail));
  }
  function withEmbrKey(k, pk, fn) {
    const k0 = embrMarkKey, pk0 = embrMarkParentKey;
    embrMarkKey = k; embrMarkParentKey = pk;
    try { return fn(); } finally { embrMarkKey = k0; embrMarkParentKey = pk0; }
  }
  function performEmbrSwitch(idx) {
    const swKey = 'sw' + (++embrSwitchSeq), swParent = embrPendingParentKey;
    embrPendingParentKey = null;
    return withEmbrKey(swKey, swParent, () => performEmbrSwitchInner(idx, swKey, swParent));
  }
  function performEmbrSwitchInner(idx, swKey, swParent) {
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
      // Transition (29/08, ducking ajouté le 05/09) : jouée tout de suite. La boucle quittée ducke
      // immédiatement sur son propre fondu de sortie (duckEmbrSourceLoop) plutôt que de continuer à plein
      // volume pendant toute la transition -- seul le fichier de transition doit s'entendre entre les deux
      // boucles. La bascule réelle (embrActiveLoopIdx + gains + UI) n'intervient elle qu'une fois la
      // transition terminée, exactement comme une coupure immédiate ordinaire à cet instant-là -- jamais de
      // gain différé en parallèle du planificateur périodique.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) / trackPitchRatio : 0; // temps réel (la transition joue aussi à trackPitchRatio)
      if (transBuf) { playEmbrTransitionIfAny(idx, ctx.currentTime); duckEmbrSourceLoop(embrActiveLoopIdx, sourceLoopDef); }
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const doSwitch = () => withEmbrKey(swKey, swParent, () => {
        removeEmbrTransitionOverlay();
        applyFxActions(loopDef && loopDef.fxActions); // triggers d'effets liés à cette boucle (23/09)
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
              embrPendingParentKey = swKey; // le retour suit la bascule qui l'a armé (voir embrMark)
              performEmbrSwitch(embrReferenceIdx); // retour direct, sans quantification supplémentaire -- le délai est déjà exprimé en unités musicales
            }, sec * 1000 / trackPitchRatio);
          }
        }
      });
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
      // Transition (29/08, ducking ajouté le 05/09) : même principe que la branche "paire" ci-dessus --
      // jouée tout de suite, la voix paire encore active (si elle existe -- fadeOutCurrentDetour() a déjà
      // géré le cas d'un détour précédent juste au-dessus) ducke immédiatement sur son propre fondu de
      // sortie plutôt que de continuer à plein volume jusqu'au démarrage réel du détour.
      const transBuf = embrTransitionBuffers[idx];
      const transDelay = transBuf ? embrTransitionDurationSecFor(loopDef, sourceLoopDef, transBuf) / trackPitchRatio : 0; // temps réel (la transition joue aussi à trackPitchRatio)
      if (transBuf) { playEmbrTransitionIfAny(idx, ctx.currentTime); duckEmbrSourceLoop(embrActiveLoopIdx, sourceLoopDef); }
      if (transBuf) showEmbrTransitionOverlay(embrActiveLoopIdx, idx, transBuf, transDelay);
      const startDetour = () => withEmbrKey(swKey, swParent, () => {
        removeEmbrTransitionOverlay();
        applyFxActions(loopDef && loopDef.fxActions); // triggers d'effets liés à ce détour (23/09)
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
        applyTrackPitchRate(src, now);
        const fxChain = buildTargetFxChain('loop:' + idx, loopDef && loopDef.fx, src, now);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        // onended se déclenche aussi bien à la fin naturelle (détour non bouclé) qu'à l'arrêt manuel
        // (stopEmbrVertical()/fadeOutCurrentDetour() appellent .stop(), qui déclenche onended) -- un seul
        // point de nettoyage couvre les deux cas.
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(now, 0);
        embrMark('embr_detour_in', { loopId: loopDef && loopDef.id, fadeSec, loop: !!loopsUntilButton });
        embrDetourSource = { src, gain: g };
        embrDetourBtn = btn;
        if (loopsUntilButton) {
          // Pas de minuterie de retour ici : ça tourne jusqu'à ce qu'on clique sur "Mettre fin à la boucle"
          // (ou sur le bouton d'une autre boucle, qui interrompt aussi ce détour via fadeOutCurrentDetour()).
          showEmbrEndLoopButton(loopDef);
          showEmbrDetourWaveRow(buf, buf.duration / trackPitchRatio, true);
        } else {
          // Durée propre à CETTE boucle détour si elle a son propre tempo (bpm/beatsPerBar, 24/08) --
          // blockSeconds() accepte déjà un `slot` optionnel avec repli sur le tempo du morceau, exactement
          // le même mécanisme que slotTiming()/sectionTiming() ailleurs dans ce fichier, réutilisé tel quel.
          const durationSec = blockSeconds(loopDef && loopDef.bars, loopDef) / trackPitchRatio; // temps réel
          showEmbrDetourWaveRow(buf, durationSec, false);
          embrDetourTimeout = setTimeout(() => withEmbrKey(swKey + ':ret', swKey, () => { // fin du détour : suit son départ
            fadeOutCurrentDetour();
            embrActiveLoopIdx = embrReferenceIdx;
            refreshEmbrGains(embrReferenceIdx);
            updateEmbrButtonsUI();
          }), durationSec * 1000);
        }
        updateEmbrButtonsUI();
      });
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
  // Cliquer/glisser sur la forme d'onde de la boucle EN COURS (gabarit riche uniquement) déplace la tête
  // de lecture -- même principe que les blocs séquentiels : position affichée en direct pendant le
  // glisser, seek audio réel seulement au relâchement. Un clic sur une AUTRE ligne reste une bascule de
  // boucle (inchangé). Pas de seek pendant un détour, une transition ou une bascule quantifiée en attente :
  // l'horloge de phase y est déjà engagée vers autre chose.
  embrLoopBtns.forEach(btn => {
    if (!btn.classList.contains('embr-wave-btn')) return;
    const idx = parseInt(btn.dataset.loopIdx, 10);
    let dragging = false;
    function fractionFromEvent(e) {
      const rect = btn.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function showFraction(frac) {
      embrLoopBtns.forEach(b => {
        const fg = b.querySelector('.embr-wave-fg');
        if (!fg) return;
        fg.style.animation = 'none';
        fg.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      });
    }
    function isSeekable() {
      return playing && idx === embrActiveLoopIdx && !embrDetourSource
        && !embrPendingSwitchTimeout && !embrPendingTransitionSwitchTimeout;
    }
    btn.addEventListener('pointerdown', (e) => {
      if (!isSeekable()) return;
      dragging = true;
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      showFraction(fractionFromEvent(e));
    });
    btn.addEventListener('pointermove', (e) => {
      if (dragging) showFraction(fractionFromEvent(e));
    });
    btn.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      if (!isSeekable()) { applyEmbrWaveAnimation(embrCurrentCyclePosSec()); return; }
      trackPublicEvent('embr_seek', { trackId: track.id });
      seekEmbrVertical(fractionFromEvent(e));
    });
    btn.addEventListener('pointercancel', () => {
      if (!dragging) return;
      dragging = false;
      applyEmbrWaveAnimation(embrCurrentCyclePosSec());
    });
  });
  // Position actuelle dans le cycle (temps nominal du fichier) -- sert à remettre l'animation en place
  // quand un glisser est annulé sans seek.
  function embrCurrentCyclePosSec() {
    const cycle = embrCycleLengthSec();
    if (!(cycle > 0)) return 0;
    const elapsed = (ctx.currentTime - embrReferenceStartCtxTime) * trackPitchRatio;
    return ((elapsed % cycle) + cycle) % cycle;
  }

  /* ---- Moteur vertical-random : sections chaînées, chacune avec ses pools simultanés et son propre
     tempo/timeline (30/07). La décision "quoi jouer ensuite" vient entièrement de
     createSectionPlaybackScheduler (logique pure, testée indépendamment — voir test-section-scheduler.js) ;
     ce qui suit ne fait que traduire ses décisions en programmation Web Audio réelle. ---- */
  let vrNextStartCtxTime = 0;
  let vrIsDraggingSeek = false; // pendant un glissement sur le bloc de section actif : le tick() n'écrase pas le remplissage affiché
  let vrSchedulerTimer = null;
  let vrCurrentSectionOriginalIndex = -1; // pour savoir quand la section affichée doit changer (rebuild du graphe)
  let vrPendingCut = false;
  function emitVROutcome(name, at, detail) {
    const cut = vrPendingCut; vrPendingCut = false;
    voiceGraphTimeouts.push(setTimeout(() => {
      trackPublicEvent(name, Object.assign({}, detail, cut ? { cut: { hard: true, fadeSec: 0 } } : {}), { at });
    }, Math.max(0, (at - ctx.currentTime) * 1000)));
  }
  function scheduleSectionGeneration(ctxStartTime, secIdx, isFirstEverForThisSection, offsetOverride) {
    const section = resolveVRSection(track, secIdx);
    const declaredSection = (track.sections || [])[secIdx];
    const timing = sectionTiming(section);
    const bufferOffset = offsetOverride != null ? offsetOverride : (isFirstEverForThisSection ? timing.startTrackSec : timing.loopInSec);
    const pools = section.pools || [];
    const poolPicks = [];
    const telemetryPicks = []; // { poolIndex, altIndex } par pool réellement tiré CE cycle -- seule donnée qui
    // permette de reproduire fidèlement l'audio à l'export (moteur de capture, pack.html) sans pour autant
    // détailler le pool dans l'éditeur de frise lui-même (demande explicite de Jules-Antoine le 2026-09-16 :
    // "dans l'éditeur, on ne détaille pas le contenu du pool" -- ce champ reste un détail interne à
    // l'événement, jamais affiché comme une piste séparée).
    pools.forEach((pool, poolIdx) => {
      const displaySlot = poolIdx; // les sections d'un même morceau ont chacune leur propre liste de pools,
      // affichée dans les mêmes emplacements visuels 0..N-1 (voir vrMaxPoolCount) — une section avec moins
      // de pools laisse simplement les emplacements suivants masqués.
      const bufs = (sectionBuffers[secIdx] && sectionBuffers[secIdx][poolIdx]) || [];
      const idx = pickPoolAlternativeIndex(secIdx, poolIdx);
      telemetryPicks.push({ poolIndex: displaySlot, altIndex: idx });
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
          applyTrackPitchRate(src, ctxStartTime);
          const g = ctx.createGain();
          const key = 'pool-' + displaySlot;
          const base = effGain(alt);
          g.gain.setValueAtTime(base * voiceGain(key), ctxStartTime);
          // fx : porté par le pool (la "voix"/l'emplacement), pas par l'alternative tirée au sort -- même
          // chaîne quel que soit le tirage, cf. la logique retenue pour les emplacements séquentiels.
          const fxChain = buildTargetFxChain('pool:' + secIdx + ':' + poolIdx, pool.fx, src, ctxStartTime);
          if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
          g.connect(trackMasterGain);
          // Chaque génération de pool rejoue une fois sans boucle -- onended fiable pour le nettoyage du
          // bitcrusher, comme pour les autres moteurs. armVRFinalEnd() chaîne sur ce handler plutôt que de
          // l'écraser -- voir son commentaire.
          if (fxChainHasLeakyNode(fxChain)) {
            src.onended = () => { disconnectLeakyFxNodes(fxChain); };
          }
          journalVoice(src, g, fxChain);
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
    scheduledGens.push({ ctxStartTime, bufferOffset, ratio: trackPitchRatio });
    // Capture/export (2026-09-16, voir pack.html) : un cycle de section = une fenêtre autonome à reproduire
    // fidèlement (mêmes tirages, même offset dans les fichiers) -- déclenché à CHAQUE appel de cette
    // fonction, donc aussi bien un vrai changement de section qu'un simple bouclage de la section courante
    // OU un seek manuel (seekVerticalRandom réutilise ce même point d'entrée) : les trois sont des moments
    // où de nouvelles sources démarrent réellement, donc trois moments valides à capturer.
    // Émis au moment où le cycle devient AUDIBLE (25/09, comme le séquentiel) : un cycle programmé puis annulé
    // (nouveau tirage, saut, arrêt -- voiceGraphTimeouts vidé) n'est jamais annoncé. cut : ce cycle remplace net les
    // sources précédentes (nouveau tirage / saut), au lieu de laisser finir leur queue.
    emitVROutcome('vr_section_start', ctxStartTime, {
      trackId: track.id, sectionId: (declaredSection && declaredSection.id) || null, sectionIndex: secIdx,
      bufferOffset, picks: telemetryPicks,
    });
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
        applyTrackPitchRate(src, vrNextStartCtxTime);
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.intro), vrNextStartCtxTime);
        const fxChain = buildTargetFxChain('intro', track.intro && track.intro.fx, src, vrNextStartCtxTime);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'intro', baseGain: effGain(track.intro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0, ratio: trackPitchRatio });
        emitVROutcome('vr_intro_start', vrNextStartCtxTime, { trackId: track.id });
        // Durée nominale de l'intro : mesures déclarées, au tempo de la PREMIÈRE section jouable (elle
        // seule a un sens ici, l'intro n'appartenant à aucune section) — la partie du fichier qui dépasse
        // cette durée nominale forme la queue de chevauchement, exactement comme en séquentiel.
        const firstPlayableOrigIdx = playableSectionOriginalIndex[0];
        const firstSection = firstPlayableOrigIdx !== undefined ? resolveVRSection(track, firstPlayableOrigIdx) : null;
        const introBpm = (firstSection && firstSection.bpm) || 120;
        const introBeatsPerBar = (firstSection && firstSection.beatsPerBar) || 4;
        const introDurationSec = ((track.intro && track.intro.bars) || introBeatsPerBar) * introBeatsPerBar * (60 / introBpm);
        vrNextStartCtxTime += introDurationSec / trackPitchRatio;
        continue;
      }
      if (next.type === 'outro') {
        if (!outroBuffer) { clearInterval(vrSchedulerTimer); vrSchedulerTimer = null; armVRFinalEnd(); return; }
        const src = ctx.createBufferSource();
        src.buffer = outroBuffer;
        applyTrackPitchRate(src, vrNextStartCtxTime);
        const g = ctx.createGain();
        g.gain.setValueAtTime(effGain(track.outro), vrNextStartCtxTime);
        const fxChain = buildTargetFxChain('outro', track.outro && track.outro.fx, src, vrNextStartCtxTime);
        if (fxChain) { src.connect(fxChain.input); fxChain.output.connect(g); } else { src.connect(g); }
        g.connect(trackMasterGain);
        if (fxChainHasLeakyNode(fxChain)) {
          src.onended = () => { disconnectLeakyFxNodes(fxChain); };
        }
        journalVoice(src, g, fxChain);
        src.start(vrNextStartCtxTime, 0);
        activeGenSources.push({ src, gain: g, voiceKey: 'outro', baseGain: effGain(track.outro) });
        lastGenSources = [src];
        scheduledGens.push({ ctxStartTime: vrNextStartCtxTime, bufferOffset: 0, ratio: trackPitchRatio });
        emitVROutcome('vr_outro_start', vrNextStartCtxTime, { trackId: track.id });
        clearInterval(vrSchedulerTimer); vrSchedulerTimer = null;
        armVRFinalEnd();
        return;
      }
      // next.type === 'section'
      const origIdx = playableSectionOriginalIndex[next.index];
      const timing = scheduleSectionGeneration(vrNextStartCtxTime, origIdx, next.isFirstEverForThisSection);
      vrNextStartCtxTime += (next.isFirstEverForThisSection ? (timing.loopOutSec - timing.startTrackSec) : timing.cycleLength) / trackPitchRatio;
    }
  }
  function armVRFinalEnd() {
    const marker = lastGenSources[0];
    if (!marker) return;
    finalGenerationMarkerSrc = marker;
    // Chaîne sur un éventuel onended déjà posé (nettoyage du bitcrusher, voir scheduleSectionGeneration et
    // le bloc outro plus haut) plutôt que de l'écraser -- même raisonnement que armSeqFinalEnd().
    const previousOnEnded = marker.onended;
    marker.onended = () => {
      if (previousOnEnded) previousOnEnded();
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
    captureMark('voices_stop', { trackId: track.id }); // repère de capture : tout ce qui sonnait pour ce morceau s'arrête net
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
    vrNextStartCtxTime = startSoon(); // toutes les voix du premier cycle sur un même instant (voir startSoon)
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
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    vrPendingCut = true;
    scheduleSectionGeneration(now, origIdx, false, offset);
    const timeUntilNext = timing.cycleLength - (fraction * timing.cycleLength);
    vrNextStartCtxTime = now + Math.max(0.02, timeUntilNext / trackPitchRatio);
    vrSchedulerTimer = setInterval(sectionSchedulerTick, 200);
  }

  // État nécessaire pour qu'un vrai Pause manuel (bouton Lecture/Pause) reprenne EXACTEMENT où la lecture
  // en était, plutôt que de repartir du tout début (bug signalé le 07/09 par Jules-Antoine : "pause"
  // stoppait complètement la lecture au lieu de la mettre en pause). Pour le séquentiel, l'embranchement
  // vertical et le vertical-random, les fonctions stop* ci-dessous réinitialisent volontairement l'identité
  // du bloc/de la boucle/de la section en cours (comportement voulu pour un vrai Stop, ou pour la reprise
  // après veille qui a ses propres mécanismes dédiés, voir seekSequential/seekVerticalRandom/
  // resumeEmbrVerticalAfterBackground) — donc capturé ICI, AVANT l'appel au stop du moteur. Pour le moteur
  // simple/quantifié, rien à faire : offsetAt (mis à jour par stopSimple/stopQuantized) suffit déjà.
  let pausedResume = null;
  function captureResumeState() {
    if (isSequential) {
      const b = currentSeqBlockInfo;
      if (!b) { pausedResume = null; return; }
      pausedResume = {
        kind: 'sequential',
        blockKind: b.kind, buffer: b.buffer, gain: b.gain, totalSec: b.totalSec, terminal: b.terminal, slotIdx: b.slotIdx,
        offsetSec: Math.max(0, Math.min(b.totalSec - 0.05, ctx.currentTime - b.virtualZero)),
        label: seqCurrentEl ? seqCurrentEl.textContent : '',
        descHtml: trackDescEl ? trackDescEl.innerHTML : '',
        goToEndRequested, pendingNextSegmentId
      };
    } else if (isEmbrVert) {
      pausedResume = { kind: 'embrVert', embrLoopIdx: embrActiveLoopIdx >= 0 ? embrActiveLoopIdx : embrReferenceIdx };
    } else if (isVerticalRandom) {
      if (vrCurrentSectionOriginalIndex < 0) { pausedResume = null; return; }
      const origIdx = vrCurrentSectionOriginalIndex;
      const section = resolveVRSection(track, origIdx);
      const timing = sectionTiming(section);
      const elapsed = currentPlaybackOffset();
      const frac = timing.cycleLength > 0 ? Math.min(1, Math.max(0, (elapsed - timing.loopInSec) / timing.cycleLength)) : 0;
      pausedResume = { kind: 'verticalRandom', origIdx, frac };
    } else {
      pausedResume = null;
    }
  }
  // Reprend précisément l'état capturé par captureResumeState() ci-dessus. Appelée par playThisTrack() une
  // fois que playing/activeTrackId/etc. sont déjà remis à jour — reprend le rôle que jouerait normalement
  // playSequential()/playEmbrVertical()/playVerticalRandom() pour un vrai (re)démarrage.
  function resumeFromPause() {
    const r = pausedResume; pausedResume = null;
    if (!r) return false;
    if (r.kind === 'sequential') {
      goToEndRequested = r.goToEndRequested;
      pendingNextSegmentId = r.pendingNextSegmentId;
      const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
      const remaining = Math.max(0.05, r.totalSec - r.offsetSec);
      // `remaining` transmis TOUJOURS (jamais null), y compris pour un bloc terminal (l'outro) — même
      // raison que seekSequential() ci-dessus : passer null ferait recaler le remplissage visuel sur
      // buffer.duration (durée totale) plutôt que ce qu'il en reste après la reprise.
      scheduleSeqGeneration(now, r.buffer, r.label, r.blockKind, remaining, r.gain, r.offsetSec, r.totalSec, r.terminal, r.slotIdx);
      if (trackDescEl) trackDescEl.innerHTML = r.descHtml;
      if (r.terminal) {
        armSeqFinalEnd();
        if (goToEndBtn) { goToEndBtn.disabled = true; goToEndBtn.textContent = t('endingWithOutro'); }
      } else {
        seqNextStartCtxTime = now + remaining / trackPitchRatio;
        seqSchedulerTimer = setInterval(seqSchedulerTick, 200);
        if (goToEndBtn) {
          if (goToEndRequested) {
            goToEndBtn.disabled = true;
            goToEndBtn.textContent = track.outro ? t('endingWithOutro') : t('endingLastSegment');
          } else {
            goToEndBtn.disabled = false;
          }
        }
      }
    } else if (r.kind === 'embrVert') {
      embrActiveLoopIdx = r.embrLoopIdx;
      const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
      embrReferenceStartCtxTime = now;
      scheduleEmbrGeneration(now, true);
      embrNextStartCtxTime = now + embrCycleLengthSec() / trackPitchRatio;
      embrSchedulerTimer = setInterval(embrSchedulerTick, 200);
      updateEmbrButtonsUI();
      applyEmbrWaveAnimation();
    } else if (r.kind === 'verticalRandom') {
      vrCurrentSectionOriginalIndex = r.origIdx;
      const declaredSection = (track.sections || [])[r.origIdx];
      if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: r.origIdx + 1 });
      vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === r.origIdx); });
      seekVerticalRandom(r.frac);
    }
    return true;
  }
  // Repeint par-dessus l'UI que stopAllSources() vient de remettre à plat (libellé "—", bloc/boucle/section
  // désactivés) avec l'état figé au moment de la pause, capturé juste avant par captureResumeState() —
  // pour qu'une pause manuelle donne l'impression de vraiment "geler" l'affichage plutôt que de l'effacer
  // puis de le faire réapparaître à la reprise (peaufinage demandé le 10/09 par Jules-Antoine). Purement
  // visuel : aucune de ces valeurs ne relance quoi que ce soit tant que playing reste false.
  function applyPausedUI() {
    const r = pausedResume;
    if (!r) return;
    if (r.kind === 'sequential') {
      if (seqCurrentEl) seqCurrentEl.textContent = r.label;
      if (trackDescEl) trackDescEl.innerHTML = r.descHtml;
      const block = seqBlockEls[r.blockKind], els = seqWaveEls[r.blockKind];
      if (block) { block.classList.remove('done'); block.classList.add('active'); }
      if (els && els.fg) {
        const frac = r.totalSec > 0 ? Math.max(0, Math.min(1, r.offsetSec / r.totalSec)) : 0;
        els.fg.style.transition = 'none';
        els.fg.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      }
      if (r.slotIdx != null && r.slotIdx >= 0) updateSeqMap(r.slotIdx);
    } else if (r.kind === 'embrVert') {
      embrLoopBtns.forEach(btn => { btn.classList.toggle('active', parseInt(btn.dataset.loopIdx, 10) === r.embrLoopIdx); });
    } else if (r.kind === 'verticalRandom') {
      const declaredSection = (track.sections || [])[r.origIdx];
      if (sectionCurrentEl) sectionCurrentEl.textContent = (declaredSection && declaredSection.label) || t('sectionFallback', { n: r.origIdx + 1 });
      vrBlockEls.forEach((el, i) => { if (el) el.classList.toggle('active', i === r.origIdx); });
      if (vrBlockFillEls[r.origIdx]) vrBlockFillEls[r.origIdx].style.width = (r.frac * 100) + '%';
    }
  }
  function pauseThisTrack() {
    captureResumeState();
    stopAllSources();
    applyPausedUI();
    // Prise : seule une vraie pause se reprend dans la même prise (une fin naturelle ou un autre morceau lancé entre-temps
    // en ouvriront une nouvelle au prochain démarrage). Pas pausedResume : le moteur simple reprend sans lui (offsetAt).
    if (take) take.resumable = true;
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
    // Capture vidéo : niveau d'intensité de départ (le visiteur a pu le choisir avant d'appuyer sur Lecture).
    if (!isContinuation) trackPublicEvent('track_play', { trackId: track.id, mode: track.mode }, { level });
    if (!isContinuation && !pausedResume) resetFxTriggers();
    // Prise (Figer) : un vrai démarrage en ouvre une nouvelle ; une reprise, un saut ou un retour de veille continue la
    // même (le journal note ce qui est réellement rejoué, quel que soit le chemin pris par le moteur).
    if (isContinuation || (take && take.resumable)) resumeTake(); else startTake();
    if (pausedResume && resumeFromPause()) {
      // Reprise exacte après un vrai Pause manuel — voir captureResumeState()/resumeFromPause() ci-dessus.
    } else if (isSequential) {
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
    const now = startSoon(); // toutes les voix sur un même instant, juste après (voir startSoon)
    vrPendingCut = true;
    const timing = scheduleSectionGeneration(now, origIdx, false);
    vrNextStartCtxTime = now + timing.cycleLength / trackPitchRatio;
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
      // Repère de capture à chaque pas du glisser (le son suit le curseur en direct) ; la statistique, elle, ne
      // retient que la valeur relâchée (voir 'change').
      captureMark('voice_volume_change', { trackId: track.id, voice: key, value: parseFloat(slider.value) });
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
      // (05/09, retour direct : "on veut que l'audio continue même si on va sur un autre onglet -- ce
      // qu'il fait déjà -- mais qu'il ne reprenne pas au début quand on revient"). Le Web Audio de ce
      // moteur continue réellement de jouer en arrière-plan la plupart du temps (aucune vraie coupure) --
      // reconstruire systématiquement toute la programmation à CHAQUE retour d'onglet, sans savoir si
      // quelque chose a vraiment été interrompu, provoquait donc un redémarrage audible depuis le début du
      // fichier alors que rien n'en avait besoin. On ne relance que si quelque chose a RÉELLEMENT été
      // interrompu : le contexte audio a été suspendu par le navigateur (ctx.state), ou le planificateur
      // périodique (setInterval, que certains navigateurs ralentissent ou gèlent en arrière-plan) a pris du
      // retard au point de ne plus avoir de génération programmée à l'heure -- sinon, on ne touche à rien,
      // la lecture en cours continue exactement telle quelle.
      const schedulerLate = embrSchedulerTimer && embrNextStartCtxTime < ctx.currentTime - 0.5;
      if (ctx.state === 'running' && !schedulerLate) return;
      resumeEmbrVerticalAfterBackground();
      return;
    }
    const resumeFrom = computeElapsed();
    stopAllSources(false);
    offsetAt = resumeFrom;
    playThisTrack(false, true);
  });
  playBtn.addEventListener('click', () => { playing ? pauseThisTrack() : playThisTrack(true); });

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
        g.gain.linearRampToValueAtTime((p[i] || 0) * layerGain * voiceGain('layer-' + i), now + INTENSITY_RAMP_SEC);
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
      // Départ à un instant PRÉCIS, 20 ms après l'appui (25/09), plutôt que « dès que possible » (start(0)) : le navigateur
      // ne dit pas quand tombe ce « dès que possible » (2 à 20 ms plus tard selon sa charge), si bien qu'aucun
      // enregistrement (outil vidéo, Figer) ne pouvait caler le Sfx exactement sur la musique. Inaudible à l'appui.
      const startAt = ctx.currentTime + SFX_START_LEAD_SEC;
      if (sfx.duckMainTrack) duckMainTrack(buf.duration, startAt);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Curseurs liés à la position / reverb de ce Sfx : le son démarre à la position actuelle du curseur, puis suit ses
      // déplacements tant qu'il joue (voir applyFxSliderToSfx).
      const spatialVoice = connectSfxSource(src, sfx, fxSfxOverrideFor(sfx.id), startAt);
      if (spatialVoice && spatialVoice.fixed) {
        let vs = activeSfxVoices.get(sfx.id);
        if (!vs) { vs = new Set(); activeSfxVoices.set(sfx.id, vs); }
        vs.add(spatialVoice);
        src.addEventListener('ended', () => vs.delete(spatialVoice));
      }
      journalSfxVoice(src, spatialVoice);
      src.start(startAt);
      activeStingerSources.push(src);
      src.onended = () => { activeStingerSources = activeStingerSources.filter(s => s !== src); };
      // spatialStep : point de trajectoire réellement joué (mode "pas à pas") -- l'outil vidéo le rejoue à l'identique.
      // Capture : réglage de salle réellement utilisé (le visiteur a pu déplacer le son sur la matrice publique), et durée
      // du fichier (le « duck » de la musique en dépend).
      trackPublicEvent('stinger_play', Object.assign({ trackId: track.id, sfxId: sfx.id, variationIndex: idx },
        spatialVoice && spatialVoice.stepIndex != null ? { spatialStep: spatialVoice.stepIndex } : {}),
        Object.assign({ fileDuration: buf.duration, at: startAt }, spatialVoice && spatialVoice.__spUsed ? { spatial: spatialVoice.__spUsed } : {}));
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
  // publication toute récente. Ne compte que les vrais fichiers distants (item.localFile/localUrl
  // ignorés, aperçu local du backstage jamais concerné par ce problème).
  let remoteFetchAttempts = 0;
  let remoteFetchNotFound = 0;
  async function loadArrayBuffer(item) {
    if (item.localFile) return await item.localFile.arrayBuffer();
    // localUrl (18/09) : variante de localFile pour l'Aperçu public (?preview=1, nouvel onglet) -- un
    // fichier pas encore publié y arrive en URL locale temporaire (blob:, voir pendingPreviewUrl() côté
    // backstage) plutôt qu'en objet File directement utilisable, un objet File ne survivant pas au
    // passage par localStorage (JSON) entre le backstage et cet onglet. fetch() sait lire une URL blob:
    // aussi bien qu'une URL distante, d'où ce simple embranchement plutôt qu'un chemin de code séparé.
    if (item.localUrl) return await (await fetch(item.localUrl)).arrayBuffer();
    remoteFetchAttempts++;
    const v = track.publishedAt ? ('?v=' + encodeURIComponent(track.publishedAt)) : '';
    const url = track.base + encodeURIComponent(item.file) + v;
    const res = await fetch(url);
    if (!res.ok) remoteFetchNotFound++;
    const ab = await res.arrayBuffer();
    _arrayBufferUrls.set(ab, url); // journal de prise : le rendu hors-ligne retéléchargera ce fichier
    return ab;
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
    const buf = await decodeAudioDataCompatRaw(arrayBuffer);
    const url = _arrayBufferUrls.get(arrayBuffer);
    if (url && buf) _bufferUrls.set(buf, url);
    return buf;
  }
  async function decodeAudioDataCompatRaw(arrayBuffer) {
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
      // Formes d'onde des boutons de boucle (02/09) : les canvases .embr-wave-bg/.embr-wave-fg existent dans
      // le HTML depuis le premier chantier, mais rien ne les dessinait jamais -- bug confirmé le 05/09 en
      // situation réelle (retour direct : "on devrait voir les deux formes d'ondes des deux boucles paires
      // ici"), chaque bouton "riche" restait entièrement vide (juste le fond CSS + le libellé, indiscernable
      // d'un bouton plat). embrLoopBtns porte déjà data-loop-idx, posé une seule fois par buildTrackRow --
      // aucun besoin de reconstruire l'association bouton/buffer ici.
      embrLoopBtns.forEach(btn => {
        if (!btn.classList.contains('embr-wave-btn')) return;
        const idx = parseInt(btn.dataset.loopIdx, 10);
        const buf = embrLoopBuffers[idx];
        const bg = btn.querySelector('.embr-wave-bg'), fg = btn.querySelector('.embr-wave-fg');
        if (buf && bg && fg) renderWaveformPair(bg, fg, buf, waveBgColor, waveFgColor);
      });
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
      const alts = (sfx.alternatives || []).filter(a => a.file || a.localFile || a.localUrl);
      sfxBuffersById[sfx.id] = new Array(alts.length).fill(null);
      for (let ai = 0; ai < alts.length; ai++) {
        try {
          // Base propre au Sfx (audio/sfx-{id}/), jamais celle du morceau — un Sfx est une entrée de
          // bibliothèque partagée, potentiellement attachée à plusieurs morceaux à la fois.
          const alt = alts[ai];
          let ab;
          if (alt.localFile) ab = await alt.localFile.arrayBuffer();
          else if (alt.localUrl) ab = await (await fetch(alt.localUrl)).arrayBuffer(); // voir loadArrayBuffer() plus haut
          else {
            const v = sfx.publishedAt ? ('?v=' + encodeURIComponent(sfx.publishedAt)) : '';
            const sfxUrl = sfx.base + encodeURIComponent(alt.file) + v;
            const res = await fetch(sfxUrl);
            ab = await res.arrayBuffer();
            _arrayBufferUrls.set(ab, sfxUrl);
          }
          sfxBuffersById[sfx.id][ai] = await decodeAudioDataCompat(ab);
          loaded++;
          if (statusEl) statusEl.textContent = t('loadingProgress', { loaded, total });
        } catch (e) { /* une variation manquante ne bloque pas la lecture principale */ }
      }
    }
    // Reverb de salle des Sfx spatialisés préparée dès le chargement (25/09) : la calculer au premier appui bloquait la page
    // quelques dizaines de ms (accroc audible sur les effets à ScriptProcessor, départ du Sfx en retard).
    // Même chose pour le rendu 3D au casque : le navigateur ne charge ses données de spatialisation (HRTF) qu'à la création
    // du premier panoramique binaural, et joue ce premier son en mode dégradé en attendant.
    attachedSfx.forEach(sfx => { if (sfx.spatial && sfx.spatial.enabled) { try { getRoomBus(ctx, normalizeSpatial(sfx.spatial).room); } catch (e) {} } });
    if (attachedSfx.some(sfx => sfx.spatial && sfx.spatial.enabled)) { try { if (!_hrtfWarmPanner) { _hrtfWarmPanner = ctx.createPanner(); _hrtfWarmPanner.panningModel = 'HRTF'; } } catch (e) {} }
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



/* ---------------- Modes visuels visiteur : contraste renforcé + mode nuit ---------------- */
// Deux cases à cocher indépendantes (mémorisées sur ce navigateur via localStorage), purement client,
// aucune dépendance backend -- mais qui se RECOMPOSENT au lieu de s'écraser silencieusement l'une
// l'autre (Chantier Apparence Phase 3, 4 septembre) : le contraste renforcé forçait un fond blanc pur,
// ce qui annulerait l'objectif même du mode nuit (éviter un écran blanc en pleine nuit) si les deux
// étaient actives en même temps. applyVisualModes() est le point de composition unique -- appelé par
// les DEUX toggles à chaque changement (pas seulement par le sien), pas seulement par sa propre case --
// pour qu'activer/désactiver l'un recalcule toujours l'état complet à partir de zéro. Ordre : thème de
// base (couleurs de l'AdReel/pack/collection) -> mode nuit (si actif) -> contraste renforcé (si actif,
// variante sombre si le mode nuit est actif, claire sinon).
const HIGH_CONTRAST_VARS = {
  '--bg': '#ffffff', '--bg-card': '#ffffff', '--text': '#000000', '--text-title': '#000000',
  '--text-dim': '#1a1a1a', '--text-dimmer': '#3a3a3a', '--border': '#000000',
  '--accent': '#a3390f', '--accent-soft': '#f4d9cb'
};
// Variante sombre du contraste renforcé (fond noir pur/texte blanc pur) -- sans elle, cocher les deux
// cases en même temps redonnerait le fond blanc ci-dessus malgré le mode nuit actif.
const DARK_HIGH_CONTRAST_VARS = {
  '--bg': '#000000', '--bg-card': '#000000', '--text': '#ffffff', '--text-title': '#ffffff',
  '--text-dim': '#e6e6e6', '--text-dimmer': '#c2c2c2', '--border': '#ffffff',
  '--accent': '#ff8a5c', '--accent-soft': '#3a1f12'
};
// Palette fixe du mode nuit -- reprend les valeurs du preset "Nuit" (Chantier Apparence Phase 3,
// layerpitch-backstage.html) pour qu'un AdReel/Pack/Collection déjà sombre ne change quasiment pas
// visuellement quand un visiteur active ce mode en plus. N'affecte jamais --accent/--accent-soft, comme
// les presets eux-mêmes (l'accent reste la couleur de marque du site, jamais personnalisable).
const NIGHT_MODE_VARS = {
  '--bg': '#121212', '--bg-card': '#1c1c1c', '--text': '#c9c9ce', '--text-title': '#ffffff',
  '--text-dim': '#9a9aa0', '--text-dimmer': '#707078', '--border': '#3a3a40'
};
const VISUAL_MODE_VAR_KEYS = ['--bg', '--bg-card', '--text', '--text-title', '--text-dim', '--text-dimmer', '--border', '--accent', '--accent-soft'];
function applyVisualModes(customBg, customText, customTitleColor) {
  const root = document.documentElement;
  const contrastToggle = document.getElementById('contrastToggle');
  const nightToggle = document.getElementById('nightModeToggle');
  const contrastOn = !!(contrastToggle && contrastToggle.checked);
  const nightOn = !!(nightToggle && nightToggle.checked);
  VISUAL_MODE_VAR_KEYS.forEach(key => root.style.removeProperty(key));
  if (customBg) root.style.setProperty('--bg', customBg);
  if (customText) root.style.setProperty('--text', customText);
  if (customTitleColor) root.style.setProperty('--text-title', customTitleColor);
  if (nightOn) Object.keys(NIGHT_MODE_VARS).forEach(key => root.style.setProperty(key, NIGHT_MODE_VARS[key]));
  if (contrastOn) {
    const vars = nightOn ? DARK_HIGH_CONTRAST_VARS : HIGH_CONTRAST_VARS;
    Object.keys(vars).forEach(key => root.style.setProperty(key, vars[key]));
  }
  document.body.classList.toggle('night-mode', nightOn);
  document.body.classList.toggle('high-contrast', contrastOn);
  document.dispatchEvent(new CustomEvent('layerpitch-contrast-changed'));
}
function setupContrastToggle(toggleId, customBg, customText, customTitleColor) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;
  let saved = false;
  try { saved = localStorage.getItem('layerpitch-high-contrast') === '1'; } catch (e) {}
  toggle.checked = saved;
  applyVisualModes(customBg, customText, customTitleColor);
  toggle.addEventListener('change', () => {
    applyVisualModes(customBg, customText, customTitleColor);
    try { localStorage.setItem('layerpitch-high-contrast', toggle.checked ? '1' : '0'); } catch (e) {}
  });
}
// Mode nuit visiteur (Chantier Apparence Phase 3) : objectif différent de la bascule de contraste
// ci-dessus (confort visuel dans le noir, pas accessibilité WCAG) -- ne la fusionne ni ne la réutilise
// telle quelle, mais partage applyVisualModes() pour que les deux restent lisibles ensemble. Disponible
// sur tout AdReel/Pack/Collection publié quel que soit le palier du compositeur -- un contrôle du
// confort d'affichage du visiteur, pas une personnalisation du compositeur.
function setupNightModeToggle(toggleId, customBg, customText, customTitleColor) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;
  let saved = false;
  try { saved = localStorage.getItem('layerpitch-night-mode') === '1'; } catch (e) {}
  toggle.checked = saved;
  applyVisualModes(customBg, customText, customTitleColor);
  toggle.addEventListener('change', () => {
    applyVisualModes(customBg, customText, customTitleColor);
    try { localStorage.setItem('layerpitch-night-mode', toggle.checked ? '1' : '0'); } catch (e) {}
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
// Style des variations round robin d'un Sfx (24/09) : injecté par le lecteur lui-même plutôt que copié dans chaque page
// hôte. index.html en avait sa propre copie, mais pack.html (qui affiche pourtant des Sfx) et le Backstage (lecteur de
// test de l'entrée « Espace ») n'avaient rien -- les blocs y étaient énormes, avec les deux formes d'onde côte à côte au
// lieu d'être superposées. `:where()` = spécificité nulle : toute règle de la page hôte (index.html, ses thèmes) reste prioritaire.
function ensureSfxPlayerStyle() {
  if (document.getElementById('lp-sfx-player-style')) return;
  const st = document.createElement('style');
  st.id = 'lp-sfx-player-style';
  st.textContent = `
    :where(.sfx-rr-row) { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    :where(.sfx-rr-block) { position: relative; flex: 1 1 64px; min-width: 64px; height: 40px; border-radius: 6px;
      border: 1px solid var(--border, #ccc); background: transparent; cursor: pointer; overflow: hidden; padding: 0; font-family: inherit; }
    :where(.sfx-rr-block.active) { border-color: var(--accent, #c9713c); }
    :where(.sfx-rr-wave-bg, .sfx-rr-wave-fg) { position: absolute; inset: 0; width: 100%; height: 100%; }
    :where(.sfx-rr-wave-fg) { opacity: 0; transition: opacity 0.15s ease; }
    :where(.sfx-rr-block.active .sfx-rr-wave-fg) { opacity: 1; }
    :where(.sfx-space-view) { margin-top: 12px; font-size: 12px; }
    :where(.sfx-space-layout) { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
    :where(.sfx-space-map) { flex: 0 1 320px; min-width: 220px; }
    :where(.sfx-space-side) { flex: 1 1 200px; min-width: 190px; }
    :where(.sfx-space-side .head-turn-row) { margin-top: 0 !important; }
    :where(.sfx-space-bin) { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; cursor: pointer; }
    :where(.sfx-space-title) { font-weight: 600; margin-bottom: 4px; }
    :where(.sfx-space-readout) { margin-top: 4px; color: var(--text-dimmer, #888); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }
    :where(.sfx-space-controls) { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 6px; }
    :where(.sfx-space-controls label) { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }
    :where(.sfx-space-hint) { margin-top: 4px; color: var(--text-dimmer, #888); font-size: 11px; }
    :where(.sfx-rr-label) { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.03em; color: var(--text-dim, #555);
      z-index: 1; padding: 0 4px; text-align: center;
      text-shadow: 0 0 4px var(--bg-card, #fff), 0 0 4px var(--bg-card, #fff), 0 0 4px var(--bg-card, #fff); }
  `;
  document.head.appendChild(st);
}
function buildSfxPlayer(sfxDef) {
  ensureSfxPlayerStyle();
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
        ${sfxDef.tag ? `<div class="track-tags"><span class="tag">${escapeHtml(sfxDef.tag)}</span></div>` : ''}
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
  // Sfx spatialisé : l'auditeur peut tourner la tête (curseur d'orientation) sous les variations.
  if (sfxDef.spatial && sfxDef.spatial.enabled) {
    const inner = wrapper.querySelector('.track-row-details-inner');
    const publicMode = sfxDef.spatial.publicMode || 'free'; // 'free' | 'frozen' | 'hidden' (choix du compositeur)
    if (sfxDef.hideSpatialView) inner.appendChild(buildHeadTurnControl()); // lecteur de test du Backstage : l'éditeur est déjà juste au-dessus
    else if (publicMode !== 'hidden') inner.appendChild(buildSpatialMatrixView(sfxDef)); // le curseur d'orientation y est posé à côté de la matrice
  }

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
      let ab;
      if (alt.localFile) ab = await alt.localFile.arrayBuffer(); // fichier choisi mais pas encore publié (test dans le Backstage)
      else if (alt.localUrl) ab = await (await fetch(alt.localUrl)).arrayBuffer();
      else {
        if (!alt.file || !sfxDef.base) return null;
        const v = sfxDef.publishedAt ? ('?v=' + encodeURIComponent(sfxDef.publishedAt)) : '';
        const res = await fetch(sfxDef.base + encodeURIComponent(alt.file) + v);
        ab = await res.arrayBuffer();
      }
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
    connectSfxSource(src, sfxDef);
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
  adReelFromParam,
  infoBadgeSvg,
  buildTrackRow,
  initTrackPlayer,
  renderTracksBlock,
  setTakeRecording,
  getTrackTake,
  buildSfxPlayer,
  SPATIAL_ROOMS,
  spatialFieldHalfExtent,
  normalizeSpatial,
  buildRoomImpulse,
  buildSpatialVoice,
  buildSpatialMatrixView,
  pickSpatialStepIndex,
  buildLayerFxChain,
  applyFxToChain,
  fxTrackRatio,
  fxSliderRateSemitones,
  trackNeedsLatencyComp,
  withLatencyComp,
  fxSpLatencySec,
  embrCutFadeSec,
  // Contexte audio de la page : sa fréquence et le retard de ses effets à ScriptProcessor (rendu hors-ligne à l'identique).
  liveSampleRate: () => ctx.sampleRate,
  audioNow: () => ctx.currentTime,
  liveFxLatencySec: () => fxSpLatencySec(ctx),
  CAPTURE_RAMPS: { intensity: INTENSITY_RAMP_SEC, voice: VOICE_RAMP_SEC, duckLevel: DUCK_LEVEL, duckAttack: DUCK_ATTACK_SEC, duckRelease: DUCK_RELEASE_SEC },
  createTriggerRuleEngine,
  simulateTriggerRules,
  FX_SLIDER_PARAMS,
  fxSlidersValid,
  fxSliderOverrides,
  fxSliderForceKeys,
  applyFxSliderOverrides,
  fxSliderThresholdWants,
  fxSliderSfxOverrides,
  fxSpatialWithOverride,
  fxCurveEval,
  fxCurveSanitize,
  fxSliderTargetKey,
  fxTargetKeyFromTarget,
  baseFxForTarget,
  mergeTriggerFx,
  setListenerYaw,
  getListenerYaw,
  applyListenerYaw,
  setupContrastToggle,
  setupNightModeToggle,
  getModeLabel,
  setLang,
  setSfxLibrary,
  shareOrCopy,
  downloadTracksAsZip,
  createSectionPlaybackScheduler,
  PLAYABLE_MODES,
  WAVEFORM_STYLES,
  setWaveformStyle,
  currentWaveformStyle,
  SEQ_MAP_THEMES,
  setSeqMapTheme,
  currentSeqMapTheme,
  SEQ_MAP_DENSITIES,
  setSeqMapDensity,
  currentSeqMapDensity,
  computeWaveformPeaks,
  drawWaveformCanvas,
  resolveEffectiveWaveformStyle,
  resolveWaveformColors
};

})();
