// Lecteur public des versions vidéo (layerpitch-video-versions.js, 21/10) : étiquette « ce qui joue », menu des versions sous la vidéo,
// changement de version au même instant, versions cachées par l'auteur ; branchement dans le bloc vidéo des AdReels (reel.js).
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
(async () => {
  const dom = new JSDOM('<div id="w" style="position:relative"><video id="v" src="https://m/v1.mp4"></video></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(read('layerpitch-video-versions.js'));
  const V = w.LayerPitchVideoVersions;
  const cues = [{ start: 0, end: 10, text: 'Couche 1', kind: 'state', row: 0 }, { start: 5, end: 10, text: 'Couche 2', kind: 'state', row: 1 }, { start: 6, end: 7, text: 'Lanterne', kind: 'stinger', row: 0 }];
  check('étiquette : couches actives réunies', V.cueTextAt(cues, 5.5).state === 'Couche 1 · Couche 2' && V.cueTextAt(cues, 5.5).flash === '');
  check('étiquette : flash du stinger pendant sa durée', V.cueTextAt(cues, 6.2).flash === 'Lanterne' && V.cueTextAt(cues, 7.5).flash === '');
  check('étiquette : rien hors des repères', V.cueTextAt(cues, 12).state === '');

  const montage = { id: 'cap1', title: 'T', versions: [
    { key: 'original', title: null, url: 'https://m/v1.mp4', cues: [{ start: 0, end: 30, text: 'Musique 1 : ponton', kind: 'state', row: 0 }] },
    { key: 'ver2', title: 'Musique 2', url: 'https://m/v2.mp4', cues: [{ start: 0, end: 30, text: 'Musique 2 : couches', kind: 'state', row: 0 }] },
    { key: 'ver3', title: 'Musique 3', url: 'https://m/v3.mp4', cues: [] }] };
  const video = w.document.getElementById('v'), wrap = w.document.getElementById('w');
  let t = 12; Object.defineProperty(video, 'currentTime', { get: () => t, set: x => { t = x; } });
  Object.defineProperty(video, 'paused', { get: () => true });
  Object.defineProperty(video, 'duration', { get: () => 30 });
  const tr = k => ({ videoVersionMenuLabel: 'Version vidéo', videoVersionOriginal: 'Musique d’origine' }[k] || k);
  const ctl = await V.mount(video, wrap, { montageId: 'cap1', defaultKey: 'ver2', hidden: ['ver3'], tr, load: async () => montage });
  check('version par défaut choisie par l’auteur', video.getAttribute('src') === 'https://m/v2.mp4');
  check('étiquette affichée sur la vidéo', /Musique 2 : couches/.test(wrap.querySelector('.lp-video-cue').textContent));
  const sel = w.document.querySelector('.lp-video-versions select');
  check('menu sous la vidéo : versions proposées, version cachée absente', !!sel && [...sel.options].map(o => o.value).join() === 'original,ver2' && sel.options[0].textContent === 'Musique d’origine');
  sel.value = 'original'; sel.dispatchEvent(new w.Event('change'));
  check('changement de version : nouvelle vidéo', video.getAttribute('src') === 'https://m/v1.mp4');
  t = 0; video.dispatchEvent(new w.Event('loadedmetadata'));
  check('changement de version : reprise au même instant (12 s)', t === 12);
  check('l’étiquette suit la version choisie', /Musique 1 : ponton/.test(wrap.querySelector('.lp-video-cue').textContent));

  const dom2 = new JSDOM('<div id="w"><video id="v" src="https://m/x.mp4"></video></div>', { runScripts: 'outside-only' });
  dom2.window.eval(read('layerpitch-video-versions.js'));
  const none = await dom2.window.LayerPitchVideoVersions.mount(dom2.window.document.getElementById('v'), dom2.window.document.getElementById('w'), { montageId: 'x', load: async () => null });
  check('montage introuvable : la vidéo reste telle quelle, sans menu', none === null && !dom2.window.document.querySelector('.lp-video-versions') && dom2.window.document.getElementById('v').getAttribute('src') === 'https://m/x.mp4');

  // Vidéo muette + sons : l'image ne se recharge pas, seul le son change, au même instant.
  const dom3 = new JSDOM('<div id="w"><video id="v"></video></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w3 = dom3.window; w3.eval(read('layerpitch-video-versions.js'));
  w3.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w3.HTMLMediaElement.prototype.pause = function () {};
  Object.defineProperty(w3.HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return this._t || 0; }, set(x) { this._t = x; } }); // jsdom ne joue aucun média
  const v3 = w3.document.getElementById('v'), wrap3 = w3.document.getElementById('w');
  let t3 = 0; Object.defineProperty(v3, 'currentTime', { get: () => t3, set: x => { t3 = x; } });
  Object.defineProperty(v3, 'paused', { get: () => true });
  const soundMontage = { baseUrl: 'https://m/base.mp4', versions: [
    { key: 'original', url: 'https://m/s1.mp4', kind: 'audio', cues: [] }, { key: 'ver2', title: 'Musique 2', url: 'https://m/s2.mp4', kind: 'audio', cues: [] }] };
  const c3 = await w3.LayerPitchVideoVersions.mount(v3, wrap3, { montageId: 'c', defaultKey: 'original', tr, load: async () => soundMontage });
  check('version son : l’image est la vidéo muette du montage, le son celui de la version', v3.getAttribute('src') === 'https://m/base.mp4' && c3.audio.getAttribute('src') === 'https://m/s1.mp4');
  t3 = 17;
  const sel3 = w3.document.querySelector('.lp-video-versions select');
  sel3.value = 'ver2'; sel3.dispatchEvent(new w3.Event('change'));
  check('changer de musique : même image (pas rechargée), nouveau son calé au même instant', v3.getAttribute('src') === 'https://m/base.mp4' && c3.audio.getAttribute('src') === 'https://m/s2.mp4' && Math.abs(c3.audio.currentTime - 17) < 0.01);

  const reel = read('src/reel/35-blocs-contact-video.js');
  check('bloc vidéo public : branché quand la vidéo vient d’un montage', /v\.montageId && window\.LayerPitchVideoVersions/.test(reel));
  check('pages publiques : le fichier est chargé avant reel.js', ['index.html', 'vitrine.html'].every(f => /layerpitch-video-versions\.js[^\n]*\n<script src="reel\.js/.test(read(f))));
  check('publication : montage, version par défaut et versions cachées voyagent avec la vidéo', /videoMontageFields\(v\)/.test(read('src/backstage/42-publication.js')) && /videoMontageFields\(v\)/.test(read('src/backstage/38-chargement.js')));
  check('outil de capture : « Mettre à jour la vidéo partout » relie vidéo + étiquettes', /videoCaptureUpdateEverywhereBtn/.test(read('src/pack/18-panneau-de-capture.js')) && /p_cues: buildCaptureCues\(lastEvents, laneOverrides\)/.test(read('src/pack/18-panneau-de-capture.js')));
  check('export complet : incrustations tirées des mêmes étiquettes', /for \(const c of buildCaptureCues\(events, laneOverrides\)\)/.test(read('src/pack/17-export-video.js')));
  console.log(failures ? failures + ' échec(s)' : 'Tout est OK');
  process.exit(failures ? 1 : 0);
})();
