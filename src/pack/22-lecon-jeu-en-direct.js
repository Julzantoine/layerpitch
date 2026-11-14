// Leçon guidée « Jouer en direct sur une vidéo » (05/11, ?tuto&lesson=live-play, voir pack-lecons.js) : le moteur des bulles et la leçon ne
// sont chargés QUE dans ce cas (jamais pour un visiteur ordinaire de la page). La porte d'entrée du tutoriel (layerpitch-tuto.js, appelée au
// chargement des données) a déjà renvoyé un non-admin vers la page normale ; la leçon démarre une fois le pack affiché.
(function setupPackLesson() {
  const q = new URLSearchParams(location.search);
  if (!q.has('tuto') || q.get('lesson') !== 'live-play') return;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = lpVersioned('layerpitch-guide.css');
  document.head.appendChild(css);
  // Boutons des bulles (layerpitch-guide.css s'appuie sur les .btn de la page qui l'accueille, absents ici) : mêmes règles que l'atelier.
  const btnCss = document.createElement('style');
  btnCss.textContent = '.tour-card .btn{font:inherit;font-size:12px;padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}'
    + '.tour-card .btn:hover{border-color:var(--accent);color:var(--accent)}.tour-card .btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}.tour-card .btn-primary:hover{opacity:.9;color:#fff}';
  document.head.appendChild(btnCss);
  const scripts = lpLoadScriptsInOrder(['./layerpitch-guide.js', './pack-lecons.js']);
  window.addEventListener('load', () => scripts.then(() => {
    let waited = 0;
    const timer = setInterval(() => {
      waited += 200;
      if (document.querySelector('.video-test-trigger-btn')) { clearInterval(timer); window.LayerPitchPackLessons.init({ lang: pageLang }).start(); }
      else if (waited > 60000) clearInterval(timer);
    }, 200);
  }).catch(e => console.warn('LayerPitch — leçon indisponible :', e)));
})();
