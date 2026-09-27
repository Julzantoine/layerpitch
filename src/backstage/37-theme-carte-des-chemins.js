/* ---------------- Thème de la carte des chemins (réglage global, palier Pro) ---------------- */
// Même principe que fillWaveformStyleField() ci-dessus (clé i18n dérivée du nom du thème, 'dark' ->
// 'seqMapThemeDark').
function fillSeqMapThemeField() {
  const select = document.getElementById('seqMapThemeSelect');
  const themes = window.LayerPlayerCore.SEQ_MAP_THEMES;
  if (!themes.includes(seqMapTheme)) seqMapTheme = 'light';
  select.innerHTML = themes.map(s => `<option value="${s}">${tr('seqMapTheme' + s[0].toUpperCase() + s.slice(1))}</option>`).join('');
  select.value = seqMapTheme;
  window.LayerPlayerCore.setSeqMapTheme(currentEffectivePlan === 'pro' ? seqMapTheme : 'light');
}
document.getElementById('seqMapThemeSelect').addEventListener('change', e => {
  seqMapTheme = window.LayerPlayerCore.SEQ_MAP_THEMES.includes(e.target.value) ? e.target.value : 'light';
  hasUnsavedEdits = true;
  window.LayerPlayerCore.setSeqMapTheme(currentEffectivePlan === 'pro' ? seqMapTheme : 'light');
  if (typeof rebuildAllCards === 'function') rebuildAllCards(); // reflète le nouveau thème dans les aperçus déjà à l'écran
});
// Même bascule verrouillé/modifiable que renderWaveformStyleForTier() ci-dessus.
function renderSeqMapThemeForTier() {
  const isPro = currentEffectivePlan === 'pro';
  const lockedEl = document.getElementById('seqMapThemeLocked');
  const selectEl = document.getElementById('seqMapThemeSelect');
  if (lockedEl) lockedEl.hidden = isPro;
  if (selectEl) selectEl.hidden = !isPro;
  window.LayerPlayerCore.setSeqMapTheme(isPro ? seqMapTheme : 'light');
}
fillSeqMapThemeField();
// Carte des chemins de l'aperçu : même disposition « aérée » que sur les pages publiques (24/09, « toute moche » en grille compacte) --
// l'aperçu montre ainsi ce que verra le visiteur ; la carte s'ajuste seule à la largeur du panneau (voir updateSeqMap).
window.LayerPlayerCore.setSeqMapDensity('roomy');

