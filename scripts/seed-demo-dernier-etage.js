#!/usr/bin/env node
/**
 * LayerPitch — crée et remplit le Projet de démo « Dernier Étage » (jeu d'horreur psychologique sur le burn-out en entreprise),
 * construit autour du montage vidéo « Short SIW Test #1 » et de sa « Version alternative #2 » (A : avec mélodie, B : purement texturale).
 * Tout est fictif : la discussion (14 messages sous le nom du propriétaire, chacun préfixé par le personnage), 4 sections,
 * un Moodboard de 4 objets (note, montage, vidéo YouTube, référence graphique), 6 tâches. Le montage est posé en objet du Projet (ses versions suivent toutes seules).
 * Relançable sans doublon. N'active PAS « Démo publique » : c'est le propriétaire qui l'active.
 *
 * Usage : node scripts/seed-demo-dernier-etage.js            (aperçu : n'écrit rien)
 *         node scripts/seed-demo-dernier-etage.js --essai    (fait tout pour de vrai dans une transaction, puis annule : vérifie que ça passe)
 *         node scripts/seed-demo-dernier-etage.js --apply    (écrit dans la base de .env : SUPABASE_DB_URL)
 */
const fs = require('fs');
const path = require('path');

const TITLE = 'Dernier Étage';
const STEAM = 'https://store.steampowered.com/app/3895130/Something_is_wrong/';
const CREDIT = 'Ce Projet est fictif : il a été imaginé pour la démonstration de LayerPitch. Les images de gameplay sont fournies avec l\'aimable autorisation de Protocol Interactive (Joris Balzanelli et Samir Bensadoun), développeurs de « Something Is Wrong », un jeu actuellement en développement. Merci à eux : allez voir leur jeu sur Steam, ' + STEAM + '.';
const DESCRIPTION = 'Projet fictif : jeu d\'horreur psychologique sur le burn-out en entreprise. Images de gameplay : Protocol Interactive, « Something Is Wrong » (en développement), avec leur aimable autorisation. Steam : ' + STEAM;
const MONTAGE_ID = '28151565-0d5c-499f-bb58-32467da87ab4'; // capture « Short SIW Test #1 » (version A) ; la version B est « Version alternative #2 »

// Auteurs fictifs : Inès (direction artistique), Karim (game design), Théo (compositeur, le propriétaire du Projet).
const MESSAGES = [
  ['10:02', 'Inès', 'Première scène en ligne : O. traverse l\'open space jusqu\'à la photocopieuse, puis monte à l\'étage sombre et finit dans la salle d\'archives. C\'est le montage « Short SIW ».'],
  ['10:08', 'Karim', 'Je l\'ai vue. Les piles de dossiers partout, ça dit déjà tout : personne ne range, personne ne part. Et la musique ?'],
  ['10:12', 'Théo', 'J\'ai préparé deux versions de la musique. A : une mélodie douce posée sur les couches. B : aucune mélodie, juste de la texture. Je voulais qu\'on les compare sur la même image.'],
  ['10:15', 'Inès', 'Dans le bureau, je veux que ça sonne presque normal. Un quotidien qui tient debout, mais un peu trop propre.'],
  ['10:19', 'Théo', 'C\'est la version A pour la première partie : la mélodie rassure, comme le bureau. Les couches arrivent au fil des déplacements : une quand O. passe à la photocopieuse, une autre quand elle reprend son document.'],
  ['10:24', 'Karim', 'Et quand elle prend l\'ascenseur ? Je voudrais que le joueur sente qu\'il n\'y a plus de retour en arrière.'],
  ['10:27', 'Théo', 'Un effet ponctuel à l\'ouverture des portes, et la musique du bureau s\'arrête net. Ensuite un drone seul, pour tout l\'étage sombre.'],
  ['10:31', 'Inès', 'J\'aime ça. Le silence du bureau qui disparaît, c\'est exactement ce que je veux montrer : le moment où ce n\'est plus le travail, c\'est la tête.'],
  ['10:36', 'Karim', 'Version B sur la même scène, alors. Sans mélodie, le joueur n\'a plus rien pour se raccrocher, même au bureau. Ça change la lecture.'],
  ['10:40', 'Théo', 'Oui. A rassure puis lâche. B inquiète dès le premier pas. Je les ai rangées côte à côte dans le montage, tu peux basculer de l\'une à l\'autre.'],
  ['10:45', 'Inès', 'Dans la salle d\'archives, vide et dans le noir, quand O. trouve la lampe : je ne veux presque rien entendre. Un grésillement, un souffle.'],
  ['10:49', 'Karim', 'Et la lampe est aussi un objet de jeu : elle éclaire un rayon de plus en plus court, comme le temps qui reste. Je te donnerai une valeur de 0 à 100 pour la batterie.'],
  ['10:53', 'Théo', 'Parfait : plus la batterie baisse, plus la texture se resserre. Je prépare la carte du niveau avec les trois zones : bureau, étage sombre, archives.'],
  ['10:58', 'Inès', 'Validé. On garde les deux versions de l\'ouverture pour le test joueurs de jeudi.'],
];

