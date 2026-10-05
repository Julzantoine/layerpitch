// Aperçu des liens de la landing (1er/10) : balises Open Graph présentes dans les deux langues, images au bon format, et script de
// recopie vers le dépôt qui sert www.layerpitch.com (index.html, en.html, assets/) sans casser la balise Google ni les liens.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sync, transform } = require('./scripts/sync-landing.js');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const meta = (html, prop) => { const m = new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html); return m && m[1]; };

for (const [file, lang, img, url] of [['landing.html', 'fr', 'og-carte.png', 'https://www.layerpitch.com/'], ['landing-en.html', 'en', 'og-carte-en.png', 'https://www.layerpitch.com/en.html']]) {
  const h = read(file);
  check(`${file} : description d'aperçu = le texte validé (AdReel, pools aléatoires)`, /AdReel/.test(meta(h, 'og:description')) && /(pools aléatoires|random pools)/.test(meta(h, 'og:description')));
  check(`${file} : titre, description, adresse et image d'aperçu`, !!meta(h, 'og:title') && !!meta(h, 'og:description') && meta(h, 'og:url') === url && meta(h, 'og:image') === 'https://www.layerpitch.com/assets/' + img && meta(h, 'twitter:card') === 'summary_large_image');
  check(`${file} : adresses absolues vers www.layerpitch.com (jamais un chemin relatif)`, /^https:\/\/www\.layerpitch\.com\//.test(meta(h, 'og:image')) && /^https:\/\/www\.layerpitch\.com\//.test(meta(h, 'og:url')));
  const png = fs.readFileSync(path.join(__dirname, 'landing-assets', img));
  check(`${img} : PNG 1200 × 630`, png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630);
  check(`${file} : titre d'aperçu choisi (${lang})`, lang === 'fr' ? /^MP3 vs LayerPitch : épée en bois vs full stuff\. Pour avancer dans le game/.test(meta(h, 'og:title')) : /^MP3 vs LayerPitch: wooden sword vs full gear\. To get ahead in the game/.test(meta(h, 'og:title')));
}
check('la vérification Google Search Console reste sur la page française seulement', /google-site-verification/.test(read('landing.html')) && !/google-site-verification/.test(read('landing-en.html')));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-'));
fs.writeFileSync(path.join(tmp, 'CNAME'), 'www.layerpitch.com');
const done = sync(tmp);
const idx = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8'), en = fs.readFileSync(path.join(tmp, 'en.html'), 'utf8');
check('recopie : index.html, en.html et les images', done.includes('index.html') && done.includes('en.html') && done.includes('assets/og-carte.png') && done.includes('assets/og-carte-en.png') && done.includes('assets/jules-photo.jpg'));
check('recopie : liens FR/EN et dossier d\'images réécrits pour l\'autre dépôt', /href="\.\/index\.html">FR/.test(idx) && /href="\.\/en\.html">EN/.test(idx) && /src="\.\/assets\/jules-photo\.jpg"/.test(idx) && !/landing-assets|landing-en\.html/.test((idx + en).replace(/<!--[\s\S]*?-->/g, '')));
check('recopie : balises d\'aperçu et vérification Google conservées', /og:image/.test(idx) && /og:image/.test(en) && /google-site-verification/.test(idx));
check('recopie : identique à l\'ancienne copie hors les lignes réécrites (aucune autre différence)', transform('<a href="./landing.html">FR</a><img src="./landing-assets/x.jpg"><a href="./landing-en.html">EN</a>') === '<a href="./index.html">FR</a><img src="./assets/x.jpg"><a href="./en.html">EN</a>');
fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
