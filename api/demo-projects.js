// api/demo-projects.js — LayerPitch, faux serveur « Projets » du MODE TUTORIEL (projet.html?tuto), 20/10.
//
// Même interface que window.LayerPitchProjects (api/projects.js), mais tout vit en mémoire dans la page : le Projet
// fictif « Music City » (discussion, sections, Moodboard) est reconstruit à chaque chargement, on peut y ÉCRIRE
// librement (poster, épingler, ranger, créer des sections…), rien n'est envoyé nulle part, tout repart de zéro au
// rechargement. Les fichiers déposés restent dans le navigateur (adresses locales). Aperçus de liens : la fonction serveur
// link-preview n'existe pas ici ; les aperçus sont préremplis (LINK_PREVIEWS) ou construits à partir de l'adresse.
// Les données de départ (SEED) sont tout en haut, à ajuster librement. Tout ce qui n'est pas géré répond « rien, sans erreur ».
(function () {
  const ME = { id: 'demo-user', email: 'demo@layerpitch.com' };

  // ---------- Données de départ (fil rouge fictif « Dernier Étage », 18/11 : remplace « Music City » dans l'espace Projet) ----------
  // Jeu d'horreur psychologique sur le burn-out en entreprise, mis en musique par le compositeur Daniel (le même que dans les leçons AdReel et album
  // du Backstage). Données recopiées de scripts/seed-demo-dernier-etage.js (le Projet de démo réel), allégées. Images de gameplay : Protocol Interactive
  // (« Something Is Wrong »), avec leur aimable autorisation : le crédit est la première note du Moodboard.
  const STEAM = 'https://store.steampowered.com/app/3895130/Something_is_wrong/';
  const SEED = {
    project: { title: 'Dernier Étage', description: 'Projet fictif : jeu d’horreur psychologique sur le burn-out en entreprise. Une tour de bureaux, des étages de plus en plus sombres, et deux versions de la musique à comparer.' },
    members: [
      { email: 'ines@dernier-etage.example', role: 'admin' },
      { email: 'karim@dernier-etage.example', role: 'editor' },
      { email: 'daniel.orcman@example.com', role: 'editor' }, // le compositeur
    ],
    // [heure d’hier, auteur, texte] — discussion fictive.
    messages: [
      ['10:02', 'Inès', 'Première scène en ligne : O. traverse l’open space jusqu’à la photocopieuse, puis monte à l’étage sombre et finit dans la salle d’archives.'],
      ['10:08', 'Karim', 'Je l’ai vue. Les piles de dossiers partout, ça dit déjà tout : personne ne range, personne ne part. Et la musique ?'],
      ['10:12', 'Daniel', 'J’ai préparé deux versions. A : une mélodie douce posée sur les couches. B : aucune mélodie, juste de la texture. Je voulais qu’on les compare sur la même image.'],
      ['10:15', 'Inès', 'Dans le bureau, je veux que ça sonne presque normal. Un quotidien qui tient debout, mais un peu trop propre.'],
      ['10:19', 'Daniel', 'C’est la version A pour la première partie : la mélodie rassure, comme le bureau. Les couches arrivent au fil des déplacements : une quand O. passe à la photocopieuse, une autre quand elle reprend son document.'],
      ['10:24', 'Karim', 'Et quand elle prend l’ascenseur ? Je voudrais que le joueur sente qu’il n’y a plus de retour en arrière.'],
      ['10:27', 'Daniel', 'Un effet ponctuel à l’ouverture des portes, et la musique du bureau s’arrête net. Ensuite un drone seul, pour tout l’étage sombre.'],
      ['10:31', 'Inès', 'J’aime ça. Le silence du bureau qui disparaît, c’est le moment où ce n’est plus le travail, c’est la tête.'],
      ['10:36', 'Karim', 'Version B sur la même scène, alors. Sans mélodie, le joueur n’a plus rien pour se raccrocher, même au bureau. Ça change la lecture.'],
      ['10:40', 'Daniel', 'Oui. A rassure puis lâche. B inquiète dès le premier pas. Je les ai rangées côte à côte dans le montage, tu peux basculer de l’une à l’autre.'],
      ['10:45', 'Inès', 'Dans la salle d’archives, vide et dans le noir, quand O. trouve la lampe : je ne veux presque rien entendre. Un grésillement, un souffle.'],
      ['10:49', 'Karim', 'La lampe est aussi un objet de jeu : elle éclaire un rayon de plus en plus court, comme le temps qui reste.'],
      ['10:53', 'Daniel', 'Parfait : plus la batterie baisse, plus la texture se resserre. Je prépare la carte du niveau avec les zones : bureau, couloir, archives.'],
      ['10:58', 'Inès', 'Validé. On garde les deux versions de l’ouverture pour le test joueurs de jeudi.'],
    ],
    // Les sections du Projet.
    sections: ['Direction artistique', 'Musique : mélodie ou texture ?', 'Bruitages du bureau', 'Scènes clés'],
    // Notes de Moodboard de départ (au Moodboard général).
    notes: [
      ['À propos de cette démo : projet fictif et crédits', 'Ce Projet est fictif : il a été imaginé pour la démonstration de LayerPitch. Les images de gameplay sont fournies avec l’aimable autorisation de Protocol Interactive (Joris Balzanelli et Samir Bensadoun), développeurs de « Something Is Wrong », un jeu en développement. Allez voir leur jeu sur Steam : ' + STEAM],
      ['Un bureau trop propre', 'Open space aux lumières froides, moquette grise, écrans allumés. Presque rassurant, avec quelque chose qui sonne faux.'],
      ['La lampe', 'Objet de jeu et symbole : elle éclaire de moins en moins loin, comme l’énergie qui s’épuise.'],
    ],
    // Références déjà épinglées au Moodboard. D'autres se déposent pendant la leçon (LESSON_LINKS).
    links: [
      ['Réf. musicale : Mica Levi, « Love » (Under the Skin)', 'https://www.youtube.com/watch?v=Z_Cc20I-maM', 'Cordes qui glissent, rien de mélodique à quoi se raccrocher. Le malaise par la texture.'],
      ['Réf. graphique : Edward Hopper, « Office at Night »', 'https://en.wikipedia.org/wiki/Office_at_Night', 'Une lumière froide, deux personnes dans un bureau qui ne se parlent pas. Le malaise par le cadrage.'],
    ],
  };
  // Leçons Vitrine (18/11, refaites pour « Dernier Étage ») : quatre images du jeu, un extrait de gameplay et deux morceaux favoris (★, repris d'office
  // par le bloc « Morceaux » d'une nouvelle vitrine). Fichiers à déposer dans media.layerpitch.com/tuto/dernier-etage/ (dossier medias-dernier-etage/ de
  // Jules-Antoine). Images et extrait : Protocol Interactive, « Something Is Wrong » (en développement), accord demandé le 18/11 : TANT QU'IL N'EST PAS CONFIRMÉ,
  // les deux leçons restent réservées aux admins (adminOnly dans src/backstage/43-visite-guidee.js).
  const MC_DIR = 'https://media.layerpitch.com/tuto/dernier-etage/';
  const SHOWCASE_IMAGES = [['Le bureau d’Allrisk Solutions', 'bureau.jpg'], ['L’écran d’ordinateur du jeu', 'ecran-haunted-stories.jpg'], ['Le couloir sombre', 'couloir.jpg'], ['L’écran-titre', 'titre-steam.jpg']]
    .map(([title, file]) => ({ title, name: file, url: MC_DIR + file }));
  const SHOWCASE_VIDEO = { title: 'Dernier Étage : extrait de gameplay', name: 'clip-3.mp4', url: MC_DIR + 'clip-3.mp4' };
  const SHOWCASE_TRACKS = [['bmwb6s3d467w77', 'Welcome to the Office'], ['bmw3ds8idckeds', 'Drone Urbex #2']];
  const SHOWCASE_PITCH = 'Vous êtes employé(e) dans une tour de bureaux qui ne ferme jamais. Les dossiers s’empilent, les néons bourdonnent, et chaque étage est un peu plus sombre que le précédent. Un jeu à l’ambiance lente, où la musique ne dit pas quoi ressentir : elle suit votre fatigue.';
  // Vitrine « déjà construite » (leçon apparence) : le résultat de la leçon « construire ».
  const SHOWCASE_LINKS = ['https://www.instagram.com/dernier.etage.exemple', STEAM];
  const TUTO_VITRINE_KEY = 'layerpitch_tuto_vitrine_v1'; // aperçu : lu par vitrine.html?tuto

  // Carte de la balade (18/11) : le niveau 1 du projet de démo « Dernier Étage » (landing studio), recopiée telle quelle depuis la base (lecture publique).
  const WALK_MAP = {"edges":[{"id":"e1","to":"photocop","from":"poste","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"id":"e2","to":"bureauchef","from":"photocop","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"id":"e3","to":"ascenseur","from":"bureauchef","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"id":"e4","to":"couloir","from":"ascenseur","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"id":"e5","to":"archives","from":"couloir","enemy":false,"label":"","sounds":{"main":[{"id":"bmwla2l74uxhxw","kind":"track","title":"RoomTone"}],"room":[],"combat":[]},"transition":null},{"id":"e6","to":"lampe","from":"archives","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"id":"e7","to":"porte","from":"archives","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"id":"e8","to":"secrete","from":"porte","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null}],"modes":[],"nodes":[{"x":90,"y":250,"id":"poste","note":"O. commence ici, au milieu des piles de dossiers.","side":false,"type":"start","label":"Poste de travail","layer":1,"anchor":null,"sounds":{"main":[{"id":"bmwb6s3d467w77","kind":"track","title":"Welcome to the Office Dynamic Edition Alt 1"}],"room":[],"combat":[]},"transition":null},{"x":230,"y":130,"id":"photocop","note":"Le son régulier qui rythme la journée. O. y prend un document.","side":false,"type":"place","label":"Photocopieuse","layer":2,"anchor":null,"sounds":{"main":[{"id":"bmwb6s3d467w77","kind":"track","title":"Welcome to the Office Dynamic Edition Alt 1"}],"room":[],"combat":[]},"transition":null},{"x":290,"y":250,"id":"bureauchef","note":"Le petit enjeu qui fait tout peser.","side":false,"type":"place","label":"Bureau où apporter le document","layer":3,"anchor":null,"sounds":{"main":[{"id":"bmwb6s3d467w77","kind":"track","title":"Welcome to the Office Dynamic Edition Alt 1"}],"room":[],"combat":[]},"transition":null},{"x":385,"y":200,"id":"ascenseur","note":"Seule sortie. À l'ouverture des portes, la musique du bureau s'arrête.","side":false,"type":"place","label":"Ascenseur","anchor":null,"sounds":{"main":[{"id":"bmw40wgx1bwy7y","kind":"sfx","title":"Short Elevator"}],"room":[],"combat":[]},"transition":null},{"x":510,"y":200,"id":"couloir","note":"On déambule, lumières éteintes. Un seul drone.","side":false,"type":"place","label":"Couloir sombre","anchor":null,"sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"x":740,"y":200,"id":"archives","note":"Vide et dans le noir. Des étagères nues.","side":false,"type":"place","label":"Salle d'archives","anchor":null,"sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"x":830,"y":120,"id":"lampe","note":"Première lumière du niveau. Elle éclaire de moins en moins loin.","side":false,"type":"treasure","label":"La lampe","anchor":null,"sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"x":800,"y":330,"id":"porte","note":"Derrière la dernière étagère, une porte qu'on n'avait pas vue.","side":false,"type":"place","label":"Porte dissimulée","anchor":null,"sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"x":780,"y":440,"id":"secrete","note":"Ce que le bureau ne montre pas.","side":false,"type":"place","label":"Salle secrète","anchor":null,"sounds":{"main":[],"room":[],"combat":[]},"transition":null}],"zones":[{"h":260,"w":360,"x":40,"y":60,"id":"z-bureau","note":"Open space, lumières froides, piles de dossiers partout.","color":"#2f80c0","label":"Bureau","shape":"rect","sounds":{"main":[],"room":[],"combat":[]},"keepMusic":false,"transition":null},{"h":90,"w":240,"x":400,"y":160,"id":"z-couloir","note":"L'étage sombre où l'on déambule.","color":"#5f6b7a","label":"Couloir","shape":"rect","sounds":{"main":[],"room":[],"combat":[]},"keepMusic":false,"transition":null},{"h":270,"w":260,"x":640,"y":60,"id":"z-archives","note":"Vide et dans le noir.","color":"#b8862e","label":"Salle d'archives","shape":"rect","sounds":{"main":[{"id":"bmw41gclr2m44q","kind":"track","title":"Drone Urbex#1_Joris"}],"room":[],"combat":[]},"keepMusic":false,"transition":null},{"h":210,"w":200,"x":680,"y":330,"id":"z-secrete","note":"Accessible seulement depuis les archives.","color":"#7a5cc0","label":"Salle secrète","shape":"rect","sounds":{"main":[{"id":"bmw3ds8idckeds","kind":"track","title":"Drone Urbex#2_Joris"}],"room":[],"combat":[]},"keepMusic":false,"transition":null}],"defaults":{"transition":{"sec":2,"sync":"bar","style":"crossfade"}},"roomTone":{"id":"bmwla2l74uxhxw","kind":"track","title":"RoomTone"},"background":null,"roomDuckDb":3,"roomToneDb":-14};

  // Aperçus de liens préremplis : adresse -> { provider, title, author, thumbnail, embedUrl, embedHeight }. Une adresse absente reçoit
  // un aperçu construit depuis son adresse.
  const LINK_PREVIEWS = {
    'https://www.youtube.com/watch?v=Z_Cc20I-maM': { provider: 'youtube', title: 'Mica Levi, « Love » (Under the Skin)', thumbnail: 'https://i.ytimg.com/vi/Z_Cc20I-maM/hqdefault.jpg', embedUrl: 'https://www.youtube-nocookie.com/embed/Z_Cc20I-maM' },
    'https://open.spotify.com/album/5XjZ6xhbPbALPVGd5Zx0Cw': { provider: 'spotify', title: 'SILENT HILL2 (Original Soundtrack)', author: 'Akira Yamaoka', embedUrl: 'https://open.spotify.com/embed/album/5XjZ6xhbPbALPVGd5Zx0Cw', embedHeight: 352 },
    'https://www.youtube.com/watch?v=aM_HhU_CV44': { provider: 'youtube', title: 'Hildur Guðnadóttir, « Bridge of Death » (Chernobyl)', thumbnail: 'https://i.ytimg.com/vi/aM_HhU_CV44/hqdefault.jpg', embedUrl: 'https://www.youtube-nocookie.com/embed/aM_HhU_CV44' },
  };

  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const youtubeId = u => { const m = String(u).match(/(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/); return m ? m[1] : null; };
  // Aperçu construit à partir de l’adresse seule (sans serveur) : lecteur intégré + vignette quand le service les permet.
  function previewFromUrl(url) {
    if (LINK_PREVIEWS[url]) return LINK_PREVIEWS[url];
    const h = hostOf(url), y = youtubeId(url);
    if (y) return { provider: 'youtube', title: 'Vidéo YouTube', thumbnail: 'https://i.ytimg.com/vi/' + y + '/hqdefault.jpg', embedUrl: 'https://www.youtube-nocookie.com/embed/' + y };
    if (/vimeo\.com$/.test(h)) { const m = url.match(/vimeo\.com\/(\d+)/); return m ? { provider: 'vimeo', title: 'Vidéo Vimeo', embedUrl: 'https://player.vimeo.com/video/' + m[1] } : { failed: true }; }
    if (h === 'open.spotify.com') { const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|artist)\/(\w+)/); return m ? { provider: 'spotify', title: 'Spotify', embedUrl: 'https://open.spotify.com/embed/' + m[1] + '/' + m[2], embedHeight: m[1] === 'track' ? 152 : 352 } : { failed: true }; }
    if (/soundcloud\.com$/.test(h)) return { provider: 'soundcloud', title: 'SoundCloud', embedUrl: 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url), embedHeight: 166 };
    if (/deezer\.com$/.test(h)) { const m = url.match(/deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)/); return m ? { provider: 'deezer', title: 'Deezer', embedUrl: 'https://widget.deezer.com/widget/auto/' + m[1] + '/' + m[2], embedHeight: 150 } : { failed: true }; }
    return { failed: true };
  }

  function create(opts) {
    opts = opts || {};
    let seq = 0;
    const nid = p => (p || 'd') + (++seq);
    const now = () => new Date().toISOString();
    const day = new Date(); day.setDate(day.getDate() - 1);
    const stamp = hhmm => { const [h, m] = hhmm.split(':'); const d = new Date(day); d.setHours(+h, +m, 0, 0); return d.toISOString(); };
    const ok = data => ({ data: data === undefined ? null : data, error: null });
    const log = [];
    let created = false; // leçon « créer un projet » : la liste des projets est vide tant qu'on n'en a pas créé un (opts.startEmpty)
    const activity = (kind, payload) => log.unshift({ kind, payload: payload || {}, createdAt: now(), actorEmail: ME.email });

    const project = { id: 'demo-dernier-etage', title: SEED.project.title, description: SEED.project.description, ownerKind: 'composer', archived: false, createdAt: stamp('09:00'), updatedAt: now() };
    const members = SEED.members.map((m, i) => ({ profileId: 'm' + i, email: m.email, status: 'active', source: 'team', role: m.role, me: false }));
    members.unshift({ profileId: ME.id, email: ME.email, status: 'active', source: 'owner', role: 'admin', me: true });

    const messages = SEED.messages.map(([t, who, text]) => ({ id: nid('m'), body: text, createdAt: stamp(t), editedAt: null, authorId: 'x-' + who, authorEmail: who, mine: false, attachments: [] }));
    const secMessages = {};            // sectionId -> messages
    const followed = new Set();        // sections suivies (écrire dans un canal le suit)
    const files = {};                  // fileId -> { name, size, type, url }
    const assets = [];                 // objets de la réserve
    const moodboard = [];              // identifiants épinglés au Moodboard général (ordre)
    const sections = SEED.sections.map((title, i) => ({ id: nid('s'), parentId: null, title, position: i, mapId: null }));
    let links = [];                    // { sectionId, assetId }
    let secPins = [];                  // { sectionId, assetId, position, starred }
    const annotations = [];
    // Musique du Projet : un pack déjà partagé par un autre compositeur ; le pack du compositeur fictif (api/demo-client.js) se partage en leçon.
    const PACK_TITLES = { 'p-music-city': 'Dernier Étage : le bureau (exemple)' };
    const sharedPacks = [{ packId: 'p-cities', title: 'Dernier Étage : les ambiances (pack de Daniel)', illustration: null, mode: 'share', priceEurCents: null, subscriberCredits: null, mine: false, sharedByEmail: 'daniel.orcman@example.com' }];
    const maps = [];
    // Leçons « musique » (opts.seedMap) et « balade » (opts.seedMapMusic) : la carte de Jules-Antoine (WALK_MAP), sans ses sons pour la
    // leçon « musique » (on les y pose un à un), complète pour la balade ; ses morceaux sont dans api/demo-client.js (DEMO_TRACKS_CITY_MAP).
    if (opts.seedMap || opts.seedMapMusic) {
      const data = JSON.parse(JSON.stringify(WALK_MAP));
      if (!opts.seedMapMusic) { data.nodes.concat(data.edges, data.zones || []).forEach(x => { x.sounds = { main: [], room: [], combat: [] }; }); data.roomTone = null; }
      maps.push({ id: 'map-dernier-etage', title: 'Niveau 1 : le bureau, le couloir, les archives', updatedAt: now(), data });
    }
    const snapshots = [];
    let appearance = {};
    // Leçons Vitrine (opts.seedVitrine) : images, vidéo de gameplay et morceaux favoris dans la réserve ; opts.seedVitrineBuilt ajoute
    // la vitrine déjà construite (leçon « apparence »).
    const vitrines = [];
    if (opts.seedVitrine || opts.seedVitrineBuilt) {
      const fileAsset = (kind, f, mime) => { const fileId = nid('f'); files[fileId] = { name: f.name, size: 0, type: mime, url: f.url };
        const a = { id: nid('a'), kind, origin: 'own', title: f.title, body: '', url: null, fileId, fileName: f.name, mimeType: mime, createdAt: now(), authorEmail: 'ines@dernier-etage.example', preview: null }; assets.push(a); return a; };
      const imgs = SHOWCASE_IMAGES.map(f => fileAsset('image', f, 'image/jpeg'));
      const vid = fileAsset('video', SHOWCASE_VIDEO, 'video/mp4');
      const trk = SHOWCASE_TRACKS.map(([trackId, title]) => { const a = { id: nid('a'), kind: 'track', origin: 'own', title, trackId, starred: true, createdAt: now(), authorEmail: 'daniel.orcman@example.com', preview: null }; assets.push(a); return a; });
      if (opts.seedVitrineBuilt) vitrines.push({ id: 'vit-dernier-etage', audience: 'players', display: 'page', title: 'Dernier Étage', subtitle: 'Un jeu d’horreur psychologique : le burn-out, étage par étage.', slug: 'dernier-etage',
        published: false, secretToken: null, logoAssetId: null, bgAssetId: null, theme: {},
        blocks: [{ id: 'vb1', type: 'header' }, { id: 'vb2', type: 'tracks', assetIds: trk.map(a => a.id) }, { id: 'vb3', type: 'text', title: 'Le pitch', content: SHOWCASE_PITCH, align: 'left' },
          { id: 'vb4', type: 'video', assetIds: [vid.id] }, { id: 'vb5', type: 'photo', assetIds: imgs.map(a => a.id), caption: '' },
          { id: 'vb6', type: 'links', links: SHOWCASE_LINKS.map((url, i) => ({ label: ['Instagram', 'Steam'][i], url })) }, { id: 'vb7', type: 'contact' }] });
    }
    // Aperçu (vitrine.html?tuto) : la vitrine et ce qu'elle cite, recopiés dans le navigateur à chaque enregistrement.
    async function storePreview(v) {
      const ids = new Set([v.logoAssetId, v.bgAssetId].filter(Boolean));
      (v.blocks || []).forEach(b => (b.assetIds || []).forEach(id => ids.add(id)));
      const map = {}, fileUrls = {};
      ids.forEach(id => { const a = assets.find(x => x.id === id); if (!a) return;
        map[id] = { kind: a.kind, title: a.title, fileId: a.fileId || null, trackId: a.trackId || null, url: a.url || null, preview: a.preview || null, packId: a.packId || null };
        if (a.fileId && files[a.fileId]) fileUrls[a.fileId] = files[a.fileId].url; });
      const trackIds = Object.values(map).filter(a => a.trackId).map(a => a.trackId);
      let tracks = [];
      try { if (trackIds.length && window.LayerPitchTracks) tracks = (await window.LayerPitchTracks.listTracksByIds(trackIds)).tracks || []; } catch (e) { /* aperçu sans morceaux */ }
      try { localStorage.setItem(TUTO_VITRINE_KEY, JSON.stringify({ vitrine: Object.assign({}, v, { projectTitle: project.title, assets: map }), fileUrls, tracks })); } catch (e) { /* stockage indisponible : pas d'aperçu */ }
    }
    if (vitrines.length) storePreview(vitrines[0]);

    const addNote = (title, body, pin) => { const a = { id: nid('a'), kind: 'note', origin: 'own', title, body, url: null, fileId: null, createdAt: now(), authorEmail: ME.email, preview: null }; assets.push(a); if (pin) moodboard.push(a.id); return a; };
    SEED.notes.forEach(([t, b]) => addNote(t, b, true));
    // Comme sur la vraie page, une adresse YouTube/Vimeo devient une vidéo, les autres un lien.
    SEED.links.forEach(([title, url, body]) => { const a = { id: nid('a'), kind: /youtube\.com|youtu\.be|vimeo\.com/.test(url) ? 'video' : 'link', origin: 'external', title, body, url, fileId: null, createdAt: now(), authorEmail: 'ines@dernier-etage.example', preview: previewFromUrl(url) }; assets.push(a); moodboard.push(a.id); });
    // Leçon « Annoter un montage » (21/10, refaite le 18/11) : le montage « Short SIW Test #1 » de « Dernier Étage » (version d'origine + « Version alternative #2 »,
    // api/demo-client.js : cap-dernier-etage) déjà ajouté au Projet.
    if (opts.seedMontage) {
      const m = { id: nid('a'), kind: 'montage', origin: 'own', title: 'Scène d’ouverture : version A (mélodie) et version B (texture)', body: 'Bureau, photocopieuse, ascenseur, étage sombre : deux musiques sur la même scène. Laquelle garde-t-on ? Images de gameplay : Protocol Interactive, « Something Is Wrong » (en développement), avec leur aimable autorisation.',
        montageId: 'cap-dernier-etage', montageTitle: 'Short SIW Test #1', url: null, fileId: null, createdAt: now(), authorEmail: 'daniel.orcman@example.com', preview: null };
      assets.push(m); moodboard.push(m.id);
    }

    const assetView = a => Object.assign({}, a, {
      pinned: moodboard.includes(a.id), starred: !!a.starred,
      notes: annotations.filter(n => n.targetType === 'asset' && n.targetId === a.id).length,
    });
    const asset = id => assets.find(a => a.id === id);
    const kids = id => sections.filter(s => (s.parentId || null) === (id || null));

    const P = {
      PRIVATE: '__me',
      publicDemo: async () => ok(null),
      demoStatus: async () => ok({ eligible: false }),
      setDemo: async () => ok(null),
      listMine: async () => ok((opts.startEmpty && !created) ? [] : [{ id: project.id, title: project.title, description: project.description, role: 'admin', ownerKind: 'composer', archived: false, updatedAt: project.updatedAt }]),
      create: async (title, description) => { created = true; project.title = title || project.title; project.description = description || ''; activity('project_created', { title: project.title }); return ok(project.id); },
      get: async () => ok(Object.assign({}, project, { role: 'admin', members })),
      update: async (id, title, description) => { project.title = title; project.description = description; project.updatedAt = now(); return ok(null); },
      archive: async (id, archived) => { project.archived = !!archived; return ok(null); },
      remove: async () => ok({ filePaths: [] }),
      content: async () => ok({ assets: assets.map(assetView), moodboard: moodboard.slice(), packs: sharedPacks.map(p => Object.assign({}, p)), albums: [], openAnnotations: annotations.filter(n => !n.resolved).length, autoSnapshot: 'weekly' }),
      markRead: async () => ok(null), markSeen: async () => ok(null),
      appearance: async () => ok(appearance), setAppearance: async (id, p) => { appearance = p || {}; return ok(null); },
      // Membres : invitations simulées (aucun courriel).
      invite: async (id, email) => { members.push({ id: nid('inv'), email, status: 'invited', source: 'guest', role: 'editor', me: false }); return { data: nid('inv'), error: null, emailError: null, actionLink: null }; },
      resendInvite: async () => ok(null), removeMember: async () => ok(null), myInvitations: async () => ok([]), respondInvitation: async () => ok(null),

      // Discussion
      messages: async (id, before, query) => {
        const q = (query || '').trim().toLowerCase();
        const list = messages.filter(m => !q || (m.body || '').toLowerCase().includes(q) || (m.authorEmail || '').toLowerCase().includes(q));
        return ok(list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      },
      post: async (id, body, attachments) => {
        const att = (attachments || []).map(x => { const a = { id: nid('a'), kind: 'file', origin: 'own', title: x.title || '', fileId: x.fileId, createdAt: now(), authorEmail: ME.email, preview: null }; assets.push(a); return { assetId: a.id, kind: a.kind, title: a.title, fileId: a.fileId, fileName: (files[a.fileId] || {}).name, mimeType: (files[a.fileId] || {}).type }; });
        const m = { id: nid('m'), body: body || '', createdAt: now(), editedAt: null, authorId: ME.id, authorEmail: ME.email, mine: true, attachments: att };
        messages.push(m); activity('message', {}); return ok(m.id);
      },
      editMessage: async (mid, body) => { const m = messages.find(x => x.id === mid); if (m) { m.body = body; m.editedAt = now(); } return ok(null); },
      deleteMessage: async mid => { const i = messages.findIndex(x => x.id === mid); if (i >= 0) messages.splice(i, 1); return ok(null); },
      activity: async () => ok(log.slice()),
      notifications: async () => ok([]),

      // Réserve de contenus et Moodboard
      addAsset: async (id, p, pin) => {
        const dup = p.url && assets.find(a => a.url === p.url);
        if (dup) { if (pin && !moodboard.includes(dup.id)) moodboard.push(dup.id); return ok({ id: dup.id, existed: true }); }
        const f = p.fileId ? files[p.fileId] : null;
        const a = { id: nid('a'), kind: p.kind, origin: ['external', 'own', 'layerpitch'].includes(p.origin) ? p.origin : 'own', // comme le vrai serveur title: p.title || '', body: p.body || '', url: p.url || null, fileId: p.fileId || null,
          fileName: f && f.name, fileSize: f && f.size, mimeType: f && f.type, trackId: p.trackId || null, packId: p.packId || null, albumId: p.albumId || null,
          createdAt: now(), authorEmail: ME.email, preview: null };
        assets.push(a); if (pin) moodboard.push(a.id); activity('asset_added', { kind: a.kind, title: a.title });
        return ok({ id: a.id, existed: false });
      },
      updateAsset: async (aid, patch) => { const a = asset(aid); if (a && patch) ['title', 'body', 'url'].forEach(k => { if (k in patch) a[k] = patch[k]; }); return ok(null); },
      deleteAsset: async aid => {
        const i = assets.findIndex(a => a.id === aid); if (i >= 0) assets.splice(i, 1);
        const j = moodboard.indexOf(aid); if (j >= 0) moodboard.splice(j, 1);
        links = links.filter(l => l.assetId !== aid); secPins = secPins.filter(k => k.assetId !== aid);
        return ok(null);
      },
      // Aperçu de lien : préremplis, ou construits depuis l’adresse (pas de fonction serveur dans le tutoriel).
      preview: async aid => { const a = asset(aid); if (!a || !a.url) return ok({ preview: { failed: true } }); a.preview = previewFromUrl(a.url); return ok({ preview: a.preview }); },
      pin: async (aid, pinned) => { const j = moodboard.indexOf(aid); if (pinned && j < 0) moodboard.push(aid); if (!pinned && j >= 0) moodboard.splice(j, 1); return ok(null); },
      star: async (aid, starred) => { const a = asset(aid); if (a) a.starred = !!starred; return ok(null); },
      reorderMoodboard: async (id, ids) => { moodboard.splice(0, moodboard.length, ...ids.filter(x => asset(x))); return ok(null); },
      setAutoSnapshot: async () => ok(null),
      snapshot: async (id, label) => { snapshots.unshift({ id: nid('v'), label: label || '', createdAt: now(), auto: false, assetIds: moodboard.slice() }); return ok(null); },
      snapshots: async () => ok(snapshots.slice()),
      restore: async sid => { const s = snapshots.find(x => x.id === sid); if (s) moodboard.splice(0, moodboard.length, ...s.assetIds.filter(x => asset(x))); return ok(null); },

      // Notes (annotations)
      annotations: async (id, tt, tid) => ok(annotations.filter(n => (!tt || n.targetType === tt) && (!tid || n.targetId === tid))),
      annotate: async (id, targetType, targetId, atSeconds, body, addresseeId, projectUrl, atPart) => {
        const n = { id: nid('n'), targetType, targetId, atSeconds: atSeconds == null ? null : atSeconds, atPart: atPart || null, body, private: addresseeId === '__me', addresseeId: addresseeId && addresseeId !== '__me' ? addresseeId : null,
          resolved: false, createdAt: now(), authorEmail: ME.email, mine: true };
        annotations.push(n); return ok(n.id);
      },
      resolve: async (nid_, resolved) => { const n = annotations.find(x => x.id === nid_); if (n) n.resolved = !!resolved; return ok(null); },
      deleteAnnotation: async nid_ => { const i = annotations.findIndex(x => x.id === nid_); if (i >= 0) annotations.splice(i, 1); return ok(null); },

      // Sections
      sections: async () => ok({ sections: sections.map(s => ({ id: s.id, parentId: s.parentId, title: s.title, position: s.position, mapId: s.mapId || null })), links: links.slice() }),
      createSection: async (id, title, parentId) => { const s = { id: nid('s'), parentId: parentId || null, title, position: kids(parentId).length, mapId: null }; sections.push(s); return ok({ id: s.id }); },
      renameSection: async (sid, title) => { const s = sections.find(x => x.id === sid); if (s) s.title = title; return ok(null); },
      moveSection: async (sid, parentId, position) => { const s = sections.find(x => x.id === sid); if (s) { s.parentId = parentId || null; if (position != null) s.position = position; } return ok(null); },
      deleteSection: async sid => {
        const s = sections.find(x => x.id === sid); if (!s) return ok(null);
        sections.forEach(k => { if (k.parentId === sid) k.parentId = s.parentId; }); // les sous-sections remontent
        sections.splice(sections.indexOf(s), 1);
        links = links.filter(l => l.sectionId !== sid); secPins = secPins.filter(k => k.sectionId !== sid); delete secMessages[sid]; followed.delete(sid);
        return ok(null);
      },
      setAssetSections: async (aid, ids) => { links = links.filter(l => l.assetId !== aid).concat((ids || []).map(sectionId => ({ sectionId, assetId: aid }))); return ok(null); },
      addAssetsToSection: async (sid, aids) => { aids.forEach(assetId => { if (!links.some(l => l.sectionId === sid && l.assetId === assetId)) links.push({ sectionId: sid, assetId }); }); return ok(null); },
      removeAssetsFromSection: async (sid, aids) => { links = links.filter(l => !(l.sectionId === sid && aids.includes(l.assetId))); secPins = secPins.filter(k => !(k.sectionId === sid && aids.includes(k.assetId))); return ok(null); },
      setSectionMap: async (sid, mapId) => { const s = sections.find(x => x.id === sid); if (s) s.mapId = mapId || null; return ok(null); },
      // Moodboard par section : épingles propres à chaque section, sur les mêmes objets.
      sectionPins: async () => ok(secPins.slice()),
      pinInSection: async (sid, aid, pinned) => {
        secPins = secPins.filter(k => !(k.sectionId === sid && k.assetId === aid));
        if (pinned) secPins.push({ sectionId: sid, assetId: aid, position: secPins.filter(k => k.sectionId === sid).length, starred: false });
        return ok(null);
      },
      starSectionPin: async (sid, aid, starred) => { const k = secPins.find(x => x.sectionId === sid && x.assetId === aid); if (k) k.starred = !!starred; return ok(null); },
      reorderSectionPins: async (sid, aids) => { aids.forEach((assetId, i) => { const k = secPins.find(x => x.sectionId === sid && x.assetId === assetId); if (k) k.position = i; }); return ok(null); },
      // Tchat par section
      sectionMessages: async sid => ok((secMessages[sid] || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      postSectionMessage: async (sid, body, attachments) => {
        const att = (attachments || []).map(x => { const a = { id: nid('a'), kind: 'file', origin: 'own', title: x.title || '', fileId: x.fileId, createdAt: now(), authorEmail: ME.email, preview: null }; assets.push(a); links.push({ sectionId: sid, assetId: a.id }); return { assetId: a.id, kind: a.kind, title: a.title, fileId: a.fileId, fileName: (files[a.fileId] || {}).name, mimeType: (files[a.fileId] || {}).type }; });
        const m = { id: nid('m'), body: body || '', createdAt: now(), authorId: ME.id, authorEmail: ME.email, mine: true, attachments: att };
        (secMessages[sid] = secMessages[sid] || []).push(m); followed.add(sid); // écrire dans un canal le suit
        return ok(m.id);
      },
      deleteSectionMessage: async mid => { Object.keys(secMessages).forEach(k => { secMessages[k] = secMessages[k].filter(m => m.id !== mid); }); return ok(null); },
      setSectionFollow: async (sid, follow) => { if (follow) followed.add(sid); else followed.delete(sid); return ok(null); },
      markSectionRead: async () => ok(null),
      sectionChatState: async () => ok([...followed].map(sectionId => ({ sectionId, followed: true, unread: 0 }))),

      // Cartes de niveau
      listMaps: async () => ok(maps.slice()),
      saveMap: async (id, p) => {
        const doc = Object.assign({}, p); const i = maps.findIndex(m => m.id === doc.id);
        if (i >= 0) maps[i] = Object.assign({}, maps[i], doc, { updatedAt: now() }); else { doc.id = doc.id || nid('c'); doc.updatedAt = now(); maps.push(doc); }
        return ok({ id: (i >= 0 ? maps[i] : doc).id });
      },
      deleteMap: async mapId => { const i = maps.findIndex(m => m.id === mapId); if (i >= 0) maps.splice(i, 1); return ok(null); },

      // Musique partagée : rien n’est réellement partagé.
      // Vitrines : gardées dans la page (jamais publiées) ; l'aperçu passe par le navigateur (storePreview).
      vitrines: async () => ok(vitrines.map(v => Object.assign({}, v))), vitrineStats: async () => ok(null), getVitrine: async () => ok(null),
      saveVitrine: async (id, p) => {
        const doc = JSON.parse(JSON.stringify(p)); doc.slug = doc.slug || 'dernier-etage'; doc.secretToken = null;
        const i = vitrines.findIndex(v => v.id === doc.id);
        if (i >= 0) vitrines[i] = Object.assign({}, vitrines[i], doc); else { doc.id = nid('vit'); vitrines.push(doc); }
        const v = i >= 0 ? vitrines[i] : doc;
        await storePreview(v);
        return ok({ id: v.id, slug: v.slug, published: !!v.published });
      },
      deleteVitrine: async vid => { const i = vitrines.findIndex(v => v.id === vid); if (i >= 0) vitrines.splice(i, 1); return ok(null); },
      sharePack: async (id, packId, mode) => { if (!sharedPacks.some(p => p.packId === packId)) sharedPacks.push({ packId, title: PACK_TITLES[packId] || 'Pack', illustration: null, mode: mode || 'share', priceEurCents: null, subscriberCredits: null, mine: true, sharedByEmail: ME.email }); return ok(null); },
      unsharePack: async (id, packId) => { const i = sharedPacks.findIndex(p => p.packId === packId); if (i >= 0) sharedPacks.splice(i, 1); return ok(null); },
      linkAlbum: async () => ok(null),

      // Fichiers : gardés dans le navigateur, jamais envoyés.
      upload: async (id, file, onProgress) => {
        const fileId = nid('f'); files[fileId] = { name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file) };
        if (onProgress) onProgress(1); return ok({ fileId });
      },
      fileUrl: async fileId => (files[fileId] ? ok(files[fileId].url) : { data: null, error: 'Fichier introuvable' }),
      deleteFile: async () => ok(null), eraseStoredFile: async () => {},
    };
    // Tout appel non prévu répond « rien, sans erreur » plutôt que de casser la page.
    return new Proxy(P, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? async () => ok(null) : undefined)) });
  }

  window.LayerPitchDemoProjects = { create, SEED, LINK_PREVIEWS, previewFromUrl, WALK_MAP, SHOWCASE_PITCH, SHOWCASE_LINKS, TUTO_VITRINE_KEY };
})();
