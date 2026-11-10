// Révisions figées de la relecture client (10/11) : vérifications de la migration (hors base) et de l'expansion côté page client (vrai code extrait).
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (l, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' - ' + l); if (!c) failures++; };
const sql = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20261110020000_video_review_revisions.sql'), 'utf8');
check('table sans policy (RLS activée)', /create table if not exists public\.video_review_revisions/.test(sql) && /alter table public\.video_review_revisions enable row level security/.test(sql) && !/create policy/i.test(sql));
check('fonction de figeage interne : fermée au navigateur', /revoke all on function public\.video_freeze_revision\(text, text, text, jsonb\) from public, anon, authenticated/.test(sql));
check('une vidéo de révision n’est jamais effacée', /select 1 from public\.video_review_revisions where video_id = p_video_id/.test(sql));
check('passer à « envoyée » fige la version ET l’original', /p_status = 'sent'/.test(sql) && /video_freeze_revision\(v_ver\.capture_id, p_id/.test(sql) && /'original', v_cap\.last_export_video_id/.test(sql));
check('les brouillons restent cachés du client', /ver\.review_status <> 'draft'/.test(sql));
check('rien n’est figé deux fois à l’identique', /v_last\.video_id = p_video and v_last\.cues is not distinct from p_cues then return/.test(sql));
const html = fs.readFileSync(path.join(__dirname, 'relecture.html'), 'utf8');
const a = html.indexOf('function withRevisions'), b = html.indexOf('async function load()');
check('expansion extraite de la page client', a > 0 && b > a);
const ctx = { tr: (k, v) => k + (v ? JSON.stringify(v) : '') };
vm.createContext(ctx); vm.runInContext(html.slice(a, b), ctx);
const out = ctx.withRevisions({ versions: [
  { key: 'original', title: null, n: 1, seq: 2, revisions: [{ seq: 2, url: 'u2' }, { seq: 1, url: 'u1', kind: 'audio', cues: [] }], url: 'u2' },
  { key: 'v1', title: 'Piano', n: 2, seq: 1, revisions: [{ seq: 1, url: 'p1' }], url: 'p1' },
  { key: 'v2', title: 'Ancienne', n: 3, url: 'x' } ] });
check('l’original garde la dernière révision et ajoute l’ancienne', out.versions.length === 4 && out.versions[0].url === 'u2' && out.versions[1].key === 'original@1' && out.versions[1].url === 'u1');
check('la version envoyée porte son numéro #n.m', out.versions[2].title === 'Piano · #2.1');
check('une version sans révision (ancien envoi) reste telle quelle', out.versions[3].title === 'Ancienne' && out.versions[3].url === 'x');
check('la clé d’une ancienne révision revient à sa version pour les remarques', /String\(k \|\| 'original'\)\.split\('@'\)\[0\]/.test(html));
console.log(failures ? failures + ' échec(s)' : 'Tout est OK'); process.exit(failures ? 1 : 0);
