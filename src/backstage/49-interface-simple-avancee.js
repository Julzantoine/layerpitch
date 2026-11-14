// Interface simple / avancée (14/11, feu vert simple_advanced_ui). Cadrage : layerpitch-docs/2026-11-14-interface-simple-avancee-cadrage.md
//
// Principe : chaque élément classé « avancé » porte l'attribut data-adv ; il garde sa place logique dans l'écran. En
// interface simple (le niveau de départ de tout le monde), il est MASQUÉ (jamais retiré : sa valeur par défaut continue
// de s'appliquer, par exemple « Crédit compositeur » reste coché), et un repère « N options avancées masquées · Afficher »
// apparaît à la fin de la zone. Le choix vit dans les préférences d'Accueil du compte (home_prefs.ui_advanced), avec un
// repli dans le navigateur (voir homeSavePrefs, 48-accueil.js). Pas actif dans le tutoriel (les leçons demandent des gestes avancés).
//
// Étiqueter un nouvel élément avancé : lui ajouter data-adv (dans le HTML des écrans ou dans le gabarit JS d'un éditeur).
// Une zone = le panneau (.backstage-panel) ou le plus proche ancêtre [data-adv-zone] ; le repère se place après le dernier
// élément avancé de la zone.

function uiSimpleActive() {
  return flagOpen('simple_advanced_ui') && !isTutoMode() && !(homePrefs && homePrefs.ui_advanced);
}
// Enveloppe un morceau de HTML d'éditeur dans un bloc avancé (vide reste vide : rien à masquer, rien à compter).
function advHtml(html) { return html && String(html).trim() ? `<div data-adv>${html}</div>` : ''; }
function uiAdvZoneOf(el) { return el.closest('[data-adv-zone]') || el.closest('.backstage-panel') || document.body; }

let uiAdvObserver = null;
let uiAdvRaf = 0;

// Place (ou retire) les repères « N options avancées masquées ». Idempotent.
function refreshAdvancedHints() {
  if (uiAdvObserver) uiAdvObserver.disconnect();
  try {
    document.querySelectorAll('.lp-adv-hint').forEach(h => h.remove());
    if (uiSimpleActive()) {
      const zones = new Map();
      document.querySelectorAll('.backstage-content [data-adv]').forEach(el => {
        if (el.parentElement && el.parentElement.closest('[data-adv]')) return; // un élément avancé dans un autre : compté une seule fois
        if (!el.textContent.trim() && !el.querySelector('input, select, textarea, button, canvas, img')) return; // rien à masquer : pas compté
        const z = uiAdvZoneOf(el);
        const e = zones.get(z) || { n: 0, last: null };
        e.n++; e.last = el; zones.set(z, e);
      });
      zones.forEach(({ n, last }) => {
        const hint = document.createElement('div');
        hint.className = 'lp-adv-hint';
        hint.innerHTML = `<span>${escapeHtml(tr(n > 1 ? 'uiAdvHintMany' : 'uiAdvHintOne').replace('{n}', String(n)))}</span> <button type="button" class="lp-adv-show">${escapeHtml(tr('uiAdvShow'))}</button>`;
        last.after(hint);
      });
    }
  } finally {
    if (uiAdvObserver) uiAdvObserver.observe(document.querySelector('.backstage-content') || document.body, { childList: true, subtree: true });
  }
}
function scheduleAdvancedHints() {
  if (uiAdvRaf) return;
  uiAdvRaf = requestAnimationFrame(() => { uiAdvRaf = 0; refreshAdvancedHints(); });
}

// Applique le niveau d'interface : classe sur la page + repères. À rappeler après chaque changement du choix ou des feux verts.
function applyUiLevel() {
  document.body.classList.toggle('lp-ui-simple', uiSimpleActive());
  // Vidéo : « Relecture client » et « Réglages » sont avancés ; si on y était, retour sur l'Atelier.
  if (uiSimpleActive() && typeof videoView !== 'undefined' && (videoView === 'review' || videoView === 'settings') && typeof setVideoView === 'function') setVideoView('atelier');
  refreshAdvancedHints();
  pushUiLevelToAtelier();
}
// L'Atelier vidéo est une page à part dans un cadre : on lui dit le niveau (il masque ses propres éléments avancés).
function pushUiLevelToAtelier() {
  const frame = document.getElementById('videoAtelierFrame');
  if (!frame || !frame.contentWindow) return;
  try { frame.contentWindow.postMessage({ source: 'lp-backstage', type: 'uiLevel', simple: uiSimpleActive() }, location.origin); } catch (e) { /* cadre pas prêt : il sera prévenu à son chargement */ }
}
// Choisit le niveau (true = avancée) : mémorisé sur le compte (et ce navigateur), appliqué tout de suite.
function setUiAdvanced(advanced) {
  const p = homeSavePrefs({ ui_advanced: !!advanced });
  applyUiLevel();
  if (typeof renderHome === 'function' && typeof homeOpen === 'function' && homeOpen()) renderHome();
  return p;
}
// Appelée une fois les feux verts connus (début de syncHome) : charge le choix de la personne puis applique.
function syncUiLevel() {
  if (!flagOpen('simple_advanced_ui')) { applyUiLevel(); return; }
  if (!homePrefs) homePrefs = Object.assign({}, homeLocalPrefs()); // tout de suite avec le choix de ce navigateur, le compte fait foi ensuite
  applyUiLevel();
  loadHomePrefs().then(() => { applyUiLevel(); if (typeof homeOpen === 'function' && homeOpen()) renderHome(); });
}

(function wireUiLevel() {
  // Les éditeurs se redessinent souvent (innerHTML) : on repose les repères après chaque changement de l'écran.
  uiAdvObserver = new MutationObserver(() => { if (document.body.classList.contains('lp-ui-simple')) scheduleAdvancedHints(); });
  const root = document.querySelector('.backstage-content') || document.body;
  uiAdvObserver.observe(root, { childList: true, subtree: true });
  const atelierFrame = document.getElementById('videoAtelierFrame');
  if (atelierFrame) atelierFrame.addEventListener('load', pushUiLevelToAtelier);
  // « Afficher » du repère de l'Atelier : on passe en avancée.
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.source !== 'lp-atelier' || e.data.type !== 'uiAdvanced') return;
    setUiAdvanced(true);
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.lp-adv-show');
    if (btn) { e.preventDefault(); setUiAdvanced(true); }
  });
})();
