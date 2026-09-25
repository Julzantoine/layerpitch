const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Outil vidéo « Test in game » (25/09) : de la frise (capture brute, éventuellement retouchée) au plan de rendu. Le rendu
// d'une capture NON retouchée a été vérifié identique à la sortie réelle du lecteur dans un navigateur ; ici on vérifie
// les règles elles-mêmes, y compris pour une frise retouchée : boucles qui rebouclent au lieu du silence, générations,
// queues de fin, coupures, bascules d'embranchement (et ce qu'elles ont déclenché), blocs ajoutés à la main, Sfx.
(async () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <script>${read('layerpitch-i18n.js')}</script><script>${read('player.js')}</script>
  <script>${read('capture-render.js')}</script><script>${read('capture-plan.js')}</script></body></html>`;
  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function P(v) { return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }; }
      function Ctx() { this.destination = {}; this.sampleRate = 44100; this.currentTime = 0; }
      Ctx.prototype.createGain = () => ({ gain: P(1), connect() {} });
      Ctx.prototype.resume = () => Promise.resolve();
      win.AudioContext = Ctx;
      win.ResizeObserver = function () { return { observe() {}, disconnect() {} }; };
    }
  });
  await new Promise(r => setTimeout(r, 50));
  const W = dom.window, CP = W.LayerCapturePlan;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
  const clone = o => JSON.parse(JSON.stringify(o));

  const vertical = { id: 'v', mode: 'vertical', base: 'https://m/v/', duration: 8, layers: [{ file: 'a.ogg' }, { file: 'b.ogg' }], fxTriggers: [], fxSliders: [] };
  const quant = Object.assign({}, vertical, { id: 'q', loopEngine: 'quantized' });
  const seq = { id: 's', mode: 'sequential', base: 'https://m/s/', fxTriggers: [], fxSliders: [],
    segmentSlots: [{ id: 'A', alternatives: [{ file: 'a.ogg' }], nextOptions: [{ targetId: 'B', transition: { file: 't.ogg' } }] }, { id: 'B', alternatives: [{ file: 'b.ogg' }] }] };
  const vr = { id: 'r', mode: 'vertical-random', base: 'https://m/r/', fxTriggers: [], fxSliders: [],
    sections: [{ id: 'S', pools: [{ alternatives: [{ file: 'p0.ogg' }] }, { alternatives: [null, { file: 'p1.ogg' }] }] }] };
  const embr = { id: 'e', mode: 'embranchement-vertical', base: 'https://m/e/', fxTriggers: [], fxSliders: [],
    loops: [{ id: 'L0', file: 'l0.ogg', isInitial: true, duration: 8 }, { id: 'L1', file: 'l1.ogg', duration: 8, cutStyle: 'custom', customCutFadeSec: 0.5 }, { id: 'D', file: 'd.ogg', isDetour: true, duration: 2, detourMode: 'once' }] };
  const sfx = { id: 'x', base: 'https://m/x/', alternatives: [{ file: null }, { file: 'x1.ogg' }], duckMainTrack: true };
  const tracks = { v: vertical, q: quant, s: seq, r: vr, e: embr };
  const findTrack = id => tracks[id], findSfx = id => (id === 'x' ? sfx : null);
  const plan = events => CP.buildPlan(events, { findTrack, findSfx }).plan;
  const at = (auto, t) => { let v = auto[0][2]; auto.forEach(a => { if (a[1] <= t + 1e-9) v = a[2]; }); return v; };

  // ---- Vertical, moteur simple : chaque couche tourne EN BOUCLE depuis le démarrage (plus de silence après le fichier) ----
  {
    const raw = [
      { t: 1, name: 'track_play', detail: { trackId: 'v' } },
      { t: 1, name: 'layer_run', detail: { trackId: 'v', offset: 0, loop: [0, 8], level: 0 } },
      { t: 4, name: 'intensity_change', detail: { trackId: 'v', level: 1 } },
      { t: 30, name: 'voices_stop', detail: { trackId: 'v' } },
    ];
    const ev = CP.materialize(raw, findTrack);
    const p = plan(ev);
    const vs = p.voices.filter(v => v.track.id === 'v');
    check('vertical simple : une voix par couche, en boucle sur la durée du morceau', vs.length === 2 && vs.every(v => v.loop && v.loop[1] === 8 && v.start === 1));
    check('vertical simple : les voix durent toute l\'écoute (au-delà de la longueur du fichier), arrêt à la fin de la capture', vs.every(v => v.stop === 30));
    const b = vs.find(v => v.targetKey === 'layer:1');
    check('vertical simple : couche 2 muette au départ, puis rampe d\'intensité de 1,4 s à 4 s', at(b.gain.auto, 1) === 0 && b.gain.auto.some(a => a[0] === 'lin' && near(a[1], 5.4) && a[2] === 1));
    // Retouche : segment ajouté à la main hors de toute écoute -> voix de repli qui boucle, calée sur la phase de l'écoute
    ev.push({ t: 40, name: 'layer_segment', detail: { trackId: 'v', layerIndex: 0, duration: 3 } });
    const p2 = plan(ev);
    const extra = p2.voices.find(v => v.track.id === 'v' && v.start === 40);
    check('vertical retouché : bloc ajouté hors écoute -> la couche joue, en boucle, calée sur la phase du morceau', !!extra && extra.loop && near(extra.offset, (40 - 1) % 8));
  }

  // ---- Vertical quantifié : une génération par tour, jouée jusqu'au bout ; l'intensité ne touche que la génération en cours ----
  {
    const raw = [
      { t: 0, name: 'track_play', detail: { trackId: 'q', level: 1 } },
      { t: 0, name: 'layer_gen', detail: { trackId: 'q', bufferOffset: 0, level: 1 } },
      { t: 8, name: 'layer_gen', detail: { trackId: 'q', bufferOffset: 1 } },
      { t: 10, name: 'intensity_change', detail: { trackId: 'q', level: 0 } },
      { t: 20, name: 'voices_stop', detail: { trackId: 'q' } },
    ];
    const p = plan(CP.materialize(raw, findTrack));
    const vs = p.voices.filter(v => v.track.id === 'q');
    check('quantifié : 2 générations x 2 couches, sans boucle (chaque génération joue jusqu\'au bout du fichier)', vs.length === 4 && vs.every(v => !v.loop && v.stop === 20));
    check('quantifié : la génération suivante part de l\'Entrée (bufferOffset annoncé)', vs.filter(v => v.start === 8).every(v => v.offset === 1));
    const g1 = vs.find(v => v.start === 0 && v.targetKey === 'layer:1'), g2 = vs.find(v => v.start === 8 && v.targetKey === 'layer:1');
    check('quantifié : baisse d\'intensité à 10 s -> seule la génération en cours (celle de 8 s) descend', !g1.gain.auto.some(a => a[1] >= 10) && g2.gain.auto.some(a => a[0] === 'lin' && a[2] === 0));
  }

  // ---- Séquentiel : queues de fin conservées, coupure en fondu, blocs déplacés / ajoutés ----
  {
    const raw = [
      { t: 0, name: 'seq_slot_start', detail: { trackId: 's', slotId: 'A', altIndex: 0 } },
      { t: 4, name: 'seq_transition_start', detail: { trackId: 's', fromSlotId: 'A', targetId: 'B', cut: { hard: false, fadeSec: 1 } } },
      { t: 6, name: 'seq_slot_start', detail: { trackId: 's', slotId: 'B', altIndex: 0 } },
      { t: 20, name: 'voices_stop', detail: { trackId: 's' } },
    ];
    const ev = CP.materialize(raw, findTrack);
    let vs = plan(ev).voices;
    const a = vs.find(v => v.url.indexOf('a.ogg') >= 0), tr = vs.find(v => v.url.indexOf('t.ogg') >= 0);
    check('séquentiel : coupure -> le bloc quitté s\'éteint en fondu d\'1 s à 4 s', a.gain.auto.some(x => x[0] === 'lin' && near(x[1], 5) && x[2] === 0) && near(a.stop, 5.05));
    check('séquentiel : enchaînement normal -> la transition garde sa queue (pas coupée à 6 s)', tr.stop === 20);
    // Retouches : transition déplacée de +1 s, emplacement ajouté à la main
    ev.find(e => e.name === 'seq_transition_start').t = 5;
    ev.push({ t: 12, name: 'seq_slot_start', detail: { trackId: 's', slotId: 'A', altIndex: 0 } });
    vs = plan(ev.sort((x, y) => x.t - y.t)).voices;
    check('séquentiel retouché : la transition et la coupure suivent le bloc déplacé', vs.find(v => v.url.indexOf('t.ogg') >= 0).start === 5 && vs.find(v => v.url.indexOf('a.ogg') >= 0 && v.start === 0).gain.auto.some(x => near(x[1], 6)));
    check('séquentiel retouché : l\'emplacement ajouté à la main joue', vs.some(v => v.url.indexOf('a.ogg') >= 0 && v.start === 12));
  }

  // ---- Vertical-random : tirages, silence tiré, nouveau tirage = coupure nette ----
  {
    const raw = [
      { t: 0, name: 'vr_section_start', detail: { trackId: 'r', sectionIndex: 0, bufferOffset: 0, picks: [{ poolIndex: 0, altIndex: 0 }, { poolIndex: 1, altIndex: 0 }] } },
      { t: 3, name: 'vr_section_start', detail: { trackId: 'r', sectionIndex: 0, bufferOffset: 0.5, picks: [{ poolIndex: 0, altIndex: 0 }, { poolIndex: 1, altIndex: 1 }], cut: { hard: true, fadeSec: 0 } } },
    ];
    const vs = plan(CP.materialize(raw, findTrack)).voices;
    check('vertical-random : un silence tiré ne produit aucune voix', vs.filter(v => v.start === 0).length === 1);
    check('vertical-random : nouveau tirage -> les voix précédentes s\'arrêtent net', vs.filter(v => v.start === 0).every(v => v.stop === 3));
    check('vertical-random : le nouveau cycle part de sa position annoncée', vs.filter(v => v.start === 3).length === 2 && vs.filter(v => v.start === 3).every(v => v.offset === 0.5));
  }

  // ---- Embranchement-vertical : générations, vraies bascules, ce qu'elles déclenchent suit le bloc ----
  {
    const raw = [
      { t: 0, name: 'track_play', detail: { trackId: 'e' } },
      { t: 0, name: 'embr_gen', detail: { trackId: 'e', bufferOffset: 0, active: 'L0', peers: ['L0', 'L1'] } },
      { t: 1.9, name: 'embr_loop_select', detail: { trackId: 'e', loopId: 'L1' } }, // clic brut (statistiques) : écarté
      { t: 2, name: 'embr_gains', detail: { trackId: 'e', loopId: 'L1', fadeSec: 0.5, k: 'sw1' } },
      { t: 4, name: 'embr_gains', detail: { trackId: 'e', loopId: 'L0', fadeSec: 0.15, k: 'sw2', pk: 'sw1' } }, // retour automatique armé par sw1
      { t: 8, name: 'embr_gen', detail: { trackId: 'e', bufferOffset: 1, active: 'L0', peers: ['L0', 'L1'] } },
      { t: 16, name: 'voices_stop', detail: { trackId: 'e' } },
    ];
    const ev = CP.materialize(raw, findTrack);
    const sel = ev.filter(e => e.name === 'embr_loop_select');
    check('embranchement : les blocs de la frise sont les vraies bascules (clic brut écarté)', sel.length === 2 && sel[0].t === 2 && sel[0].detail.k === 'sw1');
    let vs = plan(ev).voices;
    const l1 = vs.find(v => v.url.indexOf('l1.ogg') >= 0 && v.start === 0);
    check('embranchement : les boucles jumelles tournent ensemble, la bascule est une rampe de volume (0,5 s)', vs.filter(v => v.start === 0).length === 2 && l1.gain.auto.some(a => a[0] === 'lin' && near(a[1], 2.5) && a[2] === 1));
    // Retouche : déplacer la bascule sw1 de +1 s emporte son retour automatique
    const linked = CP.linkedMarks(ev, sel[0]);
    check('embranchement : la bascule emporte ce qu\'elle a déclenché (repère + retour automatique)', linked.length === 3);
    sel[0].t += 1; linked.forEach(m => { m.t += 1; });
    vs = plan(ev).voices;
    const l1b = vs.find(v => v.url.indexOf('l1.ogg') >= 0 && v.start === 0);
    check('embranchement retouché : bascule et retour décalés ensemble', l1b.gain.auto.some(a => a[0] === 'lin' && near(a[1], 3.5) && a[2] === 1) && l1b.gain.auto.some(a => near(a[1], 5)));
    // Bascule ajoutée à la main vers un détour : lecture fraîche, fondu d'entrée, fin à la bascule suivante
    ev.push({ t: 10, name: 'embr_loop_select', detail: { trackId: 'e', loopId: 'D' } }, { t: 12, name: 'embr_loop_select', detail: { trackId: 'e', loopId: 'L0' } });
    vs = plan(ev.sort((x, y) => x.t - y.t)).voices;
    const d = vs.find(v => v.url.indexOf('d.ogg') >= 0);
    check('embranchement retouché : détour ajouté à la main -> joué à 10 s, éteint à la bascule suivante', !!d && d.start === 10 && d.stop < 12.5);
  }

  // ---- Sfx : bonne variation (rang parmi les variations qui ont un fichier), duck ----
  {
    const p = plan([{ t: 2, name: 'stinger_play', detail: { trackId: 'v', sfxId: 'x', variationIndex: 0, fileDuration: 1 } }]);
    check('Sfx : variationIndex compté parmi les variations qui ont un fichier (comme le lecteur)', p.sfxHits.length === 1 && p.sfxHits[0].url.indexOf('x1.ogg') >= 0);
    check('Sfx : baisse de la musique demandée', p.duckHits.length === 1 && p.duckHits[0].fileDuration === 1);
  }

  // ---- Capture d'avant les repères (sauvegardée avant le 25/09) : les boucles rebouclent quand même ----
  {
    const old = [{ t: 0, name: 'layer_segment', detail: { trackId: 'v', layerIndex: 0, duration: 30 } }];
    const vs = plan(old).voices;
    check('ancienne capture : calque en boucle sur toute sa durée (plus de silence après la fin du fichier)', vs.length === 1 && vs[0].loop && vs[0].loop[1] === 8 && near(vs[0].stop, 31.4));
  }

  // ---- Enveloppes ----
  check('envAt : rampe linéaire depuis la valeur du moment', near(CP.envAt(1, [{ t: 1, target: 0, ramp: 2 }], 2), 0.5));
  check('envAt : saut immédiat', CP.envAt(1, [{ t: 1, target: 0.3, ramp: 0 }], 1) === 0.3);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
