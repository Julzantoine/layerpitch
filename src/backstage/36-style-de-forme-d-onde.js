/* ---------------- Style de forme d'onde (réglage global, palier Pro) ---------------- */
// Clé i18n dérivée du nom du style ('mirror' -> 'waveformStyleMirror') plutôt qu'une table de
// correspondance à part -- fillAppearanceFields() étant appelée dès le chargement du script (avant même
// currentAdReelId), une const déclarée plus bas dans ce fichier serait encore dans sa zone morte
// temporelle au premier appel.
// Choix par aperçu : une carte par style, avec une vraie forme d'onde dessinée par le moteur du lecteur
// (drawWaveformCanvas) sur un profil fictif fixe -- on clique sur la forme elle-même plutôt que sur un
// nom dans un menu.
function waveformPreviewPeaks(count) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const env = 0.25 + 0.75 * Math.sin(Math.PI * t) ** 0.7;
    return Math.min(1, env * (0.55 + 0.45 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37))));
  });
}
function drawWaveformStylePreviews() {
  const host = document.getElementById('waveformStylePicker');
  if (!host) return;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f80c0';
  host.querySelectorAll('canvas[data-wave-style]').forEach(canvas => {
    const style = canvas.dataset.waveStyle;
    const smooth = style === 'mirror' || style === 'layers';
    window.LayerPlayerCore.drawWaveformCanvas(canvas, waveformPreviewPeaks(smooth ? 160 : 48), color, style);
  });
}
function fillWaveformStyleField() {
  const host = document.getElementById('waveformStylePicker');
  const styles = window.LayerPlayerCore.WAVEFORM_STYLES;
  if (!styles.includes(waveformStyle)) waveformStyle = 'bars';
  host.innerHTML = styles.map(s => `
    <button type="button" class="waveform-style-card${s === waveformStyle ? ' active' : ''}" data-wave-style-btn="${s}" aria-pressed="${s === waveformStyle}">
      <canvas data-wave-style="${s}"></canvas>
      <span>${tr('waveformStyle' + s[0].toUpperCase() + s.slice(1))}</span>
    </button>`).join('');
  drawWaveformStylePreviews();
  window.LayerPlayerCore.setWaveformStyle(currentEffectivePlan === 'pro' ? waveformStyle : 'bars');
}
// Le panneau Apparence est souvent caché au premier dessin (canvas sans taille) : on redessine dès qu'il
// devient visible ou change de largeur.
new ResizeObserver(() => drawWaveformStylePreviews()).observe(document.getElementById('waveformStylePicker'));
document.getElementById('waveformStylePicker').addEventListener('click', e => {
  const btn = e.target.closest('[data-wave-style-btn]');
  if (!btn) return;
  waveformStyle = window.LayerPlayerCore.WAVEFORM_STYLES.includes(btn.dataset.waveStyleBtn) ? btn.dataset.waveStyleBtn : 'bars';
  hasUnsavedEdits = true;
  document.querySelectorAll('#waveformStylePicker .waveform-style-card').forEach(c => {
    const on = c.dataset.waveStyleBtn === waveformStyle;
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', on);
  });
  window.LayerPlayerCore.setWaveformStyle(currentEffectivePlan === 'pro' ? waveformStyle : 'bars');
  if (typeof rebuildAllCards === 'function') rebuildAllCards(); // reflète le nouveau style dans les aperçus déjà à l'écran
});
// Bascule le réglage entre verrouillé (Free/Starter -- message + sélecteur masqué, "Barres" imposé) et
// modifiable (Pro) -- rappelée par renderAppearancePanelForTier(), donc à chaque bascule d'AdReel et à
// chaque résolution/changement de palier, même mécanisme que le filtre de dates de l'onglet Analytics.
function renderWaveformStyleForTier() {
  const isPro = currentEffectivePlan === 'pro';
  const lockedEl = document.getElementById('waveformStyleLocked');
  const selectEl = document.getElementById('waveformStylePicker');
  if (lockedEl) lockedEl.hidden = isPro;
  if (selectEl) selectEl.hidden = !isPro;
  window.LayerPlayerCore.setWaveformStyle(isPro ? waveformStyle : 'bars');
}
fillWaveformStyleField();

