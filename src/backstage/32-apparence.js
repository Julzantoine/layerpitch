/* ---------------- Apparence : thème général + réglages par bloc ---------------- */
function fillAppearanceFields() {
  if (!profile.theme) profile.theme = Object.assign({}, DEFAULT_THEME);
  document.getElementById('appThemeBgColor').value = profile.theme.bgColor || DEFAULT_THEME.bgColor;
  document.getElementById('appThemeTitleColor').value = profile.theme.titleColor || DEFAULT_THEME.titleColor;
  document.getElementById('appThemeContentColor').value = profile.theme.contentColor || DEFAULT_THEME.contentColor;
  document.getElementById('appThemeSectionLabelColor').value = profile.theme.sectionLabelColor || DEFAULT_THEME.sectionLabelColor;
  document.getElementById('appThemeFont').innerHTML = buildFontSelectOptionsHtml(profile.theme.font || DEFAULT_THEME.font);
  renderCustomFontsList();
  fillWaveformStyleField();
  const bgImageCtrl = document.getElementById('appThemeBgImageCtrl');
  // « Retirer l'image de fond » (1er/10, demande d'un compositeur : une fois posée, impossible de l'enlever) : visible seulement
  // s'il y a une image (publiée ou choisie). Le fichier publié est effacé du stockage à la prochaine publication, s'il n'est
  // plus référencé (file d'orphelins), jamais avant.
  bgImageCtrl.innerHTML = fileCtrlHtml(tr('chooseBgImageFile'), `<button type="button" class="btn btn-small btn-danger" data-role="removeBgImage">${tr('removeBgImageBtn')}</button>`);
  const removeBgBtn = bgImageCtrl.querySelector('[data-role="removeBgImage"]');
  const refreshRemoveBg = () => { removeBgBtn.hidden = !(themeBgImagePendingFile || profile.theme.bgImage); };
  wireFileControl(bgImageCtrl, 'image/*',
    () => themeBgImagePendingFile, () => profile.theme.bgImage,
    f => { themeBgImagePendingFile = f; hasUnsavedEdits = true; refreshRemoveBg(); }, () => profile.theme.bgImageOriginalName);
  refreshRemoveBg();
  removeBgBtn.addEventListener('click', () => {
    if (profile.theme.bgImage) queueR2Delete('images/' + profile.theme.bgImage);
    profile.theme.bgImage = null; profile.theme.bgImageOriginalName = null;
    themeBgImagePendingFile = null;
    hasUnsavedEdits = true;
    fillAppearanceFields();
  });
  const opacityInput = document.getElementById('appThemeBgImageOpacity');
  const opacityVal = (profile.theme.bgImageOpacity != null) ? profile.theme.bgImageOpacity : DEFAULT_THEME.bgImageOpacity;
  opacityInput.value = opacityVal;
  document.getElementById('appThemeBgImageOpacityValue').textContent = Math.round(opacityVal * 100) + '%';
  const ar = adReels.find(a => a.id === currentAdReelId);
  document.getElementById('appLang').value = (ar && ar.lang) || 'fr';
  document.getElementById('appAllowIndexing').checked = !ar || ar.allowIndexing !== false;
  fillAdReelSlugField(ar);
  fillAdReelAccessField(ar);
  document.getElementById('appAdminTierOverride').value = profile.adminTierOverride || '';
  const sep = Object.assign({}, DEFAULT_SEPARATOR, profile.theme.separator || {});
  document.getElementById('appSeparatorVisible').checked = !!sep.visible;
  document.getElementById('appSeparatorColor').value = sep.color;
  document.getElementById('appSeparatorThickness').value = sep.thickness;
  renderAppearancePanelForTier();
}
// Réglage des séparateurs (Starter et au-dessus) : au même niveau que le thème général, jamais par bloc.
function handleSeparatorFieldChange(field, value) {
  if (!profile.theme) profile.theme = Object.assign({}, DEFAULT_THEME);
  if (!profile.theme.separator) profile.theme.separator = Object.assign({}, DEFAULT_SEPARATOR);
  profile.theme.separator[field] = value;
  hasUnsavedEdits = true;
}
document.getElementById('appSeparatorVisible').addEventListener('change', e => handleSeparatorFieldChange('visible', e.target.checked));
document.getElementById('appSeparatorColor').addEventListener('input', e => handleSeparatorFieldChange('color', e.target.value));
document.getElementById('appSeparatorThickness').addEventListener('input', e => handleSeparatorFieldChange('thickness', Math.max(1, parseInt(e.target.value, 10) || 1)));
// Galerie de presets (palier Free) : sélectionner un preset écrit UNIQUEMENT profile.theme.presetId,
// jamais les autres champs de profile.theme -- non-destructif si le compositeur repasse Starter plus
// tard (ses éventuels anciens réglages fins dorment intacts, voir migrateProfileTheme/repli Free côté
// page publique).
function renderThemePresetGallery() {
  const host = document.getElementById('themePresetGallery');
  if (!host) return;
  const currentId = (profile.theme && profile.theme.presetId) || 'default';
  host.innerHTML = THEME_PRESETS.map(p => `
    <button type="button" class="theme-preset-card${p.id === currentId ? ' active' : ''}" data-preset-id="${p.id}"
      style="background:${p.bgColor};color:${p.titleColor}">
      ${tr(p.labelKey)}
    </button>
  `).join('');
  host.querySelectorAll('.theme-preset-card').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!profile.theme) profile.theme = Object.assign({}, DEFAULT_THEME);
      profile.theme.presetId = btn.dataset.presetId;
      hasUnsavedEdits = true;
      renderThemePresetGallery();
    });
  });
}
// Départ rapide par preset pour le palier Pro (10 septembre) : contrairement à la galerie Free
// (renderThemePresetGallery, ci-dessus), qui écrit UNIQUEMENT profile.theme.presetId, ici on copie les
// valeurs concrètes du preset directement dans les champs éditables normaux -- aucune notion de
// "preset actif" à part, le compositeur peut ensuite tout retoucher (y compris par bloc/élément) comme
// s'il avait choisi ces couleurs à la main. Ne touche pas sectionLabelColor/bgImage (les presets ne les
// définissent pas, même logique que --accent jamais touché par un preset côté page publique).
function applyThemePresetQuickFill(presetId) {
  const preset = resolveAnyThemePreset(presetId);
  if (!profile.theme) profile.theme = Object.assign({}, DEFAULT_THEME);
  profile.theme.bgColor = preset.bgColor;
  profile.theme.titleColor = preset.titleColor;
  profile.theme.contentColor = preset.contentColor;
  profile.theme.font = preset.font;
  profile.theme.separator = Object.assign({}, preset.separator);
  hasUnsavedEdits = true;
  fillAppearanceFields();
}
function renderThemeProQuickStartGallery() {
  const host = document.getElementById('themeProQuickStartGallery');
  if (!host) return;
  host.innerHTML = THEME_PRESETS.concat(THEME_PRESETS_PRO).map(p => `
    <button type="button" class="theme-preset-card" data-preset-id="${p.id}"
      style="background:${p.bgColor};color:${p.titleColor}">
      ${tr(p.labelKey)}
    </button>
  `).join('');
  host.querySelectorAll('.theme-preset-card').forEach(btn => {
    btn.addEventListener('click', () => applyThemePresetQuickFill(btn.dataset.presetId));
  });
}
// Bascule le panneau Apparence de l'AdReel entre galerie de presets (Free), réglages fins seuls
// (Starter), ou réglages fins + départ rapide par preset (Pro, 10 septembre) selon currentEffectivePlan
// -- rappelée par fillAppearanceFields() (donc à chaque bascule d'AdReel/rechargement) et par
// renderSubscriptionPanel() (donc à chaque résolution/changement de palier). Recalcule aussi les cartes
// de bloc : la case "Personnaliser" par bloc doit disparaître avec le palier Free et réapparaître si le
// compositeur repasse Starter.
function renderAppearancePanelForTier() {
  const isFree = currentEffectivePlan === 'free';
  const isPro = currentEffectivePlan === 'pro';
  const gallery = document.getElementById('appThemeFreeGallery');
  const proQuickStart = document.getElementById('appThemeProQuickStart');
  const fullControls = document.getElementById('appThemeFullControls');
  if (gallery) gallery.style.display = isFree ? '' : 'none';
  if (proQuickStart) proQuickStart.style.display = isPro ? '' : 'none';
  if (fullControls) fullControls.style.display = isFree ? 'none' : '';
  if (isFree) renderThemePresetGallery();
  if (isPro) renderThemeProQuickStartGallery();
  renderWaveformStyleForTier();
  renderSeqMapThemeForTier();
  if (typeof rebuildAllCards === 'function') rebuildAllCards();
  if (typeof renderPacks === 'function') renderPacks();
  if (typeof renderCollections === 'function') renderCollections();
}

