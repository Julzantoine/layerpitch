// Page Shop (shop.html, 29/09) : deux rayons, filtres, fermeture avant feu vert, cartes, crédits, redirection du catalogue,
// bouton « Contacter le vendeur ». jsdom avec de faux services.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 8; i++) await tick(); };
const html = fs.readFileSync(path.join(__dirname, 'shop.html'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8');
const inline = html.match(/<script>\n\/\/ shop\.html[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const cat = fs.readFileSync(path.join(__dirname, 'catalogue.html'), 'utf8');
check('catalogue.html redirige vers le Shop (assets), langue conservée', /shop\.html\?tab=assets/.test(cat) && /lang=en/.test(cat) && !/catalog\.html/.test(cat));

const sb = { window: {} }; vm.createContext(sb); vm.runInContext(i18nSrc, sb);
const I = sb.window.LAYERPITCH_I18N;
check('textes du Shop et du contact vendeur présents en FR et EN', ['pageTitle', 'h1', 'tabAssets', 'tabOst', 'searchPlaceholder', 'allStyles', 'priceFrom', 'priceFree', 'freeOne', 'freeMany', 'emptyOst', 'comingSoonTitle', 'comingSoonHint'].every(k => I.fr.shop[k] && I.en.shop[k]) && ['title', 'hint', 'send', 'sent', 'error'].every(k => I.fr.sellerContact[k] && I.en.sellerContact[k]) && !!I.fr.shell.item_shop);

const PACKS = [
  { id: 'p1', title: 'Pack Forêt', illustration: null, tags: ['ambient'], price_eur_cents: 1500, subscriber_credits: 2, composer_name: 'Jean', composer_handle: 'jean', track_count: 5, sfx_count: 3, updated_at: '2026-09-01' },
  { id: 'p2', title: 'Pack Combat', illustration: null, tags: ['epic'], price_eur_cents: 800, subscriber_credits: 0, composer_name: 'Marie', composer_handle: null, track_count: 1, sfx_count: 0, updated_at: '2026-09-02' },
];
const ALBUMS = [
  { id: 'a1', title: 'OST Forêt', illustration: 'c/a1.png', tags: ['ambient'], price_eur_cents: 500, seller_name: 'Studio Mousse', seller_role: 'studio', track_count: 8, free_track_count: 2, updated_at: '2026-09-03' },
  { id: 'a2', title: 'OST Libre', illustration: null, tags: [], price_eur_cents: 0, seller_name: 'jean', seller_role: 'composer', track_count: 1, free_track_count: 0, updated_at: '2026-09-04' },
];
async function page({ open, search, session, credits }) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${body}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/shop.html' + (search || '') });
  const w = dom.window, calls = { take: [], shell: 0 };
  w.eval(i18nSrc);
  w.LayerPitchShell = { mount: () => { calls.shell++; } };
  w.LayerPitchAlbums = { shopStatus: async () => ({ open }), shopAlbums: async () => ({ albums: ALBUMS, error: null }) };
  w.LayerPitchStudio = { catalog: async () => ({ packs: PACKS, error: null }), myCredits: async () => ({ credits: credits || null }), takePackWithCredits: async id => { calls.take.push(id); return { ok: true, balance: 1 }; } };
  w.LayerPitchAuth = { getSession: async () => ({ session: session ? {} : null }) };
  w.eval(inline); await flush();
  return { w, d: w.document, calls };
}
const cards = d => [...d.querySelectorAll('#grid .pack')];
const set = (w, el, v, ev) => { el.value = v; el.dispatchEvent(new w.Event(ev || 'input', { bubbles: true })); };

(async () => {
  let s = await page({ open: false });
  check('shop fermé : message « ouvre bientôt », aucune carte, filtres cachés', /Le shop ouvre bientôt/.test(s.d.body.textContent) && cards(s.d).length === 0 && s.d.getElementById('filters').hidden);

  s = await page({ open: true });
  check('ouvert : rayon « Assets audio » par défaut avec les 2 packs', cards(s.d).length === 2 && s.d.getElementById('tabAssets').getAttribute('aria-selected') === 'true' && /Pack Forêt/.test(s.d.body.textContent));
  check('carte de pack : prix, compositeur, morceaux et Sfx, crédits, lien pack.html (+ identifiant du compositeur)', /15[\s\u00a0\u202f]€/.test(cards(s.d)[0].textContent) && /par Jean/.test(cards(s.d)[0].textContent) && /5 morceaux · 3 Sfx/.test(cards(s.d)[0].textContent) && /2 crédits/.test(cards(s.d)[0].textContent) && /pack\.html\?id=p1&amp;lang=fr&amp;u=jean/.test(cards(s.d)[0].innerHTML));
  s.d.getElementById('tabOst').click(); await flush();
  check('rayon « OST adaptive » : les 2 albums, adresse mise à jour (?tab=ost)', cards(s.d).length === 2 && /OST Forêt/.test(s.d.body.textContent) && s.w.location.search === '?tab=ost');
  check('carte d\'album : vendeur (nom du studio), morceaux et écoute libre, prix « À partir de », lien /album/<id>', /par Studio Mousse/.test(cards(s.d)[0].textContent) && /8 morceaux · 2 morceaux en écoute libre/.test(cards(s.d)[0].textContent) && /À partir de 5[\s\u00a0\u202f]€/.test(cards(s.d)[0].textContent) && /href="\/album\/a1"/.test(cards(s.d)[0].innerHTML));
  check('album à prix libre : « Prix libre »', /Prix libre/.test(cards(s.d)[1].textContent));
  set(s.w, s.d.getElementById('q'), 'mousse'); 
  check('recherche par vendeur : un seul album', cards(s.d).length === 1 && /OST Forêt/.test(cards(s.d)[0].textContent));
  set(s.w, s.d.getElementById('q'), 'zzz');
  check('recherche sans résultat : message', /Rien ne correspond/.test(s.d.getElementById('grid').textContent));
  set(s.w, s.d.getElementById('q'), '');
  const tagOpts = [...s.d.getElementById('tagSel').options].map(o => o.value);
  check('filtre de style : les styles du rayon courant seulement', tagOpts.join() === ',ambient');
  set(s.w, s.d.getElementById('tagSel'), 'ambient', 'change');
  check('filtre de style : un album', cards(s.d).length === 1);
  set(s.w, s.d.getElementById('tagSel'), '', 'change');
  set(s.w, s.d.getElementById('sort'), 'priceDesc', 'change');
  check('tri par prix décroissant', /OST Forêt/.test(cards(s.d)[0].textContent));
  s.d.getElementById('tabAssets').click(); await flush();
  check('retour aux assets : filtres remis à zéro, styles des packs (ambient, epic)', [...s.d.getElementById('tagSel').options].map(o => o.value).join() === ',ambient,epic' && cards(s.d).length === 2);

  s = await page({ open: true, search: '?tab=ost' });
  check('adresse ?tab=ost : ouvre le rayon OST adaptive', s.d.getElementById('tabOst').getAttribute('aria-selected') === 'true' && /OST Forêt/.test(s.d.body.textContent));

  s = await page({ open: true, session: true, credits: { monthly: 5, balance: 3 } });
  check('studio abonné : solde de crédits et bouton « Prendre avec 2 crédit(s) » sur le pack éligible', !s.d.getElementById('creditsBar').hidden && /3 crédit/.test(s.d.getElementById('creditsBar').textContent) && !!s.d.querySelector('[data-take="p1"]') && !s.d.querySelector('[data-take="p2"]'));
  s.d.querySelector('[data-take="p1"]').click(); await flush();
  check('prise en crédits : appel serveur, carte marquée « Dans ta bibliothèque »', s.calls.take[0] === 'p1' && /Dans ta bibliothèque/.test(s.d.body.textContent));

  // Contacter le vendeur
  const contact = fs.readFileSync(path.join(__dirname, 'layerpitch-seller-contact.js'), 'utf8');
  const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only', url: 'http://localhost/album.html' });
  const w = dom.window, fetched = [];
  w.LAYERPITCH_I18N = I;
  w.fetch = async (url, o) => { fetched.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => ({}) }; };
  w.eval(contact);
  w.LayerPitchSellerContact.mount(w.document.getElementById('c'), { kind: 'album', id: 'a1' });
  const form = w.document.querySelector('form');
  form.querySelector('[name=name]').value = 'Bob'; form.querySelector('[name=email]').value = 'b@x.test'; form.querySelector('[name=message]').value = 'Version courte ?';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await flush();
  check('contact vendeur (album) : envoyé à submit-contact-message avec albumId, nom, e-mail et message', /submit-contact-message$/.test(fetched[0].url) && JSON.stringify(fetched[0].body) === JSON.stringify({ name: 'Bob', email: 'b@x.test', message: 'Version courte ?', albumId: 'a1' }) && /Message envoyé/.test(w.document.body.textContent));
  w.LayerPitchSellerContact.mount(w.document.getElementById('c'), { kind: 'pack', id: 'p1' });
  const f2 = w.document.querySelector('form'); f2.querySelector('[name=name]').value = 'B'; f2.querySelector('[name=email]').value = 'b@x.test'; f2.querySelector('[name=message]').value = 'm';
  w.fetch = async () => ({ ok: false, json: async () => ({ error: 'Pack introuvable.' }) });
  f2.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await flush();
  check('contact vendeur : l\'erreur du serveur est affichée, le bouton se réactive', /Pack introuvable/.test(w.document.body.textContent) && !w.document.querySelector('button').disabled);
  // pages
  const albumPage = fs.readFileSync(path.join(__dirname, 'album.html'), 'utf8'), packPage = fs.readFileSync(path.join(__dirname, 'pack.html'), 'utf8');
  check('album.html et pack.html chargent le module et ont leur emplacement « Contacter le vendeur »', /layerpitch-seller-contact\.js/.test(albumPage) && /id="sellerContact"/.test(albumPage) && /layerpitch-seller-contact\.js/.test(packPage) && /id="sellerContact"/.test(packPage) && /kind: 'pack'/.test(packPage));
  const fn = fs.readFileSync(path.join(__dirname, 'supabase/functions/submit-contact-message/index.ts'), 'utf8');
  check('fonction de contact : packId / albumId acceptés, en vente seulement, destinataire retrouvé côté serveur', /packId, albumId/.test(fn) && /!pack\.buyable/.test(fn) && /!album\.buyable/.test(fn) && /getUserById/.test(fn) && /contact_messages/.test(fn));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
