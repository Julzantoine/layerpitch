#!/usr/bin/env node
/**
 * LayerPitch — migration des médias (audio/, images/) vers Cloudflare R2
 * (Décision 3, docs/infrastructure.md — Partie B)
 *
 * Commandes :
 *   node scripts/migrate-media-to-r2.js upload [--only=audio|images] [--dry-run]
 *     → copie 1:1 les fichiers locaux vers le bucket R2, mêmes chemins
 *       (audio/<id>/<fichier>, images/<fichier>). Idempotent : un fichier déjà
 *       présent avec un contenu identique (MD5 == ETag distant) est ignoré.
 *
 *   node scripts/migrate-media-to-r2.js verify [--only=audio|images]
 *     → pour chaque fichier local, vérifie sa présence et son intégrité (MD5 vs
 *       ETag) sur R2. N'écrit rien. À faire passer avant de toucher à data.json
 *       (étape suivante, volontairement séparée — voir Décision 5, Strangler Fig).
 *
 *   node scripts/migrate-media-to-r2.js set-cors
 *     → autorise GET/HEAD cross-origin (toute origine) sur le bucket. Requis car
 *       player.js charge l'audio via fetch()+decodeAudioData (Web Audio API), pas
 *       <audio src>, donc soumis au CORS — contrairement aux images (<img src>).
 *       Sans ça, aucune lecture audio ne fonctionne une fois le domaine media.*
 *       différent du domaine du site. À exécuter une fois avant toute bascule
 *       réelle de `data.json`/`IMAGES_BASE` en production.
 *
 *   node scripts/migrate-media-to-r2.js get-cors
 *     → affiche la configuration CORS actuelle du bucket (vérification).
 *
 * Identifiants requis dans .env à la racine du repo (jamais en dur ici, jamais
 * committé — voir .gitignore) : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET.
 *
 * Hypothèse à vérifier au premier run réel : R2 est documenté comme compatible
 * S3 pour l'ETag d'un PUT simple (non multipart) = MD5 hex du contenu, comme
 * S3. Tous nos fichiers sont largement sous le seuil multipart (quelques Mo
 * max), donc l'hypothèse devrait tenir — la commande `verify` le confirmera
 * ou le contredira concrètement.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

/* ---------------- Chargement .env (sans dépendance) ---------------- */
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;
const REGION = 'auto';
const SERVICE = 's3';
const ENDPOINT_HOST = ACCOUNT_ID ? `${ACCOUNT_ID}.r2.cloudflarestorage.com` : null;

