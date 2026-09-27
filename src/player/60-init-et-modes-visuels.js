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

