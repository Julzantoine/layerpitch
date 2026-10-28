// Test de référence du moteur de lecture des noms de fichiers (layerpitch-import-engine.js, phase 1 du MCP, 27/10).
// Deux rôles : (1) figer ce que le moteur répond sur les VRAIS dossiers de Jules-Antoine, sans page ni jsdom (comme le fera le
// serveur MCP, qui importera ce même fichier) ; (2) garantir qu'il n'existe qu'UNE copie du code -- le Backstage doit utiliser
// celle du moteur, jamais en redéfinir une (sinon navigateur et serveur pourraient se contredire).
const fs = require('fs');
const path = require('path');
const engine = require('./layerpitch-import-engine.js');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const F = name => ({ name });
const files = names => names.map(F);
const guess = (folder, names) => { const g = engine.guessFolderStructure(folder, files(names)); return g.mode + '/' + g.why; };

// ---- Indices écrits : lus tels quels ----
const h = engine.parseAudioFilenameHints;
check('tempo + mesures', JSON.stringify(h('#3_RobotAdventure_BattleFinal_160bpm_40M.wav')) === JSON.stringify({ bpm: 160, bars: 40 }));
check('pas de faux positif (Room40Meters, Transition)', JSON.stringify(h('Room40Meters_ambient.wav')) === JSON.stringify({ bpm: null, bars: null }) && h('#1bis_SecretLever_Transition.wav').bpm === null);
check('intro2M', engine.parseIntroBarsHint('#1 Everything is fine_120bpm_18M_intro2M.wav') === 2 && engine.parseIntroBarsHint('Door_120bpm_18M.wav') === null);
check('titre sans les jetons', engine.titleFromFilenameStrippingHints('#1 Everything is fine_120bpm_18M_intro2M.wav') === '#1 Everything is fine');
check('rôles intro / outro / segment', engine.guessSequentialRole('Door_Intro_120bpm.wav') === 'intro' && engine.guessSequentialRole('Door_Outro.wav') === 'outro' && engine.guessSequentialRole('Door Chase.wav') === 'segment');
check('numéros de boucle', engine.folderImportNumber('Transition #1.wav') === '1' && engine.folderImportNumber('#2.5 X.wav') === '2.5' && engine.folderImportNumber('#1bis_SecretLever_Transition.wav') === null);
check('mot Transition', engine.isTransitionFile('Transition #1.wav') && !engine.isTransitionFile('#1 Everything is fine.wav'));

// ---- Dossiers réels : structure devinée ----
const menu = ['AltPerc #1.5.wav', 'AltPerc #1.wav', 'AltPerc #2.wav', 'BS #1.wav', 'BS #2.wav', 'BS #4 (Slap).wav', 'Cocottes Gt #1.wav', 'Cocottes Gt #2.wav', 'Intro+MainPerc.wav', 'MainPerc.wav', 'Thème Gt.wav', 'Theme Kb.wav'];
const hache = ['#1.BattleLoop_LowIntensity_120bpm_64M.wav', '#2.BattleLoop_MedIntensity_120bpm_64M.wav', '#3.BattleLoop_HighIntensity_120bpm_64M.wav'];
const monte = ['#1 Everything is fine_120bpm_18M_intro2M.wav', 'Transition #2.wav', 'Transition #1.wav', "#2 We've been noticed_120bpm_18M_intro2M.wav"];
const robot = ['#1_RobotAdventure_WetDarkCave_120bpm_30M.wav', '#2_RobotAdventure_Corridor_120bpm_30M.wav', '#3_RobotAdventure_BattleFinal_160bpm_40M.wav', '#1bis_SecretLever_Transition.wav'];
check('Menu / Test Layering Vertical Random : dit par le dossier', guess('Menu / Test Layering Vertical Random', menu) === 'vertical-random/name');
check('Menu seul : alternatives numérotées, suggéré', guess('Menu', menu) === 'vertical-random/variants');
check('Goute donc ma hache : intensité', guess('Goute donc ma hache pour voir', hache) === 'vertical/intensity');
check('Monte en l\'air : transitions rattachées -> embranchement', guess("Monte en l'air et pattes de velours", monte) === 'embranchement-vertical/transitions');
check('RobotAdventure : on demande, on ne présélectionne pas', guess('RobotAdventure', robot) === 'vertical/transitionsUnclear');
check('The Last Door : intro/outro -> séquentiel', guess('The Last Door', ['Door_Intro_120bpm_14M.wav', 'Door Opening.wav', 'Door Chase.wav', 'Door_Outro.wav']) === 'sequential/introOutro');
check('transition + intro/outro : jamais un embranchement', !guess('The Last Door', ['Door_Intro.wav', '#1bis_SecretLever_Transition.wav', '#2 Door.wav', 'Door_Outro.wav']).startsWith('embranchement'));
check('un seul fichier : statique', guess('Boom', ['Boom.wav']) === 'static/single');
check('aucun indice : couches par défaut', guess('Divers', ['Render_03.wav', 'Final_v2.wav']) === 'vertical/default');
check('mots du dossier : embranchement / séquentiel / vertical / random seul ne suffit pas',
  guess('Test embranchement', hache) === 'embranchement-vertical/name' && guess('Test sequentiel', hache) === 'sequential/name'
  && guess('Test layering', hache) === 'vertical/name' && guess('Random', menu) === 'vertical-random/variants');

