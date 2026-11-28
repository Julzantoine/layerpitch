// Test du programme local « layerpitch » (cli/layerpitch.js) : ce qu'il lit, ce qu'il refuse, ce qu'il ne fait pas.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const cli = path.join(__dirname, 'cli/layerpitch.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-cli-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-home-'));
const run = (args, env) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: Object.assign({ PATH: process.env.PATH, HOME: home }, env || {}) });
const dir = path.join(tmp, 'Goute donc ma hache');
fs.mkdirSync(path.join(dir, 'sous-dossier'), { recursive: true });
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
['#1.BattleLoop_LowIntensity_120bpm_64M.wav', '#2.BattleLoop_MedIntensity_120bpm_64M.wav', '#3.BattleLoop_HighIntensity_120bpm_64M.wav'].forEach(n => fs.writeFileSync(path.join(dir, n), wav));
fs.writeFileSync(path.join(dir, 'musique.mp3'), 'x'); fs.writeFileSync(path.join(dir, 'vide.wav'), ''); fs.writeFileSync(path.join(dir, 'sous-dossier', 'cache.wav'), wav);
fs.symlinkSync('/etc/hosts', path.join(dir, 'lien.wav'));

let r = run(['import', dir, '--dry-run']);
check('essai à blanc : 3 fichiers lus, structure « intensité » devinée, rien envoyé, sans jeton requis', r.status === 0 && /3 fichier/.test(r.stdout) && /couches \(vertical\)/.test(r.stdout) && /intensité/.test(r.stdout) && /rien n'a été envoyé/.test(r.stdout));
check('le sous-dossier, le raccourci, le vide et le MP3 ne sont pas envoyés', !/cache\.wav/.test(r.stdout) && /lien\.wav — raccourci/.test(r.stdout) && /vide\.wav — fichier vide/.test(r.stdout) && /musique\.mp3 — pas du WAV/.test(r.stdout));
r = run(['import', dir, '--dry-run', '--mode', 'sequential']);
check('--mode choisi par la personne prime', /séquentiel \(choisie par toi\)/.test(r.stdout));
check('mode inconnu refusé', run(['import', dir, '--dry-run', '--mode', 'rock']).status !== 0);
check('sans jeton, un vrai envoi est refusé', (r = run(['import', dir, '--yes'])).status !== 0 && /Pas de jeton/.test(r.stderr));
check('jeton mal formé refusé au login', run(['login', 'abc']).status !== 0);
const tok = 'lpa_' + 'ab'.repeat(32);
check('login enregistre le jeton avec les droits 0600', run(['login', tok]).status === 0 && (fs.statSync(path.join(home, '.layerpitch/credentials.json')).mode & 0o777) === 0o600);
check('logout oublie le jeton', run(['logout']).status === 0 && !fs.existsSync(path.join(home, '.layerpitch/credentials.json')));
check('porte en http (hors machine locale) refusée', run(['hello', '--api', 'http://example.com/x'], { LAYERPITCH_TOKEN: tok }).status !== 0);
check('option inconnue refusée', run(['import', dir, '--rm']).status !== 0);
const bundle = path.join(__dirname, 'layerpitch-cli.js');
r = spawnSync(process.execPath, [bundle, 'import', dir, '--dry-run'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
check('le fichier à télécharger (layerpitch-cli.js) marche seul, sans le reste du dépôt, et donne le même résultat', r.status === 0 && /couches \(vertical\)/.test(r.stdout) && !/require\('\.\./.test(fs.readFileSync(bundle, 'utf8')));
for (const lang of ['fr', 'en']) {
  const g = fs.readFileSync(path.join(__dirname, 'cli/guide.' + lang + '.md'), 'utf8');
  r = spawnSync(process.execPath, [bundle, 'help', '--lang', lang], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
  check('guide ' + lang + ' : affiché par le fichier à télécharger, sans jeton', r.status === 0 && r.stdout === g);
  check('guide ' + lang + ' : décrit toutes les structures acceptées par --mode', ['vertical', 'vertical-random', 'sequential', 'embranchement-vertical', 'static'].every(m => g.includes('`' + m + '`')));
}
check('langue de guide inconnue refusée', run(['help', '--lang', 'de']).status !== 0);
const src = fs.readFileSync(cli, 'utf8').replace(/\/\/.*$/gm, '');
check('le programme n\'exécute aucune commande ni code dynamique', !/child_process|\beval\(|new Function|\bexec(Sync)?\(|\bspawn/.test(src));
check('le jeton ne part que dans l\'en-tête Authorization (jamais dans une adresse ou un affichage)', !/console\.\w+\([^)]*token/i.test(src.replace(/Pas de jeton[^)]*/g, '')) && (src.match(/Bearer/g) || []).length === 1);
check('aucune dépendance externe', (src.match(/require\('([^']+)'\)/g) || []).every(m => /'(fs|os|path|https|http|readline|\.\.\/layerpitch-import-engine\.js)'/.test(m)));
// ---- Envoi de bout en bout contre une fausse porte locale ----
const http = require('http');
const run2 = (args, env) => new Promise((res) => {
  const p = spawn(process.execPath, [bundle, ...args], { env: Object.assign({ PATH: process.env.PATH, HOME: home }, env) });
  let out = ''; p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { out += c; });
  p.on('close', (status) => res({ status, out }));
});
let seen = [], behaviour = {};
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const send = (code, body, headers) => { res.writeHead(code, headers || {}); res.end(JSON.stringify(body || {})); };
    if (req.method === 'PUT') { seen.push('PUT'); return send(behaviour.put || 200); }
    const b = JSON.parse(Buffer.concat(chunks)); seen.push(b.action);
    const base = 'http://127.0.0.1:' + server.address().port;
    if (b.action === 'begin_import') { behaviour.plan = b.plan; return send(200, { import_id: 'i', uploads: b.files.map((f, i) => ({ file_id: 'f' + i, size: f.size, upload_url: base + '/put/' + i })) }); }
    if (b.action === 'complete_file' && behaviour.busy-- > 0) return send(429, { error: 'Trop d’appels : attends une minute.' }, { 'Retry-After': '1' });
    return send(200, { ok: true, status: 'ready' });
  });
});
const plain = path.join(tmp, 'Mon morceau');
fs.mkdirSync(plain); ['un.wav', 'deux.wav'].forEach((n) => fs.writeFileSync(path.join(plain, n), wav));

server.listen(0, '127.0.0.1', async () => {
  const api = 'http://127.0.0.1:' + server.address().port + '/door';
  const send = (args, b) => { seen = []; behaviour = b || {}; return run2(['import', ...args, '--api', api, '--yes'], { LAYERPITCH_TOKEN: tok }); };
  let x = await send([plain]);
  check('aucun indice dans les noms : refus d\'envoyer sans --mode, rien n\'est parti', x.status !== 0 && /Structure à confirmer/.test(x.out) && seen.length === 0);
  x = await send([dir]);
  check('structure seulement devinée (intensité) : refus aussi', x.status !== 0 && seen.length === 0);
  x = await send([plain, '--mode', 'static']);
  check('« static » avec plusieurs fichiers : refusé', x.status !== 0 && seen.length === 0);
  x = await send([plain, '--mode', 'sequential']);
  check('structure confirmée : envoi complet', x.status === 0 && behaviour.plan.mode === 'sequential' && behaviour.plan.why === 'chosen' && seen.filter((a) => a === 'PUT').length === 2 && !seen.includes('cancel_import'));
  const named = path.join(tmp, 'Combat - layering'); fs.mkdirSync(named); ['a.wav', 'b.wav'].forEach((n) => fs.writeFileSync(path.join(named, n), wav));
  x = await send([named]);
  check('nom du dossier explicite : envoi sans --mode', x.status === 0 && behaviour.plan.why === 'name');
  x = await send([plain, '--mode', 'vertical'], { busy: 1 });
  check('trop d\'appels : le programme attend, réessaie et termine', x.status === 0 && /nouvel essai/.test(x.out) && seen.filter((a) => a === 'complete_file').length === 3);
  x = await send([plain, '--mode', 'vertical'], { put: 403 });
  check('envoi refusé : l\'import est annulé et c\'est dit', x.status !== 0 && seen.includes('cancel_import') && /Envoi annulé/.test(x.out));
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
  if (failures) { console.log(failures + ' échec(s)'); process.exit(1); }
  console.log('Programme local : tout est vert.');
});
