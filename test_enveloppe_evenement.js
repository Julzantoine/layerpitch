// Chronologie de l'enveloppe d'un événement (7/10, idée ADSR, étape 1 : visuel) : une ligne par groupe d'effets (propres + étapes, enfants
// compris), montée / maintien / retour calculés avec l'héritage des fondus, dessin mis à jour en direct. Le vrai Backstage dans jsdom.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window, doc = w.document, ev = c => w.eval(c);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 30));
  const input = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const trg = { id: 'T', label: 'Low life', fadeSec: 1, fadeOutSec: 2, relations: { autoOffSec: 3 },
    steps: [{ id: 'a', delaySec: 2, durationSec: 4, fx: {}, fadeSec: 0.5, children: [{ id: 'c', delaySec: 1, fx: {} }] }, { id: 'b', delaySec: 0, fx: {} }] };
  w.__trg = trg;
  const rows = ev('fxEnvelopeRows(__trg)');
  check('quatre lignes : événement, étape 1, son enfant, étape 2', rows.length === 4 && rows[0].own && rows[1].n === 1 && rows[2].depth === 2 && rows[3].n === 2);
  check('événement : montée 1 s (fondu d\'entrée), maintien 3 s, retour 2 s', rows[0].attack === 1 && rows[0].sustain === 3 && rows[0].release === 2 && rows[0].start === 0);
  check('étape 1 : part à 2 s, montée propre 0,5 s, maintien 4 s, retour hérité de l\'événement (2 s)', rows[1].start === 2 && rows[1].attack === 0.5 && rows[1].sustain === 4 && rows[1].release === 2);
  check('l\'enfant de l\'étape 1 est numéroté 1.1', rows[2].num === '1.1' && rows[1].num === '1' && rows[3].num === '2');
  check('enfant : départ cumulé 3 s (2 + 1), montée héritée (1 s), sans durée (jusqu\'à la fin)', rows[2].start === 3 && rows[2].attack === 1 && rows[2].sustain === null);
  check('étape 2 : part à 0 s, hérite de la montée (1 s) et du retour (2 s)', rows[3].start === 0 && rows[3].attack === 1 && rows[3].release === 2 && rows[3].sustain === null);
  const bare = ev("fxEnvelopeRows({ id: 'X', label: 'N' })");
  check('événement sans réglage : une ligne, montée par défaut 0,1 s, sans durée', bare.length === 1 && bare[0].attack === 0.1 && bare[0].sustain === null && bare[0].release === 0.1);
  const svg = ev("fxEnvelopeSvg(fxEnvelopeRows(__trg), { own: 'Événement', step: 'Étape {n}', aria: 'x' })");
  check('dessin : un tracé par ligne, tireté et « … » pour ce qui dure jusqu\'au second appui', (svg.match(/<path d="M/g) || []).length === 8 && /stroke-dasharray/.test(svg) && /…/.test(svg));
  check('dessin : axe en secondes', />0s</.test(svg) && />2s</.test(svg));

  // éditeur : présent dans la carte, mis à jour en direct
  const data = { library: [{ id: 'v', title: 'V', mode: 'vertical', base: 'https://m/v/', layers: [{ id: 'l0', label: 'A', file: 'a.ogg' }],
    fxTriggers: [{ id: 'T', label: 'Low life', target: { type: 'track' }, fx: {}, visible: true, steps: [{ id: 'a', delaySec: 2, durationSec: 4, fx: {} }] }] }], packs: [], collections: [], sfxLibrary: [], socials: [], adReels: [], customFonts: [] };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  await ev('loadData(true)'); await settle();
  ev("seqSelectedSlotIndex.delete('v'); manageLibrarySelectedId = 'v'; renderLibrary();"); await settle();
  const host = () => doc.querySelector('[data-fx-envelope] [data-role="envelopeBody"]');
  check('chronologie affichée dans la carte de l\'événement', !!host() && /<svg/.test(host().innerHTML));
  const before = host().innerHTML;
  input(doc.querySelector('[data-fxs-prop="delaySec"][data-sti="0"]'), '6'); await settle();
  check('changer le départ d\'une étape redessine la chronologie en direct', host().innerHTML !== before);
  const mid = host().innerHTML;
  input(doc.querySelector('[data-fxs-prop="durationSec"][data-sti="0"]'), '10'); await settle();
  check('changer la durée la redessine aussi', host().innerHTML !== mid);
  const m2 = host().innerHTML;
  input(doc.querySelector('[data-fxt-prop="fadeSec"][data-tri="0"]'), '2'); await settle();
  check('changer le fondu de l\'événement la redessine (héritage)', host().innerHTML !== m2);

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
