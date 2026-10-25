// layerpitch-photo-frame.js — LayerPitch, cadrage d'une photo dans un rond (annuaire des compositeurs, 25/10, migration 20261025010000).
// Cadrage = { x, y, zoom } : x et y = le point de l'image (0–100 %) placé au centre du rond, zoom 1–3 (1 = l'image couvre juste le rond).
// Sans cadrage : centre, zoom 1. Utilisé par la page publique (annuaire.html) et par l'aperçu glissable de Mon compte, pour que
// les deux montrent exactement la même chose.
//
//   LayerPitchPhotoFrame.normalize(frame)                    -> { x, y, zoom } borné
//   LayerPitchPhotoFrame.layout(frame, naturalW, naturalH)   -> { x, y, zoom, width, height, left, top } (en % du rond)
//   LayerPitchPhotoFrame.style(frame, naturalW, naturalH)    -> texte de style CSS pour l'<img> (position absolue dans le rond)
//   LayerPitchPhotoFrame.apply(img, frame)                   -> pose le style (attend le chargement de l'image si besoin)
(function () {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function normalize(frame) {
    const f = frame || {};
    const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
    return { x: clamp(num(f.x, 50), 0, 100), y: clamp(num(f.y, 50), 0, 100), zoom: clamp(num(f.zoom, 1), 1, 3) };
  }
  function layout(frame, naturalW, naturalH) {
    const f = normalize(frame);
    const a = naturalW > 0 && naturalH > 0 ? naturalW / naturalH : 1;
    // Taille de l'image en % du rond : « couvre » (le petit côté = 100 %) multiplié par le zoom.
    const width = (a >= 1 ? a : 1) * f.zoom * 100, height = (a >= 1 ? 1 : 1 / a) * f.zoom * 100;
    // Le point (x, y) doit rester dans la zone où l'image couvre tout le rond : sinon un bord vide apparaîtrait.
    const x = clamp(f.x, 5000 / width, 100 - 5000 / width), y = clamp(f.y, 5000 / height, 100 - 5000 / height);
    return { x, y, zoom: f.zoom, width, height, left: 50 - x * width / 100, top: 50 - y * height / 100 };
  }
  const r = n => Math.round(n * 100) / 100;
  function style(frame, naturalW, naturalH) {
    const l = layout(frame, naturalW, naturalH);
    return `position:absolute;max-width:none;width:${r(l.width)}%;height:${r(l.height)}%;left:${r(l.left)}%;top:${r(l.top)}%;object-fit:fill`;
  }
  function apply(img, frame) {
    const run = () => { img.setAttribute('style', style(frame, img.naturalWidth, img.naturalHeight)); };
    if (img.complete && img.naturalWidth) run(); else img.addEventListener('load', run, { once: true });
  }
  const api = { normalize, layout, style, apply, clamp };
  if (typeof window !== 'undefined') window.LayerPitchPhotoFrame = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
