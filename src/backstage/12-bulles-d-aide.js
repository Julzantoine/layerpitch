/* ---------------- Bulles d'aide contextuelle (data-help="clé") ---------------- */
// tHelp('clé') suit la même logique que tr() : zone unique "library" (pour l'instant), repli sur le
// français si la clé manque en anglais. Le dictionnaire vit dans layerpitch-help.js, édité via
// layerpitch-help-editor.html — jamais à la main directement.
function tHelp(key) {
  const HELP = window.LAYERPITCH_HELP || { fr: {}, en: {} };
  const dict = HELP[currentLang()] || HELP.fr;
  const dictFr = HELP.fr || {};
  for (const zone of Object.keys(dict)) {
    if (dict[zone] && dict[zone][key]) return dict[zone][key];
  }
  for (const zone of Object.keys(dictFr)) {
    if (dictFr[zone] && dictFr[zone][key]) return dictFr[zone][key];
  }
  return '';
}
// Moteur générique : un seul écouteur délégué sur document (le contenu du backstage se reconstruit
// en permanence via innerHTML — pas question de re-câbler un listener par élément à chaque rendu).
// mouseover/mouseout (pas mouseenter/mouseleave, qui ne remontent pas) + un délai avant affichage
// pour éviter l'effet flash au simple passage de la souris.
(function setupHelpTooltips() {
  const tooltipEl = document.getElementById('helpTooltip');
  let showTimer = null;
  let currentTarget = null;

  function hideTooltip() {
    clearTimeout(showTimer);
    tooltipEl.classList.remove('visible');
    currentTarget = null;
  }

  function positionTooltip(target) {
    const rect = target.getBoundingClientRect();
    const ttRect = tooltipEl.getBoundingClientRect();
    const margin = 8;
    let top = rect.top - ttRect.height - margin;
    if (top < margin) top = rect.bottom + margin; // pas assez de place au-dessus -> en dessous
    let left = rect.left;
    if (left + ttRect.width > window.innerWidth - margin) left = window.innerWidth - ttRect.width - margin;
    if (left < margin) left = margin;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${left}px`;
  }

  function showTooltip(target) {
    const text = tHelp(target.dataset.help);
    if (!text) return;
    tooltipEl.textContent = text;
    tooltipEl.classList.add('visible');
    positionTooltip(target);
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-help]');
    if (!target || target === currentTarget) return;
    currentTarget = target;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showTooltip(target), 500);
  });
  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-help]');
    if (!target) return;
    if (e.relatedTarget && target.contains(e.relatedTarget)) return;
    hideTooltip();
  });
  // Un scroll pendant l'affichage peut désaligner la bulle par rapport au contrôle -> on la masque simplement.
  document.addEventListener('scroll', hideTooltip, true);
})();

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.lang-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.lang === currentLang()) return;
      localStorage.setItem('layerpitch_lang', btn.dataset.lang);
      location.reload();
    });
  });
  applyI18n();
  const modeTestCb = document.getElementById('modeTestToggle');
  if (modeTestCb) {
    try { modeTestCb.checked = localStorage.getItem(MODE_TEST_KEY) === '1'; } catch (e) {}
    modeTestCb.addEventListener('change', () => {
      try { localStorage.setItem(MODE_TEST_KEY, modeTestCb.checked ? '1' : '0'); } catch (e) {}
    });
  }
  initPgAuthUi();
  initAccountMenuUi();
  initInboxBellUi();
});
// Fin de la publication via GitHub (24/09, revue de code) : le Backstage lit et écrit uniquement dans la base. On efface
// une fois pour toutes ce que les anciennes versions gardaient dans ce navigateur -- dont un jeton d'accès GitHub
// personnel, qui n'avait rien à faire en stockage local -- et le tampon d'usage qui n'était plus jamais envoyé.
try {
  ['layerpitch_backstage_gh_token', 'layerpitch_backstage_ghOwner', 'layerpitch_backstage_ghRepo',
   'layerpitch_backstage_pg_read', 'layerpitch_backstage_pg_write', 'layerpitch_backstage_events_buffer']
    .forEach(k => localStorage.removeItem(k));
} catch (e) { /* stockage bloqué : rien à nettoyer */ }

