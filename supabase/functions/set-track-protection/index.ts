// set-track-protection — LayerPitch, protéger / rendre public un morceau (29/09, « protéger l'album », choix par morceau).
//
// { trackId, protected } (ou { sfxId, protected } pour un effet sonore : audio/sfx-<id>/, sfx_library) -> réservé au COMPOSITEUR du morceau (ensure_composer_profile avec son jeton, puis tracks.owner_id
// avec la clé de service). Déplace tous les fichiers audio/<trackId>/… entre le seau public (R2_BUCKET) et le seau privé
// (R2_PROJECTS_BUCKET) : copie côté serveur, PUIS drapeau tracks.protected, PUIS suppression de la source — jamais de
// moment où le morceau n'a de fichiers nulle part. Un échec en cours de route laisse les deux copies (rien de perdu) et
// renvoie l'erreur ; relancer l'opération termine le travail (les fichiers déjà copiés sont recopiés à l'identique).
// Les versions figées des fans gardent l'ancienne adresse publique : le lecteur retombe sur un lien signé quand cette
// adresse répond « introuvable » (player.js).
// NON TESTÉE EN RÉEL au 29/09 : supabase functions deploy set-track-protection
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(['https://beta.layerpitch.com', 'https://layerpitch.com', 'https://www.layerpitch.com', 'http://localhost:8420']);
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://beta.layerpitch.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}
const unxml = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

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
    const { trackId, sfxId, protected: wantProtected } = await req.json().catch(() => ({}));
    const isSfx = typeof sfxId === 'string' && !!sfxId;
    const id = isSfx ? sfxId : trackId;
    if (!id || typeof id !== 'string' || /[/\\]|\.\./.test(id) || typeof wantProtected !== 'boolean') return json({ error: 'trackId (ou sfxId) et protected requis.' }, 400);

    const { data: composerId, error: composerError } = await callerClient.rpc('ensure_composer_profile');
    if (composerError || !composerId) return json({ error: 'Non autorisé.' }, 403);
    const { data: item } = isSfx
      ? await adminClient.from('sfx_library').select('owner_id').eq('id', id).maybeSingle()
      : await adminClient.from('tracks').select('owner_id').eq('id', id).maybeSingle();
    if (!item) return json({ error: 'Introuvable (publie-le d\'abord).' }, 404);
    if (item.owner_id !== composerId) return json({ error: 'Ce fichier ne t\'appartient pas.' }, 403);

    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const publicBucket = Deno.env.get('R2_BUCKET')!;
    const privateBucket = Deno.env.get('R2_PROJECTS_BUCKET');
    if (!privateBucket) return json({ error: 'Stockage privé non configuré (R2_PROJECTS_BUCKET).' }, 500);
    const client = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
    const host = `https://${accountId}.r2.cloudflarestorage.com`;
    const [from, to] = wantProtected ? [publicBucket, privateBucket] : [privateBucket, publicBucket];
    const prefix = isSfx ? `audio/sfx-${id}/` : `audio/${id}/`;
    const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');

    const keys: string[] = [];
    let token: string | null = null;
    do {
      const res = await client.fetch(`${host}/${from}?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`);
      if (!res.ok) { console.error('set-track-protection: list', res.status); return json({ error: 'Lecture des fichiers impossible.' }, 500); }
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(unxml(m[1]));
      const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      token = next ? next[1] : null;
    } while (token);

    // 1. copie (côté serveur R2), par petits lots
    for (let i = 0; i < keys.length; i += 6) {
      const results = await Promise.all(keys.slice(i, i + 6).map(async (key) => {
        const res = await client.fetch(`${host}/${to}/${enc(key)}`, { method: 'PUT', headers: { 'x-amz-copy-source': `/${from}/${enc(key)}` } });
        return { key, ok: res.ok, status: res.status };
      }));
      const failed = results.find((r) => !r.ok);
      if (failed) { console.error('set-track-protection: copy', failed); return json({ error: `Copie interrompue (${failed.status}) : rien n'est perdu, relance l'opération.` }, 500); }
    }
    // 2. drapeau
    const { error: flagError } = await (isSfx ? adminClient.rpc('set_sfx_protected', { p_sfx_id: id, p_protected: wantProtected }) : adminClient.rpc('set_track_protected', { p_track_id: id, p_protected: wantProtected }));
    if (flagError) { console.error('set-track-protection: flag', flagError); return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500); }
    // 3. suppression de la source (un échec ici laisse simplement des fichiers en double, sans conséquence)
    let leftover = 0;
    for (let i = 0; i < keys.length; i += 6) {
      const results = await Promise.all(keys.slice(i, i + 6).map((key) => client.fetch(`${host}/${from}/${enc(key)}`, { method: 'DELETE' })));
      leftover += results.filter((r) => !r.ok && r.status !== 404).length;
    }
    return json({ ok: true, protected: wantProtected, files: keys.length, leftover });
  } catch (e) {
    console.error('set-track-protection:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
