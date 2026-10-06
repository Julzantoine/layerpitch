// copy-track-files — LayerPitch, copie d'un morceau de la bibliothèque (6/10, « copier / Alt + glisser un morceau »).
//
// { fromTrackId, toTrackId } -> copie, côté serveur R2 (rien n'est téléchargé), tous les fichiers audio/<fromTrackId>/… vers
// audio/<toTrackId>/… dans le seau public. Réservé au COMPOSITEUR du morceau source (ensure_composer_profile avec son jeton,
// puis tracks.owner_id avec la clé de service). Garde-fous :
//   - la source doit exister (publiée) et être à lui ; la destination ne doit PAS exister encore (jamais d'écrasement) ;
//   - un morceau PROTÉGÉ n'est pas copié (ses fichiers sont dans le seau privé : les copier dans le seau public les exposerait) --
//     le compositeur lève d'abord la protection, copie, puis la remet ;
//   - la copie ne touche jamais aux fichiers de la source. Un échec en cours de route laisse une copie partielle sous
//     audio/<toTrackId>/ (relancer la même demande recopie à l'identique) et renvoie l'erreur.
// NON TESTÉE EN RÉEL au 6/10 : supabase functions deploy copy-track-files
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(['https://beta.layerpitch.com', 'https://layerpitch.com', 'https://www.layerpitch.com', 'http://localhost:8420']);
const MAX_FILES = 400;
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://beta.layerpitch.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}
const unxml = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const validId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ error: 'Connexion requise.' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { fromTrackId, toTrackId } = await req.json().catch(() => ({}));
    if (!validId(fromTrackId) || !validId(toTrackId) || fromTrackId === toTrackId) return json({ error: 'fromTrackId et toTrackId requis (différents).' }, 400);

    const { data: composerId, error: composerError } = await callerClient.rpc('ensure_composer_profile');
    if (composerError || !composerId) return json({ error: 'Non autorisé.' }, 403);
    const { data: source } = await adminClient.from('tracks').select('owner_id, protected').eq('id', fromTrackId).maybeSingle();
    if (!source) return json({ error: 'Morceau d\'origine introuvable (publie-le d\'abord).' }, 404);
    if (source.owner_id !== composerId) return json({ error: 'Ce morceau ne t\'appartient pas.' }, 403);
    if (source.protected) return json({ error: 'Ce morceau est protégé : retire la protection, copie-le, puis remets-la.' }, 409);
    const { data: existing } = await adminClient.from('tracks').select('id').eq('id', toTrackId).maybeSingle();
    if (existing) return json({ error: 'La destination existe déjà.' }, 409);

    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const bucket = Deno.env.get('R2_BUCKET')!;
    const client = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
    const host = `https://${accountId}.r2.cloudflarestorage.com`;
    const fromPrefix = `audio/${fromTrackId}/`, toPrefix = `audio/${toTrackId}/`;
    const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');

    const keys: string[] = [];
    let token: string | null = null;
    do {
      const res = await client.fetch(`${host}/${bucket}?list-type=2&prefix=${encodeURIComponent(fromPrefix)}${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`);
      if (!res.ok) { console.error('copy-track-files: list', res.status); return json({ error: 'Lecture des fichiers impossible.' }, 500); }
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(unxml(m[1]));
      const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      token = next ? next[1] : null;
    } while (token);
    if (keys.length > MAX_FILES) return json({ error: `Trop de fichiers (${keys.length}) : copie refusée.` }, 413);

    for (let i = 0; i < keys.length; i += 6) {
      const results = await Promise.all(keys.slice(i, i + 6).map(async (key) => {
        const dest = toPrefix + key.slice(fromPrefix.length);
        const res = await client.fetch(`${host}/${bucket}/${enc(dest)}`, { method: 'PUT', headers: { 'x-amz-copy-source': `/${bucket}/${enc(key)}` } });
        return { key, ok: res.ok, status: res.status };
      }));
      const failed = results.find((r) => !r.ok);
      if (failed) { console.error('copy-track-files: copy', failed); return json({ error: `Copie interrompue (${failed.status}) : réessaie.` }, 500); }
    }
    return json({ ok: true, files: keys.length });
  } catch (e) {
    console.error('copy-track-files:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
