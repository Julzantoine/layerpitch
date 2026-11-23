// review-notify — LayerPitch, e-mail récapitulatif de relecture client (23/11, migration 20261123010000).
//
// Appelée par la page relecture.html (client SANS compte) : { slug, leaving }.
//   * juste après une remarque (leaving: false) : un e-mail part au propriétaire si aucun n'est parti pour ce lien depuis 10 minutes ;
//     sinon les remarques attendent (claim_review_notices décide) ;
//   * quand le client quitte la page (leaving: true) : le récapitulatif de ce qui attend part tout de suite.
// Aucune donnée venant du client n'est crue : le propriétaire, son adresse et les remarques sont retrouvés côté serveur à partir du nom
// du lien. Sans remarque nouvelle (non vue, non envoyée), rien ne part : appeler la fonction en boucle ne fait rien.
// Une remarque que le propriétaire a déjà vue dans son Backstage ne part jamais par e-mail. Échec d'envoi : release_review_notices
// rend les avis pour le prochain e-mail.
// Envoi via Resend (RESEND_API_KEY, RESEND_FROM_ADDRESS). Déployer SANS vérification de jeton (page sans compte) :
//   npx supabase functions deploy review-notify --no-verify-jwt
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SITE = 'https://beta.layerpitch.com';

type Notice = { id: string; kind: 'comment' | 'decision'; author: string; excerpt: string };
type Claim = { ownerProfileId: string; lang: string | null; kind: 'track' | 'video'; targetId: string; packId: string | null; title: string; slug: string; label: string | null; notices: Notice[] };

function compose(c: Claim) {
  const en = c.lang === 'en';
  const who = c.label ? ` (${c.label})` : '';
  const comments = c.notices.filter(n => n.kind === 'comment');
  const decisions = c.notices.filter(n => n.kind === 'decision');
  const lines: string[] = [];
  comments.forEach(n => lines.push(`${n.author} : « ${n.excerpt} »`));
  decisions.forEach(n => {
    const [what, ...rest] = String(n.excerpt).split(':');
    const version = rest.join(':');
    const verb = what === 'approved' ? (en ? 'approved' : 'a validé') : (en ? 'asked for changes on' : 'demande des modifs sur');
    lines.push(`${n.author} ${verb}${version ? ` « ${version} »` : ''}`);
  });
  const subject = en
    ? `Client review — “${c.title}”${who}: ${comments.length} new note(s)${decisions.length ? `, ${decisions.length} decision(s)` : ''}`
    : `Relecture — « ${c.title} »${who} : ${comments.length} nouvelle(s) remarque(s)${decisions.length ? `, ${decisions.length} décision(s)` : ''}`;
  const intro = en
    ? `Your client left feedback on “${c.title}”${who} on LayerPitch:`
    : `Ton client a laissé des retours sur « ${c.title} »${who} sur LayerPitch :`;
  const link = c.kind === 'track'
    ? `${SITE}/layerpitch-backstage.html?tab=library&review=${encodeURIComponent(c.targetId)}`
    : `${SITE}/atelier.html?${new URLSearchParams({ ...(c.packId ? { id: c.packId } : {}), montage: c.targetId }).toString()}`;
  const button = en ? 'Open the notes' : 'Voir les remarques';
  const html = `<div style="font-family:sans-serif;color:#1d2026;max-width:520px;">
    <p>${esc(intro)}</p>
    <ul style="padding-left:18px">${lines.map(l => `<li style="margin:4px 0;white-space:pre-wrap">${esc(l)}</li>`).join('')}</ul>
    <p><a href="${link}" style="display:inline-block;padding:10px 24px;background:#2f80c0;color:#fff;text-decoration:none;border-radius:6px;">${esc(button)}</a></p>
    <p style="font-size:12px;color:#667">${esc(en ? 'In LayerPitch, “Listen in this state” replays the track exactly as your client heard it.' : 'Dans LayerPitch, « Écouter dans cet état » rejoue le morceau tel que ton client l’entendait.')}</p>
  </div>`;
  const text = [intro, '', ...lines.map(l => '- ' + l), '', button + ' : ' + link].join('\n');
  return { subject, html, text };
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return json({ ok: true }); // rien à dire à un appel invalide
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: claim, error } = await adminClient.rpc('claim_review_notices', { p_slug: slug, p_leaving: !!body.leaving });
    if (error) { console.error('review-notify: claim', error); return json({ ok: false }, 500); }
    if (!claim || !(claim as Claim).notices?.length) return json({ ok: true, sent: false });
    const c = claim as Claim;
    const release = () => adminClient.rpc('release_review_notices', { p_ids: c.notices.map(n => n.id) });
    const { data: owner } = await adminClient.auth.admin.getUserById(c.ownerProfileId);
    const to = owner?.user?.email;
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
    if (!to || !apiKey || !fromAddress) { await release(); return json({ ok: false, error: 'not configured' }, 500); }
    const mail = compose(c);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress, to, subject: mail.subject, html: mail.html, text: mail.text }),
    }).catch(() => null);
    if (!res || !res.ok) { await release(); return json({ ok: false, error: 'send failed' }, 502); }
    return json({ ok: true, sent: true });
  } catch (e) {
    console.error('review-notify:', e);
    return json({ ok: false }, 500);
  }
});
