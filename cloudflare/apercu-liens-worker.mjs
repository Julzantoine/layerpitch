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

// Adresse -> { kind, handle, ref, alt } ou null (page qui n'a pas d'aperçu propre : on laisse passer).
export function routeOf(url) {
  const segs = url.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  if (!segs.length) return null;
  if (segs[0] === 'album' && segs.length === 2 && !segs[1].includes('.')) return { kind: 'album', handle: '', ref: segs[1], alt: '' };
  if (['shop', 'vitrine', 'album'].includes(segs[0]) || segs[0].includes('.')) return null; // pages réservées et vrais fichiers
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
<link rel="canonical" href="${esc(canonical)}">
</head><body><h1>${esc(title)}</h1><p>${esc(description)}</p></body></html>`;
}

async function fetchPreview(route, env) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(`${(env && env.SUPABASE_URL) || SUPABASE_URL}/rest/v1/rpc/get_share_preview`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: (env && env.SUPABASE_KEY) || SUPABASE_KEY },
      body: JSON.stringify({ p_kind: route.kind, p_handle: route.handle, p_ref: route.ref, p_alt: route.alt }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return fetch(request);
    if (!isShareBot(request.headers.get('User-Agent'))) return fetch(request);
    const url = new URL(request.url);
    const route = routeOf(url);
    if (!route) return fetch(request);
    const preview = await fetchPreview(route, env);
    if (!preview || !preview.title) return fetch(request); // inconnu ou base injoignable : comportement d'avant
    return new Response(request.method === 'HEAD' ? null : previewHtml(preview, url), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
  },
};
