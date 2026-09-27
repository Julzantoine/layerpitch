/* ---------------- Style de forme d'onde (réglage global, palier Pro) ---------------- */
// Clé i18n dérivée du nom du style ('mirror' -> 'waveformStyleMirror') plutôt qu'une table de
// correspondance à part -- fillAppearanceFields() étant appelée dès le chargement du script (avant même
// currentAdReelId), une const déclarée plus bas dans ce fichier serait encore dans sa zone morte
// temporelle au premier appel.
function fillWaveformStyleField() {
  const select = document.getElementById('waveformStyleSelect');
  const styles = window.LayerPlayerCore.WAVEFORM_STYLES;
  if (!styles.includes(waveformStyle)) waveformStyle = 'bars';
  select.innerHTML = styles.map(s => `<option value="${s}">${tr('waveformStyle' + s[0].toUpperCase() + s.slice(1))}</option>`).join('');
  select.value = waveformStyle;
  window.LayerPlayerCore.setWaveformStyle(currentEffectivePlan === 'pro' ? waveformStyle : 'bars');
}
document.getElementById('waveformStyleSelect').addEventListener('change', e => {
  waveformStyle = window.LayerPlayerCore.WAVEFORM_STYLES.includes(e.target.value) ? e.target.value : 'bars';
  hasUnsavedEdits = true;
  window.LayerPlayerCore.setWaveformStyle(currentEffectivePlan === 'pro' ? waveformStyle : 'bars');
  if (typeof rebuildAllCards === 'function') rebuildAllCards(); // reflète le nouveau style dans les aperçus déjà à l'écran
});
// Bascule le réglage entre verrouillé (Free/Starter -- message + select masqué, "Barres" imposé) et
// modifiable (Pro) -- rappelée par renderAppearancePanelForTier(), donc à chaque bascule d'AdReel et à
// chaque résolution/changement de palier, même mécanisme que le filtre de dates de l'onglet Analytics.
function renderWaveformStyleForTier() {
  const isPro = currentEffectivePlan === 'pro';
  const lockedEl = document.getElementById('waveformStyleLocked');
  const selectEl = document.getElementById('waveformStyleSelect');
  if (lockedEl) lockedEl.hidden = isPro;
  if (selectEl) selectEl.hidden = !isPro;
  window.LayerPlayerCore.setWaveformStyle(isPro ? waveformStyle : 'bars');
}
fillWaveformStyleField();

