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
      const res = await fetchAudio(track.base + encodeURIComponent(f.file) + v, track.protected);
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

