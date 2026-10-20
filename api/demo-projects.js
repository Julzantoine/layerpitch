// api/demo-projects.js — LayerPitch, faux serveur « Projets » du MODE TUTORIEL (projet.html?tuto), 20/10.
//
// Même interface que window.LayerPitchProjects (api/projects.js), mais tout vit en mémoire dans la page : le Projet
// fictif « Alone in the Barque » (discussion, sections, Moodboard) est reconstruit à chaque chargement, on peut y ÉCRIRE
// librement (poster, épingler, ranger, créer des sections…), rien n'est envoyé nulle part, tout repart de zéro au
// rechargement. Les fichiers déposés restent dans le navigateur (adresses locales). Aperçus de liens : la fonction serveur
// link-preview n'existe pas ici ; les aperçus sont préremplis (LINK_PREVIEWS) ou construits à partir de l'adresse.
// Les données de départ (SEED) sont tout en haut, à ajuster librement. Tout ce qui n'est pas géré répond « rien, sans erreur ».
(function () {
  const ME = { id: 'demo-user', email: 'demo@layerpitch.com' };

  // ---------- Données de départ (fil rouge fictif « Alone in the Barque », pastiche assumé) ----------
  const SEED = {
    project: { title: 'Alone in the Barque', description: 'Jeu d’horreur lacustre. Quatre zones (ponton, lac ouvert, brouillard, cabane), une menace qui se rapproche, et un silence comme récompense.' },
    members: [
      { email: 'margaux@barque.example', role: 'admin' },
      { email: 'samir@barque.example', role: 'editor' },
      { email: 'theo@barque.example', role: 'editor' },
    ],
    // [heure d’hier, auteur, texte] — source : scripts/seed-demo-barque.js (discussion fictive).
    messages: [
      ['10:02', 'Margaux', 'Version 1 de la vidéo de gameplay en ligne. C’est la traversée complète, du ponton à la cabane.'],
      ['10:09', 'Samir', 'Je l’ai vue. Le visuel passe bien, mais la musique est plate. Rien ne dit au joueur que le brouillard est dangereux.'],
      ['10:14', 'Théo', 'C’est le morceau générique que j’ai mis en attendant : une seule boucle de deux minutes. Je ne voulais pas l’écrire avant de voir l’image.'],
      ['10:16', 'Margaux', 'Je veux que le joueur sente la menace avant de la voir.'],
      ['10:21', 'Théo', 'Alors je ne propose plus un morceau mais quatre ambiances, une par zone : ponton, lac ouvert, brouillard, cabane. Et des couches qui s’ajoutent quand le monstre se rapproche.'],
      ['10:25', 'Samir', 'Côté jeu, je peux t’envoyer la distance au monstre en continu, de 0 à 100.'],
      ['10:27', 'Théo', 'Parfait, c’est exactement ce qu’il me faut. Les cordes entrent à 40, les basses à 70.'],
      ['10:31', 'Margaux', 'Et la lanterne ? Quand elle vacille, j’aimerais un petit son sec, pas de la musique.'],
      ['10:34', 'Théo', 'Ça, c’est un événement : un effet ponctuel, avec une montée très courte et un retour lent, pour que le joueur reste sur ses gardes après.'],
      ['10:38', 'Samir', 'Et à la cabane, on coupe tout ? Le silence comme récompense.'],
      ['10:40', 'Margaux', 'Oui. Refuge égale feu de bois et un accord de piano, rien d’autre.'],
      ['10:44', 'Théo', 'Je prépare la carte et je te renvoie la vidéo avec la vraie musique : ce sera la version 2.'],
      ['10:46', 'Samir', 'Garde la v1 à côté, qu’on compare les deux d’un coup d’œil.'],
      ['10:49', 'Margaux', 'Validé. On présente la v2 jeudi.'],
    ],
    // Les quatre zones du jeu, comme sections du Projet.
    sections: ['Ponton', 'Lac ouvert', 'Brouillard', 'Cabane'],
    // Notes de Moodboard de départ (au Moodboard général). Les références musicales (liens) sont à déposer par l’apprenant.
    notes: [
      ['Direction sonore', 'La menace se sent avant de se voir. Le silence fait partie de la musique : refuge = feu de bois et un accord de piano.'],
      ['Le lac à minuit', 'Vaste lac noir à minuit, fine brume sur l’eau, pleine lune derrière les nuages, silhouettes de sapins au loin. Tons teal et bleu profond.'],
      ['La lanterne', 'Gros plan sur une vieille lanterne à huile en laiton, lueur ambre, à la proue d’une petite barque en bois.'],
    ],
  };
  // Aperçus de liens préremplis : adresse -> { provider, title, author, thumbnail, embedUrl, embedHeight }. À compléter avec les
  // vraies références (liens fournis par Jules-Antoine). Une adresse absente reçoit un aperçu construit depuis son adresse.
  const LINK_PREVIEWS = {};

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

  function create() {
    let seq = 0;
    const nid = p => (p || 'd') + (++seq);
    const now = () => new Date().toISOString();
    const day = new Date(); day.setDate(day.getDate() - 1);
    const stamp = hhmm => { const [h, m] = hhmm.split(':'); const d = new Date(day); d.setHours(+h, +m, 0, 0); return d.toISOString(); };
    const ok = data => ({ data: data === undefined ? null : data, error: null });
    const log = [];
    const activity = (kind, payload) => log.unshift({ kind, payload: payload || {}, createdAt: now(), actorEmail: ME.email });

    const project = { id: 'demo-barque', title: SEED.project.title, description: SEED.project.description, ownerKind: 'composer', archived: false, createdAt: stamp('09:00'), updatedAt: now() };
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
    const maps = [];
    const snapshots = [];
    let appearance = {};

    const addNote = (title, body, pin) => { const a = { id: nid('a'), kind: 'note', origin: 'board', title, body, url: null, fileId: null, createdAt: now(), authorEmail: ME.email, preview: null }; assets.push(a); if (pin) moodboard.push(a.id); return a; };
    SEED.notes.forEach(([t, b]) => addNote(t, b, true));

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
      listMine: async () => ok([{ id: project.id, title: project.title, description: project.description, role: 'admin', ownerKind: 'composer', archived: false, updatedAt: project.updatedAt }]),
      create: async (title, description) => { project.title = title || project.title; project.description = description || ''; activity('project_created', { title: project.title }); return ok(project.id); },
      get: async () => ok(Object.assign({}, project, { role: 'admin', members })),
      update: async (id, title, description) => { project.title = title; project.description = description; project.updatedAt = now(); return ok(null); },
      archive: async (id, archived) => { project.archived = !!archived; return ok(null); },
      remove: async () => ok({ filePaths: [] }),
      content: async () => ok({ assets: assets.map(assetView), moodboard: moodboard.slice(), packs: [], albums: [], openAnnotations: annotations.filter(n => !n.resolved).length, autoSnapshot: 'weekly' }),
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
        const att = (attachments || []).map(x => { const a = { id: nid('a'), kind: 'file', origin: 'chat', title: x.title || '', fileId: x.fileId, createdAt: now(), authorEmail: ME.email, preview: null }; assets.push(a); return { assetId: a.id, kind: a.kind, title: a.title, fileId: a.fileId, fileName: (files[a.fileId] || {}).name, mimeType: (files[a.fileId] || {}).type }; });
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
        const a = { id: nid('a'), kind: p.kind, origin: p.origin || 'board', title: p.title || '', body: p.body || '', url: p.url || null, fileId: p.fileId || null,
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
        const att = (attachments || []).map(x => { const a = { id: nid('a'), kind: 'file', origin: 'chat', title: x.title || '', fileId: x.fileId, createdAt: now(), authorEmail: ME.email, preview: null }; assets.push(a); links.push({ sectionId: sid, assetId: a.id }); return { assetId: a.id, kind: a.kind, title: a.title, fileId: a.fileId, fileName: (files[a.fileId] || {}).name, mimeType: (files[a.fileId] || {}).type }; });
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
        return ok((i >= 0 ? maps[i] : doc).id);
      },
      deleteMap: async mapId => { const i = maps.findIndex(m => m.id === mapId); if (i >= 0) maps.splice(i, 1); return ok(null); },

      // Vitrines, musique partagée : fermées dans le tutoriel (rien n’est publié ni partagé)
      vitrines: async () => ok([]), vitrineStats: async () => ok(null), getVitrine: async () => ok(null),
      sharePack: async () => ok(null), unsharePack: async () => ok(null), linkAlbum: async () => ok(null),

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

  window.LayerPitchDemoProjects = { create, SEED, LINK_PREVIEWS, previewFromUrl };
})();
