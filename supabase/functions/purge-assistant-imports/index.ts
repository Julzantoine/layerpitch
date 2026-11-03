// purge-assistant-imports — efface les fichiers R2 de la zone d'attente « import par assistant » (imports expirés, écartés,
// abandonnés, ou ajoutés au Backstage depuis plus d'une heure), puis lance l'entretien de la base (assistant_housekeeping).
// À PLANIFIER une fois par jour comme process-account-deletions (en-tête x-cron-secret = secret CRON_SECRET) ; déployée avec
// --no-verify-jwt : supabase functions deploy purge-assistant-imports --no-verify-jwt
// Comme la porte, n'utilise la clé de service que pour des fonctions SQL (.rpc), jamais .from().
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const LIMIT = 500;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non permise.' }, 405);
  const cronSecret = Deno.env.get('CRON_SECRET') || '';
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'Accès refusé.' }, 403);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const bucket = Deno.env.get('R2_PROJECTS_BUCKET')!;
    const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
    const { data, error } = await admin.rpc('assistant_files_to_purge', { p_limit: LIMIT });
    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<{ import_id: string; path: string }>;
    // La liste est coupée à LIMIT lignes : le dernier import peut être incomplet, on le laisse au prochain passage.
    const lastId = rows.length >= LIMIT ? rows[rows.length - 1].import_id : null;
    const byImport = new Map<string, string[]>();
    for (const r of rows) if (r.import_id !== lastId && r.path.startsWith('incoming/')) { (byImport.get(r.import_id) || byImport.set(r.import_id, []).get(r.import_id)!).push(r.path); }
    let filesDeleted = 0; const errors: string[] = [];
    for (const [importId, paths] of byImport) {
      let failed = 0;
      for (const path of paths) {
        const res = await r2.fetch(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
        if (res.ok || res.status === 404) filesDeleted++; else failed++;
      }
      if (failed) { errors.push(`import ${importId}: ${failed} fichier(s) non effacé(s), réessayé au prochain passage`); continue; }
      await admin.rpc('assistant_mark_purged', { p_import: importId });
    }
    await admin.rpc('assistant_housekeeping');
    return json({ ok: errors.length === 0, imports: byImport.size, filesDeleted, errors });
  } catch (e) {
    console.error('purge-assistant-imports:', (e as Error).message);
    return json({ error: 'Erreur interne.' }, 500);
  }
});
