// Achat réel d'un album, compte créé à l'achat (29/09) : feu vert, recherche du compte par e-mail (base jetable PGlite) ;
// page /album/<id> : prix libre, e-mail du visiteur, appel de la fonction, gel avant ouverture (jsdom) ; fonctions (contrôles de texte).
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 8; i++) await tick(); };
(async () => {
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); } catch (e) { console.log('FAIL - PGlite absent'); process.exit(1); }
  const db = await freshDb();
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const q = async (s, a) => (await db.query(s, a)).rows;
  await q(`insert into auth.users (id, email) values ($1, 'Fan@X.test'), ($2, 'admin@x.test')`, [U(1), U(2)]);
  await q(`insert into public.profiles (id) values ($1), ($2) on conflict do nothing`, [U(1), U(2)]);
  await q(`insert into public.admins (profile_id) values ($1)`, [U(2)]);
  await as(0);
  check('feu vert fermé : achat fermé pour un visiteur', (await q(`select public.album_checkout_status() s`))[0].s.open === false);
  await as(1);
  check('fermé pour un compte ordinaire', (await q(`select public.album_checkout_status() s`))[0].s.open === false);
  await as(2);
  check('ouvert pour un administrateur', (await q(`select public.album_checkout_status() s`))[0].s.open === true);
  await db.query(`update public.feature_flags set released = true where key = 'album_checkout'`);
  await as(0);
  check('feu vert donné : ouvert pour un visiteur', (await q(`select public.album_checkout_status() s`))[0].s.open === true);
  check('user_id_by_email : retrouve le compte (casse et espaces ignorés), sinon null', (await q(`select public.user_id_by_email('  fan@x.TEST ') u`))[0].u === U(1) && (await q(`select public.user_id_by_email('inconnu@x.test') u`))[0].u === null);
  let denied = false; try { await db.query(`set role anon`); await db.query(`select public.user_id_by_email('fan@x.test')`); } catch (e) { denied = true; } finally { await db.query(`reset role`); }
  check('user_id_by_email : refusée à un visiteur (service seulement)', denied);

  // ---- page ----
  const html = fs.readFileSync(path.join(__dirname, 'album.html'), 'utf8');
  const sb = { window: {} }; require('vm').createContext(sb);
  const inline = html.match(/<script>\n\/\/ album\.html[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  async function page({ search, session, admin, open, min }) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/album.html' + (search || '?s=ost&lang=fr') });
    const w = dom.window, calls = { invoke: [], claim: 0, href: null };
    const album = { id: 'ost', title: 'OST', illustration: null, presentationFr: '', priceEurCents: min, tags: [], sellerName: 'X', sellerRole: 'composer', listenMode: 'none', tracks: [] };
    w.LayerPitchSupabaseClient = { getClient: () => ({
      rpc: async (n) => ({ data: n === 'get_public_album' ? album : n === 'is_admin' ? !!admin : n === 'album_checkout_status' ? { open } : n === 'claim_test_album' ? (calls.claim++, { alreadyOwned: false }) : null, error: null }),
      auth: { getSession: async () => ({ data: { session: session ? {} : null } }) },
      functions: { invoke: async (name, o) => { calls.invoke.push({ name, body: o.body }); return { data: { ok: true, url: 'https://checkout.stripe.test/x' }, error: null }; } } }) };
    w.eval(inline); await flush();
    return { w, d: w.document, calls };
  }
  let s = await page({ open: false, session: false, min: 500 });
  check('paiement fermé, visiteur : bouton grisé, message « connecte-toi »', s.d.getElementById('buyBtn').disabled && /Connecte-toi/.test(s.d.getElementById('buyNote').textContent) && !s.d.getElementById('buyAmount'));
  s = await page({ open: false, session: true, admin: true, min: 500 });
  s.d.getElementById('buyBtn').click(); await flush();
  check('paiement fermé, admin : l\'achat de test (sans paiement) reste disponible', s.calls.claim === 1 && s.calls.invoke.length === 0);
  s = await page({ open: true, session: false, min: 500 });
  check('paiement ouvert, visiteur : champ du prix (5,00 au départ), champ e-mail, bouton actif', s.d.getElementById('buyAmount').value === '5.00' && !!s.d.getElementById('buyEmail') && !s.d.getElementById('buyBtn').disabled && s.d.getElementById('buyBtn').textContent === 'Acheter');
  s.d.getElementById('buyEmail').value = 'pas-un-mail'; s.d.getElementById('buyBtn').click(); await flush();
  check('e-mail invalide : refusé côté page, rien envoyé', /adresse e-mail valide/.test(s.d.getElementById('buyNote').textContent) && !s.calls.invoke.length);
  s.d.getElementById('buyEmail').value = 'fan@x.test'; s.d.getElementById('buyAmount').value = '3';
  s.d.getElementById('buyBtn').click(); await flush();
  check('montant sous le minimum : refusé, rien envoyé', /au moins/.test(s.d.getElementById('buyNote').textContent) && !s.calls.invoke.length);
  s.d.getElementById('buyAmount').value = '7,5'; s.d.getElementById('buyBtn').click(); await flush();
  const call = s.calls.invoke[0];
  check('achat visiteur : fonction appelée avec album, 750 centimes, e-mail et retour sur la page de l\'album', call && call.name === 'create-album-checkout-session' && call.body.albumId === 'ost' && call.body.amountCents === 750 && call.body.email === 'fan@x.test' && /album\.html\?purchased=1$/.test(call.body.successUrl));
  s = await page({ open: true, session: true, admin: false, min: 500 });
  check('paiement ouvert, connecté : pas de champ e-mail', !s.d.getElementById('buyEmail') && !!s.d.getElementById('buyAmount'));
  s.d.getElementById('buyBtn').click(); await flush();
  check('connecté : achat sans e-mail, retour sur « mes albums »', s.calls.invoke[0].body.email === undefined && /mes-albums\.html\?purchased=1/.test(s.calls.invoke[0].body.successUrl));
  s = await page({ open: true, session: true, admin: true, min: 500 });
  check('admin, paiement ouvert : lien « Achat de test (sans paiement) » en plus', /Achat de test/.test(s.d.body.textContent));
  s = await page({ open: true, session: false, min: 0 });
  check('album à prix libre pur (minimum 0) : pas de champ de prix', !s.d.getElementById('buyAmount'));
  s = await page({ open: true, session: false, min: 500, search: '?s=ost&lang=fr&purchased=1' });
  check('retour de paiement (?purchased=1) : message « lien de connexion envoyé »', /lien de connexion/.test(s.d.getElementById('buyNote').textContent));

  // ---- fonctions ----
  const fn = fs.readFileSync(path.join(__dirname, 'supabase/functions/create-album-checkout-session/index.ts'), 'utf8');
  const wh = fs.readFileSync(path.join(__dirname, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
  check('fonction de paiement : visiteur accepté avec e-mail, feu vert vérifié, e-mail transmis à Stripe et dans les métadonnées', /album_checkout_status/.test(fn) && /customer_email: guestEmail/.test(fn) && /buyerEmail: guestEmail/.test(fn) && /Adresse e-mail requise/.test(fn));
  check('webhook : compte retrouvé ou créé sans mot de passe, lien de connexion envoyé, vente non défaite en cas d\'échec d\'envoi', /user_id_by_email/.test(wh) && /createUser\(\{ email: md\.buyerEmail, email_confirm: true \}\)/.test(wh) && /signInWithOtp/.test(wh) && /login link failed/.test(wh));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
