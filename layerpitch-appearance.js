// layerpitch-appearance.js — LayerPitch, apparence de l'INTERFACE (29/09, demande de Jules-Antoine : « tous les backstage
// doivent pouvoir être modifiés dans leur apparence, comme le backstage compositeur »).
//
// Une seule implémentation pour toutes les pages d'espace (Backstage compositeur, studio, Projets, fan, compte,
// catalogue…) : thème Jour / Nuit, couleur de fond (en Jour seulement), image de fond en filigrane. Réglages LOCAUX à
// cet ordinateur (localStorage), communs à toutes les pages ; sans rapport avec l'apparence publique (AdReels,
// vitrines). Les clés de stockage sont celles que le Backstage compositeur utilisait déjà : le réglage existant est
// conservé.
//
//   LayerPitchAppearance.mountPanel(élément)   dessine le panneau de réglage dans l'élément (Backstage : onglet Réglages ;
//                                              autres pages : fenêtre « Apparence » de la barre latérale, layerpitch-shell.js)
//   LayerPitchAppearance.getTheme() / setTheme('light'|'dark')
//
// Pages dont --bg désigne les BLOCS (et non le fond de page), comme le Backstage : classe lp-bg-blocks sur <html>.
(function () {
  const KEYS = {
    theme: 'layerpitch_backstage_theme', bg: 'layerpitch_backstage_bg_color', image: 'layerpitch_backstage_watermark_image',
    opacity: 'layerpitch_backstage_watermark_opacity', fixed: 'layerpitch_backstage_watermark_fixed',
  };
  const html = document.documentElement;
  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }; // stockage plein ou bloqué : le réglage reste appliqué pour la session, sans être mémorisé
  const drop = k => { try { localStorage.removeItem(k); } catch (e) { /* rien à retirer */ } };

  const lang = () => {
    const q = new URLSearchParams(location.search).get('lang');
    return (q || read('layerpitch_lang') || 'fr') === 'en' ? 'en' : 'fr';
  };
  function tr(key) {
    const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
    return ((I[lang()] || {}).shell || {})[key] || ((I.fr || {}).shell || {})[key] || key;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Thème nuit : même hiérarchie de surfaces à trois niveaux qu'en plein jour (barre la plus sombre < fond de page < blocs),
  // juste inversée. Couleurs sémantiques (accent, succès) laissées telles quelles.
  const STYLE = `
  html[data-theme="dark"] { --bg-card: #2c2c31; --text-dim: #b3b1ac; --text-dimmer: #7d7b76; --border: #3d3d42; --accent-soft: #1c2f47;
    --backstage-bg: #1a1a1d; --bg-sidebar: #131315; --text: #ece9e2; color-scheme: dark; }
  html[data-theme="dark"]:not(.lp-bg-blocks) { --bg: #1a1a1d; }
  html[data-theme="dark"].lp-bg-blocks { --bg: #26262a; }
  body { background: var(--backstage-bg, var(--bg)); }
  #lpWatermarkLayer { position: fixed; inset: 0; z-index: -1; pointer-events: none; background-repeat: no-repeat; background-position: center center; background-size: cover; opacity: .08; }
  #lpWatermarkLayer.scrolls-with-page { position: absolute; top: 0; left: 0; right: 0; bottom: auto; height: 100vh; }
  .lp-ap { font-size: 13px; color: var(--text, #24262b); }
  .lp-ap label.lp-ap-label { display: block; font-weight: 600; margin: 12px 0 6px; }
  .lp-ap label.lp-ap-label:first-child { margin-top: 0; }
  .lp-ap-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .lp-ap button { font: inherit; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--border, #e2e2e6); background: var(--bg-card, #fff); color: var(--text, #24262b); cursor: pointer; }
  .lp-ap button.on { background: var(--accent, #2f80c0); border-color: var(--accent, #2f80c0); color: #fff; }
  .lp-ap input[type=color] { width: 56px; height: 30px; padding: 0; border: 1px solid var(--border, #e2e2e6); border-radius: 6px; background: none; }
  .lp-ap input[type=color]:disabled { opacity: .4; }
  .lp-ap input[type=range] { width: 100%; }
  .lp-ap-hint { font-size: 12px; color: var(--text-dim, #5f636b); margin-top: 6px; line-height: 1.4; }
  .lp-ap-err { font-size: 12px; color: #b23; margin-top: 6px; }`;
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  const layer = document.createElement('div');
  layer.id = 'lpWatermarkLayer';
  document.body.insertBefore(layer, document.body.firstChild);

  function getTheme() { return read(KEYS.theme) === 'dark' ? 'dark' : 'light'; }
  // Réglage imposé par une page (apparence d'équipe d'un Projet, 8/10) : { bg, image, opacity, fixed }. Il remplace couleur et image
  // locales tant qu'il est posé, sans toucher aux réglages enregistrés ; le thème Jour / Nuit reste celui de chacun. null = retiré.
  let over = null;
  function apply() {
    const dark = getTheme() === 'dark';
    html.setAttribute('data-theme', dark ? 'dark' : 'light');
    // La couleur perso ne veut dire quelque chose qu'en Jour : en style inline elle l'emporterait sur le thème Nuit.
    const bg = over ? over.bg : read(KEYS.bg);
    if (!dark && bg) html.style.setProperty('--backstage-bg', bg); else html.style.removeProperty('--backstage-bg');
    const img = over ? over.image : read(KEYS.image);
    layer.style.backgroundImage = img ? `url(${img})` : 'none';
    const op = parseInt(over ? String(over.opacity == null ? 8 : over.opacity) : (read(KEYS.opacity) || '8'), 10);
    layer.style.opacity = String((isNaN(op) ? 8 : op) / 100);
    layer.classList.toggle('scrolls-with-page', over ? over.fixed === false : read(KEYS.fixed) === '0');
  }
  function changed() { apply(); document.dispatchEvent(new CustomEvent('lp-appearance-change')); }
  function setOverride(o) { over = o && (o.bg || o.image) ? { bg: o.bg || null, image: o.image || null, opacity: o.opacity, fixed: o.fixed } : null; apply(); }
  function setTheme(t) { write(KEYS.theme, t === 'dark' ? 'dark' : 'light'); changed(); }
  apply();

  // Image de fond : réduite avant stockage (une photo brute dépasse vite les ~5 Mo de localStorage : l'enregistrement
  // échouait alors en silence, signalé trois fois le 21/09). Si même la version la plus réduite ne tient pas, on le dit.
  const MAX_SIDES = [1920, 1280, 800];
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
      img.src = url;
    });
  }
  function encodeScaled(img, maxSide, mime) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(mime, 0.82);
  }
  // JPEG pour une photo JPEG ; WebP sinon (garde la transparence d'un PNG ; Safari retombe de lui-même sur du PNG).
  // Renvoie null si tout va bien, sinon la clé du message d'erreur.
  async function saveImage(file) {
    let img;
    try { img = await loadImage(file); } catch (e) { return 'appearanceImageUnreadable'; }
    if (!img.naturalWidth || !img.naturalHeight) return 'appearanceImageUnreadable';
    const mime = /jpe?g/i.test(file.type) ? 'image/jpeg' : 'image/webp';
    for (const side of MAX_SIDES) {
      if (write(KEYS.image, encodeScaled(img, side, mime))) { changed(); return null; }
    }
    drop(KEYS.image); // l'ancienne image ne doit pas réapparaître à la place de celle-ci
    changed();
    return 'appearanceImageNotSaved';
  }

  // Réduit une image choisie par l'utilisateur jusqu'à ce que son adresse de données tienne dans maxChars (sans l'enregistrer).
  // Renvoie { dataUrl } ou { error: clé du message }.
  async function scaleImage(file, maxChars) {
    let img;
    try { img = await loadImage(file); } catch (e) { return { error: 'appearanceImageUnreadable' }; }
    if (!img.naturalWidth || !img.naturalHeight) return { error: 'appearanceImageUnreadable' };
    const mime = /jpe?g/i.test(file.type) ? 'image/jpeg' : 'image/webp';
    for (const side of MAX_SIDES.concat([480])) {
      const url = encodeScaled(img, side, mime);
      if (url.length <= (maxChars || 450000)) return { dataUrl: url };
    }
    return { error: 'appearanceImageNotSaved' };
  }

  function mountPanel(host) {
    if (!host) return;
    function draw(errKey) {
      const dark = getTheme() === 'dark', hasImg = !!read(KEYS.image);
      host.innerHTML = `<div class="lp-ap">
        <label class="lp-ap-label">${esc(tr('appearanceTheme'))}</label>
        <div class="lp-ap-row"><button type="button" data-theme="light" class="${dark ? '' : 'on'}">${esc(tr('appearanceLight'))}</button><button type="button" data-theme="dark" class="${dark ? 'on' : ''}">${esc(tr('appearanceDark'))}</button></div>
        <label class="lp-ap-label">${esc(tr('appearanceBgColor'))}</label>
        <input type="color" id="lpApBg" value="${esc(read(KEYS.bg) || '#f5f6f8')}" ${dark ? 'disabled' : ''}>
        <div class="lp-ap-hint">${esc(tr(dark ? 'appearanceBgHintDark' : 'appearanceBgHint'))}</div>
        <label class="lp-ap-label">${esc(tr('appearanceImage'))}</label>
        <div class="lp-ap-row"><button type="button" id="lpApPick">${esc(tr('appearanceImagePick'))}</button>${hasImg ? `<button type="button" id="lpApClear">${esc(tr('appearanceImageClear'))}</button>` : ''}</div>
        <input type="file" id="lpApFile" accept="image/*" hidden>
        ${hasImg ? `<label class="lp-ap-label">${esc(tr('appearanceOpacity'))}</label><input type="range" id="lpApOp" min="0" max="100" step="1" value="${esc(read(KEYS.opacity) || '8')}">
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px;"><input type="checkbox" id="lpApFixed" ${read(KEYS.fixed) === '0' ? '' : 'checked'}> ${esc(tr('appearanceImageFixed'))}</label>` : ''}
        ${errKey ? `<div class="lp-ap-err">${esc(tr(errKey))}</div>` : ''}
        <div class="lp-ap-hint">${esc(tr('appearanceHint'))}</div></div>`;
      host.querySelectorAll('[data-theme]').forEach(b => { b.onclick = () => setTheme(b.dataset.theme); });
      const bg = host.querySelector('#lpApBg');
      // Pendant le choix : appliqué en direct sans redessiner le panneau (sinon le sélecteur de couleur se fermerait).
      bg.oninput = () => { write(KEYS.bg, bg.value); apply(); };
      host.querySelector('#lpApPick').onclick = () => host.querySelector('#lpApFile').click();
      host.querySelector('#lpApFile').onchange = async e => { const f = e.target.files[0]; if (f) { const err = await saveImage(f); draw(err); } };
      const clear = host.querySelector('#lpApClear');
      if (clear) clear.onclick = () => { drop(KEYS.image); changed(); };
      const op = host.querySelector('#lpApOp');
      if (op) op.oninput = () => { write(KEYS.opacity, op.value); apply(); };
      const fx = host.querySelector('#lpApFixed');
      if (fx) fx.onchange = () => { write(KEYS.fixed, fx.checked ? '1' : '0'); apply(); };
    }
    draw();
    // Un autre panneau de la même page (ou l'autre onglet) a changé le réglage : on se redessine.
    document.addEventListener('lp-appearance-change', () => { if (host.isConnected) draw(); });
  }

  window.LayerPitchAppearance = { mountPanel, getTheme, setTheme, setOverride, scaleImage };
})();
