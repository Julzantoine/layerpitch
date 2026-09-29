// track-audio-url — LayerPitch, fichiers audio d'un morceau PROTÉGÉ (29/09, « protéger l'album », choix par morceau).
//
// Les fichiers d'un morceau protégé sont dans un seau R2 PRIVÉ (secret R2_PROJECTS_BUCKET, chemin audio/<id du morceau>/<fichier>).
// { trackId } (ou { sfxId } pour un effet sonore : dossier audio/sfx-<id>/, can_hear_sfx) -> can_hear_track (règle en base, avec le jeton de l'appelant s'il y en a un : acheteur, vendeur, invité,
// compositeur ; ou écoute publique voulue : AdReel, écoute libre d'un album en vente, pack en vente) puis, pour chaque
// fichier du morceau, un lien de lecture signé de 15 minutes. Réponse : { ok, files: { "<fichier>": "<url>" }, expiresIn }.
// Un morceau NON protégé n'a pas de fichier privé : { ok, protected: false } (le lecteur lit alors l'adresse publique).
// Sans compte : fonctionne (écoute libre) ; déployer avec --no-verify-jwt.
// NON TESTÉE EN RÉEL au 29/09 : supabase functions deploy track-audio-url --no-verify-jwt
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
const EXPIRES = 900;

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authHeader = req.headers.get('Authorization') || '';
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined);
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { trackId, sfxId } = await req.json().catch(() => ({}));
    const isSfx = typeof sfxId === 'string' && !!sfxId;
    const id = isSfx ? sfxId : trackId;
    if (!id || typeof id !== 'string' || /[/\\]|\.\./.test(id)) return json({ error: 'trackId ou sfxId invalide.' }, 400);

    const { data: item } = isSfx
      ? await adminClient.from('sfx_library').select('protected').eq('id', id).maybeSingle()
      : await adminClient.from('tracks').select('protected').eq('id', id).maybeSingle();
    if (!item) return json({ error: isSfx ? 'Sfx introuvable.' : 'Morceau introuvable.' }, 404);
    if (!item.protected) return json({ ok: true, protected: false });
    const { data: allowed, error: accessError } = isSfx
      ? await callerClient.rpc('can_hear_sfx', { p_sfx_id: id })
      : await callerClient.rpc('can_hear_track', { p_track_id: id });
    if (accessError) { console.error('track-audio-url: can_hear', accessError); return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500); }
    if (!allowed) return json({ error: isSfx ? 'Cet effet sonore est protégé.' : 'Ce morceau est réservé aux acheteurs.' }, 403);

    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const bucket = Deno.env.get('R2_PROJECTS_BUCKET');
    if (!bucket) return json({ error: 'Stockage privé non configuré (R2_PROJECTS_BUCKET).' }, 500);
    const client = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
    const prefix = isSfx ? `audio/sfx-${id}/` : `audio/${id}/`;
    const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
    // Liste des fichiers du morceau (ListObjectsV2, 1000 par page ; un morceau en a bien moins).
    const keys: string[] = [];
    let token: string | null = null;
    do {
      const listUrl = `${base}?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`;
      const res = await client.fetch(listUrl);
      if (!res.ok) { console.error('track-audio-url: list', res.status); return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500); }
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
      const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      token = next ? next[1] : null;
    } while (token);
    const files: Record<string, string> = {};
    for (const key of keys) {
      const encoded = key.split('/').map(encodeURIComponent).join('/');
      const signed = await client.sign(`${base}/${encoded}?X-Amz-Expires=${EXPIRES}`, { method: 'GET', aws: { signQuery: true } });
      files[key.slice(prefix.length)] = signed.url;
    }
    return json({ ok: true, protected: true, files, expiresIn: EXPIRES });
  } catch (e) {
    console.error('track-audio-url:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
