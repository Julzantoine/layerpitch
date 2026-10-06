// Aperçu des liens partagés (1er/10) : 1) la fonction de base get_share_preview (PGlite) ; 2) le programme Cloudflare
// (cloudflare/apercu-liens-worker.mjs) : quels robots, quelles adresses, quelles balises, et surtout qu'il laisse passer tout
// le reste (visiteurs, pages sans aperçu, base injoignable).
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };

(async () => {
  // ---- Base ----
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL PGlite absent : ' + e.message); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const val = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  await q(`insert into auth.users (id, email) values ($1, 'a@x.test')`, [U(1)]);
  await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(1)]);
  const c1 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'jean') returning id`, [U(1)]))[0].id;
  await q(`insert into public.ad_reels (id, owner_id, label, lang, profile, blocks) values ('main', $1, 'Principal', 'fr', $2::jsonb, '[]'::jsonb)`,
    [c1, JSON.stringify({ title: 'Jean compose', subtitle: 'Musique adaptative pour le jeu vidéo', bio: 'Longue bio', photo: c1 + '/photo.jpg', logo: c1 + '/logo.png' })]);
  await q(`insert into public.ad_reels (id, owner_id, label, lang, profile, blocks, slug) values ('r2', $1, 'Version anglaise', 'en', $2::jsonb, '[]'::jsonb, 'english')`,
    [c1, JSON.stringify({ title: '', subtitle: '', bio: 'Adaptive music for games', logo: c1 + '/logo.png' })]);
  await q(`insert into public.packs (id, owner_id, title, presentation_fr, presentation_en, illustration) values ('pk1', $1, 'Pack Forêt', 'Ambiances de forêt', 'Forest ambiences', $2)`, [c1, c1 + '/pack-pk1.png']);
  await q(`insert into public.collections (id, owner_id, title, presentation_fr, presentation_en, illustration) values ('co1', $1, 'Collection Nuit', 'Univers nocturnes', '', null)`, [c1]);
  await q(`insert into public.albums (id, seller_id, seller_role, title, presentation_fr, presentation_en, illustration, buyable) values ('alb1', $1, 'composer', 'OST Forêt', 'Un album', 'An album', 'x/alb.png', true), ('alb2', $1, 'composer', 'Brouillon', '', '', null, false)`, [U(1)]);

  const P = (kind, handle, ref, alt) => val(`select public.get_share_preview($1, $2, $3, $4)`, [kind, handle, ref || '', alt || '']);
  let r = await P('adreel', 'jean', '');
  check('AdReel principal : titre, sous-titre, photo (avant le logo)', r.title === 'Jean compose' && r.descriptionFr === 'Musique adaptative pour le jeu vidéo' && r.image === c1 + '/photo.jpg' && r.lang === 'fr');
  r = await P('adreel', 'jean', 'english');
  check('AdReel secondaire sans titre : « étiquette · nom », bio en description, logo en image, langue', r.title === 'Version anglaise · jean' && r.descriptionFr === 'Adaptive music for games' && r.image === c1 + '/logo.png' && r.lang === 'en');
  r = await P('adreel', 'jean', '', 'r2');
  check('AdReel par ?adreel= (identifiant)', r.title === 'Version anglaise · jean');
  await q(`update public.ad_reels set profile = '{}'::jsonb where id = 'main' and owner_id = $1`, [c1]);
  check('AdReel principal sans titre : le nom du compositeur, jamais « Principal »', (await P('adreel', 'jean', '')).title === 'jean');
  await q(`update public.ad_reels set profile = $2::jsonb where id = 'main' and owner_id = $1`, [c1, JSON.stringify({ title: 'Jean compose', subtitle: 'Musique adaptative pour le jeu vidéo', bio: 'Longue bio', photo: c1 + '/photo.jpg', logo: c1 + '/logo.png' })]);
  // Champs « Aperçu des liens partagés » (Backstage, rubrique Réseaux sociaux) : passent avant le profil
  await db.query(`select set_config('test.uid', $1, false)`, [U(1)]);
  await q(`select public.upsert_settings($1::jsonb)`, [JSON.stringify({ publishedAt: 1, sharePreview: { title: 'Mon titre', description: 'Ma description', image: c1 + '/share-preview.png' } })]);
  check('upsert_settings range les champs d\'aperçu', (await val(`select share_preview ->> 'title' from public.settings where owner_id = $1`, [c1])) === 'Mon titre');
  r = await P('adreel', 'jean', '');
  check('champs dédiés : titre, description et image passent avant le profil de l\'AdReel', r.title === 'Mon titre' && r.descriptionFr === 'Ma description' && r.image === c1 + '/share-preview.png');
  r = await P('pack', 'jean', 'pk1');
  check('pack : garde son titre, sa description et son illustration (l\'image dédiée ne sert qu\'en repli)', r.title === 'Pack Forêt' && r.image === c1 + '/pack-pk1.png');
  r = await P('collection', 'jean', 'co1');
  check('collection sans illustration : image dédiée en repli', r.title === 'Collection Nuit' && r.image === c1 + '/share-preview.png');
  await q(`select public.upsert_settings($1::jsonb)`, [JSON.stringify({ publishedAt: 2 })]);
  r = await P('adreel', 'jean', '');
  check('champs effacés : retour au profil de l\'AdReel', r.title === 'Jean compose' && r.image === c1 + '/photo.jpg');
  check('compositeur inconnu : null', (await P('adreel', 'personne', '')) === null);
  r = await P('pack', 'jean', 'pk1');
  check('pack : titre, descriptions FR/EN, illustration', r.title === 'Pack Forêt' && r.descriptionFr === 'Ambiances de forêt' && r.descriptionEn === 'Forest ambiences' && r.image === c1 + '/pack-pk1.png');
  check('pack d\'un autre compositeur ou inconnu : null', (await P('pack', 'jean', 'nope')) === null);
  r = await P('collection', 'jean', 'co1');
  check('collection : titre et description, sans image', r.title === 'Collection Nuit' && r.descriptionFr === 'Univers nocturnes' && r.image === null);
  r = await P('album', '', 'alb1');
  check('album en vente : titre, descriptions, pochette', r.title === 'OST Forêt' && r.descriptionEn === 'An album' && r.image === 'x/alb.png');
  check('album pas en vente : null (rien n\'est révélé)', (await P('album', '', 'alb2')) === null);
  check('type inconnu : null', (await P('autre', 'jean', 'pk1')) === null);
  const keys = Object.keys(await P('adreel', 'jean', '')).sort().join();
  check('seuls titre, descriptions, image, langue sortent (aucune adresse e-mail, aucun identifiant interne)', keys === 'descriptionEn,descriptionFr,image,kind,lang,title');

  // ---- Programme Cloudflare ----
  const W = await import('./cloudflare/apercu-liens-worker.mjs');
  check('robots de partage reconnus', ['LinkedInBot/1.0', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'Twitterbot/1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'Slackbot-LinkExpanding'].every(W.isShareBot));
  check('navigateurs et moteurs de recherche non concernés', !W.isShareBot('Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/130.0') && !W.isShareBot('Mozilla/5.0 (compatible; Googlebot/2.1)') && !W.isShareBot(''));
  const R = p => W.routeOf(new URL('https://beta.layerpitch.com' + p));
  check('/<nom>/ -> AdReel principal', JSON.stringify(R('/jean/')) === '{"kind":"adreel","handle":"jean","ref":"","alt":""}');
  check('/<nom>/<adreel> -> AdReel par son nom', R('/jean/english').ref === 'english' && R('/jean/english').kind === 'adreel');
  check('/<nom>/?adreel=r2 -> identifiant', R('/jean/?adreel=r2').alt === 'r2');
  check('pack et collection', R('/jean/pack.html?id=pk1').kind === 'pack' && R('/jean/pack.html?id=pk1').ref === 'pk1' && R('/jean/collection.html?id=co1').kind === 'collection');
  check('/album/<id>', R('/album/alb1').kind === 'album' && R('/album/alb1').ref === 'alb1');
  check('pages sans aperçu propre laissées passer (accueil, shop, vitrine, fichiers, pack sans id)', [R('/'), R('/shop'), R('/vitrine/x'), R('/player.js'), R('/jean/pack.html'), R('/a/b/c')].every(x => x === null));

  const calls = [];
  const realFetch = global.fetch;
  const ok = body => ({ ok: true, json: async () => body });
  global.fetch = async (u, opts) => { calls.push({ u: String(u && u.url ? u.url : u), opts }); if (String(u).includes('get_share_preview')) return ok(global.__preview); return new Response('page normale', { status: 200 }); };
  const req = (p, ua, method) => new Request('https://beta.layerpitch.com' + p, { method: method || 'GET', headers: { 'User-Agent': ua } });
  global.__preview = { kind: 'adreel', title: 'Jean <compose> "ok"', descriptionFr: 'Musique & jeux', descriptionEn: 'Music & games', image: 'c1/ma photo.jpg', lang: 'fr' };
  let res = await W.default.fetch(req('/jean/', 'LinkedInBot/1.0'), {});
  let html = await res.text();
  check('robot : réponse 200 avec titre, description, image absolue et adresse', res.status === 200 && /og:title" content="Jean &lt;compose&gt; &quot;ok&quot;"/.test(html) && /og:description" content="Musique &amp; jeux"/.test(html) && /og:image" content="https:\/\/media\.layerpitch\.com\/images\/c1\/ma%20photo\.jpg"/.test(html) && /og:url" content="https:\/\/beta\.layerpitch\.com\/jean\/"/.test(html) && /twitter:card" content="summary_large_image"/.test(html));
  check('texte échappé : aucune balise injectée', !/<compose>/.test(html));
  const rpc = calls.find(c => c.u.includes('get_share_preview'));
  check('appel de la base : clé publique et paramètres de l\'adresse', rpc && JSON.parse(rpc.opts.body).p_handle === 'jean' && JSON.parse(rpc.opts.body).p_kind === 'adreel' && !!rpc.opts.headers.apikey);
  calls.length = 0;
  res = await W.default.fetch(req('/jean/', 'Mozilla/5.0 Firefox/130.0'), {});
  check('visiteur humain : transmis tel quel, la base n\'est même pas interrogée', (await res.text()) === 'page normale' && !calls.some(c => c.u.includes('get_share_preview')));
  res = await W.default.fetch(req('/jean/', 'LinkedInBot/1.0', 'POST'), {});
  check('méthode autre que GET/HEAD : transmise', (await res.text()) === 'page normale');
  res = await W.default.fetch(req('/shop', 'LinkedInBot/1.0'), {});
  check('page sans aperçu propre : transmise', (await res.text()) === 'page normale');
  global.__preview = null;
  res = await W.default.fetch(req('/inconnu/', 'LinkedInBot/1.0'), {});
  check('adresse inconnue : transmise (comportement d\'avant)', (await res.text()) === 'page normale');
  global.fetch = async (u) => { if (String(u).includes('get_share_preview')) throw new Error('réseau'); return new Response('page normale'); };
  res = await W.default.fetch(req('/jean/', 'LinkedInBot/1.0'), {});
  check('base injoignable : transmise, jamais d\'erreur pour le robot', (await res.text()) === 'page normale');
  global.__preview = { kind: 'collection', title: 'Collection', descriptionFr: '', descriptionEn: '', image: null, lang: 'fr' };
  global.fetch = async (u) => (String(u).includes('get_share_preview') ? ok(global.__preview) : new Response('x'));
  html = await (await W.default.fetch(req('/jean/collection.html?id=co1&lang=en', 'facebookexternalhit/1.1'), {})).text();
  check('sans description ni image : texte et image LayerPitch par défaut (langue demandée)', /Interactive music for game pitches/.test(html) && /og:image" content="https:\/\/beta\.layerpitch\.com\/og-default\.png"/.test(html));
  global.fetch = realFetch;
  const code = fs.readFileSync(path.join(__dirname, 'cloudflare', 'apercu-liens-worker.mjs'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/.*$/, '')).join('\n');
  check('programme Cloudflare : aucun caractère non ASCII dans le code (le presse-papiers abîmait « … »)', !/[^\x00-\x7F]/.test(code));
  const png = fs.readFileSync(path.join(__dirname, 'og-default.png'));
  check('image par défaut : PNG 1200 × 630', png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630);

  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