const SECTIONS = ['Direction artistique', 'Musique : mélodie ou texture ?', 'Bruitages du bureau', 'Scènes clés'];

// Moodboard : peu de notes, le reste en références (liens). La vidéo est tout en haut.
const NOTES = [
  ['À propos de cette démo : projet fictif et crédits', CREDIT],
];
// Notes d'ébauche d'une première version du script : retirées du Moodboard si elles y sont encore.
const HIROSHIMA = 'https://www.youtube.com/watch?v=p9xAjiZo7go'; // référence retirée du Moodboard
const RETIRED_NOTES = ['Les dossiers partout', 'La photocopieuse', 'Le document à porter', 'L\'ascenseur', 'L\'étage sombre', 'La salle d\'archives',
  'Idée : mélodie qui rassure', 'Idée : texture sans mélodie', 'Le mail non lu',
  // 18/11 : le Moodboard de démo ne garde que 4 objets (note, montage, vidéo YouTube, référence graphique)
  'Un bureau trop propre', 'La lampe', 'Le bourdonnement des néons'];
const RETIRED_URLS = [HIROSHIMA, STEAM, 'https://www.youtube.com/watch?v=Z_Cc20I-maM', 'https://en.wikipedia.org/wiki/Severance_(TV_series)',
  'https://en.wikipedia.org/wiki/Control_(video_game)', 'https://en.wikipedia.org/wiki/Playtime_(film)'];

// Références : musicales (YouTube, lisibles dans le Projet) et graphiques / ambiance (pages web).
const REFS = [
  ['https://www.youtube.com/watch?v=aM_HhU_CV44', 'Réf. musicale : Hildur Guðnadóttir, « Bridge of Death » (Chernobyl)', 'Une bande-son faite de sons enregistrés dans une vraie centrale : pas de mélodie, une texture industrielle. Proche de la version B.'],
  ['https://en.wikipedia.org/wiki/Office_at_Night', 'Réf. graphique : Edward Hopper, « Office at Night »', 'Une lumière froide, deux personnes dans un bureau qui ne se parlent pas. Le malaise par le cadrage.'],
];

// Pack de démo : un NOUVEAU pack qui réutilise les mêmes morceaux et Sfx que le pack « Joris » (rien n'est copié : modifier un morceau
// ici le modifie aussi dans « Joris »). On y ajoute « Dynamic Edition Alt2 » (version B de la vidéo), absent du pack d'origine.
const PACK_ID = 'dernier-etage-demo';
const PACK_TITLE = 'Dernier Etage_Démo';
const SOURCE_PACK_ID = 'bmw3dygpiyvnq5'; // pack « Joris »
const EXTRA_TRACK_IDS = ['bmwf5gpcfqqjyd']; // Welcome to the Office Dynamic Edition Alt2

