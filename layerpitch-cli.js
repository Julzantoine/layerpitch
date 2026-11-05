#!/usr/bin/env node
// FICHIER GÉNÉRÉ par scripts/build-sources.js à partir de cli/layerpitch.js + layerpitch-import-engine.js — ne pas le modifier ici : modifier les sources, puis `npm run build`.
// layerpitch — programme local d'import par assistant (pièce 2 du chantier MCP, 3/11).
//   layerpitch login <jeton>                 enregistre le jeton créé dans Mon compte → Connecter un assistant
//   layerpitch import <dossier> [options]    dépose les .wav du dossier dans la zone d'attente de ton compte LayerPitch
//   layerpitch logout                        oublie le jeton
// Options d'import : --title "Nom"  --mode vertical|vertical-random|sequential|embranchement-vertical|static  --yes  --dry-run
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
const engine = (() => {
const module = { exports: {} };
/* layerpitch-import-engine.js — moteur de lecture des NOMS de fichiers audio (tempo, mesures, rôles, familles, structure).
   Fonctions pures : un nom (ou une liste de fichiers { name }) entre, une réponse sort ; aucun accès à la page, au réseau ni à
   l'audio. Une SEULE copie : le Backstage (navigateur) le charge par balise <script> et le futur serveur MCP l'importera tel quel
   (require / import) -- il ne peut donc pas y avoir deux versions qui se contredisent. Les noms lus et leurs règles sont décrits dans
   layerpitch-docs/convention-nommage-fichiers.md ; test de référence : test_import_engine.js (dossiers réels de Jules-Antoine).
   Extrait de src/backstage/16-bibliotheque-de-morceaux.js et 16a-import-de-dossier.js le 27/10 (phase 1 du MCP), sans changer le comportement. */
(function (root) {
'use strict';
function titleFromFilename(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
}
// Reconnaissance de bpm/nombre de mesures dans le nom d'un fichier déposé (demande du 13/08, nomenclature
// de Jules-Antoine : "..._160bpm_40M.wav") — restaurée le 01/09 après une disparition accidentelle
// constatée en investiguant la dérive des tests (aucune trace de suppression volontaire, contrairement aux
// changements du 18/08 qui portent tous un commentaire de refonte). Jeton bpm ("\d+bpm") et jeton mesures
// ("\d+M") isolés par un séparateur (_, -, espace) ou une limite de chaîne des deux côtés, pour éviter un
// faux positif du type "Room40Meters" (le "M" colle directement à "eters", donc pas de limite après).
function parseAudioFilenameHints(filename) {
  const bpmMatch = filename.match(/(?:^|[_\s-])(\d+)bpm(?=[_\s.-]|$)/i);
  const barsMatch = filename.match(/(?:^|[_\s-])(\d+)M(?=[_\s.-]|$)/);
  return { bpm: bpmMatch ? parseInt(bpmMatch[1], 10) : null, bars: barsMatch ? parseInt(barsMatch[1], 10) : null };
}
// Mesures d'intro DANS une boucle (« ..._120bpm_18M_intro2M.wav » : les 2 premières mesures ne rebouclent pas), 11/10.
// Fonction à part (et non un champ de plus de parseAudioFilenameHints, dont le résultat est comparé tel quel par des tests).
function parseIntroBarsHint(filename) {
  const m = filename.match(/(?:^|[_\s-])intro(\d+)M(?=[_\s.-]|$)/i);
  return m ? parseInt(m[1], 10) : null;
}
// Même principe que titleFromFilename() ci-dessus, mais retire d'abord les jetons bpm/mesures repérés par
// parseAudioFilenameHints() — pour ne pas les laisser traîner dans le libellé affiché d'un emplacement.
function titleFromFilenameStrippingHints(filename) {
  return filename.replace(/\.[^/.]+$/, '')
    .replace(/(?:^|[_\s-])(\d+)bpm(?=[_\s.-]|$)/i, '')
    .replace(/(?:^|[_\s-])(\d+)M(?=[_\s.-]|$)/, '')
    .replace(/(?:^|[_\s-])intro(\d+)M(?=[_\s.-]|$)/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}
// Devine le rôle (intro/segment/outro) d'un fichier déposé en lot dans le mode séquentiel, à partir de
// son nom. "Segment" par défaut si rien ne correspond — reste ajustable ensuite via le sélecteur "Rôle".
// Séparateurs explicites plutôt que \b (25/09) : pour \b le tiret bas est une lettre, donc
// "The_Last_Door_Intro_120bpm_14M.wav" n'était jamais reconnu comme intro.
function guessSequentialRole(filename) {
  const n = filename.toLowerCase().replace(/\.[^/.]+$/, '');
  if (/(?:^|[^a-z0-9])intro(?:only)?(?:$|[^a-z0-9])/.test(n)) return 'intro'; // « IntroONLY » (22/10) : l'intro seule du morceau Jazz Lo du tuto
  if (/(?:^|[^a-z0-9])outro(?:only)?(?:$|[^a-z0-9])/.test(n)) return 'outro';
  return 'segment';
}
// ---- Dépôt groupé "par familles de noms" (25/09, demandes de Jules-Antoine) ----
// Sert aux pools d'une section vertical-random et à la bibliothèque Sfx (un Sfx par famille, ses fichiers en
// variations round-robin). L'intro/outro est reconnue au nom (guessSequentialRole) quand c'est pertinent, le
// reste est rangé par racine de nom commune ("Alt Perc 1", "Alt Perc 1.5" -> "Alt Perc"). Rien n'est écrit
// tant que le compositeur n'a pas validé la fenêtre de vérification (openGroupedDropDialog) : déplacer un
// fichier, renommer un groupe, piste vide par pool, tempo/mesures lus dans les noms.
function nameFamilyKey(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// Retire les marques de variante en fin de nom, de façon répétée : "(8th)", "#2", "1.5", "BS1" -> "BS".
// Si tout le nom y passe (fichier "01.wav"), on garde le nom tel quel.
function stripVariantSuffix(label) {
  const orig = (label || '').trim();
  let s = orig, prev;
  do {
    prev = s;
    s = s.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s*#?\s*\d+(?:[.,]\d+)?\s*$/, '').trim();
  } while (s && s !== prev);
  return s || orig;
}
// Variante "large" : retire aussi une lettre isolée finale ("Hit A", "Hit B", "Step v2") -- appliquée
// seulement si elle réunit vraiment plusieurs fichiers, pour ne pas abîmer un nom comme "Plan B" seul.
function stripVariantSuffixLoose(label) {
  const s = stripVariantSuffix(label);
  const t = s.replace(/\s+(?:v\d*|[a-z])$/i, '').trim();
  return t ? stripVariantSuffix(t) : s;
}
function groupFilesByNameFamily(files, detectIntroOutro) {
  let intro = null, outro = null;
  const rest = [];
  files.forEach(f => {
    const role = detectIntroOutro ? guessSequentialRole(f.name) : 'segment';
    if (role === 'intro' && !intro) intro = f;
    else if (role === 'outro' && !outro) outro = f;
    else rest.push(f);
  });
  // Nom de pool = ce qui précède le premier « _ » (« BS_Stories… », « DM_Foothills… » -> pools BS et DM) : au moins 2 fichiers qui
  // le partagent (casse ignorée) forment un seul pool (21/10, règle choisie par Jules-Antoine : plus simple et sans piège que
  // les majuscules). Un fichier sans « _ », ou seul sous son préfixe, suit les règles de familles de noms ci-dessous.
  const prefixOf = f => { const m = f.name.match(/^([^_]+)_/); const p = m ? m[1].trim() : ''; return p || null; };
  const prefixCount = new Map();
  rest.forEach(f => { const p = prefixOf(f); if (p) { const k = p.toLowerCase(); prefixCount.set(k, (prefixCount.get(k) || 0) + 1); } });
  const codeGroups = new Map();
  for (let i = rest.length - 1; i >= 0; i--) {
    const p = prefixOf(rest[i]);
    if (!p || prefixCount.get(p.toLowerCase()) < 2) continue;
    const k = p.toLowerCase();
    if (!codeGroups.has(k)) codeGroups.set(k, { label: p, files: [] });
    codeGroups.get(k).files.unshift(rest.splice(i, 1)[0]);
  }
  const strictLabel = f => stripVariantSuffix(titleFromFilenameStrippingHints(f.name));
  const looseCount = new Map();
  rest.forEach(f => { const k = nameFamilyKey(stripVariantSuffixLoose(strictLabel(f))); looseCount.set(k, (looseCount.get(k) || 0) + 1); });
  const groups = new Map();
  rest.forEach(f => {
    const strict = strictLabel(f);
    const loose = stripVariantSuffixLoose(strict);
    const label = looseCount.get(nameFamilyKey(loose)) >= 2 ? loose : strict;
    const key = nameFamilyKey(label);
    if (!groups.has(key)) groups.set(key, { label, files: [] });
    groups.get(key).files.push(f);
  });
  // Un fichier resté seul rejoint le groupe dont le nom est le début du sien ("BS SLAP" -> "BS"), à
  // condition que ce groupe soit une vraie famille (au moins 2 fichiers) -- "Main Perc" reste à part.
  const familyKeys = [...groups.keys()].filter(k => groups.get(k).files.length >= 2);
  [...groups.keys()].forEach(k => {
    const g = groups.get(k);
    if (g.files.length !== 1) return;
    const words = k.split(' ');
    for (let n = words.length - 1; n >= 1; n--) {
      const prefix = words.slice(0, n).join(' ');
      if (familyKeys.includes(prefix)) { groups.get(prefix).files.push(...g.files); groups.delete(k); break; }
    }
  });
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return { intro, outro, groups: [...codeGroups.values(), ...groups.values()].map(g => ({ label: g.label, files: g.files.sort(byName) })) };
}
// Premier fichier (hors intro/outro) dont le nom porte un tempo ou un nombre de mesures.
// anyRole (21/10) : morceau à couches / boucles, où « intro » dans un nom (« Jazz Hi_2bts Intro_8M_110bpm ») n'est pas un rôle à part --
// tous les fichiers comptent, sinon ce nom ne proposait jamais son tempo.
function firstFilenameHints(files, anyRole) {
  const f = files.find(x => { const h = parseAudioFilenameHints(x.name); return (anyRole || guessSequentialRole(x.name) === 'segment') && (h.bpm || h.bars || parseIntroBarsHint(x.name)); });
  // introBars (11/10, « ..._intro2M ») s'ajoute ici, pas dans parseAudioFilenameHints (comparé tel quel par des tests).
  return f ? { file: f, hints: Object.assign({}, parseAudioFilenameHints(f.name), { introBars: parseIntroBarsHint(f.name) }) } : null;
}
// Un fichier « Transition #1.wav » : audio joué à la bascule vers une boucle d'un embranchement (11/10, dossier réel de
// Jules-Antoine : « #1 … », « #2 … », « Transition #1 », « Transition #2 »).
function isTransitionFile(name) {
  return /(?:^|[^a-z0-9])transitions?(?:$|[^a-z0-9])/i.test((name || '').replace(/\.[^/.]+$/, ''));
}
// Numéro « #N » (ou « 1. » en tête) d'un nom, pour relier une transition à sa boucle.
// Le numéro doit être isolé : « #1bis_SecretLever_Transition » n'est PAS le « #1 » d'une boucle (11/10, dossier RobotAdventure).
function folderImportNumber(name) {
  const m = (name || '').match(/#\s*(\d+(?:[.,]\d+)?)(?![A-Za-z0-9])/) || (name || '').match(/^\s*(\d+)\s*[.\-_ ]/);
  return m ? m[1].replace(',', '.') : null;
}
// Boucles + transitions rattachées : par numéro commun, puis par ordre pour les transitions restantes.
function pairLoopsWithTransitions(files) {
  const transitions = files.filter(f => isTransitionFile(f.name));
  const loops = files.filter(f => !isTransitionFile(f.name));
  if (!loops.length) return { loops: files, transitions: [], pairs: [] };
  const taken = new Set();
  const pairs = loops.map(l => {
    const n = folderImportNumber(l.name);
    const t = n && transitions.find(x => !taken.has(x) && folderImportNumber(x.name) === n);
    if (t) taken.add(t);
    return { loop: l, transition: t || null };
  });
  const rest = transitions.filter(t => !taken.has(t));
  pairs.forEach(pr => { if (!pr.transition && rest.length) pr.transition = rest.shift(); });
  return { loops, transitions, pairs, unassigned: rest };
}
// Structure la plus probable pour un dossier, avec la raison (affichée au compositeur). Pure : testée sans page.
// Ordre : le nom du dossier d'abord (il l'a écrit), puis l'intensité dans les noms, puis les alternatives numérotées,
// puis une intro/outro, sinon une couche par fichier.
function guessFolderStructure(folderName, files) {
  const n = nameFamilyKey(folderName || '');
  if (/embranch|branching/.test(n)) return { mode: 'embranchement-vertical', why: 'name' };
  if (/random|aleatoire/.test(n) && /vertical|layer|couche/.test(n)) return { mode: 'vertical-random', why: 'name' };
  if (/sequenti/.test(n)) return { mode: 'sequential', why: 'name' };
  if (/layer|vertical|couche/.test(n)) return { mode: 'vertical', why: 'name' };
  // Des transitions rattachées à des boucles : un embranchement. Prudence : « Transition » est aussi un nom courant dans
  // un séquentiel (« #1bis_SecretLever_Transition »), donc : jamais avec intro/outro, et seulement si chaque transition
  // porte le numéro d'une boucle ou si le dossier n'a pas de familles d'alternatives.
  const transFiles = files.filter(f => isTransitionFile(f.name)), otherFiles = files.filter(f => !isTransitionFile(f.name));
  if (transFiles.length && otherFiles.length && !otherFiles.some(f => guessSequentialRole(f.name) !== 'segment')) {
    const loopNumbers = new Set(otherFiles.map(f => folderImportNumber(f.name)).filter(Boolean));
    const allNumbered = transFiles.every(t => { const n = folderImportNumber(t.name); return n && loopNumbers.has(n); });
    if (allNumbered) return { mode: 'embranchement-vertical', why: 'transitions' };
    // Une transition qui ne porte le numéro d'aucune boucle : embranchement, ou séquentiel avec une bifurcation ? Rien ne
    // le dit dans les noms -> on le demande, on ne présélectionne rien (RobotAdventure : séquentiel à embranchement).
    if (!groupFilesByNameFamily(otherFiles, false).groups.some(x => x.files.length >= 2)) return { mode: 'vertical', why: 'transitionsUnclear' };
  }
  // Un seul fichier (21/10) : un morceau statique, une seule piste -- ni couches, ni étapes, ni boucles à empiler.
  if (files.length === 1) return { mode: 'static', why: 'single' };
  const intensity = files.filter(f => /(?:^|[^a-z])(?:low|med|medium|mid|high)[\s_-]?intensit|intensit/i.test(f.name)).length;
  if (files.length >= 2 && intensity >= 2) return { mode: 'vertical', why: 'intensity' };
  const g = groupFilesByNameFamily(files, true);
  if (g.groups.some(x => x.files.length >= 2)) return { mode: 'vertical-random', why: 'variants' };
  if (g.intro || g.outro) return { mode: 'sequential', why: 'introOutro' };
  return { mode: 'vertical', why: 'default' };
}
// Slots du séquentiel : « Door #1.1 », « Door #1.2 » forment le slot « Door #1 » (variations) ; « Door #2 » est un autre slot.
// Plus fin que la famille de noms des pools, qui réunirait « Door #1 » et « Door #2 » en un seul groupe.
function groupFilesBySequentialSlot(files) {
  let intro = null, outro = null;
  const order = [], bySlot = new Map();
  files.forEach(f => {
    const role = guessSequentialRole(f.name);
    if (role === 'intro' && !intro) { intro = f; return; }
    if (role === 'outro' && !outro) { outro = f; return; }
    const base = titleFromFilenameStrippingHints(f.name);
    const m = base.match(/^(.*\d)\s*[.,]\s*\d+$/);
    const label = m ? m[1].trim() : base;
    const key = nameFamilyKey(label);
    if (!bySlot.has(key)) { bySlot.set(key, { label, files: [] }); order.push(key); }
    bySlot.get(key).files.push(f);
  });
  return { intro, outro, groups: order.map(k => bySlot.get(k)) };
}
const FOLDER_IMPORT_MODES = ['vertical-random', 'vertical', 'sequential', 'embranchement-vertical'];
const FOLDER_IMPORT_AUDIO_RE = /\.(wav|mp3)$/i;
const folderImportByName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const engine = {
  titleFromFilename, parseAudioFilenameHints, parseIntroBarsHint, titleFromFilenameStrippingHints, guessSequentialRole,
  nameFamilyKey, stripVariantSuffix, stripVariantSuffixLoose, groupFilesByNameFamily, firstFilenameHints,
  isTransitionFile, folderImportNumber, pairLoopsWithTransitions, guessFolderStructure, groupFilesBySequentialSlot,
  FOLDER_IMPORT_MODES, FOLDER_IMPORT_AUDIO_RE, folderImportByName,
};
if (typeof module !== 'undefined' && module.exports) module.exports = engine;
if (root) root.LayerPitchImportEngine = engine;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));

return module.exports;
})();

const VERSION = '0.1.0';
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

function apiUrl(opts) {
  const raw = opts.api || process.env.LAYERPITCH_API || DEFAULT_API;
  let u; try { u = new URL(raw); } catch { die('Adresse de la porte invalide.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) die('La porte doit être en https.');
  return u;
}

// Appel JSON à la porte. Le jeton ne part que dans l'en-tête Authorization, jamais dans l'adresse.
function call(u, token, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(Object.assign({ program_version: VERSION }, body)));
    const lib = u.protocol === 'https:' ? https : require('http');
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer ' + token } }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
      res.on('end', () => { let j = {}; try { j = JSON.parse(buf); } catch { /* réponse non JSON */ } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', reject); req.setTimeout(60000, () => req.destroy(new Error('délai dépassé')));
    req.end(data);
  });
}

// Envoi d'un fichier vers l'adresse pré-signée, en flux (le fichier n'est jamais chargé entièrement en mémoire).
function putFile(uploadUrl, file, size) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    if (u.protocol !== 'https:') return reject(new Error('adresse d\'envoi non sécurisée, refusée'));
    const req = https.request(u, { method: 'PUT', headers: { 'Content-Type': 'audio/wav', 'Content-Length': size } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
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
    else if (a === '--title' || a === '--mode' || a === '--api') out[a.slice(2)] = argv[++i];
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
  if (args.mode) { if (!MODES.includes(args.mode)) die('Mode inconnu. Choix : ' + MODES.join(', ')); guess = { mode: args.mode, why: 'chosen' }; }
  const total = files.reduce((a, f) => a + f.size, 0);

  console.log(`\nDossier : ${clean(folderName)} — ${files.length} fichier(s), ${mb(total)}`);
  files.forEach((f) => console.log('  · ' + clean(f.name) + '  (' + mb(f.size) + ')'));
  skipped.forEach(([n, why]) => console.log('  ✗ ' + clean(n) + ' — ' + why));
  console.log(`Structure proposée : ${MODE_LABEL[guess.mode]} (${guess.why === 'chosen' ? 'choisie par toi' : WHY[guess.why] || guess.why})`);
  if (guess.why === 'transitionsUnclear' || guess.why === 'default') console.log('  → peu d\'indices dans les noms : vérifie bien, ou relance avec --mode.');
  if (args.dryRun) { console.log('\n(essai à blanc : rien n\'a été envoyé)'); return; }
  const token = readToken();
  if (!TOKEN_RE.test(token)) die('Pas de jeton. Crée-le dans LayerPitch (Mon compte → Connecter un assistant), puis : layerpitch login <jeton>');
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
  // La porte renvoie les fichiers dans l'ordre envoyé ; on recoupe par nom nettoyé + taille pour ne rien confondre.
  for (let i = 0; i < files.length; i++) {
    const f = files[i], up = uploads[i];
    if (!up || up.size !== f.size) die('Réponse de la porte inattendue : import abandonné (rien n\'est publié).');
    process.stdout.write(`  ↑ ${clean(f.name)} … `);
    const code = await putFile(up.upload_url, f.full, f.size);
    if (code < 200 || code >= 300) die(`envoi refusé (${code}).`);
    const done = await call(u, token, { action: 'complete_file', import_id: begin.body.import_id, file_id: up.file_id });
    if (done.status !== 200) { console.log('✗'); return explain(done); }
    console.log('✓');
  }
  const st = await call(u, token, { action: 'import_status', import_id: begin.body.import_id });
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
  if (cmd === 'login') {
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
    console.log('layerpitch ' + VERSION + '\n  layerpitch login <jeton>\n  layerpitch import <dossier> [--title "Nom"] [--mode …] [--yes] [--dry-run]\n  layerpitch hello\n  layerpitch logout');
  }
})().catch((e) => die('Problème réseau ou fichier : ' + clean(e.message)));
