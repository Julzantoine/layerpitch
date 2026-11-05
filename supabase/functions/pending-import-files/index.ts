// pending-import-files — ramassage, dans le Backstage, des fichiers déposés par un assistant (« Imports en attente », 3/11).
// Appelée par le navigateur du compositeur CONNECTÉ (JWT Supabase vérifié ici) ; deux actions :
//   download_urls { import_id } -> liens de lecture R2 valables 15 min, un par fichier de l'import prêt (seau privé)
//   finish { import_id, outcome: 'added' | 'discarded' } -> marque l'import (en tant que lui) puis EFFACE tout de suite ses fichiers R2
// Jamais plus que ce que fait déjà le compositeur depuis son compte : la clé de service ne sert qu'à .rpc (comme la porte).
// Filet de sécurité : la tâche purge-assistant-imports efface de toute façon ce qui resterait.
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isUuid } from '../_shared/assistant-import-core.ts';

const ALLOWED_ORIGINS = new Set(['https://beta.layerpitch.com', 'https://layerpitch.com', 'https://www.layerpitch.com', 'http://localhost:8420']);
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://beta.layerpitch.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(req) });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeadersFor(req) } });
  if (req.method !== 'POST') return json({ error: 'Méthode non permise.' }, 405);
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer /, '');
    if (!jwt) return json({ error: 'Connexion requise.' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: userData } = await caller.auth.getUser(jwt);
    if (!userData?.user) return json({ error: 'Connexion requise.' }, 401);
    const { data: composer } = await admin.rpc('assistant_composer_for_profile', { p_profile: userData.user.id });
    if (!composer) return json({ error: "Cette fonction n'est pas ouverte pour ce compte." }, 403);

    const body = await req.json().catch(() => null);
    if (!body || !isUuid(body.import_id)) return json({ error: 'Identifiant invalide.' }, 400);
    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const bucket = Deno.env.get('R2_PROJECTS_BUCKET')!;
    const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
    const objectUrl = (path: string, query = '') => `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}${query}`;
    const { data: files } = await admin.rpc('assistant_import_files_for_download', { p_composer: composer, p_import: body.import_id });
    const list = (files || []) as Array<{ id: string; name: string; size: number; path: string }>;

    if (body.action === 'download_urls') {
      if (!list.length) return json({ error: 'Import introuvable ou plus prêt.' }, 404);
      const out = [];
      for (const f of list) {
        const signed = await r2.sign(objectUrl(f.path, '?X-Amz-Expires=900'), { method: 'GET', aws: { signQuery: true } });
        out.push({ id: f.id, name: f.name, size: f.size, url: signed.url });
      }
      await admin.rpc('assistant_log', { p_composer: composer, p_token: null, p_action: 'pickup_urls', p_ok: true, p_detail: { import_id: body.import_id, files: out.length } });
      return json({ ok: true, files: out });
    }

    if (body.action === 'finish') {
      if (body.outcome !== 'added' && body.outcome !== 'discarded') return json({ error: 'Issue invalide.' }, 400);
      // Marque l'import EN TANT QUE le compositeur (la base vérifie qu'il lui appartient), puis efface les fichiers lus avant le changement d'état.
      const { data: marked, error } = await caller.rpc(body.outcome === 'added' ? 'mark_pending_import_added' : 'discard_pending_import', { p_id: body.import_id });
      if (error) return json({ error: 'Erreur interne.' }, 500);
      if (!marked) return json({ error: 'Import introuvable ou déjà traité.' }, 404);
      let failed = 0;
      for (const f of list) {
        const res = await r2.fetch(objectUrl(f.path), { method: 'DELETE' });
        if (!(res.ok || res.status === 404)) failed++;
      }
      if (list.length && !failed) await admin.rpc('assistant_mark_purged', { p_import: body.import_id });
      return json({ ok: true, deleted: !failed });
    }
    return json({ error: 'Action inconnue.' }, 400);
  } catch (e) {
    console.error('pending-import-files:', (e as Error).message);
    return json({ error: 'Erreur interne.' }, 500);
  }
});
