// Cloison entre compositeurs sur le stockage média (27/09) : le 18/09, la photo de bio d'un bêta-testeur a remplacé
// celle de l'AdReel 'main' de Jules-Antoine -- même nom de fichier à plat (images/photo-main.jpg) pour tous les
// comptes, et une vérification de propriété qui laissait passer quand la recherche échouait. Vérifie le vrai code :
// verifyOwnership() extrait de create-media-signed-url (types TypeScript retirés), avec une base simulée, et
// publishAll() du Backstage (chaque image envoyée dans images/<id du compositeur>/).
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

const edge = fs.readFileSync(path.join(__dirname, 'supabase/functions/create-media-signed-url/index.ts'), 'utf-8');
const a = edge.indexOf('async function verifyOwnership(');
const b = edge.indexOf('\n}\n', a) + 3;
let src = edge.slice(a, b)
  .replace(/\(adminClient: [^,]+, path: string, composerId: string\): Promise<boolean>/, '(adminClient, path, composerId)')
  .replace(/const checks: Array<\{ pattern: RegExp; table: string \}> =/, 'const checks =');
check('verifyOwnership extrait', a > 0 && !/: string|Promise</.test(src));
const verifyOwnership = new Function(src + '\nreturn verifyOwnership;')();

// Base simulée : { table: { id: owner_id } } ; failTables = tables dont la lecture renvoie une erreur.
function fakeDb(rows, failTables = []) {
  return {
    from(table) {
      return { select() { return { eq(_col, id) { return { async maybeSingle() {
        if (failTables.includes(table)) return { data: null, error: { message: 'boom' } };
        const owner = (rows[table] || {})[id];
        return { data: owner ? { owner_id: owner } : null, error: null };
      } }; } }; } };
    },
  };
}
const A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const db = fakeDb({ tracks: { tB: B, tA: A }, sfx_library: { sB: B }, composer_videos: { vB: B } });

