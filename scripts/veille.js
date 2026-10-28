#!/usr/bin/env node
// scripts/veille.js — veille d'entretien (27/10) : ce qui peut changer ou expirer SANS qu'on touche au code.
//   npm run veille
// 1. Bibliothèques externes : version figée dans le code (voir test_versions_figees.js) contre dernière version parue.
// 2. Certificats HTTPS des adresses du site : jours restants avant expiration.
// 3. Nom de domaine layerpitch.com : date d'expiration (registre public RDAP).
// 4. Pages et services : répondent-ils ?
// Rapport en texte simple, lignes « ⚠ » = à regarder. Ne modifie rien. A besoin d'Internet ; n'est PAS lancé par npm test.
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const root = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.claude']);
const EXT = /\.(html|js|mjs|ts)$/;
// Mêmes motifs que test_versions_figees.js.
const CDN = /(?:unpkg\.com|cdn\.jsdelivr\.net\/npm|esm\.sh)\/((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+)/g;
const NPM = /['"]npm:((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+)/g;
const HOSTS = ['layerpitch.com', 'www.layerpitch.com', 'beta.layerpitch.com', 'media.layerpitch.com'];
const DOMAIN = 'layerpitch.com';
const PAGES = [
  'https://www.layerpitch.com/',
  'https://beta.layerpitch.com/',
  'https://beta.layerpitch.com/layerpitch-backstage.html',
  'https://ypygllyjfynrnvapufow.supabase.co/auth/v1/health',
];
const CERT_WARN_DAYS = 21;
const DOMAIN_WARN_DAYS = 60;

let warnings = 0;
const warn = msg => { warnings++; console.log(`  ⚠ ${msg}`); };
const ok = msg => console.log(`  ✓ ${msg}`);
const daysUntil = d => Math.floor((new Date(d) - Date.now()) / 86400000);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)); }
    else if (EXT.test(e.name)) yield path.join(dir, e.name);
  }
}

async function fetchWithTimeout(url, opts) {
  return fetch(url, Object.assign({ signal: AbortSignal.timeout(15000) }, opts));
}

async function checkLibraries() {
  console.log('\n1. Bibliothèques externes (version figée → dernière parue)');
  const pinned = new Map(); // nom -> Set de versions figées (une même bibliothèque doit avoir UNE version partout)
  for (const file of walk(root)) {
    if (/test_versions_figees\.js$/.test(file)) continue;
    const src = fs.readFileSync(file, 'utf-8');
    for (const re of [CDN, NPM]) for (const m of src.matchAll(re)) {
      if (!pinned.has(m[1])) pinned.set(m[1], new Set());
      pinned.get(m[1]).add(m[2]);
    }
  }
  for (const [name, versions] of [...pinned].sort()) {
    const list = [...versions].sort();
    if (list.length > 1) warn(`${name} : plusieurs versions figées à des endroits différents (${list.join(', ')}) — à harmoniser`);
    let latest;
    try {
      const r = await fetchWithTimeout(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`);
      latest = (await r.json()).version;
    } catch (e) { warn(`${name} : registre npm injoignable (${e.message})`); continue; }
    const cur = list[list.length - 1];
    if (cur === latest) { ok(`${name} ${cur} (à jour)`); continue; }
    const major = cur.split('.')[0] !== latest.split('.')[0];
    const line = `${name} ${cur} → ${latest} disponible${major ? ' — CHANGEMENT MAJEUR : peut casser, à tester avant de monter' : ''}`;
    if (major) warn(line); else console.log(`  · ${line}`);
  }
}

function certDays(host) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const c = s.getPeerCertificate();
      s.end();
      resolve({ days: daysUntil(c.valid_to), to: c.valid_to, authorized: s.authorized, error: s.authorizationError });
    });
    s.on('error', reject);
    s.on('timeout', () => { s.destroy(); reject(new Error('délai dépassé')); });
  });
}

async function checkCertificates() {
  console.log(`\n2. Certificats HTTPS (alerte sous ${CERT_WARN_DAYS} jours)`);
  for (const host of HOSTS) {
    try {
      const c = await certDays(host);
      if (!c.authorized) warn(`${host} : certificat refusé par les navigateurs (${c.error})`);
      else if (c.days < CERT_WARN_DAYS) warn(`${host} : expire dans ${c.days} jours (${c.to}) — normalement renouvelé tout seul, vérifier`);
      else ok(`${host} : ${c.days} jours restants`);
    } catch (e) { warn(`${host} : injoignable (${e.message})`); }
  }
}

async function checkDomain() {
  console.log(`\n3. Nom de domaine (alerte sous ${DOMAIN_WARN_DAYS} jours)`);
  try {
    const r = await fetchWithTimeout(`https://rdap.verisign.com/com/v1/domain/${DOMAIN}`, { headers: { accept: 'application/rdap+json' } });
    const j = await r.json();
    const exp = (j.events || []).find(e => e.eventAction === 'expiration');
    const registrar = ((j.entities || []).find(e => (e.roles || []).includes('registrar')) || {}).vcardArray;
    const regName = registrar ? (registrar[1].find(f => f[0] === 'fn') || [])[3] : '?';
    if (!exp) { warn(`${DOMAIN} : date d'expiration introuvable`); return; }
    const d = daysUntil(exp.eventDate);
    const line = `${DOMAIN} : expire le ${exp.eventDate.slice(0, 10)} (${d} jours), bureau d'enregistrement : ${regName}`;
    if (d < DOMAIN_WARN_DAYS) warn(line); else ok(line);
  } catch (e) { warn(`${DOMAIN} : registre RDAP injoignable (${e.message})`); }
}

async function checkPages() {
  console.log('\n4. Pages et services');
  for (const url of PAGES) {
    try {
      const r = await fetchWithTimeout(url, { redirect: 'follow' });
      // /auth/v1/health de Supabase répond 401 sans clé : il répond, donc le service tourne.
      if (r.ok || (url.includes('supabase.co') && r.status === 401)) ok(`${url} (${r.status})`);
      else warn(`${url} répond ${r.status}`);
    } catch (e) { warn(`${url} injoignable (${e.message})`); }
  }
}

(async () => {
  console.log(`Veille LayerPitch — ${new Date().toISOString().slice(0, 10)}`);
  await checkLibraries();
  await checkCertificates();
  await checkDomain();
  await checkPages();
  console.log(warnings ? `\n${warnings} point(s) à regarder (lignes ⚠).` : '\nRien à signaler.');
})();
