// Apparence d'un Projet (migration 20261008010000) : feu vert, droits (réglage par l'administrateur du Projet), validation, effacement. Base jetable PGlite.
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
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };

  await mk(1, 'admin@x.test'); await mk(2, 'membre@x.test'); await mk(3, 'intrus@x.test');
  await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(1)]);
  await q(`insert into public.composer_profiles (profile_id, plan) values ($1, 'pro')`, [U(2)]);
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  await q(`update public.feature_flags set released = true where key in ('projects', 'studio_space')`);
  await as(1);
  const pid = await val(`select public.create_project('Hollow Manor')`);
  const inv = await val(`select public.invite_project_member($1, 'membre@x.test')`, [pid]);
  await as(2); await q(`select public.respond_project_invitation($1, true)`, [inv]);
  const img = 'data:image/webp;base64,' + 'A'.repeat(1000);
  const get = async () => val(`select public.get_project_appearance($1)`, [pid]);
  const set = async p => q(`select public.set_project_appearance($1, $2::jsonb)`, [pid, JSON.stringify(p)]);

  // feu vert fermé
  await db.query(`update public.feature_flags set released = false where key = 'project_appearance'`);
  check('feu vert fermé : un membre non admin ne lit pas l\'apparence', await fails(`select public.get_project_appearance($1)`, [pid], /pas encore ouverte/));
  await as(1);
  await set({ bg: '#223344', image: null, opacity: 20, fixed: true });
  check('feu vert fermé : l\'admin LayerPitch règle quand même', (await get()).bg === '#223344');
  await db.query(`update public.feature_flags set released = true where key = 'project_appearance'`);

  // lecture par un membre
  await as(2);
  const a = await get();
  check('feu vert ouvert : un membre lit l\'apparence d\'équipe', a.bg === '#223344' && a.opacity === 20 && a.fixed === true && !!a.updatedAt);
  check('un simple membre ne peut pas la régler', await fails(`select public.set_project_appearance($1, '{"bg":"#ffffff"}'::jsonb)`, [pid], /administrateur/));
  await as(3);
  check('un intrus ne lit rien', await fails(`select public.get_project_appearance($1)`, [pid], /introuvable/));

  // validation (par l'administrateur du Projet)
  await as(1);
  check('couleur invalide refusée', await fails(`select public.set_project_appearance($1, '{"bg":"rouge"}'::jsonb)`, [pid], /Couleur invalide/));
  check('image qui n\'est pas une adresse de données refusée', await fails(`select public.set_project_appearance($1, '{"image":"https://exemple.test/x.png"}'::jsonb)`, [pid], /Image invalide/));
  check('image de type interdit refusée (svg)', await fails(`select public.set_project_appearance($1, $2::jsonb)`, [pid, JSON.stringify({ image: 'data:image/svg+xml;base64,AAAA' })], /Image invalide/));
  check('image trop lourde refusée', await fails(`select public.set_project_appearance($1, $2::jsonb)`, [pid, JSON.stringify({ image: 'data:image/png;base64,' + 'A'.repeat(600001) })], /Image invalide/));
  check('opacité hors limites refusée', await fails(`select public.set_project_appearance($1, '{"opacity":150}'::jsonb)`, [pid], /Opacité/));
  await set({ bg: '#102030', image: img, opacity: 35, fixed: false });
  const b = await get();
  check('couleur, image, opacité et « fixe » enregistrés', b.bg === '#102030' && b.image === img && b.opacity === 35 && b.fixed === false);
  await set({ bg: null, image: null });
  const c = await get();
  check('valeurs par défaut (opacité 8, fixe) quand on ne précise pas', c.bg === null && c.image === null && c.opacity === 8 && c.fixed === true);
  await set({});
  check('réglage vide : tout est retiré', Object.keys(await get()).length === 0 && Number(await val(`select count(*) from public.project_appearance`)) === 0);
  check('le changement est noté dans l\'activité', Number(await val(`select count(*) from public.project_activity where project_id = $1 and kind = 'appearance_changed'`, [pid])) >= 2);
  await set({ bg: '#ffffff' });
  await q(`select public.delete_project($1)`, [pid]);
  check('supprimer le Projet emporte son apparence', Number(await val(`select count(*) from public.project_appearance`)) === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
  process.exit(failures ? 1 : 0);
})();