// ---- Tableau de bord Analytics (chantier 4-5 septembre) ----------------------------------------
// Palier Free : écran verrouillé, aucun appel réseau. Starter/Pro : chargé à la demande (pas au
// chargement du backstage) via la RPC Postgres get_my_analytics() (système propriétaire, remplace
// une première piste envisagée -- l'API Umami Cloud -- abandonnée avant d'être codée, voir
// docs/LAYERPITCH_CHANGELOG.md), qui applique déjà elle-même le gating par palier -- ce qui suit
// n'est qu'un affichage de ce qu'elle renvoie, jamais un masquage de données qui auraient autrement
// été reçues en clair.
let analyticsData = null;          // liste brute des visites (get_my_analytics), chargée à la demande
let analyticsRawLoadedForTier = null;
let analyticsOverview = null;      // vue d'ensemble (get_my_analytics_overview)
let analyticsLoadedForTier = null;
let analyticsSelected = null;      // { type, id } de l'AdReel/pack ouvert en détail
let analyticsEntityData = null;    // réponse de get_my_analytics_entity pour cet élément
let analyticsPreset = '7d';
let analyticsCustomRange = null;   // { from, to } (ISO) quand une période personnalisée est appliquée


// ---- Refonte de la page (23 septembre) : vue d'ensemble dans le temps, liste des AdReels/packs
// cliquables, détail par élément, presets de période. Les fonctions SQL get_my_analytics_overview /
// get_my_analytics_entity appliquent le gating par palier ; ce qui suit n'affiche que ce qu'elles
// renvoient (Starter : visites ; Pro : lectures, morceaux, réglages ajustés).
const ANALYTICS_PRESETS = {
  '24h': { hours: 24, days: 1, bucket: 'hour' },
  '7d': { days: 7, bucket: 'day' },
  '1m': { days: 30, bucket: 'day' },
  '6m': { days: 183, bucket: 'week' },
  '1y': { days: 365, bucket: 'week' },
};
// Rétention côté affichage : sert seulement à griser les presets trop longs ; la vraie limite est
// appliquée par les fonctions SQL (analytics_retention_days).
function analyticsRetentionDays() { return currentEffectivePlan === 'pro' ? 365 : 30; }

