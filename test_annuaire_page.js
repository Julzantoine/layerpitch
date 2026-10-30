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
const pickerSrc = fs.readFileSync(path.join(__dirname, 'layerpitch-tag-picker.js'), 'utf8');
const inline = html.match(/<script>\n\/\/ annuaire\.html[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const COMPOSERS = [
  { handle: 'bob', name: 'Bob Orchestre', bio: 'Musique de RPG.', photo: 'bob.jpg', photo_frame: { x: 30, y: 60, zoom: 1.5 }, keywords: ['orchestral', 'RPG'], tier: 'pro' },
  { handle: 'ana', name: 'Ana', bio: null, photo: null, keywords: ['chiptune', 'RPG'], tier: 'free' },
];
async function page({ open, search }) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${body}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/annuaire.html' + (search || '') });
  const w = dom.window, calls = { contact: [] };
  w.eval(i18nSrc);
  w.CSS = { escape: s => s };
  w.LayerPitchPhotoFrame = require('./layerpitch-photo-frame.js');
  w.LayerPitchShell = { mount: () => {} };
  w.LayerPitchAuth = { getSession: async () => ({ session: null }) };
  w.eval(pickerSrc);
  w.LayerPitchComposers = { directoryStatus: async () => ({ open }), directory: async () => ({ composers: COMPOSERS, error: null }), directoryTags: async () => ({ tags: [{ id: 1, label: 'RPG', aliases: ['Jeu de rôle'], uses: 2 }, { id: 2, label: 'Wwise', aliases: [], uses: 0 }], error: null }) };
  w.LayerPitchSellerContact = { mount: (host, o) => { calls.contact.push(o); host.innerHTML = '<details class="lp-seller-contact"></details>'; } };
  w.eval(inline); await flush();
  return { w, d: w.document, calls };
}
const cards = d => [...d.querySelectorAll('#grid .card')].filter(c => !c.hidden);
const set = (w, el, v, ev) => { el.value = v; el.dispatchEvent(new w.Event(ev || 'input', { bubbles: true })); };
const pickTag = (s, text) => {
  const input = s.d.querySelector('#tagFilter input'); input.dispatchEvent(new s.w.Event('focus')); set(s.w, input, text);
  input.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};
const clearTags = s => { while (s.d.querySelector('#tagFilter [data-rm]')) s.d.querySelector('#tagFilter [data-rm]').click(); };
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
  const fInput = s.d.querySelector('#tagFilter input');
  fInput.dispatchEvent(new s.w.Event('focus'));
  const opts = [...s.d.querySelectorAll('#tagFilter .lp-tags-opt')].map(o => o.textContent);
  check('filtre : liste commune + tags des fiches, nombre de fiches, le plus présent d\'abord', opts[0] === 'RPG2' && opts.includes('Wwise0') && opts.includes('chiptune1'));
  pickTag(s, 'chiptune');
  check('filtre par tag', cards(s.d).length === 1 && cards(s.d)[0].dataset.handle === 'ana');
  clearTags(s);
  pickTag(s, 'jeu de role');
  check('filtre : un alias (sans accent) trouve le tag', s.d.querySelector('#tagFilter .lp-tag-chip').textContent.startsWith('RPG') && cards(s.d).length === 2);
  pickTag(s, 'orchestral');
  check('filtre sur plusieurs tags : il faut les avoir tous', cards(s.d).length === 1 && cards(s.d)[0].dataset.handle === 'bob');
  clearTags(s);
  pickTag(s, 'inconnu');
  check('filtre : pas de création de tag pour un studio', !s.d.querySelector('#tagFilter .lp-tag-chip') && cards(s.d).length === 2);
  set(s.w, fInput, '');
  set(s.w, s.d.getElementById('q'), 'rpg');
  check('recherche libre (nom, bio, tags, sans tenir compte des majuscules)', cards(s.d).length === 2);
  set(s.w, s.d.getElementById('q'), 'orchestre');
  check('recherche libre : le nom', cards(s.d).length === 1 && cards(s.d)[0].dataset.handle === 'bob');
  set(s.w, s.d.getElementById('q'), 'zzz');
  check('recherche sans résultat : message', /Aucun compositeur/.test(s.d.getElementById('grid').textContent));
  set(s.w, s.d.getElementById('q'), '');
  cards(s.d)[0].querySelector('[data-contact]').click();
  check('« Contacter » : formulaire monté pour cet identifiant', s.calls.contact.length === 1 && s.calls.contact[0].kind === 'composer' && s.calls.contact[0].id === 'bob' && s.calls.contact[0].name === 'Bob Orchestre');
  cards(s.d)[0].querySelector('[data-contact]').click();
  check('second clic : referme le formulaire', cards(s.d)[0].querySelector('[data-contact-host]').innerHTML === '');
  check('écoute : aucun lecteur chargé avant le clic', !s.d.querySelector('iframe'));
  const listenBtn = h => s.d.querySelector(`[data-listen="${h}"]`);
  listenBtn('bob').click();
  const fr = () => [...s.d.querySelectorAll('iframe')];
  check('« Écouter » : mode intégration de cet identifiant, sur place', fr().length === 1 && fr()[0].getAttribute('src') === 'index.html?u=bob&embed=1&from=directory' && !!s.d.querySelector('.card[data-handle="bob"] iframe') && s.d.querySelector('.card[data-handle="bob"]').classList.contains('listening'));
  const firstFrame = fr()[0];
  set(s.w, s.d.getElementById('q'), 'bob');
  check('filtrer sans cacher la carte ne coupe pas la musique', fr()[0] === firstFrame);
  set(s.w, s.d.getElementById('q'), '');
  listenBtn('ana').click();
  check('un seul lecteur : ouvrir un autre ferme le précédent', fr().length === 1 && fr()[0].getAttribute('src') === 'index.html?u=ana&embed=1&from=directory' && !s.d.querySelector('.card[data-handle="bob"]').classList.contains('listening'));
  set(s.w, s.d.getElementById('q'), 'bob');
  check('carte écartée par un filtre : son lecteur se ferme', fr().length === 0);
  set(s.w, s.d.getElementById('q'), '');
  listenBtn('bob').click(); listenBtn('bob').click();
  check('second clic sur « Écouter » : referme', fr().length === 0 && listenBtn('bob').getAttribute('aria-expanded') === 'false');
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
