// Morceaux protégés (migration 20260929050000) : qui peut obtenir les liens signés d'un morceau dont les fichiers sont
// privés (can_hear_track). Base jetable PGlite.
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
  const hear = async (n, t) => { await as(n); return one(`select public.can_hear_track($1)`, [t]); };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };

  for (const [n, e] of [[1, 'compo'], [2, 'acheteur'], [3, 'curieux'], [4, 'studio'], [5, 'invite']]) await mk(n, e + '@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(1)]))[0].id;
  const c5 = (await q(`insert into public.composer_profiles (profile_id) values ($1) returning id`, [U(5)]))[0].id;
  await q(`insert into public.studio_profiles (profile_id) values ($1)`, [U(4)]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('pub', $1, 'Public', 'static'), ('prot', $1, 'Protégé', 'static'), ('libre', $1, 'Libre', 'static'), ('reel', $1, 'AdReel', 'static'), ('paquet', $1, 'Pack', 'static'), ('inv', $2, 'Invité', 'static')`, [c1, c5]);
  await q(`update public.tracks set protected = true where id <> 'pub'`);
  await q(`insert into public.albums (id, seller_id, seller_role, title, buyable, price_eur_cents, listen_mode) values ('al', $1, 'composer', 'Album', true, 500, 'selected')`, [U(1)]);
  await q(`insert into public.album_tracks (album_id, track_id, position, free_listen) values ('al', 'prot', 0, false), ('al', 'libre', 1, true), ('al', 'inv', 2, false)`);
  await q(`update public.album_tracks set added_by = $1 where track_id = 'inv'`, [U(5)]);
  await q(`insert into public.album_contributors (album_id, email, profile_id, status) values ('al', 'invite@x.test', $1, 'accepted')`, [U(5)]);
  await q(`insert into public.ad_reels (id, owner_id, label, profile, blocks) values ('r1', $1, 'R', '{}'::jsonb, '[]'::jsonb)`, [c1]);
  await q(`insert into public.ad_reel_tracks (ad_reel_id, track_id, position, owner_id) values ('r1', 'reel', 0, $1)`, [c1]);
  await q(`insert into public.packs (id, owner_id, title, buyable, price_eur_cents) values ('pk', $1, 'Pack', false, 500)`, [c1]);
  await q(`insert into public.pack_tracks (pack_id, track_id, position) values ('pk', 'paquet', 0)`);
  await q(`insert into public.album_purchases (buyer_id, album_id, price_paid) values ($1, 'al', 5)`, [U(2)]);

  check('morceau non protégé : toujours écoutable (même sans compte)', await hear(0, 'pub'));
  check('morceau inconnu : non', !(await hear(1, 'nope')));
  check('protégé, visiteur sans compte : refusé', !(await hear(0, 'prot')));
  check('protégé, compte quelconque : refusé', !(await hear(3, 'prot')));
  check('protégé : son compositeur peut l\'écouter', await hear(1, 'prot'));
  check('protégé : l\'acheteur de l\'album peut l\'écouter', await hear(2, 'prot'));
  check('protégé : l\'acheteur peut aussi écouter le morceau d\'un invité', await hear(2, 'inv'));
  check('protégé mais en écoute libre d\'un album en vente : tout le monde', await hear(0, 'libre'));
  check('écoute libre : seulement les morceaux cochés (« prot » reste privé)', !(await hear(3, 'prot')));
  check('l\'invité de l\'album peut écouter les morceaux de l\'album', await hear(5, 'prot'));
  check('protégé mais dans un AdReel : écoute publique voulue (sans compte)', await hear(0, 'reel'));
  check('protégé dans un pack pas en vente : refusé', !(await hear(3, 'paquet')));
  await q(`update public.packs set buyable = true where id = 'pk'`);
  check('protégé dans un pack en vente : la page du pack l\'écoute (sans compte)', await hear(0, 'paquet'));
  await q(`update public.packs set buyable = false where id = 'pk'`);
  await q(`insert into public.pack_purchases (studio_id, pack_id, price_paid) values ($1, 'pk', 5)`, [U(4)]);
  check('protégé : le studio qui a acheté le pack peut l\'écouter', await hear(4, 'paquet'));
  // Écoute libre coupée : le morceau redevient privé
  await q(`update public.albums set listen_mode = 'none' where id = 'al'`);
  check('écoute libre retirée : le morceau redevient privé', !(await hear(0, 'libre')));
  // Album retiré de la vente : les acheteurs gardent l'accès, les autres non
  await q(`update public.albums set buyable = false where id = 'al'`);
  check('album hors vente : l\'acheteur garde l\'accès', await hear(2, 'prot'));
  // Morceau retiré de l'album après l'achat : gardé pour l'acheteur, pas pour un nouvel acheteur
  await q(`update public.album_tracks set removed_at = now() + interval '1 hour' where track_id = 'prot'`);
  await q(`update public.album_tracks set removed_at = now() - interval '1 day' where track_id = 'inv'`);
  check('morceau retiré APRÈS l\'achat : l\'acheteur le garde', await hear(2, 'prot'));
  check('morceau retiré AVANT l\'achat : plus accessible à l\'acheteur', !(await hear(2, 'inv')));
  check('set_track_protected : refusé à un compte (réservé au service)', await (async () => { await db.query(`set role authenticated`); try { await db.query(`select public.set_track_protected('pub', true)`); return false; } catch (e) { return true; } finally { await db.query(`reset role`); } })());
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
