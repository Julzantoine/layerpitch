// Aperçu des liens de la landing (1er/10) : balises Open Graph présentes dans les deux langues, images au bon format. La landing
// (nouvelle-landing/) est publiée par Cloudflare Pages depuis ce dépôt (17/11) : plus de copie.
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const meta = (html, prop) => { const m = new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html); return m && m[1]; };

const pages = [['nouvelle-landing/index.html', 'og-carte.png', 'https://www.layerpitch.com/'], ['nouvelle-landing/en/index.html', 'og-carte-en.png', 'https://www.layerpitch.com/en/']];
for (const [file, img, url] of pages) {
  const h = read(file);
  check(`${file} : titre, description, adresse et image d'aperçu`, !!meta(h, 'og:title') && !!meta(h, 'og:description') && meta(h, 'og:url') === url && meta(h, 'og:image') === 'https://www.layerpitch.com/assets/' + img && meta(h, 'twitter:card') === 'summary_large_image');
  const png = fs.readFileSync(path.join(__dirname, 'nouvelle-landing', 'assets', img));
  check(`${img} : PNG 1200 × 630`, png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630);
}
check('la vérification Google Search Console est sur la page d\'accueil française', /google-site-verification/.test(read('nouvelle-landing/index.html')));

// Anciennes adresses de l'application (landing.html, landing-en.html) : de simples renvois vers la landing, servie par Cloudflare Pages.
check('landing.html renvoie vers /compositeurs', /url=https:\/\/www\.layerpitch\.com\/compositeurs/.test(read('landing.html')));
check('landing-en.html renvoie vers /en/composers', /url=https:\/\/www\.layerpitch\.com\/en\/composers/.test(read('landing-en.html')));

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
