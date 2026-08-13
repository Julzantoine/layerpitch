// Non-régression (bug trouvé le 13/08, signalé par Jules-Antoine : "les durées de fade out
// personnalisées ne fonctionnent pas") : `customCutFadeSec` (et le tempo par emplacement, bpm/beatsPerBar,
// même trou) étaient bien lus/écrits dans le formulaire et transmis à l'aperçu local ("Écouter"), mais
// PAS à la vraie publication (data.json) ni au rechargement d'un morceau déjà publié — cutStyle partait
// bien en 'custom', mais la durée elle-même se perdait en route, donc le site publié retombait
// silencieusement sur le fondu par défaut de 0.15s.
//
// Ce test extrait directement les DEUX mappings segmentSlots concernés (publication et chargement) du
// code source de layerpitch-backstage.html et les évalue isolément — même principe que
// test-section-scheduler.js/test-slot-chain-advancer.js pour player.js, aucune dépendance à
// jsdom/DOM/réseau nécessaire pour ce point précis.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');

function extractMapBody(startMarker) {
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) throw new Error('marker not found: ' + startMarker);
  const mapStart = src.indexOf('sl => ({', startIdx);
  // Trouve le "}))" fermant correspondant par comptage de profondeur de parenthèses depuis "({".
  let depth = 0, i = src.indexOf('(', mapStart), started = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '(') { depth++; started = true; }
    else if (c === ')') { depth--; if (started && depth === 0) { i++; break; } }
    i++;
  }
  const fnSrc = 'function(sl) { return ' + src.slice(mapStart + 'sl => '.length, i) + '; }';
  return eval('(' + fnSrc + ')');
}

// Fonction fictive nécessaire dans le scope eval (utilisée par le mapping de chargement pour un id manquant).
function genId() { return 'test-id'; }

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

// ---- Publication (library -> data.json), ligne ~5619 : anchor unique juste avant ce mapping précis ----
{
  const mapPublish = extractMapBody("outro: (t.outro && t.outro.remoteFile) ? { label: t.outro.label || 'Outro', file: t.outro.remoteFile, gain: t.outro.gain || 1 } : null,\n        segmentSlots:");
  const slot = { id: 's1', label: 'A', cutStyle: 'custom', customCutFadeSec: 2.5, bpm: 90, beatsPerBar: 3, alternatives: [] };
  const out = mapPublish(slot);
  check('publication : customCutFadeSec transmis à data.json', out.customCutFadeSec === 2.5);
  check('publication : cutStyle transmis', out.cutStyle === 'custom');
  check('publication : bpm par emplacement transmis à data.json', out.bpm === 90);
  check('publication : beatsPerBar par emplacement transmis à data.json', out.beatsPerBar === 3);
}

// ---- Chargement (data.json -> library éditable), ligne ~5050 : anchor unique juste avant ce mapping précis ----
{
  const mapLoad = extractMapBody("outro: t.outro ? { label: t.outro.label || 'Outro', remoteFile: t.outro.file || null, pendingFile: null, gain: t.outro.gain || 1 } : null,");
  const slotFromJson = { id: 's1', label: 'A', cutStyle: 'custom', customCutFadeSec: 2.5, bpm: 90, beatsPerBar: 3, alternatives: [] };
  const out = mapLoad(slotFromJson);
  check('chargement : customCutFadeSec repris depuis un data.json déjà publié', out.customCutFadeSec === 2.5);
  check('chargement : cutStyle repris', out.cutStyle === 'custom');
  check('chargement : bpm par emplacement repris depuis un data.json déjà publié', out.bpm === 90);
  check('chargement : beatsPerBar par emplacement repris depuis un data.json déjà publié', out.beatsPerBar === 3);
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
