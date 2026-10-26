// Briques communes des éditeurs d'album (layerpitch-album-shared.js, 29/09) : écoute d'une version officielle (une seule à la
// fois, erreurs, fin de lecture) et enregistreur (chargement, rien joué, enregistrement, fermeture). jsdom, faux services.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };
const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
const I18N = sb.window.LAYERPITCH_I18N;
const src = fs.readFileSync(path.join(__dirname, 'layerpitch-album-shared.js'), 'utf8');
check('textes FR et EN présents (namespace albumShared)', ['recLoading', 'recUnpublished', 'recHint', 'recSave', 'recClose', 'recNothing', 'recSaved', 'recError', 'playMissing', 'playError'].every(k => I18N.fr.albumShared[k] && I18N.en.albumShared[k]));

function world(opts) {
  opts = opts || {};
  const dom = new JSDOM('<div id="host"></div>', { runScripts: 'outside-only', url: 'http://localhost/x.html' });
  const w = dom.window;
  const log = { take: [], play: [], stopped: 0, ended: null, setTake: [], stopEvents: [], player: [] };
  w.LAYERPITCH_I18N = I18N;
  w.LayerPlayerCore = {
    fetchAudioBytes: async u => new Uint8Array(1),
    setSfxLibrary: x => { log.sfx = x; }, setTakeRecording: on => { log.rec = on; },
    buildTrackRow: () => { const d = w.document.createElement('div'); d.className = 'row'; return d; },
    initTrackPlayer: () => { log.player.push('init'); },
    getTrackTake: () => opts.take === undefined ? { voices: [{}], duration: 65, missing: 0 } : opts.take,
  };
  w.LayerCaptureRender = { playTake: async (take, o) => { log.play.push(o); if (opts.playFails) throw new Error('décodage impossible'); log.ended = o.onEnd; return { stop() { log.stopped++; } }; } };
  w.LayerPitchAlbums = {
    getAlbumTrackOfficialTake: async (a, t) => { log.take.push(a + '|' + t); return opts.noTake ? { take: null, error: null } : { take: { v: 1 }, error: null }; },
    setAlbumTrackOfficialTake: async (a, t, take) => { log.setTake.push([a, t]); return opts.saveFails ? { ok: false, error: 'refusé' } : { ok: true }; },
  };
  w.LayerPitchTracks = { getTrack: async id => (opts.unpublished ? { track: null } : { track: { id, sfxIds: ['s1'] } }) };
  w.LayerPitchSfx = { getSfx: async id => ({ sfx: { id } }) };
  w.document.addEventListener('stop-track', e => log.stopEvents.push(e.detail));
  w.eval(src);
  return { w, log, S: w.LayerPitchAlbumShared };
}

