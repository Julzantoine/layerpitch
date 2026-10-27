// apercu-liens-worker.mjs — LayerPitch, aperçu des liens partagés (1er/10). À déployer comme Worker Cloudflare devant
// beta.layerpitch.com (route beta.layerpitch.com/*), voir cloudflare/LISEZMOI.md.
//
// Pourquoi : LinkedIn, Facebook, WhatsApp, Discord, X… lisent la page SANS exécuter de JavaScript. Les pages publiques se
// construisent en JavaScript, et les adresses /<nom>/ sont des « 404 » rattrapées par 404.html : ces robots ne voyaient qu'un
// titre « LayerPitch », sans image. Ce programme répond à LEURS visites seulement (reconnues à leur User-Agent) avec une page
// minimale contenant les balises Open Graph de l'AdReel, du pack, de la collection ou de l'album visé ; il lit titre,
// description et image via la fonction publique get_share_preview. Les visiteurs humains passent sans aucun changement.
// Le code lui-meme ne contient que des caracteres ASCII (accents ecrits \uXXXX) : copie dans le presse-papiers puis collee dans Cloudflare,
// un caractere accentue etait abime (les points de suspension devenaient du texte illisible).
// En cas de doute (adresse inconnue, base injoignable, robot non reconnu), la requête est simplement transmise comme avant.
const SUPABASE_URL = 'https://ypygllyjfynrnvapufow.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb'; // clé publique, la même que celle des pages
const SITE = 'https://beta.layerpitch.com';
const MEDIA = 'https://media.layerpitch.com/images/';
const DEFAULT_IMAGE = SITE + '/og-default.png';

const BOT = /(linkedinbot|facebookexternalhit|facebot|twitterbot|whatsapp|slackbot|slack-imgproxy|discordbot|telegrambot|pinterest|skypeuripreview|redditbot|embedly|iframely|vkshare|mastodon|bluesky|bsky|signal|snapchat|applebot|imessage)/i;

export function isShareBot(userAgent) { return BOT.test(userAgent || ''); }

// Moteurs de recherche et IA de recherche (27/10, chantier SEO/GEO) : ils recoivent une vraie page (code 200) pour les AdReels
// dont la case \u00ab Indexable \u00bb est cochee (fonction get_seo_adreel_page). Les robots d'ENTRAINEMENT des IA (GPTBot, ClaudeBot,
// Google-Extended, CCBot...) n'y sont volontairement pas : ils sont refuses par robots.txt.
const SEARCH_BOT = /(googlebot|google-inspectiontool|bingbot|duckduckbot|yandexbot|qwantbot|ecosiabot|applebot|oai-searchbot|chatgpt-user|perplexitybot|perplexity-user|claude-searchbot|claude-user|mistralai-user)/i;

export function isSearchBot(userAgent) { return SEARCH_BOT.test(userAgent || ''); }

// Adresse -> { kind, handle, ref, alt } ou null (page qui n'a pas d'aperçu propre : on laisse passer).
export function routeOf(url) {
  const segs = url.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  if (!segs.length) return null;
  if (segs[0] === 'album' && segs.length === 2 && !segs[1].includes('.')) return { kind: 'album', handle: '', ref: segs[1], alt: '' };
  if (['shop', 'vitrine', 'album', 'compositeurs', 'composers'].includes(segs[0]) || segs[0].includes('.')) return null; // pages réservées et vrais fichiers
  const handle = segs[0];
  if (segs.length === 1) return { kind: 'adreel', handle, ref: '', alt: url.searchParams.get('adreel') || '' };
  if (segs.length !== 2) return null;
  const second = segs[1];
  if (second === 'pack.html' || second === 'collection.html') {
    const id = url.searchParams.get('id');
    return id ? { kind: second === 'pack.html' ? 'pack' : 'collection', handle, ref: id, alt: '' } : null;
  }
  if (second.includes('.')) return null;
  return { kind: 'adreel', handle, ref: second, alt: url.searchParams.get('adreel') || '' };
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '\u2026' : s; };

