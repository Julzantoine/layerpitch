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
    url: 'http://localhost/test.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      const epoch = Date.now();
      function FakeAudioContext() { this.destination = {}; }
      Object.defineProperty(FakeAudioContext.prototype, 'currentTime', { get() { return (Date.now() - epoch) / 1000; } });
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () {
        return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} };
      };
      FakeAudioContext.prototype.createBufferSource = function () {
        const ctxRef = this;
        const node = {
          buffer: null, onended: null, connect() {},
          stop() { if (node._endTimer) clearTimeout(node._endTimer); if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } },
          start(when) {
            const dur = (node.buffer && node.buffer.duration) || 1;
            const delaySec = Math.max(0, (when - ctxRef.currentTime) + dur);
            node._endTimer = setTimeout(() => { if (!node._ended) { node._ended = true; if (node.onended) node.onended(); } }, delaySec * 1000);
          }
        };
        return node;
      };
      let bufCounter = 0;
      FakeAudioContext.prototype.decodeAudioData = function () { bufCounter++; return Promise.resolve({ duration: 2 }); };
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
  function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }

  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  // ---- static ----
  {
    const track = { id: 's1', title: 'Static test', mode: 'static', description: '', duration: 0, loopable: false, base: '', publishedAt: 1, layers: [{ label: '', localFile: fakeFile('s.wav') }], sfxIds: [] };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(200);
    const playBtn = row.querySelector('[data-role="playBtn"]');
    check('static: play button enabled after loading', playBtn && !playBtn.disabled);
    click(playBtn);
    await sleep(100);
    check('static: playing (pause icon shown)', row.querySelector('[data-role="playIcon"]').innerHTML.includes('rect') || !row.querySelector('[data-role="playIcon"]').innerHTML.includes('M8 5v14l11-7z'));
    click(playBtn);
  }

  // ---- vertical (classic layers, non-quantized) ----
  {
    const track = {
      id: 'v1', title: 'Vertical test', mode: 'vertical', description: '', duration: 0, base: '', publishedAt: 1,
      layers: [{ label: 'L1', localFile: fakeFile('l1.wav') }, { label: 'L2', localFile: fakeFile('l2.wav') }], sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(200);
    const playBtn = row.querySelector('[data-role="playBtn"]');
    check('vertical: play button enabled after loading', playBtn && !playBtn.disabled);
    click(playBtn);
    await sleep(100);
    const chip = row.querySelector('.intensity-chip[data-level="1"]');
    check('vertical: intensity chip present', !!chip);
    if (chip) click(chip);
    await sleep(50);
    click(playBtn);
  }

  // ---- sequential ----
  {
    const track = {
      id: 'q1', title: 'Sequential test', mode: 'sequential', description: '', duration: 0, base: '', publishedAt: 1,
      bpm: 150, beatsPerBar: 1,
      intro: { label: 'Intro', bars: 1, localFile: fakeFile('intro.wav') },
      outro: { label: 'Outro', localFile: fakeFile('outro.wav') },
      segmentSlots: [
        { id: 'slotA', label: 'A', avoidImmediateRepeat: true, repeatCount: 1, alternatives: [{ label: 'A1', bars: 1, localFile: fakeFile('a1.wav') }] }
      ],
      sfxIds: []
    };
    const row = Core.buildTrackRow(track, null, false);
    doc.getElementById('host').appendChild(row);
    Core.initTrackPlayer(track, row);
    await sleep(200);
    const playBtn = row.querySelector('[data-role="playBtn"]');
    check('sequential: play button enabled after loading', playBtn && !playBtn.disabled);
    click(playBtn);
    await sleep(100);
    const goToEndBtn = row.querySelector('[data-role="goToEndBtn"]');
    check('sequential: goToEndBtn enabled while playing', goToEndBtn && !goToEndBtn.disabled);
    if (goToEndBtn) click(goToEndBtn);
    async function waitUntil(predicate, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) { if (predicate()) return true; await sleep(50); }
      return predicate();
    }
    const icon = row.querySelector('[data-role="playIcon"]');
    check('sequential: stops naturally after outro', await waitUntil(() => icon.innerHTML.includes('M8 5v14l11-7z'), 3000));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
