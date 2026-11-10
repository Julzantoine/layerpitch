// Annuler / rétablir dans l'atelier vidéo (10/11, demande de Jules-Antoine : Cmd+Z) : la mécanique d'historique est extraite du code de l'atelier
// et rejouée dans un faux contexte (pas de navigateur) : une retouche s'empile, annuler / rétablir rejouent un instantané, une retouche après un
// « annuler » efface ce qu'on aurait pu rétablir, l'historique est plafonné, rien ne bouge pendant une prise en direct.
const fs = require('fs'), path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const src = fs.readFileSync(path.join(__dirname, 'src/atelier/18-panneau-de-capture.js'), 'utf8');
const a = src.indexOf('  const HISTORY_MAX = 100;');
const b = src.indexOf("  undoBtn.addEventListener('click'");
check('code d’historique trouvé dans le panneau de capture', a > 0 && b > a);
const body = src.slice(a, b);
const make = () => {
  const env = { lastEvents: [], laneOverrides: {}, collapsedGroups: {}, timelineMarkers: [], videoCaptureState: null, renders: 0, refreshes: 0 };
  const undoBtn = { disabled: true }, redoBtn = { disabled: true };
  const fn = new Function('env', 'undoBtn', 'redoBtn', `
    let lastEvents = env.lastEvents, laneOverrides = env.laneOverrides, collapsedGroups = env.collapsedGroups, timelineMarkers = env.timelineMarkers;
    const countEl = { textContent: '' }; const captureCountText = () => '';
    let videoCaptureState = null; const renderEditableTimeline = () => { env.renders++; };
    function refreshActionButtons() { historyPush(); syncHistoryButtons(); env.refreshes++; }
    ${body.replace("const undoBtn = document.getElementById('videoCaptureUndoBtn');", '').replace("const redoBtn = document.getElementById('videoCaptureRedoBtn');", '')}
    return {
      get state() { return { e: lastEvents, l: laneOverrides, g: collapsedGroups, m: timelineMarkers }; },
      edit(f) { f({ get e() { return lastEvents; }, set e(v) { lastEvents = v; }, get m() { return timelineMarkers; }, set m(v) { timelineMarkers = v; } }); refreshActionButtons(); },
      reset: historyReset, go: historyGo, setRecording(v) { videoCaptureState = v; syncHistoryButtons(); },
      depth: () => historyStack.length,
    };`);
  return { api: fn(env, undoBtn, redoBtn), undoBtn, redoBtn, env };
};

{ // base
  const { api, undoBtn, redoBtn } = make();
  api.reset();
  check('départ : rien à annuler ni à rétablir', undoBtn.disabled && redoBtn.disabled);
  api.edit(s => { s.e = [{ name: 'a' }]; });
  api.edit(s => { s.e = [{ name: 'a' }, { name: 'b' }]; });
  check('deux retouches : on peut annuler, pas rétablir', !undoBtn.disabled && redoBtn.disabled);
  api.go(-1);
  check('annuler revient à l’état d’avant (1 événement)', api.state.e.length === 1);
  api.go(-1);
  check('annuler encore : état de départ (vide) et plus rien à annuler', api.state.e.length === 0 && undoBtn.disabled);
  api.go(1); api.go(1);
  check('rétablir deux fois : état final (2 événements)', api.state.e.length === 2 && redoBtn.disabled);
  api.go(-1);
  api.edit(s => { s.e = [{ name: 'c' }]; });
  check('retouche après un annuler : on ne peut plus rétablir l’ancienne suite', redoBtn.disabled && api.state.e[0].name === 'c');
}
{ // marqueurs et doublons
  const { api, undoBtn } = make();
  api.reset();
  api.edit(s => { s.m = [{ id: 'm1', t: 3, label: 'A' }]; });
  api.edit(s => { s.m = [{ id: 'm1', t: 3, label: 'A' }]; }); // identique : pas d'instantané en plus
  check('un état identique ne crée pas de nouvelle étape', api.depth() === 2);
  api.go(-1);
  check('annuler un marqueur ajouté', api.state.m.length === 0 && undoBtn.disabled);
}
{ // plafond
  const { api } = make();
  api.reset();
  for (let i = 0; i < 130; i++) api.edit(s => { s.e = [{ n: i }]; });
  check('historique plafonné à 100 étapes', api.depth() === 100);
}
{ // prise en direct
  const { api, undoBtn } = make();
  api.reset();
  api.edit(s => { s.e = [{ name: 'a' }]; });
  api.setRecording({});
  api.go(-1);
  check('pendant une prise en direct, annuler ne fait rien', api.state.e.length === 1 && undoBtn.disabled);
}
check('boutons et raccourci présents', /id="videoCaptureUndoBtn"/.test(src) && /id="videoCaptureRedoBtn"/.test(src) && /String\(e\.key\)\.toLowerCase\(\) !== 'z'/.test(src) && /historyReset\(\);/.test(src));
console.log(failures ? failures + ' échec(s)' : 'Tous les tests passent.');
process.exit(failures ? 1 : 0);
