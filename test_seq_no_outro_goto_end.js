// Non-régression (demande du 13/08) : en séquentiel, le bouton "Aller vers la fin" ne doit pas être
// affiché s'il n'y a pas d'outro déclarée — jusqu'ici toujours affiché (avec un texte de repli "fin après
// le segment en cours" quand l'outro manquait), ce que Jules-Antoine juge inutile/déroutant sans outro.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf-8');
  const playerSrc = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf-8').replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html><html><body><div id="host"></div>
  <script>${i18nSrc}</script>
  <script>${playerSrc}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/test.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function FakeAudioContext() { this.destination = {}; this.currentTime = 0; }
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }; };
      FakeAudioContext.prototype.createBufferSource = function () { return { connect() {}, start() {}, stop() {}, buffer: null }; };
      FakeAudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: 10 }); };
      win.AudioContext = FakeAudioContext;
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
  function fakeFile(name) { return { name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }; }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // ---- Sans outro : bouton masqué ----
  {
    const track = {
      id: 'no-outro', title: 'Sans outro', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1,
      bpm: 120, beatsPerBar: 4,
      segmentSlots: [{ id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'A1', bars: 1, localFile: fakeFile('a1.wav') }] }],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(150);
    const btn = row.querySelector('[data-role="goToEndBtn"]');
    check('bouton présent dans le DOM (pas de crash) mais masqué sans outro', !!btn && btn.style.display === 'none');
  }

  // ---- Avec outro : bouton visible, comme avant ----
  {
    const track = {
      id: 'with-outro', title: 'Avec outro', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1,
      bpm: 120, beatsPerBar: 4,
      outro: { label: 'Outro', localFile: fakeFile('outro.wav') },
      segmentSlots: [{ id: 'slotA', label: 'A', avoidImmediateRepeat: false, repeatCount: 1, alternatives: [{ label: 'A1', bars: 1, localFile: fakeFile('a1.wav') }] }],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(150);
    const btn = row.querySelector('[data-role="goToEndBtn"]');
    check('bouton visible quand une outro est déclarée (non-régression)', !!btn && btn.style.display !== 'none');
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