function analyticsRange() {
  if (analyticsCustomRange) {
    const spanDays = (new Date(analyticsCustomRange.to) - new Date(analyticsCustomRange.from)) / 864e5;
    return { from: analyticsCustomRange.from, to: analyticsCustomRange.to, bucket: spanDays <= 2 ? 'hour' : (spanDays <= 62 ? 'day' : 'week') };
  }
  const p = ANALYTICS_PRESETS[analyticsPreset] || ANALYTICS_PRESETS['7d'];
  const ms = p.hours ? p.hours * 3600e3 : p.days * 864e5;
  return { from: new Date(Date.now() - ms).toISOString(), to: null, bucket: p.bucket };
}

function renderAnalyticsPresets() {
  const retention = analyticsRetentionDays();
  document.querySelectorAll('#analyticsPresets .analytics-preset').forEach(btn => {
    const p = ANALYTICS_PRESETS[btn.dataset.preset];
    const locked = p && p.days > retention;
    btn.classList.toggle('locked', !!locked);
    btn.classList.toggle('active', !analyticsCustomRange && btn.dataset.preset === analyticsPreset);
    btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
    btn.title = locked ? tr('analyticsPresetLocked', { days: retention }) : '';
  });
}

// Rappelée par renderSubscriptionPanel() (donc à chaque résolution/changement de palier) -- bascule
// verrouillé/déverrouillé ; le chargement réseau est déclenché séparément (clic sur l'onglet).
function renderAnalyticsPanelForTier() {
  // Free : plus d'écran verrouillé (23 septembre) -- un aperçu flouté (voir renderAnalyticsView).
  // analyticsLocked ne s'affiche plus que si le serveur répond "verrouillé" (aucun profil compositeur).
  const lockedEl = document.getElementById('analyticsLocked');
  const unlockedEl = document.getElementById('analyticsUnlocked');
  if (lockedEl) lockedEl.hidden = true;
  if (unlockedEl) unlockedEl.hidden = false;
  renderAnalyticsPresets();
  if (analyticsOverview && analyticsLoadedForTier === currentEffectivePlan) renderAnalyticsView();
}

