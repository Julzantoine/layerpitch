// project-file-url — LayerPitch, fichiers des Projets (chantier profils et permissions, étape 5, 28/09 ; D36, D39).
//
// Les fichiers d'un Projet (captures de gameplay, images, ébauches audio, documents) sont du matériel de PRÉPRODUCTION :
// rangés dans un seau R2 PRIVÉ (secret R2_PROJECTS_BUCKET, jamais le seau public media.layerpitch.com), lus et écrits
// uniquement par des URL signées de courte durée, délivrées ici après vérification des droits EN BASE, avec le jeton de
// l'appelant :
//   * action 'upload'  : { projectId, name, size } -> reserve_project_file (accès au Projet, type, taille, quota du
//                        PROPRIÉTAIRE) puis URL d'envoi (PUT) avec type et taille verrouillés dans la signature ;
//   * action 'read'    : { fileId } -> project_file_path_for (membre du Projet) OU image d'une vitrine publiée
//                        (project_file_is_public, lecture sans compte) -> URL de lecture (GET), 1 h ;
//   * action 'delete'  : { path } -> le chemin doit avoir été rendu par delete_project_file / delete_project_asset /
//                        delete_project (ligne déjà supprimée en base) : on vérifie qu'aucune ligne ne le référence encore
//                        et qu'il est bien sous projects/ -> URL d'effacement (DELETE).
// NON TESTÉE EN RÉEL au 28/09 : créer le seau privé, ajouter le secret R2_PROJECTS_BUCKET, déployer
// (supabase functions deploy project-file-url --no-verify-jwt : la lecture d'une vitrine publique se fait sans compte).
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://beta.layerpitch.com',
  'https://layerpitch.com',
  'https://www.layerpitch.com',
  'http://localhost:8420',
]);
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://beta.layerpitch.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authHeader = req.headers.get('Authorization') || '';
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined);
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    let path: string | null = null;
    let method = 'GET';
    let expires = 3600;
    let headers: Record<string, string> | undefined;
    let fileId: string | null = null;

    if (action === 'upload') {
      if (!authHeader) return json({ error: 'Connexion requise.' }, 401);
      const { data, error } = await callerClient.rpc('reserve_project_file', { p_project_id: body.projectId, p_name: body.name, p_size: body.size });
      if (error || !data) return json({ error: error?.message || 'Envoi refusé.' }, 400);
      path = data.path; fileId = data.fileId; method = 'PUT'; expires = 900;
      headers = { 'content-type': data.mimeType, 'content-length': String(data.size) };
      if (data.mimeType === 'application/pdf') headers['content-disposition'] = 'attachment';
    } else if (action === 'read') {
      if (authHeader) {
        const { data } = await callerClient.rpc('project_file_path_for', { p_file_id: body.fileId });
        path = data || null;
      }
      if (!path) {
        const { data } = await adminClient.rpc('project_file_is_public', { p_file_id: body.fileId });
        path = data || null;
      }
      if (!path) return json({ error: 'Fichier introuvable ou accès non autorisé.' }, 404);
    } else if (action === 'delete') {
      if (!authHeader) return json({ error: 'Connexion requise.' }, 401);
      const p = String(body.path || '');
      if (!/^projects\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]+$/.test(p)) return json({ error: 'Chemin invalide.' }, 400);
      const { data: still } = await adminClient.from('project_files').select('id').eq('path', p).maybeSingle();
      if (still) return json({ error: 'Ce fichier est encore utilisé : supprime-le d\'abord dans le Projet.' }, 409);
      // Le Projet doit être à l'appelant (ou supprimé par lui) : on accepte si le Projet n'existe plus ou si l'appelant y a accès.
      const projectId = p.split('/')[1];
      const { data: project } = await adminClient.from('projects').select('id').eq('id', projectId).maybeSingle();
      if (project) {
        const { error: accessError } = await callerClient.rpc('get_project', { p_project_id: projectId });
        if (accessError) return json({ error: 'Non autorisé.' }, 403);
      }
      path = p; method = 'DELETE'; expires = 300;
    } else {
      return json({ error: 'Action inconnue (upload, read ou delete).' }, 400);
    }

    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const bucket = Deno.env.get('R2_PROJECTS_BUCKET');
    if (!bucket) return json({ error: 'Stockage des Projets non configuré (R2_PROJECTS_BUCKET).' }, 500);
    const client = new AwsClient({
      accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto',
    });
    const encodedPath = path!.split('/').map(encodeURIComponent).join('/');
    const signed = await client.sign(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodedPath}?X-Amz-Expires=${expires}`, {
      method, ...(headers ? { headers } : {}), aws: { signQuery: true, allHeaders: true },
    });
    const clientHeaders = headers ? Object.fromEntries(Object.entries(headers).filter(([k]) => k !== 'content-length')) : undefined;
    return json({ ok: true, url: signed.url, headers: clientHeaders, fileId });
  } catch (e) {
    console.error('project-file-url:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
