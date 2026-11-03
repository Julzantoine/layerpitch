// Test du programme local « layerpitch » (cli/layerpitch.js) : ce qu'il lit, ce qu'il refuse, ce qu'il ne fait pas.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
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
const src = fs.readFileSync(cli, 'utf8').replace(/\/\/.*$/gm, '');
check('le programme n\'exécute aucune commande ni code dynamique', !/child_process|\beval\(|new Function|\bexec(Sync)?\(|\bspawn/.test(src));
check('le jeton ne part que dans l\'en-tête Authorization (jamais dans une adresse ou un affichage)', !/console\.\w+\([^)]*token/i.test(src.replace(/Pas de jeton[^)]*/g, '')) && (src.match(/Bearer/g) || []).length === 1);
check('aucune dépendance externe', (src.match(/require\('([^']+)'\)/g) || []).every(m => /'(fs|os|path|https|http|readline|\.\.\/layerpitch-import-engine\.js)'/.test(m)));
fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
if (failures) { console.log(failures + ' échec(s)'); process.exit(1); }
console.log('Programme local : tout est vert.');
