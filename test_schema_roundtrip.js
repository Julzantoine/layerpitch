// test_schema_roundtrip.js — LayerPitch, garde-fou ajouté le 24/09 (revue de code).
//
// Le « schéma » d'un morceau est décrit à la main à plusieurs endroits : la sérialisation du Backstage
// (buildDataSnapshot), la RPC Postgres upsert_track (dernière migration qui la définit) et la relecture
// (reshapeTrack, api/tracks.js). Un champ ajouté à l'un et oublié ailleurs disparaît EN SILENCE à la publication :
// c'est arrivé aux effets (23/09), au tag des Sfx (23/09) et aux tags de morceau (24/09).
//
// Ce test lit les trois sources et échoue si un champ de premier niveau publié par le Backstage n'est pas à la fois
// écrit par upsert_track et relu par reshapeTrack -- sauf s'il figure dans NOT_PERSISTED, avec sa raison.
const fs = require('fs');
const path = require('path');

// Champs volontairement absents de la base, avec la raison. Toute nouvelle entrée doit être justifiée ici.
const NOT_PERSISTED = {};
// Champs écrits/relus hors du snapshot de premier niveau (tables liées ou réglages d'organisation).
const EXTRA_OK = new Set(['segmentSlots', 'sfxIds', 'folderId', 'loops', 'sections', 'randomizeSections']);

let failures = 0;
const check = (ok, label) => { console.log((ok ? 'OK   - ' : 'FAIL - ') + label); if (!ok) failures++; };

// Clés de premier niveau d'un littéral objet commençant à `start` (position de la '{'), en ignorant tout ce qui est
// imbriqué (sous-objets, tableaux, appels, gabarits).
function topLevelKeys(src, start) {
  const keys = [];
  let depth = 0, str = null, expectKey = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; } // commentaire de fin de ligne
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if ('{[('.includes(c)) { depth++; if (depth === 1) expectKey = true; continue; }
    if ('}])'.includes(c)) { depth--; if (depth === 0) break; continue; }
    if (depth !== 1) continue;
    if (c === ',') { expectKey = true; continue; }
    if (expectKey && !/\s/.test(c)) {
      const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(src.slice(i));
      if (m) { keys.push(m[1]); i += m[0].length - 1; }
      else { const sh = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*(?=[,}])/.exec(src.slice(i)); if (sh) keys.push(sh[1]); }
      expectKey = false;
    }
  }
  return [...new Set(keys)];
}

// 1. Sérialisation du Backstage : l'objet renvoyé par library.map(t => ({ ... })) dans buildDataSnapshot.
const bs = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf8');
const snapStart = bs.indexOf('function buildDataSnapshot(');
const libStart = bs.indexOf('library: library.map(t => ({', snapStart);
check(snapStart > 0 && libStart > 0, 'buildDataSnapshot / library.map trouvés dans le Backstage');
const published = topLevelKeys(bs, bs.indexOf('({', libStart) + 1);

// 2. upsert_track : dernière migration qui la définit.
const migDir = path.join(__dirname, 'supabase', 'migrations');
let upsertSql = '';
for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  const s = fs.readFileSync(path.join(migDir, f), 'utf8');
  const k = s.indexOf('function public.upsert_track(');
  if (k >= 0) upsertSql = s.slice(k, s.indexOf('\n$$;', k));
}
const written = new Set([...upsertSql.matchAll(/payload\s*(?:->>|->)\s*'([A-Za-z_]+)'/g)].map(m => m[1]));

// 3. reshapeTrack (api/tracks.js).
const api = fs.readFileSync(path.join(__dirname, 'api', 'tracks.js'), 'utf8');
// Le DERNIER return { … } de reshapeTrack (les précédents appartiennent aux emplacements imbriqués).
const retStart = api.lastIndexOf('return {', api.indexOf('async function listTracks('));
const reread = new Set(topLevelKeys(api, retStart + 'return '.length));

check(published.length > 20, `${published.length} champs publiés trouvés (sanity)`);
for (const key of published) {
  if (NOT_PERSISTED[key]) { check(true, `${key} : volontairement non stocké (${NOT_PERSISTED[key]})`); continue; }
  check(written.has(key), `${key} : écrit par upsert_track`);
  check(reread.has(key), `${key} : relu par reshapeTrack`);
}
for (const key of written) {
  if (!published.includes(key) && !EXTRA_OK.has(key)) check(false, `${key} : écrit par upsert_track mais jamais publié par le Backstage`);
}

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
