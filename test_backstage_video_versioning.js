// Backstage → Vidéo → sous-onglet « Versioning » (26/09) : liste de tous les montages sauvegardés, tous packs confondus,
// avec leurs versions vidéo (celles déjà rendues et rangées en bibliothèque repérées), et le lien « Ouvrir » vers l'outil
// vidéo du pack, montage chargé (pack.html?...&capture=1&montage=<id>). Réservé à l'admin jusqu'au feu vert.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const backstageSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8')
    .replace(/<script[^>]*src="https:\/\/unpkg\.com[^"]*"[^>]*><\/script>\s*/g, '');
  function inlineExactLine(html, filename, tagline) {
    const content = fs.readFileSync(path.join(__dirname, filename), 'utf-8').replace(/<\/script/gi, '<\\/script');
    return html.split('\n').map(line => {
      const normalized = line.trim().replace(/\.js(\?[^"]*)?"/, '.js"');
      return normalized === tagline ? `<script>${content}</script>` : line;
    }).join('\n');
  }
  let html = inlineExactLine(backstageSrc, 'layerpitch-i18n.js', '<script src="layerpitch-i18n.js"></script>');
  html = inlineExactLine(html, 'layerpitch-notify.js', '<script src="layerpitch-notify.js"></script>');
  html = inlineExactLine(html, 'layerpitch-help.js', '<script src="layerpitch-help.js"></script>');
  html = inlineExactLine(html, 'player.js', '<script src="player.js"></script>');
  const dom = new JSDOM(html, {
    url: 'http://localhost/test_backstage.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      function FakeAudioContext() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      FakeAudioContext.prototype.resume = function () { return Promise.resolve(); };
      FakeAudioContext.prototype.createGain = function () { return { gain: { setValueAtTime() {}, value: 1 }, connect() {}, disconnect() {} }; };
      FakeAudioContext.prototype.close = function () {};
      win.AudioContext = FakeAudioContext;
    }
  });
  const { window } = dom;
  await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 50)));
  const doc = window.document;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 30));
  const ev = code => window.eval(code);

  const calls = [];
  const rpcData = {
    list_my_video_captures: [
      { id: 'cap1', packId: 'p1', title: 'Trailer', videoFilename: 'gameplay.mp4', updatedAt: '2026-09-26T10:00:00Z' },
      { id: 'cap2', packId: 'p2', title: 'Démo pack fermé', videoFilename: null, updatedAt: '2026-09-25T10:00:00Z' },
    ],
    list_my_videos: { videos: [{ id: 'vid1' }], quotaGb: 100 },
  };
  const versions = { cap1: [{ id: 'v1', title: 'Musique B', lastExportVideoId: 'vid1' }, { id: 'v2', title: 'Sfx ville', lastExportVideoId: null }], cap2: [] };
  window.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'list_video_capture_versions') return { data: versions[args.p_capture_id], error: null };
    return { data: rpcData[name], error: null };
  } }) };
  ev(`packs = [{ id: 'p1', title: 'Robot Adventure', videoTestModeEnabled: true }, { id: 'p2', title: 'Pack fermé', videoTestModeEnabled: false }];`);

  const tabBtn = doc.querySelector('#panelVideoLibrary [data-video-subtab="versioning"]');
  check('onglet Vidéo : sous-onglet « Versioning » présent', !!tabBtn);

  ev('currentUserIsAdmin = false');
  tabBtn.click(); await settle();
  const list = doc.getElementById('videoVersioningList');
  check('non-admin : message « réservé à l\'admin », aucune lecture en base', list.textContent.includes(ev("tr('videoVersioningAdminOnly')")) && !calls.length);

  ev('currentUserIsAdmin = true');
  tabBtn.click(); await settle(); await settle();
  check('admin : tous les montages listés, tous packs confondus (lecture sans filtre de pack)', list.querySelectorAll('.video-library-item').length === 2
    && calls.some(c => c[0] === 'list_my_video_captures' && c[1].p_pack_id === null));
  const first = list.querySelectorAll('.video-library-item')[0];
  check('montage : titre, pack, vidéo d\'origine', first.textContent.includes('Trailer') && first.textContent.includes('Robot Adventure') && first.textContent.includes('gameplay.mp4'));
  const chips = first.querySelectorAll('.video-versioning-chip');
  check('montage : ses versions vidéo, celle déjà rangée en bibliothèque repérée', chips.length === 2 && chips[0].classList.contains('exported') && !chips[1].classList.contains('exported'));
  const link = first.querySelector('a');
  check('« Ouvrir » : outil vidéo du pack, montage chargé, nouvel onglet', link && /pack\.html\?id=p1&lang=\w+&capture=1&montage=cap1$/.test(link.getAttribute('href')) && link.target === '_blank');
  const second = list.querySelectorAll('.video-library-item')[1];
  check('pack sans mode « Tester en jeu » : bouton grisé + explication', !second.querySelector('a') && second.textContent.includes(ev("tr('videoCaptureNeedsTestMode')")));
  check('montage sans version : « aucune version vidéo »', second.textContent.includes(ev("tr('videoVersioningNoVersion')")));

  rpcData.list_my_video_captures = [];
  tabBtn.click(); await settle(); await settle();
  check('aucun montage : message d\'invitation', list.textContent.includes(ev("tr('videoVersioningEmpty')")));

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
