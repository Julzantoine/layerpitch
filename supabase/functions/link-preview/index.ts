// link-preview — LayerPitch, aperçus des liens d'un Projet (espace Projet, étape 2, cadrage du 28/09 §5).
//
// { assetId } -> vérifie que l'appelant a accès au Projet de cet objet (get_project avec SON jeton), puis récupère titre,
// auteur, vignette et lecteur intégrable auprès du SERVICE D'ORIGINE, et les range dans project_assets.preview (clé de
// service ; le titre de l'objet est rempli s'il était vide). Pourquoi côté serveur : YouTube et d'autres refusent ces
// requêtes quand elles viennent directement d'un navigateur.
//
// Sécurité : on n'interroge QUE des services connus, à des adresses fixes (oEmbed de YouTube, Vimeo, SoundCloud, Spotify,
// Deezer ; page publique d'un sous-domaine bandcamp.com, qui n'a pas d'oEmbed). Jamais l'adresse collée elle-même
// (sauf Bandcamp, domaine vérifié, sans suivre de redirection) : impossible de faire visiter au serveur une adresse
// interne. Le lecteur rendu est une adresse d'intégration dont l'hôte est vérifié (liste EMBED_HOSTS), jamais du HTML.
// Même liste de sites que public.project_link_has_preview (migration 20260928140000) : les garder identiques.
//
// Déploiement : supabase functions deploy link-preview
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

type Provider = 'youtube' | 'vimeo' | 'soundcloud' | 'spotify' | 'deezer' | 'bandcamp';
const OEMBED: Record<Exclude<Provider, 'bandcamp'>, string> = {
  youtube: 'https://www.youtube.com/oembed?format=json&url=',
  vimeo: 'https://vimeo.com/api/oembed.json?url=',
  soundcloud: 'https://soundcloud.com/oembed?format=json&url=',
  spotify: 'https://open.spotify.com/oembed?url=',
  deezer: 'https://api.deezer.com/oembed?format=json&url=',
};
// Hôte et début de chemin autorisés pour le lecteur intégré de chaque service.
const EMBED_PREFIX: Record<Provider, string[]> = {
  youtube: ['https://www.youtube-nocookie.com/embed/'],
  vimeo: ['https://player.vimeo.com/video/'],
  soundcloud: ['https://w.soundcloud.com/player/'],
  spotify: ['https://open.spotify.com/embed/'],
  deezer: ['https://widget.deezer.com/widget/'],
  bandcamp: ['https://bandcamp.com/EmbeddedPlayer/'],
};
const EMBED_HEIGHT: Record<Provider, number> = { youtube: 0, vimeo: 0, soundcloud: 166, spotify: 152, deezer: 300, bandcamp: 120 };

function providerOf(url: URL): Provider | null {
  const h = url.hostname.toLowerCase().replace(/^www\./, '');
  if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') return 'youtube';
  if (h === 'vimeo.com') return 'vimeo';
  if (h === 'soundcloud.com' || h === 'm.soundcloud.com' || h === 'on.soundcloud.com') return 'soundcloud';
  if (h === 'open.spotify.com') return 'spotify';
  if (h === 'deezer.com' || h === 'deezer.page.link' || h === 'link.deezer.com') return 'deezer';
  if (/^[a-z0-9-]+\.bandcamp\.com$/.test(h)) return 'bandcamp';
  return null;
}

async function fetchLimited(url: string, maxBytes: number, accept: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { accept, 'user-agent': 'LayerPitch link preview (+https://layerpitch.com)' } });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    return new TextDecoder().decode(all);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const httpsOrNull = (u: unknown) => {
  try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.href : null; } catch (_) { return null; }
};
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const safeEmbed = (p: Provider, u: string | null) => (u && EMBED_PREFIX[p].some(prefix => u.startsWith(prefix)) ? u : null);

async function previewFor(p: Provider, url: URL) {
  if (p === 'bandcamp') {
    const html = await fetchLimited(url.href, 1_500_000, 'text/html');
    if (!html) return null;
    const meta = (prop: string) => {
      const m = html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, 'i'));
      return m ? decodeEntities(m[1]) : '';
    };
    const player = meta('og:video') || meta('twitter:player');
    const id = player.match(/\/(album|track)=(\d+)/);
    return {
      title: clean(meta('og:title'), 300), author: clean(meta('og:site_name'), 200), thumbnail: httpsOrNull(meta('og:image')),
      embedUrl: id ? `https://bandcamp.com/EmbeddedPlayer/${id[1]}=${id[2]}/size=large/bgcol=ffffff/linkcol=2f80c0/tracklist=false/artwork=small/transparent=true/` : null,
    };
  }
  const text = await fetchLimited(OEMBED[p] + encodeURIComponent(url.href), 200_000, 'application/json');
  if (!text) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(text); } catch (_) { return null; }
  let embedUrl: string | null = null;
  if (p === 'youtube') {
    // Lecteur « sans cookie » de YouTube, à partir de l'identifiant de la vidéo.
    const m = String(o.html || '').match(/youtube\.com\/embed\/([\w-]{6,})/);
    embedUrl = m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
  } else if (p === 'spotify' && typeof o.iframe_url === 'string') {
    embedUrl = httpsOrNull(o.iframe_url);
  } else {
    const m = String(o.html || '').match(/src="([^"]+)"/);
    embedUrl = m ? httpsOrNull(decodeEntities(m[1])) : null;
  }
  return { title: clean(o.title, 300), author: clean(o.author_name, 200), thumbnail: httpsOrNull(o.thumbnail_url), embedUrl };
}

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
    const body = await req.json().catch(() => ({}));

    const { data: asset } = await adminClient.from('project_assets').select('id, project_id, kind, url, title, preview').eq('id', String(body.assetId || '')).maybeSingle();
    if (!asset || !asset.url) return json({ error: 'Objet introuvable.' }, 404);
    const { error: accessError } = await callerClient.rpc('get_project', { p_project_id: asset.project_id });
    if (accessError) return json({ error: 'Objet introuvable.' }, 404);

    // Déjà récupéré il y a moins de 7 jours (1 jour si le service n'avait pas répondu) : on renvoie l'aperçu gardé.
    const fetchedAt = asset.preview && Date.parse(asset.preview.fetchedAt);
    const ttl = (asset.preview && asset.preview.failed ? 1 : 7) * 24 * 3600 * 1000;
    if (fetchedAt && Date.now() - fetchedAt < ttl) return json({ ok: true, preview: asset.preview });

    let url: URL;
    try { url = new URL(asset.url); } catch (_) { return json({ ok: true, preview: null }); }
    const provider = url.protocol === 'https:' || url.protocol === 'http:' ? providerOf(url) : null;
    if (!provider) return json({ ok: true, preview: null }); // site sans aperçu : simple lien (compté pour l'admin, voir la migration)
    if (provider === 'bandcamp' && url.protocol !== 'https:') url.protocol = 'https:';

    const found = await previewFor(provider, url);
    const preview = found ? {
      provider, title: found.title, author: found.author, thumbnail: found.thumbnail,
      embedUrl: safeEmbed(provider, found.embedUrl), embedHeight: EMBED_HEIGHT[provider], fetchedAt: new Date().toISOString(),
    } : { provider, failed: true, fetchedAt: new Date().toISOString() };
    const patch: Record<string, unknown> = { preview };
    if (found && !asset.title && found.title) patch.title = found.title;
    await adminClient.from('project_assets').update(patch).eq('id', asset.id);
    return json({ ok: true, preview });
  } catch (e) {
    console.error('link-preview:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
