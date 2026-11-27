// Revue du lecteur vidéo de l'atelier (12/11, demande de Jules-Antoine : « des comportements aléatoires qui ne s'expliquent pas »).
// Chaque correction a sa vérification ici :
//   1. layerpitch-av-sync.js : le son suit l'image (départ quand elle joue VRAIMENT, coupure / reprise sur saut, attente, pause,
//      changement de vitesse, recalage sur dérive, latence de sortie, bascule de version sans coupure) ;
//   2. Versioning : deux rechargements croisés -- le plus récent gagne ; une version alternative introuvable n'est jamais « enregistrée » ;
//   3. atelier : fichiers audio gardés en mémoire (budget), horloge de la prise recalée quand l'image repart, marqueurs et noms de pistes
//      enregistrés, panneau défait proprement, versions alternatives une opération à la fois.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  // ---------- 1. Calage son / image ----------
  const watchers = [];
  const sb = { window: {}, setInterval: fn => { watchers.push(fn); return watchers.length; }, clearInterval: id => { watchers[id - 1] = null; }, console };
  vm.createContext(sb); vm.runInContext(read('layerpitch-av-sync.js'), sb);
  const AV = sb.window.LayerPitchAVSync;
  const sources = [];
  const ac = {
    currentTime: 100, outputLatency: 0.2, destination: {},
    createGain() { const g = { gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime(v) { g.gain.value = v; } }, connect() {}, disconnect() {} }; return g; },
    createBufferSource() { const n = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start(at, off) { n.at = at; n.off = off; }, stop() { n.stopped = true; } }; sources.push(n); return n; },
  };
  const video = new (new JSDOM('').window.EventTarget)();
  Object.assign(video, { paused: true, ended: false, seeking: false, readyState: 4, currentTime: 10, playbackRate: 1 });
  const fire = n => video.dispatchEvent(new (new JSDOM('').window.Event)(n));
  const buf = d => ({ duration: d });
  let ended = 0;
  const live = () => sources.filter(s => !s.stopped);
  const sync = AV.follow(video, { context: ac, buffers: [buf(60), null], active: 0, onEnded: () => { ended++; } });
  check('calage : rien ne sonne tant que la vidéo ne joue pas', sources.length === 0 && !sync.running);
  video.paused = false; fire('playing');
  const s1 = sources[0];
  check('calage : le son part quand l’image joue vraiment, à l’instant affiché + avance + latence de sortie (casque Bluetooth)',
    sources.length === 1 && Math.abs(s1.at - 100.03) < 1e-9 && Math.abs(s1.off - (10 + 0.03 + 0.2)) < 1e-9 && sync.running);
  fire('seeking');
  check('calage : un saut dans la vidéo coupe le son aussitôt', s1.stopped && !sync.running);
  video.currentTime = 42; fire('seeked');
  check('calage : … et il repart du nouvel endroit', live().length === 1 && Math.abs(live()[0].off - 42.23) < 1e-9);
  fire('waiting');
  check('calage : la vidéo attend des données -> silence (plus de musique qui file seule)', live().length === 0);
  fire('playing');
  video.playbackRate = 2; fire('ratechange');
  check('calage : changement de vitesse -> son relancé à la même vitesse', live().length === 1 && live()[0].playbackRate.value === 2);
  video.playbackRate = 1; fire('ratechange');
  // Dérive : l'horloge du son avance de 1 s, l'image de 1,2 s -> deux mesures hors tolérance de suite = recalage.
  const before = sources.length;
  const t0 = live()[0].at;
  ac.currentTime = t0 + 1; video.currentTime = video.currentTime + 1;
  watchers[0]();
  check('calage : pas de recalage tant que l’écart reste sous 80 ms', sources.length === before);
  video.currentTime += 0.2; watchers[0]();
  check('calage : une seule mesure hors tolérance ne suffit pas (currentTime est parfois arrondi)', sources.length === before);
  watchers[0]();
  check('calage : deux mesures de suite hors tolérance -> recalage sur l’image', sources.length === before + 1 && live().length === 1);
  sync.setBuffer(1, buf(60));
  check('multi-versions : un son prêt plus tard rejoint la lecture en cours, muet', live().length === 2);
  check('multi-versions : bascule = volumes seulement, sans relancer', sync.setActive(1) === true && live().length === 2 && sync.active === 1);
  check('multi-versions : bascule refusée vers un son pas encore prêt', AV.follow(video, { context: ac, buffers: [buf(1), null] }).setActive(1) === false);
  fire('pause');
  check('calage : pause -> silence', live().length === 0);
  video.paused = false; fire('playing'); fire('ended');
  check('calage : fin de la vidéo -> fin de l’écoute', ended === 1 && live().length === 0);
  sync.stop();
  const n = sources.length; video.paused = false; fire('playing');
  check('calage : arrêté, plus aucun écouteur sur la vidéo', sources.length === n);
  check('latence : bornée (une valeur absurde ne décale pas toute l’écoute)', AV.outputLatency({ outputLatency: 9 }) === 0.5 && AV.outputLatency({}) === 0);

  // ---------- 2. Versioning : rechargements croisés ----------
  const html = `<!DOCTYPE html><html><body><div id="host"></div>
  <script>${read('layerpitch-i18n.js').replace(/<\/script/gi, '<\\/script')}</script><script>${read('player.js').replace(/<\/script/gi, '<\\/script')}</script>
  <script>${read('capture-retarget.js')}</script><script>${read('capture-plan.js')}</script><script>${read('layerpitch-av-sync.js')}</script><script>${read('capture-versioning.js')}</script></body></html>`;
  const pending = [];
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(win) {
    function Ctx() { this.destination = {}; this.sampleRate = 44100; this.currentTime = 0; }
    Ctx.prototype.createGain = () => ({ gain: { value: 1 }, connect() {} });
    win.AudioContext = Ctx; win.ResizeObserver = function () { return { observe() {}, disconnect() {} }; };
    win.LayerPitchSupabaseClient = { getClient: () => ({ rpc: (name, args) => {
      if (name === 'list_video_capture_versions') return new Promise(res => pending.push({ id: args.p_capture_id, res }));
      if (name === 'save_video_capture_version') return Promise.resolve({ data: { ok: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    } }) };
  } });
  const W = dom.window;
  const tr = k => k;
  let capId = 'A';
  const V = W.LayerCaptureVersioning.mount(W.document.getElementById('host'), {
    tr, videoEl: W.document.createElement('video'), library: { library: [], sfxLibrary: [], sfxFolders: [] }, findTrack: () => null, findSfx: () => null,
    getEvents: () => [], getCaptureId: () => capId, getCaptureTitle: () => '', fetchBytes: async () => new Uint8Array(0),
  });
  await tick();
  const answer = (id, rows) => { const p = pending.filter(x => x.id === id && !x.done).pop(); p.done = true; p.res({ data: rows, error: null }); }; // la demande la PLUS RÉCENTE
  answer('A', [{ id: 'a1', title: 'Alt A', substitutions: {}, events: [] }]);
  await tick(); await tick();
  capId = 'B';
  const rB1 = V.refresh(); await tick();
  const rB2 = V.refresh(); await tick();
  answer('B', [{ id: 'b-new', title: 'récent', substitutions: {}, events: [] }]); // la plus récente répond d'abord…
  await tick(); await tick();
  pending.filter(p => !p.done).forEach(p => { p.done = true; p.res({ data: [{ id: 'b-old', title: 'périmé', substitutions: {}, events: [] }], error: null }); }); // … l'ancienne ensuite
  await rB1; await rB2; await tick();
  check('Versioning : deux rechargements croisés -- la réponse la plus récente gagne (plus de versions périmées affichées)', V.alternatives.list().map(v => v.id).join() === 'b-new');
  let threw = false;
  try { await V.alternatives.saveAlt('inconnue', { events: [] }); } catch (e) { threw = true; }
  check('Versioning : une version introuvable n’est jamais « enregistrée » en silence', threw);
  V.stop();

  // ---------- 3. Atelier ----------
  const src16 = read('src/atelier/16-sauvegarde-et-envois.js');
  const cacheCode = src16.slice(src16.indexOf('const AUDIO_BYTES_CACHE_BUDGET'), src16.indexOf('// --- Bibliothèque vidéo (2026-09-16)'));
  let fetches = 0;
  const cs = { window: { LayerPlayerCore: { fetchAudio: async url => { fetches++; if (url === 'bad') return { ok: false }; return { ok: true, arrayBuffer: async () => new ArrayBuffer(url === 'big' ? 200 * 1048576 : 40 * 1048576) }; } } }, tr: k => k };
  vm.createContext(cs); vm.runInContext(cacheCode + '\nwindow.f = fetchAsUint8Array; window.c = audioBytesCache; window.size = () => audioBytesCacheSize;', cs);
  const f = cs.window.f;
  await f('a'); await f('a');
  check('cache audio : un fichier déjà lu n’est pas retéléchargé (écoutes, versions, exports)', fetches === 1);
  let bad = 0; await f('bad').catch(() => bad++); await f('bad').catch(() => bad++);
  check('cache audio : un échec n’est pas gardé (on réessaie)', bad === 2 && fetches === 3);
  await f('b'); await f('big');
  check('cache audio : budget respecté, les plus anciens sortent d’abord', !cs.window.c.has('a') && cs.window.c.has('big') && cs.window.size() <= 256 * 1048576);
  check('export : la police est donnée à ffmpeg en copie (writeFile transfère les octets, le cache est partagé)', /fetchAsUint8Array\(new URL\('\.\/vendor\/fonts\/JetBrainsMono-Regular\.ttf', location\.href\)\.href\)\)\.slice\(\)/.test(read('src/atelier/17-export-video.js')));
  check('rendu : même décodage que le lecteur (Ogg sur Safari)', /C\.decodeAudioCompat \? C\.decodeAudioCompat\(ab\)/.test(read('capture-render.js')));

  const cap = read('src/atelier/13-capture-enregistrement.js');
  check('prise : horloge recalée quand l’image joue vraiment, latence de sortie comprise, écouteur retiré à l’arrêt',
    /videoEl\.addEventListener\('playing', reanchor\)/.test(cap) && /video0 \+ \(at - audio0\) \+ latency\(\)/.test(cap) && /removeEventListener\('playing', videoCaptureState\.reanchor\)/.test(cap));

  const frise = read('src/atelier/15-frise-edition.js');
  check('frise : les marqueurs (pose, glisser, nom, instant, effacement) préviennent l’atelier (enregistrement, annuler)',
    /m\.label = nameInput\.value\.trim\(\) \|\| m\.label; changed\(\);/.test(frise) && /if \(moved\) \{ markers\.sort\(\(a, b\) => a\.t - b\.t\); changed\(\); \}/.test(frise)
    && /container\.__vctSelectedMarker = null;\n    changed\(\);/.test(frise));
  check('frise : nom de piste enregistré ; Échap annule vraiment', /if \(laneOverrides\[key\] !== before\) changed\(\); else rerender\(\);/.test(frise) && /if \(ev\.key === 'Escape'\) \{ ev\.preventDefault\(\); done = true; rerender\(\); \}/.test(frise));
  check('frise : groupe replié enregistré sans étape d’annulation', /changed\('view'\)/.test(frise));
  check('frise : glisser = un affichage par image, relâché ou annulé proprement', /frame\.schedule\(\)/.test(frise) && (frise.match(/addEventListener\('pointercancel', onUp\)/g) || []).length >= 4);
  check('frise : le bloc sélectionné reste ouvert d’un affichage à l’autre', /container\.__vctSelectedEvent = e;/.test(frise) && /if \(selEl\) selectBlock\(selIdx, selEl\);/.test(frise));

  const panel = read('src/atelier/18-panneau-de-capture.js');
  check('panneau : une nouvelle vidéo défait tout l’ancien panneau (prise, écoutes, fenêtre détachée, écouteurs)',
    /function disposeCapturePanel\(\)/.test(panel) && /disposeCapturePanel\(\); \/\/ un panneau déjà ouvert est remplacé/.test(panel) && /capturePanelDetachedWindow = null; \/\/ avant close\(\)/.test(panel)
    && /cleanups\.push\(\(\) => document\.removeEventListener\('keydown', onHistoryKey\)\)/.test(panel) && /cleanups\.push\(\(\) => hostObserver\.disconnect\(\)\)/.test(panel));
  check('panneau : seule une retouche du SON coupe l’écoute (marqueurs, noms, replis : non)', /if \(sig !== soundSig\) \{/.test(panel));
  check('panneau : versions alternatives, une opération à la fois', /if \(altBusy\) \{ altSelect\.value = activeAltId \|\| ''; return; \}/.test(panel));
  check('panneau : remarques client -- frise redessinée seulement si elles ont changé', /if \(JSON\.stringify\(marks\) === JSON\.stringify\(timelineEl\.__vctReviewMarks \|\| \[\]\)\) return;/.test(panel));
  check('panneau : tête de lecture à chaque image pendant la lecture', /headRaf = headWin\.requestAnimationFrame\(headFrame\)/.test(panel));
  check('atelier : layerpitch-av-sync.js chargé avant capture-versioning.js', /layerpitch-av-sync\.js\?v=\d+"><\/script>\n<script src="capture-versioning\.js/.test(read('atelier.html')));

  const pub = read('layerpitch-video-versions.js');
  check('lecteur public : son aligné sur la sourdine / le volume / la vitesse dès le départ, relancé quand on remet le son',
    /matchVideo\(audio\); matchVideo\(spare\);/.test(pub) && /if \(!video\.muted && audio\.paused\) startAudio\(\);/.test(pub));
  check('lecteur public : dérive rattrapée en douceur, replacement seulement au-delà de 250 ms puis stabilisation', /Math\.abs\(d\) > 0\.25/.test(pub) && /settleUntil = now \+ 1500/.test(pub));
  check('lecteur public : deux changements de version rapprochés -- seul le dernier termine', /if \(seq !== switchSeq\) return;/.test(pub));

  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
