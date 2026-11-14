// layerpitch-tuto.js — LayerPitch, porte d'entrée UNIQUE du MODE TUTORIEL (?tuto), partagée par le Backstage, projet.html et projets.html (20/10).
//
// Le tutoriel tourne sur un faux serveur local (api/demo-client.js, api/demo-projects.js) : compte fictif, rien n'est lu ni écrit en base,
// tout est remis à zéro à chaque chargement. Ce fichier ne contient que la règle d'accès, pour qu'elle ne vive qu'à UN endroit.
(function () {
  // OUVERTURE AU PUBLIC (26/10) : feu vert `public_tutorial` (table feature_flags, lecture publique, sans connexion). Tant qu'il est
  // fermé (ou illisible : réseau, erreur), seul un compte réellement connecté entre ; tout autre visiteur est renvoyé vers la page
  // normale. Pour ouvrir : select public.set_feature_released('public_tutorial', true);
  const FLAG_URL = 'https://ypygllyjfynrnvapufow.supabase.co/rest/v1/feature_flags?select=released&key=eq.public_tutorial';
  const FLAG_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';
  let flagOpen = false;
  // `ready` : à attendre avant d'appeler publicOpen() (la lecture du feu vert est asynchrone).
  const ready = !new URLSearchParams(window.location.search).has('tuto') || typeof fetch !== 'function' ? Promise.resolve()
    : fetch(FLAG_URL, { headers: { apikey: FLAG_KEY } }).then(r => r.ok ? r.json() : [])
        .then(rows => { flagOpen = !!(rows && rows[0] && rows[0].released === true); }).catch(() => { flagOpen = false; });
  function publicOpen() { return flagOpen; }
  function isOn() { return new URLSearchParams(window.location.search).has('tuto'); }

  // Vérifie qu'un vrai admin est connecté (vrai client Supabase, avant la bascule). Sinon : retour à la page normale, sans ?tuto.
  async function adminGate() {
    try {
      const client = window.LayerPitchSupabaseClient.getClient();
      const { data } = await client.auth.getSession();
      if (data && data.session && data.session.user) {
        const res = await client.rpc('is_admin');
        if (!res.error && res.data) return true;
      }
    } catch (e) { /* traité comme non admin */ }
    return false;
  }
  // Niveau d'accès d'une personne réellement connectée (23/10, ouverture aux bêta-testeurs) : 'admin', 'member' (tout compte connecté), ou null
  // (personne de connecté). Le Backstage s'en sert pour laisser entrer les bêta-testeurs dans le tutoriel du moteur audio ; les pages
  // Projet (leçons « Préproduction ») gardent la porte admin ci-dessus, via enter().
  async function accessLevel() {
    try {
      const client = window.LayerPitchSupabaseClient.getClient();
      const { data } = await client.auth.getSession();
      if (data && data.session && data.session.user) {
        const res = await client.rpc('is_admin');
        return (!res.error && res.data) ? 'admin' : 'member';
      }
    } catch (e) { /* traité comme personne de connecté */ }
    return null;
  }
  // Bascule : tous les api/*.js appellent window.LayerPitchSupabaseClient.getClient() à chaque usage, donc cette seule ligne les met
  // tous sur le faux serveur (api/demo-client.js doit être chargé).
  function switchToDemo() { window.LayerPitchSupabaseClient = { getClient: () => window.LayerPitchDemoClient }; }
  // Entrée complète pour les pages à balises <script> statiques : porte (si fermée) puis bascule. `leaveTo` : page de repli pour un refus.
  // `opts.adminOnly` : page réservée aux admins même quand le tutoriel public est ouvert (leçons « Préproduction » pas encore vérifiées, 26/10).
  // Leçons jouées hors du Backstage et réservées aux admins jusqu'à leur feu vert, quelle que soit la page qui les accueille (05/11 :
  // « Jouer en direct sur une vidéo », sur la page du pack). À retirer de cette liste à l'ouverture de la leçon.
  const ADMIN_ONLY_LESSONS = ['live-play', 'versioning', 'versioning-adreel', 'pj-annotate']; // 12/11 : leçons Versioning vidéo refermées le temps de les refaire
  const lessonAdminOnly = () => ADMIN_ONLY_LESSONS.includes(new URLSearchParams(window.location.search).get('lesson'));
  async function enter(leaveTo, opts) {
    if (!isOn()) return false;
    await ready;
    if ((!publicOpen() || (opts && opts.adminOnly) || lessonAdminOnly()) && !(await adminGate())) { window.location.replace(leaveTo || window.location.pathname); await new Promise(() => {}); }
    switchToDemo();
    return true;
  }
  // ---- Suivi Umami du tutoriel (23/10) ----
  // Umami (sans cookie) est chargé SEULEMENT sur les pages du mode tutoriel (?tuto), avec le même site Umami que les pages publiques.
  // Les événements du tutoriel y portent le préfixe « tuto_ » (tuto_lesson_open, tuto_step, tuto_lesson_done, tuto_lesson_quit…) et ne
  // contiennent que des identifiants de leçon et d'étape, jamais de donnée personnelle. Le tutoriel joue sur un faux compte : on retire
  // `window.umami` une fois le script chargé, pour que ni le lecteur (play, pause…) ni le Backstage (track_add…) n'envoient leurs
  // événements « réels » à Umami depuis un compte fictif : seule la fonction track() ci-dessous parle à Umami.
  const UMAMI_SRC = 'https://cloud.umami.is/script.js';
  const UMAMI_SITE = '2dd3435c-f5c8-45c0-ab07-3b0e9fa09d2f';
  let umami = null;
  const queue = [];
  function sendNow(name, detail) { umami.track('tuto_' + name, detail || {}); }
  // Copie dans notre base (13/11) pour le tableau « Tutoriel » de l'admin : fetch direct avec la clé publique (comme la lecture du feu vert
  // plus haut), car après switchToDemo() le client Supabase de la page est le faux serveur. Identifiant de visite aléatoire, gardé le temps
  // de l'onglet : ni cookie ni lien avec un compte. Marche même si Umami est bloqué par un bloqueur de pub. Jamais bloquant.
  const LOG_URL = 'https://ypygllyjfynrnvapufow.supabase.co/rest/v1/rpc/log_tutorial_event';
  let visitId = null;
  function getVisitId() {
    if (visitId) return visitId;
    try { visitId = window.sessionStorage.getItem('lp_tuto_visit'); } catch (e) { /* stockage indisponible */ }
    if (!visitId) {
      visitId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { window.sessionStorage.setItem('lp_tuto_visit', visitId); } catch (e) { /* idem : l'identifiant vit alors le temps de la page */ }
    }
    return visitId;
  }
  function logToBase(name, detail) {
    if (typeof fetch !== 'function') return;
    try {
      fetch(LOG_URL, {
        method: 'POST', keepalive: true,
        headers: { apikey: FLAG_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_session_id: getVisitId(), p_event_name: name, p_detail: detail || {} }),
      }).catch(() => {});
    } catch (e) { /* jamais bloquant */ }
  }
  function track(name, detail) {
    if (!isOn()) return;
    logToBase(name, detail);
    try {
      if (umami && typeof umami.track === 'function') sendNow(name, detail);
      else if (queue.length < 200) queue.push([name, detail]); // script pas encore chargé : on garde les premiers événements
    } catch (e) { /* jamais bloquant */ }
  }
  function loadUmami() {
    if (!isOn() || document.querySelector('script[data-lp-tuto-umami]')) return;
    const s = document.createElement('script');
    s.defer = true; s.src = UMAMI_SRC;
    s.setAttribute('data-website-id', UMAMI_SITE);
    s.setAttribute('data-lp-tuto-umami', '1');
    s.onload = () => {
      umami = window.umami || null;
      window.umami = undefined; // voir plus haut : pas d'événements « réels » depuis le compte fictif
      try { while (queue.length) { const [n, d] = queue.shift(); if (umami && umami.track) sendNow(n, d); } } catch (e) { /* jamais bloquant */ }
    };
    document.head.appendChild(s);
  }
  loadUmami();
  window.LayerPitchTuto = { track, ready, publicOpen, isOn, adminGate, accessLevel, switchToDemo, enter, ADMIN_ONLY_LESSONS };
})();
