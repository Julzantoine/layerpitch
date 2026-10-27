// AdReels trouvables sur Google et par les IA de recherche (27/10, chantier SEO/GEO) :
// 1) les fonctions de base get_seo_adreel_page / list_seo_adreels (PGlite) : seuls les AdReels publics, case « Indexable »
//    cochée, compositeur admin tant que le feu vert « search_indexing » est fermé ;
// 2) le programme Cloudflare : page servie aux moteurs, plan du site, robots d'entraînement jamais servis, aperçus en noindex ;
// 3) robots.txt (IA de recherche oui, entraînement non) et données structurées de la nouvelle landing à jour.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  for (const [n, handle] of [[1, 'jean'], [2, 'marie']]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), handle + '@x.test']);
    await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]);
  }
  const c1 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'jean') returning id`, [U(1)]))[0].id;
  const c2 = (await q(`insert into public.composer_profiles (profile_id, handle) values ($1, 'marie') returning id`, [U(2)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(1)]);
  const reel = (owner, id, slug, profile) => q(`insert into public.ad_reels (id, owner_id, label, lang, profile, blocks, slug) values ($1, $2, $1, 'fr', $3::jsonb, '[]'::jsonb, $4)`,
    [id, owner, JSON.stringify(profile || {}), slug]);
  await reel(c1, 'main', null, { title: 'Jean compose', subtitle: 'Musique adaptative pour RPG' });
  await reel(c1, 'r2', 'demo', { title: 'Démo' });
  await reel(c1, 'r3', null, { title: 'Sans adresse' });
  await reel(c1, 'r4', null, { title: 'Privé' });
  await reel(c2, 'main', null, { title: 'Marie compose' });
  await q(`update public.ad_reels set access_mode = 'password' where owner_id = $1 and id = 'r4'`, [c1]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('t1', $1, 'Forêt calme', 'static'), ('t2', $1, 'Combat', 'static'), ('t3', $1, '', 'static')`, [c1]);
  await q(`insert into public.ad_reel_tracks (ad_reel_id, track_id, position, owner_id) values ('main', 't2', 1, $1), ('main', 't1', 0, $1), ('main', 't3', 2, $1)`, [c1]);

  const P = (handle, ref, alt) => val(`select public.get_seo_adreel_page($1, $2, $3)`, [handle, ref || '', alt || '']);
  let r = await P('jean');
  check('AdReel principal d\'un admin : titre, description, adresse, morceaux dans l\'ordre (titres vides écartés)',
    r && r.title === 'Jean compose' && r.descriptionFr === 'Musique adaptative pour RPG' && r.path === '/jean/' && JSON.stringify(r.tracks) === '["Forêt calme","Combat"]' && r.handle === 'jean');
  check('adresse choisie : /<nom>/<adresse>', (await P('jean', 'demo')).path === '/jean/demo');
  check('sans adresse choisie : /<nom>/?adreel=<code>', (await P('jean', '', 'r3')).path === '/jean/?adreel=r3');
  check('adresse inconnue : null (pas de repli sur l\'AdReel principal)', (await P('jean', 'nimporte')) === null);
  check('AdReel protégé (mot de passe) : null', (await P('jean', '', 'r4')) === null);
  await q(`update public.ad_reels set allow_indexing = false where owner_id = $1 and id = 'r3'`, [c1]);
  check('case « Indexable » décochée : null', (await P('jean', '', 'r3')) === null);
  check('feu vert fermé : compositeur non admin jamais servi', (await P('marie')) === null);
  check('compositeur inconnu : null', (await P('personne')) === null);
  let list = await val(`select public.list_seo_adreels()`);
  check('plan du site : les AdReels servis seulement', JSON.stringify(list.map(x => x.path)) === '["/jean/","/jean/demo"]' && list.every(x => x.updatedAt));
  await q(`update public.feature_flags set released = true where key = 'search_indexing'`);
  check('feu vert donné : compositeur non admin servi', (await P('marie')).path === '/marie/');
  list = await val(`select public.list_seo_adreels()`);
  check('feu vert donné : plan du site complet', JSON.stringify(list.map(x => x.path)) === '["/jean/","/jean/demo","/marie/"]');
  check('visiteur anonyme : fonctions publiques ouvertes, garde interne fermée',
    (await val(`select has_function_privilege('anon', 'public.get_seo_adreel_page(text, text, text)', 'execute')`))
    && (await val(`select has_function_privilege('anon', 'public.list_seo_adreels()', 'execute')`))
    && !(await val(`select has_function_privilege('anon', 'public.seo_adreel_allowed(uuid, text)', 'execute')`)));

  // ---- Programme Cloudflare ----
  const W = await import('./cloudflare/apercu-liens-worker.mjs');
  check('moteurs et IA de recherche reconnus', ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'OAI-SearchBot/1.0', 'ChatGPT-User/1.0', 'PerplexityBot/1.0', 'Claude-SearchBot/1.0', 'Claude-User/1.0'].every(W.isSearchBot));
  check('robots d\'entraînement et navigateurs non servis', !['GPTBot/1.0', 'ClaudeBot/1.0', 'CCBot/2.0', 'Google-Extended', 'Mozilla/5.0 Firefox/130.0', ''].some(W.isSearchBot));
  const html = W.seoHtml({ title: 'Jean <compose>', handle: 'jean', descriptionFr: 'Musique', lang: 'fr', path: '/jean/', tracks: ['Forêt', '</script>x'], updatedAt: '2026-10-27T10:00:00Z', image: null });
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  check('page moteur : indexable, adresse officielle, texte lisible sans JavaScript',
    html.includes('content="index, follow"') && html.includes('<link rel="canonical" href="https://beta.layerpitch.com/jean/">') && html.includes('<h1>Jean &lt;compose&gt;</h1>') && html.includes('<li>Forêt</li>'));
  check('données structurées MusicPlaylist, sans fermeture de balise injectable', ld['@type'] === 'MusicPlaylist' && ld.track.length === 2 && ld.track[1].name === '</script>x' && !/<\/script>x/.test(html.split('</script>')[0]));
  const xml = W.sitemapXml([{ path: '/jean/', updatedAt: '2026-10-27T10:00:00Z' }, { path: '/jean/?adreel=r3&x' }]);
  check('plan du site : adresses complètes, date du jour, caractères échappés', xml.includes('<loc>https://beta.layerpitch.com/jean/</loc><lastmod>2026-10-27</lastmod>') && xml.includes('?adreel=r3&amp;x'));
  check('aperçu des réseaux sociaux : jamais indexé (noindex)', W.previewHtml({ title: 'T' }, new URL('https://beta.layerpitch.com/jean/')).includes('content="noindex"'));

  // Requêtes simulées (fetch remplacé) : moteur servi, moteur sur AdReel non indexable, visiteur, plan du site.
  const seoPage = { title: 'Jean compose', handle: 'jean', lang: 'fr', path: '/jean/', tracks: [] };
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.url;
    calls.push(u);
    if (u.includes('/rpc/get_seo_adreel_page')) { const b = JSON.parse(init.body); return new Response(JSON.stringify(b.p_handle === 'jean' ? seoPage : null)); }
    if (u.includes('/rpc/list_seo_adreels')) return new Response(JSON.stringify([{ path: '/jean/' }]));
    if (u.includes('/rpc/get_share_preview')) return new Response(JSON.stringify({ title: 'Aperçu' }));
    return new Response('ORIGINE', { status: 404 });
  };
  const go = (p, ua) => W.default.fetch(new Request('https://beta.layerpitch.com' + p, { headers: { 'User-Agent': ua } }), {});
  let res = await go('/jean/', 'Googlebot/2.1');
  check('Googlebot sur un AdReel indexable : 200 et page complète', res.status === 200 && (await res.text()).includes('index, follow'));
  res = await go('/marie/', 'Googlebot/2.1');
  check('Googlebot sur un AdReel non indexable : réponse d\'origine (404)', res.status === 404 && (await res.text()) === 'ORIGINE');
  const before = calls.length;
  res = await go('/jean/', 'Mozilla/5.0 Firefox/130.0');
  check('visiteur humain : réponse d\'origine, aucune base interrogée', (await res.text()) === 'ORIGINE' && calls.slice(before).every(u => !u.includes('/rpc/')));
  res = await go('/sitemap-adreels.xml', 'Mozilla/5.0 Firefox/130.0');
  check('plan du site servi à tous, en XML', res.status === 200 && res.headers.get('Content-Type').startsWith('application/xml') && (await res.text()).includes('/jean/'));
  res = await go('/jean/', 'LinkedInBot/1.0');
  check('robot de partage : aperçu inchangé', res.status === 200 && (await res.text()).includes('Aperçu'));

  // ---- robots.txt et nouvelle landing ----
  const robots = fs.readFileSync(path.join(__dirname, 'robots.txt'), 'utf8');
  const blocked = ua => new RegExp(`User-agent: ${ua}\\nDisallow: /`).test(robots);
  check('robots.txt : robots d\'entraînement refusés', ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended'].every(blocked));
  check('robots.txt : IA de recherche jamais refusées, plan du site annoncé',
    !['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User', 'Googlebot'].some(blocked)
    && robots.includes('User-agent: *\nAllow: /') && robots.includes('Sitemap: https://beta.layerpitch.com/sitemap-adreels.xml'));
  const ldCheck = spawnSync(process.execPath, ['scripts/landing-structured-data.js', '--check'], { cwd: __dirname, encoding: 'utf8' });
  check('données structurées de la landing à jour avec la FAQ (sinon : node scripts/landing-structured-data.js)', ldCheck.status === 0);
  check('llms.txt présent dans la nouvelle landing', fs.existsSync(path.join(__dirname, 'nouvelle-landing', 'llms.txt')));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
