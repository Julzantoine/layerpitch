// Fichiers audio gardés pour les versions d'album (A.8, 27/09 : « le fan garde ce qu'il a acheté »). Vérifie la chaîne
// complète hors base : la migration réserve la vérification au rôle service ; l'Edge Function create-media-signed-url
// la consulte avant de signer un effacement audio (et garde le fichier en cas de doute) ; le Backstage (r2DeleteFile,
// vrai code extrait) n'efface rien quand le serveur répond « gardé » et efface normalement sinon. La requête SQL elle-même
// est vérifiée sur PGlite (voir le changelog [2026-09-27a]).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

const sql = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20260927010000_media_kept_for_versions.sql'), 'utf-8');
check('migration : fonction réservée au rôle service', /revoke all on function public\.media_path_used_by_versions\(text\[\]\) from public, anon, authenticated/.test(sql) && /to service_role/.test(sql));
check('migration : cherche dans les prises des fans ET dans les versions du compositeur', /album_track_versions/.test(sql) && /default_settings->>'kind' = 'layerpitch-take'/.test(sql));

const edge = fs.readFileSync(path.join(__dirname, 'supabase/functions/create-media-signed-url/index.ts'), 'utf-8');
const iUse = edge.indexOf("rpc('media_path_kept_for_fans'"), iSign = edge.indexOf('client.sign(');
check('Edge Function : vérification avant toute signature', iUse > 0 && iSign > iUse);
check('Edge Function : seulement pour un effacement audio', /method === 'DELETE' && path\.startsWith\('audio\/'\)/.test(edge));
check('Edge Function : chemin brut ET nom de fichier encodé comme le lecteur', /encodeURIComponent\(path\.slice\(cut \+ 1\)\)/.test(edge));
check('Edge Function : garde le fichier en cas d’erreur de vérification', /if \(usedError \|\| used\)/.test(edge) && /kept: true/.test(edge));

const html = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');
const a = html.indexOf('async function r2DeleteFile(key)');
const b = html.indexOf('\n}\n', a) + 3;
const fnSrc = html.slice(a, b);
check('r2DeleteFile extrait du Backstage', a > 0 && /data\.kept/.test(fnSrc));

async function run(reply) {
  const calls = { deletes: [] };
  const ctx = {
    loadPostgresReadScripts: async () => {},
    window: {
      LayerPitchSupabaseClient: { getClient: () => ({ functions: { invoke: async (name, { body }) => { calls.invoke = { name, body }; return reply; } } }) },
      LayerPitchAuth: { describeFunctionError: async e => e.message },
    },
    fetch: async (url, opts) => { calls.deletes.push([url, opts.method]); return { ok: true, status: 204, text: async () => '' }; },
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc + '\nthis.r2DeleteFile = r2DeleteFile;', ctx);
  const r = await ctx.r2DeleteFile('audio/t1/boucle.ogg');
  return { r, calls };
}
(async () => {
  let x = await run({ data: { ok: true, kept: true }, error: null });
  check('fichier utilisé : aucun effacement, résultat « kept »', x.r === 'kept' && x.calls.deletes.length === 0 && x.calls.invoke.body.method === 'DELETE' && x.calls.invoke.body.path === 'audio/t1/boucle.ogg');
  x = await run({ data: { ok: true, url: 'https://signed/del' }, error: null });
  check('fichier libre : effacé avec l’URL signée', x.r !== 'kept' && x.calls.deletes.length === 1 && x.calls.deletes[0][0] === 'https://signed/del' && x.calls.deletes[0][1] === 'DELETE');
  let threw = false;
  try { await run({ data: null, error: { message: 'Ce fichier ne t’appartient pas.' } }); } catch (e) { threw = /appartient/.test(e.message); }
  check('refus du serveur : erreur remontée (journal du Backstage)', threw);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