export function previewHtml(preview, url) {
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : (preview.lang === 'en' ? 'en' : 'fr');
  const title = clip(preview.title, 90) || 'LayerPitch';
  const description = clip((lang === 'en' ? (preview.descriptionEn || preview.descriptionFr) : (preview.descriptionFr || preview.descriptionEn)), 200)
    || (lang === 'en' ? 'Interactive music for game pitches, on LayerPitch.' : 'La musique interactive pour vos pitchs de jeu vid\u00e9o, sur LayerPitch.');
  const image = preview.image ? MEDIA + String(preview.image).split('/').map(encodeURIComponent).join('/') : DEFAULT_IMAGE;
  const canonical = SITE + url.pathname + url.search;
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:site_name" content="LayerPitch">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(canonical)}">
</head><body><h1>${esc(title)}</h1><p>${esc(description)}</p></body></html>`;
}

// Page servie aux moteurs : le meme contenu que la page des visiteurs (titre, presentation, morceaux), lisible sans JavaScript,
// avec son adresse officielle et des donnees structurees (schema.org MusicPlaylist). Jamais de contenu absent de la vraie page.
export function seoHtml(page) {
  const lang = page.lang === 'en' ? 'en' : 'fr';
  const title = clip(page.title, 90) || page.handle || 'LayerPitch';
  const description = clip(lang === 'en' ? (page.descriptionEn || page.descriptionFr) : (page.descriptionFr || page.descriptionEn), 300);
  const image = page.image ? MEDIA + String(page.image).split('/').map(encodeURIComponent).join('/') : DEFAULT_IMAGE;
  const canonical = SITE + page.path;
  const tracks = (Array.isArray(page.tracks) ? page.tracks : []).filter(t => typeof t === 'string' && t.trim()).slice(0, 100);
  const by = lang === 'en' ? 'Adaptive music by' : 'Musique adaptative de';
  const listen = lang === 'en' ? 'Listen and play with the music on LayerPitch' : '\u00c9couter et manipuler la musique sur LayerPitch';
  const tracksLabel = lang === 'en' ? 'Tracks' : 'Morceaux';
  const ld = {
    '@context': 'https://schema.org', '@type': 'MusicPlaylist', name: title, url: canonical, image,
    byArtist: { '@type': 'Person', name: page.handle, url: SITE + '/' + page.handle + '/' },
    numTracks: tracks.length, track: tracks.map(t => ({ '@type': 'MusicRecording', name: t })),
  };
  if (description) ld.description = description;
  if (page.updatedAt) ld.dateModified = page.updatedAt;
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8">
<title>${esc(title)} \u2014 LayerPitch</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ''}<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="LayerPitch">
<meta property="og:type" content="music.playlist">
<meta property="og:title" content="${esc(title)}">
${description ? `<meta property="og:description" content="${esc(description)}">\n` : ''}<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(canonical)}">
<script type="application/ld+json">${json}</script>
</head><body>
<h1>${esc(title)}</h1>
<p>${esc(by)} ${esc(page.handle)}</p>
${description ? `<p>${esc(description)}</p>\n` : ''}${tracks.length ? `<h2>${tracksLabel}</h2>\n<ul>${tracks.map(t => `<li>${esc(t)}</li>`).join('')}</ul>\n` : ''}<p><a href="${esc(canonical)}">${esc(listen)}</a></p>
</body></html>`;
}

// Plan du site des AdReels servis aux moteurs (/sitemap-adreels.xml, annonce dans robots.txt).
export function sitemapXml(list) {
  const urls = (Array.isArray(list) ? list : []).filter(x => x && typeof x.path === 'string').map(x =>
    `  <url><loc>${esc(SITE + x.path)}</loc>${x.updatedAt ? `<lastmod>${esc(String(x.updatedAt).slice(0, 10))}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
}

async function rpc(name, body, env) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(`${(env && env.SUPABASE_URL) || SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: (env && env.SUPABASE_KEY) || SUPABASE_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
const fetchPreview = (route, env) => rpc('get_share_preview', { p_kind: route.kind, p_handle: route.handle, p_ref: route.ref, p_alt: route.alt }, env);
const fetchSeoPage = (route, env) => rpc('get_seo_adreel_page', { p_handle: route.handle, p_ref: route.ref, p_alt: route.alt }, env);

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return fetch(request);
    const url = new URL(request.url);
    const body = text => (request.method === 'HEAD' ? null : text);
    if (url.pathname === '/sitemap-adreels.xml') {
      const list = await rpc('list_seo_adreels', {}, env);
      if (!Array.isArray(list)) return fetch(request); // base injoignable : comportement d'avant
      return new Response(body(sitemapXml(list)), { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    const ua = request.headers.get('User-Agent');
    const search = isSearchBot(ua);
    if (!search && !isShareBot(ua)) return fetch(request);
    const route = routeOf(url);
    if (!route) return fetch(request);
    if (search && route.kind === 'adreel') {
      const page = await fetchSeoPage(route, env);
      if (page && page.path) {
        return new Response(body(seoHtml(page)), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
      }
    }
    if (!isShareBot(ua)) return fetch(request); // moteur, AdReel non indexable : comme avant (404, donc absent de Google)
    const preview = await fetchPreview(route, env);
    if (!preview || !preview.title) return fetch(request); // inconnu ou base injoignable : comportement d'avant
    return new Response(body(previewHtml(preview, url)), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
  },
};
