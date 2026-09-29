// Effets sonores protégés (migration 20260929060000) : can_hear_sfx. Base jetable PGlite.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const hear = async (n, id) => { await as(n); return one(`select public.can_hear_sfx($1)`, [id]); };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };
  for (const [n, e] of [[1, 'compo'], [2, 'curieux'], [3, 'studio']]) await mk(n, e + '@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(1)]))[0].id;
  await q(`insert into public.studio_profiles (profile_id) values ($1)`, [U(3)]);
  for (const id of ['pub', 'seul', 'reel', 'paquet', 'piste']) await q(`insert into public.sfx_library (id, owner_id, title) values ($1, $2, $1)`, [id, c1]);
  await q(`update public.sfx_library set protected = true where id <> 'pub'`);
  await q(`insert into public.tracks (id, owner_id, title, mode, protected) values ('t', $1, 'T', 'static', true)`, [c1]);
  await q(`insert into public.track_sfx (track_id, sfx_id, position) values ('t', 'piste', 0)`);
  await q(`insert into public.ad_reels (id, owner_id, label, profile, blocks) values ('r', $1, 'R', '{}'::jsonb, $2::jsonb)`, [c1, JSON.stringify([{ id: 'b', type: 'sfx', sfxIds: ['reel'] }, { id: 'c', type: 'text' }])]);
  await q(`insert into public.packs (id, owner_id, title, buyable, price_eur_cents) values ('pk', $1, 'P', false, 500)`, [c1]);
  await q(`insert into public.pack_sfx (pack_id, sfx_id, position) values ('pk', 'paquet', 0)`);

  check('Sfx non protégé : toujours écoutable', await hear(0, 'pub'));
  check('Sfx inconnu : non', !(await hear(1, 'nope')));
  check('protégé, visiteur : refusé', !(await hear(0, 'seul')));
  check('protégé, compte quelconque : refusé', !(await hear(2, 'seul')));
  check('protégé : son compositeur peut l\'écouter', await hear(1, 'seul'));
  check('protégé mais dans un bloc Sfx d\'un AdReel : public (sans compte)', await hear(0, 'reel'));
  check('protégé dans un pack pas en vente : refusé', !(await hear(2, 'paquet')));
  await q(`update public.packs set buyable = true where id = 'pk'`);
  check('protégé dans un pack en vente : la page du pack l\'écoute (packs consultables par défaut)', await hear(0, 'paquet'));
  await q(`update public.packs set buyable = false where id = 'pk'`);
  await q(`insert into public.pack_purchases (studio_id, pack_id, price_paid) values ($1, 'pk', 5)`, [U(3)]);
  check('protégé : le studio qui a acheté le pack l\'écoute', await hear(3, 'paquet'));
  check('protégé, utilisé par un morceau protégé : refusé tant que le morceau ne l\'est pas pour l\'appelant', !(await hear(2, 'piste')));
  await q(`insert into public.ad_reel_tracks (ad_reel_id, track_id, position, owner_id) values ('r', 't', 0, $1)`, [c1]);
  check('… mais écoutable dès que le morceau l\'est (AdReel)', await hear(0, 'piste'));
  check('set_sfx_protected : refusé à un compte (réservé au service)', await (async () => { await db.query(`set role authenticated`); try { await db.query(`select public.set_sfx_protected('pub', true)`); return false; } catch (e) { return true; } finally { await db.query(`reset role`); } })());
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
