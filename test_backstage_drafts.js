// Brouillon automatique du Backstage (27/09) : les modifications non publiées survivent à un rechargement ou à un
// plantage de l'onglet. Vérifie le vrai code extrait de layerpitch-backstage.html : l'encodage (fichiers remplacés par
// une référence et rendus à l'identique, Map/Set conservés, fonctions écartées), et le branchement (proposition de
// reprise après le premier chargement, effacement à la publication et au rechargement volontaire, enregistrement
// seulement quand il y a des modifications). Le cycle complet avec la vraie base du navigateur (IndexedDB) a été vérifié
// dans Chromium le 27/09 (changelog [2026-09-27e]).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

const html = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');
const grab = name => { const a = html.indexOf('function ' + name + '('); const b = html.indexOf('\n}\n', a) + 3; return html.slice(a, b); };
const ctx = { Blob, File, Map, Set, WeakMap, Node: function () {}, JSON, Date, draftFileSeq: 0 };
vm.createContext(ctx);
vm.runInContext('const draftFileIds = new WeakMap(); let draftFileSeq = 0;\n' + grab('draftEncode') + grab('draftDecode') + '\nthis.enc = draftEncode; this.dec = draftDecode;', ctx);

(async () => {
  const f = new File(['abc'], 'boucle été.wav', { type: 'audio/wav' });
  const state = {
    library: [{ id: 't1', layers: [{ pendingFile: f, remoteFile: null, gain: 0.8 }, { pendingFile: f }], render: () => 1 }],
    pendingR2Deletes: new Map([['tracks:x', ['audio/x/a.ogg']]]),
    pendingOrphanR2Keys: new Set(['audio/y/b.ogg']),
    n: null, flag: false,
  };
  const files = new Map();
  const encoded = ctx.enc(state, files);
  const json = JSON.stringify(encoded);
  check('encodage : le fichier devient une référence, rangé une seule fois', files.size === 1 && !/abc/.test(json) && /__lpDraftFile/.test(json));
  check('encodage : même fichier à deux endroits = même référence', encoded.library[0].layers[0].pendingFile.__lpDraftFile === encoded.library[0].layers[1].pendingFile.__lpDraftFile);
  check('encodage : fonctions écartées', !('render' in encoded.library[0]));
  const again = new Map(); ctx.enc(state, again);
  check('encodage répété : identifiant du fichier stable (pas de réécriture)', [...again.keys()][0] === [...files.keys()][0]);
  const back = ctx.dec(JSON.parse(json), files);
  check('décodage : fichier rendu à l’identique (nom, contenu)', back.library[0].layers[0].pendingFile.name === 'boucle été.wav' && await back.library[0].layers[0].pendingFile.text() === 'abc');
  check('décodage : Map et Set rendus', back.pendingR2Deletes instanceof ctx.Map && back.pendingR2Deletes.get('tracks:x')[0] === 'audio/x/a.ogg' && back.pendingOrphanR2Keys.has('audio/y/b.ogg'));
  check('décodage : valeurs simples intactes', back.library[0].layers[0].gain === 0.8 && back.n === null && back.flag === false);
  const lost = ctx.dec(JSON.parse(json), new Map());
  check('fichier introuvable dans la base : null (pas de plantage)', lost.library[0].layers[0].pendingFile === null);

  // Branchement dans la page
  check('premier chargement puis proposition de reprise', /await loadData\(true\); await offerDraftRestore\(\);/.test(html));
  check('publication réussie : brouillon effacé', /hasUnsavedEdits = false;\s*clearDraft\(\);/.test(html));
  check('rechargement volontaire : brouillon effacé', /if \(!proceed\) return;\s*await clearDraft\(\);/.test(html));
  check('enregistrement seulement avec des modifications non publiées', /setInterval\(\(\) => \{ if \(hasUnsavedEdits\) saveDraftNow\(\); \}/.test(html));
  check('aucune écriture avant la décision « reprendre / ignorer »', /draftDecisionPending\) return;/.test(html) && /finally \{\s*draftDecisionPending = false;/.test(html));
  check('brouillon rangé par compte', /st\.put\(\{ v: 1, savedAt: Date\.now\(\), baselinePublishedAt: loadedPublishedAt, state: json \}, loadedComposerId\)/.test(html));
  check('publication faite ailleurs entre-temps : avertissement', /draft\.baselinePublishedAt !== loadedPublishedAt/.test(html));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
