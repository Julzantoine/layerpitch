// project-notify — LayerPitch, e-mails des Projets (chantier profils et permissions, étape 5, 28/09 ; 11/09 §4 et §6.4).
//   * { action: 'invite', memberId, redirectTo } : invitation d'un invité (gratuit) dans un Projet. Appelant = administrateur
//     du Projet (vérifié : get_project avec SON jeton doit renvoyer le rôle 'admin' et contenir cette invitation). Compte
//     créé si besoin (type 'invite', sinon 'magiclink'), lien vers invitation.html.
//   * { action: 'annotation', annotationId, projectUrl } : une note ADRESSÉE prévient son destinataire par e-mail (la
//     notification dans la page est déjà écrite par add_project_annotation). Appelant = auteur de la note.
// Envoi via Resend (RESEND_API_KEY, RESEND_FROM_ADDRESS). NON TESTÉE EN RÉEL au 28/09 (supabase functions deploy project-notify).
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
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u: unknown, fallback: string) => (typeof u === 'string' && /^https:\/\/(beta\.|www\.)?layerpitch\.com\//.test(u) ? u : fallback);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function send(to: string, subject: string, intro: string, button: string, link: string, replyTo?: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
  if (!apiKey || !fromAddress) return { ok: false, error: 'Secrets Resend non configurés.' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress, to, subject, ...(replyTo ? { reply_to: replyTo } : {}),
      html: `<div style="font-family:sans-serif;color:#262521;max-width:520px;"><p>${esc(intro).replace(/\n/g, '<br>')}</p><p><a href="${link}" style="display:inline-block;padding:10px 24px;background:#c9713c;color:#fff;text-decoration:none;border-radius:4px;">${esc(button)}</a></p><p style="font-size:12px;color:#6f6b62;">Si le bouton ne fonctionne pas : ${link}</p></div>`,
      text: [intro, '', button + ' :', link].join('\n'),
    }),
  }).catch(() => null);
  return res && res.ok ? { ok: true } : { ok: false, error: 'L\'e-mail n\'est pas parti.' };
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
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const me = callerData.user.email || 'Un membre';

    if (body.action === 'invite') {
      const { data: memberRow } = await adminClient.from('project_members').select('id, project_id, email, status').eq('id', body.memberId).maybeSingle();
      if (!memberRow || memberRow.status !== 'invited') return json({ error: 'Invitation introuvable.' }, 404);
      const { data: project, error } = await callerClient.rpc('get_project', { p_project_id: memberRow.project_id });
      if (error || !project || project.role !== 'admin') return json({ error: 'Seul l\'administrateur du Projet invite.' }, 403);
      const target = safeUrl(body.redirectTo, 'https://beta.layerpitch.com/invitation.html');
      let link = await adminClient.auth.admin.generateLink({ type: 'invite', email: memberRow.email, options: { redirectTo: target } });
      if (link.error) link = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: memberRow.email, options: { redirectTo: target } });
      const actionLink = link.data?.properties?.action_link;
      if (!actionLink) return json({ error: 'Lien d\'invitation impossible.' }, 400);
      const sent = await send(memberRow.email, `Invitation au Projet « ${project.title} » — LayerPitch`,
        `${me} t'invite à rejoindre le Projet « ${project.title} » sur LayerPitch : un espace de travail partagé pour la musique du jeu (références, vidéos annotées, discussion). C'est gratuit pour toi.`,
        'Voir l\'invitation', actionLink, me);
      return sent.ok ? json({ ok: true }) : json({ error: sent.error, actionLink }, 502);
    }

    if (body.action === 'annotation') {
      const { data: a } = await adminClient.from('project_annotations').select('id, project_id, author_id, addressee_id, body, at_seconds, target_type').eq('id', body.annotationId).maybeSingle();
      if (!a || a.author_id !== callerData.user.id || !a.addressee_id) return json({ error: 'Annotation introuvable.' }, 404);
      const { data: addressee } = await adminClient.auth.admin.getUserById(a.addressee_id);
      const to = addressee?.user?.email;
      if (!to) return json({ error: 'Destinataire introuvable.' }, 404);
      const { data: project } = await adminClient.from('projects').select('title').eq('id', a.project_id).maybeSingle();
      const where = a.at_seconds != null ? ` (à ${clock(Number(a.at_seconds))})` : '';
      const link = safeUrl(body.projectUrl, `https://beta.layerpitch.com/projet.html?id=${a.project_id}`);
      const sent = await send(to, `Une note pour toi dans « ${project?.title || 'ton Projet'} »`,
        `${me} t'a laissé une note${where} :\n« ${String(a.body).slice(0, 400)} »`, 'Ouvrir le Projet', link, me);
      return sent.ok ? json({ ok: true }) : json({ error: sent.error }, 502);
    }
    return json({ error: 'Action inconnue (invite ou annotation).' }, 400);
  } catch (e) {
    console.error('project-notify:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
