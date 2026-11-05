// « Imports en attente » du Backstage (3/11) : bandeau caché sans feu vert, liste, téléchargement des fichiers, ouverture dans la fenêtre
// d'import de dossier avec la structure de l'assistant, effacement de la zone d'attente une fois le morceau créé, écartement. jsdom, faux services.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const src = fs.readFileSync(path.join(__dirname, 'src/backstage/16b-imports-en-attente.js'), 'utf8');
const dialog = fs.readFileSync(path.join(__dirname, 'src/backstage/16a-import-de-dossier.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf8');

// Branchements statiques
check('la page contient le conteneur et le script (fichier généré à jour)', /id="pendingImports"/.test(page) && /function openPendingImport/.test(page));
check('les feux verts rafraîchissent la liste', /refreshPendingImports\(\); \/\/ imports déposés/.test(page));
check('fenêtre d\'import de dossier : structure présélectionnée par l\'assistant et rappel à la création du morceau', /folder\.presetMode/.test(dialog) && /activeFolderImport = folder\.onRegistered/.test(dialog) && /if \(done\) done\(\)/.test(dialog));
check('le serveur efface les fichiers à la fin (finish) et la liste ne passe que par des fonctions du compte', /action: 'finish'|'finish'/.test(src) && /rpc\('list_my_pending_imports'\)/.test(src));

const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
const I = sb.window.LAYERPITCH_I18N;
const keys = [...new Set([...src.matchAll(/tr\('(pendingImports\w+)'/g)].map(m => m[1]))].concat(['importFolderWhy_assistant']);
check('tous les textes existent en FR et EN', keys.every(k => I.fr.backstage[k] && I.en.backstage[k]));

function env(flagOn, list) {
  const dom = new JSDOM('<div id="pendingImports" hidden></div>', { runScripts: 'outside-only', url: 'http://localhost/layerpitch-backstage.html' });
  const w = dom.window, calls = { invoke: [], opened: [], fetched: [], rpc: 0 };
  w.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  w.escapeAttr = w.escapeHtml; w.currentLang = () => 'fr';
  w.tr = (k, v) => { let s = I.fr.backstage[k] || k; if (v) Object.keys(v).forEach(x => { s = s.split('{' + x + '}').join(v[x]); }); return s; };
  w.flagOpen = k => flagOn && k === 'assistant_import';
  w.folderImportByName = (a, b) => a.name.localeCompare(b.name);
  w.LayerPitchNotify = { confirm: async () => true, error: () => {} };
  w.LayerPitchAuth = { describeFunctionError: async e => e.message };
  w.openFolderImportDialog = f => calls.opened.push(f);
  w.fetch = async url => { calls.fetched.push(url); return { ok: true, blob: async () => new w.Blob(['RIFF....WAVE']) }; };
  w.LayerPitchSupabaseClient = { getClient: () => ({
    rpc: async () => { calls.rpc++; return { data: list, error: null }; },
    functions: { invoke: async (name, o) => { calls.invoke.push([name, o.body]); return { data: o.body.action === 'download_urls' ? { files: [{ id: 'b', name: 'B #2.wav', url: 'https://r2/b' }, { id: 'a', name: 'A #1.wav', url: 'https://r2/a' }] } : { ok: true }, error: null }; } },
  }) };
  w.eval(src);
  return { w, d: w.document, calls };
}
const imp = [{ id: 'imp1', title: 'Monte en l\'air', plan: { mode: 'embranchement-vertical', folder: 'Monte' }, expires_at: '2099-01-01T00:00:00Z', files: [{ id: 'a', name: 'A #1.wav', size: 2097152 }, { id: 'b', name: 'B #2.wav', size: 1048576 }] }];

(async () => {
  let e = env(false, imp);
  await e.w.refreshPendingImports();
  check('feu vert fermé : bandeau caché, aucune lecture', e.d.getElementById('pendingImports').hidden && e.calls.rpc === 0);

  e = env(true, []);
  await e.w.refreshPendingImports();
  check('aucun import : bandeau caché', e.d.getElementById('pendingImports').hidden);

  e = env(true, imp);
  await e.w.refreshPendingImports();
  const host = e.d.getElementById('pendingImports');
  check('imports listés : titre, nombre de fichiers, taille', !host.hidden && /Monte en l'air/.test(host.textContent) && /2 fichier/.test(host.textContent) && /3\.0 Mo/.test(host.textContent) && /Construire le morceau/.test(host.textContent));
  host.querySelector('[data-pi-btn="open"]').click();
  for (let i = 0; i < 8; i++) await tick();
  const [name, folderArg] = [e.calls.invoke[0], e.calls.opened[0]];
  check('liens demandés pour CET import', name[0] === 'pending-import-files' && name[1].action === 'download_urls' && name[1].import_id === 'imp1');
  check('fichiers téléchargés puis ouverts dans la fenêtre d\'import de dossier, triés, en vrais File', e.calls.fetched.length === 2 && folderArg && folderArg.files.map(f => f.name).join() === 'A #1.wav,B #2.wav' && folderArg.files.every(f => f instanceof e.w.File));
  check('titre repris (modifiable dans la fenêtre) et structure de l\'assistant présélectionnée', folderArg.name === "Monte en l'air" && folderArg.presetMode === 'embranchement-vertical');
  check('rien n\'est effacé avant la création du morceau', e.calls.invoke.length === 1);
  folderArg.onRegistered(); await tick(); await tick();
  check('morceau créé : la zone d\'attente est effacée (finish added), liste rafraîchie', e.calls.invoke[1][1].action === 'finish' && e.calls.invoke[1][1].outcome === 'added' && e.calls.rpc >= 2);

  e = env(true, imp);
  await e.w.refreshPendingImports();
  e.d.querySelector('[data-pi-btn="discard"]').click(); await tick(); await tick(); await tick();
  check('écarter : confirmation puis finish discarded', e.calls.invoke[0][1].action === 'finish' && e.calls.invoke[0][1].outcome === 'discarded');
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
