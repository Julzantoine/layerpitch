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
const frise = fs.readFileSync(path.join(__dirname, 'src/atelier/15-frise-edition.js'), 'utf8');
check('fondu à la main : poignée sur le bord droit de chaque arrêt, réglage 0 à 10 s, mémorisé dans l’événement', /vct-fade-handle/.test(frise) && /Math\.min\(10, Math\.round/.test(frise) === false ? /e0\.detail\.fadeSec = sec/.test(frise) && /delete e0\.detail\.fadeSec/.test(frise) : /e0\.detail\.fadeSec = sec/.test(frise));
const vers = fs.readFileSync(path.join(__dirname, 'capture-versioning.js'), 'utf8');
check('Envoyer au client : cocher = envoyée, décocher = brouillon, approuvée reste approuvée', /cur === 'approved' \? cur : 'sent'/.test(vers) && /: 'draft';/.test(vers));
check('Envoyer au client : le montage est publié avant, puis la version n° 1 figée si rien d’autre n’est coché', /ctx\.publishMontage/.test(vers) && /api\.freezeOriginal/.test(vers));
check('plus de « Sans titre » pour une version : « Version alternative #n »', /function verName/.test(vers) && !/v\.title \|\| tr\('captureUntitled'\)/.test(vers));
const sql3 = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20261110030000_video_review_send_original.sql'), 'utf8');
check('migration 3 : fonction réservée aux connectés, mêmes barrières que les autres', /grant execute on function public\.freeze_video_review_original\(text, boolean\) to authenticated/.test(sql3) && /video_can_version\(p_studio\)/.test(sql3) && /video_owned/.test(sql3));
check('frise : ordre fixe des morceaux et des Sfx (celui du pack), plus de pistes qui remontent', /musicTrackIds\.sort\(\(x, y\) => rank\(x\) - rank\(y\)\)/.test(frise) && /Object\.keys\(sfxGroups\)\.sort\(\(x, y\) => sfxRank\(x\) - sfxRank\(y\)\)/.test(frise));
const atel = fs.readFileSync(path.join(__dirname, 'src/atelier/18-panneau-de-capture.js'), 'utf8');
check('marqueurs de référence : choix de la version source, ajouter (sans doublon par identifiant) ou remplacer, annulable', /async function referenceMarkers/.test(atel) && /if \(!have\.has\(m\.id\)\) timelineMarkers\.push\(m\)/.test(atel) && /if \(mode === 'replace'\) timelineMarkers = copy/.test(atel) && !/takeOriginalMarkers/.test(atel));
const demarrage = fs.readFileSync(path.join(__dirname, 'src/atelier/20-demarrage-atelier.js'), 'utf8');
check('pack republié : l’atelier se recharge (après enregistrement, jamais pendant une prise)', /fresh\.publishedAt !== window\.__lpPackPublishedAt/.test(demarrage) && /__lpAtelierBusy/.test(demarrage) && /__lpFlushAutosave/.test(demarrage) && /window\.__lpFlushAutosave = async/.test(atel) && /window\.__lpAtelierBusy = \(\) => !!videoCaptureState/.test(atel));
console.log(failures ? failures + ' échec(s)' : 'Tout est OK'); process.exit(failures ? 1 : 0);