(async () => {
  // Images : uniquement dans son propre dossier.
  check('image dans son dossier : autorisée', await verifyOwnership(db, `images/${A}/photo-main.jpg`, A));
  check('image dans le dossier d’un autre : refusée', !(await verifyOwnership(db, `images/${B}/photo-main.jpg`, A)));
  check('ancienne image à plat (photo-main) : refusée', !(await verifyOwnership(db, 'images/photo-main.jpg', A)));
  check('ancienne image de bloc à plat : refusée', !(await verifyOwnership(db, 'images/bmrc9wrt713mzm-0.png', A)));
  check('sous-dossier imbriqué : refusé', !(await verifyOwnership(db, `images/${A}/x/y.png`, A)));
  check('police dans son dossier : autorisée', await verifyOwnership(db, `fonts/${A}/f1.woff2`, A));
  check('police d’un autre : refusée', !(await verifyOwnership(db, `fonts/${B}/f1.woff2`, A)));

  // Audio / vidéo : id globalement unique, vérifié en base.
  check('audio de son morceau : autorisé', await verifyOwnership(db, 'audio/tA/0-piste.ogg', A));
  check('audio du morceau d’un autre : refusé', !(await verifyOwnership(db, 'audio/tB/0-piste.ogg', A)));
  check('Sfx d’un autre : refusé', !(await verifyOwnership(db, 'audio/sfx-sB/0-x.ogg', A)));
  check('vidéo d’un autre : refusée', !(await verifyOwnership(db, 'video/vB/source.mp4', A)));
  check('nouveau morceau (pas encore en base) : autorisé', await verifyOwnership(db, 'audio/tNew/0-piste.ogg', A));
  check('erreur de lecture en base : refusé (jamais autorisé par défaut)',
    !(await verifyOwnership(fakeDb({}, ['tracks']), 'audio/tNew/0-piste.ogg', A)));
  check('chemin inconnu : refusé', !(await verifyOwnership(db, 'invoices/x/LP-1.pdf', A)));

  // Backstage : chaque envoi d'image passe par le dossier du compositeur.
  const html = fs.readFileSync(path.join(__dirname, 'layerpitch-backstage.html'), 'utf-8');
  const lines = html.split('\n');
  const imageUploads = [];
  lines.forEach((l, i) => { if (/r2PutFile\(`images\//.test(l)) imageUploads.push(i); });
  check('Backstage : envois d’images trouvés (dont la pochette d’album)', imageUploads.length >= 11);
  check('Backstage : chaque image va dans images/<id du compositeur>/',
    imageUploads.every(i => /r2PutFile\(`images\/\$\{fileName\}`/.test(lines[i]) && /const fileName = `\$\{(myComposerId|composerId)\}\//.test(lines[i - 1])));
  const iPub = html.indexOf('async function publishAll');
  const iId = html.indexOf('ensureMyComposerProfile()', iPub);
  check('Backstage : identité du compositeur résolue avant le premier envoi de la publication', iId > 0 && iId < html.indexOf('r2PutFile(`images/', iPub));

  // Types et tailles acceptés à l'envoi (27/09) : vrai uploadHeadersFor() extrait de la fonction.
  const r0 = edge.indexOf('const MB = 1024 * 1024;');
  const r1 = edge.indexOf('\n}\n', edge.indexOf('function uploadHeadersFor(')) + 3;
  const rulesSrc = edge.slice(r0, r1)
    .replace(/const MEDIA_RULES: Record<string, \{ types: Record<string, string>; maxBytes: number \}> =/, 'const MEDIA_RULES =')
    .replace(/\(path: string, size: unknown\): \{ headers: Record<string, string> \} \| \{ error: string \}/, '(path, size)')
    .replace(/const headers: Record<string, string> =/, 'const headers =');
  check('uploadHeadersFor extrait', r0 > 0 && !/: string|: unknown|Record</.test(rulesSrc));
  const uploadHeadersFor = new Function(rulesSrc + '\nreturn uploadHeadersFor;')();
  const img = (ext, size = 1000) => uploadHeadersFor(`images/${A}/photo-main.${ext}`, size);
  check('image .jpg : acceptée, servie en image/jpeg', img('jpg').headers && img('jpg').headers['content-type'] === 'image/jpeg');
  check('image .gif : acceptée (GIF animés)', img('gif').headers && img('gif').headers['content-type'] === 'image/gif');
  check('image .png/.webp/.avif : acceptées', ['png', 'webp', 'avif'].every(e => img(e).headers));
  check('image .svg : acceptée mais téléchargée si ouverte directement', img('svg').headers && img('svg').headers['content-disposition'] === 'attachment');
  check('page .html : refusée', /Type de fichier non accepté \(\.html\)/.test(img('html').error || ''));
  check('.js / .exe / .pdf : refusés', ['js', 'exe', 'pdf'].every(e => img(e).error));
  check('taille signée avec le type', img('png', 4242).headers['content-length'] === '4242');
  check('image de 21 Mo : refusée (max 20 Mo)', /trop lourd/.test(img('png', 21 * 1024 * 1024).error || ''));
  check('taille absente : refusée', !!uploadHeadersFor(`images/${A}/x.png`, undefined).error && !!uploadHeadersFor(`images/${A}/x.png`, '12').error);
  check('audio .ogg accepté, .mp3 refusé', !!uploadHeadersFor('audio/tA/0-x.ogg', 10).headers && !!uploadHeadersFor('audio/tA/0-x.mp3', 10).error);
  check('vidéo .mp4 de 1 Go acceptée, .mov refusée', !!uploadHeadersFor('video/v1/source.mp4', 1024 ** 3).headers && !!uploadHeadersFor('video/v1/source.mov', 10).error);
  check('police .woff2 acceptée, .html refusée', !!uploadHeadersFor(`fonts/${A}/f.woff2`, 10).headers && !!uploadHeadersFor(`fonts/${A}/f.html`, 10).error);
  check('Edge Function : type et taille verrouillés dans la signature', /allHeaders: true/.test(edge) && /uploadHeadersFor\(path, size\)/.test(edge));
  const iReserve = edge.indexOf("rpc('reserve_video_upload'");
  check('Edge Function : quota vidéo réservé sur la taille verrouillée, avant toute signature',
    iReserve > 0 && iReserve < edge.indexOf('client.sign(') && /p_size: size/.test(edge) && iReserve > edge.indexOf('uploadHeadersFor(path, size)', edge.indexOf('Deno.serve')));
  const mig = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20260927060000_video_upload_reservation.sql'), 'utf-8');
  check('migration : réservation réservée au rôle service', /revoke all on function public\.reserve_video_upload\(uuid, text, bigint\) from public, anon, authenticated/.test(mig));
  check('migration : upsert_video ne reprend plus la taille du navigateur',
    !/size_bytes = excluded\.size_bytes|nullif\(payload->>'sizeBytes'/.test(mig.slice(mig.indexOf('function public.upsert_video'))));

  // Côté navigateur : r2PutFile (vrai code du Backstage et de pack.html) annonce la taille et renvoie les en-têtes imposés.
  for (const file of ['layerpitch-backstage.html', 'pack.html']) {
    const page = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    const s0 = page.indexOf('async function r2SignedUrl(');
    const s1 = page.indexOf('\n}\n', page.indexOf('async function r2PutFile(')) + 3;
    const calls = [];
    const win = {
      LayerPitchSupabaseClient: { getClient: () => ({ functions: { invoke: async (_n, { body }) => { calls.push(body); return { data: { url: 'https://r2/x', headers: { 'content-type': 'image/gif' } }, error: null }; } } }) },
      LayerPitchAuth: { describeFunctionError: async e => String(e) },
    };
    const fetches = [];
    const fn = new Function('window', 'fetch', 'loadPostgresReadScripts', page.slice(s0, s1) + '\nreturn r2PutFile;')(
      win, async (url, opts) => { fetches.push({ url, opts }); return { ok: true }; }, async () => {});
    await fn(`images/${A}/x.gif`, new Uint8Array(7), 'image/jpeg');
    check(`${file} : taille annoncée au serveur`, calls[0] && calls[0].size === 7 && calls[0].method === 'PUT');
    check(`${file} : en-têtes du serveur renvoyés tels quels à R2`, fetches[0] && fetches[0].opts.headers['content-type'] === 'image/gif');
  }

  // Factures : jamais dans le seau média (servi publiquement sur media.layerpitch.com, chemin devinable).
  const hook = fs.readFileSync(path.join(__dirname, 'supabase/functions/stripe-webhook/index.ts'), 'utf-8');
  const up = hook.slice(hook.indexOf('async function uploadInvoiceToR2('), hook.indexOf('\n}\n', hook.indexOf('async function uploadInvoiceToR2(')));
  check('Facture : enregistrée dans le seau privé, sans repli sur le seau public',
    /Deno\.env\.get\('R2_INVOICES_BUCKET'\)/.test(up) && !/R2_BUCKET'/.test(up) && /if \(!bucket\) throw/.test(up));
  const dl = fs.readFileSync(path.join(__dirname, 'supabase/functions/get-invoice-download-url/index.ts'), 'utf-8');
  check('Facture : relue dans le seau privé', /Deno\.env\.get\('R2_INVOICES_BUCKET'\)/.test(dl) && !/R2_BUCKET'/.test(dl));

  if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
  console.log('\nTout est OK');
})();// Pochette d'un album de studio (29/09) : images/<id du studio>/album-<id>.<ext>, dossier du studio seulement, sans profil compositeur.
check('pochette de studio : chemin images/<studio>/album-… accepté seulement pour le dossier du studio de l\'appelant', /studio_profiles/.test(edge) && /album-\[\^\/\]\+/.test(edge) && /path\.startsWith\(`images\/\$\{studio\.id\}\/`\)/.test(edge));
check('pochette de studio : le profil compositeur n\'est créé que hors de ce cas', /if \(!studioFolderId\)[\s\S]{0,80}ensure_composer_profile/.test(edge));

