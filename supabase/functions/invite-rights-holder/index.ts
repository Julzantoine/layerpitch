// invite-rights-holder — LayerPitch, co-ayants droit d'un album (chantier profils et permissions, étape 4a, 28/09 ;
// D4-D6 de layerpitch-docs/2026-09-27-cadrage-profils-permissions.md).
//
// Appelée par le VENDEUR d'un album (Backstage, onglet Albums) après set_album_rights(), pour chaque co-ayant droit à
// inviter. Vérifie que l'appelant est bien le vendeur (list_album_rights avec SON jeton : refusé sinon), puis :
//   * pas encore de compte à cette adresse -> auth.admin.generateLink({ type: 'invite' }) : le compte est créé
//     (contourne la bêta sur invitation, D5 : canal d'acquisition de compositeurs) ;
//   * compte existant -> lien de connexion (magiclink).
// Dans les deux cas le lien mène à invitation.html, où la personne accepte ou refuse sa part. E-mail envoyé via Resend
// (mêmes secrets que invite-tester : RESEND_API_KEY, RESEND_FROM_ADDRESS). Si l'e-mail échoue, le lien est renvoyé au
// vendeur pour qu'il le transmette lui-même.
// NON TESTÉE EN RÉEL au 28/09 : à déployer (supabase functions deploy invite-rights-holder) puis essayer sur une
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
const pct = (bps: number) => (bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %';

async function sendEmail(to: string, albumTitle: string, sellerEmail: string, shareBps: number, link: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
  if (!apiKey || !fromAddress) return { ok: false, error: 'Secrets Resend non configurés (RESEND_API_KEY / RESEND_FROM_ADDRESS).' };
  const intro = `${sellerEmail} te déclare co-ayant droit de l'album « ${albumTitle} » sur LayerPitch, avec une part de ${pct(shareBps)} de chaque vente.`;
  const html = `
    <div style="font-family:sans-serif;color:#262521;max-width:520px;">
      <h2 style="font-family:sans-serif;">Une part d'album t'attend sur LayerPitch</h2>
      <p>${escapeHtml(intro)}</p>
      <p>Tant que tu n'as pas accepté ou refusé, l'album ne peut pas être vendu avec partage automatique. Si tu acceptes, ta part te sera versée à chaque vente (versement Stripe à activer).</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 24px;background:#c9713c;color:#fff;text-decoration:none;border-radius:4px;">Voir et répondre</a></p>
      <p style="font-size:12px;color:#6f6b62;">La répartition se négocie entre ayants droit ; LayerPitch ne peut être tenu responsable d'une erreur dans la répartition déclarée.<br>Si le bouton ne fonctionne pas : ${link}</p>
    </div>`;
  const text = [intro, '', 'Voir et répondre :', link, '', 'La répartition se négocie entre ayants droit ; LayerPitch ne peut être tenu responsable d\'une erreur dans la répartition déclarée.'].join('\n');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress, to, subject: `Co-ayant droit de « ${albumTitle} » — LayerPitch`, html, text, reply_to: sellerEmail }),
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

    const { albumId, holderId, redirectTo } = await req.json();
    if (!albumId || !holderId) return json({ error: 'albumId et holderId requis.' }, 400);
    // Vérification de propriété avec l'identité de l'appelant : list_album_rights refuse tout autre que le vendeur.
    const { data: rights, error: rightsError } = await callerClient.rpc('list_album_rights', { p_album_id: albumId });
    if (rightsError || !rights) return json({ error: 'Non autorisé.' }, 403);
    const holder = (rights.holders || []).find((h: { id: string }) => h.id === holderId);
    if (!holder) return json({ error: 'Co-ayant droit introuvable pour cet album.' }, 404);
    if (holder.status !== 'pending' && holder.status !== 'self_pay') return json({ error: 'Ce co-ayant droit a déjà répondu.' }, 409);

    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: album } = await adminClient.from('albums').select('title').eq('id', albumId).maybeSingle();
    const target = typeof redirectTo === 'string' && redirectTo ? redirectTo : 'https://beta.layerpitch.com/invitation.html';
    let link = await adminClient.auth.admin.generateLink({ type: 'invite', email: holder.email, options: { redirectTo: target } });
    if (link.error) link = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: holder.email, options: { redirectTo: target } });
    const actionLink = link.data?.properties?.action_link;
    if (link.error || !actionLink) return json({ error: 'Lien d\'invitation impossible : ' + (link.error?.message || 'réponse vide') }, 400);

    const sent = await sendEmail(holder.email, album?.title || 'album', callerData.user.email || 'Un vendeur', holder.shareBps, actionLink);
    if (!sent.ok) return json({ error: 'Invitation prête, mais l\'e-mail n\'est pas parti : ' + sent.error, actionLink }, 502);
    return json({ ok: true });
  } catch (e) {
    console.error('invite-rights-holder:', e);
    return json({ error: 'Erreur interne. Réessaie dans un instant.' }, 500);
  }
});
