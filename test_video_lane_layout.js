// Pistes de la frise propres à chaque version (10/11, migrations 20261110010000 à 20261110040000), sur une base jetable PGlite :
// enregistrement et relecture des pistes masquées/ajoutées (montage et versions alternatives), « null = on garde », révisions figées à l'envoi.
const fs = require('fs');
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const U = n => '00000000-0000-0000-0000-00000000000' + n;
  await db.query(`insert into auth.users (id) values ($1)`, [U(1)]);
  await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const owner = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'danny') returning id`, [U(1)]))[0].id;
  await db.query(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await db.query(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'Pack')`, [owner]);
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);

  const layout = { hidden: ['t2'], extra: ['t9'] };
  await q(`select public.save_video_capture(p_id => 'cap1', p_pack_id => 'p1', p_title => 'Prise', p_video_filename => 'jeu.mp4', p_events => '[]'::jsonb, p_lane_layout => $1::jsonb)`, [JSON.stringify(layout)]);
  const same = (a, b) => !!a && JSON.stringify(a.hidden) === JSON.stringify(b.hidden) && JSON.stringify(a.extra) === JSON.stringify(b.extra);
  const get = async () => (await q(`select public.get_video_capture('cap1') as r`))[0].r;
  let cap = await get();
  check('montage : pistes masquées et ajoutées relues', same(cap.laneLayout, layout));
  await q(`select public.save_video_capture('cap1', 'p1', 'Prise 2', 'jeu.mp4', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false, null)`);
  cap = await get();
  check('montage : un enregistrement sans pistes garde celles de la base', cap.title === 'Prise 2' && same(cap.laneLayout, layout));
  await q(`select public.save_video_capture('cap1', 'p1', 'Prise 2', 'jeu.mp4', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false, null, '{"hidden":[],"extra":[]}'::jsonb)`);
  cap = await get();
  check('montage : on peut tout remettre (listes vides)', cap.laneLayout.hidden.length === 0 && cap.laneLayout.extra.length === 0);
  await q(`select public.save_video_capture('cap2', 'p1', 'Neuve', 'jeu.mp4', '[]'::jsonb)`);
  check('montage neuf : disposition vide (comportement d’avant)', JSON.stringify((await q(`select lane_layout from public.video_captures where id = 'cap2'`))[0].lane_layout) === '{}');
  let bad = false; try { await q(`select public.save_video_capture('cap3', 'p1', 'x', 'a.mp4', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false, null, '[1]'::jsonb)`); } catch (e) { bad = true; }
  check('pistes invalides (pas un objet) refusées', bad);

  // Versions alternatives : frise complète + pistes propres, « null = garder ».
  const ev = [{ name: 'track_play', t: 1, detail: { trackId: 't1' } }];
  await q(`select public.save_video_capture_version('v1', 'cap1', 'Version alternative #2', '{}'::jsonb, false, $1::jsonb, '{"x":"Piano"}'::jsonb, '{}'::jsonb, '[{"id":"m1","t":2,"label":"a"}]'::jsonb, $2::jsonb)`, [JSON.stringify(ev), JSON.stringify(layout)]);
  let vers = (await q(`select public.list_video_capture_versions('cap1') as r`))[0].r;
  check('version : frise complète et pistes relues', vers.length === 1 && vers[0].events.length === 1 && vers[0].laneOverrides.x === 'Piano' && vers[0].markers[0].id === 'm1' && same(vers[0].laneLayout, layout));
  await q(`select public.save_video_capture_version('v1', 'cap1', 'Renommée', '{}'::jsonb)`);
  vers = (await q(`select public.list_video_capture_versions('cap1') as r`))[0].r;
  check('version : renommer ne touche pas la frise ni les pistes', vers[0].title === 'Renommée' && vers[0].events.length === 1 && same(vers[0].laneLayout, layout));
  await q(`insert into public.video_capture_versions (id, capture_id, owner_id, title, substitutions) values ('old1', 'cap1', $1, 'Ancienne', '{}'::jsonb)`, [owner]);
  vers = (await q(`select public.list_video_capture_versions('cap1') as r`))[0].r;
  const old = vers.find(v => v.id === 'old1');
  check('version à l’ancienne : rien de réécrit (frise et pistes absentes)', old && old.events === null && old.laneLayout === null);

  // Révisions figées : passer à « envoyée » fige la version et l'original (si une vidéo a été publiée).
  await q(`insert into public.composer_videos (id, owner_id, title, file, base, kind) values ('vid1', $1, 'm', 'a.mp3', 'https://media.layerpitch.com/x/', 'capture_audio'), ('vid2', $1, 'v', 'b.mp3', 'https://media.layerpitch.com/x/', 'capture_audio')`, [owner]).catch(() => {});
  await q(`update public.video_captures set last_export_video_id = 'vid1' where id = 'cap1'`).catch(() => {});
  await q(`update public.video_capture_versions set last_export_video_id = 'vid2' where id = 'v1'`).catch(() => {});
  await q(`select public.set_video_capture_version_status('v1', 'sent')`);
  let revs = await q(`select version_key, seq from public.video_review_revisions where capture_id = 'cap1' order by version_key, seq`);
  check('révisions : « envoyée » fige la version (#1) et l’original (#1)', revs.length === 2 && revs.some(r => r.version_key === 'v1' && r.seq === 1) && revs.some(r => r.version_key === 'original' && r.seq === 1));
  await q(`select public.set_video_capture_version_status('v1', 'sent')`);
  revs = await q(`select count(*)::int n from public.video_review_revisions where capture_id = 'cap1'`);
  check('révisions : renvoyer sans changement ne fige rien de plus', revs[0].n === 2);
  await q(`update public.video_capture_versions set last_export_video_id = 'vid1' where id = 'v1'`).catch(() => {});
  await q(`select public.set_video_capture_version_status('v1', 'sent')`);
  revs = await q(`select seq from public.video_review_revisions where capture_id = 'cap1' and version_key = 'v1' order by seq`);
  check('révisions : après un nouvel export, le renvoi fige la révision n° 2', revs.length === 2 && revs[1].seq === 2);
  check('révisions : la vidéo figée n’est jamais effacée', (await q(`select public.video_still_used('vid2') as u`))[0].u === true);
  await q(`select public.freeze_video_review_original('cap1')`);
  check('figer l’original seul : appel accepté', true);

  console.log(failures ? failures + ' échec(s)' : 'Tout est OK'); process.exit(failures ? 1 : 0);
})().catch(e => { console.log('FAIL - ' + e.message); process.exit(1); });
