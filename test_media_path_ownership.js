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

  // Factures : jamais dans le seau média (servi publiquement sur media.layerpitch.com, chemin devinable).
  const hook = fs.readFileSync(path.join(__dirname, 'supabase/functions/stripe-webhook/index.ts'), 'utf-8');
  const up = hook.slice(hook.indexOf('async function uploadInvoiceToR2('), hook.indexOf('\n}\n', hook.indexOf('async function uploadInvoiceToR2(')));
  check('Facture : enregistrée dans le seau privé, sans repli sur le seau public',
    /Deno\.env\.get\('R2_INVOICES_BUCKET'\)/.test(up) && !/R2_BUCKET'/.test(up) && /if \(!bucket\) throw/.test(up));
  const dl = fs.readFileSync(path.join(__dirname, 'supabase/functions/get-invoice-download-url/index.ts'), 'utf-8');
  check('Facture : relue dans le seau privé', /Deno\.env\.get\('R2_INVOICES_BUCKET'\)/.test(dl) && !/R2_BUCKET'/.test(dl));

  if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
  console.log('\nTout est OK');
})();
