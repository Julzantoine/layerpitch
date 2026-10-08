/* ---------------- Visite guidée du Backstage (08/10) ---------------- */
// Tour du propriétaire : des bulles posées tour à tour sur les zones principales. Feu vert « in_app_tour » (admin seulement
// pour l'instant). Lancée toute seule à la première ouverture (mémorisée dans ce navigateur), relançable depuis le menu du compte.
const TOUR_DONE_STORAGE = 'layerpitch_tour_done_v1';
const TOUR_STEPS = [
  { titleKey: 'tourWelcomeTitle', textKey: 'tourWelcomeText' },
  { selector: '.nav-item[data-tab="content"]', titleKey: 'tourContentTitle', textKey: 'tourContentText' },
  { selector: '.nav-item[data-tab="appearance"]', titleKey: 'tourAppearanceTitle', textKey: 'tourAppearanceText' },
  { selector: '.nav-item[data-tab="library"]', titleKey: 'tourLibraryTitle', textKey: 'tourLibraryText' },
  { selector: '.nav-item[data-tab="packs"]', titleKey: 'tourPacksTitle', textKey: 'tourPacksText' },
  { selector: '#btnPublish', titleKey: 'tourPublishTitle', textKey: 'tourPublishText' },
  { selector: '#btnAccountMenu', titleKey: 'tourAccountTitle', textKey: 'tourAccountText' },
];
let tourRoot = null;
let tourIndex = 0;
let tourSteps = [];

function tourTargetVisible(el) {
  if (!el || el.hidden || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function tourMarkDone() { try { localStorage.setItem(TOUR_DONE_STORAGE, '1'); } catch (e) { /* stockage indisponible */ } }
function tourAlreadyDone() { try { return localStorage.getItem(TOUR_DONE_STORAGE) === '1'; } catch (e) { return false; } }

function closeBackstageTour() {
  if (tourRoot) { tourRoot.remove(); tourRoot = null; }
  window.removeEventListener('resize', renderTourStep);
  document.removeEventListener('keydown', tourKeydown, true);
  tourMarkDone();
}
function tourKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeBackstageTour(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tourGo(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); tourGo(-1); }
}
function tourGo(delta) {
  const next = tourIndex + delta;
  if (next < 0) return;
  if (next >= tourSteps.length) { closeBackstageTour(); return; }
  tourIndex = next;
  renderTourStep();
}
function renderTourStep() {
  if (!tourRoot) return;
  const step = tourSteps[tourIndex];
  const target = step.selector ? document.querySelector(step.selector) : null;
  const spot = tourRoot.querySelector('.tour-spot');
  const card = tourRoot.querySelector('.tour-card');
  const last = tourIndex === tourSteps.length - 1;
  card.innerHTML = `
    <div class="tour-count">${tourIndex + 1} / ${tourSteps.length}</div>
    <div class="tour-title">${escapeHtml(tr(step.titleKey))}</div>
    <div class="tour-text">${escapeHtml(tr(step.textKey))}</div>
    <div class="tour-actions">
      <button class="btn btn-small" type="button" data-tour="skip">${escapeHtml(tr(last ? 'tourClose' : 'tourSkip'))}</button>
      <span style="flex:1"></span>
      ${tourIndex > 0 ? `<button class="btn btn-small" type="button" data-tour="prev">${escapeHtml(tr('tourPrev'))}</button>` : ''}
      <button class="btn btn-small btn-primary" type="button" data-tour="next">${escapeHtml(tr(last ? 'tourFinish' : 'tourNext'))}</button>
    </div>`;
  card.querySelector('[data-tour="skip"]').onclick = closeBackstageTour;
  card.querySelector('[data-tour="next"]').onclick = () => tourGo(1);
  const prev = card.querySelector('[data-tour="prev"]');
  if (prev) prev.onclick = () => tourGo(-1);
  const margin = 12;
  if (target) {
    const r = target.getBoundingClientRect();
    spot.style.display = 'block';
    spot.style.top = (r.top - 4) + 'px'; spot.style.left = (r.left - 4) + 'px';
    spot.style.width = (r.width + 8) + 'px'; spot.style.height = (r.height + 8) + 'px';
    const cw = card.offsetWidth, ch = card.offsetHeight;
    // À droite de la cible (barre latérale) si ça tient, sinon dessous, sinon dessus.
    let left = r.right + margin, top = r.top;
    if (left + cw > window.innerWidth - margin) { left = Math.min(r.left, window.innerWidth - cw - margin); top = r.bottom + margin; }
    if (top + ch > window.innerHeight - margin) top = Math.max(margin, r.top - ch - margin);
    card.style.left = Math.max(margin, left) + 'px'; card.style.top = Math.max(margin, top) + 'px';
    card.style.transform = 'none';
  } else {
    spot.style.display = 'none';
    card.style.left = '50%'; card.style.top = '50%'; card.style.transform = 'translate(-50%, -50%)';
  }
}
function startBackstageTour() {
  if (tourRoot) return;
  tourSteps = TOUR_STEPS.filter(s => !s.selector || tourTargetVisible(document.querySelector(s.selector)));
  if (!tourSteps.length) return;
  tourIndex = 0;
  tourRoot = document.createElement('div');
  tourRoot.className = 'tour-root';
  tourRoot.setAttribute('role', 'dialog');
  tourRoot.innerHTML = '<div class="tour-spot"></div><div class="tour-card"></div>';
  document.body.appendChild(tourRoot);
  window.addEventListener('resize', renderTourStep);
  document.addEventListener('keydown', tourKeydown, true);
  renderTourStep();
}
// Appelée une fois les feux verts connus (fin de renderAdminOnlyPanels) : montre l'entrée du menu et lance la visite
// la toute première fois, sans jamais la relancer ensuite.
function syncBackstageTour() {
  const open = flagOpen('in_app_tour');
  const menuItem = document.getElementById('accountMenuTour');
  if (menuItem) menuItem.hidden = !open;
  if (open && !tourAlreadyDone() && !tourRoot) setTimeout(startBackstageTour, 600);
}
(function wireTourMenu() {
  const item = document.getElementById('accountMenuTour');
  if (!item) return;
  item.addEventListener('click', () => {
    const dd = document.getElementById('accountMenuDropdown');
    if (dd) dd.hidden = true;
    startBackstageTour();
  });
})();
