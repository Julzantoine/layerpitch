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
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
