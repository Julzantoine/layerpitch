// layerpitch-help-engine.js — bulles d'aide au survol pour les pages autres que le Backstage (Projet, Atelier vidéo…).
// Même principe que le Backstage (src/backstage/12-bulles-d-aide.js) : un attribut data-help="clé" sur un élément, le
// texte vient de layerpitch-help.js (zones « projet » et « atelier »), une bulle apparaît après un court délai au survol.
// L'interrupteur est celui du « ? » de la barre (layerpitch-shell.js) / de l'Accueil : profiles.home_prefs.help_off, recopié
// dans ce navigateur (lp_home_prefs_v1). On le relit à chaque survol, et on suit les changements faits dans un autre cadre
// (événement « storage », message du Backstage, événement lp-help-change de la même page).
// À charger après layerpitch-help.js. Aucune dépendance au reste.
(function () {
  const PREFS = 'lp_home_prefs_v1';
  const lang = () => {
    let l = new URLSearchParams(location.search).get('lang');
    try { l = l || localStorage.getItem('layerpitch_lang'); } catch (e) { /* stockage indisponible */ }
    return l === 'en' ? 'en' : 'fr';
  };
  function isOff() { try { return !!(JSON.parse(localStorage.getItem(PREFS) || '{}') || {}).help_off; } catch (e) { return false; } }
  function text(key) {
    const H = window.LAYERPITCH_HELP || {};
    for (const d of [H[lang()] || {}, H.fr || {}]) for (const zone of Object.keys(d)) if (d[zone] && d[zone][key]) return d[zone][key];
    return '';
  }
  function apply(off) { if (document.body) document.body.classList.toggle('lp-help-off', !!off); }
  let tip = null, timer = null, current = null;
  function ensureTip() {
    if (tip) return tip;
    const st = document.createElement('style');
    st.textContent = '[data-help] { cursor: help; }'
      + ' #lpHelpTip { position: fixed; z-index: 100000; max-width: 320px; padding: 8px 11px; border-radius: 8px; font-size: 12px; line-height: 1.45;'
      + ' background: #25282d; color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.25); pointer-events: none; opacity: 0; transition: opacity .12s ease; }'
      + ' #lpHelpTip.visible { opacity: 1; }';
    document.head.appendChild(st);
    tip = document.createElement('div'); tip.id = 'lpHelpTip'; tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  }
  // Quand l'aide est allumée, l'infobulle native du navigateur (attribut title) laisserait deux bulles ; on la met de côté le temps
  // du survol (elle sert toujours quand l'aide est éteinte, et pour les lecteurs d'écran via aria-label).
  function stashTitle(el) { if (el.hasAttribute('title') && !isOff()) { el.dataset.lpTitle = el.getAttribute('title'); el.removeAttribute('title'); } }
  function restoreTitle(el) { if (el && el.dataset && el.dataset.lpTitle != null) { el.setAttribute('title', el.dataset.lpTitle); delete el.dataset.lpTitle; } }
  function hide() { clearTimeout(timer); if (tip) tip.classList.remove('visible'); restoreTitle(current); current = null; }
  function show(target) {
    if (isOff()) return;
    const msg = text(target.dataset.help); if (!msg) return;
    const t = ensureTip(); t.textContent = msg; t.classList.add('visible');
    const r = target.getBoundingClientRect(), tr = t.getBoundingClientRect(), m = 8;
    let top = r.top - tr.height - m; if (top < m) top = r.bottom + m;
    let left = r.left; if (left + tr.width > innerWidth - m) left = innerWidth - tr.width - m; if (left < m) left = m;
    t.style.top = top + 'px'; t.style.left = left + 'px';
  }
  document.addEventListener('mouseover', e => {
    const target = e.target.closest && e.target.closest('[data-help]');
    if (!target || target === current) return;
    restoreTitle(current); current = target; stashTitle(target); clearTimeout(timer); timer = setTimeout(() => show(target), 500);
  });
  document.addEventListener('mouseout', e => {
    const target = e.target.closest && e.target.closest('[data-help]');
    if (!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
    hide();
  });
  document.addEventListener('scroll', hide, true);
  const sync = () => { apply(isOff()); if (isOff()) hide(); };
  window.addEventListener('lp-help-change', sync);
  window.addEventListener('storage', e => { if (e.key === PREFS) sync(); });
  window.addEventListener('message', e => { if (e.data && e.data.source === 'lp-shell' && e.data.type === 'help') { try { const c = JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; c.help_off = !!e.data.off; localStorage.setItem(PREFS, JSON.stringify(c)); } catch (x) { /* stockage indisponible */ } sync(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
  window.LayerPitchHelpEngine = { isOff, text };
})();
