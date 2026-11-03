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

  // ---------- Données de départ (fil rouge fictif « Music City », 02/11 : remplace « Alone in the Barque ») ----------
  // Le jeu de Joshua, mis en musique par le compositeur Daniel (le même que dans les leçons AdReel et album du Backstage) : quatre villes, un seul tempo (110 bpm), et la musique
  // de la série « Jazz Hi/Lo » de Jules-Antoine. Rock City est le carrefour : toutes les rues y mènent.
  const SEED = {
    project: { title: 'Music City', description: 'Jeu d’exploration musicale. Quatre villes (Jazz City, Rock City, Disco City, Synth City), un style par ville, et toute la ville bat au même tempo.' },
    members: [
      { email: 'joshua@musiccity.example', role: 'admin' },
      { email: 'lea@musiccity.example', role: 'editor' },
      { email: 'malik@musiccity.example', role: 'editor' },
      { email: 'daniel.orcman@example.com', role: 'editor' }, // le compositeur
    ],
    // [heure d’hier, auteur, texte] — discussion fictive.
    messages: [
      ['10:02', 'Joshua', 'Version 1 de la vidéo de gameplay en ligne : la balade dans Jazz City, de la rue jusqu’au club.'],
      ['10:09', 'Léa', 'Je l’ai vue. L’image passe bien, mais la musique est plate : quand on entre dans le club, rien ne change.'],
      ['10:14', 'Joshua', 'C’est la musique provisoire. Il faudrait que la ville respire avec le joueur.'],
      ['10:21', 'Daniel', 'Je propose une ambiance par ville, toutes au même tempo pour passer de l’une à l’autre sans casser le rythme. Et dans le club, des couches qui s’ajoutent quand la salle se remplit.'],
      ['10:25', 'Malik', 'Côté jeu, je peux t’envoyer le nombre de clients dans le club, en continu.'],
      ['10:27', 'Daniel', 'Parfait : la contrebasse seule quand c’est vide, la batterie quand ça se remplit, le clavier quand c’est plein.'],
      ['10:31', 'Léa', 'Et au bar ? J’aimerais entendre les glaçons dans les verres.'],
      ['10:34', 'Daniel', 'Ça, c’est un Sfx : il se joue par-dessus la musique, avec une variante différente à chaque fois.'],
      ['10:38', 'Joshua', 'Et Rock City ? C’est le carrefour, toutes les rues y mènent.'],
      ['10:40', 'Léa', 'Je prépare la carte des quatre villes.'],
      ['10:44', 'Daniel', 'Je pose la vraie musique sur la vidéo : ce sera la version 2.'],
      ['10:46', 'Malik', 'Garde la v1 à côté, qu’on compare les deux d’un coup d’œil.'],
      ['10:49', 'Joshua', 'Validé. On présente la v2 jeudi.'],
    ],
    // Les quatre villes du jeu, comme sections du Projet.
    sections: ['Jazz City', 'Rock City', 'Disco City', 'Synth City'],
    // Notes de Moodboard de départ (au Moodboard général).
    notes: [
      ['Direction sonore', 'Un tempo pour toute la ville (110 bpm), un style par quartier. On passe d’une ville à l’autre sans jamais casser le rythme.'],
      ['Jazz City la nuit', 'Rues mouillées, enseignes au néon bleu et ambre, saxophone qui s’échappe d’une porte entrouverte.'],
      ['Le club', 'Petite salle en sous-sol, scène au fond, bar en cuivre. Plus la salle se remplit, plus l’orchestre s’étoffe.'],
    ],
    // Références musicales déjà épinglées au Moodboard (liens vérifiés le 02/11). Les autres se déposent pendant la leçon (LESSON_LINKS).
    links: [
      ['Banjo-Kazooie : Gruntilda’s Lair', 'https://www.youtube.com/watch?v=O5yOvsl0ftQ', 'Le même thème change d’instruments selon la zone, sans couper : notre idée d’une ville, un tempo, un style par quartier.'],
      ['Cuphead : l’enregistrement de « Floral Fury »', 'https://www.youtube.com/watch?v=v6h1vM9W2NM', 'Big band jazz enregistré en live : la couleur de Jazz City et du club.'],
    ],
  };
  // Leçons Vitrine (02/11) : images tirées des clips de la vidéo de gameplay, la vidéo elle-même et deux morceaux favoris (★, repris
  // d'office par le bloc « Morceaux » d'une nouvelle vitrine). Fichiers dans media.layerpitch.com/tuto/music-city/.
  const MC_DIR = 'https://media.layerpitch.com/tuto/music-city/';
  const SHOWCASE_IMAGES = [['La rue de Jazz City, la nuit', 'rue.jpg'], ['L’escalier du club', 'escalier.jpg'], ['Dans le club', 'club.jpg'], ['La scène', 'scene.jpg']]
    .map(([title, file]) => ({ title, name: file, url: MC_DIR + file }));
  const SHOWCASE_VIDEO = { title: 'Music City : de la rue au club (gameplay)', name: 'music-city-gameplay-musique1.mp4', url: 'https://media.layerpitch.com/tuto/music-city-gameplay-musique1.mp4' };
  const SHOWCASE_TRACKS = [['bmvilh6aprhhug', 'Jazz Hi Static'], ['bmvidtfhvfa5tt', 'Jazz Hi Lay. Add.']];
  const SHOWCASE_PITCH = 'Music City est un jeu d’exploration musicale. Tu traverses quatre villes, Jazz City, Rock City, Disco City et Synth City : la musique change de style à chaque quartier, sans jamais perdre le tempo.';
  // Vitrine « déjà construite » (leçon apparence) : le résultat de la leçon « construire ».
  const SHOWCASE_LINKS = ['https://www.instagram.com/musiccity.exemple', 'https://store.steampowered.com/search/?term=music%20city%20exemple'];
  const TUTO_VITRINE_KEY = 'layerpitch_tuto_vitrine_v1'; // aperçu : lu par vitrine.html?tuto

  // Carte de la balade : celle de Jules-Antoine (Projet réel « Music City », 02/11), recopiée telle quelle.
  const WALK_MAP = {"edges":[{"id":"emvzsj6ph03ug","to":"n3","from":"n1","enemy":false,"label":"","sounds":{"main":[],"room":[],"combat":[]},"transition":null},{"id":"e3","to":"n4","from":"n3","enemy":false,"label":"","sounds":{"main":[{"id":"bmvzsfnd1c3n9o","kind":"track","title":"Street+Footsteps"}],"room":[],"combat":[]},"transition":null},{"id":"e4","to":"n5","from":"n3","enemy":false,"label":"","sounds":{"main":[{"id":"bmvzsfnd1c3n9o","kind":"track","title":"Street+Footsteps"}],"room":[],"combat":[]},"transition":null}],"nodes":[{"x":-240,"y":0,"id":"n1","note":"","side":false,"type":"start","label":"Jazz City","anchor":null,"sounds":{"main":[{"id":"bmvill7tqkvevl","kind":"track","title":"Jazz Lo Static"}],"room":[],"combat":[]},"transition":null},{"x":0,"y":0,"id":"n3","note":"","side":false,"type":"place","label":"Rock City","anchor":null,"sounds":{"main":[{"id":"bmvzs0mx1ifoqg","kind":"track","title":"Jazz Hi Rock City 4M 110bpm"}],"room":[],"combat":[]},"transition":null},{"x":260,"y":-110,"id":"n4","note":"La boîte de nuit de Disco City : sa carte est au niveau 2.","side":false,"type":"place","label":"Disco City","anchor":null,"sounds":{"main":[{"id":"bmvzrzt5b2xy8n","kind":"track","title":"Jazz Hi Disco City"}],"room":[],"combat":[]},"transition":null},{"x":260,"y":110,"id":"n5","note":"","side":false,"type":"place","label":"Synth City","anchor":null,"sounds":{"main":[{"id":"bmvzs1ea70wix6","kind":"track","title":"Jazz Hi Synth city"}],"room":[],"combat":[]},"transition":null}],"defaults":{"transition":{"sec":2,"sync":"bar","style":"crossfade"}},"roomTone":{"id":"bmvzsorsis6wyd","kind":"track","title":"City Birds"},"roomToneDb":-14};

  // Aperçus de liens préremplis : adresse -> { provider, title, author, thumbnail, embedUrl, embedHeight }. Une adresse absente reçoit
  // un aperçu construit depuis son adresse.
  const LINK_PREVIEWS = {
    'https://www.youtube.com/watch?v=O5yOvsl0ftQ': { provider: 'youtube', title: 'Gruntilda’s Lair (Medley)', author: 'Banjo-Kazooie, Grant Kirkhope', thumbnail: 'https://i.ytimg.com/vi/O5yOvsl0ftQ/hqdefault.jpg', embedUrl: 'https://www.youtube-nocookie.com/embed/O5yOvsl0ftQ' },
    'https://www.youtube.com/watch?v=v6h1vM9W2NM': { provider: 'youtube', title: 'The Music of Cuphead: Recording Floral Fury', author: 'Studio MDHR', thumbnail: 'https://i.ytimg.com/vi/v6h1vM9W2NM/hqdefault.jpg', embedUrl: 'https://www.youtube-nocookie.com/embed/v6h1vM9W2NM' },
    'https://www.youtube.com/watch?v=O2i1Vq3Odbg': { provider: 'youtube', title: 'Hi-Fi RUSH | Launch Trailer', author: 'Xbox', thumbnail: 'https://i.ytimg.com/vi/O2i1Vq3Odbg/hqdefault.jpg', embedUrl: 'https://www.youtube-nocookie.com/embed/O2i1Vq3Odbg' },
    'https://open.spotify.com/album/4pJT0WKggr4xk149X8A6KC': { provider: 'spotify', title: 'PERSONA5 ORIGINAL SOUNDTRACK', author: 'ATLUS Sound Team', embedUrl: 'https://open.spotify.com/embed/album/4pJT0WKggr4xk149X8A6KC', embedHeight: 352 },
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

    const project = { id: 'demo-music-city', title: SEED.project.title, description: SEED.project.description, ownerKind: 'composer', archived: false, createdAt: stamp('09:00'), updatedAt: now() };
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
    const PACK_TITLES = { 'p-music-city': 'Music City : le club de jazz (exemple)' };
    const sharedPacks = [{ packId: 'p-cities', title: 'Music City : les quatre villes (pack de Daniel)', illustration: null, mode: 'share', priceEurCents: null, subscriberCredits: null, mine: false, sharedByEmail: 'daniel.orcman@example.com' }];
    const maps = [];
    // Leçons « musique » (opts.seedMap) et « balade » (opts.seedMapMusic) : la carte de Jules-Antoine (WALK_MAP), sans ses sons pour la
    // leçon « musique » (on les y pose un à un), complète pour la balade ; ses morceaux sont dans api/demo-client.js (DEMO_TRACKS_CITY_MAP).
    if (opts.seedMap || opts.seedMapMusic) {
      const data = JSON.parse(JSON.stringify(WALK_MAP));
      if (!opts.seedMapMusic) { data.nodes.concat(data.edges).forEach(x => { x.sounds = { main: [], room: [], combat: [] }; }); data.roomTone = null; }
      maps.push({ id: 'map-music-city', title: 'Music City', updatedAt: now(), data });
    }
    const snapshots = [];
    let appearance = {};
    // Leçons Vitrine (opts.seedVitrine) : images, vidéo de gameplay et morceaux favoris dans la réserve ; opts.seedVitrineBuilt ajoute
    // la vitrine déjà construite (leçon « apparence »).
    const vitrines = [];
    if (opts.seedVitrine || opts.seedVitrineBuilt) {
      const fileAsset = (kind, f, mime) => { const fileId = nid('f'); files[fileId] = { name: f.name, size: 0, type: mime, url: f.url };
        const a = { id: nid('a'), kind, origin: 'own', title: f.title, body: '', url: null, fileId, fileName: f.name, mimeType: mime, createdAt: now(), authorEmail: 'lea@musiccity.example', preview: null }; assets.push(a); return a; };
      const imgs = SHOWCASE_IMAGES.map(f => fileAsset('image', f, 'image/jpeg'));
      const vid = fileAsset('video', SHOWCASE_VIDEO, 'video/mp4');
      const trk = SHOWCASE_TRACKS.map(([trackId, title]) => { const a = { id: nid('a'), kind: 'track', origin: 'own', title, trackId, starred: true, createdAt: now(), authorEmail: 'daniel.orcman@example.com', preview: null }; assets.push(a); return a; });
      if (opts.seedVitrineBuilt) vitrines.push({ id: 'vit-music-city', audience: 'players', display: 'page', title: 'Music City', subtitle: 'Quatre villes, un tempo : la ville qui joue avec toi.', slug: 'music-city',
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
    SEED.links.forEach(([title, url, body]) => { const a = { id: nid('a'), kind: /youtube\.com|youtu\.be|vimeo\.com/.test(url) ? 'video' : 'link', origin: 'external', title, body, url, fileId: null, createdAt: now(), authorEmail: 'lea@musiccity.example', preview: previewFromUrl(url) }; assets.push(a); moodboard.push(a.id); });
    // Leçon « Annoter un montage » (21/10) : le montage de « Music City » (deux musiques, api/demo-client.js : cap-music-city) déjà ajouté au Projet.
    if (opts.seedMontage) {
      const m = { id: nid('a'), kind: 'montage', origin: 'own', title: 'Music City : de la rue au club', body: 'Deux musiques sur la même scène : laquelle garde-t-on ?',
        montageId: 'cap-music-city', montageTitle: 'Music City : de la rue au club', url: null, fileId: null, createdAt: now(), authorEmail: 'daniel.orcman@example.com', preview: null };
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
        const doc = JSON.parse(JSON.stringify(p)); doc.slug = doc.slug || 'music-city'; doc.secretToken = null;
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
