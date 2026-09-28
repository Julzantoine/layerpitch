// invite-team-member — LayerPitch, invitation d'un membre dans l'équipe d'un studio (chantier profils et permissions,
// étape 5a, 28/09 ; D14, D37 du cadrage layerpitch-docs/2026-09-27-cadrage-profils-permissions.md).
//
// Appelée par le PROPRIÉTAIRE du studio après invite_team_member() (qui vérifie le quota de la matrice). Vérifie avec le
// jeton de l'appelant (my_team) qu'il est bien propriétaire et que l'invitation est de son studio, puis envoie un lien
// (compte créé si besoin : type 'invite', sinon 'magiclink') vers invitation.html, où la personne accepte ou refuse.
// E-mail via Resend (RESEND_API_KEY, RESEND_FROM_ADDRESS). Échec d'envoi : le lien est renvoyé pour être transmis à la main.
// NON TESTÉE EN RÉEL au 28/09 : à déployer (supabase functions deploy invite-team-member).
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
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ error: 'Non authentifié.' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (callerError || !callerData.user) return json({ error: 'Jeton invalide.' }, 401);

    const { memberId, redirectTo } = await req.json().catch(() => ({}));
    if (!memberId) return json({ error: 'memberId requis.' }, 400);
    const { data: team, error: teamError } = await callerClient.rpc('my_team');
    if (teamError || !team || !team.isOwner) return json({ error: 'Seul le propriétaire du studio peut inviter.' }, 403);
    const member = (team.members || []).find((m: { id: string }) => m.id === memberId);
    if (!member || member.status !== 'invited') return json({ error: 'Invitation introuvable ou déjà acceptée.' }, 404);

    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const target = typeof redirectTo === 'string' && redirectTo.startsWith('https://') ? redirectTo : 'https://beta.layerpitch.com/invitation.html';
    let link = await adminClient.auth.admin.generateLink({ type: 'invite', email: member.email, options: { redirectTo: target } });
    if (link.error) link = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: member.email, options: { redirectTo: target } });
    const actionLink = link.data?.properties?.action_link;
    if (link.error || !actionLink) return json({ error: 'Lien d\'invitation impossible : ' + (link.error?.message || 'réponse vide') }, 400);

    const apiKey = Deno.env.get('RESEND_API_KEY');
    const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
    if (!apiKey || !fromAddress) return json({ error: 'Secrets Resend non configurés.', actionLink }, 502);
    const inviter = callerData.user.email || 'Un studio';
    const intro = `${inviter} t'invite à rejoindre son équipe studio sur LayerPitch : bibliothèque de musiques et de Sfx, packs custom et Projets partagés.`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress, to: member.email, reply_to: inviter,
        subject: 'Invitation dans une équipe studio — LayerPitch',
        html: `<div style="font-family:sans-serif;color:#262521;max-width:520px;"><h2>Rejoindre une équipe studio</h2><p>${escapeHtml(intro)}</p><p><a href="${actionLink}" style="display:inline-block;padding:10px 24px;background:#c9713c;color:#fff;text-decoration:none;border-radius:4px;">Voir l'invitation</a></p><p style="font-size:12px;color:#6f6b62;">Si le bouton ne fonctionne pas : ${actionLink}</p></div>`,
        text: [intro, '', 'Voir l\'invitation :', actionLink].join('\n'),
      }),
    }).catch(() => null);
    if (!res || !res.ok) return json({ error: 'L\'e-mail n\'est pas parti.', actionLink }, 502);
    return json({ ok: true });
  } catch (e) {
    console.error('invite-team-member:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
