// Dépôt de dossier : les fichiers qui partagent un code court en majuscules (« BS_ », « DM_ », « KB_ ») forment un seul pool (21/10).
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const f = name => ({ name });
  const names = [
    'DM_DirtRoad_4M_110bpm.wav', 'DM_Foothills_4M_110bpm.wav', 'DM_Flat Bed_4M_110bpm.wav',
    'BS_Stories Told_4M_110bpm.wav', 'BS_Sweet Summer_4M_110bpm.wav', 'BS_Walking Strong_4M_110bpm.wav',
    "KB_Journey's End_4M_110bpm.wav", 'KB_Carry On_4M_110bpm.wav', 'KB_Fluid Chords_4M_110bpm.wav',
    'Jazz - 2bts IntroONLY_110bpm.wav'
  ];
  const r = w.groupFilesByNameFamily(names.map(f), true);
  const byLabel = {}; r.groups.forEach(g => { byLabel[g.label] = g.files.length; });
  check('BS, DM et KB sont chacun un pool', ['BS', 'DM', 'KB'].every(c => byLabel[c] === 3));
  check('le fichier sans code reste un pool à part', r.groups.length === 4);
    const solo = w.groupFilesByNameFamily([f('BS_Seul.wav'), f('Main_Perc.wav'), f('Main_Bass.wav')], false);
  check('un préfixe porté par un seul fichier ne forme pas de pool dédié', solo.groups.length === 2 && solo.groups.some(g => g.label === 'Main' && g.files.length === 2));
  const casse = w.groupFilesByNameFamily([f('bs_a.wav'), f('BS_b.wav')], false);
  check('casse ignorée pour le préfixe', casse.groups.length === 1 && casse.groups[0].files.length === 2);
  const sans = w.groupFilesByNameFamily([f('Hit 1.wav'), f('Hit 2.wav'), f('Autre.wav')], false);
  check('sans « _ » : règles de familles de noms inchangées', sans.groups.length === 2);
  const milieu = w.groupFilesByNameFamily(['Jazz Lo_DM_DirtRoad_4M_110bpm.wav', 'Jazz LoHi_DM_Foothills_4M_110bpm.wav'].map(f), false);
  check('préfixe = avant le premier « _ » (ici « Jazz Lo » et « Jazz LoHi » restent distincts)', milieu.groups.length === 2);
  const g1 = w.guessFolderStructure('', [f('Jazz Hi_2bts Intro_8M_110bpm.wav')]);
  check('un seul fichier : structure statique proposée', g1.mode === 'static');
  const g2 = w.guessFolderStructure('', [f('A_1.wav'), f('B_1.wav')]);
  check('deux fichiers : pas de statique', g2.mode !== 'static');
  process.exit(failures ? 1 : 0);
})();
