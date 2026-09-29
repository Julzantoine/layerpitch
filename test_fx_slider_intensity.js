// Curseur qui pilote la structure (26/09 vertical, 30/09 embranchement-vertical) : un curseur de paramètre remplace les
// boutons (couches 1/2/3, boucles nommées) -- n couches ou n boucles = n zones (limites réglables, découpage égal par défaut),
// un seul curseur par morceau. Pas pour le vertical-random ni le séquentiel (décision du 30/09).
const fs = require('fs');
const path = require('path');
const { loadBackstage } = require('./scripts/test-harness.js');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  const C = window.LayerPlayerCore;

  // ---- Fonctions pures ----
  const eq3 = C.fxIntensityBounds(null, 3);
  check('3 couches sans limites : découpage égal (1/3, 2/3)', eq3.length === 2 && Math.abs(eq3[0] - 1 / 3) < 1e-9 && Math.abs(eq3[1] - 2 / 3) < 1e-9);
  check('limites réglables conservées (30 %, 60 %)', JSON.stringify(C.fxIntensityBounds([0.3, 0.6], 3)) === '[0.3,0.6]');
  check('limites dans le désordre : triées', JSON.stringify(C.fxIntensityBounds([0.6, 0.3], 3)) === '[0.3,0.6]');
  check('nombre de limites incohérent (couche ajoutée) : retour au découpage égal', C.fxIntensityBounds([0.3, 0.6], 4).length === 3);
  check('moins de 2 couches : pas de zones', C.fxIntensityBounds([0.5], 1) === null);
  const b = [0.3, 0.6];
  check('0 % -> intensité 1', C.fxSliderIntensityLevel(b, 0) === 0);
  check('29 % -> intensité 1', C.fxSliderIntensityLevel(b, 0.29) === 0);
  check('30 % -> intensité 2', C.fxSliderIntensityLevel(b, 0.3) === 1);
  check('59 % -> intensité 2', C.fxSliderIntensityLevel(b, 0.59) === 1);
  check('60 % -> intensité 3', C.fxSliderIntensityLevel(b, 0.6) === 2);
  check('100 % -> intensité 3', C.fxSliderIntensityLevel(b, 1) === 2);

  const layers = [{ label: 'Calme', file: 'a.ogg' }, { label: 'Tension', file: 'b.ogg' }, { label: 'Combat', file: 'c.ogg' }];
  const vertical = extra => Object.assign({ id: 'v1', title: 'V', mode: 'vertical', duration: 8, layers }, extra);
  const slIntensity = { id: 's1', label: 'Ennemis', defaultValue: 0.5, visible: true, bindings: [], thresholds: [], intensity: { bounds: [0.3, 0.6] } };
  const slHealth = { id: 's2', label: 'Santé', defaultValue: 1, visible: true, bindings: [{ target: { type: 'track' }, param: 'highcut.frequency', from: 800, to: 20000 }], thresholds: [] };

  const valid = C.fxSlidersValid(vertical({ fxSliders: [slIntensity, slHealth] }));
  check('un curseur sans liaison ni seuil mais qui pilote l\'intensité est gardé', valid.some(s => s.id === 's1'));
  check('le curseur Santé ne pilote pas l\'intensité', !valid.find(s => s.id === 's2').intensity);
  const two = C.fxSlidersValid(vertical({ fxSliders: [slIntensity, Object.assign({}, slIntensity, { id: 's3' })] }));
  check('deux curseurs d\'intensité : seul le premier pilote', two.filter(s => s.intensity).length === 1 && two[0].intensity);
  check('séquentiel et vertical-random : pas de zones (décision du 30/09)', C.fxSlidersValid({ mode: 'sequential', layers, segmentSlots: [{}, {}], fxSliders: [slIntensity] }).length === 0 && C.fxSlidersValid({ mode: 'vertical-random', sections: [{}, {}], fxSliders: [slIntensity] }).length === 0);
  // ---- Embranchement-vertical : une zone par boucle ----
  const loops = [{ id: 'l1', label: 'Calme', file: 'a.ogg', isInitial: true, bars: 4 }, { id: 'l2', label: 'Tension', file: 'b.ogg', bars: 4 }, { id: 'l3', label: 'Combat', file: 'c.ogg', bars: 4 }];
  const embr = extra => Object.assign({ id: 'e1', title: 'E', mode: 'embranchement-vertical', duration: 8, bpm: 120, beatsPerBar: 4, loops }, extra);
  check('embranchement-vertical : 3 boucles = 3 zones', C.fxStructureZones(embr()).join() === 'Calme,Tension,Combat');
  check('embranchement-vertical : le curseur qui pilote les boucles est gardé', C.fxSlidersValid(embr({ fxSliders: [slIntensity] })).some(x => x.intensity && x.intensity.length === 2));
  const embrRowButtons = C.buildTrackRow(embr({ fxSliders: [slHealth] }), [], false, true);
  check('embranchement-vertical sans curseur de structure : boutons de boucles visibles', !!embrRowButtons.querySelector('[data-role="embrLoopPicker"]') && embrRowButtons.querySelector('[data-role="embrLoopPicker"]').closest('.track-intensity-block').style.display !== 'none');
  const embrRowSlider = C.buildTrackRow(embr({ fxSliders: [slIntensity] }), [], false, true);
  check('embranchement-vertical avec curseur de structure : boutons de boucles masqués, curseur affiché', embrRowSlider.querySelector('[data-role="embrLoopPicker"]').closest('.track-intensity-block').style.display === 'none' && !!embrRowSlider.querySelector('[data-fx-slider="s1"]'));
  const embrTrack = embr({ id: 'e2', fxSliders: [slIntensity] });
  const embrWrap = C.buildTrackRow(embrTrack, [], false, true);
  window.document.body.appendChild(embrWrap);
  C.initTrackPlayer(embrTrack, embrWrap);
  const embrInp = embrWrap.querySelector('[data-fx-slider="s1"]');
  let threw = false;
  try { embrInp.value = '75'; embrInp.dispatchEvent(new window.Event('input', { bubbles: true })); } catch (e) { threw = true; }
  check('embranchement-vertical à l\'arrêt : bouger le curseur ne casse rien et affiche la zone', !threw && /Combat/.test(embrWrap.querySelector('[data-fx-zone="s1"]').textContent));

  // ---- Lecteur : boutons OU curseur ----
  const rowButtons = C.buildTrackRow(vertical({ fxSliders: [slHealth] }), [], false, true);
  check('sans curseur d\'intensité : boutons 1/2/3 affichés', rowButtons.querySelectorAll('.intensity-chip').length === 3);
  const rowSlider = C.buildTrackRow(vertical({ fxSliders: [slIntensity, slHealth] }), [], false, true);
  check('avec curseur d\'intensité : plus de boutons 1/2/3', rowSlider.querySelectorAll('.intensity-chip').length === 0);
  check('avec curseur d\'intensité : curseur public affiché', !!rowSlider.querySelector('[data-fx-slider="s1"]'));

  // ---- Lecteur en marche : bouger le curseur change l'intensité au franchissement d'une limite ----
  const events = [];
  window.umami = { track: (name, detail) => events.push({ name, detail }) };
  const trk = vertical({ id: 'v2', fxSliders: [slIntensity] });
  const wrap = C.buildTrackRow(trk, [], false, true);
  window.document.body.appendChild(wrap);
  C.initTrackPlayer(trk, wrap);
  const inp = wrap.querySelector('[data-fx-slider="s1"]');
  const move = pct => { inp.value = String(pct); inp.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const levels = () => events.filter(e => e.name === 'intensity_change').map(e => e.detail.level);
  move(55);
  check('50 % -> 55 % (même zone) : aucun changement d\'intensité', levels().length === 0);
  move(75);
  check('55 % -> 75 % : passage à l\'intensité 3', JSON.stringify(levels()) === '[2]');
  move(80);
  check('75 % -> 80 % : rien de plus', JSON.stringify(levels()) === '[2]');
  move(10);
  check('80 % -> 10 % : retour à l\'intensité 1', JSON.stringify(levels()) === '[2,0]');

  // ---- Backstage : interrupteur + zones ----
  window.eval('currentUserIsAdmin = true'); window.eval('fxOpen = function () { return true; }'); // curseurs ouverts (feu vert rtpc)
  const edNo = window.eval('fxSlidersEditorHtml')(vertical({ fxSliders: [slHealth] }), 0);
  check('Backstage : interrupteur « Pilote la structure » proposé en mode vertical', edNo.includes('data-fxs-prop="intensity"'));
  const edYes = window.eval('fxSlidersEditorHtml')(vertical({ fxSliders: [slIntensity] }), 0);
  check('Backstage : 2 limites réglables pour 3 couches', (edYes.match(/data-field="fxSliderIntensityBound"/g) || []).length === 2);
  check('Backstage : zone nommée d\'après la couche', edYes.includes('(Tension)') && edYes.includes('value="30"') && edYes.includes('value="60"'));
  const edSeq = window.eval('fxSlidersEditorHtml')({ mode: 'sequential', layers, fxSliders: [slHealth] }, 0);
  check('Backstage : pas d\'interrupteur hors mode vertical', !edSeq.includes('data-fxs-prop="intensity"'));
  const cleaned = window.eval('fxSlidersClean')([slIntensity, slHealth]);
  check('enregistrement : zones conservées', JSON.stringify(cleaned[0].intensity) === '{"bounds":[0.3,0.6]}' && !('intensity' in cleaned[1]));

  // ---- Outil vidéo : les calques d'un morceau piloté par curseur suivent les points du curseur ----
  window.eval(fs.readFileSync(path.join(__dirname, 'capture-plan.js'), 'utf-8'));
  const P = window.LayerCapturePlan;
  const capTrack = vertical({ id: 'v3', fxSliders: [slIntensity] });
  const findTrack = id => (id === 'v3' ? capTrack : null);
  const segs = evs => evs.filter(e => e.name === 'layer_segment').map(e => e.detail.layerIndex + ':' + (+e.t.toFixed(2)) + '-' + (+(e.t + e.detail.duration).toFixed(2))).sort().join(' ');
  // Prise : départ à 50 % (intensité 2) à 1 s, curseur à 80 % à 5 s (intensité 3), arrêt à 20 s.
  const raw = [
    { t: 1, name: 'track_play', detail: { trackId: 'v3', mode: 'vertical', level: 1 } },
    { t: 5, name: 'fx_slider', detail: { trackId: 'v3', sliderId: 's1', value: 0.8 } },
    { t: 5, name: 'intensity_change', detail: { trackId: 'v3', level: 2 } },
    { t: 20, name: 'voices_stop', detail: { trackId: 'v3' } }
  ];
  const cap = P.materialize(raw, findTrack);
  check('prise : couches 1 et 2 dès 1 s, couche 3 dès 5 s', segs(cap) === '0:1-20 1:1-20 2:5-20');
  const before = cap.length;
  P.syncSliderIntensityLayers(cap, findTrack);
  check('recalcul sans retouche : rien ne bouge (pas de bloc rallongé ni dupliqué)', segs(cap) === '0:1-20 1:1-20 2:5-20' && cap.length === before);
  cap.find(e => e.name === 'fx_slider').t = 10;
  P.syncSliderIntensityLayers(cap, findTrack);
  check('point du curseur déplacé à 10 s : la couche 3 entre à 10 s', segs(cap) === '0:1-20 1:1-20 2:10-20');
  cap.find(e => e.name === 'fx_slider').detail.value = 0.1;
  P.syncSliderIntensityLayers(cap, findTrack);
  check('valeur du point passée à 10 % : retour à l\'intensité 1 à 10 s', segs(cap) === '0:1-20 1:1-10');
  cap.push({ t: 15, name: 'fx_slider', detail: { trackId: 'v3', sliderId: 's1', value: 0.65 } });
  P.syncSliderIntensityLayers(cap, findTrack);
  check('point ajouté à 15 s (65 %) : intensité 3 à 15 s', segs(cap) === '0:1-20 1:1-10 1:15-20 2:15-20');
  cap.push({ t: 0.5, name: 'fx_slider', detail: { trackId: 'v3', sliderId: 's1', value: 1 } });
  P.syncSliderIntensityLayers(cap, findTrack);
  check('point avant le lancement : sans effet (le lecteur repart de la position de départ)', segs(cap) === '0:1-20 1:1-10 1:15-20 2:15-20');
  const btnTrack = vertical({ id: 'v3', fxSliders: [slHealth] });
  const capBtn = P.materialize(raw, () => btnTrack);
  const segBtn = segs(capBtn);
  P.syncSliderIntensityLayers(capBtn, () => btnTrack);
  check('morceau à boutons : calques libres, jamais recalculés', segs(capBtn) === segBtn);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
