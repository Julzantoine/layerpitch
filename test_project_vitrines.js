// Espace Projet, étape 6 (migration 20260928200000) : vitrines multiples en blocs. Reprise de l'ancienne vitrine unique,
// droits (membres préparent, administrateurs publient), adresse, lien secret de la vitrine éditeur, lecture sans compte,
// fichiers privés lisibles seulement via une vitrine publiée ou le lien secret. Base jetable PGlite.
const fs = require('fs');
const path = require('path');
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb({ upTo: '20260928195959' });
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  for (const n of [1, 2, 3]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `u${n}@x.test`]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro') returning id`, [U(1)]))[0].id;
  await q(`update public.feature_flags set released = true where key in ('projects', 'video_upload')`);
  await as(1); const p = await val(`select public.create_project('Jeu forêt')`);
  const inv = await val(`select public.invite_project_member($1, 'u2@x.test')`, [p]);
  await as(2); await q(`select public.respond_project_invitation($1, true)`, [inv]);
  await as(1);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'Thème forêt', 'static')`, [c1]);
  const add = async (payload) => (await val(`select public.add_project_asset($1, $2::jsonb)`, [p, JSON.stringify(payload)])).id;
  const track = await add({ kind: 'track', trackId: 't1' });
  const yt = await add({ kind: 'link', url: 'https://youtu.be/abc', title: 'Trailer' });
  const fimg = await val(`select public.reserve_project_file($1, 'concept.png', 1000)`, [p]); await q(`select public.complete_project_file($1)`, [fimg.fileId]);
  const img = await add({ kind: 'image', fileId: fimg.fileId, title: 'Concept' });
  const fvid = await val(`select public.reserve_project_file($1, 'capture.mov', 1000)`, [p]); await q(`select public.complete_project_file($1)`, [fvid.fileId]);
  const cap = await add({ kind: 'video', fileId: fvid.fileId, title: 'Capture privée' });
  // Ancienne vitrine unique, publiée
  await q(`select public.save_project_showcase($1, $2::jsonb)`, [p, JSON.stringify({ published: true, title: 'OST officielle', intro: 'La musique du jeu', steamUrl: 'https://store.steampowered.com/app/1', entries: [{ assetId: track }, { assetId: yt }, { assetId: img }] })]);

  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20260928200000_project_vitrines.sql'), 'utf8'));

  const list = await val(`select public.list_project_vitrines($1)`, [p]);
  const old = list[0];
  check('ancienne vitrine reprise : publique, publiée, adresse tirée du titre', list.length === 1 && old.audience === 'players' && old.published && old.slug === 'ost-officielle');
  check('ancienne vitrine reprise : en-tête, présentation, lien Steam, morceaux, vidéo, image', old.blocks.map(b => b.type).join(',') === 'header,text,links,tracks,video,photo'
    && old.blocks.find(b => b.type === 'links').links[0].url === 'https://store.steampowered.com/app/1');

  // Droits
  await as(2);
  const d = await val(`select public.save_project_vitrine($1, $2::jsonb)`, [p, JSON.stringify({ audience: 'publisher', title: 'Pitch Ubisoft', published: true,
    blocks: [{ id: 'h', type: 'header' }, { id: 'v', type: 'video', assetIds: [cap] }, { id: 'l', type: 'links', links: [{ label: 'Site', url: 'https://jeu.fr' }] }] })]);
  check('un membre prépare une vitrine, mais ne la publie pas', d.published === false);
  check('bloc qui cite un objet d\'un autre type : refusé', await fails(`select public.save_project_vitrine($1, $2::jsonb)`, [p, JSON.stringify({ blocks: [{ type: 'photo', assetIds: [track] }] })], /bon type/));
  check('lien javascript: refusé', await fails(`select public.save_project_vitrine($1, $2::jsonb)`, [p, JSON.stringify({ blocks: [{ type: 'links', links: [{ label: 'x', url: 'javascript:alert(1)' }] }] })], /Lien invalide/));
  check('adresse déjà prise : refusée si demandée explicitement', await fails(`select public.save_project_vitrine($1, $2::jsonb)`, [p, JSON.stringify({ slug: 'ost-officielle', title: 'Autre' })], /déjà prise/));
  check('adresse réservée (« tarifs ») : décalée', (await val(`select public.save_project_vitrine($1, $2::jsonb)`, [p, JSON.stringify({ title: 'Tarifs' })])).slug === 'tarifs-vitrine');
  await as(1);
  const pub = (await val(`select public.list_project_vitrines($1)`, [p])).find(v => v.id === d.id);
  check('vitrine éditeur : lien secret créé, visible par l\'administrateur', pub.secretToken && pub.secretToken.length === 32);
  await as(2);
  check('le lien secret n\'est pas montré à un membre simple', !(await val(`select public.list_project_vitrines($1)`, [p])).find(v => v.id === d.id).secretToken);

  // Lecture sans compte
  await as(0); await db.query(`set role anon`);
  const byslug = await val(`select public.get_vitrine('OST-officielle')`);
  const bytoken = await val(`select public.get_vitrine(null, $1)`, [pub.secretToken]);
  const draftBySlug = await val(`select public.get_vitrine($1)`, [pub.slug]);
  await db.query(`reset role`);
  check('vitrine publique lisible sans compte, avec ses objets et rien d\'autre', byslug && Object.keys(byslug.assets).length === 3 && byslug.assets[track].trackId === 't1' && !('messages' in byslug));
  check('vitrine éditeur lisible avec le lien secret, même non publiée', bytoken && bytoken.id === d.id);
  check('vitrine éditeur jamais lisible par son adresse', draftBySlug === null);
  await as(3);
  check('un inconnu ne voit pas un brouillon par son identifiant', (await val(`select public.get_vitrine(null, null, $1)`, [d.id])) === null);

  // Fichiers privés
  await db.query(`reset role`);
  check('capture privée : lisible avec le lien secret de la vitrine éditeur qui la cite', !!(await val(`select public.project_file_path_by_vitrine_token($1, $2)`, [fvid.fileId, pub.secretToken])));
  check('capture privée : pas lisible publiquement tant qu\'aucune vitrine publiée ne la cite', (await val(`select public.project_file_is_public($1)`, [fvid.fileId])) === null);
  check('image citée par la vitrine publiée : lisible publiquement', !!(await val(`select public.project_file_is_public($1)`, [fimg.fileId])));
  await as(1);
  const newTok = await val(`select public.renew_vitrine_token($1)`, [d.id]);
  await db.query(`reset role`);
  check('nouveau lien secret : l\'ancien ne marche plus', (await val(`select public.get_vitrine(null, $1)`, [pub.secretToken])) === null && !!(await val(`select public.get_vitrine(null, $1)`, [newTok])));

  // Depuis une version du Moodboard
  await as(1);
  await q(`select public.pin_project_asset($1, true)`, [track]); await q(`select public.pin_project_asset($1, true)`, [img]);
  await add({ kind: 'link', url: 'https://www.artstation.com/x', title: 'Ambiance' });
  const ref = (await val(`select public.get_project_content($1)`, [p])).assets.find(a => a.url === 'https://www.artstation.com/x');
  await q(`select public.pin_project_asset($1, true)`, [ref.id]);
  const snap = await val(`select public.create_project_snapshot($1, 'Pitch v1')`, [p]);
  const fromSnap = await val(`select public.vitrine_from_snapshot($1)`, [snap]);
  const v2 = (await val(`select public.list_project_vitrines($1)`, [p])).find(v => v.id === fromSnap.id);
  check('« En faire une vitrine » : brouillon éditeur, un bloc par sorte, liens à la fin', v2.audience === 'publisher' && !v2.published && v2.title === 'Pitch v1'
    && v2.blocks.map(b => b.type).join(',') === 'header,tracks,photo,links' && v2.fromSnapshotId === snap);
  await as(2);
  check('un membre simple ne supprime pas une vitrine publiée', await fails(`select public.delete_project_vitrine($1)`, [old.id], /administrateur/));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
