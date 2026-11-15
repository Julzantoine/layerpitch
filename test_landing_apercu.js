// Aperçu des liens de la landing (1er/10) : balises Open Graph présentes dans les deux langues, images au bon format, et script de
// recopie de nouvelle-landing/ vers le dépôt qui sert www.layerpitch.com.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sync, diff } = require('./scripts/sync-landing.js');

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-'));
fs.writeFileSync(path.join(tmp, 'CNAME'), 'www.layerpitch.com');
fs.mkdirSync(path.join(tmp, 'ancien-dossier')); fs.writeFileSync(path.join(tmp, 'ancien-dossier', 'x.txt'), 'x');
const done = sync(tmp);
check('recopie : pages FR/EN, images, robots, sitemap', ['index.html', 'studios.html', 'en/index.html', 'en/studios.html', 'assets/og-carte.png', 'robots.txt', 'sitemap.xml'].every(f => fs.existsSync(path.join(tmp, f))));
check('recopie : fichiers identiques à la source', fs.readFileSync(path.join(tmp, 'studios.html'), 'utf8') === read('nouvelle-landing/studios.html'));
check('recopie : CNAME et fichiers propres à l\'autre dépôt non touchés', fs.readFileSync(path.join(tmp, 'CNAME'), 'utf8') === 'www.layerpitch.com' && fs.existsSync(path.join(tmp, 'ancien-dossier', 'x.txt')));
check('recopie : pas de _redirects (propre à Cloudflare)', !fs.existsSync(path.join(tmp, '_redirects')));
check('recopie : anciennes adresses redirigées', /url=\/compositeurs/.test(fs.readFileSync(path.join(tmp, 'landing.html'), 'utf8')) && /url=\/en\//.test(fs.readFileSync(path.join(tmp, 'en.html'), 'utf8')));
check('recopie : une 2e passe ne change plus rien', sync(tmp).length === 0 && diff(tmp).length === 0);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
