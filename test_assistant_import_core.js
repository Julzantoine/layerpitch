// Test de la logique pure de la porte « import par assistant » (Node 24 lit le .ts directement).
const core = require('./supabase/functions/_shared/assistant-import-core.ts');
let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
const tok = 'lpa_' + 'a1'.repeat(32);
(async () => {
  check('jeton bien formé accepté', core.parseBearer('Bearer ' + tok) === tok);
  check('jetons mal formés refusés', ['', 'Bearer', 'Bearer x', 'bearer ' + tok, 'Bearer ' + tok + 'a', 'Bearer ' + tok.toUpperCase(), 'Bearer ' + tok + ' x', 'Basic ' + tok].every((h) => core.parseBearer(h) === null) && core.parseBearer(null) === null);
  const h = await core.sha256Hex('abc');
  check('sha256 connu', h === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const wav = (a, b) => { const u = new Uint8Array(12); u.set(Buffer.from(a), 0); u.set(Buffer.from(b), 8); return u; };
  check('WAV RIFF/WAVE et RF64/WAVE acceptés', core.isWavHeader(wav('RIFF', 'WAVE')) && core.isWavHeader(wav('RF64', 'WAVE')));
  check('autres formats et en-têtes courts refusés', !core.isWavHeader(wav('RIFF', 'AVI ')) && !core.isWavHeader(wav('ID3\u0003', 'WAVE')) && !core.isWavHeader(new Uint8Array(5)) && !core.isWavHeader(new Uint8Array(0)));
  check('versions : ordre', core.compareVersions('0.1.0', '0.1.0') === 0 && core.compareVersions('0.0.9', '0.1.0') === -1 && core.compareVersions('1.0.0', '0.9.9') === 1 && core.compareVersions('0.10.0', '0.9.0') === 1);
  check('version illisible = trop ancienne', core.compareVersions('abc', '0.1.0') === -1 && core.compareVersions('', '0.1.0') === -1);
  check('uuid', core.isUuid('123e4567-e89b-12d3-a456-426614174000') && !core.isUuid('../x') && !core.isUuid(5));
  check('erreur base connue -> message français sans détail', core.dbErrorMessage('assistant:too_many_imports').code === 'too_many_imports' && /Trop d'imports/.test(core.dbErrorMessage('assistant:too_many_imports').text));
  check('erreur inconnue -> « Erreur interne. » (rien de la base ne fuit)', core.dbErrorMessage('relation "x" does not exist').text === 'Erreur interne.' && core.dbErrorMessage(undefined).code === 'internal');
  // ---- Garde-fous sur le code des deux fonctions de la porte ----
  const fs = require('fs');
  for (const fn of ['assistant-import', 'purge-assistant-imports']) {
    const src = fs.readFileSync('supabase/functions/' + fn + '/index.ts', 'utf8').replace(/\/\/.*$/gm, '');
    check(fn + ' : la clé de service ne sert qu\'à .rpc (aucun .from()/.storage)', !/\.from\(|\.storage\b/.test(src.replace(/Array\.from|Object\.from/g, '')));
    check(fn + ' : aucun en-tête CORS', !/Access-Control/i.test(src));
  }
  const door = fs.readFileSync('supabase/functions/assistant-import/index.ts', 'utf8');
  check('porte : seau PRIVÉ uniquement (R2_PROJECTS_BUCKET, jamais R2_BUCKET)', /R2_PROJECTS_BUCKET/.test(door) && !/Deno\.env\.get\('R2_BUCKET'\)/.test(door));
  check('porte : URL signée 15 min (900 s) pour envoi', /X-Amz-Expires=900/.test(door));
  check('porte : ne journalise ni le jeton ni les URL signées', !/log\([^)]*(token\b|upload_url|Authorization)/.test(door.replace(/tokenId/g, '')));
  if (failures) { console.log(failures + ' échec(s)'); process.exit(1); }
  console.log('Logique de la porte : tout est vert.');
})();
