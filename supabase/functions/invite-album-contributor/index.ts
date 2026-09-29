// invite-album-contributor — LayerPitch, compositeur invité sur l'album d'un studio (29/09, vente d'OST par un studio).
//
// Appelée par le STUDIO vendeur (espace studio, onglet Albums) après invite_album_contributor(). Vérifie que l'appelant
// est bien le vendeur (list_album_contributors avec SON jeton : liste vide pour tout autre), puis, comme
// invite-rights-holder :
//   * pas encore de compte à cette adresse -> auth.admin.generateLink({ type: 'invite' }) : le compte est créé ;
//   * compte existant -> lien de connexion (magiclink).
// Le lien mène à invitation.html, où le compositeur accepte ou refuse. E-mail via Resend (mêmes secrets que
// invite-tester : RESEND_API_KEY, RESEND_FROM_ADDRESS). Si l'e-mail échoue, le lien est renvoyé au studio pour qu'il le
// transmette lui-même.
// NON TESTÉE EN RÉEL au 29/09 : à déployer (supabase functions deploy invite-album-contributor) puis essayer sur une
// adresse de test ; l'URL de retour doit figurer dans les URLs autorisées de Supabase Auth.
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

async function sendEmail(to: string, albumTitle: string, studioEmail: string, link: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
  if (!apiKey || !fromAddress) return { ok: false, error: 'Secrets Resend non configurés (RESEND_API_KEY / RESEND_FROM_ADDRESS).' };
  const intro = `${studioEmail} t'invite à composer l'album « ${albumTitle} » sur LayerPitch : tu y ajoutes tes morceaux et tu fixes leur version officielle. L'album reste celui du studio, qui le met en vente.`;
  const html = `
    <div style="font-family:sans-serif;color:#262521;max-width:520px;">
      <h2 style="font-family:sans-serif;">Un album t'attend sur LayerPitch</h2>
      <p>${escapeHtml(intro)}</p>
      <p>Tu peux quitter l'album à tout moment : tes morceaux en sortent alors.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 24px;background:#2f80c0;color:#fff;text-decoration:none;border-radius:4px;">Voir et répondre</a></p>
      <p style="font-size:12px;color:#6f6b62;">Les accords entre le studio et toi (droits, rémunération) se règlent entre vous ; LayerPitch n'intervient pas.<br>Si le bouton ne fonctionne pas : ${link}</p>
    </div>`;
  const text = [intro, '', 'Voir et répondre :', link].join('\n');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress, to, subject: `Invitation sur « ${albumTitle} » — LayerPitch`, html, text, reply_to: studioEmail }),
    });
    if (!res.ok) return { ok: false, error: `Resend a refusé l'envoi (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Appel à Resend échoué : ' + String((e as Error)?.message || e) };
  }
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

    const { albumId, contributorId, redirectTo } = await req.json();
    if (!albumId || !contributorId) return json({ error: 'albumId et contributorId requis.' }, 400);
    // Vérification de propriété avec l'identité de l'appelant : list_album_contributors ne renvoie rien à un autre que le vendeur.
    const { data: list, error: listError } = await callerClient.rpc('list_album_contributors', { p_album_id: albumId });
    if (listError || !Array.isArray(list)) return json({ error: 'Non autorisé.' }, 403);
    const contributor = list.find((c: { id: string }) => c.id === contributorId);
    if (!contributor) return json({ error: 'Invité introuvable pour cet album.' }, 404);
    if (contributor.status !== 'pending') return json({ error: 'Cet invité a déjà répondu.' }, 409);

    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: album } = await adminClient.from('albums').select('title').eq('id', albumId).maybeSingle();
    const target = typeof redirectTo === 'string' && redirectTo ? redirectTo : 'https://beta.layerpitch.com/invitation.html';
    let link = await adminClient.auth.admin.generateLink({ type: 'invite', email: contributor.email, options: { redirectTo: target } });
    if (link.error) link = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: contributor.email, options: { redirectTo: target } });
    const actionLink = link.data?.properties?.action_link;
    if (link.error || !actionLink) return json({ error: 'Lien d\'invitation impossible : ' + (link.error?.message || 'réponse vide') }, 400);

    const sent = await sendEmail(contributor.email, album?.title || 'album', callerData.user.email || 'Un studio', actionLink);
    if (!sent.ok) return json({ error: 'Invitation prête, mais l\'e-mail n\'est pas parti : ' + sent.error, actionLink }, 502);
    return json({ ok: true });
  } catch (e) {
    console.error('invite-album-contributor:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
