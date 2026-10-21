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
  check('un code porté par un seul fichier ne forme pas de pool dédié', solo.groups.length === 3);
  const mots = w.groupFilesByNameFamily([f('Main_Perc.wav'), f('Main_Bass.wav')], false);
  check('mots ordinaires (casse mixte) non réunis par le préfixe', mots.groups.length === 2);
  process.exit(failures ? 1 : 0);
})();
