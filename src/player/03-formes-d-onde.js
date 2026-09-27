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

