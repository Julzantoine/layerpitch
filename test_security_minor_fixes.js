// Sécurité (audit du 16/11) — points mineurs M1, M3, M4, M5, M6, M7. Base jetable PGlite + contrôles de texte.
const fs = require('fs'), path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8');
(async () => {
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL - PGlite absent : npm install (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch (e) { return true; } };
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const fromIp = ip => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': `${ip}, 10.0.0.1` })]);
  for (const n of [1, 2]) { await q(`insert into auth.users (id) values ($1)`, [U(n)]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); }
  const c1 = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'jean') returning id`, [U(1)]))[0].id;
  const c2 = (await q(`insert into public.composer_profiles (profile_id, plan, handle) values ($1, 'pro', 'ana') returning id`, [U(2)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);

  // ---- M1 : AdReel privé ----
  await q(`insert into public.ad_reels (id, owner_id, label, profile) values ('corp', $1, 'C', '{"title":"Secret"}')`, [c1]);
  await as(1);
  await q(`select public.set_ad_reel_access('corp', 'password', 'sesame-2026')`);
  const tryPw = async (ip, pw) => { await fromIp(ip); return (await q(`select public.check_ad_reel_secret($1, 'corp', $2) as r`, [c1, pw]))[0].r; };
  check('l\'adresse IP lue est le DERNIER segment (proxy de confiance)', (await (async () => { await fromIp('6.6.6.6'); return (await q(`select public.request_client_ip() as ip`))[0].ip; })()) === '10.0.0.1');
  // Le dernier segment fait foi : on simule des visiteurs différents en changeant ce dernier segment.
  const fromLast = ip => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': `1.2.3.4, ${ip}` })]);
  const tryAs = async (ip, pw) => { await fromLast(ip); return (await q(`select public.check_ad_reel_secret($1, 'corp', $2) as r`, [c1, pw]))[0].r; };
  for (let i = 0; i < 12; i++) await tryAs('6.6.6.6', 'faux-' + i);
  check('le fâcheux est freiné après 10 erreurs', await tryAs('6.6.6.6', 'sesame-2026') === 'throttled');
  check('le vrai destinataire (autre adresse) ouvre toujours le lien', await tryAs('7.7.7.7', 'sesame-2026') === 'ok');
  for (let ip = 0; ip < 12; ip++) for (let i = 0; i < 9; i++) await tryAs('8.8.8.' + ip, 'x' + i);
  check('plafond global (attaque répartie sur beaucoup d\'adresses) : 100 erreurs en 10 min bloquent tout', await tryAs('9.9.9.9', 'sesame-2026') === 'throttled');
  await q(`delete from public.ad_reel_access_failures`);
  check('sans en-tête (appel hors PostgREST) : un seul compteur commun, comme avant', await (async () => { await db.query(`select set_config('request.headers', '', false)`); return (await q(`select public.check_ad_reel_secret($1, 'corp', 'sesame-2026') as r`, [c1]))[0].r; })() === 'ok');

  // ---- M1 : lien de relecture ----
  await q(`insert into public.packs (id, owner_id, title) values ('p1', $1, 'P')`, [c1]);
  await q(`insert into public.video_captures (id, owner_id, pack_id, title) values ('cap1', $1, 'p1', 'T')`, [c1]);
  const link = (await q(`select public.set_video_review_link('cap1', true, 'traversee', 'password', 'mot-de-passe-long', false, false) as l`))[0].l;
  check('lien de relecture créé', link && link.slug === 'traversee');
  const rv = async (ip, pw) => { await fromLast(ip); try { return (await q(`select public.video_review_capture('traversee', $1) as c`, [pw]))[0].c; } catch (e) { return /throttled|trop d'essais/.test(e.message) ? 'throttled' : 'err:' + e.message; } };
  for (let i = 0; i < 12; i++) await rv('6.6.6.6', 'faux' + i);
  check('relecture : le fâcheux est freiné', await rv('6.6.6.6', 'mot-de-passe-long') === 'throttled');
  check('relecture : le client (autre adresse) entre toujours', await rv('7.7.7.7', 'mot-de-passe-long') === 'cap1');
  await as(0);

  // ---- M4 ----
  await db.exec(`grant usage on schema public to anon, authenticated`);
  await db.exec('set role anon');
  const m4 = await fails(`select public.submit_access_request('x@y.z', 'landing', null)`);
  await db.exec('reset role');
  check('M4 : l\'ancienne fonction de demande d\'accès n\'est plus appelable sans compte', m4);

  // ---- M5 ----
  const claim = (kind, id, comp, studio) => q(`select public.claim_media_prefix($1, $2, $3, $4) as ok`, [kind, id, comp, studio]).then(r => r[0].ok);
  check('M5 : le premier compte réserve un identifiant neuf', await claim('tracks', 'tNeuf', c1, null) === true);
  check('M5 : il peut envoyer à nouveau sous cet identifiant', await claim('tracks', 'tNeuf', c1, null) === true);
  check('M5 : un autre compte est refusé', await claim('tracks', 'tNeuf', c2, null) === false);
  check('M5 : même identifiant pour un autre type (Sfx) : indépendant', await claim('sfx_library', 'tNeuf', c2, null) === true);
  check('M5 : appel mal formé refusé', await claim('tracks', 'x', null, null) === false && await claim('tracks', 'x', c1, c2) === false);
  check('M5 : fonction fermée au navigateur', await (async () => { await db.exec('set role authenticated'); const r = await fails(`select public.claim_media_prefix('tracks', 'y', $1, null)`, [c1]); await db.exec('reset role'); return r; })());
  const sign = read('supabase/functions/create-media-signed-url/index.ts');
  check('M5 : l\'envoi de fichiers ne vaut plus « introuvable = autorisé »', !/if \(!data\) return true;/.test(sign) && /claimPrefix\(adminClient, table, m\[1\], composerId, null\)/.test(sign) && /claimPrefix\(adminClient, 'composer_videos', m\[1\], null, studioId\)/.test(sign));
  check('M5 : copie d\'un morceau : destination réservée aussi', /claim_media_prefix/.test(read('supabase/functions/copy-track-files/index.ts')));

  // ---- M6 / M7 (texte) ----
  const acc = read('supabase/functions/submit-access-request/index.ts');
  check('M6 : même adresse dans les 24 h -> ni ligne ni e-mail', /sameEmailCount/.test(acc) && acc.indexOf('sameEmailCount') < acc.indexOf(".from('access_requests').insert"));
  check('M6 : plus de 30 demandes par heure -> pas d\'e-mails', /quietMode = \(hourCount \|\| 0\) >= 30/.test(acc) && acc.indexOf('if (quietMode)') < acc.indexOf('sendConfirmationEmail(v_email'));
  check('M7 : demande d\'accès : plus de message brut de la base', !/error: insertError\.message/.test(acc));
  check('M7 : fichiers de Projet : seuls les refus voulus (P0001) sont montrés', /error\.code === 'P0001'/.test(read('supabase/functions/project-file-url/index.ts')));
  check('M7 : envoi de fichiers : plus de message brut', !/composerError\?\.message \|\|/.test(sign));
  check('M7 : webhook Stripe : signature invalide sans détail', !/Signature invalide : \$\{/.test(read('supabase/functions/stripe-webhook/index.ts')));

  // ---- M3 (vitrine) ----
  const vit = read('vitrine.html'), pj = read('projet.html'), f404 = read('404.html');
  check('M3 : le lien secret de vitrine est fabriqué après #', /\/vitrine\/\$\{encodeURIComponent\(v\.slug\)\}#k=/.test(pj) && !/\?k=\$\{encodeURIComponent\(v\.secretToken\)\}/.test(pj));
  check('M3 : la redirection /vitrine/<nom> garde le # ', /location\.replace\('\/vitrine\.html\?' \+ p\.toString\(\) \+ location\.hash\)/.test(f404));
  check('M3 : la vitrine lit le secret après # (ancien ?k= accepté puis retiré de l\'adresse)', /const vitrineToken = hashToken \|\| params\.get\('k'\)/.test(vit) && /url\.searchParams\.delete\('k'\)/.test(vit));
  check('M3 : le secret ne sert plus d\'identifiant de statistiques', !/id: slug \|\| token/.test(vit));

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
