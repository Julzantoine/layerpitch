// assistant-import — « la porte » par laquelle un programme local (CLI / MCP) dépose des fichiers dans la zone d'attente
// d'un compositeur (migration 20261102010000, cadrage dans layerpitch-docs/mcp-serveur-reference.md).
//
// Sécurité (à relire avant toute modification) :
//   - Auth : jeton LayerPitch « lpa_… » uniquement (jamais un JWT Supabase), comparé par empreinte SHA-256 ; la base refuse
//     les jetons révoqués / expirés / dont le feu vert est fermé. Déployée avec --no-verify-jwt (le JWT Supabase ne sert pas ici).
//   - La clé service_role n'est utilisée QUE pour appeler des fonctions SQL (.rpc) réservées à service_role : jamais .from()
//     (un test le vérifie). Rien n'est lu ni écrit en table directement.
//   - Pas d'en-têtes CORS : un navigateur ne doit pas pouvoir appeler cette porte depuis un site tiers.
//   - Chemins R2 construits par la base (incoming/<compositeur>/<import>/<uuid>.wav) : le programme n'en choisit aucun.
//   - Envoi par URL pré-signée 15 min, type et taille signés, vers le seau PRIVÉ (R2_PROJECTS_BUCKET). Chaque fichier est
//     contrôlé après envoi (taille exacte + signature RIFF/WAVE) ; un fichier invalide est effacé et l'import passe en « failed ».
//   - Limites : 60 appels/min par jeton, 20 imports/jour par compte, 20 mauvais jetons/10 min par adresse IP.
// Déploiement : npx supabase functions deploy assistant-import --no-verify-jwt
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { MAX_BODY_BYTES, PROGRAM_MIN_VERSION, compareVersions, dbErrorMessage, isUuid, isWavHeader, parseBearer, sha256Hex } from '../_shared/assistant-import-core.ts';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non permise.' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'inconnue').split(',')[0].trim().slice(0, 64);
  try {
    // ---- 1. Jeton ----
    const token = parseBearer(req.headers.get('Authorization'));
    const badToken = async () => {
      const { data: ok } = await admin.rpc('assistant_check_rate', { p_bucket: 'ip:' + ip, p_limit: 20, p_window_seconds: 600 });
      return ok === false ? json({ error: 'Trop de tentatives. Réessaie plus tard.' }, 429, { 'Retry-After': '600' }) : json({ error: 'Jeton invalide, expiré ou révoqué.' }, 401);
    };
    if (!token) return await badToken();
    const { data: who } = await admin.rpc('assistant_resolve_token', { p_hash: await sha256Hex(token) });
    if (!who) return await badToken();
    const composer = who.composer_id as string;
    const tokenId = who.token_id as string;
    const { data: rateOk } = await admin.rpc('assistant_check_rate', { p_bucket: 'tok:' + tokenId, p_limit: 60, p_window_seconds: 60 });
    if (rateOk === false) return json({ error: 'Trop d’appels : attends une minute.' }, 429, { 'Retry-After': '60' });

    // ---- 2. Corps (taille plafonnée, JSON uniquement) ----
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Requête trop volumineuse.' }, 413);
    let body: any;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Corps JSON invalide.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Corps JSON invalide.' }, 400);
    const log = (action: string, ok: boolean, detail: Record<string, unknown> = {}) =>
      admin.rpc('assistant_log', { p_composer: composer, p_token: tokenId, p_action: action, p_ok: ok, p_detail: detail });

    // ---- 3. Version du programme : un programme trop ancien est prié de se mettre à jour ----
    if (compareVersions(String(body.program_version || ''), PROGRAM_MIN_VERSION) < 0) {
      await log('refused_old_program', false, { version: String(body.program_version || '').slice(0, 20) });
      return json({ error: 'Ton programme LayerPitch est trop ancien : mets-le à jour.', code: 'update_required', min_version: PROGRAM_MIN_VERSION }, 426);
    }

    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const bucket = Deno.env.get('R2_PROJECTS_BUCKET')!;
    const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
    const objectUrl = (path: string, query = '') => `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}${query}`;

    switch (body.action) {
      case 'hello':
        await log('hello', true);
        return json({ ok: true, min_version: PROGRAM_MIN_VERSION });

      case 'begin_import': {
        const { data: dayOk } = await admin.rpc('assistant_check_rate', { p_bucket: 'imp:' + composer, p_limit: 20, p_window_seconds: 86400 });
        if (dayOk === false) { await log('begin_import', false, { why: 'daily_limit' }); return json({ error: "Limite de 20 imports par jour atteinte." }, 429, { 'Retry-After': '3600' }); }
        const files = Array.isArray(body.files) ? body.files.map((f: any) => ({ name: typeof f?.name === 'string' ? f.name : null, size: typeof f?.size === 'number' ? Math.floor(f.size) : null })) : null;
        const { data, error } = await admin.rpc('assistant_begin_import', { p_composer: composer, p_token: tokenId, p_title: typeof body.title === 'string' ? body.title : '', p_plan: body.plan, p_files: files });
        if (error) { const e = dbErrorMessage(error.message); await log('begin_import', false, { code: e.code }); return json({ error: e.text, code: e.code }, e.code === 'internal' ? 500 : 400); }
        const out = [];
        for (const f of data.files as Array<{ id: string; name: string; size: number; path: string }>) {
          const headers = { 'content-type': 'audio/wav', 'content-length': String(f.size) };
          const signed = await r2.sign(objectUrl(f.path, '?X-Amz-Expires=900'), { method: 'PUT', headers, aws: { signQuery: true, allHeaders: true } });
          out.push({ file_id: f.id, name: f.name, size: f.size, upload_url: signed.url, headers: { 'content-type': 'audio/wav' } });
        }
        await log('begin_import', true, { import_id: data.import_id, files: out.length });
        return json({ ok: true, import_id: data.import_id, uploads: out, expires_in: 900 });
      }

      case 'complete_file': {
        if (!isUuid(body.import_id) || !isUuid(body.file_id)) return json({ error: 'Identifiants invalides.' }, 400);
        const { data: info } = await admin.rpc('assistant_file_info', { p_composer: composer, p_import: body.import_id, p_file: body.file_id });
        if (!info) return json({ error: 'Fichier ou import introuvable (ou expiré).' }, 404);
        let valid = false; let why = 'missing';
        const head = await r2.fetch(objectUrl(info.path), { method: 'HEAD' });
        if (head.ok) {
          if (Number(head.headers.get('content-length')) !== Number(info.size)) why = 'size';
          else {
            const part = await r2.fetch(objectUrl(info.path), { headers: { Range: 'bytes=0-11' } });
            const bytes = new Uint8Array(await part.arrayBuffer());
            if (isWavHeader(bytes.slice(0, 12))) { valid = true; why = 'ok'; } else why = 'not_wav';
          }
        }
        if (!valid && head.ok) await r2.fetch(objectUrl(info.path), { method: 'DELETE' });
        const { data: status } = await admin.rpc('assistant_file_checked', { p_composer: composer, p_import: body.import_id, p_file: body.file_id, p_valid: valid });
        await log('complete_file', valid, { import_id: body.import_id, why });
        if (!valid) return json({ error: why === 'size' ? "Le fichier reçu n'a pas la taille annoncée." : why === 'not_wav' ? "Ce fichier n'est pas un vrai WAV." : "Le fichier n'a pas été reçu.", code: why, import_status: status }, 422);
        return json({ ok: true, import_status: status });
      }

      case 'import_status': {
        if (!isUuid(body.import_id)) return json({ error: 'Identifiant invalide.' }, 400);
        const { data } = await admin.rpc('assistant_import_status', { p_composer: composer, p_import: body.import_id });
        return data ? json({ ok: true, ...data }) : json({ error: 'Import introuvable.' }, 404);
      }

      default:
        return json({ error: 'Action inconnue.' }, 400);
    }
  } catch (e) {
    console.error('assistant-import:', (e as Error).message);
    return json({ error: 'Erreur interne.' }, 500);
  }
});
