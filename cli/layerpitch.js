#!/usr/bin/env node
// layerpitch — programme local d'import par assistant (pièce 2 du chantier MCP, 3/11).
//   layerpitch login <jeton>                 enregistre le jeton créé dans Mon compte → Connecter un assistant
//   layerpitch import <dossier> [options]    dépose les .wav du dossier dans la zone d'attente de ton compte LayerPitch
//   layerpitch logout                        oublie le jeton
//   layerpitch help [--lang fr|en]           le guide destiné à l'assistant IA (cli/guide.*.md)
// Options d'import : --title "Nom"  --mode vertical|vertical-random|sequential|embranchement-vertical|static  --yes  --dry-run
// --mode est obligatoire pour envoyer, sauf si le nom du dossier dit la structure ou s'il n'y a qu'un fichier : une devinette
// tirée des noms n'est jamais envoyée sans que le compositeur l'ait confirmée (règle du 11/10).
// Ce que le programme fait, et SEULEMENT cela : lit les .wav posés directement dans le dossier (pas les sous-dossiers, pas
// les raccourcis), les envoie à LayerPitch, rien d'autre. Il n'exécute aucune commande, ne lit rien d'autre sur la machine,
// ne publie rien : le morceau se construit dans le Backstage, quand TU ouvres « Imports en attente ».
// Zéro dépendance (Node 18+). Le jeton est gardé dans ~/.layerpitch/credentials.json (droits 0600) ou dans LAYERPITCH_TOKEN.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const readline = require('readline');
const engine = require('../layerpitch-import-engine.js');
const GUIDES = Object.fromEntries(['fr', 'en'].map((l) => [l, fs.readFileSync(path.join(__dirname, 'guide.' + l + '.md'), 'utf8')]));

const VERSION = '0.2.0';
const DEFAULT_API = 'https://ypygllyjfynrnvapufow.supabase.co/functions/v1/assistant-import';
const MAX_FILE_BYTES = 150 * 1024 * 1024;
const MAX_FILES = 60;
const MODES = ['vertical', 'vertical-random', 'sequential', 'embranchement-vertical', 'static'];
const TOKEN_RE = /^lpa_[0-9a-f]{64}$/;
const credDir = path.join(os.homedir(), '.layerpitch');
const credFile = path.join(credDir, 'credentials.json');
const WHY = {
  name: 'le nom du dossier le dit', transitions: 'des transitions portent le numéro des boucles', transitionsUnclear: 'transitions présentes, rôle pas clair',
  intensity: 'les noms parlent d\'intensité', variants: 'des alternatives numérotées existent', introOutro: 'une intro / une outro sont présentes',
  single: 'un seul fichier', default: 'aucun indice dans les noms : couches par défaut',
};
const MODE_LABEL = { vertical: 'couches (vertical)', 'vertical-random': 'couches aléatoires', sequential: 'séquentiel', 'embranchement-vertical': 'embranchement', static: 'statique (un seul fichier)' };

const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, '?');
const die = (msg, code = 1) => { console.error('✗ ' + msg); process.exit(code); };

function readToken() {
  const env = process.env.LAYERPITCH_TOKEN;
  if (env) return env.trim();
  try { return (JSON.parse(fs.readFileSync(credFile, 'utf8')).token || '').trim(); } catch { return ''; }
}

const isLocalHost = (h) => ['localhost', '127.0.0.1', '[::1]'].includes(h);

function apiUrl(opts) {
  const raw = opts.api || process.env.LAYERPITCH_API || DEFAULT_API;
  let u; try { u = new URL(raw); } catch { die('Adresse de la porte invalide.'); }
  if (u.protocol !== 'https:' && !(isLocalHost(u.hostname) && u.protocol === 'http:')) die('La porte doit être en https.');
  return u;
}

// Appel JSON à la porte. Le jeton ne part que dans l'en-tête Authorization, jamais dans l'adresse.
function callOnce(u, token, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(Object.assign({ program_version: VERSION }, body)));
    const lib = u.protocol === 'https:' ? https : require('http');
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer ' + token } }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
      res.on('end', () => { let j = {}; try { j = JSON.parse(buf); } catch { /* réponse non JSON */ } resolve({ status: res.statusCode, body: j, retryAfter: Number(res.headers['retry-after']) || 0 }); });
    });
    req.on('error', reject); req.setTimeout(60000, () => req.destroy(new Error('délai dépassé')));
    req.end(data);
  });
}

// Trop d'appels à la minute (gros import) : attendre le délai demandé puis réessayer. Les blocages longs (10 min, 1 h) ne sont pas attendus.
async function call(u, token, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await callOnce(u, token, body);
    if (r.status !== 429 || !r.retryAfter || r.retryAfter > 60 || attempt >= 2) return r;
    console.log(`\n  (trop d'appels : nouvel essai dans ${r.retryAfter} s)`);
    await new Promise((res) => setTimeout(res, (r.retryAfter + 1) * 1000));
  }
}

