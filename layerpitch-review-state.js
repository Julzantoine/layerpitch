// layerpitch-review-state.js — LayerPitch, relecture client d'un morceau (23/11, migration 20261123010000).
//
// Met en mots l'« état du lecteur » enregistré avec un commentaire (voir wrapper.lpReview.state() dans src/player/32-pause-reprise-lecture.js) :
// l'instant, l'endroit entendu (boucle, section, emplacement) et ce qui changeait le son (intensité, voix coupées ou en solo, volumes,
// événements actifs, curseurs déplacés). Partagé par la page du client (relecture.html) et le Backstage, pour qu'ils disent la même chose.
//
//   LayerPitchReviewState.describe(state, lang) -> { at: '1:23', where: 'Combat', chips: ['Intensité 2 / 3', 'Coupé : Piano', …] }
//   LayerPitchReviewState.clock(seconds)        -> '1:23'
//
// Libellés : LAYERPITCH_I18N[lang].review (clés rs*), le français servant de repli ; aucune liste de langues codée en dur.
(function () {
  if (window.LayerPitchReviewState) return;
  function label(lang, key, vars) {
    const I = window.LAYERPITCH_I18N || {};
    let s = ((I[lang] || {}).review || {})[key] || ((I.fr || {}).review || {})[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k] == null ? '' : vars[k]); });
    return s;
  }
  function clock(t) {
    t = Math.max(0, Number(t) || 0);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function describe(st, lang) {
    lang = lang || document.documentElement.lang || 'fr';
    const out = { at: clock(st && st.t), where: '', chips: [] };
    if (!st || typeof st !== 'object') return out;
    // Hybride : la section entendue, puis l'état de son propre lecteur.
    const inner = st.hybrid && st.hybrid.child && typeof st.hybrid.child === 'object' ? st.hybrid.child : null;
    out.where = String(st.where || '').trim();
    const s = inner || st;
    const name = (k) => (s.voiceLabels && s.voiceLabels[k]) || k;
    if (Number.isInteger(s.level) && s.levelCount > 1) out.chips.push(label(lang, 'rsLevel', { n: s.level + 1, total: s.levelCount }));
    if (Array.isArray(s.soloed) && s.soloed.length) out.chips.push(label(lang, 'rsSolo', { names: s.soloed.map(name).join(', ') }));
    if (Array.isArray(s.muted) && s.muted.length) out.chips.push(label(lang, 'rsMuted', { names: s.muted.map(name).join(', ') }));
    if (s.volumes && typeof s.volumes === 'object') {
      Object.keys(s.volumes).forEach(k => out.chips.push(label(lang, 'rsVolume', { name: name(k), pct: Math.round(Number(s.volumes[k]) * 100) })));
    }
    if (Array.isArray(s.triggers) && s.triggers.length) {
      const names = [...new Set(s.triggers.map(x => (x && x.label) || '').filter(Boolean))];
      if (names.length) out.chips.push(label(lang, 'rsEvents', { names: names.join(', ') }));
    }
    if (Array.isArray(s.sliders)) {
      s.sliders.filter(x => x && Number.isFinite(Number(x.value)) && Math.abs(Number(x.value) - Number(x.def)) > 0.005)
        .forEach(x => out.chips.push(label(lang, 'rsSlider', { name: x.label || '—', pct: Math.round(Number(x.value) * 100) })));
    }
    return out;
  }
  window.LayerPitchReviewState = { describe, clock };
})();