// Carte de niveau fictive (sans musique : le propriétaire dépose ses sons lui-même). Quatre zones : bureau, couloir, archives, salle secrète.
const MAP_TITLE = 'Niveau 1 : le bureau, le couloir, les archives';
const S0 = () => ({ main: [], combat: [], room: [] });
const zone = (id, label, note, x, y, w, h, color) => ({ id, label, note, shape: 'rect', x, y, w, h, points: [], color, keepMusic: false, sounds: S0(), transition: null, link: null });
const node = (id, type, label, x, y, note) => Object.assign({ id, type, label, x, y, note: note || '', sounds: S0(), transition: null }, type === 'quest' ? { side: false, anchor: null } : {});
const edge = (id, from, to, label) => ({ id, from, to, label: label || '', enemy: false, sounds: S0(), transition: null });
const LEVEL_MAP = {
  nodes: [
    node('poste', 'start', 'Poste de travail', 90, 250, 'O. commence ici, au milieu des piles de dossiers.'),
    node('photocop', 'place', 'Photocopieuse', 230, 130, 'Le son régulier qui rythme la journée. O. y prend un document.'),
    node('bureauchef', 'place', 'Bureau où apporter le document', 290, 250, 'Le petit enjeu qui fait tout peser.'),
    node('ascenseur', 'place', 'Ascenseur', 385, 200, 'Seule sortie. À l\'ouverture des portes, la musique du bureau s\'arrête.'),
    node('couloir', 'place', 'Couloir sombre', 500, 200, 'On déambule, lumières éteintes. Un seul drone.'),
    node('archives', 'place', 'Salle d\'archives', 740, 200, 'Vide et dans le noir. Des étagères nues.'),
    node('lampe', 'treasure', 'La lampe', 830, 120, 'Première lumière du niveau. Elle éclaire de moins en moins loin.'),
    node('porte', 'place', 'Porte dissimulée', 800, 330, 'Derrière la dernière étagère, une porte qu\'on n\'avait pas vue.'),
    node('secrete', 'place', 'Salle secrète', 780, 440, 'Ce que le bureau ne montre pas.'),
  ],
  edges: [
    edge('e1', 'poste', 'photocop'), edge('e2', 'photocop', 'bureauchef'), edge('e3', 'bureauchef', 'ascenseur'),
    edge('e4', 'ascenseur', 'couloir'), edge('e5', 'couloir', 'archives'), edge('e6', 'archives', 'lampe'),
    edge('e7', 'archives', 'porte'), edge('e8', 'porte', 'secrete'),
  ],
  zones: [
    zone('z-bureau', 'Bureau', 'Open space, lumières froides, piles de dossiers partout.', 40, 60, 360, 260, '#2f80c0'),
    zone('z-couloir', 'Couloir', 'L\'étage sombre où l\'on déambule.', 410, 150, 220, 100, '#5f6b7a'),
    zone('z-archives', 'Salle d\'archives', 'Vide et dans le noir.', 640, 60, 260, 270, '#b8862e'),
    zone('z-secrete', 'Salle secrète', 'Accessible seulement depuis les archives.', 680, 360, 200, 170, '#7a5cc0'),
  ],
  modes: [], background: null, roomTone: null, roomToneDb: -14,
  defaults: { transition: { style: 'crossfade', sec: 2, sync: 'bar' } },
};

// Ordre du Moodboard : crédit, vidéo, puis en alternance musique / image / note. [type, clé]
const MOODBOARD_ORDER = [
  ['note', 'À propos de cette démo : projet fictif et crédits'],
  ['montage', MONTAGE_ID],
  ['url', 'https://www.youtube.com/watch?v=aM_HhU_CV44'],          // musique : Chernobyl
  ['url', 'https://en.wikipedia.org/wiki/Office_at_Night'],        // image : Hopper
];

// [titre, notes, fait ?, section (index ou null)]
const TASKS = [
  ['Choisir A ou B pour l\'ouverture du jeu', 'Test joueurs jeudi : les deux versions, même vidéo.', false, 1],
  ['Écrire la version B sur toute la scène du bureau', 'Garder uniquement les textures, aucune mélodie.', true, 1],
  ['Caler le son de l\'ascenseur', 'À l\'ouverture des portes, couper la musique du bureau.', true, 2],
  ['Poser le drone de l\'étage sombre', 'Un seul drone sur toute la déambulation.', false, 3],
  ['Concevoir le son de la lampe', 'Grésillement et souffle ; la texture se resserre quand la batterie baisse.', false, 2],
  ['Préparer la carte du niveau', 'Trois zones : bureau, étage sombre, archives.', false, 0],
];