function requireCreds() {
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Variables manquantes dans .env : ${missing.join(', ')}`);
    process.exit(1);
  }
}

/* ---------------- Signature AWS SigV4 (S3-compatible, requis par R2) ---------------- */
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }

// RFC 3986 : caractères non réservés inchangés, tout le reste encodé — requis par la spec SigV4.
function uriEncodeSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
// key === '' désigne le bucket lui-même (opérations de niveau bucket, ex. CORS) — pas de "/" final.
function canonicalUri(key) {
  if (key === '') return '/' + BUCKET;
  return '/' + BUCKET + '/' + key.split('/').map(uriEncodeSegment).join('/');
}

// canonicalQuery : chaîne déjà triée/encodée (ex. "cors=") — vide pour les opérations objet normales.
function signRequest({ method, key, body, extraHeaders = {}, canonicalQuery = '' }) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body || Buffer.alloc(0));

  const headers = {
    host: ENDPOINT_HOST,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri(key),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  const kDate = hmac('AWS4' + SECRET_KEY, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const path = canonicalUri(key) + (canonicalQuery ? '?' + canonicalQuery : '');
  return { headers: { ...headers, authorization }, path };
}

function r2Request(method, key, body, extraHeaders, canonicalQuery) {
  const { headers, path: reqPath } = signRequest({ method, key, body, extraHeaders, canonicalQuery });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: ENDPOINT_HOST, path: reqPath, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ---------------- Types MIME ---------------- */
const MIME = { '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif' };
function mimeFor(file) { return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

/* ---------------- Parcours des fichiers locaux ---------------- */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function localFiles(only) {
  const root = path.join(__dirname, '..');
  const dirs = only === 'audio' ? ['audio'] : only === 'images' ? ['images'] : ['audio', 'images'];
  const files = [];
  for (const d of dirs) {
    const abs = path.join(root, d);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walk(abs)) files.push({ key: `${d}/${rel}`, abs: path.join(abs, rel) });
  }
  return files;
}

/* ---------------- Commande : upload ---------------- */
async function upload(only, dryRun) {
  requireCreds();
  const files = localFiles(only);
  console.log(`${files.length} fichier(s) local(aux) à traiter${dryRun ? ' (dry-run, aucune écriture)' : ''}.`);
  let uploaded = 0, skipped = 0, failed = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const localMd5 = crypto.createHash('md5').update(buf).digest('hex');

    const head = await r2Request('HEAD', f.key);
    if (head.status === 200) {
      const remoteEtag = (head.headers.etag || '').replace(/"/g, '');
      if (remoteEtag === localMd5) { skipped++; continue; }
    }

    if (dryRun) { console.log(`  [dry-run] ${f.key}`); uploaded++; continue; }

    const put = await r2Request('PUT', f.key, buf, { 'content-type': mimeFor(f.abs), 'content-length': String(buf.length) });
    if (put.status === 200) {
      console.log(`  ✓ ${f.key}`);
      uploaded++;
    } else {
      console.error(`  ✗ ${f.key} — HTTP ${put.status} : ${put.body.toString('utf8').slice(0, 300)}`);
      failed++;
    }
  }
  console.log(`\nTerminé : ${uploaded} envoyé(s), ${skipped} déjà à jour, ${failed} en échec.`);
  if (failed) process.exit(1);
}

/* ---------------- Commande : verify ---------------- */
async function verify(only) {
  requireCreds();
  const files = localFiles(only);
  console.log(`Vérification de ${files.length} fichier(s) sur R2 (bucket ${BUCKET})...`);
  let ok = 0, missing = 0, mismatched = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const localMd5 = crypto.createHash('md5').update(buf).digest('hex');
    const head = await r2Request('HEAD', f.key);
    if (head.status === 404) { console.error(`  ✗ absent sur R2 : ${f.key}`); missing++; continue; }
    if (head.status !== 200) { console.error(`  ✗ ${f.key} — HTTP ${head.status}`); missing++; continue; }
    const remoteEtag = (head.headers.etag || '').replace(/"/g, '');
    if (remoteEtag !== localMd5) { console.error(`  ✗ contenu différent : ${f.key} (local ${localMd5} vs R2 ${remoteEtag})`); mismatched++; continue; }
    ok++;
  }
  console.log(`\nRésultat : ${ok} identique(s), ${missing} absent(s), ${mismatched} différent(s) sur ${files.length}.`);
  if (missing || mismatched) process.exit(1);
  console.log('✓ Migration vérifiée : tous les fichiers locaux sont présents et identiques sur R2.');
}

/* ---------------- Commandes : set-cors / get-cors ----------------
 * player.js charge l'audio via fetch() + decodeAudioData (Web Audio API, nécessaire pour le
 * looping sample-accurate — pas de simple <audio src>), donc soumis au CORS contrairement aux
 * <img src="..."> (images) qui s'affichent sans restriction cross-origin. Sans règle CORS sur le
 * bucket, tout fetch() vers media.layerpitch.com échoue silencieusement depuis n'importe quel
 * autre domaine (beta.layerpitch.com, www.layerpitch.com, file://, localhost de dev...).
 * AllowedOrigin "*" : cohérent avec le modèle déjà retenu (Décision 3) — accès public sans
 * presigned URLs, et R2 est egress-free donc pas de coût de bande passante à limiter par origine.
 */
const CORS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

async function setCors() {
  requireCreds();
  const body = Buffer.from(CORS_XML, 'utf8');
  const res = await r2Request('PUT', '', body, { 'content-type': 'application/xml', 'content-length': String(body.length) }, 'cors=');
  if (res.status === 200 || res.status === 204) {
    console.log(`✓ CORS configuré sur le bucket ${BUCKET} (GET/HEAD, toute origine).`);
  } else {
    console.error(`✗ HTTP ${res.status} : ${res.body.toString('utf8').slice(0, 500)}`);
    process.exit(1);
  }
}

async function getCors() {
  requireCreds();
  const res = await r2Request('GET', '', null, {}, 'cors=');
  if (res.status === 200) {
    console.log(res.body.toString('utf8'));
  } else {
    console.error(`✗ HTTP ${res.status} : ${res.body.toString('utf8').slice(0, 500)}`);
    process.exit(1);
  }
}

/* ---------------- CLI ---------------- */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--only=')) flags.only = a.slice('--only='.length);
    else if (a === '--dry-run') flags.dryRun = true;
    else positional.push(a);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [cmd] = positional;
(async () => {
  try {
    if (cmd === 'upload') await upload(flags.only, !!flags.dryRun);
    else if (cmd === 'verify') await verify(flags.only);
    else if (cmd === 'set-cors') await setCors();
    else if (cmd === 'get-cors') await getCors();
    else {
      console.log('Usage :');
      console.log('  node scripts/migrate-media-to-r2.js upload [--only=audio|images] [--dry-run]');
      console.log('  node scripts/migrate-media-to-r2.js verify [--only=audio|images]');
      console.log('  node scripts/migrate-media-to-r2.js set-cors');
      console.log('  node scripts/migrate-media-to-r2.js get-cors');
      process.exit(1);
    }
  } catch (e) {
    console.error('Erreur :', e.message);
    process.exit(1);
  }
})();