// Envoi d'un fichier vers l'adresse pré-signée, en flux (le fichier n'est jamais chargé entièrement en mémoire).
function putFile(uploadUrl, file, size, localDoor) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    // http : seulement pour des essais sur la machine, porte et adresse d'envoi toutes deux locales.
    const local = localDoor && u.protocol === 'http:' && isLocalHost(u.hostname);
    if (u.protocol !== 'https:' && !local) return reject(new Error('adresse d\'envoi non sécurisée, refusée'));
    const req = (local ? require('http') : https).request(u, { method: 'PUT', headers: { 'Content-Type': 'audio/wav', 'Content-Length': size } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.setTimeout(30 * 60 * 1000, () => req.destroy(new Error('délai dépassé')));
    const rs = fs.createReadStream(file); rs.on('error', reject); rs.pipe(req);
  });
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--title' || a === '--mode' || a === '--api' || a === '--lang') out[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) die('Option inconnue : ' + clean(a));
    else out._.push(a);
  }
  return out;
}

// Seuls les .wav posés directement dans le dossier, fichiers ordinaires (jamais un raccourci/lien symbolique).
function scanFolder(dir) {
  let st; try { st = fs.lstatSync(dir); } catch { die('Dossier introuvable : ' + clean(dir)); }
  if (!st.isDirectory()) die('Ce n\'est pas un dossier : ' + clean(dir));
  const files = [], skipped = [];
  for (const name of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const s = fs.lstatSync(full);
    if (!s.isFile()) { if (/\.wav$/i.test(name)) skipped.push([name, 'raccourci ou dossier, ignoré']); continue; }
    if (!/\.wav$/i.test(name)) { if (/\.(mp3|flac|aiff?|ogg|m4a)$/i.test(name)) skipped.push([name, 'pas du WAV : convertis-le d\'abord (la conversion automatique viendra plus tard)']); continue; }
    if (s.size < 1) { skipped.push([name, 'fichier vide']); continue; }
    if (s.size > MAX_FILE_BYTES) { skipped.push([name, 'plus de 150 Mo']); continue; }
    files.push({ name, size: s.size, full });
  }
  return { files, skipped };
}

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });
const mb = (n) => (n / 1048576).toFixed(1) + ' Mo';