// Vitrines fictives : une publique (joueurs, adresse libre) et une « éditeur » (lien secret, sans compte).
const VITRINES = [
  { audience: 'players', title: 'Dernier Étage', subtitle: 'Un jeu d\'horreur psychologique : le burn-out, étage par étage.',
    blocks: [
      { type: 'header' },
      { type: 'text', title: 'Le pitch', align: 'left', content: 'Vous êtes employé(e) dans une tour de bureaux qui ne ferme jamais. Les dossiers s\'empilent, les néons bourdonnent, et chaque étage est un peu plus sombre que le précédent. Il faut monter jusqu\'au dernier étage, là où personne ne va. Un jeu à l\'ambiance lente, où la musique ne dit pas quoi ressentir : elle suit votre fatigue.' },
      { type: 'packs', packTitle: PACK_TITLE },
      { type: 'text', title: 'Merci à Protocol Interactive', align: 'left', content: 'Cette vitrine est fictive. Les images de gameplay sont fournies avec l\'aimable autorisation de Protocol Interactive (Joris Balzanelli et Samir Bensadoun), développeurs de « Something Is Wrong », actuellement en développement. Allez voir leur jeu !' },
      { type: 'links', links: [{ label: 'Something Is Wrong sur Steam', url: STEAM }] },
    ] },
  { audience: 'publisher', title: 'Dernier Étage : dossier pour éditeur', subtitle: 'Direction sonore et plan de production',
    blocks: [
      { type: 'header' },
      { type: 'text', title: 'Intention sonore', align: 'left', content: 'Deux pistes testées sur la même scène d\'ouverture : une version avec mélodie, une version purement texturale. Notre recommandation : la texture. Un drone continu, une lampe qui grésille, un bourdonnement de néons qui se resserre quand la batterie baisse. La mélodie est gardée pour un seul moment, quand la lampe s\'allume.' },
      { type: 'text', title: 'Où on en est', align: 'left', content: 'Scène d\'ouverture montée sur les deux versions. Carte du niveau dessinée (bureau, couloir, archives, salle secrète), musiques à poser. Six tâches ouvertes, dont deux déjà faites.' },
      { type: 'packs', packTitle: PACK_TITLE },
      { type: 'links', links: [{ label: 'Something Is Wrong sur Steam (images de gameplay, avec autorisation)', url: STEAM }] },
      { type: 'contact' },
    ] },
];

