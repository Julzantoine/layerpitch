// Espace Projet, étape 1 (migration 20260928130000) : reprise des données EXISTANTES dans la réserve. Base jetable
// PGlite arrêtée juste avant la migration, remplie à l'ancien format (tableau, vidéos, notes, version, vitrine), puis
// migration appliquée : rien ne doit se perdre ni se dédoubler.
const fs = require('fs');
const path = require('path');
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const MIGRATION = '20260928130000_project_assets.sql';
  const db = await freshDb({ upTo: '20260928125959' });
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => (await q(sql, args))[0];

  await q(`insert into auth.users (id, email) values ($1, 'compo@x.test')`, [U(1)]);
  await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const c1 = (await one(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro') returning id`, [U(1)])).id;
  await q(`update public.feature_flags set released = true where key = 'projects'`);
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);
  const pid = (await one(`select public.create_project('Jeu forêt') as id`)).id;
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'Thème forêt', 'static')`, [c1]);
  const img = (await one(`insert into public.project_files (project_id, path, original_name, mime_type, size_bytes, status, uploaded_by)
    values ($1, 'projects/x/a.png', 'a.png', 'image/png', 10, 'ready', $2) returning id`, [pid, U(1)])).id;
  const mp4 = (await one(`insert into public.project_files (project_id, path, original_name, mime_type, size_bytes, status, uploaded_by)
    values ($1, 'projects/x/b.mp4', 'b.mp4', 'video/mp4', 10, 'ready', $2) returning id`, [pid, U(1)])).id;

  // Ancien format : tableau (dont un lien YouTube AUSSI présent dans Vidéos), vidéos, notes, version, vitrine.
  const item = async (kind, extra, pos, pitch) => (await one(`insert into public.project_items (project_id, kind, title, body, url, file_id, track_id, position, in_pitch)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [pid, kind, extra.title || '', extra.body || '', extra.url || null, extra.fileId || null, extra.trackId || null, pos, !!pitch])).id;
  const iYt = await item('link', { url: 'https://youtu.be/abc', body: 'le passage à 1:20' }, 0);
  const iRef = await item('link', { url: 'https://www.artstation.com/x', title: 'Ambiance' }, 1);
  const iImg = await item('image', { fileId: img, title: 'Concept art' }, 2, true);
  const iTrack = await item('track', { trackId: 't1' }, 3, true);
  const iNote = await item('note', { title: 'Idée', body: 'mineur' }, 4);
  const vYt = (await one(`insert into public.project_videos (project_id, kind, url, title) values ($1, 'link', 'https://youtu.be/abc', 'Trailer') returning id`, [pid])).id;
  const vUp = (await one(`insert into public.project_videos (project_id, kind, file_id, title) values ($1, 'upload', $2, 'Gameplay') returning id`, [pid, mp4])).id;
  const note = (target, id, t) => q(`insert into public.project_annotations (project_id, author_id, target_type, target_id, at_seconds, body) values ($1, $2, $3, $4, $5, 'note')`, [pid, U(1), target, id, t]);
  await note('video', vYt, 12); await note('item', iYt, null); await note('video', vUp, 3); await note('track', 't1', 30); await note('item', iRef, null);
  await q(`insert into public.project_snapshots (project_id, label, data) values ($1, 'v1', $2::jsonb)`, [pid, JSON.stringify([
    { kind: 'link', url: 'https://www.artstation.com/x', title: 'Ambiance' }, { kind: 'note', title: 'Supprimée depuis', body: 'x' }, { kind: 'track', trackId: 't1', inPitch: true }])]);
  await q(`insert into public.project_showcases (project_id, published, title) values ($1, true, 'OST')`, [pid]);
  await q(`insert into public.project_showcase_entries (project_id, kind, ref_id, position) values ($1, 'track', 't1', 0), ($1, 'video', $2, 1), ($1, 'image', $3, 2)`, [pid, vYt, iImg]);

  // Migration
  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', MIGRATION), 'utf8'));

  const assets = await q(`select * from public.project_assets where project_id = $1`, [pid]);
  const byUrl = u => assets.find(a => a.url === u);
  check('7 objets : le lien YouTube du tableau et de Vidéos n\'en fait qu\'un (+ la note recréée depuis la version)', assets.length === 7 && assets.filter(a => a.url === 'https://youtu.be/abc').length === 1);
  check('lien YouTube -> objet vidéo externe, titre de la vidéo + commentaire du tableau', byUrl('https://youtu.be/abc').kind === 'video'
    && byUrl('https://youtu.be/abc').origin === 'external' && byUrl('https://youtu.be/abc').title === 'Trailer' && byUrl('https://youtu.be/abc').body === 'le passage à 1:20');
  check('vidéo envoyée -> objet vidéo maison', assets.some(a => a.kind === 'video' && a.file_id === mp4 && a.origin === 'own'));
  check('morceau -> origine LayerPitch', assets.some(a => a.kind === 'track' && a.origin === 'layerpitch'));
  const pins = await q(`select p.*, x.kind, x.url from public.project_moodboard_pins p join public.project_assets x on x.id = p.asset_id where p.project_id = $1 order by p.position`, [pid]);
  check('Moodboard = l\'ancien tableau, même ordre', pins.map(p => p.kind).join(',') === 'video,link,image,track,note');
  check('★ conservées', pins.filter(p => p.starred).map(p => p.kind).join(',') === 'image,track');
  check('la vidéo envoyée n\'est pas épinglée (elle n\'était pas au tableau)', !pins.some(p => p.kind === 'video' && !p.url));
  const ann = await q(`select a.target_type, x.kind from public.project_annotations a left join public.project_assets x on x.id::text = a.target_id`);
  check('toutes les notes (5) pointent vers un objet existant', ann.length === 5 && ann.every(a => a.target_type === 'asset' && a.kind));
  check('les notes du lien YouTube (tableau + Vidéos) sont sur le même objet', (await q(`select count(*)::int as n from public.project_annotations where target_id = $1`, [byUrl('https://youtu.be/abc').id]))[0].n === 2);
  const snap = await one(`select data, kind from public.project_snapshots where project_id = $1`, [pid]);
  check('version reprise en épingles (note supprimée depuis recréée dans la réserve), marquée manuelle',
    snap.kind === 'manual' && snap.data.length === 3 && snap.data[2].starred === true && (await q(`select 1 from public.project_assets where title = 'Supprimée depuis'`)).length === 1);
  await db.query(`set role anon`); await db.query(`select set_config('test.uid', '', false)`);
  const pub = (await one(`select public.get_project_showcase($1) as s`, [pid])).s;
  await db.query(`reset role`);
  check('vitrine reprise, même format pour vitrine.html (morceau, vidéo YouTube, image)', pub.entries.map(e => e.kind).join(',') === 'track,video,image'
    && pub.entries[0].refId === 't1' && pub.entries[1].url === 'https://youtu.be/abc' && pub.entries[2].fileId === img);
  check('image publiée lisible publiquement, vidéo envoyée non', !!(await one(`select public.project_file_is_public($1) as p`, [img])).p && !(await one(`select public.project_file_is_public($1) as p`, [mp4])).p);
  check('anciennes tables supprimées', (await q(`select 1 from information_schema.tables where table_name in ('project_items', 'project_videos', 'project_showcase_entries', '_project_asset_map')`)).length === 0);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