// ---- Regroupements ----
const gm = engine.groupFilesByNameFamily(files(menu), true);
check('Menu : l\'intro est repérée, les familles AltPerc et BS regroupent leurs alternatives',
  !gm.intro || gm.intro.name.length > 0);
const alt = gm.groups.find(x => engine.nameFamilyKey(x.label) === 'altperc');
check('Menu : famille AltPerc = 3 fichiers (#1, #1.5, #2)', !!alt && alt.files.length === 3);
const bs = gm.groups.find(x => engine.nameFamilyKey(x.label) === 'bs');
check('Menu : famille BS = 3 fichiers (dont « (Slap) »)', !!bs && bs.files.length === 3);
const pr = engine.pairLoopsWithTransitions(files(monte));
check('Monte en l\'air : chaque boucle reçoit la transition de même numéro',
  pr.pairs.length === 2 && pr.pairs.every(p => p.transition && engine.folderImportNumber(p.transition.name) === engine.folderImportNumber(p.loop.name)));
const seq = engine.groupFilesBySequentialSlot(files(['Door_Intro.wav', 'Door #1.1.wav', 'Door #1.2.wav', 'Door #2.wav', 'Door_Outro.wav']));
check('séquentiel : « Door #1.1 » et « #1.2 » = un slot (2 variations), « #2 » un autre', seq.groups.length === 2 && seq.groups[0].files.length === 2 && seq.intro && seq.outro);

// ---- Une seule copie du code : le Backstage ne redéfinit rien ----
const root = __dirname;
const sources = fs.readdirSync(path.join(root, 'src/backstage')).filter(f => f.endsWith('.js')).map(f => ({ f, s: fs.readFileSync(path.join(root, 'src/backstage', f), 'utf8') }));
const names = ['titleFromFilename', 'parseAudioFilenameHints', 'parseIntroBarsHint', 'titleFromFilenameStrippingHints', 'guessSequentialRole', 'nameFamilyKey', 'stripVariantSuffix', 'stripVariantSuffixLoose', 'groupFilesByNameFamily', 'firstFilenameHints', 'isTransitionFile', 'folderImportNumber', 'pairLoopsWithTransitions', 'guessFolderStructure', 'groupFilesBySequentialSlot'];
const redefined = [];
sources.forEach(({ f, s }) => names.forEach(n => { if (new RegExp('^(async )?function ' + n + '\\b', 'm').test(s)) redefined.push(f + ':' + n); }));
check('le Backstage ne redéfinit aucune fonction du moteur' + (redefined.length ? ' (' + redefined.join(', ') + ')' : ''), redefined.length === 0);
const page = fs.readFileSync(path.join(root, 'src/backstage/03-ecran-et-scripts.html'), 'utf8');
check('la page charge le moteur avant son script principal', /layerpitch-import-engine\.js/.test(page) && page.indexOf('layerpitch-import-engine.js') < page.indexOf('<script src="player.js'));
check('le moteur n\'utilise ni la page, ni le réseau', !/\b(document|fetch|XMLHttpRequest|localStorage)\b/.test(fs.readFileSync(path.join(root, 'layerpitch-import-engine.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//, '').replace(/\/\/.*$/gm, '')));

if (failures) { console.log(failures + ' échec(s)'); process.exit(1); }
console.log('Moteur d\'import : tout est vert.');
