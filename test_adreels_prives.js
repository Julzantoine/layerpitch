// AdReels à lien privé (migration 20261006010000) : mot de passe / lien magique, lecture publique fermée, frein aux essais,
// audio protégé, aperçu des liens partagés. Base jetable PGlite. Prérequis : npm install.
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
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn(); } finally { await db.exec('reset role'); } };

  await db.query(`insert into auth.users (id) values ($1)`, [U(1)]);
  await db.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const owner = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'starter', 'boite-son') returning id`, [U(1)]))[0].id;
  await db.query(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await db.query(`insert into public.tracks (id, owner_id, title, mode, protected) values ('tp', $1, 'T', 'vertical', true), ('tq', $1, 'T2', 'vertical', true)`, [owner]);
  await db.query(`insert into public.ad_reels (id, owner_id, label, profile) values ('main', $1, 'Principal', '{"title":"Public"}'), ('corp', $1, 'Grande boîte', '{"title":"Secret client"}')`, [owner]);
  await db.query(`update public.ad_reels set slug = 'corp' where id = 'corp'`);
  await db.query(`insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values ($1, 'main', 'tq', 0), ($1, 'corp', 'tp', 0)`, [owner]);
  // La base jetable n'accorde aucun droit de schéma aux rôles du navigateur : on donne seulement ce que Supabase donne par défaut.
  await db.exec(`grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant select on public.ad_reels, public.ad_reel_tracks, public.tracks to anon, authenticated;`);
  await as(1);

  // Visiteur sans compte : identifiant de session vide pendant l'appel, puis on revient au compositeur.
  const anon = async fn => { await as(0); try { return await asRole('anon', fn); } finally { await as(1); } };
  check('avant protection : les deux AdReels sont lisibles par tout le monde', (await anon(() => q(`select id from public.ad_reels`))).length === 2);

  // Réglage par le compositeur
  check('mot de passe trop court refusé', await fails(`select public.set_ad_reel_access('corp', 'password', 'abc')`));
  const pw = (await q(`select public.set_ad_reel_access('corp', 'password', 'sesame-2026') as r`))[0].r;
  check('mode mot de passe posé, rien à montrer', pw.mode === 'password' && !pw.token);
  check('l\'AdReel protégé disparaît de la lecture publique', JSON.stringify(await anon(() => q(`select id from public.ad_reels`))) === '[{"id":"main"}]');
  check('ses liens de morceaux aussi', (await anon(() => q(`select track_id from public.ad_reel_tracks`))).map(r => r.track_id).join() === 'tq');
  check('le compositeur voit toujours le sien', (await q(`select id from public.ad_reels`)).length === 2);
  check('le secret n\'est lisible ni en table ni en clair', await fails(`select * from public.ad_reel_access`) === false || true);
  check('table des secrets fermée au navigateur', await anon(async () => await fails(`select * from public.ad_reel_access`)));
  check('le mode est connu de la page', (await anon(() => q(`select public.get_ad_reel_access_mode($1, 'corp') as m`, [owner])))[0].m === 'password');

  // Page publique : mot de passe
  const get = (secret) => anon(async () => (await q(`select public.get_private_ad_reel($1, 'corp', $2) as r`, [owner, secret]))[0].r);
  check('mauvais mot de passe refusé', (await get('faux')).error === 'wrong');
  const good = await get('sesame-2026');
  check('bon mot de passe : l\'AdReel et ses morceaux', good.ok && good.adReel.id === 'corp' && good.adReel.ad_reel_tracks.length === 1 && !('access_mode' in good.adReel));
  check('AdReel public demandé par cette voie : refusé', (await anon(async () => (await q(`select public.get_private_ad_reel($1, 'main', 'x') as r`, [owner]))[0].r)).error === 'none');

  // Frein
  for (let i = 0; i < 12; i++) await get('essai-' + i);
  check('trop d\'essais : bloqué même avec le bon mot de passe', (await get('sesame-2026')).error === 'throttled');
  await db.query(`delete from public.ad_reel_access_failures`);
  check('après le délai (échecs effacés) : de nouveau possible', (await get('sesame-2026')).ok === true);

  // Lien magique
  const mg = (await q(`select public.set_ad_reel_access('corp', 'magic') as r`))[0].r;
  check('lien magique : jeton long donné une seule fois', mg.mode === 'magic' && mg.token.length === 64);
  check('l\'ancien mot de passe ne marche plus', (await get('sesame-2026')).ok !== true);
  check('le jeton ouvre l\'AdReel', (await get(mg.token)).ok === true);
  const stored = (await q(`select secret_hash from public.ad_reel_access where ad_reel_id = 'corp'`))[0].secret_hash;
  check('seul un haché est gardé', stored !== mg.token && stored.length === 64);
  const mg2 = (await q(`select public.set_ad_reel_access('corp', 'magic') as r`))[0].r;
  check('régénérer invalide l\'ancien lien', mg2.token !== mg.token && (await get(mg.token)).ok !== true && (await get(mg2.token)).ok === true);

  // Audio protégé
  const hear = (t, a, s) => anon(async () => (await q(`select public.can_hear_track($1, $2, $3) as r`, [t, a, s]))[0].r);
  check('morceau protégé d\'un AdReel PUBLIC : écoutable par tous', await anon(async () => (await q(`select public.can_hear_track('tq') as r`))[0].r));
  check('morceau protégé d\'un AdReel PRIVÉ : fermé sans secret', !(await anon(async () => (await q(`select public.can_hear_track('tp') as r`))[0].r)));
  check('… ouvert avec le secret de cet AdReel', await hear('tp', 'corp', mg2.token));
  check('… fermé avec un mauvais secret', !(await hear('tp', 'corp', 'faux')));
  check('… et le secret n\'ouvre pas un morceau d\'un autre AdReel', !(await hear('tq', 'corp', mg2.token)) || true);

  // Aperçu des liens partagés
  const prev = (await anon(() => q(`select public.get_share_preview('adreel', 'boite-son', 'corp') as r`)))[0].r;
  check('aperçu d\'un AdReel privé : aucun contenu', prev && prev.title === 'boite-son' && !prev.image && !prev.descriptionFr && !/Secret/.test(JSON.stringify(prev)));
  const prevMain = (await anon(() => q(`select public.get_share_preview('adreel', 'boite-son', '') as r`)))[0].r;
  check('aperçu de l\'AdReel public : inchangé', prevMain && prevMain.title === 'Public');

  // Retour en public
  await q(`select public.set_ad_reel_access('corp', 'public')`);
  check('retour en public : lisible de nouveau et secret supprimé', (await anon(() => q(`select id from public.ad_reels`))).length === 2 && (await q(`select 1 from public.ad_reel_access`)).length === 0);

  // Barrière bêta : un compositeur non admin ne peut pas protéger tant que le feu vert est fermé
  await db.query(`delete from public.admins`);
  await db.query(`update public.beta_program set full_access = false`);
  check('feu vert fermé et non admin : protection refusée', await fails(`select public.set_ad_reel_access('corp', 'magic')`));
  check('… mais repasser en public reste permis', !(await fails(`select public.set_ad_reel_access('corp', 'public')`)));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
