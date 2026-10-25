// Page publique annuaire.html (23/10) : fermée avant le feu vert, cartes (nom, bio, mots-clés, lien vers l'AdReel principal),
// recherche, filtre par mot-clé, bouton « Contacter ». jsdom avec de faux services.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 8; i++) await tick(); };
const html = fs.readFileSync(path.join(__dirname, 'annuaire.html'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8');
const inline = html.match(/<script>\n\/\/ annuaire\.html[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const COMPOSERS = [
  { handle: 'bob', name: 'Bob Orchestre', bio: 'Musique de RPG.', photo: 'bob.jpg', photo_frame: { x: 30, y: 60, zoom: 1.5 }, keywords: ['orchestral', 'RPG'], tier: 'pro' },
  { handle: 'ana', name: 'Ana', bio: null, photo: null, keywords: ['chiptune'], tier: 'free' },
];
async function page({ open, search }) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${body}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/annuaire.html' + (search || '') });
  const w = dom.window, calls = { contact: [] };
  w.eval(i18nSrc);
  w.CSS = { escape: s => s };
  w.LayerPitchPhotoFrame = require('./layerpitch-photo-frame.js');
  w.LayerPitchShell = { mount: () => {} };
  w.LayerPitchAuth = { getSession: async () => ({ session: null }) };
  w.LayerPitchComposers = { directoryStatus: async () => ({ open }), directory: async () => ({ composers: COMPOSERS, error: null }) };
  w.LayerPitchSellerContact = { mount: (host, o) => { calls.contact.push(o); host.innerHTML = '<details class="lp-seller-contact"></details>'; } };
  w.eval(inline); await flush();
  return { w, d: w.document, calls };
}
const cards = d => [...d.querySelectorAll('#grid .card')];
const set = (w, el, v, ev) => { el.value = v; el.dispatchEvent(new w.Event(ev || 'input', { bubbles: true })); };
(async () => {
  let s = await page({ open: false });
  check('fermé : message « ouvre bientôt », aucune carte, filtres cachés', /ouvre bientôt/.test(s.d.body.textContent) && cards(s.d).length === 0 && s.d.getElementById('filters').hidden);
  s = await page({ open: true });
  check('ouvert : une carte par compositeur, dans l\'ordre reçu', cards(s.d).length === 2 && cards(s.d)[0].dataset.handle === 'bob');
  const c0 = cards(s.d)[0];
  check('carte : nom, bio, mots-clés, photo', /Bob Orchestre/.test(c0.textContent) && /Musique de RPG/.test(c0.textContent) && /orchestral/.test(c0.textContent) && /images\/bob\.jpg/.test(c0.querySelector('img').src));
  check('cadrage de la photo transmis à l\'image', JSON.parse(c0.querySelector('img').dataset.frame).zoom === 1.5);
  check('un clic mène à l\'AdReel principal (/<identifiant>/)', c0.querySelector('a.card-link').getAttribute('href') === '/bob/');
  check('sans photo : pastille neutre, pas d\'image cassée', !cards(s.d)[1].querySelector('img') && !!cards(s.d)[1].querySelector('.photo'));
  check('mots-clés du filtre : tous ceux de la liste, triés', [...s.d.getElementById('kwSel').options].map(o => o.value).join() === ',chiptune,orchestral,RPG');
  set(s.w, s.d.getElementById('kwSel'), 'chiptune', 'change');
  check('filtre par mot-clé', cards(s.d).length === 1 && cards(s.d)[0].dataset.handle === 'ana');
  set(s.w, s.d.getElementById('kwSel'), '', 'change');
  set(s.w, s.d.getElementById('q'), 'rpg');
  check('recherche libre (nom, bio, mots-clés, sans tenir compte des majuscules)', cards(s.d).length === 1 && cards(s.d)[0].dataset.handle === 'bob');
  set(s.w, s.d.getElementById('q'), 'zzz');
  check('recherche sans résultat : message', /Aucun compositeur/.test(s.d.getElementById('grid').textContent));
  set(s.w, s.d.getElementById('q'), '');
  cards(s.d)[0].querySelector('[data-contact]').click();
  check('« Contacter » : formulaire monté pour cet identifiant', s.calls.contact.length === 1 && s.calls.contact[0].kind === 'composer' && s.calls.contact[0].id === 'bob' && s.calls.contact[0].name === 'Bob Orchestre');
  cards(s.d)[0].querySelector('[data-contact]').click();
  check('second clic : referme le formulaire', cards(s.d)[0].querySelector('[data-contact-host]').innerHTML === '');
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