// q(sql, args) -> lignes. Exporté pour pouvoir tester le script sur la base jetable des tests.
async function seed(q, apply, ownerOverride) {
  const [mont] = await q(`select c.id, c.title, cp.profile_id as uid from public.video_captures c join public.composer_profiles cp on cp.id = c.owner_id where c.id = $1`, [MONTAGE_ID]);
  if (!mont) throw new Error('Montage « Short SIW Test #1 » introuvable. Rien n\'a été écrit.');
  const uid = ownerOverride || mont.uid;
  const asOwner = async () => {
    await q(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('test.uid', $2, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' }), uid]);
  };

  let [project] = await q(`select id from public.projects where title = $1 and owner_profile_id = $2 and archived_at is null`, [TITLE, uid]);
  const added = { pack: 0, packAsset: 0, map: 0, project: 0, sections: 0, messages: 0, notes: 0, tasks: 0, montage: 0 };
  if (!project) {
    added.project = 1;
    if (!apply) { console.log(`À créer : le Projet « ${TITLE} » (aperçu, rien écrit).`); }
    else {
      await asOwner();
      project = { id: (await q(`select public.create_project($1, $2, false) as id`, [TITLE, DESCRIPTION]))[0].id };
    }
  } else console.log(`Projet déjà présent : « ${TITLE} ».`);

  const pid = project && project.id;
  const count = async (sql, args) => pid ? (await q(sql, args))[0].n : 0;

  // Sections
  const sectionIds = [];
  for (const title of SECTIONS) {
    const [row] = pid ? await q(`select id from public.project_sections where project_id = $1 and title = $2`, [pid, title]) : [];
    if (row) { sectionIds.push(row.id); continue; }
    added.sections++;
    if (!apply) { sectionIds.push(null); continue; }
    await asOwner();
    sectionIds.push((await q(`select public.create_project_section($1, $2) as r`, [pid, title]))[0].r.id);
  }

  // Messages
  const day = new Date(); day.setDate(day.getDate() - 1);
  const stamp = hhmm => { const [h, m] = hhmm.split(':'); const d = new Date(day); d.setHours(+h, +m, 0, 0); return d.toISOString(); };
  for (const [time, who, text] of MESSAGES) {
    const body = `${who} : ${text}`;
    if (await count(`select count(*)::int n from public.project_messages where project_id = $1 and body = $2`, [pid, body])) continue;
    added.messages++;
    if (!apply) continue;
    await asOwner();
    const id = (await q(`select public.post_project_message($1, $2) as id`, [pid, body]))[0].id;
    await q(`update public.project_messages set created_at = $2 where id = $1`, [id, stamp(time)]);
  }

  // Notes de Moodboard (épinglées)
  for (const [title, body] of NOTES) {
    if (await count(`select count(*)::int n from public.project_assets where project_id = $1 and kind = 'note' and title = $2`, [pid, title])) continue;
    added.notes++;
    if (!apply) continue;
    await asOwner();
    await q(`select public.add_project_asset($1, $2::jsonb, true)`, [pid, JSON.stringify({ kind: 'note', title, body })]);
  }

  // Retrait des notes d'ébauche (seulement avec --apply : l'aperçu n'écrit rien)
  if (pid && apply) {
    const del = await q(`delete from public.project_assets where project_id = $1 and ((kind = 'note' and title = any($2::text[])) or url = any($3::text[])) returning id`, [pid, RETIRED_NOTES, RETIRED_URLS]);
    if (del.length) console.log(`Notes d'ébauche retirées : ${del.length}.`);
  }

  // Références musicales et graphiques (dont le lien Steam du jeu)
  for (const [url, title, body] of REFS) {
    if (await count(`select count(*)::int n from public.project_assets where project_id = $1 and url = $2`, [pid, url])) continue;
    added.notes++;
    if (!apply) continue;
    await asOwner();
    await q(`select public.add_project_asset($1, $2::jsonb, true)`, [pid, JSON.stringify({ kind: 'link', url, title, body })]);
  }

  // Le montage vidéo (A et B suivent : les versions sont celles du montage)
  if (!await count(`select count(*)::int n from public.project_assets where project_id = $1 and montage_id = $2`, [pid, MONTAGE_ID])) {
    added.montage++;
    if (apply) {
      await asOwner();
      const r = (await q(`select public.add_project_asset($1, $2::jsonb, true) as r`, [pid, JSON.stringify({ kind: 'montage', montageId: MONTAGE_ID, title: 'Scène d\'ouverture : version A (mélodie) et version B (texture)', body: 'Le montage « Short SIW » : bureau, photocopieuse, ascenseur, étage sombre, salle d\'archives. Bascule entre la version A, avec mélodie, et la version B, purement texturale. Images de gameplay : Protocol Interactive, « Something Is Wrong » (en développement), avec leur aimable autorisation.' })]))[0].r;
      const musique = sectionIds[1];
      if (musique) await q(`select public.pin_asset_in_section($1, $2, true)`, [musique, r.id]);
    }
  }

  // Ordre du Moodboard
  if (pid && apply) {
    for (let i = 0; i < MOODBOARD_ORDER.length; i++) {
      const [type, key] = MOODBOARD_ORDER[i];
      const col = type === 'note' ? `kind = 'note' and title` : type === 'montage' ? 'montage_id' : 'url';
      await q(`update public.project_moodboard_pins set position = $2 where project_id = $1 and asset_id = (select id from public.project_assets where project_id = $1 and ${col} = $3)`, [pid, i, key]);
    }
  }

  // Pack de démo (mêmes morceaux que « Joris »), puis posé dans l'onglet Musique du Projet
  {
    const [src] = await q(`select bg_color, text_color, font, tags from public.packs where id = $1`, [SOURCE_PACK_ID]);
    const [exists] = await q(`select id from public.packs where id = $1`, [PACK_ID]);
    if (!src) throw new Error('Pack « Joris » introuvable. Rien n\'a été écrit.');
    if (!exists) {
      added.pack = 1;
      if (apply) {
        const tracks = (await q(`select track_id from public.pack_tracks where pack_id = $1 order by position`, [SOURCE_PACK_ID])).map(r => r.track_id);
        for (const t of EXTRA_TRACK_IDS) if (!tracks.includes(t)) tracks.push(t);
        const sfx = (await q(`select sfx_id from public.pack_sfx where pack_id = $1 order by position`, [SOURCE_PACK_ID])).map(r => r.sfx_id);
        await asOwner();
        await q(`select public.upsert_pack($1::jsonb)`, [JSON.stringify({ id: PACK_ID, title: PACK_TITLE, bgColor: src.bg_color, textColor: src.text_color, font: src.font, tags: src.tags || [], trackIds: tracks, sfxIds: sfx })]);
      }
    }
    if (pid && apply && !await count(`select count(*)::int n from public.project_assets where project_id = $1 and pack_id = $2`, [pid, PACK_ID])) {
      added.packAsset = 1;
      await asOwner();
      await q(`select public.add_project_asset($1, $2::jsonb, false)`, [pid, JSON.stringify({ kind: 'pack', packId: PACK_ID, title: PACK_TITLE, body: 'Les morceaux et Sfx de la scène d\'ouverture : les deux versions de la musique (A avec mélodie, B texturale), les drones et les bruitages.' })]);
    }
  }

  // Carte de niveau fictive
  if (!await count(`select count(*)::int n from public.project_maps where project_id = $1 and title = $2`, [pid, MAP_TITLE])) {
    added.map = 1;
    if (apply) {
      await asOwner();
      await q(`select public.save_project_map($1, $2::jsonb)`, [pid, JSON.stringify({ title: MAP_TITLE, data: LEVEL_MAP })]);
    }
  }

  // Vitrines fictives (une publique, une éditeur)
  for (const v of VITRINES) {
    if (await count(`select count(*)::int n from public.project_vitrines where project_id = $1 and audience = $2`, [pid, v.audience])) continue;
    added.vitrines = (added.vitrines || 0) + 1;
    if (!apply) continue;
    await asOwner();
    const packAsset = (await q(`select a.id from public.project_assets a where a.project_id = $1 and a.kind = 'pack' and a.pack_id = $2`, [pid, PACK_ID]))[0];
    const blocks = v.blocks.map((b, i) => {
      const o = Object.assign({ id: 'vb' + (i + 1) }, b); delete o.packTitle;
      if (b.type === 'packs') o.assetIds = packAsset ? [packAsset.id] : [];
      return o;
    });
    await q(`select public.save_project_vitrine($1, $2::jsonb)`, [pid, JSON.stringify({ audience: v.audience, display: 'page', title: v.title, subtitle: v.subtitle, published: true, theme: {}, blocks })]);
  }

  // Tâches
  for (const [title, notes, done, sec] of TASKS) {
    if (await count(`select count(*)::int n from public.project_tasks where project_id = $1 and title = $2`, [pid, title])) continue;
    added.tasks++;
    if (!apply) continue;
    await asOwner();
    const id = (await q(`select public.create_project_task($1, $2::jsonb) as r`, [pid, JSON.stringify({ title, notes, sectionId: sectionIds[sec] })]))[0].r.id;
    if (done) await q(`update public.project_tasks set done = true, done_at = now(), done_by = $2 where id = $1`, [id, uid]);
  }

  console.log(`${apply ? 'Ajoutés' : 'À ajouter (aperçu, rien écrit)'} : ${added.project} projet, ${added.sections} section(s), ${added.messages} message(s), ${added.notes} note(s), ${added.montage} montage, ${added.map} carte, ${added.pack} pack, ${added.tasks} tâche(s).`);
  return { added, projectId: pid };
}

module.exports = { seed, LEVEL_MAP, MAP_TITLE, TITLE, MESSAGES, SECTIONS, NOTES, TASKS, MONTAGE_ID };

if (require.main === module) {
  (async () => {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
    if (!process.env.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL manquant dans .env'); process.exit(1); }
    const apply = process.argv.includes('--apply');
    const essai = process.argv.includes('--essai');
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    try {
      await c.query('begin');
      await seed(async (sql, args) => (await c.query(sql, args)).rows, apply || essai);
      await c.query(apply ? 'commit' : 'rollback');
      if (essai) console.log('Essai terminé : tout est passé, puis tout a été annulé (rien n\'est resté en base).');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      console.error('Erreur : ' + e.message + '\nRien n\'a été écrit.');
      process.exitCode = 1;
    } finally { await c.end(); }
  })();
}