(async () => {
  let x = world();
  check('fmtDuration : 65 s -> 1:05, 0 -> 0:00', x.S.fmtDuration(65) === '1:05' && x.S.fmtDuration(0) === '0:00' && x.S.fmtDuration(null) === '0:00');

  // ---- écoute ----
  let changes = 0, errors = [];
  let pb = x.S.createPlayback({ onChange: () => changes++, onError: t => errors.push(t) });
  let before = 0;
  await pb.toggle('al', 't1', { beforeStart: () => before++ }); await flush();
  check('écoute : prise demandée pour le bon album+morceau, lecture lancée, clé connue', x.log.take[0] === 'al|t1' && x.log.play.length === 1 && pb.key() === 'al|t1' && before === 1 && changes >= 1);
  await x.w.LayerPlayerCore.fetchAudioBytes('u'); // le lecteur passe par fetchAudioBytes (liens signés)
  check('écoute : la lecture reçoit fetchBytes (audio protégé)', typeof x.log.play[0].fetchBytes === 'function');
  await pb.toggle('al', 't1'); await flush();
  check('même morceau une 2e fois : arrêt', pb.key() === null && x.log.stopped === 1);
  await pb.toggle('al', 't1'); await flush();
  x.log.ended(); await flush();
  check('fin naturelle de la version : clé remise à zéro et affichage rafraîchi', pb.key() === null && changes >= 3);
  await pb.toggle('al', 't1'); await pb.toggle('al', 't2'); await flush();
  check('un autre morceau : le premier est arrêté, un seul joue', x.log.stopped >= 2 && pb.key() === 'al|t2');
  pb.stop();
  check('stop : plus rien ne joue', pb.key() === null);

  x = world({ noTake: true });
  errors = []; pb = x.S.createPlayback({ onChange() {}, onError: t => errors.push(t) });
  await pb.toggle('al', 't1'); await flush();
  check('pas de version officielle : message clair, rien ne joue', /Pas de version officielle/.test(errors[0]) && pb.key() === null);
  x = world({ playFails: true });
  errors = []; pb = x.S.createPlayback({ onChange() {}, onError: t => errors.push(t) });
  await pb.toggle('al', 't1'); await flush();
  check('lecture impossible : erreur remontée avec le détail', /Écoute impossible : décodage impossible/.test(errors[0]) && pb.key() === null);

  // ---- enregistreur ----
  x = world();
  let saved = null, started = 0;
  let rec = x.S.openRecorder({ albumId: 'al', trackId: 't1', beforeStart: () => started++, onSaved: t => { saved = t; } });
  x.w.document.getElementById('host').appendChild(rec.el);
  check('enregistreur : boîte de chargement d\'abord', /Chargement du morceau/.test(rec.el.textContent));
  await flush();
  check('enregistreur : lecteur du morceau monté, journal de prise actif, Sfx du morceau chargés', !!rec.el.querySelector('.row') && x.log.rec === true && !!x.log.sfx.s1 && started === 1 && x.log.player[0] === 'init');
  rec.el.querySelector('[data-role="recSave"]').click(); await flush();
  check('enregistrer : version envoyée pour le bon album+morceau, durée affichée, onSaved appelé', x.log.setTake[0].join('|') === 'al|t1' && /Version enregistrée \(1:05\)/.test(rec.el.textContent) && saved && saved.duration === 65);
  rec.close();
  check('fermer : boîte retirée et lecteur arrêté (stop-track)', !x.w.document.getElementById('host').contains(rec.el) && x.log.stopEvents.includes('t1'));
  rec.close();
  check('fermer deux fois : sans effet', x.log.stopEvents.filter(t => t === 't1').length === 1);

  x = world({ take: { voices: [], duration: 0 } });
  rec = x.S.openRecorder({ albumId: 'al', trackId: 't1' }); await flush();
  rec.el.querySelector('[data-role="recSave"]').click(); await flush();
  check('rien joué : message, aucun envoi', /Rien n'a encore été joué/.test(rec.el.textContent) && !x.log.setTake.length);
  x = world({ take: { voices: [{}], duration: 5, missing: 1 } });
  rec = x.S.openRecorder({ albumId: 'al', trackId: 't1' }); await flush();
  rec.el.querySelector('[data-role="recSave"]').click(); await flush();
  check('fichiers manquants : refusé comme « pas publié »', /pas publié/.test(rec.el.textContent) && !x.log.setTake.length);
  x = world({ saveFails: true });
  rec = x.S.openRecorder({ albumId: 'al', trackId: 't1' }); await flush();
  rec.el.querySelector('[data-role="recSave"]').click(); await flush();
  check('envoi refusé par le serveur : erreur affichée, bouton réactivé', /Erreur : refusé/.test(rec.el.textContent) && !rec.el.querySelector('[data-role="recSave"]').disabled);
  x = world({ unpublished: true });
  rec = x.S.openRecorder({ albumId: 'al', trackId: 't1' }); await flush();
  check('morceau non publié : erreur claire dans la boîte', /pas publié/.test(rec.el.textContent));
  x = world();
  rec = x.S.openRecorder({ albumId: 'al', trackId: 't1' }); rec.close(); await flush();
  check('fermée pendant le chargement : rien n\'est monté', !x.log.player.length && x.log.rec === undefined);

  // ---- version automatique (openGenerator) : faux moteur (draft / compile), vraie timeline, vrai écran ----
  const tlSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-album-timeline.js'), 'utf8');
  function genWorld(opts) {
    opts = opts || {};
    const g = world(opts);
    g.log.gen = []; g.log.compiled = [];
    g.w.requestAnimationFrame = () => 0; g.w.cancelAnimationFrame = () => {};
    g.w.LayerPlayerCore.resumeAudio = async () => {};
    g.w.LayerPitchTracks = { getTrack: async id => ({ track: { id, mode: opts.mode || 'vertical', sfxIds: opts.noSfx ? [] : ['s1'], layers: [{ file: 'a.ogg', label: 'Basse' }, { file: 'b.ogg' }, { file: 'c.ogg' }] } }) };
    g.w.LayerPitchSfx = { getSfx: async id => ({ sfx: { id, title: 'Cloche', alternatives: [{ file: 'a.ogg' }] } }) };
    g.w.LayerCaptureRender.playTake = async (take, o) => { g.log.play.push(Object.assign({ take }, o)); g.log.ended = o.onEnd; return { stop() { g.log.stopped++; }, position: () => 12 }; };
    g.w.LayerPitchAutoTake = {
      supports: t => t.mode !== 'autre',
      describe: () => ({ fixedDuration: false, quantized: false, layers: 3, barSec: 2, intervalKind: opts.kind || 'layers', fade: true }),
      defaults: () => ({ duration: 120, intervalSec: 8, stinger: true, sfxId: 's1', fadeSec: 3, seed: 1 }),
      grid: () => ({ beatSec: 0.5, barSec: 2 }),
      fileLayers: () => [0, 1, 2],
      SWITCH_KIND_OF: { static: 'layers', vertical: 'layers', sequential: 'slot', 'vertical-random': 'section', 'embranchement-vertical': 'loop' },
      draft: (track, sfxById, settings) => {
        g.log.gen.push(settings);
        if (opts.genFails) throw new Error('fichier absent');
        return { v: 1, mode: track.mode, end: settings.duration, fadeSec: 3, seed: settings.seed, info: {}, markers: [
          { id: 's' + settings.seed, kind: 'layers', t: 0, on: [0], fixed: true }, { id: 'b' + settings.seed, kind: 'layers', t: 8, on: [0, 1] },
          { id: 'x' + settings.seed, kind: 'stinger', t: 70, sfxId: 's1', variationIndex: 0 }] };
      },
      compile: async (track, sfxById, score) => {
        g.log.compiled.push(JSON.parse(JSON.stringify(score)));
        const resolved = {}; score.markers.forEach(m => { resolved[m.id] = m.t; });
        return { take: { kind: 'layerpitch-take', trackId: track.id, duration: 120 }, info: { stingerAt: 70, musicEnd: 120, duration: 120 }, resolved, events: [] };
      },
    };
    g.w.eval(tlSrc);
    g.w.LayerCaptureRender.loaded = true;
    g.w.LayerCapturePlan = {}; g.w.LayerCaptureRetarget = {};
    return g;
  }
  const fire = (w, node, type, o) => node.dispatchEvent(new w.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: 0 }, o || {})));
  x = genWorld();
  let gsaved = null, gstarted = 0;
  let gen = x.S.openGenerator({ albumId: 'al', trackId: 't1', beforeStart: () => gstarted++, onSaved: t => { gsaved = t; } });
  x.w.document.getElementById('host').appendChild(gen.el);
  await flush();
  const gq = r => gen.el.querySelector('[data-role="' + r + '"]');
  const lastScore = () => x.log.compiled[x.log.compiled.length - 1];
  const chip = id => gen.el.querySelector('[data-mid="' + id + '"]');
  check('auto : réglages montrés (durée, intervalle, fondu, stinger + Sfx), Écouter/Valider grisés tant que rien n\'est généré', gq('autoDuration').value === '120' && gq('autoInterval').value === '8' && gq('autoFade').value === '3' && gq('autoStinger').checked && /Cloche/.test(gen.el.textContent) && gq('autoListen').disabled && gq('autoSave').disabled);
  gq('autoDuration').value = '90'; gq('autoStinger').checked = false;
  gq('autoGen').click(); await flush();
  check('auto : partition fabriquée avec les réglages saisis, compilée, écoute lancée depuis le début, Valider disponible', x.log.gen[0].duration === 90 && x.log.gen[0].stinger === false && x.log.gen[0].intervalSec === 8 && x.log.compiled.length === 1 && x.log.play.length === 1 && x.log.play[0].from === 0 && !gq('autoSave').disabled && /Version prête \(2:00\)/.test(gen.el.textContent) && /Stinger à 1:10/.test(gen.el.textContent) && gstarted >= 1);
  const seed1 = x.log.gen[0].seed;
  check('timeline : départ, bascule n°1 (couches nommées), stinger et fin affichés ; le bouton devient « Régénérer »', /Départ : Basse/.test(chip('s' + seed1).textContent) && /n°1 → Basse \+ Couche 2/.test(chip('b' + seed1).textContent) && /Cloche/.test(chip('x' + seed1).textContent) && /Fin 2:00/.test(chip('end').textContent) && gq('autoGen').textContent === 'Régénérer');
  // clic sur la bascule : panneau, changement de cible -> recompilation
  fire(x.w, chip('b' + seed1), 'pointerdown'); fire(x.w, gen.el.querySelector('[data-tl="area"]'), 'pointerup'); await flush();
  const box3 = [...gen.el.querySelectorAll('[data-tl="editor"] [data-tf="to"]')].find(b => b.value === '2');
  check('timeline : clic sur un marqueur -> panneau « Bascule n°1 », de / vers / à', /Bascule n°1/.test(gen.el.textContent) && /De : Basse/.test(gen.el.textContent) && !!box3);
  box3.checked = true; box3.onchange(); await new Promise(r => setTimeout(r, 200)); await flush();
  check('timeline : nouvelle cible -> partition recompilée (couches 1+2+3, marqueur marqué « retouché »)', JSON.stringify(lastScore().markers.find(m => m.id === 'b' + seed1).on) === '[0,1,2]' && lastScore().markers.find(m => m.id === 'b' + seed1).edited === true);
  // Alt+clic sur le stinger puis glisser la bascule : les deux bougent ensemble, calés sur la mesure
  const area0 = gen.el.querySelector('[data-tl="area"]');
  fire(x.w, chip('x' + seed1), 'pointerdown', { altKey: true }); await flush(); // la bascule est déjà sélectionnée (clic précédent)
  const area = gen.el.querySelector('[data-tl="area"]');
  area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 120 });
  fire(x.w, chip('b' + seed1), 'pointerdown', { clientX: 100 });
  fire(x.w, area, 'pointermove', { clientX: 200 }); fire(x.w, area, 'pointerup', { clientX: 200 });
  await new Promise(r => setTimeout(r, 200)); await flush();
  const mb = lastScore().markers.find(m => m.id === 'b' + seed1), mx = lastScore().markers.find(m => m.id === 'x' + seed1);
  check('timeline : Alt+clic = sélection multiple, glisser déplace la sélection du même écart (calé sur la mesure)', area0 !== area && mb.t === 20 && mx.t === 82 && /2 marqueur\(s\) sélectionné\(s\)/.test(gen.el.textContent));
  // menu de commandes : bascule précise
  gen.el.querySelector('[data-tl="cmd"]').click(); await flush();
  check('commandes : menu façon « insérer une fonction » (bascule, bascules régulières, rester, stinger, fin)', ['Bascule', 'Bascules régulières', 'Rester', 'Stinger', 'Fin'].every(t => [...gen.el.querySelectorAll('.lpvt-cmd b')].some(b => b.textContent === t)));
  gen.el.querySelector('[data-pick="switch"]').click(); await flush();
  const cp = gen.el.querySelector('[data-tl="cmdpanel"]');
  cp.querySelector('[data-cf="at"]').value = '0:40';
  [...cp.querySelectorAll('[data-tf="to"]')].find(b => b.value === '2').checked = true;
  cp.querySelector('[data-cmd="apply"]').click(); await new Promise(r => setTimeout(r, 200)); await flush();
  check('commandes : « Bascule » vers la couche 3 à 0:40 -> marqueur posé', lastScore().markers.some(m => m.kind === 'layers' && m.t === 40 && JSON.stringify(m.on) === '[2]'));
  gen.el.querySelector('[data-tl="cmd"]').click(); await flush();
  gen.el.querySelector('[data-pick="every"]').click(); await flush();
  const cp2 = gen.el.querySelector('[data-tl="cmdpanel"]');
  cp2.querySelector('[data-cf="min"]').value = '10'; cp2.querySelector('[data-cf="max"]').value = '10';
  cp2.querySelector('[data-cf="from"]').value = '0'; cp2.querySelector('[data-cf="to"]').value = '1:00';
  cp2.querySelector('[data-cf="order"]').value = 'up';
  cp2.querySelector('[data-cmd="apply"]').click(); await new Promise(r => setTimeout(r, 200)); await flush();
  const sws = lastScore().markers.filter(m => m.kind === 'layers' && !m.fixed).sort((a, b) => a.t - b.t);
  check('commandes : « Bascules régulières » toutes les 10 s jusqu\'à 1:00 (une couche de plus) -> remplace les bascules de la plage', sws.map(m => m.t).join(',') === '10,20,30,40,50' && JSON.stringify(sws[0].on) === '[0,1]' && JSON.stringify(sws[1].on) === '[0,1,2]');
  // régénérer après retouches : la question est posée
  const nPlay = x.log.play.length;
  gq('autoGen').click(); await flush();
  check('régénérer après retouches : la question est posée (tout refaire / garder / annuler), rien n\'est refait', /Tu as retouché la version/.test(gen.el.textContent) && x.log.gen.length === 1);
  gen.el.querySelector('[data-ask="cancel"]').click(); await flush();
  check('« Annuler » : la version reste telle quelle', x.log.gen.length === 1 && !/Tu as retouché/.test(gen.el.textContent));
  gq('autoGen').click(); await flush();
  gen.el.querySelector('[data-ask="keep"]').click(); await flush(); await flush();
  const kept = lastScore();
  check('« Garder mes retouches » : nouvelle graine, les marqueurs retouchés restent', x.log.gen.length === 2 && x.log.gen[1].seed !== seed1 && kept.markers.some(m => m.t === 50 && m.edited) && kept.markers.some(m => m.id === 'x' + seed1) && !kept.markers.some(m => m.id === 'x' + x.log.gen[1].seed) && x.log.play.length > nPlay);
  check('« Garder mes retouches » : aucune nouvelle bascule dans la plage remplie par « Bascules régulières » (0 à 1:00)', !kept.markers.some(m => m.id === 'b' + x.log.gen[1].seed) && kept.markers.filter(m => m.kind === 'layers' && !m.fixed).every(m => m.edited));
  gq('autoGen').click(); await flush();
  gen.el.querySelector('[data-ask="all"]').click(); await flush(); await flush();
  check('« Tout refaire » : partition neuve, retouches perdues', x.log.gen.length === 3 && !lastScore().markers.some(m => m.edited));
  gq('autoListen').click(); await flush();
  check('auto : « Arrêter » coupe l\'écoute', x.log.stopped >= 2);
  gq('autoSave').click(); await flush();
  check('auto : valider range la prise générée pour le bon album+morceau et prévient l\'éditeur', x.log.setTake[0].join('|') === 'al|t1' && gsaved && gsaved.trackId === 't1' && /Version enregistrée \(2:00\)/.test(gen.el.textContent));
  gen.close();
  check('auto : fermer retire la boîte et arrête l\'écoute', !x.w.document.getElementById('host').contains(gen.el));

  x = genWorld({ genFails: true });
  gen = x.S.openGenerator({ albumId: 'al', trackId: 't1' }); await flush();
  gen.el.querySelector('[data-role="autoGen"]').click(); await flush();
  check('auto : génération impossible -> erreur affichée, rien à valider', /Erreur : fichier absent/.test(gen.el.textContent) && gen.el.querySelector('[data-role="autoSave"]').disabled && !x.log.setTake.length);
  x = genWorld({ mode: 'autre' });
  gen = x.S.openGenerator({ albumId: 'al', trackId: 't1' }); await flush();
  check('auto : mode non géré -> message clair (à enregistrer à la main)', /pas géré/.test(gen.el.textContent) && !gen.el.querySelector('[data-role="autoGen"]'));
  x = genWorld({ kind: 'sections' });
  gen = x.S.openGenerator({ albumId: 'al', trackId: 't1' }); await flush();
  check('auto : le réglage de rythme porte le nom du mode (section pour le vertical-aléatoire)', /Durée d'une section/.test(gen.el.textContent));
  x = genWorld({ noSfx: true });
  gen = x.S.openGenerator({ albumId: 'al', trackId: 't1' }); await flush();
  check('auto : morceau sans Sfx -> pas de case stinger, message', !gen.el.querySelector('[data-role="autoStinger"]') && /Aucun Sfx/.test(gen.el.textContent));
  const enKeys = Object.keys(I18N.fr.albumShared).filter(k => /^(auto|tl)/.test(k));
  check('textes FR et EN de la version automatique et de la timeline (mêmes clés)', enKeys.length > 60 && enKeys.every(k => I18N.en.albumShared[k]) && Object.keys(I18N.en.albumShared).filter(k => /^(auto|tl)/.test(k)).every(k => I18N.fr.albumShared[k]) && I18N.fr.albumEditor.officialAuto && I18N.en.albumEditor.officialAuto);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
