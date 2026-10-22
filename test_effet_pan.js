// Effet « Pan » (22/10) : place une voix à gauche ou à droite de l'image stéréo. Un StereoPanner termine la chaîne d'effets de la voix,
// réglé par fx.pan.value (-1 à 1, 0 = centre) ; sans fx.pan la chaîne n'en crée pas ; il suit aussi les triggers (applyFxToChain).
const { loadBackstage } = require('./scripts/test-harness.js');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }
(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  const C = window.LayerPlayerCore;
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, cancelScheduledValues() {}, setTargetAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } });
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), pan: param() });
  const ctx = { currentTime: 0, sampleRate: 48000, createGain: node, createStereoPanner: node };
  const noPan = { currentTime: 0, sampleRate: 48000, createGain: node };

  const chain = C.buildLayerFxChain(ctx, { pan: { value: -0.7 } }, null, 0);
  check('fx.pan crée un StereoPanner en bout de chaîne', !!chain && !!chain.nodes.pan && chain.output === chain.nodes.pan);
  check('la position réglée est appliquée (-0,7)', chain.nodes.pan.pan.value === -0.7);
  C.applyFxToChain(ctx, chain, { pan: { value: 2 } }, 0);
  check('une valeur hors limites est ramenée à +1', chain.nodes.pan.pan.value === 1);
  C.applyFxToChain(ctx, chain, {}, 0);
  check('sans fx.pan (trigger coupé) : retour au centre', chain.nodes.pan.pan.value === 0);
  check('sans fx.pan ni autre effet : aucune chaîne', C.buildLayerFxChain(ctx, {}, null, 0) === null);
  const withVol = C.buildLayerFxChain(ctx, { volume: { db: -6 }, pan: { value: 0.4 } }, null, 0);
  check('volume puis pan : le pan reste le dernier maillon', withVol.output === withVol.nodes.pan && !!withVol.nodes.volume);
  const forced = C.buildLayerFxChain(ctx, {}, null, 0, undefined, ['pan']);
  check('un trigger qui active le pan plus tard : le nœud existe déjà (forceKeys)', !!forced && !!forced.nodes.pan && forced.nodes.pan.pan.value === 0);
  let threw = false;
  try { const c2 = C.buildLayerFxChain(noPan, { pan: { value: 0.5 } }, null, 0); check('navigateur sans StereoPanner : la voix passe sans pan, sans erreur', !!c2 && !c2.nodes.pan); } catch (e) { threw = true; }
  check('navigateur sans StereoPanner : pas d’exception', !threw);

  console.log(failures ? failures + ' échec(s)' : 'Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
