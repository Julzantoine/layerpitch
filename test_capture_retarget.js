const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Versioning vidéo, étape 1 (26/09) : un montage rejoué sur un autre morceau / d'autres Sfx (capture-retarget.js). On
// vérifie que les gestes restent et que tout le reste suit les règles du NOUVEAU morceau : répétitions de slot à sa
// durée, bascules recalées sur sa grille (ou gardées à l'instant de l'image), transitions / retours automatiques /
// détours de l'embranchement recalculés, cycles de section, générations du moteur quantifié, Sfx remplacés -- et que
// rien de manquant n'est ignoré en silence.
(async () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body>
  <script>${read('layerpitch-i18n.js')}</script><script>${read('player.js')}</script>
  <script>${read('capture-render.js')}</script><script>${read('capture-plan.js')}</script><script>${read('capture-retarget.js')}</script></body></html>`;
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
  const W = dom.window, CP = W.LayerCapturePlan, RT = W.LayerCaptureRetarget;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
  const named = (evs, name, trackId) => evs.filter(e => e.name === name && (!trackId || e.detail.trackId === trackId));

  // ---- Morceaux ----
  const fx = { fxTriggers: [], fxSliders: [] };
  const vert = Object.assign({ id: 'v1', mode: 'vertical', base: 'https://m/v1/', duration: 8, layers: [{ file: 'a.ogg' }, { file: 'b.ogg' }] }, fx);
  const vertQ = Object.assign({ id: 'v2', mode: 'vertical', base: 'https://m/v2/', duration: 10, loopEngine: 'quantized', bpm: 120, beatsPerBar: 4, loopInBeat: 4, loopOutBeat: 20, startTrackBeat: 0, maxLoops: 3,
    layers: [{ file: 'a2.ogg' }, { file: 'b2.ogg' }] }, fx);
  const vert3 = Object.assign({}, vert, { id: 'v3', layers: [{ file: 'x' }, { file: 'y' }, { file: 'z' }] });
  // Séquentiel d'origine : 120 bpm, 4/4 -> une mesure = 2 s, un slot de 4 mesures = 8 s.
  const seqA = Object.assign({ id: 's1', mode: 'sequential', base: 'https://m/s1/', bpm: 120, beatsPerBar: 4, intro: { file: 'in.ogg', bars: 2 }, outro: { file: 'out.ogg' },
    segmentSlots: [
      { id: 'A', alternatives: [{ file: 'a0.ogg', bars: 4 }, { file: 'a1.ogg', bars: 4 }], quantization: 'bar', nextOptions: [{ targetId: 'B', transition: { file: 't.ogg', durationUnit: 'bars', bars: 1 } }] },
      { id: 'B', alternatives: [{ file: 'b0.ogg', bars: 4 }] },
    ] }, fx);
  // Remplaçant : 100 bpm -> mesure 2,4 s ; slot 1 de 4 mesures = 9,6 s ; slot 2 avec son PROPRE tempo (90 bpm, 3/4).
  const seqB = Object.assign({ id: 's2', mode: 'sequential', base: 'https://m/s2/', bpm: 100, beatsPerBar: 4, intro: { file: 'in2.ogg', bars: 1 }, outro: { file: 'out2.ogg' },
    segmentSlots: [
      { id: 'A2', alternatives: [{ file: 'a20.ogg', bars: 4 }, null, { file: 'a22.ogg', bars: 4 }], quantization: 'bar', cutStyle: 'custom', customCutFadeSec: 0.4,
        nextOptions: [{ targetId: 'B2', transition: { file: 't2.ogg', durationUnit: 'beats', durationBeats: 2 } }] },
      { id: 'B2', bpm: 90, beatsPerBar: 3, alternatives: [{ file: 'b20.ogg', bars: 2 }] },
    ] }, fx);
  const seqNoTrans = JSON.parse(JSON.stringify(seqB)); seqNoTrans.id = 's3'; seqNoTrans.segmentSlots[0].nextOptions[0].transition = null;
  const vrA = Object.assign({ id: 'r1', mode: 'vertical-random', base: 'https://m/r1/', sections: [
    { id: 'S1', bpm: 120, beatsPerBar: 4, loopInBeat: 0, loopOutBeat: 16, pools: [{ alternatives: [{ file: 'p0.ogg' }, { file: 'p1.ogg' }] }, { alternatives: [{ file: 'q0.ogg' }] }] },
    { id: 'S2', bpm: 120, beatsPerBar: 4, loopInBeat: 0, loopOutBeat: 8, pools: [{ alternatives: [{ file: 'u0.ogg' }] }, { alternatives: [{ file: 'w0.ogg' }] }] } ] }, fx);
  // Remplaçant : section 1 de 10 s de cycle, avec un point « Départ » à 1 s ; section 2 de 6 s.
  const vrB = Object.assign({ id: 'r2', mode: 'vertical-random', base: 'https://m/r2/', sections: [
    { id: 'T1', bpm: 60, beatsPerBar: 4, startTrackBeat: 1, loopInBeat: 2, loopOutBeat: 12, pools: [{ alternatives: [{ file: 'P0.ogg' }] }, { alternatives: [{ file: 'Q0.ogg' }, { file: 'Q1.ogg' }] }] },
    { id: 'T2', bpm: 60, beatsPerBar: 4, loopInBeat: 0, loopOutBeat: 6, pools: [{ alternatives: [{ file: 'U0.ogg' }] }, { alternatives: [{ file: 'W0.ogg' }] }] } ] }, fx);
  const embrA = Object.assign({ id: 'e1', mode: 'embranchement-vertical', base: 'https://m/e1/', bpm: 120, beatsPerBar: 4, loops: [
    { id: 'L0', file: 'l0.ogg', isInitial: true, isDetour: false, duration: 8 },
    { id: 'L1', file: 'l1.ogg', isDetour: false, duration: 8, autoReturnEnabled: true, autoReturnValue: 2, autoReturnUnit: 'bars' },
    { id: 'D', file: 'd.ogg', isDetour: true, bars: 1, detourMode: 'once' } ] }, fx);
  // Remplaçant : 100 bpm (mesure 2,4 s), cycle 9,6 s ; L1 : bascule à la mesure, transition d'une mesure, retour après 1 mesure.
  const embrB = Object.assign({ id: 'e2', mode: 'embranchement-vertical', base: 'https://m/e2/', bpm: 100, beatsPerBar: 4, loops: [
    { id: 'M0', file: 'm0.ogg', isInitial: true, isDetour: false, duration: 9.6, cutStyle: 'hard' },
    { id: 'M1', file: 'm1.ogg', isDetour: false, duration: 9.6, switchQuantize: 'bar', transition: { file: 'mt.ogg', durationUnit: 'bars', bars: 1 },
      autoReturnEnabled: true, autoReturnValue: 1, autoReturnUnit: 'bars', cutStyle: 'custom', customCutFadeSec: 0.3 },
    { id: 'E', file: 'e.ogg', isDetour: true, bars: 2, detourMode: 'once' } ] }, fx);
  const tracks = [vert, vertQ, vert3, seqA, seqB, seqNoTrans, vrA, vrB, embrA, embrB];
  const sfxs = [
    { id: 'x1', title: 'Pas forêt', tag: 'Footsteps', base: 'https://m/x1/', alternatives: [{ file: 'f0.ogg' }, { file: 'f1.ogg' }, { file: 'f2.ogg' }] },
    { id: 'x2', title: 'Pas ville', tag: 'footsteps', base: 'https://m/x2/', rrMode: 'sequential', alternatives: [{ file: 'c0.ogg' }, { file: 'c1.ogg' }], spatial: { enabled: true, room: 'hall', x: 0.5, y: 0.2 } },
    { id: 'x3', title: 'Porte qui grince', tag: 'Door', base: 'https://m/x3/', alternatives: [{ file: 'door.ogg' }] },
    { id: 'x4', title: 'Grincement de porte', tag: '', base: 'https://m/x4/', alternatives: [{ file: 'g.ogg' }] },
  ];
  const findTrack = id => tracks.find(t => t.id === id), findSfx = id => sfxs.find(s => s.id === id);
  const durations = { 'x2|c0.ogg': 0.7, 'x2|c1.ogg': 0.9 };
  const fileDuration = (owner, file) => (owner.id + '|' + file) in durations ? durations[owner.id + '|' + file] : null;
  const run = (events, subs) => RT.retarget(events, subs, { findTrack, findSfx, fileDuration });
  const planOf = events => CP.buildPlan(events, { findTrack, findSfx }).plan;

  // ---- Compatibilité ----
  {
    check('compat : même mode, même nombre de couches -> compatible', RT.compareTracks(vert, vertQ).compatible);
    const c1 = RT.compareTracks(vert, vert3);
    check('compat : 2 couches -> 3 couches = bloqué (structure différente, étape ultérieure)', !c1.compatible && c1.issues[0].code === 'layers');
    check('compat : mode différent = bloqué', RT.compareTracks(vert, seqA).issues[0].code === 'mode');
    const c2 = RT.compareTracks(seqA, seqNoTrans);
    check('compat : transition absente dans le remplaçant = utilisable, signalée', c2.compatible && c2.issues.some(i => i.code === 'transition' && i.severity === 'warn'));
    check('compat : embranchement, mêmes rôles de boucles -> compatible', RT.compareTracks(embrA, embrB).compatible);
  }

  // ---- Sfx : correspondance proposée, remplacement ----
  {
    const s = RT.suggestSfx(sfxs[0], sfxs);
    check('Sfx : même étiquette (casse ignorée) -> proposé en premier', s && s.sfx.id === 'x2' && s.by === 'tag');
    const d = RT.suggestSfx(sfxs[2], [sfxs[0], sfxs[1], sfxs[3]]);
    check('Sfx : sans étiquette commune, titre proche (« porte ») -> proposé', d && d.sfx.id === 'x4' && d.by === 'title');
    check('Sfx : rien de proche -> aucune proposition (jamais au hasard)', RT.suggestSfx(sfxs[2], [sfxs[0], sfxs[1]]) === null);
    const ev = [
      { t: 1, name: 'stinger_play', detail: { trackId: 'v1', sfxId: 'x1', variationIndex: 2, spatialStep: 1, spatial: { sp: { room: 'room' } }, fileDuration: 1.2 } },
      { t: 2, name: 'stinger_play', detail: { trackId: 'v1', sfxId: 'x1', variationIndex: 0, fileDuration: 1.2, duck: false, durationOverride: 0.5 } },
      { t: 3, name: 'stinger_play', detail: { trackId: 'v1', sfxId: 'x3', variationIndex: 0, fileDuration: 2 } },
    ];
    const r = run(ev, { sfx: { x1: 'x2', x3: null } });
    const st = named(r.events, 'stinger_play');
    check('Sfx remplacé : le nouveau Sfx, variations dans SON ordre (tirage séquentiel : 0 puis 1)', st[0].detail.sfxId === 'x2' && st[0].detail.variationIndex === 0 && st[1].detail.variationIndex === 1);
    check('Sfx remplacé : sa place dans la salle est la sienne (réglage d\'origine oublié), durée du nouveau fichier', st[0].detail.spatial === undefined && st[0].detail.spatialStep === undefined && st[0].detail.fileDuration === 0.7);
    check('Sfx remplacé : retouches de la frise gardées (duck, longueur)', st[1].detail.duck === false && st[1].detail.durationOverride === 0.5);
    check('Sfx sans remplaçant choisi : l\'original joue, signalé « à choisir »', st[2].detail.sfxId === 'x3' && r.notes.some(n => n.code === 'sfx_to_choose' && n.sfxId === 'x3'));
    const p = planOf(r.events);
    check('Sfx remplacé : le rendu prend les fichiers du nouveau Sfx', p.sfxHits[0].url.indexOf('https://m/x2/c0.ogg') === 0 && p.sfxHits[1].url.indexOf('https://m/x2/c1.ogg') === 0);
  }

  // ---- Vertical simple -> vertical quantifié ----
  {
    const ev = [
      { t: 1, name: 'track_play', detail: { trackId: 'v1' } },
      { t: 1, name: 'layer_run', detail: { trackId: 'v1', offset: 0, loop: [0, 8], level: 0 } },
      { t: 1, name: 'layer_segment', detail: { trackId: 'v1', layerIndex: 0, duration: 29 } },
      { t: 4, name: 'layer_segment', detail: { trackId: 'v1', layerIndex: 1, duration: 6 } },
      { t: 30, name: 'voices_stop', detail: { trackId: 'v1' } },
    ];
    const r = run(ev, { tracks: { v1: { to: 'v2' } } });
    const segs = named(r.events, 'layer_segment', 'v2');
    check('vertical : les segments de couche gardent leurs instants et longueurs', segs.length === 2 && segs[1].t === 4 && segs[1].detail.duration === 6 && segs[1].detail.layerIndex === 1);
    const gens = named(r.events, 'layer_gen', 'v2');
    // Nouveau morceau : 120 bpm, Entrée 2 s, Sortie 10 s (cycle 8 s), Départ 0, 3 générations au plus.
    check('vertical -> quantifié : générations du NOUVEAU moteur (départ au point Départ, puis toutes les 8 s depuis l\'Entrée)',
      gens.length === 3 && gens[0].t === 1 && gens[0].detail.bufferOffset === 0 && near(gens[1].t, 11) && gens[1].detail.bufferOffset === 2 && near(gens[2].t, 19));
    check('vertical -> quantifié : limite de boucles du nouveau morceau respectée (3 générations)', gens.length === 3);
    check('vertical : plus aucun repère de l\'ancien moteur', named(r.events, 'layer_run').length === 0 && r.events.every(e => !e.detail || e.detail.trackId !== 'v1'));
    const p = planOf(r.events);
    check('vertical : le rendu joue les fichiers du nouveau morceau', p.voices.length > 0 && p.voices.every(v => v.url.indexOf('https://m/v2/') === 0));
  }

  // ---- Séquentiel : répétitions, coupure recalée, enchaînement naturel, transition, intro, outro ----
  // Origine (120 bpm) : intro 0-4 s, slot A 4-12 et 12-15 (bascule vers B demandée, coupée à la mesure à 15... ici à 14),
  // transition 14-16, slot B 16-24, outro 24 ; fin 30.
  const seqEvents = () => [
    { t: 0, name: 'track_play', detail: { trackId: 's1' } },
    { t: 0, name: 'seq_intro_start', detail: { trackId: 's1' } },
    { t: 4, name: 'seq_slot_start', detail: { trackId: 's1', slotId: 'A', altIndex: 0 } },
    { t: 12, name: 'seq_slot_start', detail: { trackId: 's1', slotId: 'A', altIndex: 1 } },
    { t: 14, name: 'seq_transition_start', detail: { trackId: 's1', fromSlotId: 'A', targetId: 'B', cut: { hard: false, fadeSec: 0.15 } } },
    { t: 16, name: 'seq_slot_start', detail: { trackId: 's1', slotId: 'B', altIndex: 0 } },
    { t: 24, name: 'seq_outro_start', detail: { trackId: 's1' } },
    { t: 30, name: 'voices_stop', detail: { trackId: 's1' } },
  ];
  {
    const r = run(seqEvents(), { tracks: { s1: { to: 's2' } } });
    const w = CP.buildSeqTimelineWindows(r.events, 's2', 40);
    const kinds = w.map(x => x.kind + '@' + x.start.toFixed(2));
    // Nouveau : intro d'1 mesure (2,4 s) ; slot A2 (9,6 s par répétition) depuis 2,4 ; la coupure demandée vers 14 tombe
    // sur la mesure la plus proche de la 1re répétition... de la 2e (12 -> 14,4 : 2,4 + 9,6 + 2,4) ; transition de 2 temps
    // (1,2 s) ; B2 à son propre tempo (90 bpm, 3/4, 2 mesures = 4 s) répété jusqu'à l'outro, fin de répétition la plus
    // proche de 24.
    check('séquentiel : l\'intro du nouveau morceau dure SA durée (1 mesure à 100 bpm = 2,4 s)', w[0].kind === 'intro' && w[0].start === 0 && w[1].kind === 'slot' && near(w[1].start, 2.4));
    check('séquentiel : le slot se répète à la durée du nouveau morceau (9,6 s)', w[2].kind === 'slot' && near(w[2].start, 12));
    const tr = w.find(x => x.kind === 'transition');
    check('séquentiel : coupure recalée sur la mesure la plus proche du slot quitté (14 -> 14,4)', tr && near(tr.start, 14.4));
    check('séquentiel : la coupure suit le style du slot quitté dans le nouveau morceau (fondu de 0,4 s)', tr.e.detail.cut && tr.e.detail.cut.fadeSec === 0.4 && !tr.e.detail.cut.hard);
    const b = w.filter(x => x.kind === 'slot' && x.slotId === 'B2');
    check('séquentiel : transition de 2 temps (1,2 s), puis le slot B2 à son propre tempo (4 s par répétition)', near(b[0].start, 15.6) && near(b[1].start, 19.6));
    const out = w.find(x => x.kind === 'outro');
    check('séquentiel : l\'outro part à la fin de répétition la plus proche de l\'instant d\'origine (24 -> 23,6)', out && near(out.start, 23.6));
    check('séquentiel : variations reprises dans l\'ordre des tirages, ramenées aux variations existantes (1 -> 2)', w[1].altIndex === 0 && w[2].altIndex === 2);
    const shifts = r.notes.filter(n => n.code === 'shifted');
    check('séquentiel : décalage signalé là où il dépasse 0,5 s (l\'intro, qui ne se coupe pas, est 1,6 s plus courte), et seulement là',
      shifts.length === 1 && shifts[0].t === 4 && near(shifts[0].by, -1.6));
    const p = planOf(r.events);
    check('séquentiel : le rendu joue les fichiers du nouveau morceau, transition comprise', p.voices.some(v => v.url.indexOf('https://m/s2/t2.ogg') === 0) && p.voices.every(v => v.url.indexOf('https://m/s2/') === 0));
  }
  {
    const r = run(seqEvents(), { tracks: { s1: { to: 's2', snapToImage: true } } });
    const w = CP.buildSeqTimelineWindows(r.events, 's2', 40);
    const tr = w.find(x => x.kind === 'transition');
    const b = w.find(x => x.kind === 'slot' && x.slotId === 'B2');
    check('caler sur l\'image : chaque étape garde l\'instant exact de la vidéo (slot 4, transition 14, B 16, outro 24)',
      near(w[1].start, 4) && near(tr.start, 14) && near(b.start, 16) && near(w.find(x => x.kind === 'outro').start, 24));
    check('caler sur l\'image : l\'intro du nouveau morceau (2,4 s) finit avant l\'instant d\'origine -> le slot part à 4 s sans coupure',
      !w[1].e.detail.cut);
    check('caler sur l\'image : aucun décalage à signaler', !r.notes.some(n => n.code === 'shifted'));
  }
  {
    const r = run(seqEvents(), { tracks: { s1: { to: 's3' } } });
    const w = CP.buildSeqTimelineWindows(r.events, 's3', 40);
    check('séquentiel : transition absente du nouveau morceau -> étape retirée, signalée', !w.some(x => x.kind === 'transition') && r.notes.some(n => n.code === 'transition_missing'));
    const b = w.find(x => x.kind === 'slot' && x.slotId === 'B2');
    check('séquentiel : sans transition, la cible part au moment de la bascule d\'origine, recalé sur la mesure (14 -> 14,4), en coupure',
      b && near(b.start, 14.4) && b.e.detail.cut && b.e.detail.cut.fadeSec === 0.4);
  }

  // ---- Vertical-random : cycles de section du nouveau morceau, tirages rejoués ----
  {
    const ev = [
      { t: 0, name: 'track_play', detail: { trackId: 'r1' } },
      { t: 0, name: 'vr_section_start', detail: { trackId: 'r1', sectionIndex: 0, bufferOffset: 0, picks: [{ poolIndex: 0, altIndex: 1 }, { poolIndex: 1, altIndex: 0 }] } },
      { t: 8, name: 'vr_section_start', detail: { trackId: 'r1', sectionIndex: 0, bufferOffset: 0, picks: [{ poolIndex: 0, altIndex: 0 }, { poolIndex: 1, altIndex: -1 }] } },
      { t: 16, name: 'vr_section_start', detail: { trackId: 'r1', sectionIndex: 1, bufferOffset: 0, picks: [{ poolIndex: 0, altIndex: 0 }, { poolIndex: 1, altIndex: 0 }] } },
      { t: 26, name: 'voices_stop', detail: { trackId: 'r1' } },
    ];
    const r = run(ev, { tracks: { r1: { to: 'r2' } } });
    const w = CP.buildVRTimelineWindows(r.events, 'r2', 40);
    // Section 1 du nouveau : premier passage depuis Départ (1 s) jusqu'à la Sortie (12 s) = 11 s, puis cycles de 10 s depuis
    // l'Entrée (2 s). Bascule d'origine à 16 : fins de cycle 11 et 21 -> 11 est plus proche (écart 5 contre 5 : la première).
    check('vertical-random : premier cycle depuis le point Départ du nouveau morceau', w[0].start === 0 && w[0].bufferOffset === 1);
    check('vertical-random : la section change à la fin de cycle la plus proche de l\'instant d\'origine', w[1].sectionIndex === 1 && (near(w[1].start, 11) || near(w[1].start, 21)));
    check('vertical-random : tirages rejoués pool par pool, ramenés aux variations du nouveau pool', w[0].picks[0].altIndex === 0 && w[0].picks[1].altIndex === 0);
    check('vertical-random : décalage de plus d\'une demi-seconde signalé', r.notes.some(n => n.code === 'shifted'));
    const w2 = w.filter(x => x.sectionIndex === 1);
    check('vertical-random : la section 2 se répète à SON cycle (6 s) jusqu\'à la fin de l\'écoute', w2.length >= 2 && near(w2[1].start - w2[0].start, 6));
    const img = CP.buildVRTimelineWindows(run(ev, { tracks: { r1: { to: 'r2', snapToImage: true } } }).events, 'r2', 40);
    const s2 = img.find(x => x.sectionIndex === 1);
    check('vertical-random, caler sur l\'image : la section 2 part à 16 s pile, en coupant net le cycle en cours, depuis son point Départ',
      s2 && s2.start === 16 && s2.e.detail.cut === true && s2.bufferOffset === 0);
    const p = planOf(r.events);
    check('vertical-random : le rendu joue les fichiers du nouveau morceau', p.voices.length > 0 && p.voices.every(v => v.url.indexOf('https://m/r2/') === 0));
  }

  // ---- Embranchement-vertical : clics rejoués, tout le reste recalculé ----
  {
    const ev = [
      { t: 0, name: 'track_play', detail: { trackId: 'e1' } },
      { t: 0, name: 'embr_gen', detail: { trackId: 'e1', bufferOffset: 0, active: 'L0', peers: ['L0', 'L1'] } },
      { t: 8, name: 'embr_gen', detail: { trackId: 'e1', bufferOffset: 0, active: 'L0', peers: ['L0', 'L1'] } },
      // Clic vers L1 à 5 s ; son retour automatique (clé pk) à 9 s ; clic vers le détour à 13 s, retour auto à 15 s.
      { t: 5, name: 'embr_gains', detail: { trackId: 'e1', loopId: 'L1', fadeSec: 0.15, k: 'sw1' } },
      { t: 5, name: 'embr_loop_select', detail: { trackId: 'e1', loopId: 'L1', k: 'sw1' } },
      { t: 9, name: 'embr_gains', detail: { trackId: 'e1', loopId: 'L0', fadeSec: 0.15, k: 'sw2', pk: 'sw1' } },
      { t: 9, name: 'embr_loop_select', detail: { trackId: 'e1', loopId: 'L0', k: 'sw2' } },
      { t: 13, name: 'embr_gains', detail: { trackId: 'e1', loopId: null, fadeSec: 0.15, k: 'sw3' } },
      { t: 13, name: 'embr_detour_in', detail: { trackId: 'e1', loopId: 'D', fadeSec: 0.15, loop: false, k: 'sw3' } },
      { t: 13, name: 'embr_loop_select', detail: { trackId: 'e1', loopId: 'D', k: 'sw3' } },
      { t: 15, name: 'embr_detour_out', detail: { trackId: 'e1', loopId: 'D', fadeSec: 0.15, k: 'sw3:ret', pk: 'sw3' } },
      { t: 15, name: 'embr_gains', detail: { trackId: 'e1', loopId: 'L0', fadeSec: 0.15, k: 'sw3:ret', pk: 'sw3' } },
      { t: 15, name: 'embr_loop_select', detail: { trackId: 'e1', loopId: 'L0', k: 'sw3:ret' } },
      { t: 24, name: 'voices_stop', detail: { trackId: 'e1' } },
    ];
    const r = run(ev, { tracks: { e1: { to: 'e2' } } });
    const evs = r.events.filter(e => e.detail && e.detail.trackId === 'e2');
    // Clic à 5 s, M1 quantifiée à la mesure (2,4 s) : frontière la plus proche = 4,8. Transition d'une mesure (2,4 s) jouée
    // à 4,8 avec la baisse de M0 (coupure nette), bascule réelle à 7,2 ; retour auto après 1 mesure = 9,6.
    const trans = evs.find(e => e.name === 'embr_transition');
    check('embranchement : bascule quantifiée sur la mesure la plus proche du nouveau morceau (5 -> 4,8), transition jouée',
      trans && near(trans.t, 4.8) && trans.detail.loopId === 'M1');
    const duck = evs.find(e => e.name === 'embr_duck');
    check('embranchement : la boucle quittée baisse avec SON style de coupure (net)', duck && near(duck.t, 4.8) && duck.detail.loopId === 'M0' && duck.detail.fadeSec === 0);
    const g1 = evs.find(e => e.name === 'embr_gains' && e.detail.loopId === 'M1');
    check('embranchement : bascule réelle à la fin de la transition (7,2), fondu propre de M1 (0,3 s)', g1 && near(g1.t, 7.2) && g1.detail.fadeSec === 0.3);
    const ret = evs.find(e => e.name === 'embr_gains' && e.detail.loopId === 'M0' && e.detail.pk === g1.detail.k);
    check('embranchement : retour automatique du NOUVEAU morceau (1 mesure après, 9,6), celui d\'origine (9) non rejoué', ret && near(ret.t, 9.6) && !evs.some(e => near(e.t, 9)));
    const din = evs.find(e => e.name === 'embr_detour_in');
    const dout = evs.find(e => e.name === 'embr_detour_out');
    check('embranchement : détour au clic d\'origine (13), fin après SA durée (2 mesures = 4,8 s -> 17,8)', din && near(din.t, 13) && dout && near(dout.t, 17.8));
    const gens = evs.filter(e => e.name === 'embr_gen');
    check('embranchement : générations au cycle du nouveau morceau (9,6 s), boucles jumelles du nouveau morceau',
      gens.length === 3 && near(gens[1].t, 9.6) && gens[0].detail.peers.join() === 'M0,M1' && gens[1].detail.active === 'M1');
    const sel = evs.filter(e => e.name === 'embr_loop_select').map(e => e.detail.loopId).join();
    check('embranchement : blocs de la frise = bascules réelles (M1, retour M0, détour E, retour M0)', sel === 'M1,M0,E,M0');
    const p = planOf(r.events);
    check('embranchement : le rendu joue les fichiers du nouveau morceau, transition comprise', p.voices.some(v => v.url.indexOf('https://m/e2/mt.ogg') === 0) && p.voices.every(v => v.url.indexOf('https://m/e2/') === 0));
  }

  // ---- Garde-fous ----
  {
    const ev = [
      { t: 0, name: 'layer_run', detail: { trackId: 'v1', offset: 0, loop: [0, 8] } },
      { t: 0, name: 'layer_segment', detail: { trackId: 'v1', layerIndex: 0, duration: 4 } },
      { t: 1, name: 'layer_run', detail: { trackId: 'v2', offset: 0 } },
    ];
    const r = run(ev, { tracks: { v1: { to: 'v2' } } });
    check('garde-fou : le remplaçant joue déjà dans ce montage -> refusé (deux écoutes se mélangeraient)', r.notes.some(n => n.code === 'target_in_use' && n.severity === 'block') && r.events.length === ev.length);
    const swap = run(ev, { tracks: { v1: { to: 'v2' }, v2: { to: 'v1' } } });
    check('garde-fou : échange de deux morceaux du montage -> accepté', !swap.notes.some(n => n.severity === 'block') && named(swap.events, 'layer_segment', 'v2').length === 1);
    const bad = run(ev, { tracks: { v1: { to: 'v3' } } });
    check('garde-fou : structure différente -> montage laissé intact, refus signalé', bad.notes.some(n => n.code === 'track_incompatible') && bad.events.every((e, i) => e === ev[i]));
  }

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