async function cmdImport(args) {
  const dir = path.resolve(args._[1] || die('Indique le dossier : layerpitch import <dossier>'));
  const { files, skipped } = scanFolder(dir);
  if (!files.length) die('Aucun fichier .wav directement dans ce dossier.');
  if (files.length > MAX_FILES) die(`Trop de fichiers (${files.length}, maximum ${MAX_FILES} par import).`);
  const folderName = path.basename(dir);
  let guess = engine.guessFolderStructure(folderName, files);
  if (args.mode) {
    if (!MODES.includes(args.mode)) die('Mode inconnu. Choix : ' + MODES.join(', '));
    if (args.mode === 'static' && files.length > 1) die('« static » ne vaut que pour un dossier d\'un seul fichier.');
    guess = { mode: args.mode, why: 'chosen' };
  }
  const toConfirm = !['chosen', 'name', 'single'].includes(guess.why);
  const total = files.reduce((a, f) => a + f.size, 0);

  console.log(`\nDossier : ${clean(folderName)} — ${files.length} fichier(s), ${mb(total)}`);
  files.forEach((f) => console.log('  · ' + clean(f.name) + '  (' + mb(f.size) + ')'));
  skipped.forEach(([n, why]) => console.log('  ✗ ' + clean(n) + ' — ' + why));
  console.log(`Structure proposée : ${MODE_LABEL[guess.mode]} (${guess.why === 'chosen' ? 'choisie par toi' : WHY[guess.why] || guess.why})`);
  if (toConfirm) console.log('  → ce n\'est qu\'une suggestion : demande au compositeur, puis envoie avec --mode ' + MODES.join('|') + '.');
  if (args.dryRun) { console.log('\n(essai à blanc : rien n\'a été envoyé)'); return; }
  const token = readToken();
  if (!TOKEN_RE.test(token)) die('Pas de jeton. Crée-le dans LayerPitch (Mon compte → Connecter un assistant), puis : layerpitch login <jeton>');
  if (toConfirm) die('Structure à confirmer avant l\'envoi : relance avec --mode (' + MODES.join(', ') + ').');
  if (!args.yes) {
    if (!process.stdin.isTTY) die('Pas de terminal pour confirmer : relance avec --yes si tu es d\'accord avec ce qui précède.');
    const a = await ask('\nEnvoyer ces fichiers dans ta zone d\'attente LayerPitch ? (o/N) ');
    if (!/^(o|oui|y|yes)$/i.test(a)) { console.log('Annulé.'); return; }
  }

  const u = apiUrl(args);
  const title = (args.title || folderName).slice(0, 120);
  const plan = { version: 1, source: 'cli ' + VERSION, folder: folderName.slice(0, 120), mode: guess.mode, why: guess.why, order: files.map((f) => f.name) };
  const begin = await call(u, token, { action: 'begin_import', title, plan, files: files.map((f) => ({ name: f.name, size: f.size })) });
  if (begin.status !== 200) return explain(begin);
  const uploads = begin.body.uploads;
  const importId = begin.body.import_id;
  // Tout échec après ce point annule l'envoi : un import à moitié envoyé compterait dans les imports en attente.
  const giveUp = async (msg) => {
    let cancelled = false;
    try { cancelled = (await call(u, token, { action: 'cancel_import', import_id: importId })).status === 200; } catch { /* hors ligne */ }
    die(clean(msg) + (cancelled ? ' Envoi annulé : rien n\'est resté en attente.' : ' L\'envoi n\'a pas pu être annulé : écarte-le dans le Backstage (« Imports en attente »).'));
  };
  const onInterrupt = () => { giveUp('Interrompu.'); };
  process.once('SIGINT', onInterrupt);
  try {
    // La porte renvoie les fichiers dans l'ordre envoyé ; on recoupe par nom nettoyé + taille pour ne rien confondre.
    for (let i = 0; i < files.length; i++) {
      const f = files[i], up = uploads[i];
      if (!up || up.size !== f.size) return await giveUp('Réponse de la porte inattendue.');
      process.stdout.write(`  ↑ ${clean(f.name)} … `);
      const code = await putFile(up.upload_url, f.full, f.size, isLocalHost(u.hostname));
      if (code < 200 || code >= 300) return await giveUp(`Envoi refusé (${code}).`);
      const done = await call(u, token, { action: 'complete_file', import_id: importId, file_id: up.file_id });
      if (done.status !== 200) { console.log('✗'); return await giveUp((done.body && done.body.error) || 'Erreur ' + done.status); }
      console.log('✓');
    }
  } catch (e) {
    return await giveUp('Problème réseau ou fichier : ' + e.message);
  }
  process.removeListener('SIGINT', onInterrupt);
  const st = await call(u, token, { action: 'import_status', import_id: importId });
  console.log(`\n✓ Terminé (${clean(st.body.status || '?')}). Ouvre le Backstage de LayerPitch : le bandeau « Imports en attente » te propose de construire le morceau. Les fichiers restent 14 jours.`);
}

function explain(r) {
  const msg = (r.body && r.body.error) || 'Erreur ' + r.status;
  if (r.status === 426) die(clean(msg) + ' (version minimale : ' + clean(r.body.min_version) + ')');
  die(clean(msg));
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'help') {
    if (!Object.keys(GUIDES).includes(args.lang || 'fr')) die('Langue inconnue. Choix : fr, en');
    process.stdout.write(GUIDES[args.lang || 'fr']);
  } else if (cmd === 'login') {
    const t = (args._[1] || '').trim();
    if (!TOKEN_RE.test(t)) die('Ce jeton n\'a pas le bon format (il commence par lpa_).');
    fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(credFile, JSON.stringify({ token: t }), { mode: 0o600 }); fs.chmodSync(credFile, 0o600);
    console.log('✓ Jeton enregistré dans ' + credFile);
  } else if (cmd === 'logout') {
    try { fs.unlinkSync(credFile); } catch { /* déjà absent */ }
    console.log('✓ Jeton oublié sur cet ordinateur. (Pour l\'annuler pour de bon : Mon compte → Connecter un assistant → Révoquer.)');
  } else if (cmd === 'import') {
    await cmdImport(args);
  } else if (cmd === 'hello') {
    const r = await call(apiUrl(args), readToken(), { action: 'hello' });
    console.log(r.status === 200 ? '✓ La porte répond, le jeton est valable.' : '✗ ' + clean((r.body && r.body.error) || r.status));
  } else if (cmd === '--version' || cmd === 'version') {
    console.log(VERSION);
  } else {
    console.log('layerpitch ' + VERSION + '\n  layerpitch login <jeton>\n  layerpitch import <dossier> [--title "Nom"] [--mode …] [--yes] [--dry-run]\n  layerpitch hello\n  layerpitch logout\n  layerpitch help [--lang fr|en]   (guide à lire avant le premier import)');
  }
})().catch((e) => die('Problème réseau ou fichier : ' + clean(e.message)));
