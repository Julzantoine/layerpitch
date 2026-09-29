function log(msg, cls) {
  const el = document.getElementById('log');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function slug(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}
// Échappement complet (& < > " ') valable à la fois pour le texte et pour les attributs HTML (revue du 24/09 : l'ancienne
// version n'échappait pas les guillemets, et escapeAttr ne protégeait que les attributs). escapeAttr garde son nom
// historique (100+ appels) mais fait désormais exactement la même chose.
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function extOf(filename) { const m = /\.([a-zA-Z0-9]+)$/.exec(filename || ''); return m ? m[1].toLowerCase() : 'jpg'; }
// Content-Type pour l'upload R2 des images (S3/R2 le
// veut pour servir le bon en-tête -- voir MIME dans scripts/migrate-media-to-r2.js pour la même liste).
function imageContentType(ext) {
  const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml' };
  return map[(ext || '').toLowerCase()] || 'application/octet-stream';
}
function genId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

const UPLOAD_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5V4M8 8l4-4 4 4"/><path d="M4 15.5v3.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3.5"/></svg>';
const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5h16"/><path d="M8.5 6.5V4.8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V6.5"/><path d="M6.5 6.5l.9 12.7a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-12.7"/><path d="M10.2 10.5v6M13.8 10.5v6"/></svg>';
// basenameOf (29/08) : extrait le nom de fichier affichable d'un chemin distant publié (ex.
// "audio/ev1/ref.wav" -> "ref.wav") -- remoteFile est toujours un simple chemin/nom en chaîne partout
// dans ce fichier (jamais un objet), donc réutilisable tel quel pour tous les contrôles de fichier.
function basenameOf(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts[parts.length - 1];
}
// deleteBtnHtml (optionnel) : bouton de suppression icône déjà construit par l'appelant (avec ses propres
// data-action/data-*), injecté dans la même ligne que le contrôle de fichier — pour les listes de
// variations (Sfx, groupes, segments, couches), où avoir "Choisir un fichier" + "Supprimer" en icônes
// côte à côte économise la place et allège une liste souvent longue, plutôt qu'un bouton texte en dessous.
function fileCtrlHtml(label, deleteBtnHtml) {
  const pickLabel = label || tr('chooseFileDefault');
  // Icône + libellé texte visible (29/08, retour de Jules-Antoine : une icône seule n'est pas assez
  // explicite) — plus de bouton "icône seule" (btn-icon) pour ce contrôle précis.
  return `
    <div class="file-ctrl">
      <button type="button" class="btn btn-small" data-role="pickBtn">${UPLOAD_ICON_SVG}<span>${pickLabel}</span></button>
      <span class="file-status" data-role="fileStatus">${tr('noFileStatus')}</span>
      ${deleteBtnHtml || ''}
      <input type="file" data-role="fileInput" style="display:none">
    </div>
  `;
}
// Poignée de glisser-déposer (18/08) -- même SVG que celle des blocs de contenu (16/08), factorisée ici
// pour être réutilisée par les listes maître de couches/sections/boucles nommées sans dupliquer le markup.
// extraClass optionnel (20/08) : permet de distinguer deux systèmes de glisser-déposer coexistant dans un
// même conteneur (ex. dossiers d'AdReel vs AdReel eux-mêmes) tout en gardant le même style visuel -- le
// sélecteur d'armement de chaque système cible sa propre classe plutôt que la classe de base partagée.
function dragHandleHtml(extraClass) {
  const cls = extraClass ? `block-drag-handle ${extraClass}` : 'block-drag-handle';
  return `<span class="${cls}" aria-hidden="true" title="${tr('dragHandleTitle')}"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>`;
}
function deleteIconBtnHtml(action, dataAttrs, label) {
  const attrs = Object.entries(dataAttrs).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  return `<button type="button" class="btn btn-icon btn-danger" data-action="${action}" ${attrs} title="${label}" aria-label="${label}">${TRASH_ICON_SVG}</button>`;
}
// Réglages posés à l'activation d'un effet (data-fx-param="enabled") -- valeurs de départ raisonnables,
// pas des zéros muets, pour qu'activer une case coche produise un effet audible immédiatement.
const FX_DEFAULTS = {
  lowcut: () => ({ frequency: 150, slope: 24 }),
  highcut: () => ({ frequency: 3000, slope: 24 }),
  reverb: () => ({ decay: 2, wet: 0.3 }),
  delay: () => ({ time: 0.3, feedback: 0.35, wet: 0.25 }),
  bitcrush: () => ({ bits: 6, reduction: 6 }), // départ nettement audible (8 bits sans réduction ne s'entendait presque pas, 24/09)
  volume: () => ({ db: 0 }),
  // "rate" retiré des valeurs par défaut par élément (22/09) : devenu un réglage de morceau entier, voir
  // FX_TRACK_DEFAULTS ci-dessous et trackPitchFxHtml() -- ici, "shift" reste le seul mode par couche/
  // boucle/emplacement/pool, puisqu'il ne pose pas de problème de synchro (durée inchangée).
  pitch: () => ({ mode: 'shift', semitones: 3 }) // départ audible (0 demi-ton ne changeait rien, 25/09)
};
// Pitch de morceau entier (mode "rate" implicite, pas de champ mode -- un seul sens possible à ce niveau).
const FX_TRACK_DEFAULTS = { pitch: () => ({ semitones: 0 }) };

// Protection des fichiers d'un morceau (29/09, « protéger l'album », choix par morceau) : fichiers dans un stockage privé,
// lus par liens signés ; le morceau reste écoutable là où le compositeur l'a mis en avant (AdReel, écoute libre d'un album,
// pack en vente). Bloc affiché dans l'onglet « Infos » de chaque morceau ; le déplacement est fait par l'Edge Function
// set-track-protection (le morceau doit être publié).
function trackProtectionHtml(track, ti) {
  const on = !!track.protected;
  return `<label style="margin-top:14px">${tr('trackProtectionLabel')}</label>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="badge">${tr(on ? 'trackProtectedBadge' : 'trackPublicBadge')}</span>
      <button class="btn btn-small" type="button" data-action="toggle-track-protection" data-ti="${ti}">${tr(on ? 'trackUnprotectBtn' : 'trackProtectBtn')}</button>
    </div>
    <div class="hint-inline">${tr('trackProtectionHint')}</div>`;
}
