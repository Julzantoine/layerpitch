// Espace Projet, étape 2 (migration 20260928140000) : comptage des sites SANS aperçu (nom de domaine seul, par Projet),
// liste admin, et sites connus jamais comptés. Base jetable PGlite.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [U(n)]);

  check('domaine : www. retiré, adresse ignorée', (await val(`select public.link_domain('https://www.ArtStation.com/artwork/abc?x=1')`)) === 'artstation.com');
  check('domaine : identifiants et port ignorés', (await val(`select public.link_domain('https://site.fr:8443/x')`)) === 'site.fr');
  check('sites connus : sous-domaine Bandcamp reconnu', (await val(`select public.project_link_has_preview('moi.bandcamp.com')`)) === true);
  check('sites connus : faux domaine pas reconnu', (await val(`select public.project_link_has_preview('youtube.com.pirate.io')`)) === false);

  for (const n of [1, 2]) { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), `u${n}@x.test`]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(n)]); }
  await q(`update public.feature_flags set released = true where key = 'projects'`);
  await as(1); const p1 = await val(`select public.create_project('A')`);
  await as(2); const p2 = await val(`select public.create_project('B')`);
  const add = (p, url) => val(`select public.add_project_asset($1, $2::jsonb)`, [p, JSON.stringify({ kind: 'link', url })]);
  await as(1);
  await add(p1, 'https://www.artstation.com/a'); await add(p1, 'https://artstation.com/b'); await add(p1, 'https://open.spotify.com/track/1');
  await add(p1, 'https://youtu.be/abc');
  await as(2); await add(p2, 'https://artstation.com/c'); await add(p2, 'https://pinterest.com/p');

  check('liste admin refusée à un non-admin', await fails(`select public.admin_link_domains_without_preview(20)`, [], /admins/));
  await q(`insert into public.admins (profile_id) values ($1)`, [U(2)]);
  const list = await val(`select public.admin_link_domains_without_preview(20)`);
  const art = list.find(d => d.domain === 'artstation.com');
  check('artstation.com : 3 liens dans 2 Projets, en tête', list[0].domain === 'artstation.com' && art.links === 3 && art.projects === 2);
  check('sites avec aperçu (Spotify, YouTube) jamais comptés', !list.some(d => /spotify|youtu/.test(d.domain)));
  check('seul le nom de domaine est gardé', (await q(`select * from public.project_link_domains`)).every(r => !/\//.test(r.domain)));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
