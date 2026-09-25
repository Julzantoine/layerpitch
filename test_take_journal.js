const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Journal de prise (Adaptive OST, Figer -- 25/09) : le lecteur note ce qu'il fait réellement jouer (fichier, instant,
// position, commandes de volume), une prise par vrai démarrage, pauses retirées du temps d'écoute. Le rendu audio de
// ce journal (LayerCaptureRender.renderTake) se vérifie dans un vrai navigateur (OfflineAudioContext) ; ici on vérifie
// le journal lui-même : activation explicite, contenu, pause / reprise, nouvelle prise, données pures (JSON).

(async () => {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body><div id="host"></div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function param(v) { return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }; }
      function FakeAudioContext() { this.destination = {}; this.sampleRate = 44100; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () { return { gain: param(1), connect() {}, disconnect() {} }; };
      FakeAudioContext.prototype.createBufferSource = function () {
        const ctxRef = this;
        const node = {
          buffer: null, onended: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), connect() {}, disconnect() {},
          addEventListener(type, fn) { if (type === 'ended') { const prev = node._extra || []; prev.push(fn); node._extra = prev; } },
          stop() { if (node._endTimer) clearTimeout(node._endTimer); if (!node._ended) { node._ended = true; if (node.onended) node.onended(); (node._extra || []).forEach(f => f()); } },
          start(when) {
            const dur = (node.buffer && node.buffer.duration) || 1;
            const delaySec = Math.max(0, (when - ctxRef.currentTime) + dur);
            node._endTimer = setTimeout(() => node.stop(), delaySec * 1000 + 5000);
          }
        };
        return node;
      };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 60 }); };
      win.AudioContext = FakeAudioContext;
      // Fichiers « publiés » : le journal retient l'URL de chaque fichier décodé (le rendu les retéléchargera).
      win.fetch = () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      win.ResizeObserver = win.ResizeObserver || function () { return { observe() {}, disconnect() {} }; };
      win.requestAnimationFrame = win.requestAnimationFrame || (cb => setTimeout(cb, 16));
      win.cancelAnimationFrame = win.cancelAnimationFrame || (id => clearTimeout(id));
    }
  });
  const { window } = dom;
  await new Promise(resolve => setTimeout(resolve, 50));
  const doc = window.document;
  const Core = window.LayerPlayerCore;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  function verticalTrack(id) {
    return { id, title: 'Vertical', mode: 'vertical', description: '', duration: 60, loopable: true, base: 'https://media.example/t/', publishedAt: 7,
      layers: [{ label: 'L1', file: 'l1.ogg' }, { label: 'L2', file: 'l2.ogg' }], sfxIds: [] };
  }
  async function mount(track) {
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(150);
    return row;
  }

  // ---- Pas activé : aucun journal (les pages publiques n'appellent jamais setTakeRecording) ----
  {
    const row = await mount(verticalTrack('off'));
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    check('sans activation : getTrackTake renvoie null', Core.getTrackTake('off') === null);
    click(row.querySelector('[data-role="playBtn"]'));
  }

  Core.setTakeRecording(true);

  // ---- Activé : une prise par vrai démarrage ----
  {
    const row = await mount(verticalTrack('v1'));
    check('avant toute écoute : pas de prise', Core.getTrackTake('v1') === null);
    const playBtn = row.querySelector('[data-role="playBtn"]');
    click(playBtn);
    await sleep(200);
    click(row.querySelector('.intensity-chip[data-level="1"]'));
    click(row.querySelector('[data-voice-action="mute"][data-voice-key="layer-0"]'));
    await sleep(200);
    let take = Core.getTrackTake('v1');
    check('prise : objet de type layerpitch-take', !!take && take.kind === 'layerpitch-take' && take.v === 1);
    check('prise : identifiant et version du morceau', take.trackId === 'v1' && take.publishedAt === 7);
    check('prise : une voix par couche jouée', take.voices.length === 2);
    check('prise : URL publiée de chaque fichier (avec la version)', take.voices.every(v => /^https:\/\/media\.example\/t\/l[12]\.ogg\?v=7$/.test(v.url)) && take.missing === 0);
    check('prise : les voix démarrent au début de la prise', take.voices.every(v => v.start >= 0 && v.start < 0.1));
    check('prise : boucle du moteur simple retenue', take.voices.every(v => Array.isArray(v.loop) && v.loop[1] === 60));
    check('prise : commandes de volume consignées (intensité, muet)', take.voices.some(v => v.gain && v.gain.auto.length >= 2));
    check('prise : les temps du journal sont des temps d\'écoute (pas l\'horloge du contexte)', take.voices.every(v => v.gain.auto.every(e => e[1] > -1 && e[1] < 5)));
    check('prise en cours : pas encore complète', take.complete === false && take.duration > 0.3 && take.duration < 1.5);
    check('prise : données pures (JSON aller-retour identique)', JSON.stringify(JSON.parse(JSON.stringify(take))) === JSON.stringify(take));

    // pause : le temps d'écoute s'arrête
    click(playBtn);
    await sleep(50);
    take = Core.getTrackTake('v1');
    const pausedDuration = take.duration;
    check('pause : prise complète, voix arrêtées', take.complete === true && take.voices.every(v => v.stop != null && v.stop <= pausedDuration + 0.01));
    await sleep(400);
    check('pause : la durée ne bouge plus', Math.abs(Core.getTrackTake('v1').duration - pausedDuration) < 0.01);

    // reprise : MÊME prise, sans le temps de pause
    click(playBtn);
    await sleep(200);
    take = Core.getTrackTake('v1');
    check('reprise : même prise (voix d\'avant la pause conservées)', take.voices.length === 4);
    check('reprise : les nouvelles voix commencent là où la pause a commencé', take.voices.slice(2).every(v => Math.abs(v.start - pausedDuration) < 0.05));
    check('reprise : la pause est retirée du temps d\'écoute', take.duration < pausedDuration + 0.35);

    // fin : pause, puis un autre morceau lancé entre-temps ne change rien à la prise
    click(playBtn);
    await sleep(50);
    const before = Core.getTrackTake('v1');

    // nouveau vrai démarrage après une fin : nouvelle prise
    const row2 = await mount(verticalTrack('v2'));
    click(row2.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    check('autre morceau : sa propre prise', Core.getTrackTake('v2').trackId === 'v2' && Core.getTrackTake('v2').voices.length === 2);
    check('autre morceau : la prise du premier est intacte', JSON.stringify(Core.getTrackTake('v1')) === JSON.stringify(before));
    click(row2.querySelector('[data-role="playBtn"]'));
  }

  // ---- Morceau non publié (fichier local, Backstage) : prise marquée incomplète pour le rendu ----
  {
    const t = verticalTrack('local');
    t.layers = [{ label: 'L1', localFile: { name: 'a.wav', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) } }];
    const row = await mount(t);
    click(row.querySelector('[data-role="playBtn"]'));
    await sleep(100);
    const take = Core.getTrackTake('local');
    check('fichier local : aucune URL, compté dans missing', take.voices.length === 1 && take.voices[0].url === null && take.missing === 1);
    click(row.querySelector('[data-role="playBtn"]'));
  }

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
